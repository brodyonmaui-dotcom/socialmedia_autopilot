# Poster frames (thumbnails)

Code: `packages/media/src/poster.ts`, `tools/ingest-agent/src/poster.ts`, `tools/ingest-agent/src/posters-cli.ts`.
Web: `GET /app/media/poster/<mediaId>` (session-guarded, same origin; R2 is never exposed to the browser).

## What it does

Every clip in the media library gets a small poster JPEG: one frame at 1 s (or 10% of a short clip),
long side 640 px, with **all metadata stripped** (no EXIF, no GPS). It is stored in R2 as
`posters/<content hash>.jpg` and its key is saved in `media.poster_key` (migration 0010).

`pnpm ingest` and `pnpm ingest:ready` make the poster automatically from the clean copy. If a poster
fails, the clip still ingests: you see one `POSTER skipped <file> — <reason>` line and the app simply
shows no thumbnail for that clip.

## Backfill (clips ingested before posters existed, or a skipped poster)

On the laptop, with the usual DB tunnel up:

```
pnpm ingest:posters            # dry run: prints counts only
pnpm ingest:posters --write    # make + upload + set poster_key
```

One line at the end: `posters: made N, missing-file M, failed K`.

- It reads each clip's **original** from the laptop library (the path it was ingested from, or the
  `_ingested/` folder `ingest:ready` moved it to) and only uses it when the content hash matches.
  Originals are only read, never changed, moved or deleted.
- `missing-file` = the original isn't on this laptop any more; that clip keeps no thumbnail.
- Safe to re-run: only rows with no poster are touched, and the R2 key is the content hash.

## Local dev

There is no R2 locally. `pnpm dev:seed` writes synthetic demo posters (abstract gradients, no real
imagery) to `logs/dev-posters/demo/`; start the web app with `DEV_POSTER_DIR=<repo>/logs/dev-posters`
to serve them. `DEV_POSTER_DIR` is only honoured for `demo/` keys, so it can never serve real media.
