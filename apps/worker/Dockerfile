FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @autopilot/worker...
COPY packages/core packages/core
COPY packages/adapters packages/adapters
COPY packages/db packages/db
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
