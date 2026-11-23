-- 0015: reel maker (F20 E). A sounds library and one row per "Make a reel" request.
-- Applied by hand on the VPS after a backup: see docs/runbooks/migrations.md and docs/runbooks/reels.md.
-- Additive only (two new tables, no change to existing ones); re-running the SQL is safe.

-- Audio the creator uploaded (own or royalty-free). Never deleted: "archive" sets archived_at.
create table if not exists sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  r2_key text unique not null,
  duration_s numeric,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- One row per "Make a reel": a library clip + optional trim + a sound → a new library clip → a DRAFT
-- Instagram item (never approved here). The worker (apps/worker media-reel) claims queued rows.
create table if not exists media_edits (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'reel',
  source_media_id uuid not null references media(id),
  sound_id uuid references sounds(id),
  params jsonb not null,
  caption text not null default '',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  result_media_id uuid references media(id),
  batch_item_id uuid references batch_items(id),
  error text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists media_edits_queued_idx on media_edits (requested_at) where status = 'queued';
create index if not exists media_edits_requested_idx on media_edits (requested_at desc);
