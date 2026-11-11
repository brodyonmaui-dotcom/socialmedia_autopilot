# Social media autopilot — working notes for Claude

Single-creator tool: phone-first dashboard + always-on worker that posts approved weekly batches to Instagram, YouTube Shorts, TikTok and Snapchat, handles routine engagement, and reports what works. Not a SaaS. Deadline: done before **Jan 8, 2027**.

## Read first
- `docs/decisions.md`: approved decisions (hosting, routes, AI split, trials, IG login)
- `docs/research.md`: platform facts + the **verification log** at the end (newest truth)
- `docs/m0-plan.md`: milestones and dates. `docs/voice.md`: caption/reply voice (once written)

## Non-negotiables (never trade these for features)
1. Official APIs/SDKs or a reputable middleman (Zernio) only. No passwords stored, no private APIs, no browser bots or headless logins. If it can't be done officially, it becomes an assisted (tap-to-post) step.
2. Nothing public without approval: only posts in an approved batch publish. The first real post per platform, and any change to auto-reply behavior, need the user's explicit OK in chat. Default is dry-run (`DRY_RUN=true`); real actions need `DRY_RUN=false` **and** `--live`.
3. No double posts: outbox + idempotency key per post; before any retry, check whether the post already exists; bounded backoff; alert on final failure; treat a timeout as "unknown", not "failed".
4. Secrets: env vars / encrypted-at-rest tokens only; never in git, logs, chat or tool output. Minimum scopes. Single-user login with passkey or password+2FA.
5. Location boundary: strip GPS/EXIF/QuickTime location metadata; never set location fields (IG `location_id`, YT `recordingDetails`, TikTok location tags); captions and research never name identifiable places or real-time whereabouts.
6. Ask before: buying, paid plans, connecting accounts, real publishing, deleting anything, or budget-affecting settings. Budget ≈ $20/mo total.
7. Verify platform facts against official docs at build time; update `docs/research.md` when something changed.

## Platform routes (see decisions.md)
| Platform | Mode | Notes |
|---|---|---|
| Instagram | direct (Graph API, Facebook Login) | server fires each post: create container → poll → publish; containers expire in 24 h, so never pre-create; ≤5 hashtags; comments polled, webhooks only if proven |
| YouTube | direct (Data API v3) | upload private + `status.publishAt`; YouTube holds the clock |
| TikTok | middleman (Zernio) | Business-API lane, public-only direct posts, `scheduledFor` + `Idempotency-Key`; sound-dependent posts go as `draft: true` (inbox) |
| Snapchat | assisted | Web Share API → iOS share sheet → Snapchat; 1 Spotlight/day |

## Repo layout
- `apps/web`: Next.js App Router + Tailwind PWA (M1)
- `apps/worker`: Node + pg-boss jobs (M1)
- `packages/core`: shared types, capability matrix, adapters
- `scripts/probes/`: M0 platform probes (`pnpm probe:ig|yt|tiktok|ai`)
- `infra/`: docker compose, Caddyfile, bootstrap/backup/restore scripts
- `.claude/skills/`: weekly-batch, research-brief, weekly-report, platform-check

## Working rules (credit efficiency)
- Scripts do the heavy lifting and print one-line summaries; details go to `logs/` (gitignored). Read a log only when a summary says FAIL.
- Never read video frames or large media into context unless a specific question needs it.
- Keep this file under 120 lines; put workflow detail in skills.
- One fresh session per milestone. End each milestone with: demo checklist (phone clicks), what changed, what's next, deadline risks; run tests + `simulate-week` dry run first.

## Environment notes
- **The repo is PUBLIC.** Never commit secrets or location-revealing values (the creator's time zone, domain, server IP, places). Those live in `.env` only.
- Server: `ssh autopilot` (an alias in the user's `~/.ssh/config`; the IP is never committed). Local laptop sessions can SSH; cloud sessions can't, so there the user runs server commands. Deploy = `git pull` on the VPS in `/opt/autopilot` (tracks `main`), then `docker compose up -d --build` in `infra/`. If `Caddyfile` changed, also `docker compose restart caddy` — `up -d` alone won't reload it (it's a bind-mounted file, not an image layer, and git's replace-via-rename leaves a long-running container's mount pointing at the old inode).
- Ask before running anything on the server that changes state (restart, migrate, post).
- developers.facebook.com / docs.zernio.com don't resolve for WebFetch here, but `curl https://docs.zernio.com/<page>.mdx` and `llms.txt` work.

## Guardrails
- `.claude/settings.json` + `.claude/hooks/guard.mjs` block destructive git, secret reads, broad deletes; `AUTOPILOT_OVERNIGHT=1` adds the overnight rules. Unattended runs follow `docs/overnight.md`. Humans change guardrail files, not agents.

## Commands
- `pnpm install` · `pnpm typecheck` · `pnpm test`
- On the VPS: `./infra/probe.sh <ig|yt|tiktok|ai> [flags]`, `cd infra && docker compose up -d`
