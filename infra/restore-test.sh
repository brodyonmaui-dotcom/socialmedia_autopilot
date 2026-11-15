#!/bin/sh
# Restore drill: pulls the newest R2 backup into a throwaway database and counts tables. Never touches
# the live DB's data; on success it records settings.restore_drill_at (ISO, UTC) so ./infra/preflight.sh
# can see a drill happened (F13 OQ2). The script goes in on stdin (quoted heredoc) so SQL quotes stay plain.
set -eu
cd "$(dirname "$0")"
docker compose exec -T backup sh -s <<'DRILL'
set -eu
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
ep="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
key=$(aws s3 ls "s3://$R2_BUCKET_BACKUPS/db/" --endpoint-url "$ep" | sort | tail -1 | awk '{print $4}')
aws s3 cp "s3://$R2_BUCKET_BACKUPS/db/$key" /tmp/r.sql.gz --endpoint-url "$ep" --only-show-errors
psql -q -d postgres -c "DROP DATABASE IF EXISTS restore_drill" -c "CREATE DATABASE restore_drill"
gunzip -c /tmp/r.sql.gz | psql -q -d restore_drill >/dev/null
n=$(psql -tA -d restore_drill -c "select count(*) from information_schema.tables where table_schema = 'public'")
psql -q -d postgres -c "DROP DATABASE restore_drill"
rm -f /tmp/r.sql.gz
[ "$n" -gt 0 ] || { echo "restore FAIL $key tables=0 (drill not recorded)"; exit 1; }
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
psql -q -v ON_ERROR_STOP=1 -c "insert into settings (key, value, updated_at) values ('restore_drill_at', to_jsonb('$now'::text), now()) on conflict (key) do update set value = excluded.value, updated_at = now()"
echo "restore ok $key tables=$n"
DRILL
