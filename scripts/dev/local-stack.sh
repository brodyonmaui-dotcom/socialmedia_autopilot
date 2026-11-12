#!/usr/bin/env bash
# Local dev stack for cloud/agent sessions: starts the preinstalled Postgres, creates a throwaway dev DB,
# applies migrations and loads demo data. Local only: never points at the server, never reads .env.
# Usage: bash scripts/dev/local-stack.sh   then:  export DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_dev
set -euo pipefail
URL="postgres://ap:ap@localhost:5432/autopilot_dev"   # throwaway local credentials, not a secret
if ! pg_isready -q -h localhost 2>/dev/null; then
  (service postgresql start || pg_ctlcluster "$(ls /usr/lib/postgresql | sort -n | tail -1)" main start) >/dev/null
  for _ in $(seq 1 20); do pg_isready -q -h localhost && break; sleep 0.5; done
fi
su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='ap'\"" | grep -q 1 || su postgres -c "psql -qc \"create user ap with password 'ap' superuser\""
su postgres -c "psql -tAc \"select 1 from pg_database where datname='autopilot_dev'\"" | grep -q 1 || su postgres -c "psql -qc 'create database autopilot_dev owner ap'"
export DATABASE_URL="$URL" DEV_DATABASE_URL="$URL"
pnpm -s --filter @autopilot/db migrate | tail -1
pnpm -s dev:seed | tail -1
echo "local-stack: ok · export DATABASE_URL=$URL"
