-- 0013: research that runs itself (worker job research-refresh, every 3 days; decisions.md §4 addendum 2026-11-16).
-- Additive only; re-running the SQL is safe. Ideas/hooks now arrive from tracked creators (Instagram Business
-- Discovery, read-only), from his own niches (evergreen prompts) and from the bundled yap scripts.
-- No copying: from another creator we keep only the first line of a caption (the hook, <= 140 chars, privacy-linted)
-- and the permalink. Never full captions, media URLs, thumbnails or video files.

-- ---------- ideas ----------
alter table ideas add column if not exists source text not null default 'manual';
alter table ideas drop constraint if exists ideas_source_check;
alter table ideas add constraint ideas_source_check check (source in ('manual', 'creator', 'niche', 'script'));
alter table ideas add column if not exists source_key text;          -- idempotent upserts: 'ig-<media id>', 'niche-<pillar>-<key>', 'yap-2026-11-16-#N'
alter table ideas add column if not exists reference_url text;       -- link out to the reference (never a copy of it)
alter table ideas add column if not exists about text not null default '';
alter table ideas add column if not exists adapt text not null default '';
alter table ideas add column if not exists used_at timestamptz;      -- set = in the "Already used" archive
alter table ideas add column if not exists pattern text;
alter table ideas add column if not exists score numeric;
alter table ideas add column if not exists notes_by text not null default 'code';
alter table ideas drop constraint if exists ideas_notes_by_check;
alter table ideas add constraint ideas_notes_by_check check (notes_by in ('code', 'ai', 'manual'));
create unique index if not exists ideas_source_key_idx on ideas (source_key) where source_key is not null;
create index if not exists ideas_used_idx on ideas (used_at);

-- ---------- hooks ----------
alter table hooks add column if not exists source_key text;
alter table hooks add column if not exists reference_url text;
alter table hooks add column if not exists pattern text;
alter table hooks add column if not exists template text not null default '';
alter table hooks add column if not exists used_at timestamptz;
alter table hooks drop constraint if exists hooks_source_check;
alter table hooks add constraint hooks_source_check check (source in ('own', 'creator', 'niche', 'script'));
create unique index if not exists hooks_source_key_idx on hooks (source_key) where source_key is not null;

-- ---------- creator_media: the minimum needed to rank ----------
create table if not exists creator_media (
  creator_id uuid not null references creators(id),
  platform_media_id text not null,
  permalink text,
  kind text,                          -- reel | video | image | carousel
  hook_line text,                     -- first caption line, cleaned + linted; null = unusable or dropped for privacy
  like_count bigint,                  -- null = the owner hides likes
  comments_count bigint,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (creator_id, platform_media_id)
);

-- ---------- runs + AI budget ----------
create table if not exists research_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',   -- running | ok | partial | failed
  creators_checked int not null default 0,
  ideas_added int not null default 0,
  hooks_added int not null default 0,
  note text not null default ''
);
create index if not exists research_runs_started_idx on research_runs (started_at desc);

create table if not exists ai_token_usage (
  month date not null,                -- first day of the UTC month
  purpose text not null,              -- e.g. 'research-notes'
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (month, purpose)
);
