-- 0012: inbox triage recalibration (run 4): the promo-spam bucket, the promo-account list, ignored DM
-- threads, "Not spam" re-triage and the reply-ready pings.
-- Applied by hand on the VPS: see docs/runbooks/migrations.md. Additive only; re-running the SQL is safe.
-- Nothing is ever deleted: "remove from the list" sets removed_at, "ignore" sets ignored_at.

-- 1. comment_triage.bucket gains 'spam_promo' (never replied to, never hidden, no engagement_actions row).
--    The 0007 constraint was an inline column check, so Postgres named it comment_triage_bucket_check.
alter table comment_triage drop constraint if exists comment_triage_bucket_check;
alter table comment_triage add constraint comment_triage_bucket_check
  check (bucket in ('simple_positive','negative','hide_flag','flag','spam_promo')) not valid;
alter table comment_triage validate constraint comment_triage_bucket_check;

-- "Not spam": the creator moved one item back. retriage_requested_at makes the worker triage it again
-- (rules without the promo rule, then the model); not_spam_at stays as the audit mark.
alter table comment_triage add column if not exists retriage_requested_at timestamptz;
alter table comment_triage add column if not exists not_spam_at timestamptz;
create index if not exists comment_triage_retriage_idx on comment_triage (retriage_requested_at) where retriage_requested_at is not null;

-- 2. "Always ignore this account". author_key = the platform's stable author id when we have it, else
--    the lower-cased handle. source: 'manual' (the creator) or 'rule' (repeated promo hits).
create table if not exists engagement_promo_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram','youtube','tiktok')),
  author_key text not null,
  display_handle text,
  source text not null check (source in ('manual','rule')),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index if not exists engagement_promo_accounts_open_uq on engagement_promo_accounts (platform, author_key) where removed_at is null;

-- 3. Promo DM threads: ignored (no draft), shown only under the "Ignored" filter.
alter table dm_threads add column if not exists ignored_reason text;
alter table dm_threads add column if not exists ignored_at timestamptz;

-- 4. reply-ready pings: the alert points at the comment it is about (null for a digest), so the push can
--    deep-link to /app/inbox/item/<id> and "Approve & send" can acknowledge it.
alter table alerts add column if not exists comment_id uuid references comments(id) on delete set null;
create index if not exists alerts_reply_ready_idx on alerts (kind, created_at) where kind = 'reply-ready';

-- settings.engagement.pings ('each' | 'hourly' | 'off', default 'hourly') lives in the existing overlay; no row here.
