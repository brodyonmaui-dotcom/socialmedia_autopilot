# Alerts acknowledge
Files: apps/web/lib/alerts/queries.ts:20-140 (parseKind :28, acknowledge :101-110, acknowledgeAll :113-121), apps/web/app/alerts/actions.ts:1-40

## What it does
- acknowledge (queries.ts:101) sets acknowledged_at and acknowledged_session on the given ids, only where still null; returns the row count.
- cleanIds (queries.ts:37-44) keeps well-formed UUIDs, lowercases, de-duplicates, caps at LIST_LIMIT (200).
- parseKind (queries.ts:28-30) maps a raw kind to a known AlertKind or undefined; the result only ever reaches SQL as a bind parameter.
- acknowledgeAll (queries.ts:113) acknowledges every open alert, optionally one kind; actions.ts does not import it (actions.ts:6).
- actions.ts: acknowledgeAction (:25) takes one id; acknowledgeShownAction (:35) takes repeated id fields; both call requireSession first.

## SQL (verbatim)
```sql
-- queries.ts:50 (stateWhere, open tab)
a.acknowledged_at is null
-- queries.ts:52 (stateWhere, acknowledged tab; param pushed)
a.acknowledged_at >= $${params.length}
-- queries.ts:62 (kind filter; param pushed)
and a.kind = $${params.length}
-- queries.ts:65 (order, chosen from two literals)
const order = opts.state === "open" ? "a.created_at desc, a.id" : "a.acknowledged_at desc, a.id";
-- queries.ts:66-71 (listAlerts)
select a.id, a.kind, a.platform, a.message, a.created_at, a.acknowledged_at, a.batch_item_id, bi.batch_id
  from alerts a left join batch_items bi on bi.id = a.batch_item_id
 where ${where}
 order by ${order}
 limit $${params.length}
-- queries.ts:90 (countByKind)
select a.kind, count(*)::int as n from alerts a where ${where} group by a.kind
-- queries.ts:104-107 (acknowledge)
update alerts set acknowledged_at = $2, acknowledged_session = $3
 where id = any($1::uuid[]) and acknowledged_at is null
-- queries.ts:115-118 (acknowledgeAll)
update alerts set acknowledged_at = $1, acknowledged_session = $2
 where acknowledged_at is null and ($3::text is null or kind = $3)
```

## Branches that write or send
- queries.ts:103 cleanIds empty → return 0; no query, no write.
- queries.ts:104-109 acknowledge: UPDATE alerts for cleaned ids (write); returns rowCount.
- queries.ts:60-63 listAlerts: kind present → extra filter (read).
- queries.ts:74-83 listAlerts: returns AlertView rows (message, ids, timestamps) to the page (data to client).
- queries.ts:90-93 countByKind: read; returns per-kind counts to the page.
- queries.ts:115-119 acknowledgeAll: UPDATE alerts for all open rows, kind optional (write); no caller in these files.
- actions.ts:27-28 acknowledgeAction: calls acknowledge (write); returns void.
- actions.ts:38 acknowledgeShownAction: no ids → {ok:false}, no write; :39 otherwise UPDATE via acknowledge; returns count.
- actions.ts:16 DB error → fixed "something went wrong" to client; :19-20 revalidate /alerts and /.

## Attack surface (from the brief)
Attack: acknowledges only open rows, only shown ids; no delete; kind filter injection (parseKind).
- Only open rows: queries.ts:105-106 `and acknowledged_at is null`; acknowledgeAll queries.ts:117.
- Only shown ids: actions.ts:37 getAll("id") → cleanIds (queries.ts:37-44: format, dedupe, cap 200). Not found: any check that the ids were rendered on the page; acknowledgeAction (actions.ts:27) accepts any single id.
- No delete: not found in these files; the only writes are `update alerts` at queries.ts:105 and :116.
- Kind filter injection: parseKind queries.ts:28-30 via isAlertKind (imported queries.ts:4 from @autopilot/core, not read); kind bound as $N at queries.ts:62 and as $3::text at :117; `${where}` and `${order}` come from fixed literals (queries.ts:50, :52, :65).

## Findings
| # | Finding | Status | Test |
|---|---|---|---|
| 1 | acknowledgeAll with an unknown kind fell back to null = acknowledge ALL open alerts (fail-open bulk write) | fixed (test queries-static.test.ts › acknowledgeAll with an unknown kind acknowledges nothing) | now returns 0, no query; no caller yet, but the filter must not widen |
| 2 | Acknowledges only open rows | not-an-issue (`acknowledged_at is null` in both updates) | queries.db.test.ts › acknowledgeAll(kind) touches only that kind's open rows |
| 3 | Only the shown ids | not-an-issue (AckAllSheet sends `alerts.map(a => a.id)` of the rendered list; cleanIds caps 200; single-card ack of any id is the owner's own session) | queries-static.test.ts › cleanIds keeps only uuids, de-duplicated |
| 4 | Delete | not-an-issue (only `update alerts`; no delete in queries/actions/ui) | queries-static.test.ts › never deletes alerts |
| 5 | Kind filter injection via parseKind | not-an-issue (isAlertKind = includes() on ALERT_KINDS; value only ever a bind param; where/order from literals) | queries-static.test.ts › accepts every known kind and nothing else |
