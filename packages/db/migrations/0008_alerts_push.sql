-- 0008: alerts page + PWA push (F8).
-- Applied by hand on the VPS: see docs/runbooks/migrations.md.

-- pushed_at: the alert-push job's at-most-once dedupe (claimed before sending).
-- acknowledged_session: which app session acknowledged the alert (audit; acknowledge is a timestamp, never a delete).
alter table alerts add column pushed_at timestamptz,
                   add column acknowledged_session uuid references auth_sessions(id) on delete set null;

-- Don't page for history on first deploy: every existing alert counts as already pushed.
update alerts set pushed_at = coalesce(pushed_at, now());

create index alerts_unpushed_idx on alerts (created_at) where pushed_at is null and acknowledged_at is null;

-- Web Push subscriptions (one per installed PWA). Endpoints and keys are never logged.
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

-- settings key 'alert_push' = {"kinds": [...]} is optional (default PUSH_KINDS_DEFAULT). No row inserted here.
-- No CHECK on alerts.kind or alerts.platform (still free text); the code types them (AlertKind, AlertSource).
