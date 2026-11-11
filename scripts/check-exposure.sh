#!/bin/sh
# Read-only exposure check: prints ONLY path + HTTP status codes (never the domain).
# Usage: DOMAIN=<your domain> sh scripts/check-exposure.sh    (or put DOMAIN in .env)
# Expect: / /healthz /privacy /terms 200; /app* 401 once the dashboard gate is deployed.
set -eu
if [ -z "${DOMAIN:-}" ] && [ -f .env ]; then
  DOMAIN=$(node -e "process.loadEnvFile('.env');process.stdout.write(process.env.DOMAIN||'')")
fi
[ -n "${DOMAIN:-}" ] || { echo "check-exposure: DOMAIN not set"; exit 1; }
for p in / /healthz /privacy /terms /app /app/library /app/research /app/analytics /app/touch-up; do
  code=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "https://$DOMAIN$p" || echo "ERR")
  echo "$p $code"
done
