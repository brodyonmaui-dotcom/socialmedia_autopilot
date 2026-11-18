# M0 report — verify & set up (done 2026-11-10)

## Status
| Item | Result |
|---|---|
| Domain + R2 (media + backups, 30-day lifecycle) | ✅ |
| VPS (Hetzner CX23, Ubuntu 24.04, Docker, ufw, key-only SSH) | ✅ |
| HTTPS (Caddy) + homepage / privacy / terms / snap-test pages | ✅ |
| Nightly Postgres backup to R2 + restore drill | ✅ |
| Snapchat share-sheet handoff (1-min video, caption, Spotlight offered) | ✅ (open Snapchat once if the sheet is blank) |
| Instagram: Page token (no expiry), 8 scopes, quota 100/24 h, comments poll, reel insights, Business Discovery | ✅ 7/7 |
| YouTube: OAuth app in production (unverified, no logo), refresh token, channel read | ✅ |
| TikTok via Zernio: connected, account **still Personal**, dryRun canPublish | ✅ 3/3 |
| AI triage (Haiku 5.5): 6/6 buckets correct, $5 cap | ✅ |
| First real post per platform | ⏭ moved to M1 day 1 (needs your OK and a real video on R2) |
| `docs/voice.md` draft | ⏭ M1 day 1 |

## Demo checklist (phone)
- Open `https://<app domain>/` → the homepage loads over HTTPS.
- Open `/snap-test` → pick a video → Share → Snapchat → full video + Spotlight offered.

## Dates to remember
- Meta data-access window ends **2027-02-08** → re-run `./infra/probe.sh connect-meta` before then (the worker will alert 7 days ahead).

## Risks to the Jan 8 deadline
- Low. Every platform route is proven. The main remaining unknowns are product build time and trial-reel eligibility (expected once you're near 200 followers; the fallback is built in).

## Next: M1 (Nov 10–21)
Library + Windows ingest agent + dedupe, ffmpeg touch-ups, batch builder + approval UI, scheduler/outbox, real Instagram + YouTube posting. Day 1: `voice.md`, first real IG/YT/TikTok post (with your OK), app skeleton.
