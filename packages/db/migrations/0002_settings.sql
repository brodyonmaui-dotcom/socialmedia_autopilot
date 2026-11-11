-- Generic editable settings (Settings UI), so things like cadence windows don't need a redeploy to change.
-- Never store TZ_CREATOR or anything location-revealing here — windows are wall-clock times only;
-- the time zone that makes them meaningful stays in .env (CLAUDE.md location boundary).
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values (
  'posting_windows',
  '[{"start":"09:30","end":"11:45"},{"start":"12:00","end":"14:00"},{"start":"15:00","end":"18:00"},{"start":"20:00","end":"21:00"}]'
);
