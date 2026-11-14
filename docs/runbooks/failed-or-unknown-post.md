# A post shows `failed` or `unknown`

Statuses (`packages/core/src/types.ts`): `draft → approved → queued → publishing → published`, plus `failed`, `unknown` and `rejected` (migration 0006).

- **`failed`**: the platform refused it on every attempt (outbox: **4 attempts**; `last_error` holds the sanitised reason).
- **`unknown`**: a timeout or network error **after** sending. The post may exist. The worker never retries an `unknown` on its own and never downgrades it to `failed` (non-negotiable 3).

Both show on the batch page (phone) as a card with the status, attempts, the sanitised last error and the key ending (`key …abc123`). No SQL by hand: use the two buttons on the card.

## 1. Look on the platform first
- **Instagram:** the sheet runs an automatic, read-only check of the last 25 posts (caption + time). If it finds the post, it switches to "record it" with the link filled in. If the check failed, search your recent posts by hand. Also check the Reels tab and Trial reels.
- **YouTube:** YouTube Studio → Content, **including Private and Scheduled** (uploads go private + `publishAt`), and upload drafts/processing. There's no idempotency key on YouTube, so a crash between upload and status update can leave a private video (see `packages/adapters/src/youtube.ts`).
- **TikTok (Zernio):** the TikTok profile (and Drafts/Inbox if it went as a draft), plus Zernio → Posts, matching the key ending on the card. A retry within 24 h with the same `Idempotency-Key` returns the original post instead of a new one.
- **Snapchat** is assisted: it has no buttons here; use the handoff page (`/handoff`).

## 2. Then press one button
- **It's there → record it:** paste the post link (https, on the platform's own domain; post id optional). The item becomes `published`. Available on every failed/unknown item except Snapchat.
- **Not on the platform → back to draft:** only when the item has no platform post id. Tick every checklist box (Confirm stays disabled until then; the server checks again, and for Instagram it re-runs the automatic check and refuses on a hit). The item returns as a **draft with the same idempotency key**, `attempts = 1` (so the engine checks for an existing post before the next send). The reset never approves: fix the time (a "Past time" chip shows if it has passed) and caption, then approve it again.

Both buttons write a `batch_item_events` row (`reset-checked` / `record-published`) and acknowledge the matching alert.

## Causes of `failed` seen or documented so far
- IG trial refused: `code 10 / subcode 2207081`. Handled by the automatic fallback to a plain reel + flag, so on its own it shouldn't end in `failed`.
- YouTube `quota exceeded`: wait for the daily quota reset.
- Zernio caps: 15 videos/24 h per account. Beyond the cap, posts are held, not failed.
- YouTube Short over 60 s with licensed music: it gets blocked. Trim to ≤ 60 s.
- Token problems: see [token-renewal.md](token-renewal.md).

**The first real post per platform, and any change to auto-reply behavior, still need the creator's explicit OK** (non-negotiable 2).
