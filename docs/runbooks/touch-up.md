# Touch-up: what gets flagged, and "Fix it"

Code: `packages/media/src/qa.ts` (QA v2), `packages/media/src/fix.ts` (fix engine), `apps/worker/src/jobs/media-fix.ts`
and `media-recheck.ts` (worker), `apps/web/lib/library/` (loaders + actions). Migration `0014_media_fix.sql`.

## What gets flagged now

QA results are structured: each issue has a severity. **Only `fix` issues show in Touch-up.** `info`
issues are tags on the clip in the library ("No sound yet", "Landscape") and never count as flagged.

| Issue | Flagged when | Severity | Fix it does |
|---|---|---|---|
| Frozen start / end | Bit-for-bit still frames for 2 s or more that touch the first or last 0.5 s | fix | Trims them off |
| Mostly still | Frozen time is over 40% of the clip | fix, not fixable | Nothing: re-export it |
| Still moment | A still segment of 5 s or more in the middle | info | — |
| Black start / end | Black frames for 0.5 s or more touching an end | fix | Trims them off |
| Black moment | 2 s or more of black in the middle | info | — |
| No sound yet | No audio track, or quieter than −50 LUFS (music added later) | info | — |
| Loudness | Audio outside −14 ± 4 LUFS, or peaks above −1 dBTP | fix | Two-pass loudness normalize to −14 LUFS / −1.5 dBTP |
| Silent pauses | Gaps of 1.5 s or more mid-clip in speech-level audio | info | Optional "Remove silent gaps" (off in bulk: it changes the pacing) |
| Format | Not H.264/AAC in MP4/MOV, odd size, above 60 fps, not 8-bit 4:2:0, bitrate above 60 Mb/s | fix | Re-encode: H.264 high, yuv420p, AAC 48 kHz, `+faststart` |
| Rotation | The file relies on a rotation flag | fix | Re-encode with the rotation baked in |
| Aspect | Near-vertical (4:5, 3:4) instead of 9:16 | fix | Pad to 1080×1920 with a blurred copy behind |
| Landscape / Square | Wider than 4:5 | info | Never auto-fixed |
| Metadata | Location or phone make/model tags still present | fix | Strip (every fix strips anyway) |

Leading and trailing silence is not an issue. Freeze detection is `freezedetect=n=-60dB:d=2`, **confirmed
by a block-change check** (`mpdecimate`): freezedetect averages over the whole frame, so a moving cursor on
a static screen recording would otherwise read as frozen. A freeze only counts where no 8×8 block changed.

The calibration test (`packages/media/src/__tests__/qa-calibration.integration.test.ts`) keeps this
honest: a tripod talking head, a gym set, a music-later (silent) clip and a screen recording must come out
with zero `fix` issues.

## What "Fix it" does

- Runs in the **worker** (always on, reads the clean file from R2), one fix at a time, every minute.
- The original is **never changed or removed**. A fix makes a **new media row** (`derived_from` = the
  original) through the same steps as an ingest: strip metadata → probe → QA → hash → upload
  (`library/<hash>.mp4`) → poster (`posters/<hash>.jpg`).
- Guard rails: refuses (status `failed`, reason in plain words) when the result would be under 1 s or
  more than 30% shorter; ffmpeg is killed after 15 minutes; temp files live in a per-job folder that is
  removed afterwards (temp files only).
- Then you pick **Keep the fix** or **Keep the original**. Keep the fix moves **draft** calendar items to
  the fixed clip (each move is logged in `batch_item_events`). Approved or handed-off items keep the file
  you approved; the result says how many stayed. Keep the original hides the fixed copy. Nothing is deleted
  either way.
- Dismiss hides one issue on one clip (`touchup_dismissals`, never deleted).

## Worker setup

- `apps/worker/Dockerfile` installs the Alpine `ffmpeg` package (`RUN apk add --no-cache ffmpeg`) and copies
  `packages/media`. **Untested build**: there is no Docker in the agent environment. The first
  `docker compose up -d --build` is the real test.
- Env names (same as the laptop ingest agent): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_MEDIA`. Values live in `.env` only. The worker needs read and write on the media bucket.
- If ffmpeg is missing, each fix fails with "ffmpeg is not installed in the worker" and ONE `config`
  alert is raised (deduped while it is unacknowledged). If R2 is not set, the same happens with a storage
  message.

## Old clips (before QA v2)

Old warnings ("3 frozen-frame segment(s)", "effectively silent") can't be trusted. The app reads them
through a mapper: "effectively silent" becomes the `No sound yet` tag; frozen/black counts become
`Re-check pending` (not flagged). The worker's `media-recheck` job re-runs QA v2 from R2 on at most
5 old clips every 10 minutes and stores the result (`media.qa`, `media.qa_checked_at`). It only reads
the file and rewrites those two columns.

To see progress (read-only):

```sql
select count(*) filter (where qa->>'version' = '2') as v2, count(*) as total from media;
```

## Laptop ingest

Both ingest flows store QA v2 for new clips. `pnpm ingest` drops the metadata and loudness issues that
its own touch-up step fixes (`qaAfterTouchUp`), so the stored result describes the clean copy.
`pnpm ingest:ready` does not do this yet (follow-up in `tools/ingest-agent/src/ready/run.ts`), so its
clips can show a metadata or loudness flag that the strip already handled; "Fix it" clears it.
