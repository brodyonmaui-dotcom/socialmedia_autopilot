#!/bin/sh
# Nightly: pg_dump → gzip → R2 (S3 API). Keeps 30 daily copies via R2 lifecycle rule. One-line summary.
set -eu
ts=$(date -u +%Y%m%dT%H%M%SZ)
f=/tmp/autopilot-$ts.sql.gz
pg_dump --no-owner --format=plain | gzip -9 > "$f"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
  aws s3 cp "$f" "s3://$R2_BUCKET_BACKUPS/db/autopilot-$ts.sql.gz" \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" --only-show-errors
echo "backup ok $ts $(du -h "$f" | cut -f1)"
rm -f "$f"
