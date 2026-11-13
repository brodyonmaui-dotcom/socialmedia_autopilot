-- 0006: single-user passkey login + approval that means something (F2).
-- Applied by hand on the VPS: see docs/runbooks/migrations.md.

-- Passkeys (WebAuthn credentials). At most 5 live ones; enforced in code.
create table auth_credentials (
  id uuid primary key default gen_random_uuid(),
  credential_id text not null unique,          -- base64url credential id from the authenticator
  public_key bytea not null,                    -- COSE public key
  counter bigint not null default 0,            -- signature counter; regression = refuse
  transports text[],
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- App sessions. Only the sha256 of the cookie token is stored.
create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,              -- sliding (30 days from last use)
  hard_expires_at timestamptz not null,         -- never slides past this (90 days)
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- WebAuthn challenges: single use, short lived.
create table auth_challenges (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('register','login')),
  challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- One-time enrolment codes minted by the CLI on the server (hash only).
create table auth_enroll_codes (
  code_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Failed login/enrol attempts, for the global rate limit (10 per 15 min).
create table auth_failures (
  id bigserial primary key,
  kind text not null,
  at timestamptz not null default now()
);
create index auth_failures_at_idx on auth_failures (at);

-- Approval stamps. The worker fires an item only when the item is approved,
-- approved_at is set, and its batch is approved.
alter table batches add column approved_at timestamptz;
alter table batch_items
  add column approved_at timestamptz,
  add column approved_session uuid references auth_sessions(id) on delete set null;

-- Audit trail for every status change made from the app or a CLI.
create table batch_item_events (
  id bigserial primary key,
  batch_item_id uuid not null references batch_items(id) on delete cascade,
  kind text not null,                           -- approve | approve-all | approve-cli | reject | unapprove | edit | add
  from_status text,
  to_status text,
  detail jsonb,
  session_id uuid,
  at timestamptz not null default now()
);
create index batch_item_events_item_idx on batch_item_events (batch_item_id, at);

-- Backfill: rows approved before this migration (catch-up batch, first real posts)
-- must keep flowing through the new worker gate.
update batch_items set approved_at = coalesce(approved_at, now())
  where status in ('approved','queued','publishing','published','unknown','failed');
update batches b set status = 'approved', approved_at = coalesce(b.approved_at, now())
  where exists (select 1 from batch_items bi where bi.batch_id = b.id and bi.approved_at is not null);

-- 'rejected' joins the status list (reject is a status, never a delete).
-- Every value the code writes, plus rejected. NOT VALID first so a stray row can't block the deploy.
alter table batch_items add constraint batch_items_status_check
  check (status in ('draft','approved','queued','publishing','published','failed','unknown','rejected')) not valid;
alter table batch_items validate constraint batch_items_status_check;
