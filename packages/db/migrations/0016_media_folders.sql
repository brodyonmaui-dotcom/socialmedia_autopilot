-- 0016: library folders by week. A free-text label on a clip ("Week of Nov 23", "Upper body").
-- Applied by hand on the VPS after a backup: see docs/runbooks/migrations.md and docs/runbooks/editor-pipeline.md.
-- Additive only (one nullable column + one index); no backfill: the Library derives a week from
-- coalesce(captured_at, created_at) when folder is null. Re-running the SQL is safe.
alter table media add column if not exists folder text;
create index if not exists media_folder_idx on media (folder);
