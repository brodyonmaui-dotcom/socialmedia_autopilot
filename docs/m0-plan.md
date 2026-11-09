# M0 — verify & set up (proposed: starts the day you pick the decisions, ~Nov 10–16)

Rule: every account creation, connection or real post below happens only after your explicit OK at that step.

## You (phone/laptop, ~2–3 h total, guided by `docs/setup/*.md`)
1. Cloudflare account, plus a domain (~$10/yr) **[ask-before: purchase]**. Create the R2 bucket.
2. Order the VPS (Decision 1) **[ask-before: purchase]**.
3. Meta: developer account, app (Facebook Login for Business), FB Page linked to IG, app set to **Live** (needs a privacy-policy URL, which I'll host). Also create **a test IG professional account**.
4. Google Cloud: project, YouTube Data + Analytics APIs, OAuth consent screen set to "In production" (unverified). Create **a test YouTube channel** (brand account).
5. Zernio free account plus **a test TikTok account**.
6. Anthropic Console: API key with a **$5/mo hard limit**.

## Me (scripts print one-line summaries; logs go to `logs/`)
1. Setup guides `docs/setup/{cloudflare,vps,meta,google,zernio,snapchat,anthropic}.md`, written for a beginner.
2. Repo skeleton only: pnpm monorepo (`apps/web`, `apps/worker`, `packages/core`, `packages/adapters`, `tools/ingest-agent`). Also `CLAUDE.md` (<120 lines), `.env.example`, a gitignore for secrets, CI running lint and tests.
3. VPS: Docker Compose with Caddy HTTPS and Postgres. Nightly `pg_dump` to R2, plus **one restore test**.
4. Probe scripts in `scripts/probes/`, dry-run by default, real calls only with `--live` plus your OK:
   - `ig`: token check, trial reel (MANUAL) on the **test** account to check eligibility, insights after 24–48 h (are trial metrics returned?), one Business Discovery call, and comment webhook vs polling.
   - `yt`: private Short with `publishAt` on the **test** channel, plus thumbnail set and insights read.
   - `tiktok`: Zernio public post on the **test** account, verified logged-out, then an account-type check.
   - `snap`: a PWA test page with a "Share to Snapchat" button. On your iPhone, check whether Spotlight is offered, the full length gets through, the caption is kept, and location is off.
   - `ingest`: confirm the iCloud for Windows Photos folder path and that originals download (not placeholders).
5. Draft `docs/voice.md` from your description, and offer calibration on 10–20 past captions.
6. Update `docs/research.md` with every M0 result.

## Exit criteria
- Each platform probe is green, or has a written fallback.
- Backup and restore proven.
- Budget re-totaled.
- A demo checklist for your phone.

## Proposed milestone dates (confirm, including your semester start and holiday availability)
| M | Dates (2026–27) | Content |
|---|---|---|
| M0 | Nov 10–16 | verify & set up |
| M1 | Nov 17–30 | library/ingest/dedupe/touch-ups, batch + approval, scheduler/outbox, IG + YT live (Thanksgiving week is lighter) |
| M2 | Dec 1–7 | TikTok + Snapchat adapters, PWA + push, calendar |
| M3 | Dec 8–14 | inbox, auto-replies (shadow mode first), DM triage |
| M4 | Dec 15–21 | analytics + weekly report, trial recommendations (needs ≥2 weeks of real posts from M1) |
| M5 | Dec 22–28 | research branch, creators, ideas, scripts |
| M6 | Dec 29 – Jan 10 | hardening; full real week at 4/day; runbooks; ~1 week buffer before semester |
