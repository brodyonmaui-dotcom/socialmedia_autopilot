# Run 5 plan (written at the end of run 4, 2026-11-17)

Read with `docs/fable-lead.md`, `docs/design/ui-system.md` (v3) and `docs/prep/run-4-agent-rules.md`. The exact end state is in `docs/night-logs/2026-11-16.json`. Deadline: Jan 8, 2027.

## What run 4 finished
Branch `fable/run-4-2026-11-16`, PR #23. All checks green at the end: typecheck 0 errors, 2096 tests passed (184 files, with `DATABASE_URL`), both simulations OK (0 double posts, 0 cap breaches, 0 double replies, 0 location leaks, 0 promo replies), web build OK, leak scanner ok.

| Package | Where |
|---|---|
| Safety review of the build-run hunks; fixes: same-instant guard, "Move to tomorrow" honours the editor's HH:MM earliest, YouTube lookup reads 50 uploads | `packages/core/src/scheduler.ts`, `apps/web/lib/editor/slotting.ts`, `packages/adapters/src/youtube.ts` |
| Poster frames at ingest + backfill + session-guarded proxy (0010) | `packages/media/src/poster.ts`, `tools/ingest-agent/src/poster*.ts`, `apps/web/app/media/poster/` |
| Analytics over all account posts, matching, findings with sample sizes (0011) | `packages/analytics/src/account-*.ts`, `sources/`, `apps/worker/src/jobs/account-ingest.ts`, `apps/web/lib/analytics/` |
| UI v3: tokens, Imbue + Inter, edge-reveal sidebar, search palette, notifications pop-over, Home dashboard | `apps/web/components/ui/`, `apps/web/app/page.tsx`, `dashboard.ts` (Home data, in apps/web/lib) |
| Calendar replaces batches (all actions through `planTransition`) | `apps/web/app/calendar/`, `components/calendar/`, `lib/calendar/` |
| Inbox: promo-spam bucket, recalibrated rules, pings, one-tap approve & send from a push (0012) | `packages/engagement/src/rules.ts`, `pings.ts`, `apps/web/lib/inbox/`, `components/inbox/` |
| Research: automatic ideas and hooks, used archive, the 20 scripts (0013) | `packages/research/src/auto/`, `apps/worker/src/jobs/research-refresh.ts`, `components/research/` |
| Touch-up: recalibrated QA, Fix it in the worker, originals kept (0014) | `packages/media/src/{qa,fix,library}.ts`, `apps/worker/src/jobs/media-{fix,recheck}.ts`, `components/library/` |
| Analytics, Research, Library, Touch-up, Platforms, Settings screens | `apps/web/app/{analytics,research,library,platforms,settings}/` |
| Clean-up: v2 components and CSS aliases removed | `docs/design/ui-system.md` "Decisions made while building" |

## What's left (in order)
1. **His phone check of run 4** (list below). Whatever he dislikes is the first work of run 5: collect it as screenshots + one sentence each, fix with one Opus designer per screen.
2. **Real-data shake-out after deploy.** The new code paths were built on fixtures. Watch the first runs of `account-ingest`, `research-refresh`, `media-recheck` and `media-fix` in the worker logs; the open probe facts are listed at the end of `docs/research.md` (IG media list order and paging, insights metrics per media type, `ig_reels_avg_watch_time` unit, Business Discovery `permalink`, YouTube statistics names).
3. **F14 weekly loop** (`docs/design/F14.md`), still not built: the Sunday job that drafts next week (captions stay a Claude Code skill per `docs/decisions.md` §4).
4. **Small follow-ups found in run 4:**
   - Promo accounts can be removed in Settings but only added from an inbox item (no add-by-handle; `apps/web/lib/inbox/promo.ts`).
   - `apps/web/lib/inbox/item.ts` returns no `mediaId`, so the push landing page shows no post thumbnail.
   - `apps/web/app/inbox/actions.ts` `pathFrom` doesn't know the new `filter=` values: after an action on DMs or Ignored the list returns to Needs you.
   - Adding an idea or hook that fails validation loses the typed text (`apps/web/app/research/flow-actions.ts`).
   - The library clip dialog says "Scheduled in N posts" without dates (the loader has no dates).
   - `apps/web/lib/editor/approve.ts` is now used only by its tests (Home uses the calendar's approve path); delete or reuse.
   - The web app repeats the QA issue types from `packages/media` (`apps/web/lib/library/qa-issues.ts`) because the web app doesn't depend on that package.
   - Alerts' "Open in calendar" still goes through the `/batches/<id>` redirect.
   - `apps/web/lib/handoff/view.ts` may hold unused v2 helpers.
5. **Codebase map refresh** (`docs/prep/codebase-map.md`, scout). Very stale now.

## Needs the creator (after merge)
1. Back up, then apply migrations **0010 → 0014** in order (`docs/runbooks/migrations.md`).
2. Deploy: `git pull` in `/opt/autopilot`, then `docker compose up -d --build` in `infra/`. The worker image now installs ffmpeg and the AWS S3 client (untested Docker build: there is no Docker in the cloud container). Tell the agent if it fails.
3. Worker env for Fix it: the R2 names `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA` (same values as the laptop ingest; `docs/runbooks/touch-up.md`).
4. Web container env: pass `DRY_RUN`, `ENGAGEMENT_KILL` and `PRIVACY_BLOCKLIST`, so "Approve & send" reports the real mode (without them it always says "dry run").
5. Laptop: `pnpm ingest:posters` (dry run, prints counts), then `pnpm ingest:posters --write` so existing clips get thumbnails (`docs/runbooks/posters.md`).
6. Behaviour that changes on deploy:
   - default daily caps become Instagram 6, YouTube 10, TikTok 7, Snapchat 1 (his choice; nothing stored overrides them on the VPS);
   - reply pings default to an **hourly digest** push while drafted or flagged comments wait (Settings → Replies → Reply pings: Each one / Hourly / Off);
   - research ideas refresh every 3 days by themselves (no AI cost).
7. Decide in chat: AI notes for research ideas (off; at most about $0.15 a month at the default budget), auto-send per platform (off; shadow stays the default).

## What to verify on his phone (390 px) and desktop
1. Home: the four numbers, the Activity chart, "This week", "From your editors" → Approve on one card.
2. Sidebar: on desktop move the cursor to the left edge (it slides out, stays ~2.5 s after leaving); on the phone tap ≡.
3. Top right: Search (type a clip or idea), Day/Night, Inbox badge, Notifications pop-over → Acknowledge.
4. Calendar: month view, tap a day → the day's cards; hover/tap a thumbnail for the full caption; ⋯ → Move, Edit text, Reject; "Approve all" opens a confirm first.
5. Inbox: Needs you / Drafted / Ignored (promo-spam lands here), Approve & send on a drafted reply (it says "dry run" until the env is set), "Not spam".
6. Analytics: Last 30 days, What worked sentences with n, a platform page.
7. Research: ideas from creators with "Watch the reference", tick Used, check Already used, a script under Your scripts.
8. Library + Touch-up: thumbnails show (after the backfill), Fix it on one clip, then Keep the fix / Keep the original.
9. Platforms → Snapchat: Share to Snapchat (two taps on iOS).
10. Settings: daily posts 6/10/7/1, reply modes, pings, Night theme, Log out everywhere (signs out only; the passkey stays).

## Lessons from run 4
- **Usage limits shaped the run.** Three Opus agents in parallel finished a 5-hour window in about 1.5–2 hours of wall time; the run hit the 5-hour limit twice and the weekly limit once (resumed the next day on Opus, after the Fable allowance ended). Nothing was lost because every brief lived in a file, agents resume by message, and the lead pushed snapshot commits. Keep doing all three.
- **Briefs in files beat briefs in prompts.** `docs/prep/run-4-briefs/*.md` let an agent restart cold and let the lead review against a fixed spec.
- **The lead looks at screenshots before approving.** Fixes from review were cheap (card title size, rolling ranges, button weight, title fallback, log-out scope); finding them on the phone would cost a run.
- **Review catches safety slips the agents don't flag as such:** "Log out everywhere" first revoked the passkey too, which would have locked him out from the phone.
- **A separate demo DB for screenshots** (`autopilot_demo`) avoids "seed refuses a DB with test rows".
- **Custom `NEXT_DIST_DIR` builds rewrite `apps/web/tsconfig.json` and `next-env.d.ts`.** Restore with `git show HEAD:<path> > <path>`; two agents used `git checkout --` (forbidden by the rules file, harmless here).
- **`phone-shot.mjs` waits for load + 1.5 s now**; network idle never came because of route prefetches.
