# Run 5 plan (kept current during run 4, 2026-11-16)

Read with `docs/fable-lead.md`, `docs/design/ui-system.md` (v3) and `docs/prep/run-4-agent-rules.md`. The night log `docs/night-logs/2026-11-16.json` has the exact state at the last checkpoint; if it disagrees with this file, the night log wins.

## What run 4 set out to do
Make the app usable, functional and good-looking on his phone and desktop: a new UI (v3), a calendar instead of "batches", analytics over all his posts, inbox triage that ignores promo-spam and lets him approve a reply from a push, research that fills itself, touch-up that fixes instead of warns, and a real Settings page.

## State by work package
Status words: **done** = built, reviewed by the lead, tests green, committed. **built** = code is in the tree and committed as a snapshot but not yet reviewed. **open** = not started.

| Package | Brief | Status at the last update |
|---|---|---|
| Safety review of the build-run hunks + 3 fixes | `docs/prep/run-4-fable-brief.md` | done |
| Poster frames (0010) | in the commit message of `3360500` | done |
| Analytics for all posts, backend (0011) | commit `Analytics for all account posts` | done |
| UI v3 foundation: tokens, shell, search, notifications, Home | `docs/design/ui-system.md` | done |
| Inbox backend: promo-spam, recalibration, one-tap approve (0012) | `docs/prep/run-4-briefs/inbox.md` | done |
| Research backend: auto ideas/hooks, used archive, scripts (0013) | `docs/prep/run-4-briefs/research.md` | done |
| Calendar (replaces batches) + Home fixes | `docs/prep/run-4-briefs/calendar.md` | done |
| Inbox pages | `docs/prep/run-4-briefs/pages.md` §B | done |
| Touch-up QA + Fix it backend (0014) | `docs/prep/run-4-briefs/touchup.md` | in progress |
| Analytics pages | `pages.md` §A | in progress |
| Research pages | `pages.md` §C | in progress |
| Library + Touch-up pages | `pages.md` §D | open |
| Platforms + Settings pages (caps defaults 6/10/7/1, log out everywhere) | `pages.md` §E | open |
| Clean-up: delete v2 components and aliases, rename leftovers, all shots | `ui-system.md` "Removed" | open |

Pages that still show the old layout inside the new shell until their package lands: Analytics, Research, Library, Touch-up, Handoff, Settings (light restyle only).

## How to continue an unfinished package
1. `bash scripts/dev/local-stack.sh` (starts Postgres). Tests use `autopilot_dev`. The app and screenshots use the clean demo DB `autopilot_demo` (migrate + `pnpm dev:seed` with both `DATABASE_URL` and `DEV_DATABASE_URL` pointing at it) and `DEV_POSTER_DIR=<repo>/logs/dev-posters`.
2. Give the brief file to an Opus `designer` (pages) or `implementer` (backend) together with `docs/prep/run-4-agent-rules.md`. Each brief lists files, safety frame and acceptance.
3. Review = read the diff against the last reviewed commit, run `pnpm typecheck` and `pnpm test`, and look at the shots in `docs/design/ui-shots/v3/` (phone and desktop, Day and Night) against the hard rules in `ui-system.md`.

## Needs the creator (after merge)
Kept in the PR description; the short list:
1. Back up, then apply migrations 0010–0014 in order (`docs/runbooks/migrations.md`).
2. Deploy. The worker image changed (ffmpeg for Fix it): `docker compose up -d --build`.
3. On the laptop: `pnpm ingest:posters` (dry run), then with `--write`, so existing clips get thumbnails (`docs/runbooks/posters.md`).
4. Web container env: pass `DRY_RUN`, `ENGAGEMENT_KILL` and `PRIVACY_BLOCKLIST` so "Approve & send" reports the real mode.
5. Decide in chat: reply pings (default hourly digest), AI notes for research ideas (off; at most about $0.15 a month), auto-send per platform (off).
6. Probe lines still unverified for the account ingest and Business Discovery `permalink` (listed at the end of `docs/research.md`).

## What to verify on his phone
Filled in at the end of run 4 (see the PR's "How to check it on my phone").

## Lessons from run 4
- Three Opus agents in parallel use a 5-hour window in roughly 1.5–2 hours of wall time. Two windows ran out mid-task. Nothing was lost because agents resume by message and the lead pushed WIP snapshots, but plan for it: keep every brief in a file, and keep the night log's `nextPickup` exact.
- A separate demo DB for screenshots avoids the "seed refuses a DB with test rows" problem.
- Builds with a custom `NEXT_DIST_DIR` rewrite `apps/web/tsconfig.json` and `next-env.d.ts`; restore both before committing.
- The stop hook asks for a commit whenever the tree is dirty; snapshot commits labelled "unreviewed" keep it quiet without losing the review baseline.
