# Token renewal

Tokens live in the server's `.env` (and the gitignored secrets folder on the VPS), never in git, logs or chat. The probes print one-line PASS/FAIL summaries and never echo token values.

## Meta (Instagram): data access expires **2027-02-08**
- The Page token (`META_ACCESS_TOKEN`) has **no fixed expiry**, but Meta's 90-day **data-access window** ends 2027-02-08 (M0 Instagram result, 2026-11-10). After that, reads fail until someone re-consents.
- `pnpm skill:platform-check` warns 14 days ahead. The worker should alert 7 days ahead (F4 token health).
- The old long-lived **user** token (`META_USER_TOKEN`, expires 2026-12-18) was replaced by the Page token. It's allowed to lapse (creator, 2026-11-11), and nothing posts with it.

**Steps** (before 2027-02-08; needs your Facebook login, so you run it):
1. `ssh autopilot`, then `cd /opt/autopilot`.
2. `./infra/probe.sh connect-meta` **[changes state: rewrites the Meta values in `.env`]**. It walks the Facebook Login consent, exchanges for a long-lived user token, picks the Page token, and writes `META_ACCESS_TOKEN`, `META_USER_TOKEN` and `IG_USER_ID`. All 8 scopes must show granted.
3. `./infra/probe.sh ig`: read-only check (account, publishing quota, insights).
4. `cd infra && docker compose up -d` **[changes state]** so `worker` and `web` pick up the new `.env`.
5. Update the "data access until" date in `docs/research.md` so platform-check tracks the new deadline.

## YouTube
- OAuth refresh token: `YT_REFRESH_TOKEN` in `.env`, or the file `pnpm probe:yt --auth` writes (location in `scripts/probes/yt.ts`). The Google app is "In production", unverified, no logo (adding a logo triggers brand verification).
- **Symptom:** the YouTube adapter or `./infra/probe.sh yt` fails at token refresh (`invalid_grant`).
- **Steps:** run `pnpm probe:yt --auth` (paste-the-redirect-URL flow) **[changes state: writes the token file]**, copy the refresh token into the server's `.env` by hand, run `./infra/probe.sh yt`, then `docker compose up -d`.
- **Gotcha:** the console shows a client secret only once. If `GOOGLE_CLIENT_SECRET` is in doubt, use "Add secret" rather than re-copying it.
- Watch time (YouTube Analytics, `yt-analytics.readonly`) isn't granted. Adding it means re-consent; planned for a later session with the creator.

## Zernio (TikTok)
- `ZERNIO_API_KEY` + `ZERNIO_TIKTOK_ACCOUNT_ID` in `.env`. **Free plan only; no Analytics add-on** (creator, 2026-11-11): TikTok metrics and comment replies are manual.
- **Symptom:** `HTTP 401` (`missing_credentials` / `invalid_credentials`), or the account health check reports token issues.
- **Steps:** create a new API key in the Zernio dashboard, put it in `.env` on the server, run `./infra/probe.sh tiktok` (accounts + creator-info + `dryRun` canPublish, read-only), then `docker compose up -d` **[changes state]**. If TikTok itself disconnected, reconnect it in the Zernio dashboard and check it stayed a **Personal** account (decisions.md).
