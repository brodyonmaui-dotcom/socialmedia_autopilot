# Dockerfiles

Files: `apps/worker/Dockerfile:1-22`, `apps/web/Dockerfile:1-30`, `infra/docker-compose.yml:19-33` (web and worker services)

## What it does
- Worker image: installs `@autopilot/worker...` after copying manifests (worker Dockerfile:4-13), copies source for six packages plus apps/worker (:14-20), runs `pnpm start` in apps/worker (:21-22).
- Web image: build stage with the same six packages and apps/web, runs `pnpm build` (web Dockerfile:1-22); runtime stage copies standalone, static and public, runs `node server.js` (:24-30).
- Compose: web and worker build with context `..` and their own Dockerfile, `env_file: ../.env`, wait for db healthy (compose:19-33).
- Dependencies: apps/worker and apps/web both depend on adapters, analytics, core, db, engagement, research (worker package.json:13-18; web :11-16). Both Dockerfiles copy exactly those six. Transitive deps (adapters→engagement, analytics→research, engagement→research) are also copied. packages/media is not depended on and not copied.
- pnpm-workspace.yaml globs `tools/*`; neither Dockerfile copies tools/.

## SQL (verbatim)
none. COPY lines quoted instead, source copies (same in both Dockerfiles, lines 14-20):
```
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/research packages/research
COPY packages/engagement packages/engagement
COPY packages/adapters packages/adapters
COPY packages/analytics packages/analytics
COPY apps/worker apps/worker        (worker Dockerfile:20)
COPY apps/web apps/web              (web Dockerfile:20)
```

## Branches that write or send
- none (Dockerfiles and compose contain no runtime branches).

## Attack surface (from the brief)
> they must copy core, db, research, engagement, adapters, analytics packages (list which packages each Dockerfile copies, and compare to each app's package.json workspace deps); verified only by a scratch-dir install; the creator's first `docker compose up -d --build` is the real test.
- Copies core, db, research, engagement, adapters, analytics: yes in both (worker :14-19, web :14-19), manifests :6-11 in both.
- Compared to package.json deps: match (see What it does).
- Verified by scratch-dir install: no test found that builds either Dockerfile (grep for Dockerfile/docker build finds only compose and docs).
- First `docker compose up -d --build`: not run in this pass.

## Findings
_(red-team pass fills this)_
