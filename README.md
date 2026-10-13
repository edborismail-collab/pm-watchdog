# pm-watchdog

An external watchdog for the PM for Contractors marketing control panel.

## Why this exists

Everything else in the system runs on one Mac: the Gmail sweep, the LinkedIn reader, the Facebook
GraphQL reader, the heartbeat ping. That Mac is the sensor for everything.

Two gaps followed from that, and both were invisible by construction:

1. **Nothing alerted anyone.** A job that stopped running was visible only to somebody who
   deliberately opened the panel. A silent failure and a healthy system looked identical.
2. **Nothing watched the Mac.** A machine cannot report its own death. Every check ran locally, so if
   the whole Mac went down — power, disk, a logged-out browser — the absence of a complaint looked
   exactly like everything being fine.

This watchdog runs outside all of it. It is the only component that can notice either the Mac or the
Cloudflare Worker going dark.

## How it is put together

Three independent systems, deliberately:

| Part | Role | Why there |
|---|---|---|
| **The Mac** | the sensor | it holds the authenticated browser sessions nothing else can have |
| **Cloudflare Worker** | the record | the data store and the panel |
| **Vercel** | the checker | independent of both, so it can see either fail |
| **GitHub** | the trigger | cannot live on a watched machine, and the free hosting tier only allows a daily schedule |

## Endpoints

- `GET /api/check` — runs the full check. Called every 15 minutes by the workflow in
  `.github/workflows/watchdog.yml`, and once a day by Vercel's own cron as a backstop.
- `GET /api/status` — the same data, read only, without doing anything.

## Environment

| Variable | Purpose |
|---|---|
| `WORKER_URL` | the control panel to check |
| `PUSH_TOKEN` | bearer token for its machine endpoint |
| `ALERT_EMAIL`, `RESEND_API_KEY` | **optional.** With these set the watchdog also emails directly. Without them the check still runs and still reports; the alert path is the GitHub workflow failing, which GitHubs notifies on by itself. |

## The alert path

The workflow exits non-zero when the watchdog reports a problem, so **the failure notification is the
alert** — no email service, no key, no account. The problems are also emitted as GitHub annotations so
the reason is visible without opening a log.
