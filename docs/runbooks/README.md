# Runbooks (M6)

Short, step-by-step procedures built from facts already in the repo (`CLAUDE.md`, `infra/`, `packages/db`, `docs/research.md`). Every step that changes server state is marked **[changes state]**. Per CLAUDE.md, an agent asks before running those; you run them.

| Runbook | When |
|---|---|
| [deploy.md](deploy.md) | A PR merged to `main` and should go live |
| [migrations.md](migrations.md) | A new `packages/db/migrations/*.sql` landed (now: 0003 + 0004) |
| [token-renewal.md](token-renewal.md) | Meta data access before **2027-02-08**, YouTube or Zernio auth failing |
| [failed-or-unknown-post.md](failed-or-unknown-post.md) | A batch item shows `failed` or `unknown` |
| [restore.md](restore.md) | Backup drill, or the database is lost or corrupted |
| [dashboard-password.md](dashboard-password.md) | Set or change the /app basic-auth password |

Conventions: `ssh autopilot` is the server alias (the IP is never in git). The repo lives in `/opt/autopilot` and tracks `main`. Secrets live in `.env` only.
