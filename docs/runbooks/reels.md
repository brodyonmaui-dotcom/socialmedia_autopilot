# Reels: sounds + "Make a reel"

Code: `packages/media/src/reel-plan.ts` (rules, pure) + `reel.ts` (ffmpeg), `packages/media/src/storage.ts` (R2
client, shared), `apps/worker/src/jobs/media-reel.ts` (worker), `apps/web/lib/reels/data.ts` +
`apps/web/app/library/reel-actions.ts` (dashboard), pages `/library/sounds` and `/library/reels`.
Migration `0015_reels.sql`.

## What it does

One library clip + an optional trim + a sound → a vertical 1080×1920 reel → a **draft** Instagram post.

- **Trim:** start/end in seconds (blank = whole clip). The reel must be 3–90 s.
- **Sound:** one of your uploaded sounds, or "Keep the clip's own sound".
  - *Replace*: the sound only. *Mix*: the sound under the clip's own audio (default sound volume 0.5).
  - The sound loops if it's shorter than the reel, is cut to length, fades in over 0.5 s and out over 1 s.
  - Volumes go from 0 to 1.5 (blank = 1, or 0.5 for the sound in a mix).
- **Look:** the clip is fitted into 1080×1920 over a blurred copy of itself (same fill as Touch-up "Aspect").
- **Loudness:** two-pass normalize to −14 LUFS / −1.5 dBTP.
- **Location:** every reel drops all metadata and chapters; the result is re-probed and refused if any
  location tag survived.
- **Caption:** required, checked with the calendar's lint (no places or real-time whereabouts, at most 5
  hashtags on Instagram, no `{{placeholders}}`, the PRIVACY_BLOCKLIST terms).

The worker makes one reel per minute (`media-reel-tick`), then:
1. uploads it as a **new library clip** (`library/<hash>.mp4` + `posters/<hash>.jpg`, `derived_from` = the
   source clip). The source clip and the sound are never changed.
2. adds **one draft Instagram item** (origin `reel`), timed at the nearest free slot from now + 2 h within
   7 days (your cadence and caps). If no slot is free, or `TZ_CREATOR` isn't set, it's left untimed.
3. raises one **"New reel ready: <topic> · instagram"** notification (no caption text).

**Nothing is approved or posted.** The draft goes out only after you approve it in the calendar, like any
other post. Failed reels show the reason on `/library/reels`; make it again after fixing the cause.

## Upload sounds

1. Library → **Sounds** (`/app/library/sounds`).
2. Pick an mp3, m4a or wav, **up to 15 MB**, optionally name it, tap **Upload**.
   - **Only use audio you own or that's royalty-free: Instagram labels it as original audio.** Licensed
     music from the Instagram app can't be added through the API; add it in the app instead.
   - The file is checked (extension and content) and stored privately in R2 as `sounds/<sha256>.<ext>`.
     The same file twice is one sound.
3. **Archive** hides a sound from the picker. Nothing is deleted; reels already made keep their audio.

## Make a reel

1. Library → open a clip → **Make a reel**.
2. Set the trim, sound, how it's used, volumes and the caption → **Make the reel**.
3. `/library/reels` shows it as Queued → Making… → **Draft ready** (with a link to its day in the calendar)
   or **Failed** (with the reason). It usually takes a minute or two.
4. Open the draft in the calendar, check it, approve it.

## Setup (one time)

1. **Back up, then apply migration 0015** (adds the `sounds` and `media_edits` tables; additive only,
   re-running is safe). Follow [migrations.md](migrations.md): back up → tunnel → migrate. Expect
   `applied: 0015_reels.sql`. Until it's applied, `/library/sounds` and `/library/reels` show an error and
   the worker's reel tick logs a failed query each minute (nothing else is affected).
2. **R2 env** (same names as Touch-up / the ingest agent, `.env` only, never committed):
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA`.
   - **worker:** reads the clip and sound, uploads the reel. Missing → each reel fails with one
     "Reels are paused" config alert.
   - **web:** uploads sounds. Missing → the upload says storage isn't set up. Both services already read
     the shared `../.env` (`env_file` in `infra/docker-compose.yml`), so nothing else to wire. The key
     needs read/write on the media bucket only.
3. **Deploy** ([deploy.md](deploy.md)): `git pull`, then `docker compose up -d --build` in `infra/`. The
   worker image already has ffmpeg (Touch-up). If it doesn't, reels fail with a "Reels are paused" alert.

## If something's off

| Symptom | Cause | Fix |
|---|---|---|
| "Reels are paused: Storage (R2) is not set up in the worker" | R2 env missing on the worker | Add the four R2 vars, redeploy |
| "Reels are paused: ffmpeg is not installed" | Worker image without ffmpeg | Rebuild the worker image |
| Upload says storage isn't set up | R2 env missing on web | Add the R2 vars to the web service, redeploy |
| Upload refused "isn't a real … file" | Renamed file (e.g. an .ogg called .mp3) | Export as mp3/m4a/wav |
| Reel failed "interrupted" | Worker restarted mid-render (after 2 h it's marked failed) | Make it again |
| Draft has no time | No free slot in 7 days, or `TZ_CREATOR` unset | Pick a time in the calendar |
