# Duplicates (F26 A: duplicate guard v2)

Instagram only recommends the original of identical content (TikTok and YouTube Shorts treat re-uploads the same way), so
the app never posts the **same video** on the same platform twice within 90 days. Code: `packages/core/src/duplicate-clip.ts`
(the pure rule), `packages/core/src/video-fingerprint.ts` (hash + match), `packages/db/src/duplicate-clip.ts`
(`recentVideoUse`, the one helper every path calls), `packages/media/src/fingerprint.ts` (ffmpeg frames),
`apps/worker/src/jobs/media-fingerprint.ts` (fingerprint on insert + backfill tick). Migration `0018_video_fingerprint.sql`.

## What counts as the same video
Any of, on the same platform:
1. **Lineage:** the two clips share an ancestor through `media.derived_from` (and every clip of a Studio edit) with no new edits on
   the way: touch-up fixes, a fix of a fix, a reel made with the original sound and no real trim.
2. **Fingerprint:** `media.fingerprint` = 8 frame dHashes (9×8 grey frames at 10…80 %) + duration. Match = durations within 1.0 s
   and ≥ 6 of 8 frames within Hamming distance 10. This is what catches a re-upload of the same file (new `content_hash`) and a
   re-encoded copy. Flat frames (black, one colour) never count.
3. **Name:** the same file name (case-insensitive, folders ignored) and durations within 0.5 s. Generic names that phones and apps
   reuse (`FullSizeRender.mov`, `video.mp4`, `trim…`, `studio.mp4`, …) never match by name alone.

A reel or Studio export with **≥ 3 s of new edits** (text on screen, a new/mixed sound, other clips, or ≥ 3 s trimmed off) is
*derived footage*, not the same video: a warning only ("Uses footage you posted on Instagram on Fri Nov 20"). On Instagram the
warning adds "not as a trial reel": trial reels need new content.

## The rule
- Same video scheduled or posted within **90 days** of this post → **block** (the calendar line can't be approved):
  "This video was already posted on Instagram on Fri Nov 20", or "…is already scheduled on Instagram for …".
- Older than 90 days → a warning ("… (over 90 days apart)").
- What counts as a use: every item that is not failed and not a plain reject. An item dropped with **"Already posted on
  <Platform>: drop it"** counts as posted at its time (so dropping it never frees the video for a repost).
- The warning carries the other post's id (`Warning.itemId`) so the calendar can link "open it".

## Where it is enforced
- Every picker skips blocked clips before picking and re-checks each new item: daily-instagram, weekly-draft (a clip blocked on
  some platforms still goes to the others), the reel maker, Library "Add to calendar…" / "Approve & schedule" (also against the
  other clips picked in the same selection), and the weekly-batch skill's `createDraftBatch`.
- The calendar warning (`apps/web/lib/batches/warnings.ts`, loaded by `apps/web/lib/calendar/load.ts`).
- **The outbox, right before the platform call** (create container / upload / Zernio). Only what already went out counts there
  (published, publishing, unknown, already-posted rejects), so two approved copies never hold each other: the first goes, the
  second is held. A hold leaves the item's status unchanged, sends nothing, and raises one `duplicate-held` alert (pushed). A
  failing check also holds (fail closed).

## A `duplicate-held` alert
1. Open the week from the alert. The message names the platform and day of the earlier post.
2. If it really is the same video: tap **"Already posted on <Platform>: drop it"** (a reject with a reason; nothing is deleted).
3. If it is a different clip that was wrongly matched: swap the clip on that line (or move it to another platform). Tell the
   agent which two clips matched (open both in the Library); the thresholds live in `FINGERPRINT_MATCH` / `VIDEO_REPEAT`.
   There is no override switch on purpose: an override is exactly how the duplicates got through.
4. A held post that stays held past its time also gets the normal missed-slot handling once it is moved.

## Fingerprints
- Made on every insert path that has the clean file: browser upload (`media-ingest`), touch-up fix (`media-fix`), reel and Studio
  (`media-reel`), and the laptop's bulk `pnpm ingest` (best effort after its insert). The laptop's editor renders
  (`pnpm ingest:ready`) and all rows from before 0018 are filled by the worker's `media-fingerprint` tick: 20 clips every
  5 minutes, one ffmpeg at a time, downloading the clean file from R2. `fingerprint_at` is stamped on failure too, so a bad
  file is tried once. Check progress: `select count(*) filter (where fingerprint is not null), count(*) filter (where fingerprint_at is null) from media;`
- Until a clip has a fingerprint, lineage and name still protect it.

## Not done: linking posts made by hand in the Instagram app (`account_posts`)
`account_posts` rows with no `batch_item_id` are posts made outside the app. Linking them to library clips by fingerprint would
need the reel's `media_url` from the Graph API (an official field on the account's own media; no new scope expected, not verified at build time), but our account
source deliberately never requests it (short-lived CDN links), and matching would mean the worker downloading every new reel
from Instagram's CDN and fingerprinting Instagram's re-encode. That is a new download path, not a small change, so it is left
out. Today, a clip posted by hand is caught only when the creator drops its calendar line as "Already posted", which then counts.
