# Run 3 plan (written at the end of Fable run 2, 2026-11-13)

Read with `docs/fable-lead.md`, `docs/prep/codebase-map.md` (snapshot of `main` @ `290d430`, so F2/F3 files are missing from it) and the drafts `docs/design/F8.md`, `F10.md`, `F9.md`. Line numbers below were grepped on branch `fable/run-2-2026-11-13` @ `bbdcefb` plus the uncommitted F7 working tree at about 06:35 UTC. Re-grep before citing them in a spec.

## What run 2 finished
**F2: done.** Commits `44b76b8` … `2ff02d2`.
- Migration `0006_auth_approval.sql`: auth tables, `approved_at` / `approved_session`, `batch_item_events`, status CHECK (`:84-86`, NOT VALID → VALIDATE), backfill.
- Passkey login (`@simplewebauthn` 14), `apps/web/middleware.ts` (cookie shape only), and `requireSession()` on every DB page, action and route. The static test is `apps/web/lib/auth/__tests__/guarded-pages.test.ts`.
- Batch domain in `apps/web/lib/batches/{warnings,transitions,view-model,context}.ts` and `PgBatchStore`.
- Approval UI at `/batches` and `/batches/[id]` (week grid, chips, confirm sheet).
- Worker gate: `listDue` requires `approved_at` and an approved batch.
- `tiktokDraft` is stored in `trial`. `schedule-catchup --approve` stamps and audits.
- Runbooks: `login.md`, `migrations.md`, `dashboard-password.md`.

**F3: done on fakes, shadow mode everywhere.**
- `0007_engagement.sql` and `@autopilot/engagement`: rules, pools, rotation, planner, Anthropic and fake triage, DM drafts, gate/kill/send tick (`e84044c`), fakes.
- Comment sources (`9a7a90e`): IG list/reply/hide; YouTube read-only with a gated insert; TikTok stub; IG DM read-only.
- `simulate-engagement`, plus a CI step (`.github/workflows/ci.yml:32` runs both simulations).
- Runbook `docs/runbooks/engagement.md`.
- Inbox UI (`430b22b`, `bee2ce2`): flagged/shadow/sent/DMs, kill switch, per-platform mode with live confirm and an audit alert.
- Worker jobs and `PgEngagementStore` (`e78343f`). The jobs are `engagement-poll` (5 min), `engagement-triage` (1 min), `engagement-send` (1 min) and `dm-poll`, which is gated on `dmPollVerified`.
- The checkpoint is `bbdcefb` ("F2 + F3 done on fakes; F7 in progress").

**F7: mid-way.**
- **Committed:**
  - R2 / A2 worker run mode (`8a5346c`, `apps/worker/src/run-mode.ts`, `WORKER_LIVE` in `.env.example`)
  - R7 engagement red-team (`4955c5d`, `packages/engagement/src/__tests__/redteam-*.test.ts`)
  - `ae2215a` (EngagementStore markCancelled / listStaleSending)
  - R6 auth re-review (`28a5866`: route scan, first-await `requireSession`, action tests, `/snap-test` static check)
- **In progress (uncommitted at the time of writing), engine side, adapters and scanner:**
  - A3 IG caption normalisation (`instagram.ts`, fixture `ig-media-list-normalised.json`)
  - A4 `UploadAmbiguousError` (`http.ts`, `youtube.ts`)
  - `packages/core/src/log/sanitize.ts`, plus edits in `token-health.ts` and `engine.ts`
  - `outbox-engine-redteam.test.ts`
  - voice-lint tests
- Check `git log` for which of these landed before the PR.

## What's left
### F7 rows with no trace in the tree (verified by grep)
| id | State | Pointer |
|---|---|---|
| A2 | Done (`8a5346c`). | `apps/worker/src/run-mode.ts`, `apps/worker/src/index.ts:29-44` |
| A3 / A4 | Done in tree; needs commit and review. | `instagram.ts:128-135`, `youtube.ts` PUT block |
| A8 | Partly covered: the crash test at `packages/core/src/__tests__/outbox-engine.test.ts:149-170` recovers via lookup, but it doesn't assert `publish` was called exactly once. | engine `markPublished` at `packages/core/src/outbox/engine.ts:127,186,208` |
| A9 | Open. `boss.work(QUEUES.outboxTick, …)` has no concurrency option, and there's no tick lock and no concurrent-tick test. | `apps/worker/src/jobs/register-outbox.ts:8,17` |
| A11 | Open. A null `r2_key` still becomes `${base}/`. | `apps/worker/src/jobs/outbox.ts:76` |
| B1–B3 | `sanitize.ts` in progress; check wiring. | Wire into `outbox.ts:162` (`recordAlert`), `outbox.ts:176` (`[alert]` console line), `token-health.ts:24`, `engagement-store.ts:206`, and the engine's `last_error` writes |
| B4 | Open: no YT-refresh or Zernio-key shapes in the probe redaction tests. | `scripts/probes/lib.ts`, `scripts/probes/__tests__/lib.test.ts` |
| B9 | Open: `scripts/check-public-leaks.mjs` doesn't exist and CI has no step for it. | `.github/workflows/ci.yml:29-32` |
| C1 | Open: no re-probe of `cleanPath` with `findLocationTagKeys` before upload. | `tools/ingest-agent/src/index.ts:68-71` |
| C3 | Open: `LOCATION_FIELDS` lacks `geo`, `coordinates`, `latitude`, `longitude`, `lat`, `lng`. | `packages/adapters/src/http.ts:42` |
| C4 | Open: there are no 📍 or ZIP/postcode rules. The market-session allowlist exists only in engagement (`packages/engagement/src/rules.ts:43-46`), not in the caption lint. | `packages/research/src/voice-lint.ts:51-56,77-83` |
| C5 | Open: no publish-time lint. | before `adapter.publish` at `packages/core/src/outbox/engine.ts:201` |
| D3 / D4 / D7 | Creator day tasks (below); R6 added a `/snap-test` static check. | `scripts/check-exposure.sh`; `infra/docker-compose.yml:43` (db is `127.0.0.1:5432` only, looks right); `infra/Caddyfile:24-28` + `infra/static/snap-test.html` (no media; the caption default is "test caption — ignore") |
| E6 | Open: the sim script has no YouTube post-upload 5xx and no IG caption normalisation case. | `packages/core/src/sim/simulate-week.ts:82-97` (`scriptFor`) |

### Other loose ends
- **Retry/reset for `failed` / `unknown` items.** `docs/runbooks/failed-or-unknown-post.md:5` says "'Re-approve' below has no app button yet". `transitions.ts:56,101,111,122` refuse every action on handed-off rows. This needs its own small design: "I checked, it's not there" → `draft`, keeping the same `idempotency_key` (F7 A5), plus an event, with the confirm sheet showing what was checked. Don't fold it into F8.
- **Alert typing.** `AlertRow.platform` is `Platform` (`packages/db/src/types.ts:87`), but rows also hold `'web'` (`apps/web/lib/auth/alerts.ts:8`) and `'meta'`, `'youtube'` or `'zernio'` (token-health services, `packages/adapters/src/token-health.ts:14`; written at `apps/worker/src/jobs/token-health.ts:24`). Widen it to `AlertSource`. This is F8 T1.
- **Dev DB test batches.** `apps/web/lib/batches/__tests__/pg-store.db.test.ts:14` uses week `2099-01-05`. The local dev DB has two such batches, one of them extra. It's local only, but deleting rows needs the creator's OK (non-negotiable 6). Ask, or make the test reuse its batch.
- **Hygiene.** `pnpm-lock.yaml` changed in `430b22b` (web dep for the inbox); confirm `pnpm install --frozen-lockfile` passes on the PR. In `.env.example`, `WORKER_LIVE` is now present (uncommitted) and `PRIVACY_BLOCKLIST` is at `:64`. The VAPID names come with F8.
- **DM endpoint.** The code uses `${igUserId}/conversations?platform=instagram` (`packages/adapters/src/comments/dm-instagram.ts:65`). `docs/research.md:195` says the Facebook Login variant is `/me/conversations` with the Page token. This stays open until the creator runs the `dm_read` probe line. `dm-poll` stays disabled.
- **YouTube `force-ssl` re-consent.** Replies stay off until it's granted: `YT_COMMENT_REPLIES` (`.env.example:31`; `packages/adapters/src/comments/index.ts:40`). The creator runs `pnpm probe:yt --auth` on the laptop, ticks every box, then reads the `scopes` probe line.
- **Probes the creator runs (read-only).** `./infra/probe.sh ig` → `comment_fields`, `dm_read`. `./infra/probe.sh yt` → `scopes`, `comment_threads`. These are documented at `docs/research.md:197`. F9 adds metric-shape lines (see F9.md).

### Creator day tasks (collect these under "Needs you")
1. Merge, then back up and apply migrations 0006 and 0007 (and 0008 after F8), then `docker compose up -d --build` (`docs/runbooks/migrations.md`).
2. Enrol the passkey (`docs/runbooks/login.md`).
3. D3: run `scripts/check-exposure.sh` after deploy, and expect `/app/login` to return 401 behind the gate.
4. D4: confirm on the server that `docker compose ps` shows db bound to loopback only.
5. D7: confirm `/snap-test` serves only the static page.
6. Run the probe lines above and paste the one-line summaries into chat.
7. Add `WORKER_LIVE=1` to the server `.env` **only when** you want the worker live. The one-shot `--live` run keeps working.

## Next items, in order
1. **F8 · Alerts page + PWA push** (`docs/design/F8.md`). Alerts now come from four writers: the outbox (`outbox.ts:162`), token-health (`token-health.ts:24`), auth (`lib/auth/alerts.ts:8`), and engagement (`engagement-store.ts:206`, `lib/engagement/queries.ts:189`). The phone shows only a count (`apps/web/app/page.tsx:14,43`). Kill-trips and unknown outcomes need a human within minutes, and push closes that loop. It also unblocks the PWA install (icons), which F10's share flow benefits from on iOS.
2. **F10 · Snapchat handoff page** (`docs/design/F10.md`). It's small and unblocks a whole platform via the assisted route. `buildSnapchatHandoff`, `snapchatCaption` and `SNAPCHAT_CHECKLIST` (`packages/adapters/src/snapchat.ts`) and `pickSnapchatDaily` (`packages/analytics/src/snapchat.ts:40`) already exist. Snapchat items are scheduled (cadence `snapchat: {days: 2}`, cap 1, `packages/core/src/cadence.ts:65,70`), but the engine skips them because there's no adapter (`engine.ts:146-150`), so today they sit in `approved` forever.
3. **F9 · Analytics ingest wiring** (`docs/design/F9.md`). `ingestOnce` (`packages/analytics/src/ingest.ts:55`) and `writeSnapshot` (`store.ts:79-84`, already idempotent via 0004's unique key) exist, but no worker job runs them. The parsers were written from docs, not live responses, so the run needs probe output first (a creator day task). That's why it's third. Its T1 (probe lines) can ship early so the creator can run them before the run reaches F9.

F7 leftovers can fill gaps between items. Do the A11 and C5 rows before any live batch, because each is a one-implementer task on `outbox.ts` / `engine.ts`. Don't run them in parallel with each other (shared engine).

Migration numbers: F8 takes **0008**; F9 and F10 need none.

## Lessons from run 2
- **Parallelism burned both windows.** Five Opus implementers in parallel plus the lead used up the first 5-hour window in 41 minutes (01:14 → 01:55 UTC). The second window (06:10 → about 07:50 UTC) also closed, with six agents running. → **Cap at 3 parallel implementers.** Expect about 2 windows for a run of this size (two backlog items plus red-team), and checkpoint (commit + night log) after **every** finished task.
- **The lead's `git commit -a` swept another agent's tracked edits into an unrelated commit.** → Always stage explicit paths (`git add <files>`). Never use `-a` or `git add .` while implementers are working.
- **Reusing an implementer for the next task in its area (SendMessage) saved re-reading** the package. Prefer that over spawning a fresh agent for adjacent work.
- **Scouts worked well for fact packs.** The lead wrote only schema, types and interfaces, and that split held up.
- **The guard hook blocks any Bash text containing `truncate`**, even the Tailwind class. Implementers used Write/Edit for those files. Tell UI implementers up front.
- **The lead's share of cost was 58%** at the checkpoint report (`docs/night-reports/night-2026-11-13.html`, KPI "lead (Fable) share of cost · target < 25%"). That's more than twice the target. Fewer lead reads, more scout summaries, and specs written once rather than iterated in the lead's context. Re-read the final report's KPI, because that number came from the mid-run checkpoint.
