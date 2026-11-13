-- 0007: engagement (F3): comments, triage, planned actions, DM drafts.
-- Shadow mode by default: actions are computed and stored, nothing is sent until the creator
-- flips a platform to live in a day session (settings.engagement.mode[platform] = 'live').

create table comments (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram','youtube','tiktok')),
  platform_comment_id text not null,
  platform_media_id text not null,
  batch_item_id uuid references batch_items(id) on delete set null,
  parent_platform_id text,                      -- null for top-level comments
  author_id text,                               -- may be null in Meta Development mode (from{} missing)
  author_handle text,
  text text not null,
  is_own boolean not null default false,        -- written by the creator's own account
  commented_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  unique (platform, platform_comment_id)
);
create index comments_media_idx on comments (platform, platform_media_id, commented_at);

-- One triage verdict per comment. handled_at = the creator marked it done in the inbox.
create table comment_triage (
  comment_id uuid primary key references comments(id) on delete cascade,
  bucket text not null check (bucket in ('simple_positive','negative','hide_flag','flag')),
  confidence numeric,
  draft_reply text,
  reasons text[],
  model text,                                   -- 'rules' when no model was called
  refused boolean not null default false,
  decided_at timestamptz not null default now(),
  handled_at timestamptz
);
create index comment_triage_open_idx on comment_triage (bucket, decided_at) where handled_at is null;

-- One reply and one hide per comment, ever (the double-reply guard, same discipline as the outbox).
create table engagement_actions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments(id) on delete cascade,
  kind text not null check (kind in ('reply','hide')),
  text text,
  idempotency_key uuid not null unique default gen_random_uuid(),
  status text not null default 'planned'
    check (status in ('planned','sending','sent','failed','unknown','cancelled','shadow')),
  not_before timestamptz not null,              -- the veto window (minDelayMin after planning)
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  platform_action_id text,
  origin text not null default 'auto' check (origin in ('auto','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (comment_id, kind)
);
create index engagement_due_idx on engagement_actions (status, not_before);

create table engagement_cursors (
  platform text primary key,
  cursor jsonb,
  polled_at timestamptz
);

-- "Never auto-reply to this person".
create table engagement_blocklist (
  platform text not null,
  author_id text not null,
  created_at timestamptz not null default now(),
  primary key (platform, author_id)
);

-- Instagram DMs: read + draft only. Nothing in the schema or code sends a DM.
create table dm_threads (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'instagram',
  platform_thread_id text not null unique,
  participant_id text not null,
  participant_handle text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  handled_at timestamptz
);
create table dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references dm_threads(id) on delete cascade,
  platform_message_id text not null unique,
  direction text not null check (direction in ('in','out')),
  text text,
  sent_at timestamptz not null
);
create table dm_drafts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references dm_threads(id) on delete cascade,
  for_message_id uuid references dm_messages(id),
  text text not null,
  bucket text,
  created_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft','copied','dismissed'))
);

-- Settings overlay, merged over DEFAULT_ENGAGEMENT in code (modes shadow/shadow/off, caps, pools).
insert into settings (key, value) values ('engagement', '{}') on conflict (key) do nothing;
