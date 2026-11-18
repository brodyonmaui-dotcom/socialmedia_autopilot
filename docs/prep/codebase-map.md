# Codebase map

Snapshot of branch `day/cleanup-2026-11-18` (= `main` after PR #23 + the run-5 cleanup), surveyed 2026-11-18 by a Haiku scout and checked by the lead. Facts only: paths and names, no plans (plans live in `docs/prep/run-5-plan.md` and `docs/design/`). Line numbers drift: re-grep before citing.

## Baseline (cloud container, Node 22, pnpm 10.28)
| Command | Result |
|---|---|
| `pnpm install` | exit 0 (about 4 s) |
| `bash scripts/dev/local-stack.sh` | migrations 0001–0014 applied, seed OK, prints `DATABASE_URL` |
| `pnpm typecheck` | exit 0 (root `tsconfig.json` + `apps/web/tsconfig.json`) |
| `pnpm test` with `DATABASE_URL` set | exit 0: **189 files, 2141 tests passed** |
| `pnpm test` without `DATABASE_URL` | DB tests (`*.db.test.ts`) skip; everything else passes |
| `pnpm simulate-week` | `OK 7d×4 slots · 91 posts · published 70 (3 recovered) · retries 24 · failed 4 · unknown 10 · handoff 7 · alerts 14 · 0 double-posts · 0 cap breaches · DST week` |
| `pnpm simulate-engagement` | shadow and live-fake both `OK` (200 comments, 0 double-replies, 0 limit breaches, 0 location leaks, 0 promo replies; live-fake trips the kill switch as designed) |
| `node scripts/check-public-leaks.mjs` | `ok (129 files)` |
| web build (`pnpm --filter @autopilot/web build`) | exit 0 |

Dev tools: `pnpm dev:session` prints a session cookie for screenshots (refuses a DB with non-demo media rows); `node scripts/dev/phone-shot.mjs <path> <out.png> --port <p> --cookie <c> [--desktop] [--theme dark] [--full]`. A custom `NEXT_DIST_DIR` build rewrites `apps/web/tsconfig.json` and `next-env.d.ts`; restore with `git show HEAD:<path> > <path>`.

## packages/ (`@autopilot/*`, `main` = `src/index.ts`, no `exports` maps; deep imports like `@autopilot/engagement/src/rules.js` are used)
- **core**: types, capabilities, cadence, scheduler, outbox engine, log sanitiser, simulate-week.
  - `types.ts` (`Platform`, `PostStatus`, `OutboxPost`, `PlatformAdapter`, `AlertKind`, `ALERT_KINDS`) · `capabilities.ts` (`CAPABILITIES`) · `cadence.ts` (`DEFAULT_CADENCE`, `normalizeCadence`, `isWithinAnyWindow`) · `scheduler.ts` (`assignSlots`, `findCapBreaches`)
  - `outbox/engine.ts` (`runOutboxTick`, `isDueNow`) · `outbox/policy.ts` (`DEFAULT_RETRY_POLICY`, `classifyFailure`, `decideAfterAttempt`, `NonRetryableError`, `PublishTimeoutError`)
  - `log/sanitize.ts` (`sanitizeForLog`, `sanitizeError`) · `time.ts` (`localToUtc`, `zonedTimeToUtc`, `localDate`, `addCalendarDays`, `assertTimeZone`) · `catchup.ts` (`generateCatchUpSlots`) · `sim/simulate-week.ts` · `testing/fakes.ts`
- **adapters**: platform adapters, token health, comment and DM sources.
  - `instagram.ts` (`createInstagramAdapter`, `normaliseCaption`) · `youtube.ts` (`createYouTubeAdapter`, `refreshAccessToken`, `youtubeTitle`) · `tiktok.ts` (`createTikTokAdapter`, Zernio) · `snapchat.ts` (`createSnapchatAdapter` publish throws, `buildSnapchatHandoff`, `snapchatCaption`, `SNAPCHAT_CHECKLIST`)
  - `registry.ts` (`buildAdapters`, `credentialsFromEnv`) · `token-health.ts` (`checkTokenHealth`, `checkMetaToken`, `checkYouTubeToken`, `checkZernioAccount`) · `http.ts` (`getJson`, `assertNoLocationFields`, `PlatformRequestError`, `UploadAmbiguousError`)
  - `comments/index.ts` (`buildCommentSources`, `commentCredentialsFromEnv`) · `comments/dm-instagram.ts` (`createInstagramDmSource`, read-only)
- **db**: `client.ts` (`createPool`) · `migrate.ts` (`migrate`) · `cli-migrate.ts` · `settings.ts` (`getSetting`, `setSetting`) · `cadence.ts` (`loadCadence`) · `auth-admin.ts` (`createEnrollCode`, `revokeAllAuth`, `sha256Hex`) · `types.ts` (`BatchItemRow`, `AlertRow`, `BATCH_ITEM_STATUSES`)
- **media**: ffprobe, QA, touch-up, fix, poster, hashing, dedupe, location-tag detection.
  - `qa-types.ts`: import-free QA/fix types and constants (`Segment`, `QaSeverity`, `QaIssueCode`, `QaIssue`, `FixOp`, `FIX_OP_ORDER`, `OP_FOR_CODE`, `OPT_IN_OPS`); the only file the web app imports (`@autopilot/media/src/qa-types.js`), guarded by tests
  - `probe.ts` (`probe`, `findLocationTagKeys`, `findDeviceTagKeys`) · `qa.ts` (`runQa`, `assessQa`, `buildQaResult`, `qaAfterTouchUp`) · `touchup.ts` (`touchUp`, always strips metadata) · `fix.ts` (`planFix`, `runFix`, `fileStats`) · `poster.ts` (`makePoster`, `posterArgs`)
  - `dedupe.ts` (`findDuplicateSets`) · `hash.ts` (`sha256File`) · `library.ts` (`insertMediaRow`, `MEDIA_INSERT_SQL`) · `exec.ts` (`run`, `runChecked`, `hasBinary`) · `parse.ts`
- **analytics**: `ingest.ts` (`ingestOnce`, `SNAPSHOT_AGES_H`) · `sources.ts` (IG/YT/Zernio metric sources) · `report.ts` (`buildWeeklyReport`) · `trials.ts` (`recommendTrialShares`) · `snapchat.ts` (`pickSnapchatDaily`) · `account-ingest.ts` (`ingestAccountOnce`) · `account-match.ts` (`matchAccountPost(s)`) · `account-report.ts` (`buildFindings`, `classifyPillar`) · `sources/{instagram,youtube}-account.ts` · `health.ts` (`nextHealth`) · `store.ts`, `account-store.ts`
- **research**: `voice-lint.ts` (`lintText`, `blocklistFromEnv`, `stripMarketTerms`) · `store.ts` (`addCreator`, `addIdea`, `addHook`, `listIdeaCards`, `setIdeaUsed`) · `backlog.ts` (`moveIdea`, `filmNext`, `stageCounts`) · `brief.ts` (`buildResearchBrief`) · `discovery.ts` (`fetchCreatorSnapshot`) · `auto/refresh.ts` (`runResearchRefresh`, `RESEARCH_REFRESH_CRON`, `researchNeverRan`) · `auto/ai-notes-anthropic.ts` · `auto/{yap,niche,rank}.ts`
- **engagement**: `rules.ts` (`preRules`, `postRules`, `promoRule`, `promoAuthorKey`, `isWhereabouts`; a promo-list key matches author id or lower-cased handle) · `planner.ts` (`planActions`) · `gate.ts` (`sendGate`) · `send.ts` (`runSendTick`, `redactSecrets`) · `kill.ts` (`shouldTripKill`, `killEnvFromEnv`) · `rotation.ts` (`pickReply`) · `pings.ts` (`planPings`) · `dm.ts` (`buildDmDraft`, `classifyDm`; drafts only) · `triage-anthropic.ts`, `triage-fake.ts` · `settings.ts` (`DEFAULT_ENGAGEMENT`, `normalizeEngagement`) · `sim/simulate-engagement.ts`

## apps/web (Next.js 15, `basePath: /app`, standalone; `transpilePackages` lists the workspace packages it imports)
- `middleware.ts` (logic in `lib/auth/middleware-logic.ts`) · `app/layout.tsx` · PWA: `public/manifest.json`, `public/sw.js`, `public/icons/`
- **Routes** (under `/app`):
  - `/` Home · `/login` (`actions.ts`, `PasskeyPanel.tsx`)
  - `/calendar` (`actions.ts`: `approveItemsAction`, `approveAllAction`, `rejectItemsAction`, `editTextAction`, `moveAction`, `moveTomorrowAction`, `fillTimesAction`, `resetCheckedAction`, `recordPublishedAction`, `igCheckAction`); accepts `?view=` and `?d=`
  - `/batches` → redirect `/calendar`; `/batches/[id]` → `batchRedirect(weekStart)` (kept for old push links)
  - `/alerts` (`actions.ts`, `push-actions.ts`; "Open in calendar" links to `/calendar?view=week&d=<week>`) · `/notifications`
  - `/inbox` (`actions.ts`; `?filter=needs-you|drafted|sent|ignored`, legacy `?tab=`) · `/inbox/dms` · `/inbox/item/[id]` (push landing page, shows the post poster)
  - `/handoff` (`actions.ts`) · `/handoff/media/[itemId]` (route, same-origin clean-file proxy)
  - `/library` (`actions.ts`, `form-actions.ts`; clip dialog lists the clip's scheduled posts) · `/library/touch-up` · `/touch-up` · `/media/poster/[mediaId]` (route, session-guarded)
  - `/api/search` (route) · `/platforms`, `/platforms/[platform]` · `/analytics`, `/analytics/[platform]`
  - `/research`, `/research/{creators,hooks,ideas,used}` (`actions.ts`, `flow-actions.ts`; failed adds return `?error=&draft_<field>=` and the form prefills)
  - `/settings` (`actions.ts`, incl. `addPromoAccountAction`, `removePromoAccountAction`) · `/more`, `/more/settings`
- **lib/**: `db.ts` · `alerts/` (queries, view) · `analytics/` (overview, platform, present) · `auth/` (config, session, webauthn, require, store, memory-store, pg-store, rate-limit, alerts, middleware-logic) · `batches/` (types, store, pg-store, transitions, reset, fill-times, warnings, view-model, card-view, context, ig-check) · `calendar/` (model, load, plan) · `editor/` (view, slotting, move) · `engagement/` (queries, settings) · `handoff/` (store, logic, share-machine, media, types, view) · `home/dashboard.ts` · `inbox/` (list, status, item, view incl. `pathFrom`, promo incl. `parsePromoHandle`, `addPromoAccountByHandle`) · `library/` (data incl. `loadClipUses`, screen, pillars, qa-issues) · `media/poster.ts` · `platforms/` (view, load, snapchat) · `push/subscriptions.ts` · `research/` (view, ideas, cards incl. draft helpers) · `search/` (query, shape) · `settings/` (audit, caps, replies, view)
- **components/**: `AppFrame.tsx`, `app-nav.ts`, `frame-counts.ts`; `analytics/`, `calendar/`, `inbox/`, `library/`, `notifications/`, `platforms/` (`SnapchatShare.tsx`), `research/`, `settings/` (`ReplyControls.tsx`), `ui/` (about 30 v3 primitives incl. `Thumb`, `Dialog`, `Sheet`, `Popover`, `Select`, `CommandPalette`, `theme.ts`)

## apps/worker
- `src/index.ts` registers jobs; `src/run-mode.ts` (`resolveRunMode`: live only with `DRY_RUN=false` and `--live` or `WORKER_LIVE=1`); `src/queue.ts` (`QUEUES`)
- Other: `jobs/engagement-store.ts` (`PgEngagementStore`), `jobs/alert-push-store.ts`, `cli/auth.ts` (`auth:enroll`, `auth:revoke-all`)

| Queue | Cron | Source |
|---|---|---|
| health-check | `*/5 * * * *` | `jobs/health.ts` |
| outbox-tick | `* * * * *` | `jobs/register-outbox.ts`, `jobs/outbox.ts` |
| token-health | `17 6 * * *` | `jobs/token-health.ts` |
| analytics-ingest | `23 * * * *` | `jobs/analytics-ingest.ts` (read-only) |
| account-ingest | `41 */6 * * *` | `jobs/account-ingest.ts` (read-only) |
| research-refresh | `17 5 */3 * *` (+ once at start if never run) | `jobs/research-refresh.ts` |
| alert-push | `* * * * *` (skipped without VAPID) | `jobs/alert-push.ts`, `alert-push-core.ts` |
| media-fix-tick | `* * * * *` | `jobs/media-fix.ts` |
| media-recheck | `*/10 * * * *` | `jobs/media-recheck.ts` |
| engagement-poll / -triage / -send | `*/5` / `*` / `*` | `jobs/register-engagement.ts` |
| dm-poll | `*/5 * * * *` (no-op unless `settings.dmPollVerified`) | `jobs/dm-poll.ts` |

## tools/ingest-agent (`@autopilot/ingest-agent`)
- Scripts `ingest` (`src/index.ts`), `ready` (`src/ready-cli.ts`), `posters` (`src/posters-cli.ts`); root `pnpm ingest:ready`, `pnpm ingest:posters`
- Modules: `config`, `scan`, `ingest-file`, `run`, `retry`, `r2`, `poster`, `ready/{plan,run,sidecar,write}`; deps core, db, media, research, `@aws-sdk/client-s3`

## scripts/
- `dev/` (`seed.ts`, `dev-session.ts`, `local-stack.sh`, `phone-shot.mjs`, `make-icons.mjs`, `lib/seed-*`) · `night/report.mjs` · `simulate-week.ts`, `simulate-engagement.ts` · `check-public-leaks.mjs`, `check-exposure.sh` · `preflight.ts` + `lib/preflight*.ts` · `schedule-batch.ts`, `schedule-catchup.mjs`, `find-duplicates.mjs`, `research/build-yap-data.ts`
- `probes/` (`ig`, `yt`, `zernio`, `anthropic`, `connect-meta`, `lib`) · `skills/` (`weekly-batch`, `research-brief`, `platform-check`, `weekly-report`, `backfill`, `lib/`)

## infra/
- `docker-compose.yml`: `caddy` (2.10), `web`, `worker`, `db` (postgres 17, 127.0.0.1:5432), `backup` (daily `backup.sh`)
- `Caddyfile` (`/app*` → `web:3000`; `/`, `/privacy*`, `/terms*`, `/snap-test*`, `/assets/*`, `/healthz` public; else 404), `restore-test.sh`, `bootstrap-vps.sh`, `preflight.sh`, `probe.sh`, `static/`

## packages/db/migrations (next free: 0015)
| # | Adds |
|---|---|
| 0001_init | `media`, `batches`, `batch_items` (outbox rows, `idempotency_key`) |
| 0002_settings | `settings` KV; seeds `posting_windows` |
| 0003_research | `creators`, `ideas`, `hooks` |
| 0004_analytics | `post_metrics` (snapshots per age) |
| 0005_outbox | `alerts`; retry columns on `batch_items`; seeds `cadence` |
| 0006_auth_approval | `auth_*` tables; `batch_item_events`; approval stamps; `rejected` status; nullable `scheduled_for` |
| 0007_engagement | `comments`, `comment_triage`, `engagement_actions`, `engagement_cursors`, `engagement_blocklist`, `dm_threads`, `dm_messages`, `dm_drafts` |
| 0008_alerts_push | `alerts.pushed_at`, `alerts.acknowledged_session`; `push_subscriptions` |
| 0009_editor_ingest | `batch_items.ingest_key` (unique), `origin` |
| 0010_media_poster | `media.poster_key` |
| 0011_account_posts | `account_posts`, `account_post_snapshots`, `account_snapshots` |
| 0012_inbox_ignore | `spam_promo` bucket; `engagement_promo_accounts` (platform, author_key, display_handle, source, removed_at); ignored DM threads; `reply-ready` alerts |
| 0013_research_auto | `ideas`/`hooks.source_key`; `creator_media`; `research_runs`; `ai_token_usage` |
| 0014_media_fix | `media_fixes`; `touchup_dismissals`; `media.derived_from` |

31 tables. Rows are archived (`removed_at`, status changes), not deleted.

## Test files per package (`*.test.ts`; no `.tsx` tests)
| Package | Files |
|---|---|
| apps/web | 76 (about 12 `*.db.test.ts`) |
| apps/worker | 23 |
| packages/core | 11 |
| packages/adapters | 10 |
| packages/db | 5 |
| packages/analytics | 9 |
| packages/engagement | 16 |
| packages/research | 7 |
| packages/media | 10 |
| tools/ingest-agent | 10 |
| scripts/ | 12 |
