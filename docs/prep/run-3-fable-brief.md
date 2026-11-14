# Run 3 Fable brief (rewritten 2026-11-14 by the Opus day run "core")

Fable does only what can't be messed up: judge the open rows, review the F11 T2 SQL, art-direct F12, the final cross-cutting review, and the run-4 plan. Everything else was pre-built and pre-summarised on branch `day/pre-fable3-core-2026-11-14` (see its PR). Read with `docs/prep/run-3-decisions.md` (wins on conflict) and `docs/prep/codebase-map.md` (note: **not refreshed** this run; it predates F11 T2 and the fixes below).

**Budget rule:** Fable < 25% of the run's tokens. Read the pack files and named diffs only, never whole packages. Haiku scouts for any extra reading, Opus implementers for fixes (max 2 in parallel), Sonnet for docs. Stage explicit paths, checkpoint after each item.

## Already done (don't redo)
- **Review pack** `docs/prep/run-3-review-pack/`: 9 hunks, each with a scout summary (SQL verbatim, write/send branches, file:line) and a red-team Findings table. **6 defects fixed, each with a failing test first:**
  - `/sw.js`, `/manifest.json`, `/favicon.ico` exact match, dirs bounded, and the middleware matcher bounded (`pwa-public-paths` #1–2)
  - media proxy refuses an `r2_key` escaping `PUBLIC_MEDIA_BASE` (`handoff-media` #1)
  - the worker media URL is guarded the same way (`handoff-media` #3, `outbox.ts mediaUrlGuard`)
  - `acknowledgeAll` with an unknown kind acknowledges nothing (`alerts-ack`)
  - the F9 trip alert is raised before the health state is saved (`f9-ingest`)
- **F11 T2** built (`19ac4ba`): `PgBatchStore` SQL under a `// Fable to review` header, IG auto-check (`lib/batches/ig-check.ts`), `resetCheckedAction` / `recordPublishedAction` / `igCheckAction`, plus these tests: `reset.db.test.ts` (same key, concurrency, guards, alert ack, re-approve), `apps/worker/src/__tests__/outbox-reset.db.test.ts` (lookup hit → 0 publishes; miss → exactly 1 with the same key), and a static no-key/no-delete test.
- F11 pure logic: 25 extra attack tests (`f11-redteam.test.ts`), no defects.
- Tests at the last green commit `50a1bde`: typecheck green; `pnpm test` with `DATABASE_URL`: 127 files / 1338 tests.

## Not done (the day run hit a usage limit during the batches UI task and resumed only after the 02:30 hard stop)
- **F11 T3 + F12 batches restyle (design tasks 2–3): unfinished, NOT committed as code.** The designer's work in progress is saved as `docs/prep/run-3-wip/f11-t3-batches-restyle.wip.patch` (ResetSheet, card-view, Notice, nav, restyled list/PostCard/WeekGrid/ItemForm). It fails typecheck: `[id]/page.tsx` still passes `urls`/`postUrl`. No shots were taken.
- Codebase map refresh. F9 T3 (no probe output on main).

## Items, in order. Window 1 ends at a clean checkpoint after item 3.
| # | Item | Pre-summaries to read | Work under review | Fable tokens | Others |
|---|---|---|---|---|---|
| 1 | **Judge the 7 open rows** | `run-3-review-pack/*.md` Findings tables, rows marked `needs Fable judgment` (listed below) | the 6 fixes' diffs: `git diff 9350c61..50a1bde -- apps packages ':!*__tests__*'`, ≈ 150 lines | ~25k | an Opus fix only if a row is rejected (~40k) |
| 2 | **F11 T2 SQL + tests** (double-post risk) | `f11-pure.md` row 12 | `apps/web/lib/batches/pg-store.ts` (the `Fable to review` block), `reset.db.test.ts`, `outbox-reset.db.test.ts`, `ig-check.ts`. Run both DB tests | ~30k | none |
| 3 | **Checkpoint**: commit, push, night log | | | ~3k | |
| 4 | **Finish F11 T3 + batches restyle** | this brief + `ui-system.md` Restyle plan 2–3 + `F11.md` goals 3–5 | resume from the WIP patch (`git apply`, fix the page.tsx props) with the `designer` agent (Opus); Fable reviews only the phone + desktop shots (Day/Night) and that Confirm is disabled until every box is ticked (a pure `allTicked` test) | ~15k | designer ~250k |
| 5 | **Art-direct F12** from the design session's PR screenshots (`docs/design/ui-shots/`) | the PR's shot list | one note per page: keep / change (exact) | ~20k | designer fixes ~100k |
| 6 | **Final cross-cutting review** | scout: every new `update\|insert` on the branch with file:line, new env names, new routes/actions vs the guard test, `check-public-leaks` | check against non-negotiables 2–6; then `pnpm typecheck`, `pnpm test` with `DATABASE_URL`, both simulations, web build | ~25k | scout ~40k |
| 7 | **`docs/prep/run-4-plan.md`** | Sonnet drafts from the night logs + `fable-week.json` | Fable edits the priorities only | ~8k | Sonnet ~30k |
| | **Total** | | | **~125k** | **~500k (Fable ≈ 20%)** |

## The 7 open rows for item 1
1. `dockerfiles` #2: root `tsconfig.json` isn't copied into the images (tsx falls back to defaults?). #3: no real image build here; the creator's first `docker compose up -d --build` is the test.
2. `f11-pure` #8: `validatePostUrl` accepts any path beyond "/" (e.g. `/accounts/login`). It's only shown and audited.
3. `f11-pure` #11: IG checklist box 3 says "the app checked the last 25 posts" even when the auto-check returned `error`. Suggest rewording it to cover both results (T3 can show the result next to it).
4. `f11-pure` #12: the T2 SQL (item 2).
5. `f11-pure` #13: `canReset` is false for Snapchat and rows with a post id, but "record it" stays available. T3 must not gate that button on `canReset`.
6. `handoff-media` #7: with `PUBLIC_MEDIA_BASE` unset, `mediaUrlGuard` fails every due post permanently (dry run too). Accept fail-closed, or skip the tick with one config alert.

## Creator tasks (unchanged plus new)
- Paste the four F9 probe lines (`ig.reel_insights`, `ig.reel_insight_shape`, `ig.media_fields_shape`, `yt.video_stats_shape`) so F9 T3 can run.
- Apply 0008, VAPID keys, push on the iPhone, first Snapchat share (from run 3 decisions).
- The scratch DB `autopilot_rr_test` exists only in the cloud container's local Postgres (re-run test for 0008); nothing to do on the server.
