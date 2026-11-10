#!/usr/bin/env bash
# Run a probe on the VPS inside a throwaway Node container:  ./infra/probe.sh ig [--creator=name]
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm -it -v "$PWD":/app -w /app --env-file .env -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 node:22-alpine \
  sh -c "corepack enable >/dev/null 2>&1 && pnpm install --frozen-lockfile --silent && pnpm -s probe:$*"
