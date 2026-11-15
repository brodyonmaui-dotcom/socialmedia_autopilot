#!/bin/sh
# Go-live preflight on the VPS (F13 T1):  ./infra/preflight.sh [--audit]
# Read-only. Gathers what the script can't see from a throwaway container, inside the compose stack:
#   - DB facts: ONE read-only psql statement (same text as PREFLIGHT_SQL in scripts/lib/preflight.ts)
#   - the newest backup object key, via the backup container's aws-cli (like restore-test.sh)
#   - the tracked file list (git on the host)
# then runs `pnpm preflight` in a throwaway Node container with the compose .env (like probe.sh).
# Prints only the script's PASS/WARN/FAIL lines; never echoes an env value. Exit 1 iff any FAIL.
set -eu
cd "$(dirname "$0")"

SQL="select json_build_object('migrations', (select coalesce(json_agg(id order by id), '[]'::json) from schema_migrations), 'passkeys', (select count(*) from auth_credentials where revoked_at is null), 'settings', (select coalesce(json_object_agg(key, value), '{}'::json) from settings where key in ('cadence', 'posting_windows', 'restore_drill_at'))) as facts"

# DB unreachable (or any psql error) -> null; the script turns that into FAIL lines.
db=$(docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' db \
  psql -U autopilot -d autopilot -tAq -v ON_ERROR_STOP=1 -c "$SQL" 2>/dev/null) || db=""
[ -n "$db" ] || db=null

# Newest backup key only (no bucket name, no endpoint). Anything unexpected -> unknown (WARN).
key=$(docker compose exec -T backup sh -c '
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
  aws s3 ls "s3://$R2_BUCKET_BACKUPS/db/" --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" | sort | tail -1 | awk "{print \$4}"
' 2>/dev/null) || key=""
case "$key" in
  autopilot-*.sql.gz) key="\"$key\"" ;;
  *) key=null ;;
esac

cd ..
mkdir -p logs
printf '{"db":%s,"backupKey":%s}\n' "$db" "$key" > logs/preflight-facts.json
# No git on the host -> no list -> the secrets-git check WARNs instead of passing on an empty list.
git ls-files > logs/preflight-tracked.txt 2>/dev/null || rm -f logs/preflight-tracked.txt

set +e
docker run --rm -v "$PWD":/app -w /app --env-file .env -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 node:22-alpine \
  sh -c "corepack enable >/dev/null 2>&1 && pnpm install --frozen-lockfile --silent && pnpm -s preflight --facts logs/preflight-facts.json --tracked logs/preflight-tracked.txt $*"
code=$?
rm -f logs/preflight-facts.json logs/preflight-tracked.txt
exit $code
