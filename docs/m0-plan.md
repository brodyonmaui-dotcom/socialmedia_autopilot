# M0 — verify & set up (tonight, Nov 9; see `m0-tonight.md` for the step-by-step)

Rule: every account creation, connection or real post below happens only after your explicit OK at that step.

## You (phone/laptop, ~2–3 h total, guided by `docs/setup/*.md`)
1. Cloudflare account, plus a domain (~$10/yr) **[ask-before: purchase]**. Create the R2 bucket.
2. Order the VPS (Decision 1) **[ask-before: purchase]**.
3. Meta: developer account, app (Facebook Login for Business), FB Page linked to IG, app set to **Live** (needs a privacy-policy URL, which I'll host). (Already done: app, Page and token exist; we only check them.)
4. Google Cloud: project, YouTube Data + Analytics APIs, OAuth consent screen set to "In production" (unverified).
5. Zernio free account; connect the real (Personal) TikTok.
6. Anthropic Console: API key with a **$5/mo hard limit**.

## Me (scripts print one-line summaries; logs go to `logs/`)
1. Setup guides `docs/setup/{cloudflare,vps,meta,google,zernio,snapchat,anthropic}.md`, written for a beginner.
2. Repo skeleton only: pnpm monorepo (`apps/web`, `apps/worker`, `packages/core`, `packages/adapters`, `tools/ingest-agent`). Also `CLAUDE.md` (<120 lines), `.env.example`, a gitignore for secrets, CI running lint and tests.
3. VPS: Docker Compose with Caddy HTTPS and Postgres. Nightly `pg_dump` to R2, plus **one restore test**.
4. Probe scripts in `scripts/probes/`, dry-run by default, real calls only with `--live` plus your OK:
   - `ig`: token check, trial reel (MANUAL) on the real account (expected: refused under ~200 followers → tests the fallback), insights after 24–48 h (are trial metrics returned?), one Business Discovery call, and comment webhook vs polling.
   - `yt`: private Short with `publishAt` on the real channel, plus thumbnail set and insights read.
   - `tiktok`: Zernio first public post on the real account (with your OK), verified logged-out, then an account-type check.
   - `snap`: a PWA test page with a "Share to Snapchat" button. On your iPhone, check whether Spotlight is offered, the full length gets through, the caption is kept, and location is off.
   - `ingest`: confirm the iCloud for Windows Photos folder path and that originals download (not placeholders).
5. Draft `docs/voice.md` from your description, and offer calibration on 10–20 past captions.
6. Update `docs/research.md` with every M0 result.

## Exit criteria
- Each platform probe is green, or has a written fallback.
- Backup and restore proven.
- Budget re-totaled.
- A demo checklist for your phone.

## Milestone dates (confirmed: semester starts Jan 8; off Nov 26, Dec 24–25)
| M | Dates (2026–27) | Content |
|---|---|---|
| M0 | **Nov 9 evening** (+ Nov 10 spillover) | verify & set up — runbook: `docs/m0-tonight.md` |
| M1 | Nov 10–21 | library/ingest/dedupe/touch-ups, batch + approval, scheduler/outbox, IG + YT posting for real by Nov 21 |
| M2 | Nov 22–29 (off Thu 26) | TikTok (Zernio) + Snapchat (assisted) adapters, PWA + push, calendar |
| M3 | Nov 30 – Dec 6 | inbox, auto-replies (shadow mode first), DM triage |
| M4 | Dec 7–13 | analytics + weekly report, trial recommendations |
| M5 | Dec 14–20 | research branch, creators, ideas, hooks/scripts |
| M6 | Dec 21 – Jan 4 (off Dec 24–25) | hardening; full real week at 4/day Dec 27 – Jan 2; runbooks |
| Buffer | Jan 5–7 | slack before the semester |
