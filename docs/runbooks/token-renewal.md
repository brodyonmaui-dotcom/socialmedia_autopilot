# Token renewal

Tokens live in the server's `.env` (and the gitignored secrets folder on the VPS), never in git, logs or chat. The probes print one-line PASS/FAIL summaries and never echo token values.

**The worker reads `.env` only.** A token that's only in `.secrets/` (for example `.secrets/yt.json`) is invisible to it: the platform's adapter isn't built, and its posts are silently **skipped**, not failed (seen 2026-11-12, when `YT_REFRESH_TOKEN` and `ZERNIO_TIKTOK_ACCOUNT_ID` were empty). After any change to `.env`, recreate the worker (`docker compose up -d`) and check by name that the variable is non-empty.

## How long each connection lasts
| Platform | What the worker uses (`.env`) | Lasts | Ends early if |
|---|---|---|---|
| Instagram (Meta) | `META_ACCESS_TOKEN` (Page token) + `IG_USER_ID` | Token: no fixed expiry. **Data access: until 2027-02-08** (90-day window) | You remove the app in Facebook settings, change the Facebook password, or lose Page admin (Meta's general token rules, not re-checked 2026-11-12) |
| YouTube (Google) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, **`YT_REFRESH_TOKEN`** | No fixed expiry while the Google app stays "In production" | Unused for 6 months; you revoke access in your Google account; more than 100 refresh tokens are issued for this account + client (each `--auth` run makes a new one, and the oldest dies); the app goes back to "Testing", where tokens last 7 days |
| TikTok (Zernio) | `ZERNIO_API_KEY` + `ZERNIO_TIKTOK_ACCOUNT_ID` | Zernio's docs give no expiry for API keys or connections. Zernio refreshes the TikTok token itself | You revoke the key, or TikTok drops the connection (Zernio's account health shows token issues). Reconnecting the same TikTok account keeps the same account ID and history |
| Snapchat | nothing (assisted share from the phone) | n/a | n/a |

Sources (checked 2026-11-12): Google OAuth 2.0 docs (refresh-token expiration: 6 months unused, revoked, 100-token limit, Testing = 7 days), docs.zernio.com `platforms/tiktok` and `accounts/get-account-health`. Meta: the M0 result in `docs/research.md`.

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
- OAuth refresh token: **`YT_REFRESH_TOKEN` must be in `.env`.** `pnpm probe:yt --auth` writes it to `.secrets/yt.json` (path in `scripts/probes/yt.ts`). The probe can read that file, but the worker can't, so copy the token into `.env` by hand every time you re-auth. The Google app is "In production", unverified, no logo (adding a logo triggers brand verification).
- **Symptom:** the YouTube adapter or `./infra/probe.sh yt` fails at token refresh (`invalid_grant`).
- **Steps:** run `pnpm probe:yt --auth` (paste-the-redirect-URL flow) **[changes state: writes the token file]**, copy the refresh token into the server's `.env` by hand, run `./infra/probe.sh yt`, then `docker compose up -d`.
- **Gotcha:** the console shows a client secret only once. If `GOOGLE_CLIENT_SECRET` is in doubt, use "Add secret" rather than re-copying it.
- Watch time (YouTube Analytics, `yt-analytics.readonly`) isn't granted. Adding it means re-consent; planned for a later session with the creator.

## Zernio (TikTok)
- `ZERNIO_API_KEY` + `ZERNIO_TIKTOK_ACCOUNT_ID` in `.env`. **Free plan only; no Analytics add-on** (creator, 2026-11-11): TikTok metrics and comment replies are manual.
- **Symptom:** `HTTP 401` (`missing_credentials` / `invalid_credentials`), or the account health check reports token issues.
- **Steps:** create a new API key in the Zernio dashboard, put it in `.env` on the server, run `./infra/probe.sh tiktok` (accounts + creator-info + `dryRun` canPublish, read-only), then `docker compose up -d` **[changes state]**. If TikTok itself disconnected, reconnect it in the Zernio dashboard and check it stayed a **Personal** account (decisions.md).
