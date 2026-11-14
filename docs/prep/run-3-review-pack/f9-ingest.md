# F9 analytics ingest job
Files: apps/worker/src/jobs/analytics-ingest.ts:96-148 (focus ~100-160; file ends at 148), packages/analytics/src/health.ts:1-42, packages/analytics/src/sources.ts:16, 28-33, 52, 55, 73, 114, 145

## What it does
- Hourly (cron "23 * * * *", analytics-ingest.ts:33). Loads published posts (:120), fetches metrics per platform, writes snapshots via writeSnapshot (:121).
- Builds sources per run (:73-86). Instagram and Zernio TikTok are GETs. YouTube refreshes its token each run (:78, POST inside refreshAccessToken); on failure it gets a failingSource (:80-82).
- nextHealth counts runs where every attempted fetch failed; trips exactly when consecutive reaches 3 (health.ts:32-35).
- On trip, raiseMetricsHealthAlert inserts one open metrics-health row per platform (:96-105, :128-132).
- Logs counts and last error per platform (:122-123, :129).

## SQL (verbatim)
```sql
-- analytics-ingest.ts:98-101 raiseMetricsHealthAlert
insert into alerts (kind, batch_item_id, platform, message, created_at)
     select $1, null, $2, $3, $4
      where not exists (select 1 from alerts where kind = $1 and platform = $2 and acknowledged_at is null)
     returning id
```
No raw SQL in health.ts or sources.ts. Other DB writes go through setSetting (:127) and writeSnapshot (:121), both defined outside this hunk.

## Branches that write or send
- analytics-ingest.ts:114-117 no configured sources: log, return. No fetch, no write.
- :75 cfg.instagram set: GET per post via sources.ts:55 (per metric, :69) and :73.
- :76-82 cfg.youtube set: refreshAccessToken (POST, @autopilot/adapters, outside hunk) at :78. Catch at :80-82 gives failingSource, no token fetch.
- :84 cfg.tiktok set: GET sources.ts:145.
- :121 ingestOnce + writeSnapshot: DB writes for captured snapshots.
- :127 any platform attempted: setSetting metrics_health (DB write).
- :128-132 each platform in health.trip, if no open unacknowledged metrics-health row (:100): insert (DB write).
- :123 and :129 log lines (no network, no write).
- Returns IngestResult to the job runner. No client-facing response in this hunk.

## Attack surface (from the brief)
Attack: any non-GET call besides the YT token refresh; tokens in logs/alerts; alert storm (one per run instead of one per trip).
- Non-GET calls: FetchLike init has only headers, no method (sources.ts:16). Calls at sources.ts:55, 73, 114, 145 set no method, so GET. YT token refresh: analytics-ingest.ts:78. Other non-GET calls: not found in hunk.
- Tokens in logs/alerts: tokens go in the Authorization header (sources.ts:52, 114, 145), not the URL (sources.ts:55, 73, 114, 145). apiError puts the provider body message into the error (sources.ts:28-33). Line :123 logs lastErrorByPlatform with no sanitizer in this hunk. Alert text is sanitized at :129 (sanitizeForLog, slice 300). YT refresh error uses safeErrorMessage at :81. Sanitizer definitions: outside hunk.
- Alert storm: trip fires only at consecutive === 3 (health.ts:35), so once per streak. Insert guarded by not-exists on unacknowledged rows (analytics-ingest.ts:100). Loop is per trip (:128-132). Recovery does not close the alert: no UPDATE of alerts in hunk (health.ts:37 and :133 log only).

## Findings
_(red-team pass fills this)_
