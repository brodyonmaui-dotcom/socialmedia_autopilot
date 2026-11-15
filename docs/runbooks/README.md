# Runbooks (M6)

Short, step-by-step procedures built from facts already in the repo (`CLAUDE.md`, `infra/`, `packages/db`, `docs/research.md`). Every step that changes server state is marked **[changes state]**. Per CLAUDE.md, an agent asks before running those; you run them.

| Runbook | When |
|---|---|
| [deploy.md](deploy.md) | A PR merged to `main` and should go live |
| [migrations.md](migrations.md) | A new `packages/db/migrations/*.sql` landed (now: 0008 pending) |
| [token-renewal.md](token-renewal.md) | Meta data access before **2027-02-08**, YouTube or Zernio auth failing |
| [failed-or-unknown-post.md](failed-or-unknown-post.md) | A batch item shows `failed` or `unknown` |
| [restore.md](restore.md) | Backup drill, or the database is lost or corrupted |
| [dashboard-password.md](dashboard-password.md) | Set or change the /app basic-auth password (first layer) |
| [login.md](login.md) | Add a device (passkey), lost phone, how batch approval gates the worker |
| [snapchat-handoff.md](snapchat-handoff.md) | Sharing the day's Snapchat clip from the phone (assisted route), Skip vs Drop |
| [engagement.md](engagement.md) | Comment replies / DM drafts: shadow vs live modes, kill switch, inbox, limits |
| [analytics.md](analytics.md) | A `metrics-health` alert, `/analytics` looks stale, re-running the metrics probes |
| [alerts-push.md](alerts-push.md) | The `/alerts` page, turning on phone notifications (VAPID keys, Home-Screen install), which kinds push |
| [first-real-post.md](first-real-post.md) | Going live: the first IG reel and YT upload, preflight, run-mode switch, switch back |
| [editor-pipeline.md](editor-pipeline.md) | Editor-approved renders to app drafts: sidecar contract, laptop env, Task Scheduler, phone approval |

Conventions: `ssh autopilot` is the server alias (the IP is never in git). The repo lives in `/opt/autopilot` and tracks `main`. Secrets live in `.env` only.
