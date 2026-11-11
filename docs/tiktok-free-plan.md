# TikTok on Zernio at $0: keeping a consistent schedule

Facts from Zernio's docs (verification log in `docs/research.md`, 2026-11-11). The scheduler that applies these is Fable's (F1); this page is the plan it should follow. Decision on file: **stay 100% free on Zernio** (creator, 2026-11-11).

## What keeps it free
| Rule | Why |
|---|---|
| **Never connect a 3rd account to Zernio.** TikTok (+ at most one more) only. | Accounts 1–2 are free; the 3rd needs a card and costs **$6/month**. |
| Don't add a card unless you decide to. | Without a card, nothing can start billing by accident (a 3rd connect just fails with `402`). |
| No X account, no phone numbers, no ads, no Support Assistant. | Those meter separately. |
| Comment replies are free; DMs cost only past 10,000/month. | We'll be far below that (and replies stay manual for now). |
| Posts are unlimited. | So the schedule is bounded only by the caps below. |

## The caps the schedule has to respect
- **Zernio:** 15 videos per rolling 24 h per account, and 25 posts/hour. Over the cap → Zernio **holds** the post and publishes it when a slot frees (it doesn't fail).
- **TikTok's own API limit** per account per 24 h: the number isn't published. Over it, the post **fails** ("too many posts in the last 24 hours via the API") and isn't retried.
- **Drafts (Creator Inbox):** at most **5 pending** in any 24 h. A 6th fails until you finish or discard drafts in the TikTok app.

**Plan: 1–2 TikToks a day, never more than 3.** That's far under every cap, avoids TikTok's unpublished API limit, and builds a steady habit for the algorithm. Spacing ≥ 3 h between posts keeps us clear of the hourly cap and of "duplicate content" flags.

## Direct post vs. draft
| Post type | Route | What you do |
|---|---|---|
| Your own audio / voice / no music, or a Commercial Music Library track | **Direct post**, `scheduledFor` + `Idempotency-Key`, public | Nothing: it goes live on schedule (Zernio holds the clock). |
| Needs a trending / non-commercial sound | **Draft** (`tiktokSettings.draft: true`) | Get the inbox notification → open TikTok → add the sound → Post. Keep ≤ 5 pending; clear them daily. |
| Anything you don't want public yet | Draft | Same: Business-app connections can only direct-post **public** videos. |

Notes:
- A draft shows as `published` in Zernio as soon as TikTok accepts the upload. It isn't live until you tap Post, so the dashboard must label it "waiting in TikTok inbox", not "posted".
- Videos: 3 s – 10 min, vertical 9:16; the caption can be up to 2,200 characters (voice.md: keep TikTok short, 3–5 hashtags).
- Don't post the same clip to TikTok twice: "Duplicate content detected" rejects it.
- API moderation is stricter than the app (`spam_risk`). If a clip gets flagged, post that one in the app.

## What stays manual (by choice, $0)
- **TikTok metrics:** check them in the TikTok app. (Zernio's docs say usage-based plans include analytics; if our account is on one, metrics could be automated at no cost. That needs one read-only API check first, which is your call.)
- **Comment replies and DMs:** in the TikTok app for now.
- **Trending sounds:** always finished in the app (draft route).

## If something fails
- "Too many posts in the last 24 hours via the API" → wait for the rolling window or post that one in the app; lower the daily count.
- "TikTok allows only 5 pending drafts" → finish or discard drafts in the TikTok app.
- Upload timeout → treat it as **unknown** and check the profile before retrying (`docs/runbooks/failed-or-unknown-post.md`).
