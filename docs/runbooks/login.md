# Login (passkey) + how approval works (F2)

Two layers guard `/app`:
1. **Caddy basic auth** (unchanged): the browser's username/password prompt. See [dashboard-password.md](dashboard-password.md).
2. **Passkey app session**: after the prompt, `/app/login` asks for the phone's passkey (Face ID).

- Session cookie `ap_session`: HttpOnly, Secure, SameSite=Strict, Path=/app. 30-day sliding expiry, 90-day hard cap. Only a hash of the token is stored.
- At most 5 passkeys. 10 failed login/enrol attempts in 15 min → further attempts are refused and an `auth` alert row is written.
- Env: `DOMAIN` (already in `.env`) is the WebAuthn RP id and origin. Locally, `WEB_ORIGIN` (default `http://localhost:3100`).
- Needs migration 0006 ([migrations.md](migrations.md)). Without it, the CLI says "auth tables missing".

## Add a device  **[changes state]**
1. On the VPS (the code shows up only in that terminal):
   ```sh
   ssh autopilot
   cd /opt/autopilot/infra && docker compose run --rm worker pnpm auth:enroll
   ```
   It prints a one-time code (`XXXX-XXXX`, valid 15 min, single use).
   Locally: `pnpm auth:enroll` from the repo root with `DATABASE_URL` set.
2. On the phone, open `https://<your domain>/app/login` → **Add this device** → type the code.
3. Accept the phone's passkey prompt (Face ID). You're in.
4. Next time: `/app/login` → sign in with the passkey. No code needed.

Never paste the code into chat. If it leaks or expires, mint a new one (step 1).

## Lost phone / recovery  **[changes state]**
1. Revoke every session and every passkey (nothing is deleted, rows are marked revoked):
   ```sh
   cd /opt/autopilot/infra && docker compose run --rm worker pnpm auth:revoke-all
   ```
   Expect `Revoked N session(s) and M passkey(s)`.
2. Enrol the new phone with **Add a device** above.
3. Consider changing the basic-auth password too ([dashboard-password.md](dashboard-password.md)).

From a signed-in phone, **Log out everywhere** in the app does the same (sessions + passkeys).

## How approval works
The worker fires an item only when **all** hold: the item is `approved`, its `approved_at` is set, **and** its batch is `approved`.

- **Approve blocks on:** a `{{…}}` placeholder; a missing or past time; a lint error (including location words, see `PRIVACY_BLOCKLIST` in `.env`); a daily cap breach; no clean file.
- **Warnings (approve allowed):** duplicate caption, QA warning, TikTok draft (goes to the inbox), longer than 60 s on YouTube.
- Editing an approved item sends it back to `draft`; approve it again.
- Reject is a status (`rejected`). Nothing is deleted.
- Items already handed to the platform (`publishing`, `published`, `unknown`, `failed`, or with a platform post id) can't be rejected, unapproved or edited.
- Every change writes a `batch_item_events` row (kind, from → to, session, time).
- CLI fallback still works: `pnpm exec tsx scripts/schedule-catchup.mjs --approve <batchId>` **[changes state]** approves the batch and its `draft` items, stamps `approved_at` and writes an `approve-cli` event per item.
- `DRY_RUN=true` stays the default: approval alone doesn't publish anything real.
