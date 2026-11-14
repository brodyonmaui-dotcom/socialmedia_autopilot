# F11 pure logic (reset-checked / record-published)

Files: `apps/web/lib/batches/transitions.ts:108-227` (planTransition; reset-checked :187-202, record-published :204-225, resetBlocker :90-105), `apps/web/lib/batches/reset.ts:13-73` (AUTO_CHECKS, RESET_CHECKLIST :22-37, validatePostUrl :53-70, POST_ID_RE :73)

## What it does
- `planTransition` is pure: it returns `ItemChange` plans; the caller writes them (transitions.ts:108, :11-14).
- `reset-checked` plans failed/unknown → draft with attempts=1, last_error and next_attempt_at cleared (transitions.ts:194-200).
- `record-published` plans failed/unknown → published with the validated URL and optional post id (transitions.ts:215-223).
- `ItemChange.patch` has no idempotency_key field (transitions.ts:25-34; comment :21-24).

## SQL (verbatim)
none (no SQL in these files)

## Branches that write or send
- none in these files: both branches only return plans (transitions.ts:194, :217).
- pg-store refuses both kinds before any write: `pg-store.ts:90` throws inside `apply()` after `begin` (:85); rollback at :120.

## Attack surface (from the brief)
Any path that changes idempotency_key; reset from a status other than failed/unknown; IG reset without an auto-check; URL lookalikes. Also note how `apps/web/lib/batches/pg-store.ts` currently refuses these two kinds.
- idempotency_key change: not in these files. Repo-wide grep (apps, packages, non-test): no UPDATE writes it. pg-store `apply()` only sets caption/title/scheduled_for (pg-store.ts:100-102), and refuses both kinds at :90.
- reset from other status: reset.ts guard transitions.ts:91 (OUTBOX_DONE at :83); record-published guard :207.
- IG reset without auto-check: transitions.ts:99-100 refuses `n/a` for instagram; autoCheck is accepted from the action argument (:12, :190) and checked only against AUTO_CHECKS (:98, reset.ts:13). planTransition does not run the lookup.
- URL lookalikes: exact host match `POST_URL_HOSTS.includes(hostname)` at reset.ts:66, no suffix matching; hosts list at reset.ts:40-44 includes `studio.youtube.com`, `youtu.be`, `vm.tiktok.com`. Path check only rejects "" and "/" (reset.ts:67); any other path passes. https, no credentials, no port: reset.ts:63-65. Hash dropped: :68.
- record-published id: trimmed, POST_ID_RE at transitions.ts:210-211; different existing id refused :212-214.
- reset-checked ticks: checked against RESET_CHECKLIST at transitions.ts:95-97; the full list is required at :97.

## Findings
_(red-team pass fills this)_
