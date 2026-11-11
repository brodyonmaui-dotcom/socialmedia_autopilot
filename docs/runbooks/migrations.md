# Migrations

`packages/db/migrations/NNNN_name.sql`, applied in filename order by `pnpm --filter @autopilot/db migrate` (`packages/db/src/cli-migrate.ts`):
- The table `schema_migrations(id, applied_at)` records what has run; already-applied files are skipped, so re-running is safe.
- Each file runs in **one transaction** with its `schema_migrations` insert. A failure rolls that file back and stops; files before it stay applied.
- Nothing runs migrations automatically: not the worker, not `web`, not deploy.

## Now pending: 0003 + 0004
- `0003_research.sql` (F6): `creators`, the idea backlog, hooks.
- `0004_analytics.sql` (F5): `post_metrics`, one snapshot per published post per checkpoint (24 h / 72 h / 7 d / 28 d). It references `batch_items`.

## Steps (from the laptop, through the SSH tunnel)
This is the route proven on 2026-11-11: the laptop's `.env` `DATABASE_URL` points at local port 5433, forwarded to the VPS loopback Postgres.

1. **Back up first** **[changes state: writes one object to the R2 backups bucket]**
   ```sh
   ssh autopilot "cd /opt/autopilot/infra && docker compose exec -T backup /bin/sh /backup.sh"
   ```
   Expect `backup ok <timestamp> <size>`.
2. **Open a tunnel that closes itself** (exits once the command below disconnects):
   ```sh
   ssh -f -o ExitOnForwardFailure=yes -L 5433:127.0.0.1:5432 autopilot sleep 60
   ```
3. **Migrate** **[changes state]**, within 60 s of step 2:
   ```sh
   pnpm --filter @autopilot/db migrate
   ```
   Expect `applied: 0003_research.sql, 0004_analytics.sql` (or `up to date, nothing to apply`).
4. **Deploy** the code that uses the new tables ([deploy.md](deploy.md)).
5. **Check:** `/research` and `/analytics` load on the phone (`/analytics` shows its labelled demo mode until real snapshots exist).

## If a migration fails
- The failing file is rolled back; earlier ones are kept. Read the error, fix the SQL in a PR (never edit an already-applied file), and re-run.
- To undo an applied migration: there are no down-migrations. Write a new forward migration, or restore the step-1 backup ([restore.md](restore.md)).
