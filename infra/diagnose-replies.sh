#!/usr/bin/env bash
# "Replies don't send / Library crashes" diagnosis on the VPS:  ./infra/diagnose-replies.sh   (from any directory)
# Runbook: docs/runbooks/engagement.md ("Diagnose replies"). Paste the whole output into the chat.
#
# STRICTLY READ-ONLY, same rules as infra/diagnose-posting.sh: `docker compose ps/logs/exec`, presence
# (never values) of env names in the env file and in the running worker, SELECTs in a read-only UTC transaction.
# It changes no container, file, row or job. It never prints comment text, reply text or commenter handles
# (only short ids, platforms, statuses and redacted error text), no secrets, paths, IPs, domains or zone.
# Log text and error messages are redacted, and every value found in the env file is replaced by <NAME> at the end.
#
# Every SQL query is a heredoc <<'SQL_*' so scripts/__tests__/diagnose-replies.test.ts can run the same
# text against the scratch DB. Each section survives the failure of the others (no `set -e`); exit 0 always.

export LC_ALL=C TZ=UTC
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || HERE=$(dirname "$0")
ROOT=$(cd "$HERE/.." 2>/dev/null && pwd) || ROOT="$HERE/.."
ENV_FILE="$ROOT/.env"

# Env the reply path reads: apps/worker/src/index.ts (resolveRunMode: DRY_RUN, WORKER_LIVE; ANTHROPIC_API_KEY gate),
# packages/adapters/src/comments/index.ts (commentCredentialsFromEnv), register-engagement.ts (PRIVACY_BLOCKLIST,
# ANTHROPIC_API_KEY, ANTHROPIC_MODEL), packages/engagement/src/kill.ts (ENGAGEMENT_KILL). The test checks these.
ENV_NAMES="DRY_RUN WORKER_LIVE ENGAGEMENT_KILL YT_COMMENT_REPLIES YT_CHANNEL_ID ZERNIO_API_KEY ZERNIO_TIKTOK_ACCOUNT_ID ANTHROPIC_API_KEY ANTHROPIC_MODEL PRIVACY_BLOCKLIST META_ACCESS_TOKEN IG_USER_ID META_GRAPH_VERSION GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET YT_REFRESH_TOKEN DATABASE_URL"

VERDICTS=""
verdict() { VERDICTS="${VERDICTS}${1}
"; }

tmo() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }
dc() { (cd "$ROOT/infra" 2>/dev/null && tmo 60 docker compose "$@"); }
# Every dc call that sends no SQL must read /dev/null: with the terminal as stdin, `docker compose exec` (run under timeout, in a background process group) blocks on it.
# SQL on stdin, one text column per line. Read-only transaction, UTC session. stderr is kept (first line shown on failure).
psql_ro() {
  dc exec -T -e PGOPTIONS='-c default_transaction_read_only=on -c TimeZone=UTC' db \
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

# Last net over the whole output: any env-file value (and URL host, TZ city, PRIVACY_BLOCKLIST term) -> <NAME>.
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

DB_RUNNING=no
WORKER_RUNNING=no
count_of() { printf '%s\n' "$1" | sed -n "s/^$2 //p" | head -1; }

# ------------------------------------------------------------------------------------ 1. Library crash check
section_library() {
  echo "== 1. Library crash check (migration 0016, column media.folder, web log 3 h)"
  ps=$(dc ps --all </dev/null --format '{{.Service}} {{.State}}' 2>/dev/null) || ps=""
  if [ -z "$ps" ]; then echo "  docker compose ps: n/a (run from the VPS)"; verdict "containers: docker compose ps gave nothing (is the stack up? run from the VPS)"; fi
  printf '%s\n' "$ps" | awk '$1 == "worker" && $2 == "running" { f = 1 } END { exit !f }' && WORKER_RUNNING=yes
  printf '%s\n' "$ps" | awk '$1 == "db" && $2 == "running" { f = 1 } END { exit !f }' && DB_RUNNING=yes
  [ -z "$ps" ] || echo "  worker: $WORKER_RUNNING · db: $DB_RUNNING"
  files=$(ls "$ROOT/packages/db/migrations" 2>/dev/null | grep -E '^[0-9]{4}_.*\.sql$' | sort)
  applied=$(psql_ro <<'SQL_MIGRATIONS'
select id from schema_migrations order by id;
SQL_MIGRATIONS
)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  applied migrations: n/a ($(first_err "$applied"))"
    [ "$DB_RUNNING" = yes ] && verdict "db unreadable: migrations query failed"
  else
    applied=$(printf '%s\n' "$applied" | grep -E '^[0-9]{4}_' | sort)
    missing=$(comm -23 <(printf '%s\n' "$files") <(printf '%s\n' "$applied") | grep . | tr '\n' ' ')
    echo "  files: $(printf '%s\n' "$files" | grep -c .) · applied: $(printf '%s\n' "$applied" | grep -c .) · latest applied: $(printf '%s\n' "$applied" | tail -1)"
    echo "  missing: ${missing:-none}"
    if printf '%s\n' "$applied" | grep -q '^0016_'; then echo "  0016 applied: yes"; else echo "  0016 applied: NO"; fi
    [ -z "$missing" ] || verdict "migrations missing: $missing(migrations runbook; apply by hand after a backup)"
  fi
  col=$(psql_ro <<'SQL_FOLDER'
select 'FOLDER_COLUMN ' || case when exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media' and column_name = 'folder'
) then 'yes' else 'no' end
union all
select 'FOLDER_INDEX ' || case when to_regclass('public.media_folder_idx') is not null then 'yes' else 'no' end;
SQL_FOLDER
)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  media.folder: n/a ($(first_err "$col"))"
  else
    fc=$(count_of "$col" FOLDER_COLUMN); fidx=$(count_of "$col" FOLDER_INDEX)
    echo "  column media.folder exists: $fc · index media_folder_idx: $fidx"
    if [ "$fc" = no ]; then verdict "migration 0016 not applied: Library crashes (apply it: migrations runbook, after a backup)"
    elif ! printf '%s\n' "$applied" | grep -q '^0016_' && [ -n "$applied" ]; then echo "  (column exists but 0016 is not recorded: applied by hand, fine)"; fi
  fi
  wl=$(dc logs --since 3h --no-color web </dev/null 2>/dev/null | sed -E 's/^[^|]*\| ?//')
  hits=$(printf '%s\n' "$wl" | grep -E 'error|Error|digest|column|does not exist' | tail -n 30 | redact | cut -c1-240)
  echo "  web log, last 30 matching lines (error|Error|digest|column|does not exist; redacted):"
  if [ -n "$hits" ]; then printf '%s\n' "$hits" | indent | indent; else echo "    none"; fi
  if printf '%s\n' "$wl" | grep -Eq 'column .*does not exist|relation .*does not exist'; then
    verdict "web log shows a missing column/relation (\"does not exist\"): a migration is not applied (see 0016 above)"
  fi
}

# ------------------------------------------------------------------------------------- 2. Env presence
# Prints only a classification of NAME in the env file. DRY_RUN true|false|other|missing; WORKER_LIVE and
# YT_COMMENT_REPLIES 1|not-1; ENGAGEMENT_KILL true|false|missing (1/true are true); the rest set|missing.
classify_awk='
  sub(/^[ \t]+/, "", v)
  if (substr(v, 1, 1) == "\"") { v = substr(v, 2); p = index(v, "\""); if (p) v = substr(v, 1, p - 1) }
  else if (substr(v, 1, 1) == sq) { v = substr(v, 2); p = index(v, sq); if (p) v = substr(v, 1, p - 1) }
  else { sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v) }
  if (want == "DRY_RUN") { if (!found || v == "") print "missing"; else if (v == "true" || v == "false") print v; else print "other" }
  else if (want == "WORKER_LIVE" || want == "YT_COMMENT_REPLIES") { print (v == "1") ? "1" : "not-1" }
  else if (want == "ENGAGEMENT_KILL") { l = tolower(v); gsub(/[ \t]/, "", l); if (!found || l == "") print "missing"; else print (l == "1" || l == "true") ? "true" : "false" }
  else print (found && v != "") ? "set" : "missing"'
env_file_state() {
  [ -r "$ENV_FILE" ] || { echo unreadable; return; }
  awk -v want="$1" -v sq="'" '
    {
      line = $0; sub(/^[ \t]+/, "", line); sub(/^export[ \t]+/, "", line)
      eq = index(line, "="); if (eq < 2 || substr(line, 1, 1) == "#") next
      if (substr(line, 1, eq - 1) != want) next
      v = substr(line, eq + 1); found = 1
    }
    END {'"$classify_awk"'}' "$ENV_FILE"
}

section_env() {
  echo "== 2. Env presence (names only; env file vs the running worker)"
  wenv=""
  if [ "$WORKER_RUNNING" = yes ]; then
    # shellcheck disable=SC2016,SC2086
    wenv=$(dc exec -T worker sh -c '
      for n in "$@"; do
        eval "v=\${$n-}"
        case "$n" in
          DRY_RUN) case "$v" in true|false) echo "$n $v" ;; "") echo "$n missing" ;; *) echo "$n other" ;; esac ;;
          WORKER_LIVE|YT_COMMENT_REPLIES) if [ "$v" = 1 ]; then echo "$n 1"; else echo "$n not-1"; fi ;;
          ENGAGEMENT_KILL) l=$(printf "%s" "$v" | tr "A-Z " "a-z" | tr -d " "); case "$l" in "") echo "$n missing" ;; 1|true) echo "$n true" ;; *) echo "$n false" ;; esac ;;
          *) if [ -n "$v" ]; then echo "$n set"; else echo "$n missing"; fi ;;
        esac
      done' sh $ENV_NAMES </dev/null 2>/dev/null) || wenv=""
  fi
  [ -r "$ENV_FILE" ] || echo "  env file: unreadable or missing at the repo root"
  printf '  %-28s %-9s %s\n' NAME file worker
  mismatch=""
  for n in $ENV_NAMES; do
    f=$(env_file_state "$n")
    w=$(printf '%s\n' "$wenv" | awk -v n="$n" '$1 == n {print $2}')
    [ -n "$w" ] || w=n/a
    printf '  %-28s %-9s %s\n' "$n" "$f" "$w"
    if [ "$w" != n/a ] && [ "$f" != unreadable ] && [ "$f" != "$w" ]; then mismatch="$mismatch $n"; fi
  done
  eff() { w=$(printf '%s\n' "$wenv" | awk -v n="$1" '$1 == n {print $2}'); if [ -n "$w" ]; then echo "$w"; else env_file_state "$1"; fi; }
  EFF_DRY=$(eff DRY_RUN); EFF_LIVE=$(eff WORKER_LIVE); EFF_KILL=$(eff ENGAGEMENT_KILL)
  EFF_YT=$(eff YT_COMMENT_REPLIES); EFF_ZK=$(eff ZERNIO_API_KEY); EFF_ZA=$(eff ZERNIO_TIKTOK_ACCOUNT_ID); EFF_AI=$(eff ANTHROPIC_API_KEY)
  EFF_YCH=$(eff YT_CHANNEL_ID)
  echo "  effective: DRY_RUN=$EFF_DRY WORKER_LIVE=$EFF_LIVE ENGAGEMENT_KILL=$EFF_KILL YT_COMMENT_REPLIES=$EFF_YT"
  if [ "$EFF_DRY" != false ] || [ "$EFF_LIVE" != 1 ]; then
    verdict "worker in dry-run: replies are never sent (DRY_RUN=$EFF_DRY, WORKER_LIVE=$EFF_LIVE; live needs DRY_RUN=false AND WORKER_LIVE=1)"
  fi
  [ "$EFF_KILL" != true ] || verdict "ENGAGEMENT_KILL is true: the env kill switch blocks every reply"
  [ -z "$mismatch" ] || verdict "worker env differs from the env file for:$mismatch (recreate: cd infra && docker compose up -d worker)"
  [ "$EFF_YCH" = set ] || echo "  note: YT_CHANNEL_ID missing: the worker looks the channel up at startup (1 quota unit); fine if that works"
  [ "$EFF_AI" = set ] || echo "  note: ANTHROPIC_API_KEY missing: rules-only drafts (stored as shadow; they send only on Approve)"
}

# ---------------------------------------------------------------------------------- 3. Engagement settings
YT_MODE=n/a; TT_MODE=n/a; IG_MODE=n/a; SETTINGS_KILLED=n/a
section_settings() {
  echo "== 3. Engagement settings (settings row 'engagement'; pools omitted)"
  out=$(psql_ro <<'SQL_SETTINGS'
select line from (
  select 1 as part, 'ROW ' || (select count(*) from settings where key = 'engagement') as line
  union all
  select 2, 'UPDATED ' || coalesce((select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') from settings where key = 'engagement'), '-')
  union all
  select 3, format('SET %s=%s', e.key,
    left(regexp_replace(case when jsonb_typeof(e.value) = 'string' then e.value #>> '{}' else e.value::text end, '\s+', ' ', 'g'), 120))
    from settings s, jsonb_each(s.value - 'pools') e
   where s.key = 'engagement' and e.key !~* 'token|secret|key|password'
) x
order by part, line;
SQL_SETTINGS
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  settings: n/a ($(first_err "$out"))"; return; fi
  if [ "$(count_of "$out" ROW)" = 0 ]; then
    echo "  no stored row: defaults apply (every platform shadow, killed=false, pings=hourly)"
    IG_MODE=shadow; YT_MODE=shadow; TT_MODE=shadow; SETTINGS_KILLED=false
    return
  fi
  echo "  updated: $(count_of "$out" UPDATED)"
  printf '%s\n' "$out" | sed -n 's/^SET //p' | redact | cut -c1-200 | indent
  getmode() { printf '%s\n' "$out" | sed -n "s/^SET mode=//p" | grep -o "\"$1\": *\"[a-z]*\"" | sed -E 's/.*: *"([a-z]*)"/\1/' | head -1; }
  IG_MODE=$(getmode instagram); YT_MODE=$(getmode youtube); TT_MODE=$(getmode tiktok)
  : "${IG_MODE:=shadow}" "${YT_MODE:=shadow}" "${TT_MODE:=shadow}"
  SETTINGS_KILLED=$(printf '%s\n' "$out" | sed -n 's/^SET killed=//p' | head -1)
  : "${SETTINGS_KILLED:=false}"
  echo "  modes: instagram=$IG_MODE youtube=$YT_MODE tiktok=$TT_MODE · killed=$SETTINGS_KILLED"
  [ "$SETTINGS_KILLED" != true ] || verdict "engagement killed in settings: nothing sends until the kill switch is cleared in the inbox (reason above)"
  for pm in "instagram $IG_MODE" "youtube $YT_MODE" "tiktok $TT_MODE"; do
    case "$pm" in *" off") verdict "${pm% *} engagement mode is off: no replies are planned for it" ;; esac
  done
}

# ---------------------------------------------------------------------------------------- 4. Worker log
LOGS=""
cnt() { printf '%s\n' "$LOGS" | grep -cF -- "$1"; }
outcome() { printf '    %-26s %s\n' "$1" "$(cnt "$2")"; }
section_logs() {
  echo "== 4. Worker log (last 24 h, UTC)"
  LOGS=$(dc logs --since 24h --no-color --timestamps worker </dev/null 2>/dev/null |
    sed -E 's/^[^|]*\| ?//; s/^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]+)?Z /\1Z /')
  if [ -z "$LOGS" ]; then echo "  logs: n/a (no output in 24 h)"; return; fi
  echo "  lines: $(printf '%s\n' "$LOGS" | wc -l | tr -d ' ') · worker starts: $(cnt 'worker started ·')"
  echo "  startup lines (latest):"
  for pat in "worker started ·" "engagement modes:" "triage: rules-only" "live refused"; do
    printf '%s\n' "$LOGS" | grep -F -- "$pat" | tail -n 1 | redact | cut -c1-300 | indent | indent
  done
  mline=$(printf '%s\n' "$LOGS" | grep -F 'engagement modes:' | tail -n 1)
  case "$mline" in *"comment sources=none"*) verdict "no comment sources: the worker found no comment credentials, so nothing is polled or sent" ;; esac
  case "$mline" in *"tiktok(stub"*) verdict "TikTok comment source is a stub (no Zernio keys): TikTok replies can't send" ;; esac
  case "$mline" in *" live=false"*) verdict "worker log: engagement live=false (dry-run): replies are never sent" ;; esac
  case "$mline" in *" killEnv=true"*) verdict "worker log: killEnv=true (ENGAGEMENT_KILL)" ;; esac
  echo "  engagement outcomes (24 h):"
  outcome "send ticks (summaries)" "[engage] send tick:"
  outcome "sent" "[engage] sent "
  outcome "retry queued" "[engage] retry "
  outcome "FAILED" "[engage] FAILED "
  outcome "UNKNOWN" "[engage] UNKNOWN "
  outcome "skipped" "[engage] skip "
  outcome "held (thread check)" "[engage] hold "
  outcome "cancelled (creator first)" "[engage] cancelled "
  outcome "claim lost" "[engage] claim lost "
  outcome "KILL tripped" "[engage] KILL tripped"
  outcome "triage runs" "[engage] triage:"
  outcome "alerts" "[alert] "
  echo "  skip reasons:"
  sk=$(printf '%s\n' "$LOGS" | grep -F '[engage] skip ' | sed -nE 's/.*\[engage\] skip [a-z]+ [a-z]+ [^:]+: ([^ (]+( [^ (]+)?).*/\1/p' | sort | uniq -c | sort -rn | head -6 | redact | cut -c1-120)
  if [ -n "$sk" ]; then printf '%s\n' "$sk" | indent | indent; else echo "    none"; fi
  echo "  last send tick summaries:"
  printf '%s\n' "$LOGS" | grep -F '[engage] send tick:' | tail -n 3 | redact | cut -c1-240 | indent | indent
  echo "  last 15 engagement error-like lines (redacted):"
  errs=$(printf '%s\n' "$LOGS" | grep -E '\[engage\]|\[alert\] engagement|triage' |
    grep -E 'FAILED|UNKNOWN|KILL|retry|hold|claim lost|gone|error|Error|fail|401|403|429|expired|refused|quota' |
    grep -vF -e '[engage] send tick:' -e '[engage] triage:' | tail -n 15 | redact | cut -c1-240)
  if [ -n "$errs" ]; then printf '%s\n' "$errs" | indent | indent; else echo "    none"; fi
  auth=$(printf '%s\n' "$errs" | grep -Eci '(^|[^0-9])(401|403)([^0-9]|$)|invalid_grant|expired|unauthori[sz]ed|OAuthException|invalid[_ ]token|access token|insufficient')
  [ "$auth" = 0 ] || verdict "token/auth errors in the engagement log ($auth line(s)): token-renewal runbook, or the YouTube force-ssl scope"
  [ "$(cnt '[engage] KILL tripped')" = 0 ] || verdict "engagement kill switch tripped in the last 24 h (see the KILL line; clear it in the inbox after checking)"
}

# ---------------------------------------------------------------------------------------- 5. Recent replies
section_replies() {
  echo "== 5. Replies in the last 7 days (engagement_actions kind=reply; no text, no handles; UTC)"
  out=$(psql_ro <<'SQL_REPLIES'
with r as (
  select a.id, c.platform, a.status, a.origin, a.created_at, a.updated_at, a.sent_at, a.attempts, a.not_before,
         a.last_error, a.platform_action_id
    from engagement_actions a
    join comments c on c.id = a.comment_id
   where a.kind = 'reply' and a.created_at > now() - interval '7 days'
)
select line from (
  select 1 as part, r.created_at as k,
         format('ROW %s %s %s %s created=%s updated=%s sent=%s att=%s pid=%s err=%s',
           left(r.id::text, 8), r.platform, r.status, r.origin,
           to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           coalesce(to_char(r.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), '-'),
           r.attempts,
           case when coalesce(r.platform_action_id, '') <> '' then 'y' else 'n' end,
           coalesce(nullif(left(regexp_replace(r.last_error, '\s+', ' ', 'g'), 120), ''), '-')) as line
    from (select * from r order by created_at desc limit 40) r
  union all
  select 2, null::timestamptz, format('COUNT %s %s %s n=%s', r.platform, r.status, r.origin, count(*))
    from r group by r.platform, r.status, r.origin
  union all
  -- Machine-readable, for the VERDICT. A planned reply is due once its veto window (not_before) has passed;
  -- the send tick runs every minute, so 15 minutes late means nothing picked it up.
  select 3, null, format('STUCK|%s|%s', r.platform, count(*))
    from r where r.status = 'planned' and r.not_before < now() - interval '15 minutes' group by r.platform
  union all
  select 4, null, format('PLANNED|%s|%s', r.platform, count(*)) from r where r.status = 'planned' group by r.platform
  union all
  select 5, null, format('FAILCLS|%s|%s|%s', f.platform, f.cls, count(*))
    from (select r.platform,
           case
             when r.last_error is null or r.last_error = '' then 'no-error-text'
             when r.last_error ~* 'comment gone|no longer exist|not found|deleted' then 'comment-gone'
             when r.last_error ~* '\m(401|403)\M|token|oauth|unauthori[sz]ed|forbidden|expired|invalid_grant|permission|scope' then 'auth'
             when r.last_error ~* '\m429\M|quota|rate.?limit|too many' then 'rate-or-quota'
             when r.last_error ~* 'timeout|timed out|abort|network|econnreset|etimedout' then 'timeout'
             when r.last_error ~* 'reply has no text' then 'no-text'
             when r.last_error ~* '\m5[0-9][0-9]\M' then 'platform-5xx'
             when r.last_error ~* '\m4[0-9][0-9]\M' then 'rejected-4xx'
             else 'other'
           end as cls
          from r where r.status = 'failed') f
   group by f.platform, f.cls
  union all
  select 6, null, format('UNKNOWN|%s|%s', r.platform, count(*)) from r where r.status = 'unknown' group by r.platform
  union all
  select 7, null, format('SENT|%s|%s', r.platform, count(*)) from r where r.status = 'sent' group by r.platform
) x
order by part, k desc nulls last, line;
SQL_REPLIES
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  replies: n/a ($(first_err "$out"))"; [ "$DB_RUNNING" = yes ] && verdict "db unreadable: replies query failed"; return; fi
  rows=$(printf '%s\n' "$out" | sed -n 's/^ROW //p')
  if [ -z "$rows" ]; then
    echo "  no reply actions created in the last 7 days"
  else
    echo "  id       platform status origin created updated sent attempts platform-reply-id last_error[:120] (newest 40)"
    printf '%s\n' "$rows" | redact | cut -c1-300 | indent
  fi
  echo "  counts (platform status origin n):"
  printf '%s\n' "$out" | sed -n 's/^COUNT //p' | indent | indent
  while IFS='|' read -r tag platform a b; do
    case "$tag" in
      STUCK) verdict "$a $platform replies stuck in planned (past their veto window by 15+ min: dry-run, kill switch, mode, or send tick not running)" ;;
      FAILCLS) verdict "$b $platform replies failed: $a" ;;
      UNKNOWN) verdict "$a $platform replies in unknown (outcome not known; check the thread before anything else)" ;;
    esac
  done < <(printf '%s\n' "$out" | grep -E '^(STUCK|FAILCLS|UNKNOWN)\|' | awk -F'|' '$1 == "FAILCLS" { print $1 "|" $2 "|" $3 "|" $4; next } { print $1 "|" $2 "|" $3 }')
  yp=$(printf '%s\n' "$out" | sed -n 's/^PLANNED|youtube|//p' | head -1)
  { [ "$EFF_YT" != 1 ] && { [ "$YT_MODE" = live ] || [ -n "$yp" ]; }; } && verdict "YT_COMMENT_REPLIES not 1: YouTube replies can't send"
  tp=$(printf '%s\n' "$out" | sed -n 's/^PLANNED|tiktok|//p' | head -1)
  { [ "$EFF_ZK" != set ] || [ "$EFF_ZA" != set ]; } && { [ "$TT_MODE" = live ] || [ -n "$tp" ]; } && verdict "ZERNIO_API_KEY / ZERNIO_TIKTOK_ACCOUNT_ID missing: TikTok replies can't send"
  return 0
}

# --------------------------------------------------------------------------------------------- 6. pg-boss
section_pgboss() {
  echo "== 6. pg-boss (queue engagement-send)"
  out=$(psql_ro <<'SQL_PGBOSS'
with t as (
  select state::text as state, created_on, started_on, completed_on from pgboss.job where name = 'engagement-send'
  union all
  select state::text, created_on, started_on, completed_on from pgboss.archive where name = 'engagement-send'
)
select line from (
  select 1 as part, s.name as k, format('SCHED %s cron=%s', s.name, s.cron) as line
    from pgboss.schedule s where s.name = 'engagement-send'
  union all
  select 3, lpad(j.rn::text, 2, '0'),
         format('JOB %s created=%s started=%s completed=%s', j.state,
           coalesce(to_char(j.created_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'),
           coalesce(to_char(j.started_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'),
           coalesce(to_char(j.completed_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'))
    from (select t.*, row_number() over (order by t.created_on desc) as rn from t) j
   where j.rn <= 5
  union all
  select 5, null, format('LAST_COMPLETED_AGE_MIN %s', coalesce(floor(extract(epoch from now() - max(completed_on)) / 60)::bigint::text, 'never'))
    from t where state = 'completed'
) x
order by part, k nulls last, line;
SQL_PGBOSS
)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  pgboss: unreadable ($(first_err "$out"))"
    [ "$DB_RUNNING" = yes ] && verdict "pgboss unreadable: the job tables could not be read (worker never started against this DB?)"
    return
  fi
  printf '%s\n' "$out" | grep -E '^(SCHED|JOB|LAST_COMPLETED_AGE_MIN) ' | indent
  printf '%s\n' "$out" | grep -q '^SCHED engagement-send ' || verdict "engagement-send not scheduled in pg-boss (the worker registers it at startup: check it started)"
  age=$(printf '%s\n' "$out" | sed -n 's/^LAST_COMPLETED_AGE_MIN //p')
  case "$age" in
    never) verdict "engagement-send never completed: no worker is consuming the queue" ;;
    ''|*[!0-9]*) ;;
    *) [ "$age" -le 5 ] || verdict "engagement-send not completing: last completed $age min ago (expected every minute; worker stuck or down)" ;;
  esac
  fout=$(psql_ro <<'SQL_PGBOSS_FAILED'
with t as (
  select state::text as state, created_on, completed_on, output from pgboss.job where name = 'engagement-send'
  union all
  select state::text, created_on, completed_on, output from pgboss.archive where name = 'engagement-send'
), f as (
  select * from t where state = 'failed' and coalesce(completed_on, created_on) > now() - interval '24 hours'
)
select format('FAILED24H %s', count(*)) from f
union all
select * from (
  select format('FAILJOB %s %s',
           to_char(coalesce(completed_on, created_on) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           left(regexp_replace(coalesce(output->>'message', output::text, '-'), '\s+', ' ', 'g'), 200))
    from f
   order by coalesce(completed_on, created_on) desc
   limit 5
) l;
SQL_PGBOSS_FAILED
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  failed jobs: unreadable ($(first_err "$fout"))"; return; fi
  nf=$(count_of "$fout" FAILED24H)
  echo "  failed in 24 h: ${nf:-n/a}"
  printf '%s\n' "$fout" | grep '^FAILJOB ' | redact | cut -c1-240 | indent
  case "$nf" in ''|0|*[!0-9]*) ;; *) verdict "engagement-send jobs failing: $nf failed in 24 h (the tick itself throws; see the output above)" ;; esac
}

print_verdict() {
  echo "== VERDICT (in check order; fix the first one first)"
  if [ -z "$VERDICTS" ]; then echo "  ok: nothing obviously wrong was found"; return; fi
  printf '%s' "$VERDICTS" | awk 'NF { print "  " ++i ". " $0 }'
}

main() {
  echo "diagnose-replies · $(date -u +%Y-%m-%dT%H:%MZ) · read-only"
  section_library
  section_env
  section_settings
  section_logs
  section_replies
  section_pgboss
  print_verdict
}

main 2>&1 | scrub_env_values
exit 0
