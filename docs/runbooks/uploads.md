# Uploads: laptop or phone → Library (F23)

Code: `apps/web/lib/uploads/` (rules `validate.ts`, data layer `data.ts`, route cores `http.ts`),
`apps/web/app/library/upload-actions.ts` (check + start), routes under `apps/web/app/media/upload/`
(part / complete / abort / status), `packages/media/src/storage.ts` (R2 multipart), worker
`apps/worker/src/jobs/media-ingest.ts` (`media-ingest-tick`). Migration `0017_uploads.sql`.

## What it does

1. The Upload page asks which picked files are **already in** (same file name + size as an upload that
   finished as done/duplicate) and skips those.
2. Each new file (mp4/mov/m4v, up to **2 GB**, up to **200 per batch**) goes **through our server** in 8 MB
   parts into a private R2 multipart upload at `incoming/<uploadId>.<ext>`. No R2 CORS, no keys in the
   browser. A failed part is simply sent again.
3. **Complete** → status `uploaded`. Once a minute the worker takes one: download → remux with **all metadata
   and chapters dropped** (GPS / QuickTime location included) → re-probe, and **refuse** if any location tag
   survived → QA → poster → `library/<sha256>.mp4` + `posters/<sha256>.jpg` → a Library clip.
   - Only the **file name** is kept (never the laptop path). A folder pick labels the clip with the file's
     **parent folder name** (e.g. "Upper body"); names folder rules refuse (over 60 chars, control
     characters) leave it unlabelled.
   - Same clean bytes as a clip already in the Library → status `duplicate`, pointing at that clip.
   - Touch-up auto-fix (if on) queues the usual default fix for a newly flagged clip.
4. The raw `incoming/` object is **deleted** right after done/duplicate, and when an upload is cancelled.
   After a **failure** it's kept 24 h (to look into it), then the worker deletes it. An upload left
   unfinished for 24 h is closed (`aborted`, "The upload was never finished.") and its parts dropped.

**Nothing is posted.** New clips appear in the Library like any other; posting goes through the calendar /
Approve & schedule as usual.

## Setup (one time)

1. **Back up, then apply migration 0017** (adds the `uploads` table; additive only, re-running is safe).
   Follow [migrations.md](migrations.md): back up → tunnel → migrate. Expect `applied: 0017_uploads.sql`.
   Until it's applied, the Upload page errors and the worker's ingest tick logs a failed query each minute.
2. **R2 env** on **both** services (same names as Touch-up / reels, `.env` only, never committed):
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA`.
   - **web** now writes the multipart uploads (it already needed R2 for sounds). Missing → "Storage (R2)
     isn't set up on the server, so uploads are off."
   - **worker** reads `incoming/`, writes `library/` + `posters/`, deletes `incoming/`. Missing → uploads
     wait in `uploaded` (not failed) with one "Uploads are waiting" config alert.
   - Both read the shared `../.env` (`env_file` in `infra/docker-compose.yml`). The key needs
     read/write/delete on the media bucket only (multipart is part of write).
3. **Deploy** ([deploy.md](deploy.md)). No Caddy change: Caddy has no body-size limit by default, and an
   8 MB part is under Next's 10 MB middleware body buffer (`middlewareClientMaxBodySize`), so
   `next.config.mjs` is unchanged.
4. **Disk:** the worker needs free temp space of about **2× the largest file** (raw copy + clean copy, the
   raw copy is removed as soon as the clean one exists).

## If something's off

| Symptom | Cause | Fix |
|---|---|---|
| "uploads are off" on the Upload page | R2 env missing on web | Add the four R2 vars, redeploy |
| "Uploads are waiting: Storage (R2) is not set up in the worker" | R2 env missing on the worker | Add the R2 vars, redeploy; waiting uploads continue by themselves |
| "Uploads are waiting: ffmpeg is not installed" | Worker image without ffmpeg | Rebuild the worker image |
| Failed "Location details survived the clean-up" | A tag the strip couldn't drop | Export the clip again without location (or screen-record it), re-upload |
| Failed "Processing was interrupted" | Worker restarted mid-file (after 2 h it's marked failed) | Upload it again |
| Failed "Processing failed (storage error or a damaged file)" | R2 hiccup or an unreadable file | Upload it again; if it repeats, check the file plays on the laptop |
| A file shows "already in" but isn't in the Library | It was a duplicate of another clip | Look for the clip it points at |
