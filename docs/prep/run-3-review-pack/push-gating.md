# Push gating + dedupe (F8 T3)
Files: apps/worker/src/jobs/alert-push-core.ts:1-203 (header line 1 "Fable to review: push gating + dedupe"), apps/worker/src/jobs/alert-push-store.ts:1-62, apps/worker/src/jobs/alert-push.ts:1-67

## What it does
- Gate per alert: kind in effective list, pushed_at and acknowledged_at null, created_at within 24 h (core:83-87, 99, 102-110).
- Every minute (alert-push.ts:21, 51-66): test request first, then claim up to 50 alerts, then one bundled payload per active subscription (core:166-203).
- Claim is one conditional UPDATE that sets pushed_at before any send (store:17-31; core:181).
- Send errors are counted, never un-claimed. 404/410 revoke by timestamp, never delete (core:127-131, 143-156; store:45-47).
- Payload is count, kinds, sources, url only. Logs are counts only (core:113-121, 184-185, 201).

## SQL (verbatim)
```sql
-- store:20-27 claimUnpushed
update alerts set pushed_at = $3
        where id in (select id from alerts
                      where pushed_at is null and acknowledged_at is null and created_at >= $2 and kind = any($1::text[])
                      order by created_at, id
                      limit $4
                      for update skip locked)
          and pushed_at is null
        returning id, kind, platform
-- store:35-36 activeSubscriptions
select id, endpoint, p256dh, auth, session_id, label, created_at, last_success_at, revoked_at
         from push_subscriptions where revoked_at is null order by created_at, id
-- store:42 markSuccess
update push_subscriptions set last_success_at = $2 where id = $1
-- store:46 revoke
update push_subscriptions set revoked_at = $2 where id = $1 and revoked_at is null
-- store:52-57 claimTestRequest
update settings set value = value || jsonb_build_object('handled_at', $2::text), updated_at = now()
        where key = $1
          and value ? 'requested_at'
          and (value->>'requested_at')::timestamptz > $3::timestamptz
          and (not (value ? 'handled_at') or (value->>'handled_at')::timestamptz < (value->>'requested_at')::timestamptz)
        returning key
```

## Branches that write or send
- core:173-176 not enabled: log VAPID line, return. No send, no write.
- core:177 and core:178-180 no kinds, or no active subscription: return before claim. No write.
- core:181 claimUnpushed: DB write (store:20-27). Runs when enabled, kinds non-empty, at least one active sub.
- core:139 revoked subscription: skipped, no send.
- core:142 sender.send: network push per non-revoked sub, body = payload JSON.
- core:147-149 status 2xx: markSuccess DB write (store:41-43).
- core:150-152 status 404 or 410: revoke DB write (store:45-47).
- core:143-145 send throws, core:153 other status: counted failed, no write.
- core:154-156 markSuccess or revoke throws: counted failed.
- core:197-198 test: enabled and claimTestRequest true: DB write (store:50-60). core:199-200 sends test payload to all active subs.
- alert-push.ts:36 webpush.sendNotification: network call. :39 WebPushError returns its status. :40 other error rethrown as "push send failed".
- alert-push.ts:52-55 VAPID not set: job not registered, no send.
- Returns to a client: none in these files (no HTTP handler).

## Attack surface (from the brief)
Attack: double push across concurrent ticks (claim-before-send); push of old rows after deploy (0008 backfill + age cutoff); non-push kinds leaking (metrics-health); endpoint/key in logs; a send error un-claiming; 404/410 handling; dry-run behaviour.
- Double push across concurrent ticks: claim is one UPDATE with `for update skip locked` and a `pushed_at is null` re-check (store:25-26); claim precedes send (core:181, 183). No singleton or concurrency option on the boss.work call (alert-push.ts:59-65): not found.
- Old rows after deploy: age cutoff at core:99, core:109, core:181 and store:22 (`created_at >= $2`). 0008 backfill: not in this hunk (see migration-0008).
- Non-push kinds leaking (metrics-health): PUSH_KINDS_DEFAULT imported at core:17, defined outside this hunk. Kind gate at core:108 and store:22. effectivePushKinds (core:83-87) keeps any ALERT_KINDS member the setting lists.
- Endpoint/key in logs: logs are counts only (core:184-185, 201). Endpoint reaches only the sender (core:142). Library error text dropped (alert-push.ts:24-25, 40). No endpoint or key log line found.
- Send error un-claiming: not found. No statement clears pushed_at (store:20-27 only sets it). Send-error path is core:143-145, 153.
- 404/410 handling: classifyPushStatus core:127-131; revoke core:150-152; store:46 sets revoked_at only; revoked subs skipped at core:139 and core:178.
- Dry-run behaviour: not found (no DRY_RUN reference in the three files). Job runs whenever VAPID is set (alert-push.ts:52, 59-65). Comment at core:14 says it runs in dry-run.

## Findings
_(red-team pass fills this)_
