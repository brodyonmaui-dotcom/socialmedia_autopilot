# Migrations

`packages/db/migrations/NNNN_name.sql`, applied in filename order by `pnpm --filter @autopilot/db migrate` (`packages/db/src/cli-migrate.ts`):
- The table `schema_migrations(id, applied_at)` records what has run; already-applied files are skipped, so re-running is safe.
- Each file runs in **one transaction** with its `schema_migrations` insert. A failure rolls that file back and stops; files before it stay applied.
- Nothing runs migrations automatically: not the worker, not `web`, not deploy.

## Now pending: 0005 (if not yet applied), 0006
- `0005_outbox.sql` (F1, PR #9): `batch_items.next_attempt_at`, the `alerts` table, `settings.cadence`. Check with `select id from schema_migrations order by id;`; the runner skips it if it's already there.
- `0006_auth_approval.sql` (F2): passkey/session/enrol-code/challenge/failure tables; `approved_at` on `batches` and `batch_items`; `batch_item_events` audit table; `scheduled_for` becomes nullable; a CHECK on `batch_items.status` (adds `rejected`).
  - **Order:** merge the F2 PR → back up → migrate → *then* `docker compose up -d --build`. The new worker only fires items with `approved_at` set in an `approved` batch.
  - It **backfills** `approved_at` on existing approved/queued/publishing/published/unknown/failed rows and marks their batches `approved`, so already-approved posts keep firing under the new gate.
  - After it: enrol the phone ([login.md](login.md)).
- Earlier: `0003_research.sql` (F6) and `0004_analytics.sql` (F5).

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
   ./packages/db/node_modules/.bin/tsx packages/db/src/cli-migrate.ts   # run from the repo root
   ```
   Run it from the repo root. The CLI loads `.env` from the current directory, and `pnpm --filter @autopilot/db migrate` runs inside `packages/db`, where there's no `.env`, so it stops with "DATABASE_URL is not set" (seen 2026-11-12).
   Expect `applied: 0005_outbox.sql, 0006_auth_approval.sql` (or only `0006_auth_approval.sql` if 0005 was already applied, or `up to date, nothing to apply`).
4. **Deploy** the code that uses the new tables ([deploy.md](deploy.md)).
5. **Check:** `/app/login` loads on the phone after the basic-auth prompt; enrol with [login.md](login.md). Already-approved posts still show `approved` in their batch.

## If a migration fails
- The failing file is rolled back; earlier ones are kept. Read the error, fix the SQL in a PR (never edit an already-applied file), and re-run.
- To undo an applied migration: there are no down-migrations. Write a new forward migration, or restore the step-1 backup ([restore.md](restore.md)).
