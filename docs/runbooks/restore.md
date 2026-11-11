# Backup and restore

- **Backups:** the `backup` service runs `infra/backup.sh` every 24 h: `pg_dump --no-owner` → gzip → R2 bucket `$R2_BUCKET_BACKUPS` under `db/autopilot-<UTC timestamp>.sql.gz`. An R2 lifecycle rule keeps 30 daily copies. The VPS provider's daily backup is a second layer (decisions.md).
- **Media masters** live in R2 (`library/<sha256>.mp4`); the laptop folders are the source. A DB restore doesn't touch R2.

## Drill (safe, monthly)
```sh
ssh autopilot "cd /opt/autopilot/infra && ./restore-test.sh"
```
It pulls the newest backup into a throwaway database `restore_drill`, counts the tables, and drops it. **It never touches the live DB.** Expect `restore ok <key> tables=<n>`.

## Real restore (database lost or corrupted)
Everything here is **[changes state]**. Stop the posting side first so nothing fires mid-restore.
1. `cd /opt/autopilot/infra && docker compose stop worker web`
2. If the DB is still readable, take a last backup: `docker compose exec -T backup /bin/sh /backup.sh`
3. Pick a backup: list `db/` in the backups bucket (same `aws s3 ls … --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com` pattern as `restore-test.sh`, run inside the `backup` container).
4. Inside the `backup` container: download it, then restore into a **fresh** database (create a new DB and load it with `gunzip -c … | psql -d <new>`, exactly as the drill does). Check row counts (`media`, `batch_items`) before switching.
5. Switch over: rename the databases, or point `DATABASE_URL` at the restored one, then `docker compose up -d`.
6. Run `pnpm --filter @autopilot/db migrate` ([migrations.md](migrations.md)). It applies only what the backup predates.
7. **Before** re-enabling posting, read `batch_items` with status `publishing`/`unknown` and follow [failed-or-unknown-post.md](failed-or-unknown-post.md). A restored older DB may not know about posts that already went out.
