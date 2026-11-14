# Run 4 Fable brief: review items only

Branch `day/build-2026-11-14`. Each hunk carries a "Fable to review" marker in the code. Judge the question, then approve, fix, or send back. Everything else on the branch is not for Fable. Already approved in run 3, skip: `pg-store.ts:97`, `alert-push-core.ts:1`.

Token estimates are lines x ~12.

## Hunks

### 1. Outbox tick lock (F13 T2): `apps/worker/src/jobs/outbox.ts:310-350` (+ `tickBody` 352-369)
Takes `pg_try_advisory_lock(OUTBOX_LOCK_KEY)` on a dedicated pooled client before the tick; busy means skip the tick (log, zero result). The tick itself runs on the pool; the client only owns the lock. Unlock in `finally`, then `release`. Without `pool.connect` it runs unlocked and logs once.
Question: is it the same client for lock and unlock on every path, and does `release(err)` destroy the connection when the lock state is unknown (lock query throws, unlock throws)? Is the lock taken before the media-base check (config alert path is serialised too)? Any path where the lock leaks or a second tick runs concurrently? Dry-run takes it too: intended?
Read: ~80 lines, ~1.0k tokens.

### 2. Scheduler window / sameDay / flex grid (F15 T1): `packages/core/src/scheduler.ts:178, 265, 337, 368`
Items with `window` or `sameDay` get placed inside [notBefore, notAfter): grid slots first, then (sameDay only) a flex grid every `minGapMinutes` from each posting window start to end. Stagger is ignored for sameDay. Unplaced reasons: "cap" if every usable time sat on a capped day, else "no-slot". Items without window/sameDay must keep the exact pre-F15 path. Window items never spill outside the window.
Question: does cap counting (`underCap`/`bump`) include existing posts across the whole local day, not only the window part? Is it DST-safe (windowDates via localDate of start and end-1, localToUtc per date; 23/25 h days; flex minutes-of-day near the change)? Is `gapOk` and the same-instant check right when `minGapMinutes` is 0? Is `windowReason` correct (returns "no-slot" as soon as any usable time is under cap)? Does the non-window path stay byte-identical in outcome?
Read: ~200 lines (178-275, 330-406), ~2.4k tokens.

### 3. Editor item write (F15 T2): `tools/ingest-agent/src/ready/write.ts:103-173`
One transaction per render. Per week (sorted): `pg_advisory_xact_lock(hashtext('batch-week:<week>'))`, newest non-archived batch for the week or a new draft batch. Each item inserts with `on conflict (ingest_key) where ingest_key is not null do nothing returning id`; only inserted rows get an `add` event and a `ready-for-approval` alert. Batch status untouched, only `updated_at`.
Question: is the week-lock order (sorted) deadlock-free against the web app's batch writers? Is the conflict target equal to the 0009 partial unique index predicate so Postgres infers it? Alerts and events only for inserted rows (re-run creates none)? Does the app's media upsert fallback (outside this hunk, same file above line 70 and the caller) behave on a second laptop or a race? Can a half-written render ever commit?
Read: ~70 lines (+ caller glance), ~0.9k tokens.

### 4. Editor slotting plan (F15 T2): `tools/ingest-agent/src/ready/plan.ts:60-94`
`readyWindow` turns the sidecar `when` (today / tomorrow / this-week) plus `earliest` into [notBefore, notAfter) through `localToUtc` on calendar dates; `existingRange` widens to whole local weeks plus 24 h back for the TikTok draft limit.
Question: today's window starts at max(now, earliest): correct when `earliest` has already passed? this-week ends at the Monday after the local Sunday: right on Sunday? Any DST error at the day edges? Does `existingRange` cover every post the caps could count (cap day vs week boundaries)?
Read: ~35 lines, ~0.4k tokens.

### 5. One-tap approve (F15 T3): `apps/web/lib/editor/approve.ts:15-72`
`planRenderApprove`: each id goes through `planTransition('approve')` alone; passes are then approved together via `planTransition` again; non-editor items and any block warning stay. `approveRender` loads fresh warnings server side, plans, applies in one store transaction.
Question: any way to approve an item with a block warning, or one that is not an editor draft (form-supplied warnings, ids from another batch, duplicate ids)? Is "approve" here exactly the batch-screen approval (approved_at stamp, event, session id)? Is the unreachable `!plan.ok` branch safe (never applies)?
Read: ~58 lines, ~0.7k tokens.

### 6. Move to tomorrow (F15 T3): `apps/web/lib/editor/slotting.ts:25-63` (+ `slotTomorrow` 65-101)
All-or-nothing: every item becomes its own ScheduleItem with `window` = creator-local tomorrow narrowed by `trial.editor.earliest`, `sameDay: true`; `existing` = every other live post, drafts included; caps from the stored cadence. Any unplaced item returns an error and no slots.
Question: is the all-or-nothing contract held (including the final per-item check)? Is `earliest` respected when it is before tomorrow's start (it is ignored then: right)? Does `slotTomorrow` exclude the moved items themselves from `existing` and only read? Are caps counted across the whole local day for tomorrow?
Read: ~100 lines, ~1.2k tokens.

### 7. YouTube findExisting (F13 T3): `packages/adapters/src/youtube.ts:35-66, 140-193`
Title match on the owner's uploads playlist (`channels.list` once, then `playlistItems.list` maxResults 25, `part=snippet,status`), matched by normalised title and `snippet.publishedAt` (upload time) inside [scheduledFor - 14 d, scheduledFor + 36 h]. Hit gives videoId and URL; a clean miss returns null; non-2xx, malformed body, or a title match without a readable time throws (outcome stays unknown).
Question: visibility of private/scheduled uploads in the uploads playlist is UNVERIFIED (docs blocked by the proxy). A null on a retry still resends as before, so the worst case is the old behaviour. Is that acceptable for non-negotiable 3 (no double posts)? Is the window right given upload happens ~24 h ahead? maxResults 25 enough? Is the cached `uploadsPlaylistId` safe?
Read: ~100 lines, ~1.2k tokens.

## Budget
Hunk total ~690 lines, about 8.3k tokens, plus surrounding context and the design docs (F13, F15, ~6-8k) and test glances: plan on ~25k tokens of reading. Target Fable share of the run: under 25%.

## Open decisions for Fable
a. **Default caps 5 apply on deploy** because the VPS cadence row is `{}` (defaults fill in). Keep 5, or pin 4 in the migration/settings so nothing changes until the creator chooses?
b. **YouTube findExisting stays** although playlist visibility of private/scheduled uploads is unverified. Keep (a miss behaves as before) or drop until verified?
c. **`caption.missing` applies to all items**, not just editor items. Keep (safer) or limit to editor items?
