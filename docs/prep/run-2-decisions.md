# Run 2: answers, corrections and tools (read this before the design docs)

Written 2026-11-12 by the day session after reviewing the prep pack. **Where this file and `docs/design/F2|F3|F7.md` disagree, this file wins.** Every open question in the drafts is answered here, so the run doesn't need to stop and ask. Record any new decision you make in the night log under "decisions".

## Order and budget
- Order: **F2 → F3 → F7.** Finish F2 completely (green, checkpointed) before starting F3.
- The weekly allowance is low (it resets Tue 2026-11-17). If budget gets tight, use this priority within an item:
  - **F3:** T1–T8 + T10 (engine, worker, simulate-engagement) before T9 (inbox UI).
  - **F7:** R1, R3, R5 (double-post, secrets, location) before the rest.
- A half-done item is worth less than a finished one. If the remaining budget clearly can't finish the next item, stop after the checkpoint and list the item in "Pick up next".

## Corrections to the drafts (must do)
1. **F2 T1, migration 0006 must backfill, or deploying F2 stops real posts.** The new worker gate (F2 T8) only fires items with `approved_at` set in a batch with `status='approved'`. Production already has approved and published rows from the catch-up batch and the first real posts. So 0006 also needs:
   - `update batch_items set approved_at = coalesce(approved_at, now()) where status in ('approved','queued','publishing','published','unknown','failed');`
   - `update batches b set status='approved', approved_at=coalesce(b.approved_at, now()) where exists (select 1 from batch_items bi where bi.batch_id=b.id and bi.approved_at is not null);`

   Add a test that reads the SQL file and checks both statements are there. The creator applies 0006 on the server.
2. **F2: update the dev seed (`scripts/dev/seed.ts`)** so its approved batch has `approved_at` on the batch and items. Otherwise the local stack and the demo show nothing due after T8.
3. **F2, enrol CLI location:** the web image is `output: standalone` and may not contain `scripts/`, `tsx` or `pnpm`. Check `apps/web/Dockerfile` and `apps/worker/Dockerfile`, and make `auth:enroll` / `auth:revoke-all` runnable on the server with the images that exist. The worker image, or `docker compose run --rm` with a command that exists in the image, are both fine. Then write the exact command into `docs/runbooks/login.md`.
4. **F3, platform facts are now verified.** IG list/reply/hide, the DM read endpoints and YouTube comment costs and scopes are in the verification log at the end of `docs/research.md` ("Comments + DMs for engagement"). Use those endpoints (with a `// verified 2026-11-12 <url>` comment), not stubs.
   - The remaining unknowns (`from` fields in Development mode, DM read access, YT `force-ssl` granted) are answered by probe lines the creator runs. If their results were appended to research.md before this run, use them. If not, keep the draft defaults: YT read-only + shadow, `dm-poll` disabled, per-person limits keyed on `from.id` when present.
5. **F3, the AI client:** reuse the working pattern in `scripts/probes/anthropic.ts`: the official `@anthropic-ai/sdk`, `client.messages.parse` with `zodOutputFormat` (zod v4). The model comes from `ANTHROPIC_MODEL`. Don't write a raw-fetch client.
6. **F7 A2, second live key:** the creator posts for real today with a one-shot container run that passes `DRY_RUN=false` **and** `--live`. Keep that working. The worker goes live only when `DRY_RUN=false` **and** (`--live` in argv **or** `WORKER_LIVE=1`), and refuses otherwise with a one-line reason. Add `WORKER_LIVE` (name only) to `.env.example`. Don't change `infra/docker-compose.yml` defaults. List the needed `.env` change for the creator under "Needs you".

## Open questions → answers
**F2**
1. Caddy gate stays; the passkey session sits behind it. **Yes.**
2. Session: **30-day sliding, 90-day hard cap, "log out everywhere".**
3. CHECK constraint on `batch_items.status`: **yes**, in 0006, covering every value the code writes plus `rejected`. Use `NOT VALID` then `VALIDATE`. Before writing it, grep the code for every status written.
4. AI captions in the web: **no.** Hand edits only.
5. `schedule-catchup.mjs --approve`: **keep it.** It also stamps `approved_at` (batch + items) and writes a `batch_item_events` row with `kind='approve-cli'`.
6. Approve with warn-level issues: **allowed**, with chips and counts in the confirm sheet.
7. Editing an approved item: **back to draft, re-approve.**
- WebAuthn libs: `@simplewebauthn/server` + `@simplewebauthn/browser`, exact versions published at least 2 weeks ago. **Pre-approved** (dev and runtime deps are both fine; they're free).

**F3**
1. Per-person rule: **max 1 auto-reply per person per 7 days**, and no text reuse to that person for 30 days.
2. YT replies: **shadow + read-only until `force-ssl` is confirmed**; the code path for `comments.insert` exists and is tested on fixtures.
3. DMs: **`dm-poll` disabled by default** (setting `dm_poll_verified=false`) until the probe confirms it.
4. Missing author ids: **as drafted.**
5. Auto-hide: **off by default.**
6. TikTok comments: **out** (free plan). Stub only.
7. Caps: **10/h and 40/day per platform, 80/day global, 10-minute veto delay.**
- Everything ships in **shadow mode**. Turning any platform to `live` is the creator's call in a day session, never this run.

**F7**
1. Second live key: see correction 6.
2. "NY session" etc. are **allowed** (market sessions, not places): a small allowlist with tests.
3. CI Postgres service: **not needed.** Real Postgres is available locally (below), so add DB integration tests that **skip when `DATABASE_URL` is unset**. CI stays as is.
4. YouTube error after the upload started → `unknown`: **accepted.**
- **Editing `.github/workflows/ci.yml` to add steps** (leak scanner, `simulate-week`) is **pre-approved**. Never remove a step, and never skip, disable or quarantine a test.

## Tools you have in this container (verified 2026-11-12)
- **A real Postgres 16 is preinstalled.**
  - `bash scripts/dev/local-stack.sh` starts it, creates `autopilot_dev`, applies all migrations and loads the demo seed (56 clips, 168 published items, creators, ideas, hooks).
  - Then `export DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_dev`. These are throwaway local credentials, not secrets.
  - Use it to test new migrations (apply 0006/0007 for real) and to write DB integration tests for the pg stores.
- **The web app builds and runs:** `cd apps/web && pnpm build && PORT=3100 pnpm start` (with `DATABASE_URL` set).
- **Phone screenshots:** `node scripts/dev/phone-shot.mjs /app/batches logs/batches.png [--full]` (iPhone 13 viewport, Chromium is preinstalled), then view the PNG with the Read tool.
  - Images cost tokens, so take a few at the end of a UI task, not after every tweak.
  - For the passkey-protected pages, add a dev-only bypass for screenshots, e.g. a session created by a test helper. It must be impossible in production: gated on `NODE_ENV !== 'production'` **and** a localhost DB URL, with a test proving both.
- `pnpm install` takes about 3 s. Typecheck and tests take about 10 s together.
