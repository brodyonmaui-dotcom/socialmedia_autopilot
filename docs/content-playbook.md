# Content playbook

The rules every script, caption, batch and weekly review follows. Distilled from saved reels (2026-11). Creator view counts in those reels are unverified marketing, so only the **processes** are kept. `docs/voice.md` wins on tone; `CLAUDE.md` wins on everything.

Brand: **@dalongprocess**, a transparent day-trading journey + lifting. Discipline over emotion, process > results, no guru posturing, **no financial advice** (never tell viewers to buy or sell, never promise returns).

## 1. The yap reel (adapted from @jettfranzen)
Format:
- One static talking-head shot, plain background, dark top. No music, no cuts, no B-roll.
- Burned-in word-for-word captions. **No written post caption beyond the hook line.**
- One idea, 45–90 s spoken (120–200 words). Calm, certain, a peer. Never hype, never selling.

Skeleton:
1. **Hook.** Line 1 is a complete, quotable, slightly counterintuitive claim stated as fact. No greeting, no setup.
2. **Mechanism / reframe.** Exactly **one** anchor: a named law or effect, a verified quote with its author, a real stat, or one analogy.
3. **One** analogy or contrast pair. Never two metaphors, never a tips list.
4. **2–3 elaboration beats**, often phrased as negatives ("It's not… It's not…").
5. **Close.** An aphorism, or an either/or question to the viewer. No CTA.

Hook rules: one sentence, a claim not a question, specific nouns, debatable (not a platitude).

Hook formulas:
| Formula | Shape | Example |
|---|---|---|
| Superlative | "The highest/hardest/most X is Y." | "The highest form of peace is having no desire to be seen, validated, or understood by anyone." |
| Negation swap | "The hardest X aren't A." (then the real B) | "The hardest relationships aren't age gaps." |
| Conditional warning | "If you don't X, you will end up Y." | "If you don't spend enough time getting to know yourself, you will end up absorbing everyone else's definition of you." |
| Named law + stat contrast | Law name → the number that makes it land | Janet's Law: at 5 a year is 20% of your life, at 50 it's 2%. |
| Quiet-signal reframe | "The real sign of X is the quiet Y." | "The real sign you're improving is that it gets boring." |
| Paradox | Two true things that seem to clash | "The game gets more fun the less it matters." |

**Anchor rule:** every named law, quote and stat is verified against a real source before it's used (the script file records the URL and status). Unverifiable → drop or swap it. Never invent an attribution. Prefer the replicated version of a finding and say "one study" when it's one study.

## 2. Script structures for edited reels
- **Hook → Lead → Body 1 → Open Loop → Body 2 → Open Loop → Body 3 → CTA** (@realskytan, https://www.instagram.com/reel/DambEp1igDW/). For our voice the "CTA" is a soft question or nothing (voice.md: CTAs rare and soft).
- **Hook (emotion) → Super Hook (credibility) → Open Loop** (@kierzacporter, https://www.instagram.com/reel/DdB54MDoQWM/). Trade-recap version: "Welp, I was the liquidity today 🥀" → "I took this trade live" → "the second move is what mattered".

## 3. Footage is the asset, the hook is the experiment
- Re-post the same video with only a new hook (on-screen line 1 + caption line 1) or a new song. Keep a **clip bank** and re-hook instead of reshooting (@zac_spencer, https://www.instagram.com/reel/DcmKoU1hVF3/).
- Our rules: change **one** variable per re-post (hook *or* song), wait ≥ 7 days, never re-post to TikTok (its "duplicate content" check rejects it; TikTok gets the variant only if the edit is genuinely different). Log the variant so the weekly report compares old vs new.

## 4. Trial Reels "Manage Versions" (later)
- Up to **5 versions** of one reel (different hooks or instrumentals), one per day; the winner graduates (@damianappice, https://www.instagram.com/reel/Dco8DB2oRRt/).
- Status: our API trials are refused (subcode 2207081, a permission-level refusal at ~137 followers; research.md 2026-11-12). Use this only once the daily re-probe passes; until then, run the same test as regular-reel re-hooks (§3) spaced a week apart.

## 5. The listicle method (mix it in, don't build on it)
- Describe a *person*, with progressive intrigue: surface trait → detailed trait. Each item is one sentence trait + one sentence why (@nicktarmo, https://www.instagram.com/reel/DdAFS1PRxQO/).
- Example: "Traits of someone who's quietly getting better at trading. They log the losing days in more detail than the winners…"
- It reaches but doesn't build brand: at most 1 in 7 posts.

## 6. Retention diagnosis rubric (weekly review)
From @cookin.code (https://www.instagram.com/reel/DfsPYGvCQ3N/). Our analytics has `reels_skip_rate` and `ig_reels_avg_watch_time` (IG), plus views/reach.

| Diagnosis | Signal | Fix |
|---|---|---|
| **BAD HOOK** | Most viewers leave in the first 3 s; high `reels_skip_rate` | Cut the intro, lead with the payoff; re-hook the same footage (§3) |
| **MID DROP-OFF** | Avg watch time well under length, the retention graph falls at one spot | Add a re-hook / open loop at that timestamp |
| **HELD BACK** | Reach far below the account's normal for the pillar (originality flag) | Post original edits, not re-uploads or watermarked copies |

**Verify the fix:** compare retention of the old vs the new version (same footage, one change). Under 3 posts per group = "too early to tell".

## 7. Considered, not adopting
| Idea | Why not |
|---|---|
| Apify scraping; any automation that drives the Instagram/Edits app to post | Violates the official-access-only rule (CLAUDE.md #1) |
| Zernio MCP posting from chats | Posting must go through the app's approval (CLAUDE.md #2) |
| Higgsfield and other paid generation tools | Budget (~$20/mo total) |
| yt-dlp music libraries | Copyright risk (muting, Content ID, strikes) |
| Astryx | We already have our own design system (`docs/design/`) |
| Sellbird / GoHighLevel | Not relevant to a single-creator tool |
| Personal-harness and course lists | Background only |
| Floorplan (codebase map) | Optional, for the creator's own understanding; listed in `docs/payloads/all-chats-ai-practices.md` |
