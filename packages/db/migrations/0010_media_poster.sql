-- 0010: poster frames for the media library (thumbnails in the web app).
-- Applied by hand on the VPS: see docs/runbooks/migrations.md. Additive only; re-running the SQL is safe.

-- poster_key: R2 key of a small metadata-free JPEG (`posters/<content_hash>.jpg`), written by the laptop
-- ingest (or `pnpm ingest:posters`). Null = no poster yet; the app shows no thumbnail, nothing breaks.
alter table media add column if not exists poster_key text;
