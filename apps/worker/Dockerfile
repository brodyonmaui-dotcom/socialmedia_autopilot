FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# Every workspace package the app imports, directly or through another package (F8 review: engagement/analytics/research/adapters were missing).
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/research/package.json packages/research/package.json
COPY packages/engagement/package.json packages/engagement/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/analytics/package.json packages/analytics/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @autopilot/worker...
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/research packages/research
COPY packages/engagement packages/engagement
COPY packages/adapters packages/adapters
COPY packages/analytics packages/analytics
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
