#!/usr/bin/env bash
# "Empty next week / duplicated or stuck clips" diagnosis on the VPS:  ./infra/diagnose-week.sh </dev/null   (from any directory)
# Runbook: docs/runbooks/not-posting.md. Paste the whole output into the chat.
#
# STRICTLY READ-ONLY, like infra/diagnose-posting.sh: only SELECTs in a read-only transaction
# (PGOPTIONS default_transaction_read_only=on, UTC session). It changes no container, file, row or job.
# It mirrors the SQL of apps/worker/src/jobs/weekly-draft.ts and daily-instagram.ts (library eligibility
# = loadLibraryClips/isEligibleClip, RECENT_USE_DAYS 28 = the "recently used" query, covered days = the
# week query), so "eligible and unused" here is what the two jobs can pick.
#
# The output is meant for a PUBLIC-safe chat: no secrets, no file paths, no time-zone name (the creator-local
# week is computed inside the DB from the zone of the weekly-draft schedule row; the name is never printed),
# captions cut to 40 chars, titles only as y/n. Free text is redacted, and as a last net every value found
# in .env is replaced by <NAME>. Timestamps are UTC, 24 h.
#
# Every SQL query is a heredoc <<'SQL_*' so scripts/__tests__/diagnose-week.test.ts can run the same
# text against the scratch DB. Each section survives the failure of the others (no `set -e`); exit 0 always.

export LC_ALL=C TZ=UTC
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || HERE=$(dirname "$0")
ROOT=$(cd "$HERE/.." 2>/dev/null && pwd) || ROOT="$HERE/.."
ENV_FILE="$ROOT/.env"

VERDICTS=""
verdict() { VERDICTS="${VERDICTS}${1}
"; }

# Creator-local zone for the week maths: read from the DB (pgboss.schedule), passed to SQL as the GUC diag.tz. Never printed.
DIAG_TZ=UTC
TZ_SOURCE="UTC fallback"
DB_OK=yes

tmo() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }
dc() { (cd "$ROOT/infra" 2>/dev/null && tmo 60 docker compose "$@"); }
# Every dc call that sends no SQL must read /dev/null: with the terminal as stdin, `docker compose exec` (run under timeout, in a background process group) blocks on it.
# SQL on stdin, one text column per line. Read-only transaction, UTC session, diag.tz = creator-local zone for the SQL. stderr is kept (first line shown on failure).
psql_ro() {
  dc exec -T -e PGOPTIONS="-c default_transaction_read_only=on -c TimeZone=UTC -c diag.tz=${DIAG_TZ:-UTC}" db \
    psql -U autopilot -d autopilot -tAq -v ON_ERROR_STOP=1 2>&1
}
indent() { sed 's/^/  /'; }
first_err() { printf '%s\n' "$1" | head -1 | redact | cut -c1-160; }

# Untrusted text (log lines, job output, error messages) goes through this before it is printed.
redact() {
  sed -E \
    -e 's/([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/\1/g' \
    -e 's/"((access_|refresh_|id_)?token|api_?key|key|secret|client_secret|password|authorization)"[[:space:]]*:[[:space:]]*"[^"]*"/"\1":"<redacted>"/Ig' \
    -e 's/((access_|refresh_|id_)?token|api[_-]?key|key|secret|client_secret|password|passwd|signature|sig)=[^[:space:]&"'"'"',;)]*/\1=<redacted>/Ig' \
    -e 's/(Bearer|Basic)[[:space:]]+[^[:space:]"'"'"',;]+/\1 <redacted>/Ig' \
    -e 's/(Authorization:)[[:space:]]*[^"'"'"',;]+/\1 <redacted>/Ig' \
    -e 's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]"'"'"'<>)]*#<url>#g' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g' \
    -e 's/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/<ip>/g' \
    -e 's/([0-9a-fA-F]{1,4}:){4,}[0-9a-fA-F]{1,4}/<ip>/g' \
    -e 's#(/[A-Za-z0-9._@~+-]+){2,}/?#<path>#g' |
    awk 'BEGIN { c = "[A-Za-z0-9+/=_-]"; r = c; for (i = 1; i < 24; i++) r = r c; r = r c "*" }
    {
      # >= 24-char hex/base64 runs -> …, unless the run is an ALL_CAPS or snake_case name (no digit, single case).
      out = ""; s = $0
      while (match(s, r)) {
        tok = substr(s, RSTART, RLENGTH)
        rep = (tok ~ /[0-9]/ || (tok ~ /[a-z]/ && tok ~ /[A-Z]/)) ? "…" : tok
        out = out substr(s, 1, RSTART - 1) rep; s = substr(s, RSTART + RLENGTH)
      }
      print out s
    }'
}

# Last net over the whole output: any .env value (and URL host, TZ city, PRIVACY_BLOCKLIST term) -> <NAME>.
# Values stay inside awk; they are never printed or put in a shell variable.
scrub_env_values() {
  if [ ! -r "$ENV_FILE" ]; then cat; return; fi
  awk -v sq="'" '
    function add(nm, x, min,   lx) {
      if (length(x) < min) return
      lx = tolower(x)
      if (lx == "true" || lx == "false" || lx == "autopilot" || lx == "production" || lx == "development") return
      n++; key[n] = nm; val[n] = x
    }
    FNR == NR {
      line = $0; sub(/^[ \t]+/, "", line); sub(/^export[ \t]+/, "", line)
      eq = index(line, "="); if (eq < 2 || substr(line, 1, 1) == "#") next
      nm = substr(line, 1, eq - 1); v = substr(line, eq + 1); sub(/^[ \t]+/, "", v)
      if (substr(v, 1, 1) == "\"") { v = substr(v, 2); p = index(v, "\""); if (p) v = substr(v, 1, p - 1) }
      else if (substr(v, 1, 1) == sq) { v = substr(v, 2); p = index(v, sq); if (p) v = substr(v, 1, p - 1) }
      else { sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v) }
      add(nm, v, 6)
      h = v
      if (h ~ /^[A-Za-z][A-Za-z0-9+.-]*:\/\//) {
        sub(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "", h); sub(/[\/?#].*$/, "", h); sub(/^.*@/, "", h); sub(/:[0-9]+$/, "", h)
        add(nm, h, 4)
      }
      if (nm == "TZ_CREATOR") { t = v; sub(/^.*\//, "", t); add(nm, t, 4); gsub(/_/, " ", t); add(nm, t, 4) }
      if (nm == "PRIVACY_BLOCKLIST") {
        m = split(v, parts, ",")
        for (i = 1; i <= m; i++) { p2 = parts[i]; sub(/^[ \t]+/, "", p2); sub(/[ \t]+$/, "", p2); add(nm, p2, 4) }
      }
      next
    }
    {
      s = $0
      for (i = 1; i <= n; i++) {
        out = ""
        while ((p = index(s, val[i])) > 0) { out = out substr(s, 1, p - 1) "<" key[i] ">"; s = substr(s, p + length(val[i])) }
        s = out s
      }
      print s
    }' "$ENV_FILE" -
}

kv() { printf '%s\n' "$1" | sed -n "s/^$2 //p" | head -1; }

# ------------------------------------------------------------------------------------------ 1. Week window
section_window() {
  echo "== 1. Week window"
  zout=$(psql_ro <<'SQL_TZ'
select coalesce(to_jsonb(s)->>'timezone', '')
  from pgboss.schedule s
 where s.name in ('weekly-draft', 'daily-instagram') and coalesce(to_jsonb(s)->>'timezone', '') <> ''
 order by (s.name = 'weekly-draft') desc
 limit 1;
SQL_TZ
)
  rc=$?
  z=$(printf '%s\n' "$zout" | head -1)
  if [ $rc -eq 0 ] && printf '%s' "$z" | grep -Eq '^[A-Za-z0-9_+/-]{1,64}$'; then DIAG_TZ=$z; TZ_SOURCE="creator-local (from the worker schedule)"; fi
  out=$(psql_ro <<'SQL_WINDOW'
with z as (select coalesce(nullif(current_setting('diag.tz', true), ''), 'UTC') as tz),
     t as (select (now() at time zone z.tz)::date as today, extract(isodow from now() at time zone z.tz)::int as dow from z)
select line from (
  select 1 as part, format('NOW %s', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')) as line
  union all
  select 2, format('TODAY %s (weekday %s)', t.today, trim(to_char(t.today, 'Day'))) from t
  union all
  -- weekly-draft nextWeekStart: the Monday after today, never today (on a Monday: +7).
  select 3, format('WEEK_START %s', t.today + 8 - t.dow) from t
  union all
  select 4, format('WEEK_END %s', t.today + 14 - t.dow) from t
) x order by part;
SQL_WINDOW
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  window: n/a ($(first_err "$out"))"; DB_OK=no; verdict "db unreadable: week window query failed (is the db up?)"; return; fi
  echo "  week source: $TZ_SOURCE"
  printf '%s\n' "$out" | indent
  echo "  next 8 days (sections 3, 7, 8, 9): now .. now + 8 days (UTC); cap days are creator-local dates"
}

# ------------------------------------------------------------------------------------ 2. Batches and items
section_batches() {
  echo "== 2. Batches and items of next week"
  out=$(psql_ro <<'SQL_BATCHES'
with z as (select coalesce(nullif(current_setting('diag.tz', true), ''), 'UTC') as tz),
     w as (
       select (now() at time zone z.tz)::date + 8 - extract(isodow from now() at time zone z.tz)::int as ws, z.tz from z
     ),
     bounds as (
       select w.ws, (w.ws::timestamp at time zone w.tz) as lo, ((w.ws + 7)::timestamp at time zone w.tz) as hi from w
     ),
     wk as (
       select bi.* from batch_items bi, bounds
        where bi.status <> 'rejected' and bi.scheduled_for is not null and bi.scheduled_for >= bounds.lo and bi.scheduled_for < bounds.hi
     )
select line from (
  select 1 as part, to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as k,
         format('BATCH %s %s created=%s items=%s', left(b.id::text, 8), b.status,
           to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           (select count(*) from batch_items i where i.batch_id = b.id)) as line
    from batches b, bounds where b.week_start = bounds.ws
  union all
  select 2, null,
         format('GROUP %s %s origin=%s n=%s earliest=%s latest=%s', bi.platform, bi.status, coalesce(bi.origin, '-'), count(*),
           coalesce(to_char(min(bi.scheduled_for) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), '-'),
           coalesce(to_char(max(bi.scheduled_for) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), '-'))
    from batch_items bi join batches b on b.id = bi.batch_id, bounds
   where b.week_start = bounds.ws
   group by bi.platform, bi.status, coalesce(bi.origin, '-')
  union all
  -- Non-rejected timed items inside the creator-local week, any batch: what weekly-draft's "covered" check sees.
  select 3, null, format('IG_WEEK %s', count(*)) from wk where platform = 'instagram'
  union all
  select 4, null, format('ANY_WEEK %s', count(*)) from wk
  union all
  select 5, null, format('COVERED_DAYS %s of 7', count(distinct (wk.scheduled_for at time zone z.tz)::date)) from wk, z
) x order by part, k desc nulls last, line;
SQL_BATCHES
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  batches: n/a ($(first_err "$out"))"; return; fi
  b=$(printf '%s\n' "$out" | sed -n 's/^BATCH //p')
  if [ -n "$b" ]; then echo "  batches for this week_start (id status created items):"; printf '%s\n' "$b" | indent | indent; else echo "  no batch row for this week_start"; fi
  g=$(printf '%s\n' "$out" | sed -n 's/^GROUP //p')
  if [ -n "$g" ]; then echo "  items in those batches (platform status origin n earliest latest):"; printf '%s\n' "$g" | indent | indent; else echo "  no items in those batches"; fi
  igw=$(kv "$out" IG_WEEK); anyw=$(kv "$out" ANY_WEEK); cov=$(kv "$out" COVERED_DAYS)
  echo "  non-rejected timed items in the local week: instagram=${igw:-n/a} any platform=${anyw:-n/a} · days covered: ${cov:-n/a}"
  case "$igw" in 0) verdict "Instagram has nothing scheduled next week (0 non-rejected items; see the job results and library checks below)" ;; esac
  case "$cov" in "7 of 7") verdict "weekly-draft will skip next week as covered: every day already has a non-rejected post (Instagram may still be thin)" ;; esac
}

# ---------------------------------------------------------------------------------- 3. Items now .. +8 days
section_items() {
  echo "== 3. Items scheduled now .. +8 days (UTC; caption cut to 40)"
  out=$(psql_ro <<'SQL_ITEMS'
select line from (
  select 1 as part, bi.scheduled_for as k,
         format('ITEM %s %s %s origin=%s %s m=%s title=%s cap=%s',
           left(bi.id::text, 8), bi.platform, bi.status, coalesce(bi.origin, '-'),
           to_char(bi.scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           left(bi.media_id::text, 8),
           case when coalesce(bi.title, '') = '' then 'n' else 'y' end,
           case when coalesce(bi.caption, '') = '' then '(empty)'
                else left(regexp_replace(bi.caption, '\s+', ' ', 'g'), 40) end) as line
    from batch_items bi
   where bi.scheduled_for >= now() and bi.scheduled_for < now() + interval '8 days'
   order by bi.scheduled_for, bi.platform, bi.id
   limit 80
) x
union all
select format('TOTAL %s', count(*)) from batch_items bi
 where bi.scheduled_for >= now() and bi.scheduled_for < now() + interval '8 days';
SQL_ITEMS
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  items: n/a ($(first_err "$out"))"; return; fi
  tot=$(kv "$out" TOTAL)
  echo "  total in window: ${tot:-n/a} (first 80 shown; id platform status origin time media title-set caption)"
  printf '%s\n' "$out" | sed -n 's/^ITEM //p' | redact | cut -c1-200 | indent
}

# ---------------------------------------------------------------------------------------- 4. pg-boss runs
section_jobs() {
  echo "== 4. weekly-draft and daily-instagram (pg-boss)"
  out=$(psql_ro <<'SQL_JOBS'
with j as (
  select name, state::text as state, created_on, completed_on, output from pgboss.job where name in ('weekly-draft', 'daily-instagram')
  union all
  select name, state::text, created_on, completed_on, output from pgboss.archive where name in ('weekly-draft', 'daily-instagram')
), r as (
  select j.*, row_number() over (partition by name order by created_on desc) as rn from j
)
select line from (
  select 1 as part, s.name as k,
         format('SCHED %s cron=%s tz=%s', s.name, s.cron,
           case when coalesce(to_jsonb(s)->>'timezone', '') = '' then 'n' else 'y' end) as line
    from pgboss.schedule s where s.name in ('weekly-draft', 'daily-instagram')
  union all
  select 2, r.name || lpad(r.rn::text, 2, '0'),
         format('JOB %s %s created=%s completed=%s output=%s', r.name, r.state,
           coalesce(to_char(r.created_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), '-'),
           coalesce(to_char(r.completed_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), '-'),
           left(regexp_replace(coalesce(r.output::text, '-'), '\s+', ' ', 'g'), 300))
    from r where r.rn <= 5
  union all
  -- Evidence independent of the job output: the jobs write items with origin 'weekly' / 'daily' items.
  select 3, bi.origin,
         format('MADE %s items=%s last_created=%s created_7d=%s', bi.origin, count(*),
           to_char(max(bi.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           count(*) filter (where bi.created_at >= now() - interval '7 days'))
    from batch_items bi where bi.origin in ('weekly', 'daily') group by bi.origin
) x order by part, k, line;
SQL_JOBS
)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  pgboss: unreadable ($(first_err "$out"))"
    [ "$DB_OK" = no ] || verdict "pgboss unreadable: the weekly-draft / daily-instagram runs could not be read"
    return
  fi
  printf '%s\n' "$out" | grep -E '^(SCHED|MADE) ' | indent
  printf '%s\n' "$out" | grep '^JOB ' | redact | cut -c1-420 | indent
  for job in weekly-draft daily-instagram; do
    sched=$(printf '%s\n' "$out" | grep -c "^SCHED $job ")
    last=$(printf '%s\n' "$out" | grep "^JOB $job " | head -1)
    if [ "$sched" = 0 ] && [ -z "$last" ]; then verdict "$job never ran / not scheduled (the worker registers it at startup; it needs TZ_CREATOR)"; continue; fi
    [ "$sched" != 0 ] || verdict "$job not scheduled (no pg-boss schedule row; the worker registers it at startup and needs TZ_CREATOR)"
    [ -n "$last" ] || { verdict "$job never ran (scheduled, but no job row yet)"; continue; }
    st=$(printf '%s\n' "$last" | awk '{print $3}')
    case "$st" in failed) verdict "$job last run failed (read: docker compose logs --tail 80 worker)" ;; esac
    sk=$(printf '%s\n' "$last" | sed -n 's/.*"skipped": *"\([a-z-]*\)".*/\1/p')
    [ -z "$sk" ] || verdict "$job last result: skipped $sk"
  done
  if ! printf '%s\n' "$out" | grep '^JOB ' | grep -qv 'output=-$'; then
    echo "  note: job output is empty (the handlers return nothing); read the MADE lines and the log line '[weekly-draft] week …' / '[daily-instagram] …'"
  fi
}

# ---------------------------------------------------------------------------------- 5. batch-ready alerts
section_ready() {
  echo "== 5. batch-ready alerts (last 14 days)"
  out=$(psql_ro <<'SQL_READY'
select format('ALERT %s %s', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
         left(regexp_replace(regexp_replace(a.message, '\s+', ' ', 'g'), '\m[0-9]{1,2}:[0-9]{2}\M', 'hh:mm', 'g'), 160))
  from (select * from alerts where kind = 'batch-ready' and created_at >= now() - interval '14 days' order by created_at desc limit 15) a
union all
select format('COUNT %s', count(*)) from alerts where kind = 'batch-ready' and created_at >= now() - interval '14 days';
SQL_READY
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  alerts: n/a ($(first_err "$out"))"; return; fi
  n=$(kv "$out" COUNT)
  echo "  batch-ready alerts: ${n:-n/a}"
  printf '%s\n' "$out" | sed -n 's/^ALERT //p' | redact | cut -c1-200 | indent
  [ "$n" != 0 ] || verdict "no batch-ready alert in 14 days: neither weekly-draft nor daily-instagram added anything (or their alert already existed)"
}

# ------------------------------------------------------------------------------------ 6. Library eligibility
section_library() {
  echo "== 6. Library eligibility (the jobs' predicate)"
  out=$(psql_ro <<'SQL_LIBRARY'
with el as (
  -- weekly-draft isEligibleClip + loadLibraryClips: not archived, a non-empty r2_key, not superseded by a kept fix,
  -- not an undecided/discarded/failed fixed copy.
  select m.id, m.pillar from media m
   where m.status <> 'archived' and m.r2_key is not null and m.r2_key <> ''
     and not exists (select 1 from media_fixes hk where hk.media_id = m.id and hk.status = 'kept')
     and not exists (select 1 from media_fixes hf where hf.fixed_media_id = m.id and hf.status in ('queued', 'running', 'done', 'discarded', 'failed'))
), used as (
  -- RECENT_USE_DAYS = 28: a non-rejected item scheduled at or after now - 28 days (future included).
  select distinct media_id from batch_items
   where status <> 'rejected' and scheduled_for is not null and scheduled_for >= now() - interval '28 days'
), fresh as (
  select distinct media_id from batch_items
   where status <> 'rejected' and scheduled_for is not null and scheduled_for >= now() - interval '28 days'
     and created_at >= now() - interval '7 days'
)
select line from (
  select 1 as part, 'a' as k, format('TOTAL %s', count(*)) as line from media
  union all
  select 2, 'a', format('ELIGIBLE %s', count(*)) from el
  union all
  select 3, 'a', format('ELIGIBLE_USED_28D %s', count(*)) from el where el.id in (select media_id from used)
  union all
  select 4, 'a', format('USED_FROM_ITEMS_CREATED_7D %s', count(*)) from el where el.id in (select media_id from fresh)
  union all
  select 5, 'a', format('ELIGIBLE_UNUSED %s', count(*)) from el where el.id not in (select media_id from used)
  union all
  -- daily-instagram also skips the trading pillars (SKIP_PILLARS).
  select 6, 'a', format('ELIGIBLE_UNUSED_FOR_DAILY %s', count(*)) from el
   where el.id not in (select media_id from used) and coalesce(el.pillar, '') not in ('trade-recap', 'trading')
  union all
  select 7, coalesce(el.pillar, '(none)'), format('PILLAR_UNUSED %s %s', coalesce(el.pillar, '(none)'), count(*)) from el
   where el.id not in (select media_id from used) group by coalesce(el.pillar, '(none)')
) x order by part, k, line;
SQL_LIBRARY
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  library: n/a ($(first_err "$out"))"; return; fi
  tot=$(kv "$out" TOTAL); el=$(kv "$out" ELIGIBLE); used=$(kv "$out" ELIGIBLE_USED_28D); fresh=$(kv "$out" USED_FROM_ITEMS_CREATED_7D)
  unused=$(kv "$out" ELIGIBLE_UNUSED); udaily=$(kv "$out" ELIGIBLE_UNUSED_FOR_DAILY)
  echo "  media total: ${tot:-n/a} · eligible: ${el:-n/a} · of those used in the last 28 days: ${used:-n/a} (backfill: ${fresh:-n/a} used via items created in the last 7 days)"
  echo "  eligible AND unused (what the jobs can pick): ${unused:-n/a} · for daily-instagram (no trading pillars): ${udaily:-n/a}"
  p=$(printf '%s\n' "$out" | sed -n 's/^PILLAR_UNUSED //p' | redact | cut -c1-60)
  if [ -n "$p" ]; then echo "  unused by pillar:"; printf '%s\n' "$p" | indent | indent; fi
  case "$unused" in
    0)
      if [ "$el" = 0 ]; then verdict "no eligible clips at all ($tot media: archived, no clean r2_key, or hidden by a touch-up fix)"
      else verdict "no eligible unused clips: the library is all used in the last 28 days (backfill used ${fresh:-0})"; fi ;;
    ''|*[!0-9]*) ;;
    *) [ "$unused" -ge 7 ] || verdict "only $unused eligible unused clip(s): weekly-draft needs up to 7 for an empty week" ;;
  esac
}

# --------------------------------------------------------------------------------------------- 7. Cadence
section_cadence() {
  echo "== 7. Cadence and daily caps (next 8 creator-local days)"
  out=$(psql_ro <<'SQL_CADENCE'
with z as (select coalesce(nullif(current_setting('diag.tz', true), ''), 'UTC') as tz),
     cad as (select value from settings where key = 'cadence'),
     p(platform) as (values ('instagram'), ('youtube'), ('tiktok'), ('snapchat')),
     d as (select ((now() at time zone z.tz)::date + g) as day, z.tz from z, generate_series(0, 7) as g)
select line from (
  select 1 as part, '' as k,
         format('SETTING cadence=%s', case when exists (select 1 from cad) then 'set' else 'default' end) as line
  union all
  select 2, '', format('SETTING instagram_daily_min=%s', coalesce((select value::text from settings where key = 'instagram_daily_min'), 'default (2)'))
  union all
  -- DEFAULT_CADENCE.dailyCaps (packages/core/src/cadence.ts); a stored cadence row overrides per platform.
  select 3, p.platform,
         format('CAP %s %s', p.platform,
           coalesce((select (cad.value->'dailyCaps'->>p.platform)::int from cad),
                    case p.platform when 'instagram' then 6 when 'youtube' then 10 when 'tiktok' then 7 else 1 end))
    from p
  union all
  select 4, d.day::text || p.platform,
         format('DAY %s %s n=%s cap=%s', d.day, p.platform,
           (select count(*) from batch_items bi
             where bi.platform = p.platform and bi.status <> 'rejected' and bi.scheduled_for is not null
               and (bi.scheduled_for at time zone d.tz)::date = d.day),
           coalesce((select (cad.value->'dailyCaps'->>p.platform)::int from cad),
                    case p.platform when 'instagram' then 6 when 'youtube' then 10 when 'tiktok' then 7 else 1 end))
    from d cross join p
) x order by part, k, line;
SQL_CADENCE
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  cadence: n/a ($(first_err "$out"))"; return; fi
  printf '%s\n' "$out" | sed -n 's/^SETTING //p' | redact | cut -c1-120 | indent
  echo "  caps: $(printf '%s\n' "$out" | sed -n 's/^CAP //p' | awk '{printf "%s=%s ", $1, $2}')"
  echo "  per day (date platform count/cap; zero days omitted except Instagram):"
  printf '%s\n' "$out" | sed -n 's/^DAY //p' | awk '{ split($3, a, "="); split($4, c, "="); if ($2 == "instagram" || a[2] > 0) print $1, $2, a[2] "/" c[2] }' | indent | indent
  printf '%s\n' "$out" | sed -n 's/^DAY //p' | awk '$2 == "instagram" { split($3, a, "="); split($4, c, "="); if (c[2] > 0 && a[2] >= c[2]) print $1 " " a[2] "/" c[2] }' |
    while read -r day frac; do verdict "Instagram cap reached on $day ($frac): no more Instagram slots that day"; done
}

# -------------------------------------------------------------------------------------------- 8. Duplicates
section_dupes() {
  echo "== 8. Duplicate clips (same media + platform, close in time)"
  out=$(psql_ro <<'SQL_DUPES'
with pairs as (
  select a.media_id, a.platform,
         a.id as a_id, a.status as a_status, a.scheduled_for as a_at, a.updated_at as a_upd,
         b.id as b_id, b.status as b_status, b.scheduled_for as b_at, b.updated_at as b_upd
    from batch_items a
    join batch_items b on b.media_id = a.media_id and b.platform = a.platform and a.id < b.id
   where a.status <> 'rejected' and b.status <> 'rejected'
     and a.scheduled_for is not null and b.scheduled_for is not null
     and (
       abs(extract(epoch from (a.scheduled_for - b.scheduled_for))) <= 7 * 86400
       or (a.status = 'published' and a.updated_at >= now() - interval '14 days' and b.status <> 'published' and b.scheduled_for > now())
       or (b.status = 'published' and b.updated_at >= now() - interval '14 days' and a.status <> 'published' and a.scheduled_for > now())
     )
)
select line from (
  select 1 as part, p.a_at as k,
         format('PAIR m=%s %s %s %s %s | %s %s %s', left(p.media_id::text, 8), p.platform,
           left(p.a_id::text, 8), p.a_status, to_char(p.a_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           left(p.b_id::text, 8), p.b_status, to_char(p.b_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')) as line
    from pairs p
  union all
  select 2, null, format('COUNT %s', count(*)) from pairs
) x order by part, k nulls last, line
limit 41;
SQL_DUPES
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  duplicates: n/a ($(first_err "$out"))"; return; fi
  n=$(kv "$out" COUNT)
  echo "  pairs: ${n:-n/a} (media platform id status time | id status time; first 40)"
  printf '%s\n' "$out" | sed -n 's/^PAIR //p' | indent
  case "$n" in ''|0|*[!0-9]*) ;; *) verdict "$n duplicate clip pair(s): the same clip twice on one platform within 7 days (or one published in 14 days and another ahead); reject one in the calendar" ;; esac
}

# ------------------------------------------------------------------------------------------ 9. Stuck drafts
section_stuck() {
  echo "== 9. Stuck drafts (next 8 days, empty caption or empty YouTube title)"
  out=$(psql_ro <<'SQL_STUCK'
with s as (
  select bi.id, bi.platform, bi.origin, bi.scheduled_for, bi.media_id,
         coalesce(bi.caption, '') = '' as no_caption,
         (bi.platform = 'youtube' and coalesce(bi.title, '') = '') as no_title,
         exists (select 1 from batch_items p
                  where p.media_id = bi.media_id and p.platform = bi.platform and p.status = 'published' and p.id <> bi.id) as posted
    from batch_items bi
   where bi.status = 'draft' and bi.scheduled_for >= now() and bi.scheduled_for < now() + interval '8 days'
     and (coalesce(bi.caption, '') = '' or (bi.platform = 'youtube' and coalesce(bi.title, '') = ''))
)
select line from (
  select 1 as part, s.scheduled_for as k,
         format('STUCK %s %s origin=%s %s m=%s missing=%s%s posted=%s', left(s.id::text, 8), s.platform, coalesce(s.origin, '-'),
           to_char(s.scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), left(s.media_id::text, 8),
           case when s.no_caption then 'caption' else '' end,
           case when s.no_title then (case when s.no_caption then '+title' else 'title' end) else '' end,
           case when s.posted then 'y' else 'n' end) as line
    from s
  union all
  select 2, null, format('COUNT %s', count(*)) from s
  union all
  select 3, null, format('POSTED %s', count(*)) from s where s.posted
) x order by part, k nulls last, line
limit 61;
SQL_STUCK
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  stuck: n/a ($(first_err "$out"))"; return; fi
  n=$(kv "$out" COUNT); pn=$(kv "$out" POSTED)
  echo "  stuck drafts: ${n:-n/a} · of those the same clip is already published on that platform: ${pn:-n/a}"
  printf '%s\n' "$out" | sed -n 's/^STUCK //p' | sed 's/ posted=y$/ posted=y (already posted there)/' | indent
  case "$pn" in ''|0|*[!0-9]*) ;; *) verdict "$pn stuck draft(s) are already posted on that platform: reject them, they only need a caption to repeat a post" ;; esac
  if [ -n "$n" ] && [ -n "$pn" ] && [ "$n" != 0 ] && [ "$n" != "$pn" ] 2>/dev/null; then verdict "$((n - pn)) stuck draft(s) need a caption/title before they can be approved (weekly-batch skill or the calendar)"; fi
}

print_verdict() {
  echo "== VERDICT (in check order; fix the first one first)"
  if [ -z "$VERDICTS" ]; then echo "  ok: nothing obviously wrong was found"; return; fi
  printf '%s' "$VERDICTS" | awk 'NF { print "  " ++i ". " $0 }'
}

main() {
  echo "diagnose-week · $(date -u +%Y-%m-%dT%H:%MZ) · read-only"
  section_window
  section_batches
  section_items
  section_jobs
  section_ready
  section_library
  section_cadence
  section_dupes
  section_stuck
  print_verdict
}

main 2>&1 | scrub_env_values
exit 0
