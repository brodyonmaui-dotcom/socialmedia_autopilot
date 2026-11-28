-- 0018: duplicate guard v2 (F26 A). A perceptual fingerprint per clip, so a re-upload (new content_hash) or a
-- re-encoded copy of a video already posted is still recognised as the same video.
-- Applied by hand on the VPS after a backup: see docs/runbooks/migrations.md and docs/runbooks/duplicates.md.
-- Additive only (two nullable columns + one partial index, no change to existing data); re-running the SQL is safe.

-- "v1:<duration s>:<h1>,...,<h8>": 8 frame dHashes (64-bit hex, "-" = a flat frame) at 10/20/.../80% of the
-- clip. Computed with ffmpeg wherever a media row is created, and by the worker's media-fingerprint backfill tick.
-- Never contains a path, a place or any metadata from the file.
alter table media add column if not exists fingerprint text;
-- When the fingerprint was last attempted (set on failure too, so the backfill never loops on a bad file).
alter table media add column if not exists fingerprint_at timestamptz;
-- The backfill tick's queue: clean files never attempted.
create index if not exists media_fingerprint_todo_idx on media (created_at) where fingerprint_at is null;
