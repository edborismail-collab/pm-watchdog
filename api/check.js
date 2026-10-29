/**
 * The watchdog of the watchdog.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT ON THE MAC
 *   2026-10-13. Everything else in this system runs on the Mac: the Gmail sweep, the LinkedIn
 *   reader, the Facebook GraphQL reader, the heartbeat ping. The Mac is the sensor.
 *
 *   But nothing watched the Mac. A dead Mac cannot report its own death -- every check that ran
 *   locally would simply stop running, silently, and the absence of a complaint would look exactly
 *   like everything being fine. That is the same silent-failure shape that has already bitten this
 *   project four times.
 *
 *   This function runs on Vercel, which is independent of the Mac AND of the Cloudflare Worker.
 *   It is the only component that can notice either of them going dark.
 *
 * WHAT IT CHECKS, ONCE PER RUN
 *   1. The Worker answers at all.
 *   2. No job is overdue (a job that stops pinging means the Mac stopped pinging).
 *   3. No monitored site is failing.
 *
 * ALERTING, AND THE ONE THING THAT NEEDS A KEY
 *   Sending mail needs an email API. Resend's free tier is 3000/month, far beyond this volume.
 *   RESEND_API_KEY is read from the environment; ALERT_EMAIL is the recipient. With no key set this
 *   function still runs and still reports, it just cannot deliver -- and it says so in its response
 *   rather than pretending to have alerted.
 *
 * STATE
 *   Alerts are de-duplicated in memory for the duration of an invocation, but Vercel functions are
 *   stateless between invocations. So the de-duplication that matters -- not re-alerting every 15
 *   minutes for the same ongoing problem -- is keyed on the Worker's own data and a cooldown window
 *   passed through as an env var. Anything more elaborate would need a database this app deliberately
 *   does not have.
 */

const WORKER = process.env.WORKER_URL || 'https://panel.pmforcontractors.com';
// LEAST PRIVILEGE. This used to read /api/all with the Mac's PUSH_TOKEN, which also grants the
// approval queue, every draft and the whole marketing snapshot - and the ability to overwrite the
// snapshot. A watchdog needs three facts: the worker answered, no job is late, no site is broken.
// /api/watch returns exactly that, and WATCHDOG_TOKEN can reach nothing else.
const TOKEN = process.env.WATCHDOG_TOKEN || '';
// 24h at 15-minute cadence: alert once, then stay quiet for 2 hours unless it clears and returns.
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 2 * 60 * 60 * 1000);

let lastAlert = 0;
let lastKey = '';

async function fetchState() {
  const r = await fetch(`${WORKER}/api/watch`, {
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`worker returned ${r.status}`);
  return r.json();
}

async function send(subject, text) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) return { sent: false, reason: 'RESEND_API_KEY or ALERT_EMAIL not set' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_FROM || 'watchdog@resend.dev', to, subject, text }),
  });
  if (!r.ok) return { sent: false, reason: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return { sent: true };
}

export default async function handler(req, res) {
  const started = Date.now();
  const out = { at: new Date().toISOString(), worker: 'unknown', problems: [], alert: null };

  let state;
  try {
    state = await fetchState();
    out.worker = 'ok';
  } catch (e) {
    // The Worker being unreachable is itself the loudest possible signal, because every reader on
    // the Mac reports through it. Treat it as the primary problem.
    out.worker = 'unreachable';
    out.problems.push(`The control panel did not answer: ${e.message}. If this persists, the Cloudflare Worker is down AND nothing on the Mac can record anything.`);
    state = null;
  }

  if (state) {
    const overdue = Number(state.overdue || 0);
    const broken = Number(state.broken || 0);
    out.jobs = (state.counts && state.counts.jobs) || (state.jobs || []).length;
    out.sites = (state.counts && state.counts.sites) || (state.sites || []).length;

    // A job that has gone quiet is the signature of the Mac having stopped, since the Mac is what
    // pings. Name the jobs rather than only counting them: "2 overdue" is not actionable, the names are.
    const overdueJobs = (state.jobs || []).filter((j) => j.overdue || j.state === 'overdue').map((j) => j.name);
    if (overdue > 0) {
      out.problems.push(`${overdue} job(s) overdue: ${overdueJobs.join(', ') || '(unnamed)'} -- the machine that pings is probably not running.`);
    }
    if (broken > 0) {
      const bad = (state.sites || []).filter((s) => s.status != null && s.status !== s.want).map((s) => `${s.id} (got ${s.status}, want ${s.want})`);
      out.problems.push(`${broken} site(s) failing: ${bad.join(', ')}`);
    }
  }

  if (out.problems.length) {
    const key = out.problems.join('|');
    const now = Date.now();
    const cooling = key === lastKey && now - lastAlert < COOLDOWN_MS;
    out.alert = cooling ? { sent: false, reason: 'same problem, inside the cooldown window' } : await send('Marketing control panel: something needs you', out.problems.join('\n\n'));
    if (out.alert.sent) { lastAlert = now; lastKey = key; }
  }

  out.ms = Date.now() - started;
  out.ok = out.problems.length === 0;
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(out);
}
