# Alerts page + phone notifications (F8)

`/app/alerts` lists what needs you: Open (default) and Acknowledged (last 30 days), filtered by kind chips. "Acknowledge" stamps the time and your session; nothing is ever deleted. The home page shows a red badge with the open count.

The worker job `alert-push` runs every minute. It pushes each new urgent alert to your phone **once**, bundled into one notification. It runs in dry-run too: it's a private notification to you, not a public action.

- **Pushed by default:** `engagement-kill`, `unknown-outcome`, `final-failure`, `token-health`, `auth`. Everything else (`cap-breach`, `duplicate`, `engagement-failure`, `engagement-unknown`, `engagement-mode`, `metrics-health`, `config`) is page-only.
- **A `config` alert** (page-only, "Configuration") means the worker is misconfigured: today, `PUBLIC_MEDIA_BASE` is unset or not an absolute https URL. The outbox skips every tick (nothing is marked failed) until it is fixed in `.env` and the worker restarted; then acknowledge it. One open alert at most.
- **What a notification says:** "N new alerts" plus the kind names (e.g. "Failed · Login"). Never the alert text, captions, comments, ids or links: push travels through Apple's servers. A tap opens `/app/alerts`.
- **Once only:** each alert is marked `pushed_at` *before* sending. If a send fails, it isn't retried (no double pages); the alert is still on the page.
- **Only fresh alerts:** anything older than 24 h is never pushed. Migration 0008 marks every existing alert as already pushed, so turning this on doesn't flood the phone.
- **A daily token-health alert** pushes once a day while the problem lasts. That's intended: a reminder until it's fixed.

## Before you start
- Migration `0008_alerts_push.sql` applied ([migrations.md](migrations.md)).
- iPhone on **iOS 16.4 or later** (Web Push works only for web apps added to the Home Screen; see the verification log in `docs/research.md`).

## 1. Generate the VAPID keys (once) **[changes state: writes `.env`]**
The keys identify this server to Apple's push service. They're yours: they live only in the server's `.env`.

```sh
ssh autopilot
cd /opt/autopilot && git pull
cd infra && docker compose build worker
docker compose run --rm --no-deps worker node_modules/.bin/web-push generate-vapid-keys
```
It prints a **Public Key** and a **Private Key**. Don't paste them into chat or a ticket.

If the worker image won't build, this does the same with the same pinned version, straight from npm:
```sh
docker run --rm node:22-alpine npx -y web-push@3.6.7 generate-vapid-keys
```

Open `/opt/autopilot/.env` and fill in the three names (they're already listed, empty, in `.env.example`):
```
VAPID_PUBLIC_KEY=<the Public Key>
VAPID_PRIVATE_KEY=<the Private Key>
VAPID_SUBJECT=mailto:<an address you read>
```
`VAPID_SUBJECT` is a contact address that push services can use if this server misbehaves. Use any mailbox you read. It goes only in `.env`, never in the repo.

## 2. Restart with the keys **[changes state]**
```sh
cd /opt/autopilot/infra && docker compose up -d --build
docker compose logs worker --since 5m | grep -E 'alert-push|worker started'
```
Without the three VAPID names, the worker logs `alert-push: VAPID not set` once and skips push; everything else works. With them, that line is gone.

## 3. Turn it on for the iPhone
1. In Safari, open `https://<your domain>/app`, log in, then **Share → Add to Home Screen**.
2. Open the app **from the Home Screen icon** (push doesn't work in a Safari tab).
3. Go to **Alerts** (the home badge), scroll to **Notifications**, tap **Enable notifications**, then **Allow**.
4. Tap **Send test notification**. "Test notification" should arrive within a minute (the worker picks up the request on its next tick).

If the button says to add the app to the Home Screen, you're in a Safari tab: do step 1–2. If it says notifications are blocked: Settings → Notifications → autopilot → Allow.

If **Enable** fails right after the basic-auth prompt, the service worker script may be blocked by basic auth (F8 OQ5). Tell the agent: the fallback is a Caddyfile change that serves `/app/sw.js` without basic auth. Ask first; after a Caddyfile change, `docker compose restart caddy`.

## Change which kinds push
Set the optional setting `alert_push` (re-read every minute, no restart). For example, to also push `engagement-unknown`, on the server **[changes state]**:
```sh
cd /opt/autopilot/infra && docker compose exec -T db psql -U autopilot -c \
  "insert into settings (key, value) values ('alert_push', '{\"kinds\": [\"engagement-kill\",\"unknown-outcome\",\"final-failure\",\"token-health\",\"auth\",\"engagement-unknown\"]}') on conflict (key) do update set value = excluded.value"
```
`{"kinds": []}` pushes nothing. Unknown kind names are ignored.

## Lost phone
`Log out everywhere` on the home page, or on the server `docker compose run --rm worker pnpm auth:revoke-all` **[changes state]**. Both sign out every device, revoke every passkey **and revoke every push subscription**, so the lost phone stops getting notifications. Re-enrol ([login.md](login.md)), then tap Enable again on the new phone.

## Turn push off
- For one device: **Turn off** under Notifications on `/app/alerts`.
- For everything: empty the three `VAPID_*` values in `.env`, then `docker compose up -d` **[changes state]**.

## Logs
Counts only, never an endpoint, key or alert text: `[alert-push] claimed 2 · sent 1 · revoked 0 · failed 0`. A failed send logs `[alert-push] failed n=…`. A `revoked` count means Apple reported a subscription as gone (HTTP 404/410); it's marked revoked, never deleted.
