# M0 tonight — runbook (~2.5 h)

Work top to bottom. Each step ends with a one-line result to paste back to me. **Never paste keys, tokens or passwords into chat.** Secrets go only into `/opt/autopilot/.env` on the server (or `.env` on your laptop).

`[OK?]` = I ask first, because it costs money, connects an account or posts publicly.

| # | Step | Time | You paste back |
|---|---|---|---|
| 0 | Share context: [setup/context-handoff.md](setup/context-handoff.md) | 5 m | "handoff ready" |
| 1 | Domain + R2: [setup/cloudflare.md](setup/cloudflare.md) `[OK? ~$10/yr]` | 15 m | domain name |
| 2 | Server: [setup/vps.md](setup/vps.md) `[OK? ~€6/mo]` | 25 m | `bootstrap ok …` line |
| 3 | HTTPS up: DNS record, `docker compose up -d` | 10 m | output of `curl https://<domain>/healthz` |
| 4 | Snapchat test on iPhone: open `https://<domain>/snap-test` | 10 m | answers to the 5 checklist questions |
| 5 | Instagram read-only probe: [setup/meta.md](setup/meta.md) | 10 m | the `PASS/FAIL ig.*` lines |
| 6 | YouTube: [setup/google.md](setup/google.md), OAuth on the laptop, then a read-only probe | 25 m | the `yt.*` lines |
| 7 | TikTok via Zernio: [setup/zernio.md](setup/zernio.md) `[OK? connect account]` | 15 m | the `tiktok.*` lines + "still Personal: yes/no" |
| 8 | AI triage smoke test: [setup/anthropic.md](setup/anthropic.md) | 5 m | the `ai.*` lines |
| 9 | Backup + restore drill: `docker compose exec backup sh /backup.sh` then `./infra/restore-test.sh` | 10 m | `backup ok …` / `restore ok …` |
| 10 | First real posts (only if time is left, otherwise tomorrow) `[OK? each]` | 20 m | URLs |

## Step 10 detail: first real posts (one per platform, each needs your OK)
- **YouTube:** a real Short uploaded private with `--publish-at` set ~1 h ahead. Confirms that YouTube's own scheduler publishes it.
- **TikTok:** one real video through Zernio. Then open the URL in a private window to confirm it's public.
- **Instagram:** you're under 200 followers, so trials will likely be refused. Running the trial probe on one real reel tests the "not eligible → post as a regular reel + flag" path. If Instagram *accepts* the trial, it goes to non-followers only, which is harmless.

## If we run out of time
Steps 6–10 move to tomorrow (Nov 10) before M1 starts. Steps 0–5 are the ones that unblock building.
