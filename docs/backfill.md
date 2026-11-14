# Catching YouTube and TikTok up to Instagram

Instagram is ahead of YouTube Shorts and TikTok. One example is the "what it takes to pass a 10K prop firm" series: about day 13–14 on IG, and day 8–9 or earlier on the other two. This page sets how fast we can post on each platform without hitting limits. The `cross-post-backfill` skill (`pnpm skill:backfill`) finds the gap and drafts the catch-up batch.

Facts checked 2026-11-15. Sources are inline; older ones are in `docs/research.md`.

## The ceilings
| Platform | Hard limit | Source | What breaks first |
|---|---|---|---|
| **YouTube** | API: `videos.insert` has its own bucket of **100 uploads/day** (1 unit each). Channel: a **per-channel 24 h upload limit** that YouTube doesn't publish. It applies to desktop, mobile and API uploads together, and it's higher for verified channels. | research.md (June 2026 quota change); [YouTube Help: common uploading errors](https://support.google.com/youtube/answer/10383400?hl=en) | The unpublished channel limit, so **verify the channel by phone** (YouTube Studio → Settings → Channel → Feature eligibility). |
| **TikTok** | TikTok Direct Post: "typically around **15 posts per day** per creator account", **shared across every API tool** on the account, rolling 24 h. Over it you get `spam_risk_too_many_posts` and the post fails. Zernio: 15 videos per 24 h, 25 posts/hour (over that, posts are held, not failed). Drafts: **5 pending per 24 h**. | [TikTok Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines); research.md 2026-11-11 | TikTok's own ~15, which "varies among creators". API moderation (`spam_risk`) is also stricter than the app. |
| **Instagram** | 100 API posts per 24 h (our account reads 0/100). | research.md 2026-11-12 | Nothing at our volume. |

## Recommended pace (catch-up mode)
"Regular" means the weekly plan (`docs/content/week-2026-11-16/plan.md`). "Backfill" means IG reels that were never cross-posted.

| Platform | Regular / day | Backfill / day | **Total cap / day** | Spacing |
|---|---|---|---|---|
| Instagram | 3 + recap + workout log | — | **6** | ≥ 2 h between yaps |
| YouTube Shorts | 3 + recap + workout log | **5** | **10** | ≥ 45 min |
| TikTok | 2 + recap | **4** | **7** (≤ 3 inbox drafts) | ≥ 90 min |
| Snapchat | 1 (assisted) | — | **1** | — |

Why these numbers:
- **YouTube 10/day** is a tenth of the API bucket. It's still well inside a verified channel's limit, and every upload is a Short you've already approved on IG. If YouTube says the upload limit is reached, stop for that day rather than retrying, and let the queue roll forward. The worker doesn't special-case this error yet: check what it does before the first catch-up week.
- **TikTok 7/day** stays about half of TikTok's ~15 and Zernio's 15. That leaves room for the TikTok number being lower for a small account, and for anything you post from the app (it counts against the same limit). **Ramp up:** total 4/day for the first 3 days. Raise to 7 only if no `spam_risk` or "too many posts" error has appeared. A single one of those drops the pace back to 4 for a week.
- **≤ 3 TikTok drafts a day** keeps pending drafts under 5. Clear them every day by adding the sound from your saved sounds in the TikTok app and tapping Post. Uncleared drafts block new ones; waiting doesn't help.
- Spacing keeps posts from collapsing into one burst, which looks like spam and makes each Short compete with your last one.

**How long:** the diff report prints "days to clear" per platform. At +5/day, a 60-reel YouTube gap takes 12 days. At +4/day, an 80-reel TikTok gap takes 20 days.

**Series rule:** on a platform that's behind, the series posts strictly in order (day 9 before day 10). **New episodes wait** on that platform until the backfill reaches them. The report's "Series gaps" section shows where each one stands. To close a series gap faster, give the series 2 of the day's backfill slots until it's level.

## Settings this needs (your call; nothing is changed until you set them)
- **Daily caps:** Instagram **6**, YouTube **10**, TikTok **7**, Snapchat **1**. The current defaults are 4/4/4/1. Another session is adding a labelled 5/day/platform setting; it needs to allow up to **10** for YouTube.
- Posting windows: the current ones (about 8 h a day) fit 10 YouTube posts at ≥ 45 min apart. No change needed.
- After the backlog clears, drop the caps back to the regular pace (IG 6, YT 5, TikTok 3). The weekly report then shows whether the extra volume held per-post views.

## Audio (your decision, 2026-11-15)
- **Original audio everywhere; no royalty-free library tracks.**
- **TikTok:** clips that need a trending sound go out as **inbox drafts**. You add the sound from your saved sounds in the TikTok app, then post. The backfill marks these automatically: when IG returns no `media_url` for a reel, the IG version used licensed music.
- **YouTube:** the API can't attach a Shorts sound, so YouTube gets the master with its **original audio**. That's also the safest route for Content ID. As far as I know, a trending Shorts sound can only be added in the YouTube app at creation (not re-checked this run). Hand-post one in the app only if a clip really doesn't work without its song.
- **Instagram:** the API can't attach IG audio either. A post that needs a trending IG sound is posted from the Instagram app, not the scheduler.
- **Saved sounds:** keep a running list in each app's saved/favorites folder. The drafts flow uses TikTok's; YouTube and IG only matter for posts you make in the app.

## Quality floor (volume first)
- The backfill only reposts reels already published on IG, so the quality bar is "would you still post it today". The skill's quality pass drops dated or IG-only-context clips. Series episodes always stay.
- Captions are re-tailored per platform from your IG caption (voice.md): YouTube title ≤ 60 characters, 3 hashtags on YouTube, ≤ 5 on TikTok, "Not financial advice." on trading.
- Use the original masters from your library, never re-downloads from IG. Re-downloads are re-encoded, and reels with licensed audio have no download at all.

## How this relates to `scripts/schedule-catchup.mjs`
That earlier one-off guessed the backlog from library folder names (`Full Logs`, `Short Reels`) and a hardcoded "already posted" list. The skill replaces the guess with what's actually on each platform. If a batch from the old script exists, the snapshot's outbox check counts its rows as already scheduled, so nothing gets doubled.
