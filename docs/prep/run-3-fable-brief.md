# Run 3 Fable brief: do only these, in this order

Written 2026-11-13 by the Opus prep run. Goal: **Fable does only what truly can't be messed up**: adversarial review of the safety-critical diffs, the F11 integration, and the final cross-cutting review. Haiku scouts do all reading and summarizing; Opus implementers do all code under Fable's review. Read with `docs/prep/run-3-decisions.md` (wins on conflict), `docs/prep/codebase-map.md`, and the PR for `prep/run-3-2026-11-13`.

**Budget rule:** Fable's own share stays **< 25%** of the run's tokens. Fable reads scout summaries and diffs of the named hunks, never whole packages. Max 2 Opus implementers in parallel. Stage explicit paths. Checkpoint after each item.

## What's already built (don't redo)
F10 complete; F8 T1–T5 (see the PR for T3–T5 status); F9 T1, T2, T4, T5; F11 design + T1 pure logic. 979+ tests green, simulations green, web build green.

## 1. Adversarial review of the safety-critical diffs (≈ 25% of the run)
For each hunk below: a **Haiku scout** first writes a ≤ 40-line summary (what the code does, every SQL statement verbatim, every branch that writes or sends), then Fable reads that summary plus the hunk itself and tries to break it. Fixes go to one **Opus implementer** with the exact defect; Fable re-reads only the fix diff.

| Hunk | What to attack |
|---|---|
| **Push gating + dedupe** (F8 T3: the pure module headed `// Fable to review: push gating + dedupe` in `apps/worker`, plus its job) | double push across concurrent ticks (claim-before-send), push of old rows after deploy (0008 backfill + age cutoff), non-push kinds leaking (`metrics-health`), endpoint/key in logs, a send error un-claiming, 404/410 handling, dry-run behaviour |
| **Migration 0008** `packages/db/migrations/0008_alerts_push.sql` | backfill really covers every existing row; FKs `on delete set null`; index predicate matches the job's query; re-run safety on the VPS (`migrations.md`) |
| **Handoff "Mark posted" / Skip / Drop** `apps/web/lib/handoff/store.ts:152-230` (`WRITABLE` guard, `markPosted` :156, `skipToNextDay` :180 with advisory lock :185 + `for update` :189, `dropItem` :211) | a Snapchat item published twice; two items on one local day after concurrent skips; skip into the past; a non-Snapchat or unapproved row touched; URL validation (`cleanSpotlightUrl` :99) |
| **Handoff media proxy** `apps/web/lib/handoff/media.ts:21-45`, route `apps/web/app/handoff/media/[itemId]/route.ts` | leaking `PUBLIC_MEDIA_BASE`/r2 key/upstream bodies; serving a non-due/non-approved item; path traversal in `r2_key` (it comes from the DB, but check); caching headers |
| **Alerts acknowledge** `apps/web/lib/alerts/queries.ts:101-130` | acknowledges only open rows, only shown ids; no delete; kind filter injection (`parseKind` :28) |
| **F11 pure logic** `apps/web/lib/batches/transitions.ts` (`reset-checked`, `record-published`), `apps/web/lib/batches/reset.ts` (`RESET_CHECKLIST`, `validatePostUrl` :53) | any path that changes `idempotency_key`; reset from a status other than failed/unknown; IG reset without an auto-check; URL lookalikes |
| **F9 ingest job** `apps/worker/src/jobs/analytics-ingest.ts:107-150`, `packages/analytics/src/health.ts:19` | any non-GET call besides the YT token refresh; tokens in logs/alerts; alert storm (one per run instead of one per trip) |

Expected: ~6 scout summaries (cheap), Fable review ≈ 60–90k tokens, fixes ≈ 1–2 implementer tasks.

## 2. F11 integration: T2 + T3 (≈ 35% of the run, mostly Opus)
Design: `docs/design/F11.md`. T1 is done (pure logic, 52 tests). `PgBatchStore.apply` currently **refuses** `reset-checked` / `record-published` on purpose (`apps/web/lib/batches/pg-store.ts`, top of the loop): T2 replaces that guard.
- **Scout first:** summarize `PgBatchStore.apply`/`loadBatch`, `apps/web/app/batches/[id]/actions.ts`, `PostCard.tsx`, the IG adapter's `findExisting` (`packages/adapters/src/instagram.ts:133-142`) and how the web could build an IG adapter from env (`credentialsFromEnv`).
- **Opus implementer T2** (store + actions + IG auto-check), spec from F11.md T2 plus these exact needs from T1's report: add `"reset-checked" | "record-published"` to `BatchItemEventKind` (`packages/db/src/types.ts:~65`); `loadBatch` selects `attempts`, `last_error`; `apply` writes the new patch fields, stores `c.detail ?? c.patch` as the event detail, adds `and platform_post_id is null` for reset-checked, and acknowledges the matching `final-failure`/`unknown-outcome` alert in the same transaction.
- **Fable reviews T2 itself** (this is the double-post risk): read the SQL and the "same key before/after" DB test; run the fake re-approve → tick → `findExisting` → no second publish test.
- **Opus implementer T3** (UI + runbook), plain Tailwind; Fable reviews only the phone shot and that Confirm is disabled until every box is ticked.

## 3. F9 T3 once probe output exists (≈ 10%, Opus)
Only if the creator has pasted `ig.reel_insights`, `ig.reel_insight_shape`, `ig.media_fields_shape`, `yt.video_stats_shape` into chat or `docs/research.md`. One Opus implementer updates fixtures + parsers in `packages/analytics/src/sources.ts` with `// verified <date> probe <line>`; a scout diffs the probed shapes against the fixtures first. Fable reviews only the scout's mismatch list. **No output → skip and list under "Needs you".**

## 4. Final cross-cutting review (≈ 15%)
- Scout: list every new SQL write on the branch (`update|insert`) with file:line, every new env name, every new route/action (guard test coverage), and run the leak scanner.
- Fable: check the list against non-negotiables 2, 3, 4, 5, 6 (approval gate, no double posts, no secrets, no location, no deletes). Then `pnpm typecheck`, `pnpm test` with `DATABASE_URL`, both simulations, web build.
- Write `docs/prep/run-4-plan.md` (delegate the drafting; F12 restyle is next).

## Not for run 3
- **F12 UI restyle**: waits for the design session's system (`design/ui-system-2026-11-13`). Don't touch `apps/web/components/ui/` or the design block in `globals.css`.
- Anything live: first Snapchat share, enabling push on the phone, applying 0008, VAPID keys: creator tasks.

## Token estimate (whole run)
| Item | Haiku scouts | Opus implementers | Fable |
|---|---|---|---|
| 1 Review | ~150k | ~150k (fixes) | ~90k |
| 2 F11 | ~60k | ~400k | ~80k |
| 3 F9 T3 | ~30k | ~100k | ~10k |
| 4 Final | ~60k | ~50k | ~40k |
| **Total** | ~300k | ~700k | **~220k (≈ 18%)** |
