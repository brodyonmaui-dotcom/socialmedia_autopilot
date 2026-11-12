# Dashboard password (Caddy basic auth on /app*)

Until the M2 passkey login lands, Caddy asks for a username + password before anything under `/app` (every dashboard page and its assets). `/`, `/healthz`, `/privacy`, `/terms` and `/snap-test` stay public.

- Config: `infra/Caddyfile` (`basic_auth` inside `handle /app*`), with values from `.env`: `DASH_USER` and `DASH_HASH` (a bcrypt hash, never the password itself).
- **You pick the password.** Nobody else (and no agent) generates or sees it. Use a long one from your password manager.
- **Fails closed:** if `DASH_USER`/`DASH_HASH` are missing, Caddy still starts and `/app*` rejects every login. (Checked locally with Caddy 2.10: set → 401 without creds, pass-through with the right ones; unset → 401 for everything.)

## First-time setup / change the password  **[changes state]**
1. On the server, after the PR with the gate is merged:
   ```sh
   ssh autopilot
   cd /opt/autopilot && git pull
   ```
2. Make the hash. It **prompts** for the password twice, so the password never lands in shell history:
   ```sh
   cd infra && docker compose exec caddy caddy hash-password
   ```
   It prints one line starting with `$2a$`. That's the hash.
3. Edit `/opt/autopilot/.env` (`infra/.env` is a symlink to it, and it's the file Compose interpolates `${DASH_HASH}` from) and add (or replace) the two lines. **Escape every `$` in the hash as `$$`.** A bcrypt hash has three `$` signs (`$2a$14$…`). Unescaped, Docker Compose reads `$2a`, `$14` and so on as variables, swaps in empty strings and corrupts the hash without any warning. `$$` is Compose's escape for one literal `$`.
   ```
   DASH_USER=pick-a-username
   DASH_HASH=$$2a$$14$$…rest of the line from step 2…
   ```
   - No quotes around it. Inside single quotes Compose takes the value literally, so `$$` would stay doubled and the hash would never match. (Single-quoting the original, unescaped hash also works on Compose v2, but use one method only. This runbook uses `$$`.)
   - Quick check without showing the hash: `docker compose exec caddy sh -c 'case "$DASH_HASH" in "\$2a\$"*) echo prefix-ok;; *) echo BAD;; esac; echo ${#DASH_HASH}'` should print `prefix-ok` and `60`.
4. Recreate caddy so it picks up the new env and the new Caddyfile (a plain `restart` keeps the old env and, after a git pull, the old Caddyfile inode):
   ```sh
   docker compose up -d caddy
   ```
5. Check from the laptop (prints status codes only): `DOMAIN=<your domain> sh scripts/check-exposure.sh`
   - Expect `/`, `/healthz`, `/privacy`, `/terms` → `200`, and `/app`, `/app/library`, … → `401`.
   - Open `/app` on the phone: the browser asks for the username/password once, then remembers it.

## Forgot it
Repeat steps 2–4 with a new password. The old one stops working as soon as caddy is recreated.

## Notes
- Basic auth sends credentials on every request, which is fine over HTTPS only (Caddy forces HTTPS for the domain).
- This is a stopgap. The M2 single-user passkey (or password + 2FA) login replaces it (CLAUDE.md non-negotiable 4).
