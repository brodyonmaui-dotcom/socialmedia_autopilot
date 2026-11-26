# Studio: the in-app editor (F24)

Code: `packages/media/src/edl.ts` (edit rules + ffmpeg args, pure, shared with the browser) + `edl-run.ts` (ffmpeg
runner, fonts), `apps/worker/src/jobs/media-reel.ts` (the `kind = 'studio'` branch), `apps/web/lib/studio/data.ts`,
`apps/web/app/studio/actions.ts`, `apps/web/app/studio/status/route.ts`, page `/studio`. **No migration**: a Studio
export is a `media_edits` row with `kind = 'studio'` and the edit (EDL) in `params`; `source_media_id` = first clip.

## What it does

Library clips (1–10, any order, the same clip may repeat) → trim each, speed 0.5×–2×, text overlays, a sound under
the original audio → one 1080x1920 video, 3–90 s.

- **Look:** *Fill* crops to cover the frame; *Fit* centres the clip over a blurred copy (same as Touch-up "Aspect").
  Always 30 fps, H.264 + AAC 48 kHz.
- **Audio:** each clip's own sound (silence for a clip without one) × "original volume", mixed with the sound ×
  its volume. The sound starts at 0, is read from its offset, loops if short, fades in 0.3 s and out 1 s. Then
  two-pass loudness to −14 LUFS / −1.5 dBTP.
- **Text:** ≤ 10 overlays, ≤ 80 characters each, wrapped at about 20 characters a line, white DejaVu Sans
  (bold = box behind, plain = soft shadow), kept inside the safe margins (top 12%, bottom 22%: clear of Instagram's
  buttons). Every text must pass the caption lint's privacy rules (no places, no real-time whereabouts, no
  PRIVACY_BLOCKLIST term) before the export is queued.
- **Location:** all metadata and chapters dropped; the output is re-probed and refused if a location tag survived.
- **Cover:** the poster is taken at the chosen cover frame.

The worker renders one export at a time (`media-reel-tick`, every minute), downloads each distinct clip once, and
adds a **new library clip** in folder **"Studio"** (`derived_from` = the first clip). It adds **no** calendar item
and approves nothing: the export shows up in **Ready to post**, where you watch it and tap Approve & schedule.

## Worker image

`apps/worker/Dockerfile` installs `font-dejavu` (Alpine) for the text. Default font:
`/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf` (and `DejaVuSans.ttf` for plain). To use another TTF, set the env
names `STUDIO_FONT_PATH` (bold) and optionally `STUDIO_FONT_PLAIN_PATH` in `.env`, then
`docker compose up -d --build` in `infra/`. A missing font fails the export in plain words ("The text font is
missing in the worker").

## When an export fails

The Studio status chip shows the reason. Common ones:
- "A clip in this edit isn't in the library any more": a clip was archived or replaced by a kept fix. Re-add it.
- "…out point is past the end of the clip": the edit was saved against an older copy. Re-open the clip and trim.
- "took too long and was stopped": over 20 min of ffmpeg. Use fewer/shorter clips.
- "Location details survived": should never happen; nothing was kept. Report it.

Nothing on this path posts or deletes. The source clips and the sound are only read.
