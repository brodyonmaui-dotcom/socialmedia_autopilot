-- 0017: browser upload (F23). One row per file uploaded from the Library's Upload page, chunked through the web
-- server into an R2 multipart upload under the private prefix incoming/<id>.<ext>; the worker (apps/worker
-- media-ingest) strips metadata, checks no location tag survives, stores library/<sha256>.mp4 and links media_id.
-- Applied by hand on the VPS after a backup: see docs/runbooks/migrations.md and docs/runbooks/uploads.md.
-- Additive only (one new table + two indexes, no change to existing ones); re-running the SQL is safe.
-- original_name is the file's BASENAME only (never a laptop path); folder is its parent directory name.
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  original_name text not null,
  size_bytes bigint not null,
  content_type text,
  folder text,
  r2_key text not null,
  s3_upload_id text,
  parts jsonb not null default '[]',
  status text not null default 'uploading' check (status in ('uploading','uploaded','processing','done','duplicate','failed','aborted')),
  media_id uuid references media(id),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists uploads_status_idx on uploads (status);
create index if not exists uploads_name_size_idx on uploads (original_name, size_bytes);
