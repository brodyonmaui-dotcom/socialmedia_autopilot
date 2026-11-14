# Run 4 outline (Fable, 2026-11-14) — the lead's priorities for the Sonnet drafter

Deadline Jan 8, 2027 (55 days). M1's "IG + YT posting for real by Nov 21" is the milestone at risk, and
everything that blocks it is a creator task scattered across runbooks. Run 4 therefore turns those into one
script, closes the two remaining engine gaps that a live week would expose, and automates the weekly loop so
the worker is "always-on" in fact, not only in name.

## Items, in order
1. **F13 · Go-live readiness** (model: fable lead, Opus implementers)
   - T1 **Preflight script** `scripts/preflight.mjs` (+ `./infra/preflight.sh` wrapper for the VPS): one PASS/FAIL line
     per check, each FAIL with the exact next command/runbook. Checks: required env names present (never values),
     `PUBLIC_MEDIA_BASE` valid (reuse `isValidMediaBase`), `TZ_CREATOR` set, migrations 0001–0008 applied, a passkey
     enrolled, DRY_RUN / WORKER_LIVE state, VAPID present, backup file newer than 24 h and the restore test marker,
     cadence/caps settings sane, probe verification log in `docs/research.md` newer than 30 days per platform.
     Read-only; prints nothing secret. Tests on a fixture env + scratch DB.
   - T2 **Outbox tick overlap lock** (the F7 A9 caveat): two overlapping ticks could exceed a daily cap by one.
     Take a Postgres advisory lock (`pg_try_advisory_lock`) at the start of `runOutboxWith`; a second tick returns a
     zero result and logs "tick already running". DB test: two concurrent ticks → one runs. Also set pg-boss
     `singletonKey` on the job if the registration doesn't already.
   - T3 **YouTube `findExisting`** via the uploads playlist (`channels.list part=contentDetails` → `playlistItems.list
     part=snippet maxResults=25`, 1 + 1 quota units), matching the normalised title within ±36 h of `scheduledFor`,
     verified against the Data API docs at build time and logged in `docs/research.md`. Closes the YT branch of F11's
     "unknown" state (today it relies on the human checklist only). Contract test on a fixture.
   - T4 **First-real-post runbook** `docs/runbooks/first-real-post.md`: the exact phone + chat steps for one IG reel and
     one YT private upload, the chat OK gate, what to check afterwards, how to roll back (record-published / reset).
2. **F14 · Weekly loop in the worker** (model: fable lead for the gate, Opus implementers)
   - T1 Sunday job that drafts next week's batch from the library with `scripts/skills/lib/batch-draft.ts` (captions
     by the AI split in `docs/decisions.md`; if the split says "Claude in a session", the job only assembles clips +
     slots and leaves captions empty, flagged) and raises a `batch-ready` alert (pushed).
   - T2 Monday weekly-report job → `report-ready` alert (page-only) + the report stored where `/analytics` reads it.
   - T3 UI: Home "Up next" shows the draft batch waiting for review; `/batches` badge counts it.
   - Non-negotiable 2 stays: the job never approves; nothing publishes without the approved batch.
3. **F9 T3** (conditional on the four probe lines in `docs/research.md`; otherwise skip and say so).
4. **F12 leftovers** if run 3 didn't finish them: Library + touch-up (task 5), Research (task 7), then one
   consistency pass over all pages from the shots (Sonnet).
5. **Codebase map refresh** (`docs/prep/codebase-map.md`, Haiku scout) — stale since F11 T2.

## Lessons to carry (fill in from the night log + report at the end of run 3)
- Wait on agents by their completion notification, not by grepping transcripts (two false positives cost a few k).
- A designer can stop after its first survey command; resume it with SendMessage rather than respawning.
- Three designers in parallel need separate `NEXT_DIST_DIR`s and ports, and no `pkill`.
- The lead's share: see the KPI in `docs/night-reports/night-2026-11-14.html`.
