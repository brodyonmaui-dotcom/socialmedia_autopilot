# Handoff media proxy
Files: apps/web/lib/handoff/media.ts:1-45, apps/web/app/handoff/media/[itemId]/route.ts:1-15

## What it does
- route.ts GET (:10-15) runs requireSession, reads itemId, takes timeZone from handoffContext, and calls proxyMedia with PUBLIC_MEDIA_BASE from env.
- proxyMedia (media.ts:21-45) returns 503 if the media base or timeZone is missing, then gates the item through loadShareable (store.ts:81); a miss is 404.
- On a hit it fetches `${mediaBase}/${r2Key}` with no-store and streams the upstream body back as video/mp4.
- All plain responses and the streamed response are `private, no-store`; upstream bodies and URLs are never returned or logged.

## SQL (verbatim)
None in these two files. The gate SQL is in loadShareable (store.ts:84-91, outside this hunk, shown for reference), with LISTED at store.ts:40:
```sql
-- store.ts:84-91 (loadShareable)
select bi.scheduled_for, m.r2_key
  from batch_items bi
  join batches b on b.id = bi.batch_id
  join media m on m.id = bi.media_id
 where bi.id = $1 and ${LISTED} and bi.scheduled_for < $2 and m.r2_key is not null
-- store.ts:40 (LISTED)
bi.platform = 'snapchat' and bi.status = 'approved' and bi.approved_at is not null and b.status = 'approved' and bi.scheduled_for is not null
```

## Branches that write or send
- route.ts:11 requireSession before anything else.
- media.ts:22 mediaBase unset → 503 "media not configured"; no DB, no fetch.
- media.ts:23 timeZone null → 503 "TZ_CREATOR not set".
- media.ts:25 loadShareable null (bad UUID, not listed, not due, no r2_key, future bucket) → 404 "not found".
- media.ts:30 network GET to `${mediaBase}/${item.r2Key}` (fetchImpl ?? fetch, cache no-store), only after a hit.
- media.ts:31-34 fetch throws → console.error fixed text, 502 "upstream error".
- media.ts:35-38 upstream !ok or no body → log status number, cancel body, 502 "upstream error".
- media.ts:41-43 headers: video/mp4, nosniff, Content-Length copied from upstream when digits only.
- media.ts:44 returns the upstream body stream to the client with 200 (the video bytes).

## Attack surface (from the brief)
Attack: leaking PUBLIC_MEDIA_BASE / r2 key / upstream bodies; serving a non-due/non-approved item; path traversal in r2_key (it comes from the DB, but check); caching headers.
- Leaking base / key / upstream bodies: error bodies are fixed strings (media.ts:22, :23, :25, :33, :38); logs omit base and key (media.ts:32, :36); success streams upstream body by design (media.ts:44); route.ts:14 reads PUBLIC_MEDIA_BASE and does not echo it.
- Non-due / non-approved served: UUID check store.ts:82; LISTED store.ts:40; due bound store.ts:90 `scheduled_for < $2`; future-bucket check store.ts:94; call at media.ts:24.
- Path traversal in r2_key: only a non-empty string check at store.ts:93; concatenated unchanged at media.ts:30. Not found: any check for `..`, `/`, encoding or allowed characters.
- Caching headers: NO_STORE media.ts:17; plain() media.ts:18-19 sets it; success sets private, no-store media.ts:41; route.ts:8 `dynamic = "force-dynamic"`.

## Findings
| # | Finding | Status | Test |
|---|---|---|---|
| 1 | r2_key with `../`, `%2e%2e`, `..\\`, `?`/`#` escaped the base path once fetch normalised `${base}/${key}` | fixed (test media.test.ts › refuses an r2_key that would leave the base path) | media.ts underBase(): same origin, under base path + "/", no query/fragment, else fixed 404, no fetch |
| 2 | `//host` or absolute-URL r2_key | not-an-issue (joined after base + "/", host can't change; asserted in the same test) | media.test.ts › refuses an r2_key… |
| 3 | Worker outbox.ts:94 builds mediaUrl the same unchecked way | fixed (test outbox.test.ts › an r2_key that escapes PUBLIC_MEDIA_BASE fails permanently with a sanitized error; never published) | mediaUrlGuard: permanent failure + final-failure alert, adapter never called, dry run refuses |
| 4 | Leaking PUBLIC_MEDIA_BASE / key / upstream body in responses or logs | not-an-issue (fixed strings; logs carry status number only) | media.test.ts › maps upstream errors… without echoing |
| 5 | Serving non-due / non-approved / non-Snapchat / bad-UUID item | not-an-issue (LISTED + due bound + future-bucket check + UUID gate) | store.db.test.ts › loadShareable: only the due item…; media.test.ts › 404s… |
| 6 | Caching headers | not-an-issue (`private, no-store` on every response, force-dynamic, fetch no-store) | media.test.ts › streams a due item's clean file… |
