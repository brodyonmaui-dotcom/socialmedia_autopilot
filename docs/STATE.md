# State (read this instead of history; updated 2026-11-18)

## What it is
Single-creator tool: phone-first dashboard + always-on worker that posts approved weekly batches to Instagram, YouTube Shorts, TikTok and Snapchat, handles routine engagement, and reports what works. Not a SaaS. Deadline Jan 8, 2027.

## What exists
- Web dashboard (`apps/web`, basePath `/app`): Home, Calendar (replaced Batches), Inbox (+DMs), Library, Touch-up, Research, Analytics, Platforms, Handoff (Snapchat), Alerts, Notifications, Settings, passkey login.
- Worker jobs (`apps/worker/src/jobs`): health, outbox-tick, token-health, analytics-ingest, account-ingest, research-refresh, alert-push, media-fix, media-recheck, engagement poll/triage/send, dm-poll.
- Ingest/editor pipeline (`tools/ingest-agent`): laptop ingest to R2, `ingest:ready` (editor renders to app drafts), `ingest:posters`; contract in `docs/runbooks/editor-pipeline.md`.
- Packages (`packages/*`): core (scheduler, outbox), adapters, db (migrations 0001-0014, next 0015), media, analytics, research, engagement.

## What's deployed
Known: the VPS ran Docker Compose from `/opt/autopilot` with live IG, YT and TikTok posts through the outbox. Unknown: whether run 4 (PR #23, migrations 0010-0014) is deployed. Check `git log origin/main` vs the VPS.

## Platform status
- Instagram: direct (Graph API). First real posts done 2026-11-12; trial reels refused (code 10 / 2207081), so regular reels with a flag.
- YouTube: direct (Data API v3). First live upload through the outbox done (private + `publishAt`).
- TikTok: Zernio. First live direct post done through the outbox.
- Snapchat: assisted (share sheet, 1 Spotlight/day). No API post.

## What's next
- F17 (run 5): his phone check of run 4; real-data shake-out of account-ingest, research-refresh, media-recheck, media-fix (`docs/prep/run-5-plan.md`).
- F14 weekly loop (Sunday draft batch, Monday report), still todo.
- Small follow-ups in run-5-plan item 4; codebase map refresh.
- This run adds: multi-folder editor pipeline, post-ready skill, "Editor approval counts" setting.

## Where things live
- `docs/decisions.md`, `docs/research.md` (verification log at the end), `docs/voice.md`, `docs/content-playbook.md`
- `docs/runbooks/` (deploy, migrations, first-real-post, ...), `docs/design/ui-system.md` + `F13.md`-`F15.md`
- `docs/prep/codebase-map.md`, `docs/prep/run-5-plan.md`, `docs/fable-week.json` (tracker)
- `docs/archive/` (old night logs/reports, run 2-5 prep, finished designs; see its README)

## Commands
`pnpm install` · `pnpm typecheck` · `pnpm test` · `pnpm simulate-week` · `pnpm simulate-engagement` · `pnpm ingest:ready` · `pnpm skill:post-ready scan|write` · `pnpm ingest:posters` · `node scripts/check-public-leaks.mjs`
