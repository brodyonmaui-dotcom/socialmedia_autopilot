# Run 4 plan (written at the end of Fable run 3, 2026-11-14)

Read with `docs/fable-lead.md`, `docs/prep/run-4-outline.md` (the lead's priorities; they are decisions), and the drafts `docs/design/F13.md` and `F14.md`. `docs/prep/codebase-map.md` is stale since F11 T2 (refresh is item 5). Line numbers below were grepped on branch `fable/run-3-2026-11-14` at about `1a56081` plus the uncommitted F12 working tree. Re-grep before citing them in a spec. Deadline: Jan 8, 2027 (55 days left); M1's "IG + YT posting for real by Nov 21" is the milestone at risk.

## What run 3 finished
Source: `docs/night-logs/2026-11-14.json` ("done", "decisions") and `git log --oneline main..HEAD`.
- **Review pack judged** (`785cffb`): 7 open rows. Dockerfiles #2 fixed (both images copy the root `tsconfig.json`), #3 left to the creator; F11 pure #8 accepted, #11/#13 folded into T3, #12 approved; handoff-media #7 fixed.
- **F11 T2 SQL approved** as written (`19ac4ba`): reset keeps the `idempotency_key`, sets `attempts = 1`, clears `approved_at`; record-published is allowed from any failed/unknown row. The worker never touches failed/unknown rows (checked against `listDue`).
- **F11: done.** T3 `ResetSheet` (Confirm disabled until every box is ticked), stuck-item cards, record-it on every failed/unknown row except Snapchat, runbook `docs/runbooks/failed-or-unknown-post.md` (`af4c687`). `validatePostUrl` keeps "any path beyond /" (evidence only), hosts exact. IG checklist box 3 reworded to cover the auto-check "error" case.
- **Media-base guard** (`ed25c6d`): an empty or invalid `PUBLIC_MEDIA_BASE` skips the outbox tick with one deduped, page-only `config` alert (`apps/worker/src/jobs/outbox.ts:243,261,295`) instead of failing every post.
- **F12 restyle, so far:** batches list + detail, with per-card Approve as outline and "Approve all" as the single solid action (`af4c687`); Snapchat handoff with a Skip-today confirmation (`db78060`); Alerts, Inbox + DMs and Analytics (`6bcaa91`). Shots in `docs/design/ui-shots/f12/`. Earlier on the branch: shell + Home (`63a7db4`), login (`93ac332`), public site (`bd14077`).
- **Also landed on the branch:** F8 (alerts page, push job, migration 0008; `9de7424`, `7380715`), F9 T1/T2/T4/T5 (probe shape lines, hourly `analytics-ingest`; `148fed0`, `8f65744`), F10 Snapchat handoff page (`20ebc7b`), design system v1/v2.
- **Tests:** 1386 passed, 0 failed (132 files with `DATABASE_URL` at `af4c687`); typecheck 0 errors; web build compiled. Re-run after the last F12 commit.

## What's left
| Item | State | Pointer |
|---|---|---|
| F12 Library + touch-up (task 5) | Not committed. Working tree has `apps/web/lib/library/` untracked; pages `apps/web/app/library`, `apps/web/app/touch-up` still old style. | `docs/design/ui-system.md` (Restyle plan) |
| F12 Research (task 7) | In the working tree, uncommitted: edits to `apps/web/app/research/{page,ui}.tsx`, `creators/page.tsx`, `hooks/page.tsx`, `ideas/page.tsx`. Finish, review the shots, commit. | same |
| F9 T3 (analytics wiring against real shapes) | **Skipped in run 3**: none of the four probe lines is in `docs/research.md`. | `docs/research.md:198`; parsers `packages/analytics/src/` (written from docs, not live responses); job `apps/worker/src/jobs/analytics-ingest.ts` |
| Final cross-cutting review | Not run (scout lists new SQL writes, env names, routes; leak scanner). | `scripts/check-public-leaks.mjs`, `docs/prep/run-3-review-pack/` |
| PR for the run-3 branch | Not opened (`prUrl: null`). | night log |
| Codebase map | Stale since F11 T2. | `docs/prep/codebase-map.md` |
| F7 A9 (tick overlap), A11-style leftovers | A9 open: no lock, no concurrency option. Moves into F13 T2. | `register-outbox.ts:8,17`, `outbox.ts:288` |
| Stuck-row existence check on YouTube | Open: no `findExisting`. Moves into F13 T3. | `packages/adapters/src/youtube.ts:37` |
| Dev DB test batches | Still two `2099-01-05` batches; deleting needs the creator's OK (non-negotiable 6). | `apps/web/lib/batches/__tests__/pg-store.db.test.ts:14` |

### Needs you (creator day tasks)
1. **Paste the four F9 probe lines** into chat: `ig.reel_insights`, `ig.reel_insight_shape`, `ig.media_fields_shape` from `./infra/probe.sh ig`, and `yt.video_stats_shape` from `./infra/probe.sh yt` (read-only; counts and key paths only). Without them F9 T3 stays skipped. Also the F8-era lines still open: `comment_fields`, `dm_read`, `scopes`, `comment_threads`.
2. **First docker build after the merge:** both Dockerfiles now copy the root `tsconfig.json`; there is no Docker daemon in the cloud container, so `cd /opt/autopilot/infra && docker compose up -d --build` on the VPS is the real test. Tell the agent if it fails.
3. **Merge, back up, apply migrations** 0006, 0007, 0008 if not yet applied (`docs/runbooks/migrations.md`), then deploy (`docs/runbooks/deploy.md`).
4. **Enrol the passkey** (`docs/runbooks/login.md`) and **turn on push** (`docs/runbooks/alerts-push.md`: VAPID keys, Add to Home Screen, Enable, test).
5. **D3/D4/D7 checks** after deploy: `scripts/check-exposure.sh`; db bound to loopback only; `/snap-test` serves only the static page.
6. **Run the restore drill** (`infra/restore-test.sh`) once; "backup and restore proven" is still an open M0 exit criterion and F13's preflight will check it.
7. **Before any real post:** tell the agent in chat. `DRY_RUN=false`, `WORKER_LIVE=1` and `--live` stay off until the F13 T4 runbook says go and you have given the explicit OK.
8. **Decide the F14 open questions** (which clips, Sunday/Monday times, whether `batch-ready` pushes) when the run starts.

## Next items, in order
1. **F13 · Go-live readiness** (`docs/design/F13.md`; Fable gates, Opus implements). First because the Nov 21 milestone needs it, and the creator tasks above are a scattered list. T1 preflight script (also tells him what is missing on the VPS), T2 outbox tick lock (the only known way a live week could overshoot a cap), T3 YouTube `findExisting` (conditional on verifying the uploads-playlist docs; if private/scheduled videos don't show up, drop it and say so), T4 first-real-post runbook. T1-T4 touch different files; run at most 3 at once.
2. **F14 · Weekly loop in the worker** (`docs/design/F14.md`). Makes the worker "always-on" in fact. Per the AI split (`docs/decisions.md` section 4: captions are a Claude Code skill, the server only runs Haiku triage) the Sunday job leaves captions empty and flagged. T1 touches `packages/core/src/types.ts` (new kinds `batch-ready`, `report-ready`), so T1 goes first, then T2 and T3 together. The job never approves.
3. **F9 T3, conditional.** Only if the four probe lines are in `docs/research.md` by then: fix the parsers to the real shapes, add fixtures, run `ingestOnce` against them. Otherwise skip and say so in the night log.
4. **F12 leftovers.** Library + touch-up (task 5), Research (task 7, finish the tree), then one consistency pass over every page from the shots (Sonnet designer). Designers need separate `NEXT_DIST_DIR`s and ports (see Lessons).
5. **Codebase map refresh** (`docs/prep/codebase-map.md`, Haiku scout).
6. **Close-out:** final cross-cutting review (scout: new SQL writes, env names, routes, leak scanner), then the PR.

Migration numbers: F13 none; F14 none, or **0009** only if the creator wants the unique `batches(week_start)` index (F14 OQ3).

## Lessons from run 3
New this run:
- **Wait on agents by their completion notification, not by grepping transcripts.** Two false positives cost a few thousand tokens.
- **A designer can stop after its first survey command.** Resume it with SendMessage instead of respawning; the survey is not lost.
- **Parallel designers need separate `NEXT_DIST_DIR`s and ports, and no `pkill`.** The tree currently has `apps/web/.next-{alerts,analytics,inbox,research}/` left over: add them to `.gitignore` or delete them (ask first) before staging, and never `git add .`.
- **The guard hook can block a Bash command whose text only mentions a risky setting.** A heredoc doc containing the run-mode variable assignments was rejected this run; use Write/Edit for docs and tell implementers up front (same as the `truncate` hook rule below).
- **The lead's share of cost:** **44%** at the final report (KPI in `docs/night-reports/night-2026-11-14.html`; target < 25%; run 2 was 58% at checkpoint).

Still holding from run 2 (`docs/prep/run-3-plan.md`):
- **Cap at 3 parallel implementers** and checkpoint (commit + night log) after every finished task. Parallelism burned two 5-hour windows in run 2.
- **Stage explicit paths** (`git add <files>`); never `git commit -a` or `git add .` while implementers are working.
- **Reuse an implementer for adjacent work** via SendMessage; it saves re-reading the package.
- **Scouts for fact packs; the lead writes schema, types and interfaces only.** Specs are written once, not iterated in the lead's context.
- **The guard hook blocks any Bash text containing `truncate`**, including the Tailwind class. UI implementers use Write/Edit for those files.
- **Re-read the final report's KPI**, not the mid-run checkpoint number.
