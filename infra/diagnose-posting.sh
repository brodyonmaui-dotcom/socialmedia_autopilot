#!/usr/bin/env bash
# "Approved posts didn't go out" diagnosis on the VPS:  ./infra/diagnose-posting.sh   (from any directory)
# Runbook: docs/runbooks/not-posting.md. Paste the whole output into the chat.
#
# STRICTLY READ-ONLY. It reads git state (git fetch only updates origin/main), `docker compose ps/logs/
# inspect/exec`, presence (never values) of env names in .env and in the running worker, and runs
# SELECTs in a read-only transaction (PGOPTIONS default_transaction_read_only=on, as infra/preflight.sh).
# It changes no container, file, row or job.
#
# The output is meant for a PUBLIC-safe chat: no secrets/tokens, no captions, no file paths, no IPs or
# domains, no time-zone name (TZ_CREATOR prints set|missing only). Log text is redacted (token=/key=/
# Bearer, URLs, emails, IPs, paths, long hex/base64 runs -> …) and, as a last net, every value found in
# .env is replaced by <NAME> in the whole output. Timestamps are UTC.
#
# Every SQL query is a heredoc <<'SQL_*' so scripts/__tests__/diagnose-posting.test.ts can run the same
# text against the scratch DB. Each section survives the failure of the others (no `set -e`); exit 0 always.

export LC_ALL=C TZ=UTC
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || HERE=$(dirname "$0")
ROOT=$(cd "$HERE/.." 2>/dev/null && pwd) || ROOT="$HERE/.."
ENV_FILE="$ROOT/.env"

# Credential names the worker reads (packages/adapters/src/registry.ts credentialsFromEnv), per platform.
CRED_INSTAGRAM="META_ACCESS_TOKEN IG_USER_ID META_GRAPH_VERSION"
CRED_YOUTUBE="GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET YT_REFRESH_TOKEN"
CRED_TIKTOK="ZERNIO_API_KEY ZERNIO_TIKTOK_ACCOUNT_ID"
# Required for an adapter to exist (META_GRAPH_VERSION is optional: the adapter has a default).
NEED_INSTAGRAM="META_ACCESS_TOKEN IG_USER_ID"
NEED_YOUTUBE="$CRED_YOUTUBE"
NEED_TIKTOK="$CRED_TIKTOK"
ENV_NAMES="DRY_RUN WORKER_LIVE TZ_CREATOR PUBLIC_MEDIA_BASE DATABASE_URL $CRED_INSTAGRAM $CRED_YOUTUBE $CRED_TIKTOK"

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

# ---------------------------------------------------------------------------------------------- 1. Code
HEAD_EPOCH=""
section_code() {
  echo "== 1. Code"
  if ! command -v git >/dev/null 2>&1 || ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    echo "  git: n/a"; return
  fi
  head=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null) || head=n/a
  cdate=$(git -C "$ROOT" log -1 --format=%cs 2>/dev/null) || cdate=n/a
  HEAD_EPOCH=$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null) || HEAD_EPOCH=""
  branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=n/a
  if GIT_TERMINAL_PROMPT=0 tmo 30 git -C "$ROOT" fetch -q origin main >/dev/null 2>&1; then fetched=yes; else fetched="no (counts use the last fetched origin/main)"; fi
  behind=$(git -C "$ROOT" rev-list --count HEAD..origin/main 2>/dev/null) || behind=n/a
  ahead=$(git -C "$ROOT" rev-list --count origin/main..HEAD 2>/dev/null) || ahead=n/a
  dirty=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ') || dirty=n/a
  echo "  HEAD: $head ($cdate) branch: $branch"
  echo "  fetch: $fetched · behind origin/main: $behind · ahead: $ahead · dirty files: $dirty"
  case "$behind" in ''|n/a|0) ;; *) verdict "code behind origin/main: $behind commit(s) not deployed (deploy runbook: git pull, then docker compose up -d --build)" ;; esac
}

# ---------------------------------------------------------------------------------------- 2. Containers
WORKER_RUNNING=no
DB_RUNNING=no
section_containers() {
  echo "== 2. Containers"
  ps=$(dc ps --all </dev/null --format '{{.Service}} {{.State}} {{.Status}}' 2>/dev/null) || ps=""
  if [ -z "$ps" ]; then echo "  docker compose ps: n/a"; verdict "containers: docker compose ps gave nothing (is the stack up? run from the VPS)"; return; fi
  for svc in web worker db backup caddy; do
    line=$(printf '%s\n' "$ps" | awk -v s="$svc" '$1 == s' | head -1)
    if [ -z "$line" ]; then echo "  $svc: not created"; state=missing
    else echo "  $line"; state=$(printf '%s\n' "$line" | awk '{print $2}'); fi
    [ "$svc" = worker ] && [ "$state" = running ] && WORKER_RUNNING=yes
    [ "$svc" = db ] && [ "$state" = running ] && DB_RUNNING=yes
  done
  [ "$WORKER_RUNNING" = yes ] || verdict "worker not running (logs: docker compose logs --tail 50 worker)"
  [ "$DB_RUNNING" = yes ] || verdict "db not running (every DB check below is n/a)"
  cid=$(dc ps --all -q worker </dev/null 2>/dev/null | head -1)
  if [ -z "$cid" ]; then echo "  worker inspect: n/a"; return; fi
  info=$(tmo 30 docker inspect -f '{{.RestartCount}}|{{.State.Status}}|{{.State.StartedAt}}|{{.Created}}|{{.State.ExitCode}}' "$cid" 2>/dev/null) || info=""
  if [ -z "$info" ]; then echo "  worker inspect: n/a"; return; fi
  restarts=$(printf '%s' "$info" | cut -d'|' -f1)
  wstate=$(printf '%s' "$info" | cut -d'|' -f2)
  started=$(printf '%s' "$info" | cut -d'|' -f3 | cut -c1-16)
  created=$(printf '%s' "$info" | cut -d'|' -f4)
  code=$(printf '%s' "$info" | cut -d'|' -f5)
  echo "  worker: restarts=$restarts state=$wstate started_at=${started}Z created=$(printf '%s' "$created" | cut -c1-16)Z last_exit=$code"
  if [ "$wstate" = restarting ] || { [ -n "$restarts" ] && [ "$restarts" -ge 3 ] 2>/dev/null; }; then
    verdict "worker restarting ($restarts restarts; read: docker compose logs --tail 80 worker)"
  fi
  cepoch=$(date -u -d "$created" +%s 2>/dev/null) || cepoch=""
  if [ -n "$cepoch" ] && [ -n "$HEAD_EPOCH" ] && [ "$cepoch" -lt "$HEAD_EPOCH" ] 2>/dev/null; then
    echo "  worker container was created before the checked-out commit"
    verdict "worker older than code: the container predates HEAD (rebuild: cd infra && docker compose up -d --build worker)"
  fi
}

# ------------------------------------------------------------------------------------- 3. Env presence
# Prints only a classification of NAME in .env: set|missing; DRY_RUN true|false|other|missing; WORKER_LIVE 1|not-1.
env_file_state() {
  [ -r "$ENV_FILE" ] || { echo unreadable; return; }
  awk -v want="$1" -v sq="'" '
    {
      line = $0; sub(/^[ \t]+/, "", line); sub(/^export[ \t]+/, "", line)
      eq = index(line, "="); if (eq < 2 || substr(line, 1, 1) == "#") next
      if (substr(line, 1, eq - 1) != want) next
      v = substr(line, eq + 1); found = 1
    }
    END {
      sub(/^[ \t]+/, "", v)
      if (substr(v, 1, 1) == "\"") { v = substr(v, 2); p = index(v, "\""); if (p) v = substr(v, 1, p - 1) }
      else if (substr(v, 1, 1) == sq) { v = substr(v, 2); p = index(v, sq); if (p) v = substr(v, 1, p - 1) }
      else { sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v) }
      if (want == "DRY_RUN") { if (!found || v == "") print "missing"; else if (v == "true" || v == "false") print v; else print "other" }
      else if (want == "WORKER_LIVE") { print (v == "1") ? "1" : "not-1" }
      else print (found && v != "") ? "set" : "missing"
    }' "$ENV_FILE"
}

ADP_instagram=n/a; ADP_youtube=n/a; ADP_tiktok=n/a
section_env() {
  echo "== 3. Env presence (names only; .env file vs the running worker)"
  wenv=""
  if [ "$WORKER_RUNNING" = yes ]; then
    # shellcheck disable=SC2016,SC2086
    wenv=$(dc exec -T worker sh -c '
      for n in "$@"; do
        eval "v=\${$n-}"
        case "$n" in
          DRY_RUN) case "$v" in true|false) echo "$n $v" ;; "") echo "$n missing" ;; *) echo "$n other" ;; esac ;;
          WORKER_LIVE) if [ "$v" = 1 ]; then echo "$n 1"; else echo "$n not-1"; fi ;;
          *) if [ -n "$v" ]; then echo "$n set"; else echo "$n missing"; fi ;;
        esac
      done' sh $ENV_NAMES </dev/null 2>/dev/null) || wenv=""
  fi
  [ -r "$ENV_FILE" ] || echo "  .env: unreadable or missing at the repo root"
  printf '  %-26s %-9s %s\n' NAME .env worker
  mismatch=""
  for n in $ENV_NAMES; do
    f=$(env_file_state "$n")
    w=$(printf '%s\n' "$wenv" | awk -v n="$n" '$1 == n {print $2}')
    [ -n "$w" ] || w=n/a
    printf '  %-26s %-9s %s\n' "$n" "$f" "$w"
    if [ "$w" != n/a ] && [ "$f" != unreadable ] && [ "$f" != "$w" ]; then mismatch="$mismatch $n"; fi
  done
  # Effective run mode: what the running worker sees, else the file.
  eff() { w=$(printf '%s\n' "$wenv" | awk -v n="$1" '$1 == n {print $2}'); if [ -n "$w" ]; then echo "$w"; else env_file_state "$1"; fi; }
  dry=$(eff DRY_RUN); live=$(eff WORKER_LIVE)
  [ "$dry" = false ] || verdict "DRY_RUN not false (it is '$dry'): the worker runs dry-run and sends nothing"
  [ "$live" = 1 ] || verdict "WORKER_LIVE not 1: without the live key the worker refuses live mode and runs dry-run"
  [ "$(eff TZ_CREATOR)" = set ] || verdict "TZ_CREATOR missing: a live worker refuses to start without it"
  [ "$(eff PUBLIC_MEDIA_BASE)" = set ] || verdict "PUBLIC_MEDIA_BASE missing: every outbox tick is skipped"
  [ -z "$mismatch" ] || verdict "worker env differs from .env for:$mismatch (recreate: cd infra && docker compose up -d worker)"
  for p in instagram youtube tiktok; do
    case $p in instagram) need=$NEED_INSTAGRAM ;; youtube) need=$NEED_YOUTUBE ;; tiktok) need=$NEED_TIKTOK ;; esac
    ok=yes
    for n in $need; do [ "$(eff "$n")" = set ] || ok=no; done
    eval "ADP_$p=$ok"
  done
  echo "  adapters (credentials complete): instagram=$ADP_instagram youtube=$ADP_youtube tiktok=$ADP_tiktok"
}

# ---------------------------------------------------------------------------------------- 4. Worker log
LOGS=""
cnt() { printf '%s\n' "$LOGS" | grep -cF -- "$1"; }
# outcome "<label>" "<log prefix>": the prefixes are the literal strings in packages/core/src/outbox/engine.ts,
# apps/worker/src/jobs/outbox.ts and register-outbox.ts (the test checks they still exist there).
outcome() { printf '    %-26s %s\n' "$1" "$(cnt "$2")"; }
section_logs() {
  echo "== 4. Worker log (last 24 h, UTC)"
  LOGS=$(dc logs --since 24h --no-color --timestamps worker </dev/null 2>/dev/null |
    sed -E 's/^[^|]*\| ?//; s/^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]+)?Z /\1Z /')
  if [ -z "$LOGS" ]; then echo "  logs: n/a (no output in 24 h)"; return; fi
  echo "  lines: $(printf '%s\n' "$LOGS" | wc -l | tr -d ' ') · worker starts: $(cnt 'worker started ·')"
  echo "  run mode (latest):"
  for pat in "live refused" "TZ_CREATOR is not set" "TZ_CREATOR not set" "DATABASE_URL is not set" "worker started ·"; do
    printf '%s\n' "$LOGS" | grep -F -- "$pat" | tail -n 1 | redact | cut -c1-240 | indent | indent
  done
  printf '%s\n' "$LOGS" | grep -F 'engagement modes:' | tail -n 1 |
    sed -nE 's/^([^ ]+) .* · (live=(true|false)) · (killEnv=(true|false)).*/\1 engagement \2 \4/p' | indent | indent
  last_start=$(printf '%s\n' "$LOGS" | grep -F 'worker started ·' | tail -n 1)
  case "$last_start" in *"dry_run=true"*) verdict "worker running dry-run: its latest startup line says dry_run=true (fix DRY_RUN/WORKER_LIVE, then cd infra && docker compose up -d worker)" ;; esac
  [ "$(cnt 'live refused')" = 0 ] || verdict "live refused in the worker log: only one of the two live keys is set (DRY_RUN=false AND WORKER_LIVE=1)"
  [ "$(cnt 'TZ_CREATOR is not set')" = 0 ] || verdict "worker exited: TZ_CREATOR is not set for a live run"
  echo "  outbox outcomes (24 h):"
  outcome "tick summaries" "[outbox] tick: considered"
  outcome "published" "[outbox] published "
  outcome "recovered" "[outbox] recovered "
  outcome "queued for retry" "[outbox] queued "
  outcome "FAILED" "[outbox] FAILED "
  outcome "UNKNOWN" "[outbox] UNKNOWN "
  outcome "cap hold" "[outbox] cap: "
  outcome "dry-run would publish" "[outbox] dry-run: would publish"
  outcome "dry-run would refuse" "[outbox] dry-run: would refuse"
  outcome "skipped (no r2_key)" "[outbox] skipping item"
  outcome "media base invalid" "[outbox] PUBLIC_MEDIA_BASE missing or invalid"
  outcome "tick busy (lock)" "[outbox] tick already running"
  outcome "alerts" "[alert] "
  echo "  last tick summaries:"
  printf '%s\n' "$LOGS" | grep -F '[outbox] tick: considered' | tail -n 3 | redact | cut -c1-240 | indent | indent
  f=$(cnt '[outbox] FAILED '); u=$(cnt '[outbox] UNKNOWN ')
  if [ "$f" != 0 ] || [ "$u" != 0 ]; then verdict "outbox FAILED/UNKNOWN in 24 h: $f failed, $u unknown (failed-or-unknown-post runbook)"; fi
  [ "$(cnt '[outbox] dry-run: would publish')" = 0 ] || verdict "dry-run would publish: due posts were only logged, not sent (run mode is dry-run)"
  [ "$(cnt '[outbox] PUBLIC_MEDIA_BASE missing or invalid')" = 0 ] || verdict "media base invalid: PUBLIC_MEDIA_BASE missing or not an absolute https URL; ticks skipped"
  echo "  last 15 error-like lines (redacted):"
  errs=$(printf '%s\n' "$LOGS" | grep -Ei 'error|fail|unknown|refused|401|403|expired' |
    grep -vF -e '[outbox] tick: considered' -e '[engage] send tick:' | tail -n 15 | redact | cut -c1-240)
  if [ -n "$errs" ]; then printf '%s\n' "$errs" | indent | indent; else echo "    none"; fi
  auth=$(printf '%s\n' "$errs" | grep -Eci '(^|[^0-9])(401|403)([^0-9]|$)|invalid_grant|expired|unauthori[sz]ed|OAuthException|invalid[_ ]token|access token')
  [ "$auth" = 0 ] || verdict "token/auth errors in the worker log ($auth line(s)): token-renewal runbook"
}

# ---------------------------------------------------------------------------------------- 5. Migrations
section_migrations() {
  echo "== 5. Migrations"
  files=$(ls "$ROOT/packages/db/migrations" 2>/dev/null | grep -E '^[0-9]{4}_.*\.sql$' | sort)
  applied=$(psql_ro <<'SQL_MIGRATIONS'
select id from schema_migrations order by id;
SQL_MIGRATIONS
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  applied: n/a ($(first_err "$applied"))"; [ "$DB_RUNNING" = yes ] && verdict "db unreadable: migrations query failed"; return; fi
  applied=$(printf '%s\n' "$applied" | grep -E '^[0-9]{4}_' | sort)
  missing=$(comm -23 <(printf '%s\n' "$files") <(printf '%s\n' "$applied") | grep . | tr '\n' ' ')
  extra=$(comm -13 <(printf '%s\n' "$files") <(printf '%s\n' "$applied") | grep . | tr '\n' ' ')
  echo "  files: $(printf '%s\n' "$files" | grep -c .) · applied: $(printf '%s\n' "$applied" | grep -c .) · latest applied: $(printf '%s\n' "$applied" | tail -1)"
  echo "  missing: ${missing:-none}"
  [ -z "$extra" ] || echo "  applied but no file here (code older than DB?): $extra"
  [ -z "$missing" ] || verdict "migrations missing: $missing(migrations runbook)"
}

# ------------------------------------------------------------------------------------ 6. Posts around now
section_posts() {
  echo "== 6. Posts scheduled within now ± 36 h (UTC; no captions)"
  out=$(psql_ro <<'SQL_POSTS'
with w as (
  select bi.id, bi.platform, bi.status, bi.approved_at, bi.scheduled_for, bi.updated_at, bi.attempts, bi.last_error,
         b.status as batch_status, m.r2_key is not null as has_r2,
         (select a.kind from alerts a where a.batch_item_id = bi.id and a.acknowledged_at is null order by a.created_at desc limit 1) as open_alert,
         -- "why not due": the first failing condition of PgOutboxStore.listDue (apps/worker/src/jobs/outbox.ts).
         -- 'due' exactly when listDue returns the row:
         --   b.status = 'approved' and bi.approved_at is not null and m.r2_key is not null
         --   and (bi.status = 'approved' or (bi.status = 'queued' and (bi.next_attempt_at is null or bi.next_attempt_at <= now)))
         case
           when bi.status in ('published', 'failed', 'unknown', 'rejected') then 'already terminal'
           when bi.status = 'publishing' then 'in flight (publishing)'
           when bi.status not in ('approved', 'queued') then 'item not approved'
           when b.status <> 'approved' then 'batch not approved'
           when bi.approved_at is null then 'no approved_at'
           when m.r2_key is null then 'media has no r2_key'
           when bi.status = 'queued' and bi.next_attempt_at > now() then 'in backoff'
           else 'due'
         end as why,
         -- Engine timing after listDue (isDueNow, packages/core/src/outbox/engine.ts): native platforms
         -- (youtube, tiktok) are handed off 24 h ahead, instagram fires at scheduled_for, snapchat never.
         case
           when bi.platform = 'snapchat' then 'assisted, never fired'
           when bi.status = 'queued' then 'retry at next_attempt_at'
           when bi.platform in ('youtube', 'tiktok') then
             case when bi.scheduled_for - interval '24 hours' <= now() then 'hand-off window open'
                  else 'hand-off opens ' || to_char((bi.scheduled_for - interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') end
           when bi.scheduled_for <= now() then 'fire time reached'
           else 'fires at scheduled_for'
         end as timing
    from batch_items bi
    join batches b on b.id = bi.batch_id
    join media m on m.id = bi.media_id
   where bi.scheduled_for between now() - interval '36 hours' and now() + interval '36 hours'
)
select line from (
  select 1 as part, w.scheduled_for as k,
         format('ITEM %s %s %s appr=%s batch=%s sched=%s pub=%s att=%s err=%s/%s r2=%s alert=%s timing=%s | why=%s',
           left(w.id::text, 8), w.platform, w.status,
           case when w.approved_at is not null then 'y' else 'n' end,
           w.batch_status,
           to_char(w.scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           -- batch_items has no published_at; updated_at is the moment it became 'published'.
           case when w.status = 'published' then to_char(w.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') else '-' end,
           w.attempts,
           coalesce(substring(w.last_error from '\m([45][0-9][0-9])\M'), '-'),
           case
             when w.last_error is null or w.last_error = '' then '-'
             when w.last_error ~* 'privacy lint' then 'privacy-lint'
             when w.last_error ~* 'media url refused|r2_key|clean file' then 'media'
             when w.last_error ~* '\m(401|403)\M|token|oauth|unauthori[sz]ed|forbidden|expired|invalid_grant|permission' then 'auth'
             when w.last_error ~* '\m429\M|quota|rate.?limit|too many' then 'rate-or-quota'
             when w.last_error ~* 'timeout|timed out|abort|network|econnreset|etimedout|mid-publish' then 'timeout'
             when w.last_error ~* 'existence check' then 'lookup'
             when w.last_error ~* '\m5[0-9][0-9]\M' then 'platform-5xx'
             when w.last_error ~* '\m4[0-9][0-9]\M' then 'rejected-4xx'
             else 'other'
           end,
           case when w.has_r2 then 'y' else 'n' end,
           coalesce(w.open_alert, '-'),
           w.timing,
           w.why) as line
    from w
  union all
  select 2, null::timestamptz,
         format('COUNT %s %s appr=%s batch=%s n=%s', w.platform, w.status, case when w.approved_at is not null then 'y' else 'n' end, w.batch_status, count(*))
    from w group by w.platform, w.status, (w.approved_at is not null), w.batch_status
  union all
  -- Machine-readable, for the VERDICT: items that should have been sent or handed off by now and aren't published.
  select 3, null::timestamptz,
         format('WHY|%s|%s|%s', w.platform,
           case when w.status in ('failed', 'unknown') then 'post ' || w.status else w.why end, count(*))
    from w
   where w.status not in ('published', 'rejected') and w.platform <> 'snapchat'
     and w.scheduled_for <= now() + case when w.platform in ('youtube', 'tiktok') then interval '24 hours' else interval '0 hours' end
   group by w.platform, case when w.status in ('failed', 'unknown') then 'post ' || w.status else w.why end
) x
order by part, k nulls last, line;
SQL_POSTS
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  posts: n/a ($(first_err "$out"))"; [ "$DB_RUNNING" = yes ] && verdict "db unreadable: posts query failed"; return; fi
  items=$(printf '%s\n' "$out" | sed -n 's/^ITEM //p')
  if [ -z "$items" ]; then
    echo "  no items scheduled within now ± 36 h"
    verdict "no posts scheduled within 36 h of now (check the batch has times and was saved)"
  else
    echo "  id       platform status approved batch scheduled_for published attempts err(code/class) r2 alert timing | why not due"
    printf '%s\n' "$items" | indent
  fi
  counts=$(printf '%s\n' "$out" | sed -n 's/^COUNT //p')
  if [ -n "$counts" ]; then echo "  counts (platform status approved batch n):"; printf '%s\n' "$counts" | indent | indent; fi
  while IFS='|' read -r _ platform why n; do
    [ -n "$platform" ] || continue
    case "$platform" in instagram) adp=$ADP_instagram ;; youtube) adp=$ADP_youtube ;; tiktok) adp=$ADP_tiktok ;; *) adp=n/a ;; esac
    case "$why" in
      due)
        if [ "$adp" = no ]; then verdict "$platform credentials missing: $n due item(s) but no $platform adapter in the worker (posts are skipped)"
        else verdict "due but not sent: $n $platform item(s) are due and still waiting (run mode, adapter or pg-boss)"; fi ;;
      "post failed"|"post unknown") verdict "$why: $n $platform item(s) (failed-or-unknown-post runbook)" ;;
      *) verdict "$why: $n $platform item(s) not sent" ;;
    esac
  done < <(printf '%s\n' "$out" | grep '^WHY|')
}

# --------------------------------------------------------------------------------------------- 7. pg-boss
section_pgboss() {
  echo "== 7. pg-boss (queue outbox-tick)"
  out=$(psql_ro <<'SQL_PGBOSS'
with t as (
  select state::text as state, created_on, started_on, completed_on from pgboss.job where name = 'outbox-tick'
  union all
  select state::text, created_on, started_on, completed_on from pgboss.archive where name = 'outbox-tick'
)
select line from (
  -- to_jsonb(row)->>'col' reads a column that may not exist in this pg-boss version without failing.
  select 1 as part, s.name as k,
         format('SCHED %s cron=%s tz=%s', s.name, s.cron,
           case when coalesce(to_jsonb(s)->>'timezone', '') = '' then '-'
                when to_jsonb(s)->>'timezone' ~ '^(Etc/)?UTC$' then 'UTC' else 'set' end) as line
    from pgboss.schedule s
  union all
  select 2, null, format('CRON_ON %s', coalesce(to_char((to_jsonb(v)->>'cron_on')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), '-'))
    from pgboss.version v
  union all
  select 3, lpad(j.rn::text, 2, '0'),
         format('JOB %s created=%s started=%s completed=%s', j.state,
           coalesce(to_char(j.created_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'),
           coalesce(to_char(j.started_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'),
           coalesce(to_char(j.completed_on at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'))
    from (select t.*, row_number() over (order by t.created_on desc) as rn from t) j
   where j.rn <= 5
  union all
  select 4, null, format('STATES24H %s', coalesce(string_agg(c.state || '=' || c.n, ' ' order by c.state), 'none'))
    from (select state, count(*) as n from t where created_on > now() - interval '24 hours' group by state) c
  union all
  select 5, null, format('LAST_COMPLETED_AGE_MIN %s', coalesce(floor(extract(epoch from now() - max(completed_on)) / 60)::bigint::text, 'never'))
    from t where state = 'completed'
  union all
  select 6, null, format('BACKLOG %s', count(*))
    from t where state in ('created', 'retry') and created_on < now() - interval '5 minutes'
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
  printf '%s\n' "$out" | grep -E '^(SCHED|CRON_ON|JOB|STATES24H|LAST_COMPLETED_AGE_MIN|BACKLOG) ' | indent
  printf '%s\n' "$out" | grep -q '^SCHED outbox-tick ' || verdict "outbox-tick not scheduled in pg-boss (the worker registers it at startup: check it started)"
  age=$(printf '%s\n' "$out" | sed -n 's/^LAST_COMPLETED_AGE_MIN //p')
  case "$age" in
    never) verdict "outbox-tick never completed: no worker is consuming the queue" ;;
    ''|*[!0-9]*) ;;
    *) [ "$age" -le 5 ] || verdict "outbox-tick not completing: last completed $age min ago (expected every minute; worker stuck or down)" ;;
  esac
  backlog=$(printf '%s\n' "$out" | sed -n 's/^BACKLOG //p')
  case "$backlog" in ''|0|*[!0-9]*) ;; *) verdict "outbox-tick backlog: $backlog job(s) waiting > 5 min (no worker picking them up)" ;; esac

  fout=$(psql_ro <<'SQL_PGBOSS_FAILED'
with t as (
  select state::text as state, created_on, completed_on, output from pgboss.job where name = 'outbox-tick'
  union all
  select state::text, created_on, completed_on, output from pgboss.archive where name = 'outbox-tick'
)
select format('FAILED24H %s', count(*)) from t
 where state = 'failed' and coalesce(completed_on, created_on) > now() - interval '24 hours'
union all
select * from (
  select format('LASTFAIL %s %s',
           to_char(coalesce(completed_on, created_on) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           left(regexp_replace(coalesce(output->>'message', output::text, '-'), '\s+', ' ', 'g'), 1000))
    from t where state = 'failed'
   order by coalesce(completed_on, created_on) desc
   limit 1
) f;
SQL_PGBOSS_FAILED
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  failed jobs: pgboss: unreadable ($(first_err "$fout"))"; return; fi
  nf=$(printf '%s\n' "$fout" | sed -n 's/^FAILED24H //p')
  echo "  failed in 24 h: ${nf:-n/a}"
  printf '%s\n' "$fout" | grep '^LASTFAIL ' | redact | cut -c1-210 | indent
  case "$nf" in ''|0|*[!0-9]*) ;; *) verdict "outbox-tick jobs failing: $nf failed in 24 h (the tick itself throws; see the last failure above)" ;; esac
}

# ---------------------------------------------------------------------------------------- 8. Open alerts
section_alerts() {
  echo "== 8. Open alerts (unacknowledged)"
  out=$(psql_ro <<'SQL_ALERTS'
select line from (
  select 1 as part, null::timestamptz as k, format('KIND %s n=%s', kind, count(*)) as line
    from alerts where acknowledged_at is null group by kind
  union all
  select 2, a.created_at,
         format('MSG %s %s %s %s', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), a.kind, a.platform,
           -- creator-local wall-clock times (e.g. a missed-slot "10:00") next to UTC stamps would reveal the offset.
           left(regexp_replace(regexp_replace(a.message, '\s+', ' ', 'g'), '\m[0-9]{1,2}:[0-9]{2}\M', 'hh:mm', 'g'), 160))
    from (select * from alerts where acknowledged_at is null order by created_at desc limit 5) a
) x
order by part, k desc nulls last, line;
SQL_ALERTS
)
  rc=$?
  if [ $rc -ne 0 ]; then echo "  alerts: n/a ($(first_err "$out"))"; return; fi
  kinds=$(printf '%s\n' "$out" | sed -n 's/^KIND //p')
  if [ -z "$kinds" ]; then echo "  none"; return; fi
  echo "  by kind:"; printf '%s\n' "$kinds" | indent | indent
  echo "  newest 5:"; printf '%s\n' "$out" | sed -n 's/^MSG //p' | redact | cut -c1-200 | indent | indent
  urgent=$(printf '%s\n' "$kinds" | grep -E '^(final-failure|unknown-outcome|config|token-health|duplicate|cap-breach) ' | awk '{print $1 "(" substr($2, 3) ")"}' | tr '\n' ' ')
  [ -z "$urgent" ] || verdict "open alerts: $urgent(read them on /alerts)"
}

print_verdict() {
  echo "== VERDICT (in check order; fix the first one first)"
  if [ -z "$VERDICTS" ]; then echo "  ok: nothing obviously wrong was found"; return; fi
  printf '%s' "$VERDICTS" | awk 'NF { print "  " ++i ". " $0 }'
}

main() {
  echo "diagnose-posting · $(date -u +%Y-%m-%dT%H:%MZ) · read-only · TZ_CREATOR: $(env_file_state TZ_CREATOR | sed 's/unreadable/missing/')"
  section_code
  section_containers
  section_env
  section_logs
  section_migrations
  section_posts
  section_pgboss
  section_alerts
  print_verdict
}

main 2>&1 | scrub_env_values
exit 0
