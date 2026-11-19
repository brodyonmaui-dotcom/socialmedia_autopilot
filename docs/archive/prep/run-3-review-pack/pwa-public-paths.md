# PWA public paths + service worker + push actions

Files: `apps/web/lib/auth/middleware-logic.ts:9-18` (PUBLIC_PREFIXES, isPublicPath, middlewareDecision), `apps/web/middleware.ts:14` (matcher), `apps/web/public/sw.js:1-75`, `apps/web/app/alerts/push-actions.ts:21-44`, `packages/db/src/auth-admin.ts:45-58` (revokeAllAuth; callers apps/web/lib/auth/pg-store.ts:48, apps/worker/src/cli/auth.ts:37)

## What it does
- Middleware passes PUBLIC_PREFIXES (middleware-logic.ts:9, :12); other paths need a cookie shaped like a 43-char token (:6, :17). DB check happens later (:1-2).
- sw.js is push-only: no fetch listener, no caching (sw.js:1-4, :38-55). Push shows count and kind labels; tap navigates to /app/alerts (:6, :57-75).
- Subscribe runs only from the Enable tap: EnablePush.tsx:109 onClick → enable (:60-80) → subscribeAction (:72). The useEffect at EnablePush.tsx:25 does not call it.
- Each push action calls requireSession first (push-actions.ts:22, :30, :40).
- revokeAllAuth revokes sessions, credentials, enroll codes, challenges and push subscriptions (auth-admin.ts:46-52); only error 42P01 is swallowed (:55).

## SQL (verbatim)
```sql
-- packages/db/src/auth-admin.ts:46, 47, 48, 49, 52
update auth_sessions set revoked_at = $1 where revoked_at is null
update auth_credentials set revoked_at = $1 where revoked_at is null
update auth_enroll_codes set used_at = $1 where used_at is null
update auth_challenges set used_at = $1 where used_at is null
update push_subscriptions set revoked_at = $1 where revoked_at is null
```
push-actions.ts itself has no SQL. Its callees write push_subscriptions and settings (subscriptions.ts:57, :66, :80); that SQL is outside the listed files and not copied here.

## Branches that write or send
- auth-admin.ts:46-52 writes (revokeAllAuth); :55 rethrows any other error.
- push-actions.ts:24 saveSubscription (write), :33 revokeSubscription (write), :42 requestTestPush (write), each after requireSession.
- middleware-logic.ts:16 returns "pass" for public paths; :17 returns "redirect" otherwise. middleware.ts:6 redirects to /app/login.
- sw.js:47 showNotification (send); :65 w.navigate, :72 openWindow.

## Attack surface (from the brief)
> prefix match also opens `/sw.js*` paths (tighten to exact match); the SW caches nothing private; subscription only from a tap; revokeAllAuth revokes push subs.
- /sw.js* match: middleware-logic.ts:12 passes `/sw.js` and `/sw.js/...` only, not `/sw.jsX`. Matcher middleware.ts:14 lookahead `sw\.js` has no boundary, so `/sw.jsX` is excluded from middleware entirely.
- SW caches nothing: no fetch or cache listener in sw.js (only install, activate, push, notificationclick at :30, :34, :38, :57).
- Subscription from tap only: EnablePush.tsx:109 and :72; no other subscribeAction caller found.
- revokeAllAuth revokes push subs: auth-admin.ts:50-53.

## Findings
| # | Finding | Status | Test |
|---|---|---|---|
| 1 | isPublicPath prefix-matched files: `/sw.js/x`, `/manifest.json/x`, `/favicon.ico/x` public | fixed (test middleware.test.ts › public files are exact and public dirs are bounded) | PUBLIC_FILES exact; dirs need "/" or end |
| 2 | Matcher lookahead had no boundary: `/sw.js.map`, `/sw.jsx`, `/loginx`, `/iconsx`, `/manifest.json.bak` skipped middleware entirely (wider than the pack said) | fixed (test middleware.test.ts › matcher runs middleware on the lookalikes) | also checked with Next 15's getMiddlewareMatchers + basePath /app |
| 3 | SW caches anything private | not-an-issue (no fetch handler, no Cache API; only install/activate/push/notificationclick) | sw.test.ts › has no fetch handler (no caching of private pages) |
| 4 | Subscription only from a user tap | not-an-issue (register + subscribe only inside enable(), the Enable onClick; useEffect only reads getSubscription) | - (EnablePush.tsx:60-80, :109 read) |
| 5 | revokeAllAuth revokes push subscriptions | not-an-issue (auth-admin.ts:52; only 42P01 swallowed) | auth-admin.test.ts › revokeAllAuth updates sessions, credentials, codes, challenges and never deletes |
| 6 | manifest/icons public paths | not-an-issue (manifest exact; /icons bounded by "/"; icons are static PNGs) | middleware.test.ts › public files are exact… |
