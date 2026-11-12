-- F1 scheduler + outbox engine.
-- batch_items already carries idempotency_key (unique), attempts, last_error and the status column;
-- this adds what bounded retry with backoff needs, plus a place for alerts a human must look at.

alter table batch_items add column next_attempt_at timestamptz; -- set while status = 'queued' (waiting out a backoff)
create index batch_items_retry_idx on batch_items (status, next_attempt_at);

-- One row per (kind, item): a held post can't page the creator every minute. acknowledged_at is the dashboard's "seen".
create table alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- final-failure | unknown-outcome | cap-breach | duplicate
  batch_item_id uuid references batch_items(id) on delete cascade,
  platform text not null,
  message text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (kind, batch_item_id)
);
create index alerts_open_idx on alerts (acknowledged_at) where acknowledged_at is null;

-- Cadence (Settings → cadence): slotsPerDay, dailyCaps, stagger, bufferDays, minGapMinutes. An empty object
-- means "the defaults in packages/core/src/cadence.ts"; posting_windows (0002) stays the source for windows.
-- Wall-clock times and counts only; TZ_CREATOR never goes here (location boundary).
insert into settings (key, value) values ('cadence', '{}') on conflict (key) do nothing;
