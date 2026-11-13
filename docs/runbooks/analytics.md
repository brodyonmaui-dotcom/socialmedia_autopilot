# Analytics ingest (F9)

The worker job `analytics-ingest` runs every hour at :23 (`23 * * * *`). It loads posts published in the last 30 days, takes a metrics snapshot when a post reaches 24 h, 72 h, 7 d or 28 d, and writes it to `post_metrics`. Each post gets at most one row per age, so re-runs are harmless. `/analytics` reads those rows.

- **Read-only.** It only makes GET requests, plus the YouTube token refresh (a POST with no public effect). That's why it runs in dry-run too. The worker's startup line says `analytics=read-only · sources=ig,yt · cron=23 * * * *`.
- **Sources.** Instagram runs when `META_ACCESS_TOKEN` is set. YouTube runs when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `YT_REFRESH_TOKEN` are all set; it gets a fresh access token every run. With none of these set, the job logs `[analytics] analytics: no sources` and does nothing.
- **Limits.** At most 50 posts per run, oldest due first. A missed checkpoint is skipped, not back-filled.
- **One log line per run**, for example `[analytics] captured 2 · failed 1 (ig 0, yt 1) · no-source 1`. A platform with failures also gets a line with its last error, sanitised and at most 200 chars. Token values never appear in logs or alerts. `no-source` means a post on a platform with no source (TikTok, Snapchat), which is expected.

Check it: `ssh autopilot`, then `cd /opt/autopilot/infra && docker compose logs worker --since 3h | grep '\[analytics\]'`.

## A `metrics-health` alert
It means **one platform's metrics source failed every fetch in 3 runs in a row** (about 3 hours). A run where at least one fetch succeeds resets the count. Nothing public is affected: posting and engagement are separate jobs. The only cost is stale numbers on `/analytics`. The alert is page-only (no push).

- You get one open alert per platform, not one per run. It isn't raised again while it's open. After you acknowledge it, a new one comes only once the source has recovered and then failed 3 runs in a row again. The counter lives in `settings.metrics_health`.
- When the source works again, the log says `[analytics] metrics-health <platform>: recovered`. Snapshots resume on the next due checkpoint; any that were missed meanwhile are not back-filled.

**What to do**
1. Read the alert message, or the `last error` log line. An auth error (Meta code 190, Google `invalid_grant`, HTTP 401/403) means the token needs renewing: follow [token-renewal.md](token-renewal.md). Instagram data access ends **2027-02-08** unless renewed.
2. If the error is a changed response shape or an unknown metric name, re-run the read-only probes (next section) and paste the lines back to the agent so it can update the parsers in `packages/analytics/src/sources.ts`.
3. Acknowledge the alert on the dashboard once it's handled.

## Re-run the probes (read-only)
On the server: `ssh autopilot`, `cd /opt/autopilot`, then:
- `./infra/probe.sh ig`
- `./infra/probe.sh yt`

Both are read-only (the YouTube one refreshes a token, which has no public effect). They print one-line summaries. Paste back **only these lines**; they hold key paths and JSON types, never values, ids or names:
- `ig.reel_insights`: which reel metric names Meta accepts and which it rejects
- `ig.reel_insight_shape`: the shape of one insights response
- `ig.media_fields_shape`: the shape of `like_count` / `comments_count`
- `yt.video_stats_shape`: the shape of `videos.list?part=statistics` for the newest upload

Status (2026-11-13): the parsers are still built from the docs (`docs/research.md`, "Metrics response shapes"). They haven't been checked against these probe lines yet (F9 T3).

## Why TikTok (and Snapchat) metrics are manual
- **TikTok:** we're on Zernio's free plan, and its analytics may need a paid add-on (it can return HTTP 402). Checking that takes one API call, which is your call (`docs/tiktok-free-plan.md`). So `ZERNIO_ANALYTICS` stays unset and you check TikTok numbers in the app. Setting `ZERNIO_ANALYTICS=1` in `.env` (plus a worker restart) would turn on the Zernio source. Ask first: it touches a paid-plan feature.
- **Snapchat:** posting is assisted (no API), so there are no metrics to pull.
