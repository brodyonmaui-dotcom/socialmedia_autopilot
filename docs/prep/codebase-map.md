# Codebase map (prep for Fable run 2)

Snapshot of `origin/main` @ `290d430` (PR #9 merged), surveyed 2026-11-12. Facts only; designs live in `docs/design/F2.md`, `F3.md`, `F7.md`.

## Baseline (main as-is, cloud container, Node 22.23, pnpm 10.28)
| Command | Result |
|---|---|
| `pnpm install` | exit 0 (2.9 s). Warning: "Ignored build scripts: esbuild" (harmless; tsx still works) |
| `pnpm typecheck` | exit 0, no errors |
| `pnpm test` | exit 0: **45 files, 281 tests passed**, 0 skipped (5.8 s) |
| `pnpm simulate-week` | exit 0: `OK 7d×4 slots · 91 posts · published 72 (1 recovered) · retries 22 · failed 4 · unknown 8 · handoff 7 · alerts 12 · 0 double-posts · 0 cap breaches · DST week · fixture zone Europe/London (TZ_CREATOR not set)` |

Nothing is red, so no design doc has a "task 0" fix. CI (`.github/workflows/ci.yml`, the only workflow): PRs + push to main, Node 22, installs ffmpeg, then `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`.

## Layout
| Path | Package | Purpose |
|---|---|---|
| `packages/core` | `@autopilot/core` | Shared types, capability matrix, time/cadence math, scheduler, outbox engine, simulate-week |
| `packages/adapters` | `@autopilot/adapters` | IG / YT / Zernio-TikTok / Snapchat `PlatformAdapter`s, token health, registry |
| `packages/db` | `@autopilot/db` | pg pool, SQL migrations + runner, settings KV, row types |
| `packages/media` | `@autopilot/media` | ffprobe QA, touch-up (metadata strip, loudness), hashing, dedupe |
| `packages/research` | `@autopilot/research` | Creators, idea backlog, hooks, research brief, voice/privacy lint |
| `packages/analytics` | `@autopilot/analytics` | Metrics sources + snapshots, weekly report, trial-share recs, Snapchat daily pick |
| `apps/web` | Next.js App Router + Tailwind, `basePath: "/app"`, `output: standalone` | Phone dashboard (read-mostly today) |
| `apps/worker` | Node + pg-boss | Cron jobs: health, outbox tick, token health |
| `tools/ingest-agent` | | Laptop ingest of clips → `media` rows + R2 (uses `@autopilot/media`) |
| `scripts/` | | Probes, skills CLIs, simulate-week, schedule-batch, seed, night report |
| `infra/` | | docker compose (caddy, web, worker, db, backup), Caddyfile, bootstrap/backup/restore |

Every `src/index.ts` is an `export *` barrel.

## Public API (key exports)
**core**
- `types.ts`: `Platform` :1, `PlatformRoute` :4, `PostStatus` :15 (draft|approved|queued|publishing|published|failed|unknown), `OutboxPost` :24, `PublishResult` :51, `PublishOptions{signal}` :60, `PlatformAdapter{publish, findExisting?}` :66, `AlertKind` :77 (incl. `token-health`), `OutboxAlert` :80, `PostingWindow` :94
- `capabilities.ts:4` `CAPABILITIES`: route / scheduling (IG `server-fires`, YT+TikTok `native`, Snapchat `none`) / commentHandling per platform
- `time.ts`: `localParts`, `localDate`, `localHHMM`, `localToUtc`, `zonedTimeToUtc`, `addCalendarDays`, `diffCalendarDays`, `offsetMinutes`, `hasOffsetChange`, `assertTimeZone` :145
- `cadence.ts`: `CadenceSettings` :27, `DEFAULT_CADENCE` :57, `PLATFORMS` :76, `normalizeCadence` :86, `daySlotTimes` :155, `isWithinAnyWindow[At]` :5/:11
- `scheduler.ts`: `assignSlots(input): ScheduleResult` :106 (unplaced reasons cap/no-slot/buffer/duplicate/pinned-*), `findCapBreaches` :74; `catchup.ts:20` `generateCatchUpSlots`
- `outbox/engine.ts`: `runOutboxTick(store, adapters, cfg): TickResult` :100, `isDueNow` :86, `OutboxStore`, `EngineConfig`
- `outbox/policy.ts`: `DEFAULT_RETRY_POLICY` :21 (4 attempts, 5→15→45 min capped 60, publish timeout 5 min, lookup 60 s), `backoffMs` :31, `classifyFailure` :58, `decideAfterAttempt` :82, `NonRetryableError`, `PublishTimeoutError`, `DUE_STATUSES=["approved","queued"]` :96
- Not exported: `sim/simulate-week.ts`, `testing/fakes.ts` (fake adapters/store for tests)

**adapters**
- `http.ts`: `FetchLike` :4, `PlatformRequestError` :7, `getJson` :29, `assertNoLocationFields` :43, `countHashtags` :57, `redactToken` :61
- `createInstagramAdapter` instagram.ts:55 (container → poll → publish; trial refusal `IG_TRIAL_REFUSED` :33 → plain reel + `trialFellBack`; `findExisting` :128 = last 25 media, exact trimmed caption, ±36 h)
- `createYouTubeAdapter` youtube.ts:40 (`refreshAccessToken` :13; private + `publishAt`; resumable upload; **no `findExisting`**)
- `createTikTokAdapter` tiktok.ts:37 (Zernio `POST /posts`, `Idempotency-Key` header :74, `draft:true` when `tiktokDraft`; **no `findExisting`**)
- `createSnapchatAdapter` / `buildSnapchatHandoff` / `snapchatCaption` / `SNAPCHAT_CHECKLIST` (snapchat.ts; `publish` always throws NonRetryable; never registered)
- `token-health.ts`: `checkMetaToken` :48, `checkYouTubeToken` :87, `checkZernioAccount` :100, `checkTokenHealth` :115, `formatTokenHealth` :134
- `registry.ts`: `buildAdapters(creds)` :15 (only platforms with creds; drops scheduling `none`), `credentialsFromEnv(env)` :27

**db**: `createPool` client.ts:3, `migrate(pool, dir)` migrate.ts:13, `getSetting<T>` / `setSetting` settings.ts:6/:11; row types `MediaRow`, `BatchRow`, `BatchItemRow`, `AlertRow`, `BatchStatus`, `AlertKind` (types.ts; **lacks `token-health`**, unlike core).

**media**: `probe` probe.ts:31, `findLocationTagKeys` probe.ts:23, `runQa` qa.ts:19, `touchUp` touchup.ts:13 (always `-map_metadata -1 -map_chapters -1`), `sha256File`, `findDuplicateSets`, `run`, ffmpeg log parsers.

**research**: `PILLARS`, `IDEA_STAGES`, `Creator`/`Idea`/`Hook`; `moveIdea`, `allowedMoves`, `stageCounts`, `filmNext` (backlog.ts); `buildResearchBrief`, `classifyHook`, `firstLine` (brief.ts); `fetchCreatorSnapshot` discovery.ts:76; store CRUD store.ts:130-191 with `assertNoPlace` :29; `lintText(input): LintResult` voice-lint.ts:71, `HASHTAG_LIMITS` :34, `YOUTUBE_TITLE_MAX=60` :40, `blocklistFromEnv` :127.

**analytics**: `ingestOnce` ingest.ts:55, `SNAPSHOT_AGES_H=[24,72,168,672]`, `createInstagramMetricsSource` / `createYouTubeMetricsSource` / `createZernioTikTokMetricsSource` (sources.ts), `buildWeeklyReport` report.ts:92, `recommendTrialShares` trials.ts:37, `pickSnapchatDaily` snapchat.ts:40, `loadPostRecords` / `loadPublishedForIngest` / `writeSnapshot` (store.ts), `syntheticPosts` seed.ts:21.

## DB schema (`packages/db/migrations`, runner `pnpm --filter @autopilot/db migrate`)
| Migration | Tables / changes |
|---|---|
| `0001_init.sql` | `pgcrypto`. `media(id uuid PK, content_hash UNIQUE, source_path, r2_key, duration_s, width, height, pillar, status default 'ingested', qa jsonb, captured_at)`. `batches(id, week_start date, status default 'draft')`. `batch_items(id, batch_id→batches CASCADE, media_id→media, platform, caption, title, trial jsonb, scheduled_for, idempotency_key uuid UNIQUE default gen_random_uuid(), status default 'draft', attempts, last_error, platform_post_id, platform_post_url)`, index `(status, scheduled_for)` |
| `0002_settings.sql` | `settings(key PK, value jsonb, updated_at)`; seeds `posting_windows` |
| `0003_research.sql` | `creators` (unique `(platform, handle)`), `ideas` (CHECK stage idea/scripted/filmed/posted/dropped; FKs creator/media SET NULL; `batch_item_ids uuid[]`), `hooks` (CHECK source own/creator) |
| `0004_analytics.sql` | `post_metrics(batch_item_id→batch_items CASCADE, age_hours, metrics jsonb, UNIQUE(batch_item_id, age_hours))` |
| `0005_outbox.sql` | `batch_items.next_attempt_at` + index `(status, next_attempt_at)`; `alerts(id, kind, batch_item_id→batch_items CASCADE, platform, message, created_at, acknowledged_at, UNIQUE(kind, batch_item_id))` + partial open index; seeds `settings.cadence='{}'` |

Notes: status enums on `media`, `batches`, `batch_items`, `alerts.kind` are **comments only** (no CHECK). `tiktokDraft` lives inside `batch_items.trial` jsonb (worker outbox.ts:42,89); there is no column. Runner: `schema_migrations`, one transaction per file, no down-migrations, nothing auto-migrates (`docs/runbooks/migrations.md`). Next free number: **0006**.

## Outbox (F1) in one paragraph
Worker cron `* * * * *` → `runOutboxOnce` (apps/worker/src/jobs/outbox.ts:186) → `runOutboxTick` (core engine.ts:100) over `PgOutboxStore` (outbox.ts:66). Picks `batch_items.status in ('approved','queued')` with due backoff (outbox.ts:94-101); **does not look at `batches.status`**. Stale `publishing` rows (> publish timeout) get `findExisting` → published (recovered) or `unknown` + alert (engine.ts:115-136). Native platforms hand off up to `nativeLeadMs` (24 h) early (engine.ts:92). Daily cap via `countSentOn` per creator-local day (outbox.ts:148). Dry-run logs "would publish" and writes nothing (engine.ts:162). Atomic `claim` (outbox.ts:108). Retry with `attempts>0` calls `findExisting` first (engine.ts:174-191). Timeout → `unknown`, never auto-retried (policy.ts:90). Alerts deduped by `UNIQUE(kind, batch_item_id)`. `mediaUrl = PUBLIC_MEDIA_BASE + "/" + (r2_key ?? "")` (outbox.ts:77).

## Worker jobs (`apps/worker`)
| Queue (queue.ts) | Cron | File | Does |
|---|---|---|---|
| `health-check` | `*/5 * * * *` | jobs/health.ts | logs `[health] ok` |
| `outbox-tick` | `* * * * *` | jobs/register-outbox.ts → outbox.ts | outbox tick (above) |
| `token-health` | `17 6 * * *` | jobs/token-health.ts | read-only token checks → replaces open `token-health` alert per service |

Startup (index.ts): loads `.env` outside production, exits without `DATABASE_URL`, `dryRun = DRY_RUN !== "false"` (:25), exits on a live run without `TZ_CREATOR` (:28-32). **No `--live` flag in the worker**: only probes enforce the two-key rule (`scripts/probes/lib.ts:15`). Not wired yet: analytics ingest, comment polling, PWA push.

## Web routes (all under `/app`, `dynamic = "force-dynamic"` where DB is read)
| Route | File | Purpose |
|---|---|---|
| `/` | app/page.tsx | Static skeleton, links + `CAPABILITIES` list (no DB) |
| `/library` | app/library/page.tsx (+ file-status.ts) | `media` list (≤500), QA, missing-file badge |
| `/touch-up` | app/touch-up/page.tsx | `ready` media with QA warnings |
| `/research`, `/research/{creators,hooks,ideas}` | app/research/** | Backlog overview, creators CRUD, hook bank + lint, idea kanban |
| `/analytics` | app/analytics/page.tsx | Weekly report (`?week=`, `?demo=1`), uses `TZ_CREATOR` |

Server actions: only `app/research/actions.ts` (`addCreatorAction` :37, `toggleCreatorAction` :54, `addIdeaAction` :58, `moveIdeaAction` :68, `addHookAction` :89), each wrapped in `run(path, fn)` → revalidate / redirect `?error=`. DB access: `lib/db.ts` `getPool()` singleton (direct pg). **No batch, approval, alerts or inbox pages exist.** PWA: `public/manifest.json` (scope `/app`, `icons: []`), no service worker.

## Scripts
| Script | Purpose / flags |
|---|---|
| `scripts/simulate-week.ts` | `[--tz] [--week] [--days 7] [--slots 4]`; fakes only; exit 1 on double-post or cap breach; log `logs/simulate-week.json` |
| `scripts/schedule-batch.ts` | `<draft.json> [--write] [--week] [--no-db]`; fills `scheduledFor` in the **draft file**; reads cadence + existing items if DB; never writes DB or approves |
| `scripts/schedule-catchup.mjs` | one-off backlog scheduler; `--create` inserts a draft batch; **`--approve <batchId>` (:44-46) is the only approval write path today** |
| `scripts/dev/seed.ts` | demo rows for a LOCAL DB only (`assertLocalDatabaseUrl`); inserts an `approved` batch (:48) |
| `scripts/skills/weekly-batch.ts` | `check` / `review [--force]` / `create` a draft JSON (`lib/batch-draft.ts`: `BatchDraft{weekStart, items[{mediaId, pillar, label?, posts{platform: {caption, title?, scheduledFor?, tiktokDraft?}}}]}`; `createDraftBatch` :118 inserts `batches` + `batch_items` as `draft` in one transaction) |
| `scripts/skills/{research-brief,weekly-report,platform-check}.ts` | skill CLIs (read-only; research-brief may call IG Business Discovery) |
| `scripts/probes/{ig,yt,zernio,anthropic,connect-meta}.ts` | M0 probes; live only with `--live` + `DRY_RUN=false`; `anthropic.ts` = triage smoke test (buckets `simple_positive|negative|hide_flag|flag`, :14) |
| `scripts/check-exposure.sh` | `DOMAIN=… sh`: status codes for public vs `/app*` paths |
| `scripts/find-duplicates.mjs`, `scripts/night/report.mjs` | duplicate report (never moves); night HTML report |

## Tests
Vitest defaults (no root config). 45 files / 281 tests. Per area (it/test count): core 61, analytics 44, research 37, adapters 28, scripts 27, tools/ingest-agent 23, media 21 (4 need real ffmpeg), worker 19, web 6 (file-status only), db 4. Tests sit in `src/__tests__/` (fixtures under `__tests__/fixtures/`). No web component/route tests, no DB integration tests (stores are tested with fakes).

## Config / env (names only; values live in `.env`, never in git)
- web: `DATABASE_URL`, `NODE_ENV`, `TZ_CREATOR` (analytics)
- worker: `DATABASE_URL`, `DRY_RUN`, `NODE_ENV`, `PUBLIC_MEDIA_BASE`, `TZ_CREATOR`; token health + registry: `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_GRAPH_VERSION`, `IG_USER_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YT_REFRESH_TOKEN`, `ZERNIO_API_KEY`, `ZERNIO_TIKTOK_ACCOUNT_ID`
- research lint: `PRIVACY_BLOCKLIST` (**missing from `.env.example`**)
- probes: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DRY_RUN`, plus the platform names above
- ingest: `INGEST_ROOTS`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA`; backups: `R2_BUCKET_BACKUPS`, `POSTGRES_PASSWORD`
- seed: `DEV_DATABASE_URL`; infra: `DOMAIN`, `DASH_USER`, `DASH_HASH`; find-duplicates: `USERPROFILE`
- Compose passes `env_file: ../.env` to web, worker, backup.

## Auth today
- **Caddy basic auth** on `handle /app*` (`infra/Caddyfile`, `{$DASH_USER} {$DASH_HASH}` bcrypt) → `reverse_proxy web:3000`. Since `basePath` is `/app`, every page, asset and server action is behind it. Fails closed (unset → 401). Public: `/` (static), `/privacy*`, `/terms*`, `/snap-test*`, `/healthz`; everything else 404. Headers: HSTS, nosniff, Referrer-Policy.
- Runbook: `docs/runbooks/dashboard-password.md` (creator generates the hash on the VPS; `docker compose up -d caddy` to apply). It calls the gate a stopgap until passkey login.
- **Inside the app: no auth at all** (no `middleware.ts`, no session). The worker has no HTTP surface.

## Known stubs and TODOs
- `apps/web/app/research/actions.ts:18`: `TODO(F2)` every server action must check the session once login lands
- `apps/web/app/page.tsx:11`: skeleton; login, weekly batch and approval UI "land later"
- `scripts/skills/lib/batch-draft.ts:73-76`: `tiktokDraft` is rejected as an error ("no column yet"), although the worker already reads `trial.tiktokDraft` (outbox.ts:42,89) and the TikTok adapter supports drafts → reconcile in F2
- `apps/worker/src/jobs/outbox.ts:175`: alerts go to console + table only; "PWA push arrives with F4" (not done)
- `apps/worker/src/jobs/health.ts:4`: placeholder health job
- `packages/analytics/src/ingest.ts:105-112`: `createUnverifiedSource()` throws "metrics source not implemented" (Snapchat)
- analytics ingest job is not registered in the worker; Business Discovery and metrics parsers are unrun live
- YouTube and TikTok adapters have no `findExisting` (documented gap; runbook `failed-or-unknown-post.md`)
- `packages/db/src/types.ts` `AlertKind` lacks `token-health` (core has it)
- `public/manifest.json`: `icons: []`, no service worker
