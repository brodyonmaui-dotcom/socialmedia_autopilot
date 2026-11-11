# Deploy

The VPS runs Docker Compose from `/opt/autopilot/infra` (services: `caddy`, `web`, `worker`, `db`, `backup`). Deploy = pull `main` and bring the stack up.

## Before
1. The PR is merged to `main` and CI is green.
2. Check whether it adds a migration (`packages/db/migrations/`). If it does, follow [migrations.md](migrations.md) **before** starting the new `web`/`worker`.
3. Check whether `infra/Caddyfile` changed (`git diff --stat HEAD@{1} -- infra/Caddyfile` after pulling).
4. Check `.env.example` for new variables; add them to the server's `.env` by hand. Never copy secrets through chat or git.

## Steps
```sh
ssh autopilot
cd /opt/autopilot
git pull                                   # [changes state] tracks main
cd infra && docker compose up -d --build   # [changes state] rebuilds web/worker images
docker compose restart caddy               # [changes state] only if Caddyfile changed (see below)
```
- **Caddyfile gotcha:** it's a bind-mounted file. Git replaces it via rename, so a running container keeps the old inode, and `up -d` alone won't reload it. Restart `caddy` whenever it changed.

## Check
- `docker compose ps`: every service is `Up`. The worker isn't in a restart loop. (pg-boss v10 needs `createQueue()` before `schedule()`/`work()`; that was the cause of a crash-loop once.)
- `docker compose logs --tail 50 worker`: no errors. With `DRY_RUN=true`, the outbox logs dry-run lines and posts nothing.
- Open the dashboard on the phone; `/library` loads.

## Roll back
`git log --oneline -5`, then `git checkout <previous sha>` in `/opt/autopilot` and `docker compose up -d --build` **[changes state]**. A migration that already ran is **not** undone by this; see [migrations.md](migrations.md).
