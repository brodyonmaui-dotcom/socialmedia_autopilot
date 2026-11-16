-- 0011: account-wide analytics (all recent posts on the account, not only the ones this app published).
-- Applied by hand on the VPS: see docs/runbooks/migrations.md. Additive only; re-running the SQL is safe.
-- Read-only data from the official APIs. Never stored here: location fields, thumbnails or media URLs
-- (short-lived CDN links), other people's usernames, tokens or raw responses.

-- One row per post on the account. batch_item_id/matched_by link it to an app item:
-- 'id' = same platform_post_id, 'caption' = same normalised caption/title within ±36 h, null = posted by hand.
create table if not exists account_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  platform_post_id text not null,
  permalink text not null,
  kind text,                          -- IG media_product_type lower-cased (reels/feed); null when unknown
  caption text,
  title text,
  published_at timestamptz not null,
  duration_s numeric,                 -- null = the platform didn't give it
  batch_item_id uuid references batch_items(id),
  matched_by text,                    -- 'id' | 'caption' | null
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, platform_post_id)
);
create index if not exists account_posts_published_idx on account_posts (platform, published_at desc);

-- One metrics snapshot per post per ingest run. Null = the platform didn't give it, never 0.
create table if not exists account_post_snapshots (
  account_post_id uuid not null references account_posts(id),
  captured_at timestamptz not null,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  reach bigint,
  avg_watch_s numeric,
  primary key (account_post_id, captured_at)
);

-- One row per platform per day (the creator's local day).
create table if not exists account_snapshots (
  platform text not null,
  captured_on date not null,
  followers bigint,
  total_views bigint,
  posts_count int,
  primary key (platform, captured_on)
);
