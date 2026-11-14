# Handoff Mark posted / Skip / Drop (F10)
Files: apps/web/lib/handoff/store.ts:90-240, apps/web/app/handoff/actions.ts:1-44

## What it does
- markPosted (store.ts:156) moves one approved Snapchat item to published, stores a cleaned Spotlight URL if given, and logs snap-posted.
- skipToNextDay (store.ts:180) moves a due item to the next free creator-local day in one transaction: advisory xact lock, then `for update` on held Snapchat rows.
- dropItem (store.ts:211) sets an approved item to rejected, clears its approval, and returns the batch to draft when nothing in it is still approved.
- Every item write is `update batch_items ... where WRITABLE` (store.ts:152-153); 0 rows throws RELOAD.
- actions.ts wraps each store call in requireSession, then revalidates /handoff and /.

## SQL (verbatim)
```sql
-- store.ts:152-153 (WRITABLE, interpolated into the three item updates)
id = $1 and platform = 'snapchat' and status = 'approved' and approved_at is not null
  and exists (select 1 from batches b where b.id = batch_items.batch_id and b.status = 'approved')
-- store.ts:147 (insertEvent, called at :163, :201, :220)
insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
-- store.ts:161 (markPosted)
update batch_items set status = 'published', updated_at = $2, platform_post_url = $3 where ${WRITABLE} returning id
-- store.ts:173 (HOLDS_DAY)
('approved', 'queued', 'publishing', 'published', 'unknown')
-- store.ts:185 (skip lock)
select pg_advisory_xact_lock(hashtext($1))
-- store.ts:187-189 (skip read, for update)
select id, status, scheduled_for from batch_items
  where platform = 'snapchat' and status in ${HOLDS_DAY} and scheduled_for is not null
  order by id for update
-- store.ts:199 (skip update)
update batch_items set scheduled_for = $2, updated_at = $3 where ${WRITABLE} returning id
-- store.ts:216 (drop item)
update batch_items set status = 'rejected', approved_at = null, approved_session = null, updated_at = $2 where ${WRITABLE} returning batch_id
-- store.ts:222-224 (drop: batch back to draft)
update batches set status = 'draft', approved_at = null, updated_at = $2
  where id = $1 and status = 'approved'
    and not exists (select 1 from batch_items bi where bi.batch_id = $1 and bi.status not in ('draft', 'rejected'))
```

## Branches that write or send
- store.ts:82 n/a here; store.ts:157 / :181 / :212 bad UUID → return "unknown item", no query.
- store.ts:158 cleanSpotlightUrl(url) runs before the tx; null → link stored as null.
- store.ts:162 markPosted: rowCount != 1 → Refuse(RELOAD), tx rolled back; else :161 UPDATE + :163 INSERT event.
- store.ts:192 skip: no self row with status approved (incl. non-Snapchat id) → RELOAD; :194 source bucket "future" → "not due yet".
- store.ts:197 skip: no target from skipTarget (./logic.js, outside pack) → "no free day in the next 14 days".
- store.ts:200 skip: rowCount != 1 → RELOAD; else :199 UPDATE + :201 INSERT event; returns target local day (:202).
- store.ts:219 drop: rowCount != 1 → RELOAD; else :216 UPDATE, :220 INSERT event, :221-226 batch UPDATE (only if none left approved).
- store.ts:114-127 inTx: commit on success, rollback on any throw.
- actions.ts:16 any thrown DB error → fixed "something went wrong" to client; :19-20 revalidate paths.
- actions.ts:26 url kept only if typeof string; :33 timeZone missing → "TZ_CREATOR not set" returned, no write.

## Attack surface (from the brief)
Attack: a Snapchat item published twice; two items on one local day after concurrent skips; skip into the past; a non-Snapchat or unapproved row touched; URL validation (cleanSpotlightUrl).
- Published twice: WRITABLE status='approved' store.ts:152-153, enforced at :161-162; second call gets 0 rows.
- Two items one day after concurrent skips: advisory lock store.ts:185; `for update` store.ts:189; taken-day set store.ts:195; "no free day" store.ts:197.
- Skip into the past: not found in store.ts:180-205 (no check that target is >= today); the target comes from skipTarget (store.ts:196, ./logic.js, outside this pack, not read).
- Non-Snapchat or unapproved row: SQL filter store.ts:188 `platform = 'snapchat'`; self must be approved store.ts:191; WRITABLE store.ts:152-153 on :161, :199, :216.
- URL validation: store.ts:99-112 (empty→null :101, parse :104-107, https + no credentials :108, snapchat.com/subdomain host :109-110, returns normalized URL :111); called from store.ts:158.

## Findings
| # | Finding | Status | Test |
|---|---|---|---|
| 1 | Published twice (sequential or concurrent markPosted) | not-an-issue (WRITABLE status='approved' + row lock; 2nd call gets 0 rows, RELOAD) | store.db.test.ts › two concurrent markPosted calls publish once, with one event |
| 2 | Two items on one local day after concurrent skips | not-an-issue (advisory xact lock + `for update`; read-committed re-reads after the lock) | store.db.test.ts › two concurrent skips never land on the same day; › a skip waits for an in-flight skip |
| 3 | Skip into the past | not-an-issue (skipTarget rolls from max(today, own day), next day strictly after: always tomorrow or later) | store.db.test.ts › skip moves a missed item to the next free day after today |
| 4 | Non-Snapchat / unapproved / draft-batch row touched | not-an-issue (WRITABLE on all 3 updates; self must be approved) | store.db.test.ts › markPosted is conditional…; store-static.test.ts › every batch_items update goes through the guard |
| 5 | cleanSpotlightUrl lookalikes (`.evil.example`, `http:`, userinfo `snapchat.com@evil`, backslash, trailing dot, `javascript:`) | not-an-issue (WHATWG parse, https only, no userinfo, exact/subdomain host) | store-static.test.ts › cleanSpotlightUrl drops %s |
| 6 | markPosted / drop accept a not-yet-due item | not-an-issue (session-only, nothing goes public, still single-shot; UI lists due items only) | - |
