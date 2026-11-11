-- F6 research branch: creators we learn from, the idea backlog, and reusable hooks.
-- Research text never names identifiable places (CLAUDE.md location boundary); the app lints on write.

create table creators (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                     -- instagram | youtube | tiktok | snapchat
  handle text not null,                       -- public handle, lowercase, no "@"
  pillar text,                                -- voice.md pillar
  notes text not null default '',
  followers int,
  active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index creators_platform_handle_idx on creators (platform, handle);

create table ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pillar text,
  stage text not null default 'idea'
    check (stage in ('idea', 'scripted', 'filmed', 'posted', 'dropped')),
  hook text not null default '',
  script text not null default '',
  source_creator_id uuid references creators(id) on delete set null,
  media_id uuid references media(id) on delete set null,
  batch_item_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_stage_idx on ideas (stage);

create table hooks (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  pillar text,
  source text not null default 'own' check (source in ('own', 'creator')),
  source_creator_id uuid references creators(id) on delete set null,
  times_used int not null default 0,
  created_at timestamptz not null default now()
);
