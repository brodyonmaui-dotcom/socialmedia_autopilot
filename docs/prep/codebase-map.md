# Codebase map (prep for Fable run 3)

Snapshot of branch `prep/run-3-2026-11-13` @ `e3b1370` (= `main` @ `b455456` + run-3 decisions, F9 T1 probe lines, F10 Snapchat handoff, F11 draft), surveyed 2026-11-13 by Haiku scouts and checked by the prep lead. Facts only; designs live in `docs/design/F8|F9|F10|F11.md`. F8/F9 work added later on this branch is listed in `docs/fable-week.json` notes. Line numbers drift: re-grep before citing.

## Baseline (cloud container, Node 22.23, pnpm 10.28)
| Command | Result |
|---|---|
| `pnpm install` | exit 0 (about 3 s). "Ignored build scripts: esbuild" is harmless |
| `pnpm typecheck` | exit 0 (root `tsconfig.json` + `apps/web/tsconfig.json`) |
| `pnpm test` with `DATABASE_URL` set | exit 0: **100 files, 940 tests passed** |
| `pnpm test` without `DATABASE_URL` | DB tests (`*.db.test.ts`) skip; everything else passes |
| `pnpm simulate-week` | `OK 7d×4 slots · 91 posts · published 70 (3 recovered) · retries 24 · failed 4 · unknown 10 · handoff 7 · alerts 14 · yt-503 2 · ig-normalised 2 · 0 double-posts · 0 cap breaches · DST week · fixture zone Europe/London` |
| `pnpm simulate-engagement` | shadow and live-fake both `OK` (200 comments, 0 double-replies, 0 limit breaches, 0 location leaks; the live-fake run trips the kill switch as designed) |
| `node scripts/check-public-leaks.mjs` | `ok (72 files)` |
| `cd apps/web && pnpm build` | exit 0 |

Local tools: `bash scripts/dev/local-stack.sh` (Postgres 16, `autopilot_dev`, all migrations, demo seed), `pnpm dev:session` (prints an `ap_session=` cookie for a local DB only), `node scripts/dev/phone-shot.mjs <path> <out.png> [--port 3100] [--full] [--cookie …]`.

## Layout
| Path | Package | Purpose |
|---|---|---|
| `packages/core` | `@autopilot/core` | Types, capability matrix, time/cadence, scheduler, outbox engine, log sanitiser, simulate-week |
| `packages/adapters` | `@autopilot/adapters` | IG / YT / Zernio-TikTok / Snapchat adapters, token health, registry, comment + DM sources |
| `packages/db` | `@autopilot/db` | pg pool, SQL migrations + runner, settings KV, row types, auth admin |
| `packages/media` | `@autopilot/media` | ffprobe QA, metadata strip, location-tag detection, hashing/dedupe |
| `packages/research` | `@autopilot/research` | Creators, ideas, hooks, research brief, voice/privacy lint, Business Discovery |
| `packages/analytics` | `@autopilot/analytics` | Metric sources, snapshots, weekly report, trial-share recs, Snapchat daily pick |
| `packages/engagement` | `@autopilot/engagement` | Comment rules, triage, reply rotation, planner, send gate/tick, kill switch, DM drafts |
| `apps/web` | Next.js 15 App Router + Tailwind 4, `basePath: "/app"`, `output: "standalone"` | Phone dashboard |
| `apps/worker` | Node + pg-boss | Cron jobs (outbox, token health, engagement) |
| `tools/ingest-agent` | | Laptop ingest: scans `INGEST_ROOTS`, uploads clean files to R2, writes `media` rows |
| `scripts/`, `infra/` | | Probes, skill CLIs, simulations, dev tools, night report; docker compose, Caddyfile, backup |

Every package `src/index.ts` is an `export *` barrel.

## packages/core
- `types.ts`: `Platform` (instagram|youtube|tiktok|snapchat), `PostStatus` (draft|approved|queued|publishing|published|failed|unknown), `OutboxPost` (incl. `idempotencyKey`), `PublishResult`, `PlatformAdapter {publish, findExisting?}`, `AlertKind` (final-failure, unknown-outcome, cap-breach, duplicate, token-health, auth, engagement-kill, engagement-failure, engagement-unknown, engagement-mode), `OutboxAlert`.
- `capabilities.ts`: `CAPABILITIES`: IG direct/server-fires, YT direct/native, TikTok middleman/native, Snapchat assisted/none.
- `outbox/policy.ts`: `DEFAULT_RETRY_POLICY` (4 attempts, backoff 5 min ×3, cap 60 min, publish timeout 5 min, lookup timeout 60 s), `classifyFailure` (timeout|rejected|permanent), `decideAfterAttempt`, `NonRetryableError`, `PublishTimeoutError`.
- `outbox/engine.ts`: `runOutboxTick(store, cfg)`. Order: stale `publishing` rows → `findExisting` → published or `unknown` + alert; due rows → daily-cap check (`cap-breach`) → claim → if `attempts > 0`, `findExisting` first → `captionGuard` (refusal = permanent failure, throwing guard fails closed) → publish under timeout. Timeout/network errors → `unknown` (never retried); rejections → backoff, `failed` after max attempts. Dry run: no writes, no adapter calls. Adapters missing (Snapchat) → skipped.
- `log/sanitize.ts`: `sanitizeForLog`, `sanitizeError` (bearer/basic, key=value secrets, EAA/ya29/sk-ant/sk_ token shapes, long hex/base64; truncates errors to 300).
- `scheduler.ts` `assignSlots`, `findCapBreaches`; `cadence.ts` `DEFAULT_CADENCE` (4 windows, 4 slots/day, caps IG/YT/TikTok 4 and Snapchat 1, stagger YT +1 slot, TikTok +1 day, Snapchat +2 days, 30-min gap); `catchup.ts`; `time.ts` (`localDate`, `localToUtc`, `zonedTimeToUtc`, `addCalendarDays`, `assertTimeZone`, …, all DST-safe).
- `sim/simulate-week.ts` (not exported), `testing/fakes.ts` (FakeClock, FakePlatform, MemoryOutboxStore).
- Tests: 11 files.

## packages/adapters
- `http.ts`: `PlatformRequestError`, `UploadAmbiguousError` (classified as timeout → `unknown`), `getJson`, `assertNoLocationFields` (`LOCATION_FIELDS`: location_id, location, recordingDetails, locationDescription, locationTags, place/placeId, geo, geolocation, coordinates, latitude/longitude/lat/lng/lon, gps, poi_id, venue; nested, case-insensitive).
- `instagram.ts`: container → poll (1/min, max 5) → publish; trial fallback; ≤5 hashtags. `findExisting`: normalised caption match on the last 25 media within ±36 h of `scheduled_for`.
- `youtube.ts`: resumable upload, private + `publishAt`; no `findExisting`; upload failures after start → `UploadAmbiguousError`.
- `tiktok.ts`: Zernio `POST /posts` with `Idempotency-Key = idempotencyKey`, `scheduledFor`, `draft` for sound-dependent posts; permanent Zernio errors → `NonRetryableError`; no `findExisting`.
- `snapchat.ts`: `publish` always throws; `SNAPCHAT_CHECKLIST`, `snapchatCaption`, `buildSnapchatHandoff`. Not registered.
- `registry.ts` (`buildAdapters`, `credentialsFromEnv`), `token-health.ts` (`checkTokenHealth`; services meta|youtube|zernio; warn at 7 days).
- `comments/`: IG list/reply/hide; YouTube read-only, reply/hide only when `YT_COMMENT_REPLIES=1`; TikTok stub; IG DM read-only (`dm-instagram.ts`).
- Tests: 10 files + JSON fixtures.

## packages/db: migrations (`packages/db/migrations`, runner `pnpm --filter @autopilot/db migrate`)
| File | Adds |
|---|---|
| 0001_init | `media` (content_hash unique, r2_key), `batches`, `batch_items` (idempotency_key `uuid default gen_random_uuid()` unique, status, attempts, last_error, platform_post_id/url) |
| 0002_settings | `settings` KV, seeds `posting_windows` |
| 0003_research | `creators`, `ideas` (stage CHECK), `hooks` |
| 0004_analytics | `post_metrics` unique(batch_item_id, age_hours) |
| 0005_outbox | `batch_items.next_attempt_at`, `alerts` (kind, batch_item_id, platform, message, acknowledged_at, unique(kind, batch_item_id)), seeds `cadence` |
| 0006_auth_approval | auth tables (credentials, sessions, challenges, enroll codes, failures), `approved_at`/`approved_session`, nullable `scheduled_for`, `batch_item_events`, status CHECK (draft…rejected), backfill |
| 0007_engagement | comments, triage, engagement_actions, cursors, blocklist, DM threads/messages/drafts, seeds `engagement` |

Next free number: **0008** (F8). Row types in `src/types.ts`: `AlertRow.platform` is typed `Platform`, but rows also hold `web`, `meta`, `youtube`, `zernio` (F8 T1 widens it). `BatchItemStatus = PostStatus | "rejected"`. Settings: `getSetting`/`setSetting`, `loadCadence`. Tests: 4 files.

## packages/analytics, research, media, engagement
- **analytics:** `sources.ts` IG (insights per metric + like/comments counts), YouTube (`videos?part=statistics`), Zernio TikTok; shapes from docs, **not yet verified against live responses** (F9 T1 probe lines exist; output pending). `ingest.ts` `ingestOnce`, `SNAPSHOT_AGES_H = [24, 72, 168, 672]`, Snapchat source throws. `store.ts` `loadPostRecords`, `loadPublishedForIngest`, `writeSnapshot` (on conflict do nothing). `report.ts` weekly report; `trials.ts`; `snapchat.ts` `pickSnapchatDaily`. No worker job runs ingest on `main` (F9 T4). 5 test files.
- **research:** `lintText` privacy rules (always error): `privacy.realtime|place|coords|pin|postcode|address|blocklist`; market-session allowlist (`stripMarketTerms`) runs first; tone/number/hashtag rules; `blocklistFromEnv` (`PRIVACY_BLOCKLIST`). Store for creators/ideas/hooks; Business Discovery wired into the research-brief skill, not run live. 5 test files.
- **media:** `probe`, `findLocationTagKeys`, `runQa`, `touchUp` (always strips metadata), `sha256File`, `findDuplicateSets`. 5 test files.
- **engagement:** pre/post rules, pools + rotation, planner (7-day per person, 10-min veto), Anthropic + fake triage, DM drafts (no send path), `sendGate`, `runSendTick` (stale sending → unknown, pre-flight, cancel if the creator replied), kill switch (`ENGAGEMENT_KILL`, 3 failures or kill pattern), defaults: IG/YT shadow, TikTok off, 10/h and 40/day per platform, 80/day global. 14 test files.

## apps/worker
- `src/index.ts` starts pg-boss; `run-mode.ts` `resolveRunMode`: live only when `DRY_RUN=false` **and** (`--live` or `WORKER_LIVE=1`); live mode also needs `TZ_CREATOR`.
- Jobs (`src/queue.ts`): `health-check` `*/5`, `outbox-tick` every minute (`PgOutboxStore`, `jobs/outbox.ts`), `token-health` `17 6 * * *` (one `token-health` alert per service), `engagement-poll` `*/5`, `engagement-triage` and `engagement-send` every minute (`PgEngagementStore`), `dm-poll` `*/5` (skips unless `dmPollVerified`).
- CLI `src/cli/auth.ts`: `auth:enroll`, `auth:revoke-all`.

## apps/web
Middleware (`middleware.ts`) checks only the `ap_session` cookie shape; every DB page, action and route calls `requireSession()` (redirects to `/login`). Static guard test `lib/auth/__tests__/guarded-pages.test.ts`: any `route.ts` or file using `getPool` must call `requireSession()`; in `actions.ts`/`route.ts` the first `await` of every exported async function is `requireSession()`; route handlers must be `export async function`. Exempt: `app/login/{page,actions}.ts`.

| URL (under `/app`) | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Home: capabilities, alerts count, "Snapchat · N to share today" |
| `/login` | `app/login/page.tsx` + `actions.ts` | Passkey register/login/logout (server actions, no API routes) |
| `/batches`, `/batches/[id]` | `app/batches/**` | Batch list; week grid, chips, approve bar/confirm sheet, per-item approve/reject/pull back/edit, fill times, add item |
| `/inbox`, `/inbox/dms` | `app/inbox/**` | Flagged/shadow/sent comments, kill switch, modes; DM threads + drafts |
| `/handoff` | `app/handoff/page.tsx` | Snapchat items due today + missed; caption copy, checklist, privacy blocks; Prepare → Share; Mark posted / Skip today / Drop; read-only daily pick when nothing is due |
| `/handoff/media/[itemId]` | `app/handoff/media/[itemId]/route.ts` → `lib/handoff/media.ts` | Session-guarded same-origin proxy of the clean file (`video/mp4`, `private, no-store`; 503 without media base or zone, 404 unless due+approved+snapchat+r2_key, 502 fixed body) |
| `/library`, `/touch-up` | | Media list + QA; touch-up queue |
| `/research/*`, `/analytics` | | Research backlog/creators/ideas/hooks; weekly report |

- Actions: `batches/[id]/actions.ts` (approve, approveAll, reject, unapprove, edit, fillTimes, addItem); `inbox/actions.ts` (markHandled, blockAuthor, sendManual, promoteShadow, setKill, setMode, copyDraft); `handoff/actions.ts` (markPosted, skip, drop); `research/actions.ts`; `login/actions.ts`.
- `lib/auth`: sessions 30-day sliding / 90-day cap, WebAuthn (max 5 credentials), rate limit (10 failures / 15 min), `writeAuthAlert` (kind `auth`, platform `web`).
- `lib/batches`: `planTransition` (approve | approve-all | reject | unapprove | edit; every handed-off row is refused, so nothing resets `failed`/`unknown`: F11), `computeWarnings`, view model, `PgBatchStore` (conditional updates, `batch_item_events`).
- `lib/handoff`: `handoffContext` (no UTC fallback), `listHandoff`, `loadShareable`, `markPosted` (conditional, link kept only for https `*.snapchat.com`), `skipToNextDay` (advisory lock + `for update`, 1/day, rolls forward from today), `dropItem` (F2 reject semantics); events `snap-posted|snap-skip|snap-drop`.
- PWA: `public/manifest.json` with `icons: []`; no service worker on `main` (F8).
- Tests: 26 files (auth 10, batches 6, handoff 5 + 1 UI, engagement 1, actions 2, library 1).
- Runtime deps: next ^15.1, react ^19, pg ^8.13, `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0, workspace packages.

## Scripts
- Root `package.json`: `probe:ig|yt|tiktok|ai|connect-meta`, `skill:*`, `typecheck`, `test`, `auth:enroll|revoke-all`, `dev:seed`, `dev:session`, `simulate-week`, `simulate-engagement`, `schedule-batch`.
- Probe lines (`PASS|FAIL <probe>.<line>`): **ig** token_type, account, scopes, publish_quota, media_and_comments_poll, comment_fields, dm_read, reel_insights, **reel_insight_shape**, **media_fields_shape**, business_discovery, trial/publish lines (live only). **yt** oauth (`--auth`), token_refresh, scopes, channel, comment_threads, **video_stats_shape**, upload lines (live only). **tiktok** (zernio.ts) accounts, creator_info, dry_run, publish, verify_public. **ai** one line per triage case. Shape lines print key paths + types only (`shapeOf` in `scripts/probes/lib.ts`).
- `check-public-leaks.mjs` (CI), `check-exposure.sh` (status codes only), `schedule-batch.ts`, `schedule-catchup.mjs` (`--create`, `--approve <id>`), `find-duplicates.mjs`, `night/report.mjs`, `dev/{seed,dev-session,local-stack.sh,phone-shot.mjs}`.

## Infra and CI
- Compose: caddy (80/443), web, worker (no ports), db (postgres 17, loopback only), backup (daily).
- Caddyfile: `/app*` behind basic auth (`DASH_USER`/`DASH_HASH`) → web; public `/`, `/privacy*`, `/terms*`, `/snap-test*`, `/healthz`; everything else 404. Domain from env.
- CI (`.github/workflows/ci.yml`): install (frozen lockfile), typecheck, test, `simulate-week && simulate-engagement`, `check-public-leaks.mjs`.

## Config / env (names only)
General `TZ_CREATOR`, `DRY_RUN`, `WORKER_LIVE`, `PUBLIC_MEDIA_BASE`, `PRIVACY_BLOCKLIST`; Meta `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_USER_TOKEN`, `META_GRAPH_VERSION`, `IG_USER_ID`; Google `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YT_REFRESH_TOKEN`, `YT_CHANNEL_ID`, `YT_COMMENT_REPLIES`; Zernio `ZERNIO_API_KEY`, `ZERNIO_TIKTOK_ACCOUNT_ID`; Anthropic `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`; R2 `R2_*`; infra `POSTGRES_PASSWORD`, `DATABASE_URL`, `DOMAIN`, `WEB_ORIGIN`, `DASH_USER`, `DASH_HASH`; ingest `INGEST_ROOTS`. Compose passes `env_file: ../.env` to web, worker and backup.

## Runbooks (`docs/runbooks/`)
deploy, migrations, token-renewal, failed-or-unknown-post (no app button yet: F11), restore, dashboard-password, login, engagement, snapchat-handoff.

## Known gaps (facts)
- No reset for `failed`/`unknown` items (F11 design); the runbook says "3 attempts" (code: 4) and points at a YouTube note in `outbox.ts` that lives in `youtube.ts:37`.
- `AlertRow.platform` typing (F8 T1). Alerts have no page and no push (F8).
- Metric parsers unverified; no ingest job on `main` (F9).
- YouTube and TikTok have no `findExisting`.
- `pickSnapchatDaily` suggestion is read-only; there's no "add Snapchat item from pick" path.
- The YouTube adapter's doc comment mentions 3 hashtags; the code default is 5.
