create extension if not exists pgcrypto;

-- The media library: one row per ingested, touched-up clip.
create table media (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique, -- sha256 of the file; the dedupe key
  source_path text,                  -- original local path, for debugging only
  r2_key text,                       -- clean (metadata-stripped) copy, once touched up
  duration_s numeric,
  width int,
  height int,
  pillar text,                       -- gym / trading / meal / lifestyle / tip / running (voice.md)
  status text not null default 'ingested', -- ingested -> qa_pass|qa_fail -> ready -> used
  qa jsonb,                          -- ed-qa style check results
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_status_idx on media (status);

-- A weekly batch is the approval boundary: nothing in it publishes until approved.
create table batches (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  status text not null default 'draft', -- draft -> approved
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per platform post. The outbox the worker fires from.
create table batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  media_id uuid not null references media(id),
  platform text not null,            -- instagram | youtube | tiktok | snapchat
  caption text not null default '',
  title text,                        -- youtube only
  trial jsonb,                       -- instagram trial_params, when applicable
  scheduled_for timestamptz not null,
  idempotency_key uuid not null default gen_random_uuid(),
  status text not null default 'draft', -- draft -> approved -> queued -> publishing -> published|failed|unknown
  attempts int not null default 0,
  last_error text,
  platform_post_id text,
  platform_post_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);
create index batch_items_due_idx on batch_items (status, scheduled_for);
