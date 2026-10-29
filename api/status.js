/** A read-only view of the same check, so the watchdog can be inspected without triggering mail. */
export default async function handler(req, res) {
  const WORKER = process.env.WORKER_URL || 'https://panel.pmforcontractors.com';
  const TOKEN = process.env.WATCHDOG_TOKEN || '';
  try {
    const r = await fetch(`${WORKER}/api/watch`, { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}, cache: 'no-store' });
    if (!r.ok) throw new Error('worker returned ' + r.status);
    const s = await r.json();
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({
      ok: !s.overdue && !s.broken,
      worker: 'ok', overdue: s.overdue, broken: s.broken,
      jobs: (s.jobs || []).map((j) => ({ name: j.name, state: j.state, last: j.lastPing || null })),
      sites: (s.counts && s.counts.sites) || (s.sites || []).length,
      now: new Date().toISOString(),
    });
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    res.status(503).json({ ok: false, worker: 'unreachable', error: e.message, now: new Date().toISOString() });
  }
}
