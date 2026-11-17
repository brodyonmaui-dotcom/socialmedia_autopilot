-- 0014: touch-up "Fix it" (structured QA v2, fixed copies, dismissals).
-- Applied by hand on the VPS: see docs/runbooks/migrations.md. Additive only; re-running the SQL is safe.

-- media.qa already exists (0001). v2 results carry {"version": 2, "issues": [...], ...}; older rows are
-- read through the web's legacy mapper until the worker's media-recheck job re-runs QA on them.
alter table media add column if not exists qa jsonb;
-- A fixed copy points at the original it was made from. The original is never changed or removed.
alter table media add column if not exists derived_from uuid null references media(id);
-- When the stored QA was last (re)computed from the clean file (worker fix / recheck).
alter table media add column if not exists qa_checked_at timestamptz;
create index if not exists media_derived_from_idx on media (derived_from) where derived_from is not null;

-- One row per "Fix it" request. Never deleted: keep/discard are status changes.
create table if not exists media_fixes (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references media(id),
  ops text[] not null,
  status text not null default 'queued',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  fixed_media_id uuid null references media(id),
  before jsonb,
  after jsonb,
  error text,
  session_id uuid
);
do $$ begin
  alter table media_fixes add constraint media_fixes_status_check
    check (status in ('queued','running','done','failed','kept','discarded'));
exception when duplicate_object then null; end $$;
-- At most one open fix per clip (a second "Fix it" tap is a no-op, see requestFix).
create unique index if not exists media_fixes_open_uq on media_fixes (media_id) where status in ('queued','running','done');
create index if not exists media_fixes_queued_idx on media_fixes (requested_at) where status = 'queued';

-- "Dismiss" on a touch-up issue: hides that issue code for that clip. undone_at re-shows it (never deleted).
create table if not exists touchup_dismissals (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references media(id),
  code text not null,
  dismissed_at timestamptz not null default now(),
  session_id uuid,
  undone_at timestamptz
);
create unique index if not exists touchup_dismissals_open_uq on touchup_dismissals (media_id, code) where undone_at is null;
