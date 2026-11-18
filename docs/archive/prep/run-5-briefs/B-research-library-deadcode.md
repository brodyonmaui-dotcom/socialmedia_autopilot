# Brief B: research, library and dead code (run 5 cleanup, 2026-11-18)

Read `CLAUDE.md` and `docs/prep/run-4-agent-rules.md` first; they hold. Another implementer edits other files in this checkout at the same time (inbox + settings). **Do not commit.** Port 3102, `NEXT_DIST_DIR=.next-b` if you run the web app. `export DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_dev` (already migrated + seeded).

## B1. Research forms keep the typed text when validation fails
`apps/web/app/research/flow-actions.ts` wraps the base actions in `apps/web/app/research/actions.ts:22-33`, which catch errors and `redirect(path + "?error=…")`. Pages read `sp.error` and pass it to `ResearchFrame`; the dialog's text is lost.
- On a validation failure of add-idea and add-hook (and add-creator if it has the same problem), the redirect must also carry the submitted fields (e.g. `&draft_text=…`, plus any other fields of that form) and keep the dialog open; the page prefills `defaultValue` from them. Cap each echoed value (about 500 chars) and only echo the fields of the form that failed. A successful submit must not echo anything. Keep the `safeReturn` handling of `return`.
- Prefer a small pure helper (e.g. `errorRedirect(path, error, fields)` / `draftFrom(sp)`) in an existing research lib file with unit tests, over logic in the action.
- Tests: helper unit tests + an action test in the existing research action test style showing the error redirect carries the text and a success redirect does not.

## B2. Library clip dialog shows the scheduled dates
`apps/web/components/library/ClipDialog.tsx:46-53` renders `scheduledLong(clip.usedIn)` ("Scheduled in N posts"). Loader `apps/web/lib/library/data.ts:75` counts `batch_items` with `status <> 'rejected'`; `batch_items.scheduled_for` (nullable since 0006) and `platform` exist.
- Extend the dialog's loader (only the dialog's; the grid must not get slower: load it in the clip-detail path, or with one aggregated query, not N+1) with up to the next few uses: `{ platform, scheduledFor: Date | null, status }` ordered by time, upcoming first. Keep `usedIn`.
- Dialog: under the existing line, list them as e.g. "Instagram · Tue 24 Nov, 18:00" (use the app's existing date/time formatting helpers and time-zone setting; find how the calendar formats times. No hard-coded time zone). Posts without a time say "not timed yet". Each line may link to `/calendar?view=week&d=<that week's start>` (see `batchRedirect` in `apps/web/lib/calendar/model.ts:390`). Past posts: show as "posted"/past only if the status says so; don't invent states.
- Tests: the pure formatting helper (in `apps/web/lib/library/screen.ts`) and the loader query against the seeded DB if the library already has DB tests, else a fake-pool test.
- Phone shot of a clip dialog that has scheduled posts, 390 px Day and Night, to `logs/shots/b/`. Report the paths. (Seed has calendar demo posts; if none is linked to a library clip, add the link in the seed module that already creates them, idempotently.)

## B3. Dead code
1. `apps/web/lib/editor/approve.ts` is imported only by `apps/web/lib/editor/__tests__/editor.test.ts`. Re-check with grep, then delete the file and only the tests that cover it (keep the rest of that test file).
2. `apps/web/lib/handoff/view.ts`: `heroLines`, `dailyProgress`, `pulseFor`, `todayMeta`, `shareStep` have no importer outside their test. Re-check, delete them, their tests, and any helper (e.g. `plural`) that becomes unused. Keep `suggestionMeta`, `durationLabel`, `orderedChecklist`, `resultText`, `shareHint`, `shareLabel`, `isLocationLine`.
3. Alerts "Open in calendar" (`apps/web/components/notifications/AlertRow.tsx:58`) links to `/batches/<id>`, which redirects. Make the alert's data carry the week start (join `batches.week_start` in the alerts loader, find it) and link with `batchRedirect(weekStart)` directly. Keep `app/batches/[id]` (old pushes still point at it). Test the href.

## Files you may touch
`apps/web/app/research/**`, `apps/web/components/research/**`, `apps/web/lib/research/**`, `apps/web/lib/library/{data,screen}.ts` + tests, `apps/web/components/library/ClipDialog.tsx`, the library page/route that loads the dialog, `apps/web/lib/editor/**`, `apps/web/lib/handoff/**`, `apps/web/components/notifications/**`, the alerts loader in `apps/web/lib/**` (+tests), `scripts/dev/lib/*` seed module if needed. **Not** `apps/web/lib/library/qa-issues.ts`, inbox or settings files.

## Done when
`pnpm typecheck` 0 errors; `pnpm test` (with DATABASE_URL) all green with numbers; web build with `NEXT_DIST_DIR=.next-b` OK, then restore `apps/web/tsconfig.json` and `apps/web/next-env.d.ts` with `git show HEAD:<path> > <path>`. Report per the rules file (<40 lines).
