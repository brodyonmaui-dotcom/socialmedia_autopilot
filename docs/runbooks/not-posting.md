# Approved posts didn't go out

Use this when posts were approved in the app but nothing reached TikTok, YouTube or Instagram by the time they were due. One read-only script collects everything, and its output is safe to paste into chat. If an item already shows `failed` or `unknown`, start with [failed-or-unknown-post.md](failed-or-unknown-post.md).

## 1. Run it on the VPS and paste the output
```sh
ssh autopilot
/opt/autopilot/infra/diagnose-posting.sh     # read-only; works from any directory
```
It changes nothing. `git fetch` only updates `origin/main`. Everything else is `docker compose ps/logs/inspect/exec` plus SELECTs in a read-only transaction. Paste the **whole** output into the chat.

The output never contains secrets, captions, file paths, IPs, domains or the time-zone name. Env variables show as `set`/`missing` (`DRY_RUN` shows `true`/`false`, `WORKER_LIVE` shows `1`/`not-1`). Log lines are redacted, and any value from `.env` that still shows up is replaced by `<NAME>`. All times are UTC.

Sections: 1 code, 2 containers, 3 env presence (`.env` vs the running worker), 4 worker log (24 h), 5 migrations, 6 posts in now ± 36 h with a **why not due** label per item, 7 pg-boss (`outbox-tick`), 8 open alerts. The last block is a numbered **VERDICT** list in check order. Fix the first item first, then run the script again.

## 2. What each VERDICT means and the fix
Steps marked **[changes state]** are yours to run. An agent asks first.

| VERDICT starts with | Meaning | Fix |
|---|---|---|
| `worker not running` / `worker restarting` | The worker container is down or crash-looping | `cd /opt/autopilot/infra && docker compose logs --tail 80 worker`, then paste the redacted error. A common cause is a missing `TZ_CREATOR` in a live run |
| `db not running` | Postgres is down, so every DB check is `n/a` | `docker compose logs --tail 50 db`. Don't touch the volume. See [restore.md](restore.md) only if data is lost |
| `code behind origin/main` / `worker older than code` | A fix is merged but not deployed, or the image wasn't rebuilt | [deploy.md](deploy.md): `git pull`, then `cd infra && docker compose up -d --build` **[changes state]** |
| `DRY_RUN not false` / `WORKER_LIVE not 1` / `worker running dry-run` / `live refused` / `dry-run would publish` | The worker runs dry-run. It logs "would publish" and sends nothing. Two keys are needed | Set `DRY_RUN=false` **and** `WORKER_LIVE=1` in `.env`, then `cd infra && docker compose up -d worker` **[changes state]**. Check that the startup line says `dry_run=false`. The first real post per platform needs the creator's OK ([first-real-post.md](first-real-post.md)) |
| `worker env differs from .env` | `.env` was edited but the worker wasn't recreated, so it still has the old values | `cd infra && docker compose up -d worker` **[changes state]** (a `restart` keeps the old env) |
| `TZ_CREATOR missing` | A live worker refuses to start without it (daily caps use the creator's local day) | Add it to `.env` (never to git), then recreate the worker **[changes state]** |
| `PUBLIC_MEDIA_BASE missing` / `media base invalid` | Every outbox tick is skipped and one `config` alert is raised | Set an absolute `https://` base in `.env`, then recreate the worker **[changes state]** |
| `<platform> credentials missing` | Due items exist but that platform has no adapter, so they're skipped silently, not failed | [token-renewal.md](token-renewal.md): put the names from section 3 into `.env` (not only `.secrets/`), then recreate the worker |
| `token/auth errors` | 401/403, `invalid_grant`, an expired token or similar in the worker log | [token-renewal.md](token-renewal.md) for the platform shown |
| `migrations missing` | The code expects tables or columns the DB doesn't have | [migrations.md](migrations.md) (back up first) |
| `batch not approved` / `item not approved` / `no approved_at` | The approval gate: the worker only fires items that are approved, have `approved_at` set and sit in an `approved` batch | Approve the items, or Approve all, in the app (batch page) |
| `media has no r2_key` | The clip has no clean (metadata-stripped) file in storage, so it's never sent | Re-run touch-up / ingest for that clip ([touch-up.md](touch-up.md), [editor-pipeline.md](editor-pipeline.md)) |
| `in backoff` | A retry is waiting for `next_attempt_at` | Wait. Read the item's `err=` code/class in section 6 |
| `post failed` / `post unknown` / `outbox FAILED/UNKNOWN` / `open alerts` | The engine tried and gave up, or can't tell whether the post exists | [failed-or-unknown-post.md](failed-or-unknown-post.md). Look on the platform first, never resend blindly |
| `in flight (publishing)` | Claimed by a tick that didn't finish. The next tick settles it through the existence check | Wait 10 min (a row stuck over 5 min is settled on the next tick). If it becomes `unknown`, use [failed-or-unknown-post.md](failed-or-unknown-post.md) |
| `due but not sent` | The item passes the gate but wasn't sent. Usually a dry-run mode, a missing adapter, a daily cap or a stopped tick (see the other verdicts and the `cap hold` count in section 4) | Fix the run-mode / adapter / pg-boss verdicts first |
| `outbox-tick not scheduled` / `never completed` / `not completing` / `backlog` / `jobs failing` / `pgboss unreadable` | The every-minute tick isn't running, or it throws | `docker compose logs --tail 80 worker`. The worker creates the queue and schedule at startup (`apps/worker/src/jobs/register-outbox.ts`). A recreate **[changes state]** re-registers them |
| `no posts scheduled within 36 h` | Nothing in the window: the items have no time, or sit in another week | Check the batch in the app. "Fill missing times", then approve |

YouTube and TikTok are handed off up to 24 h before `scheduled_for` and hold their own clock. Instagram fires at `scheduled_for`. Snapchat is assisted and never fired by the worker (`timing=` in section 6).
