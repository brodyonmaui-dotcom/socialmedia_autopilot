#!/bin/sh
# Restore drill: pulls the newest R2 backup into a throwaway database and counts tables. Never touches the live DB.
set -eu
cd "$(dirname "$0")"
docker compose exec -T backup sh -c '
  set -eu
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
  ep="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
  key=$(aws s3 ls "s3://$R2_BUCKET_BACKUPS/db/" --endpoint-url "$ep" | sort | tail -1 | awk "{print \$4}")
  aws s3 cp "s3://$R2_BUCKET_BACKUPS/db/$key" /tmp/r.sql.gz --endpoint-url "$ep" --only-show-errors
  psql -q -d postgres -c "DROP DATABASE IF EXISTS restore_drill" -c "CREATE DATABASE restore_drill"
  gunzip -c /tmp/r.sql.gz | psql -q -d restore_drill >/dev/null
  n=$(psql -tA -d restore_drill -c "select count(*) from information_schema.tables where table_schema=\x27public\x27")
  psql -q -d postgres -c "DROP DATABASE restore_drill"
  echo "restore ok $key tables=$n"
'
