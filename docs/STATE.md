# State (read this instead of history; updated 2026-11-20)

## What it is
Single-creator tool: phone-first dashboard + always-on worker that posts approved weekly batches to Instagram, YouTube Shorts, TikTok and Snapchat, handles routine engagement, and reports what works. Not a SaaS. Deadline Jan 8, 2027.

## What exists
- Web dashboard (`apps/web`, basePath `/app`): Home, Calendar (replaced Batches), Inbox (+DMs), Library, Touch-up, Research, Analytics, Platforms, Handoff (Snapchat), Alerts, Notifications, Settings, passkey login.
- Worker jobs (`apps/worker/src/jobs`): health, outbox-tick, token-health, analytics-ingest, account-ingest, research-refresh, alert-push, weekly-draft (Sun 18:00 local: tops up next week, 1 library clip/uncovered day to IG+YT+TikTok, empty captions, `batch-ready` push), weekly-report (Mon 08:00, page-only `report-ready`), media-fix, media-recheck, engagement poll/triage/send, dm-poll.
- Ingest/editor pipeline (`tools/ingest-agent`): laptop ingest to R2, `ingest:ready` (editor renders to app drafts), `ingest:posters`; contract in `docs/runbooks/editor-pipeline.md`.
- Packages (`packages/*`): core (scheduler, outbox), adapters, db (migrations 0001-0014, next 0015), media, analytics, research, engagement.

## What's deployed
VPS runs `main` (PR #29, migrations 0001-0014 applied; 0015 pending). **Worker is LIVE since 2026-11-19** (`DRY_RUN=false`, `WORKER_LIVE=1`); YouTube/TikTok confirmed posting through the outbox. Check anytime with `./infra/diagnose-posting.sh`.

## Platform status
- Instagram: direct (Graph API). First real posts done 2026-11-12; trial reels refused (code 10 / 2207081), so regular reels with a flag.
- YouTube: direct (Data API v3). First live upload through the outbox done (private + `publishAt`).
- TikTok: Zernio. First live direct post done through the outbox.
- Snapchat: assisted (share sheet, 1 Spotlight/day). No API post.

## What's next
- **F20 (2026-11-23, `docs/design/F20.md`)**: notifications show inbox work as grouped rows (one per platform) with actions; replies drafted on every platform without an AI key (simple praise only; never auto-sent); YouTube channel auto-resolved; TikTok comments via Zernio; Touch-up auto-queues fixes and sets unfixable clips aside; daily Instagram drafts (min 2/day, template captions); reel maker (sounds + Make a reel, **migration 0015**); trial reels alert at 200 IG followers + Settings toggle (off).
- **F19 (2026-11-20, `docs/design/F19.md`)**: per-platform approval state, clear Approve all, Approve in every card's ⋯ menu, auto-schedule missed posts (series "Day N" first, stays approved), actionable notifications, no Search/theme buttons (Dark mode in Settings), 12-hour times, Keep all fixes, Instagram check reads 50 posts and separates "can't check" from "not found". No migration.
- **Posting stopped 2026-11-19 (F18).** Cause confirmed: worker left in dry-run after the first-real-post runbook. Fixed in code: missed-slot guard (no burst of overdue posts), worker heartbeat `settings.worker_status`, "Posting is off" banner on Home/Calendar. On the VPS: `./infra/diagnose-posting.sh` → `docs/runbooks/not-posting.md`.
- F17 (run 5): his phone check of run 4; real-data shake-out of account-ingest, research-refresh, media-recheck, media-fix (`docs/prep/run-5-plan.md`).
- F14 weekly loop: built 2026-11-19 (no migration). Captions: `pnpm skill:weekly-batch pending` → `fill <file> --write`. Needs `TZ_CREATOR` in the worker env or the jobs aren't scheduled.
- Small follow-ups in run-5-plan item 4; codebase map refresh.
- This run adds: multi-folder editor pipeline, post-ready skill, "Editor approval counts" setting.

## Where things live
- `docs/decisions.md`, `docs/research.md` (verification log at the end), `docs/voice.md`, `docs/content-playbook.md`
- `docs/runbooks/` (deploy, migrations, first-real-post, ...), `docs/design/ui-system.md` + `F13.md`-`F15.md`
- `docs/prep/codebase-map.md`, `docs/prep/run-5-plan.md`, `docs/fable-week.json` (tracker)
- `docs/archive/` (old night logs/reports, run 2-5 prep, finished designs; see its README)

## Commands
`pnpm install` · `pnpm typecheck` · `pnpm test` · `pnpm simulate-week` · `pnpm simulate-engagement` · `pnpm ingest:ready` · `pnpm skill:post-ready scan|write` · `pnpm ingest:posters` · `node scripts/check-public-leaks.mjs`
