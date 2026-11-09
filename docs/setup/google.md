# YouTube via Google Cloud (~25 min, free)

1. console.cloud.google.com → project picker → **New project** `autopilot`.
2. **APIs & Services → Library:** enable **YouTube Data API v3** and **YouTube Analytics API**.
3. **Google Auth Platform → Branding / Audience** (older UIs call it "OAuth consent screen"):
   - User type **External**. App name `autopilot`, your email as support + developer contact.
   - Data access / Scopes: add `youtube.upload`, `youtube.force-ssl`, `yt-analytics.readonly`.
   - **Audience → Publish app → In production.** Skip verification: you'll see an "unverified app" warning once when you sign in. This avoids the 7-day token expiry of Testing mode.
4. **Clients → Create client → Desktop app** named `autopilot-local`. Download nothing; open it and copy the Client ID + Client secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, on **both** the laptop and the server.
5. **On the laptop** (Node 22 + pnpm), in a clone of the repo:
   ```
   pnpm install
   pnpm probe:yt --auth
   ```
   Open the URL it prints, pick your YouTube channel, then click "Advanced → Go to autopilot (unsafe)". That's just the unverified-app notice, and the app is yours. The refresh token lands in `.secrets/yt.json`. Copy its value into `YT_REFRESH_TOKEN=` in the server's `.env`.
6. Read-only check on the server: `./infra/probe.sh yt`

Paste back: the `yt.*` lines.
