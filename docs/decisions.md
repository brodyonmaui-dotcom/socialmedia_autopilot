# Decisions — status: **APPROVED 2026-11-09** (all recommended options)

Approval notes:
- Test on the **real** accounts (all small); no test accounts needed. The first real post per platform still needs an explicit OK.
- TikTok is a **Personal** account and must stay Personal (viral sounds). Zernio docs say the Business-API lane accepts Personal accounts (DMs need Business; posting/comments don't). Verify at connect time; if it forces a switch → fallback (Upload-Post, or assisted TikTok via share sheet).
- Domain (~$10/yr, Cloudflare) and VPS (~€6/mo) purchases **pre-approved** by the user on 2026-11-09.
- Creator time zone is set in `.env` only (`TZ_CREATOR`), never committed: the repo is **public** as of 2026-11-09, so no location-revealing values (time zone, domain, IPs) go in git.
- IG: ~<200 followers, so trials are likely ineligible for now. Ship with trial auto-detect: try trial → if refused, post as a regular reel + flag; re-probe eligibility daily.
- Existing Meta app + FB Page + token come from the user's separate socials project.

Costs are monthly USD, checked 2026-11-09 (see the verification log in `research.md`). Nothing gets bought or connected until you pick.

## 1. Hosting — rec: small VPS + R2
| Option | Cost | Notes |
|---|---|---|
| **A. VPS (rec)**: OVHcloud VPS-1 (US) or Hetzner CX23 (EU), Docker Compose (Caddy HTTPS, Next.js, worker, Postgres) | ~$5.50–7 | Always-on, public HTTPS for webhooks, pg-boss works. Backups: nightly `pg_dump` to R2 (free) plus the provider's daily backup (OVH includes one). Pick whichever is orderable at checkout. EU location is fine: nothing here is latency-sensitive. |
| B. Managed: Vercel Hobby + Neon free Postgres + Cloudflare cron pinger | ~$0 | More moving parts. Serverless timeouts break IG container polling into steps, pg-boss can't run, and Vercel Hobby is non-commercial only. |
| B2. Railway Hobby | $5 + usage, ~$10–20 | Too close to the cap. |
| Also needed | domain ~$1/mo (~$10–12/yr) | Required for R2 public URLs, TikTok domain verification and webhooks. R2 is $0 in year 1. |

## 2. TikTok — rec: Zernio (free) direct post, inbox drafts for sound-dependent posts
- **Zernio**: TikTok is 1 of 2 free accounts, so **$0**. Business-API lane: public-only direct posts, 15/day cap, comments/DMs via API, Creator Inbox drafts.
- Prove it with a **test TikTok account** first: the post must be public when viewed logged-out. Then check whether connecting changed the account to Business, which limits sounds to the Commercial Music Library. If it did, that's a stop-and-decide moment.
- Fallback 1: Upload-Post Basic, $16/mo billed yearly ($192 upfront) or $24 monthly. That breaks the budget unless paid annually.
- Fallback 2: native posting with dashboard reminders.
- A self-built inbox flow is **not** viable: TikTok's app review rejects personal-use apps, and the sandbox can't post publicly.

## 3. Snapchat — rec: assisted, 1 Spotlight/day
- No in-budget middleman works. Zernio's docs say Snapchat is blocked pending Snap approval, and Ayrshare/bundle.social cost $100+.
- Route: the dashboard prepares the file and caption, then the iOS share sheet sends it to Snapchat (Web Share API). Creative Kit's Spotlight support is iOS-native-SDK only, so a PWA can't use it.
- **Plainly: 4 manual Snapchat taps a day won't last into the semester.** Recommended cadence: **1 Spotlight a day** (5–7 a week). It's the previous 48 h's best performer on IG/TikTok, so it's proven content, sent with one push reminder at a time you pick. On skipped days nothing piles up; the queue just rolls forward.
- Location: the handoff checklist always says to keep Snap Map / location off.
- If Zernio or Snap opens access later, the adapter moves from `assisted` to `middleman` without UI changes.

## 4. AI split — rec: Haiku 5.5 always-on, everything else as Claude Code skills on your plan
- **Server (Claude API, Claude Haiku 5.5, $0.10/$0.50 per M tokens):** comment classification and reply drafting, plus DM triage and drafts. At 100 comments+DMs a day with a ~2K-token prompt that's ≈ $0.80/mo, worst case $2. Set a **$5 hard spend limit** in the Anthropic Console.
  - A refusal or low confidence counts as "flag," never "reply."
- **Claude Code skills (your plan, $0 extra):** `weekly-batch` (captions, titles, schedule), `research-brief`, `weekly-report`, `platform-check`. These run when you open a session, with scripts doing the heavy lifting.

## 5. Trial reels — rec: MANUAL default, SS_PERFORMANCE as a per-post opt-in
- **MANUAL** keeps your loop: the report recommends, you approve, then you tap "share" in the IG app from the dashboard checklist. Default to it for the first ~4 weeks, so the report can learn what a "good trial" looks like for your account.
- **SS_PERFORMANCE** is better for evergreen or low-stakes posts, A/B hook variants, and weeks when you'll be busy (exams). It removes the in-app tap, and every post is already batch-approved, so there's no safety cost. The cost is that Instagram's graduation threshold is opaque and you lose the learning signal from deciding yourself.
- Plan **3 trials + 1 regular reel a day**, so followers' feeds still get fed while the account is young. If the account isn't trial-eligible, posts fall back to regular reels and get flagged.

## 6. (New) Instagram login — rec: Facebook Login for Business (one app)
- Creator tracking needs **Business Discovery, which is Facebook Login only**.
- **Option A (rec):** Facebook Login with a FB Page linked to your IG account. One app covers publishing, trials, comments, DMs, insights and Business Discovery. Setup is ~10 extra minutes to create a Page; the Page can stay empty.
- **Option B:** Instagram Login for everything except discovery, plus a second Meta app with Facebook Login just for Business Discovery. That's two apps, two token sets and twice the upkeep.
- **Option C:** Instagram Login only, with creators tracked by manual paste. Simplest, but drops automated creator tracking.

## Total (recommended picks)
VPS ~$6.5 + domain ~$1 + R2 $0 + Zernio $0 + Haiku ~$1–2 = **≈ $9–10/mo**, leaving ~$10 of headroom (for example, for Upload-Post if Zernio fails, paid annually).
