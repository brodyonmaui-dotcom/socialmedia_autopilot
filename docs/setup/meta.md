# Instagram (you already have the Meta app + Page)

1. **Check the app** at developers.facebook.com → your app. Note these without pasting secrets:
   - **App Mode:** Live or Development? Webhooks need Live. Live needs a privacy URL: use `https://app.<yourdomain>/privacy`.
   - **Use case / product:** "Instagram API with Facebook Login" or "Instagram API with Instagram Login"? We want Facebook Login, for creator tracking.
2. **Token into the server.** Put your existing token in `/opt/autopilot/.env` as `META_ACCESS_TOKEN=` with `nano`. Also add `META_APP_ID` and `META_APP_SECRET` (App settings → Basic).
3. **Run the read-only probe:**
   ```
   cd /opt/autopilot && ./infra/probe.sh ig --creator=<a public creator you like>
   ```
   It reads your account, scopes, publishing quota, recent posts + comments, which reel-insight metrics work, and one Business Discovery lookup. It posts nothing.
4. Copy the `IG_USER_ID=…` it prints into `.env`.

Paste back: the `PASS/FAIL ig.*` lines. They contain no secrets.

Token lifetime: a normal long-lived token lasts ~60 days. In M1 the worker refreshes it automatically and warns you 7 days before expiry. If yours is short-lived (1–2 h), the probe still works tonight and we'll exchange it for a long-lived one.
