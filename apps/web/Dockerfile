FROM node:22-alpine AS build
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
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @autopilot/web...
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/research packages/research
COPY packages/engagement packages/engagement
COPY packages/adapters packages/adapters
COPY packages/analytics packages/analytics
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
CMD ["node", "server.js"]
