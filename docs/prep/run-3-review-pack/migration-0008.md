# Migration 0008 alerts push
Files: packages/db/migrations/0008_alerts_push.sql:1-28, docs/runbooks/migrations.md:3-15 and 38-40, apps/worker/src/jobs/alert-push-store.ts:20-27 (query that uses the index)

## What it does
- Adds alerts.pushed_at and alerts.acknowledged_session (FK to auth_sessions, on delete set null) (0008:6-7).
- Backfills pushed_at on every existing alert so the push job does not page for history (0008:10).
- Creates partial index alerts_unpushed_idx on alerts(created_at) for rows with pushed_at and acknowledged_at null (0008:12).
- Creates push_subscriptions; session_id is an FK with on delete set null (0008:15-25).

## SQL (verbatim)
```sql
-- 0008:6-7
alter table alerts add column pushed_at timestamptz,
                   add column acknowledged_session uuid references auth_sessions(id) on delete set null;
-- 0008:10
update alerts set pushed_at = coalesce(pushed_at, now());
-- 0008:12
create index alerts_unpushed_idx on alerts (created_at) where pushed_at is null and acknowledged_at is null;
-- 0008:15-25
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  session_id uuid references auth_sessions(id) on delete set null,
  label text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  revoked_at timestamptz
);
-- store:20-27 claim query (uses the index)
update alerts set pushed_at = $3
        where id in (select id from alerts
                      where pushed_at is null and acknowledged_at is null and created_at >= $2 and kind = any($1::text[])
                      order by created_at, id
                      limit $4
                      for update skip locked)
          and pushed_at is null
        returning id, kind, platform
```

## Branches that write or send
- No conditionals in the migration file. The backfill at 0008:10 has no WHERE clause and updates every row.
- Runtime writes that depend on this schema: claim at store:20-27 (sets pushed_at where pushed_at is null), markSuccess at store:42, revoke at store:46.
- Runner that skips applied files (packages/db/src/cli-migrate.ts): outside this hunk, not read. Runbook says skip-if-applied (migrations.md:4).

## Attack surface (from the brief)
Attack: backfill really covers every existing row; FKs `on delete set null`; index predicate matches the job's query; re-run safety on the VPS.
- Backfill covers every existing row: 0008:10 has no WHERE, coalesce keeps existing values. Rows inserted after this UPDATE and before the new worker deploys keep pushed_at null; no code in this hunk stamps it on insert.
- FKs on delete set null: 0008:7 (acknowledged_session) and 0008:20 (session_id).
- Index predicate matches the job's query: index predicate at 0008:12 is `pushed_at is null and acknowledged_at is null`; store:22 has the same two predicates plus `created_at >= $2` and the kind filter. Index key is created_at; store:23 orders by created_at, id (id not in index). acknowledged_at is not added in 0008; it comes from 0005 (migrations.md:9).
- Re-run safety on the VPS: migrations.md:4-5 (applied files skipped; one transaction per file). The statements at 0008:6-7, 12 and 15 have no IF NOT EXISTS. Header 0008:2 says "Applied by hand on the VPS"; migrations.md:3 and 15 say the runner applies it. No down migration (migrations.md:40).

## Findings
_(red-team pass fills this)_
