-- 0009: same-day editor → app pipeline (F15).
-- Applied by hand on the VPS: see docs/runbooks/migrations.md. Additive only; re-running the SQL is safe.

-- ingest_key: `${content_hash}:${platform}`, set only on editor items. origin: 'editor' | null (weekly batch).
alter table batch_items add column if not exists ingest_key text;
alter table batch_items add column if not exists origin text;

-- The idempotency guarantee for the laptop ingest: a re-run, a second laptop or a race can't double an
-- item (writer: insert ... on conflict (ingest_key) where ingest_key is not null do nothing).
create unique index if not exists batch_items_ingest_key_uq on batch_items (ingest_key) where ingest_key is not null;

-- Editor metadata lives in batch_items.trial.editor (jsonb, already there). New alert kinds
-- 'ready-for-approval' and 'settings-change' need no change: alerts.kind has no CHECK.
