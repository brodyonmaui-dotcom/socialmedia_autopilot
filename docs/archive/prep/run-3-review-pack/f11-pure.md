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
Red-team tests: `apps/web/lib/batches/__tests__/f11-redteam.test.ts` (25), on top of `reset.test.ts`. No defect in the pure layer needed a code fix. Note: the "pg-store refuses both kinds" lines above are stale since F11 T2 (19ac4ba); see row 10.

| # | Finding | Status | Test |
|---|---|---|---|
| 1 | Any path that changes idempotency_key | not-an-issue (`ItemChange.patch` has no key field; the plan JSON never mentions it; pg-store SET lists never name it) | f11-redteam.test.ts › reset never touches the idempotency key and never leaves attempts at 0; store-static.test.ts › F11: idempotency_key is never in any update … set clause |
| 2 | approve / approve-all / reject / unapprove / edit / fill-times sweeping a failed or unknown row | not-an-issue (each refuses handedOff rows; approve-all and fill-times only take drafts) | f11-redteam.test.ts › no batch-level or per-item non-F11 action moves a failed/unknown row |
| 3 | Reset from a status other than failed/unknown | not-an-issue (OUTBOX_DONE guard; the SQL also has `status in ('failed','unknown')`) | reset.test.ts › refused for every other status, with the status in the reason |
| 4 | IG reset with autoCheck undefined / null / "found" / case or whitespace variant / junk | not-an-issue (`AUTO_CHECKS.includes` is exact; IG refuses "n/a"; the action computes autoCheck server-side and never reads the form) | f11-redteam.test.ts › IG: undefined, null, 'found', 'NOT-FOUND' and junk auto-checks are refused |
| 5 | Checklist: duplicates, extras, reordered, whitespace/Unicode variants, non-array, non-string entries | not-an-issue (exact-string set match. A duplicate can't stand in for a missing box; reordering is fine; detail.checked stores the canonical list) | f11-redteam.test.ts › checklist: duplicates are harmless… ; › the stored detail.checked is the canonical list |
| 6 | URL lookalikes: suffix host, `@` userinfo, credentials, `http:`, `javascript:`/`data:`, trailing dot, punycode/IDN, non-default port, bare host, protocol-relative, IPv6, >2048 chars, cross-platform host | not-an-issue (WHATWG parse + exact host list + https/no-creds/no-port/path rules) | f11-redteam.test.ts › instagram refuses … (16 cases) |
| 7 | Uppercase host, `:443`, backslash `\@`, youtu.be vs m.youtube.com | not-an-issue (normalised to a lowercase host with the default port dropped; the backslash stays on instagram.com; both YT hosts are listed for youtube only) | f11-redteam.test.ts › accepted forms normalise safely |
| 8 | Any path beyond "/" is accepted (e.g. `https://www.instagram.com/accounts/login`), so it's evidence only, not proof of a post | accepted (Fable: the URL is evidence for the audit trail only; a per-platform path pattern would not stop a wrong "record it" and risks refusing a valid URL shape; hosts stay exact) | f11-redteam.test.ts › accepted forms normalise safely |
| 9 | POST_ID_RE injection (quotes, spaces, slashes, newline incl. a trailing `\n`, %-encoding, non-ASCII, length) | not-an-issue (anchored; JS `$` doesn't match before a trailing newline; values are SQL parameters anyway). A non-string id is ignored, not thrown | f11-redteam.test.ts › refuses injection-shaped ids… ; › non-string url / id inputs are refused, not thrown |
| 10 | record-published / reset for snapchat | not-an-issue (validatePostUrl is always null for snapchat; isResettablePlatform excludes it) | f11-redteam.test.ts › snapchat: no URL is ever valid and record-published is refused; reset.test.ts › snapchat is refused |
| 11 | IG checklist box 3 says "the app checked the last 25 posts" even when autoCheck = "error" (lookup failed or no creds), so the creator ticks a statement that's false in that case | fixed in T3 (Fable: box 3 reworded to cover both outcomes and the auto-check result shown as a chip under the list) | reset.test.ts › unknown items reset too; IG accepts an 'error' auto check |
| 12 | F11 T2 SQL in pg-store.ts (Fable to review header) | approved (Fable 2026-11-14: reset clears approved_at so the row leaves listDue; batch stays approved while any item is live; attempts=1 keeps findExisting before the resend; key untouched; worker never touches failed/unknown rows so no race; alert acked in the same tx; 61 tests green) | reset.db.test.ts; apps/worker/src/__tests__/outbox-reset.db.test.ts |
| 13 | `canReset` is false for snapchat and for rows with a platform_post_id, but "It's there → record it" stays valid for any failed/unknown row | fixed in T3 (Fable: record button on every failed/unknown row except Snapchat, which gets a handoff note; reset button alone gated on canReset) | reset.db.test.ts › loadBatch exposes attempts, last_error, key tail and canReset |
