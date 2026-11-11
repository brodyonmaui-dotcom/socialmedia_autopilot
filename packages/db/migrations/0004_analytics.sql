-- F5 analytics: one metrics snapshot per published post per checkpoint age (24 h, 72 h, 7 d, 28 d).
-- Read-only data from the platforms; no tokens or raw responses stored here.
create table post_metrics (
  id uuid primary key default gen_random_uuid(),
  batch_item_id uuid not null references batch_items(id) on delete cascade,
  age_hours int not null,
  metrics jsonb not null,            -- normalized Metrics (packages/analytics/src/types.ts); nulls = not available
  captured_at timestamptz not null default now(),
  unique (batch_item_id, age_hours)  -- a re-run of the same checkpoint is a no-op
);
create index post_metrics_item_idx on post_metrics (batch_item_id, captured_at desc);
