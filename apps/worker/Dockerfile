FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @autopilot/worker...
COPY packages/core packages/core
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
