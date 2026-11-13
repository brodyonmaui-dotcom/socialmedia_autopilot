# A post shows `failed` or `unknown`

Statuses (`packages/core/src/types.ts`): `draft → approved → queued → publishing → published`, plus `failed`, `unknown` and `rejected` (migration 0006).

Since F2 ([login.md](login.md#how-approval-works)), the app approves only `draft` items and treats `failed`/`unknown` as already handed to the platform: they can't be approved, edited or rejected from the phone. "Re-approve" below has no app button yet; ask in chat before changing such a row by hand.

- **`failed`**: the platform rejected it on every attempt (outbox default: 3 attempts, `last_error` holds the reason). It's safe to fix and re-approve.
- **`unknown`**: a timeout or network error **after** sending. The post may exist. The worker never retries an `unknown` on its own and never downgrades it to `failed` (non-negotiable 3).

## `unknown`: find out whether it went out, before anything else
1. Read `last_error` for the item (read-only SQL: `select platform, status, attempts, last_error, platform_post_id from batch_items where id = '…'`).
2. Check the platform on the profile:
   - **Instagram:** the newest posts on the profile. (Containers expire in 24 h, and an unpublished container never shows.)
   - **YouTube:** YouTube Studio → Content, including **private/scheduled** videos (uploads go private + `publishAt`).
   - **TikTok (Zernio):** open the TikTok profile directly. Zernio's `posts` list doesn't return `platformPostUrl` right after posting (M1 day 1), so its API isn't proof either way. A retry within 24 h with the same `Idempotency-Key` returns the original post instead of a new one.
3. **It exists** → record it as `published` with its id/URL. Don't re-post.
4. **It doesn't exist** → re-approve it, and it goes through the outbox again. For TikTok, the idempotency key makes a same-day retry safe. For **YouTube there's no idempotency key**: check Studio first, because a crash between upload and status update could otherwise upload twice (known gap, noted in `apps/worker/src/jobs/outbox.ts`).

## `failed`
1. Read `last_error`. Causes seen or documented so far:
   - IG trial refused: `code 10 / subcode 2207081`. Already handled by the automatic fallback to a plain reel + flag, so on its own it shouldn't end in `failed`.
   - YouTube `quota exceeded`: wait for the daily quota reset.
   - Zernio caps: 15 videos/24 h per account. Beyond the cap, posts are held, not failed.
   - YouTube Short over 60 s with licensed music: it gets blocked. Trim to ≤ 60 s.
2. Fix the cause (caption, file, cap, token: see [token-renewal.md](token-renewal.md)), then re-approve on the phone.
3. **The first real post per platform, and any change to auto-reply behavior, still need the creator's explicit OK** (non-negotiable 2).
