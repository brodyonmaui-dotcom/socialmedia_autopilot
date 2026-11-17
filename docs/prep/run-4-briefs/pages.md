# Brief: v3 pages (one designer per section)

Every page designer reads `docs/prep/run-4-agent-rules.md` (binding), `docs/design/ui-system.md` v3 in full, and looks at the finished Home (`apps/web/app/page.tsx`) and Calendar as the reference for spacing, card anatomy and tone. Build only from `apps/web/components/ui` (extend the system there if something is missing and say so in the report). You do not commit. Port and dist dir are in the task message.

Shared rules:
- Use the demo DB for the app and shots: `DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_demo`, `DEV_POSTER_DIR=<repo>/logs/dev-posters`. Use `autopilot_dev` for `pnpm test`.
- Data comes from the loaders and actions named in your section. If a loader lacks something the screen needs, add a small pure view builder in the page's `lib/<area>/` folder; don't write SQL in pages.
- Remove the old components from your pages (`GridLines`, `Marquee`, `Display`, `Readout`, `SectionHead`, `RevealList`, `StatusPulse`, `Statement`, `FramedImage`, `TabLinks` hero blocks). No "batch" wording. No monospace. One font per phrase.
- Every page: `requireSession()`, an empty state with one next action, redirects for the old routes listed in the spec.
- Shots (phone 390, desktop 1440, Day and Night for the main view; phone + desktop Day for secondary views) saved to `docs/design/ui-shots/v3/<screen>-<phone|desktop>[-night].png`. Look at each one and fix what breaks the hard rules before reporting.
- Acceptance: typecheck, full tests with DATABASE_URL, web build with your dist dir, shots reviewed.

## A. Analytics (`/analytics`, `/analytics/[platform]`)
Loaders: `apps/web/lib/analytics/overview.ts` (`loadOverview`), `platform.ts` (`loadPlatform`). Types are in those files.
- Overview per the spec. Range Dropdown = links `?days=7|30|60`. KPI deltas as "▲ 12% vs the 30 days before"; `previous: null` → no delta, a quiet "no earlier data".
- Views chart: `LineChart` by platform from `viewsPerDay` with the fixed series colours and a legend; null series are omitted and named under the chart ("TikTok: not collected").
- Top posts: `DataRow`s with `Thumb` when `mediaId` exists (else the platform glyph tile), title, date, views, engagement rate, "Posted by hand" Chip when `byHand`; the row links to `permalink` (new tab, `rel="noopener noreferrer"`).
- What worked: findings with `status: 'ok'` as one sentence each plus a small "n = …" note; the strongest one may be the page's single Playfair-italic pull-quote. `insufficient` ones are collapsed under "Not enough posts yet (3)".
- Platform cards → sub-pages. Platform page: follower `LineChart`, views `BarChart`, posts table (sortable by views via `?sort=`), best posting time (`bestHours` as five labelled bars, the best marked with a word, not only colour), that platform's findings. `collected: false` (TikTok, Snapchat) → an explanatory card with the reason and what would turn it on. Old "trial reels" block: keep it only if the existing data has rows; an empty trial list is one quiet line.
- Delete the old analytics page code paths and `lib/analytics/view.ts` pieces nothing uses any more (keep what the weekly report script uses).

## B. Inbox (`/inbox`, `/inbox/dms`, `/inbox/item/[id]`)
Loaders/actions: `apps/web/lib/inbox/` (`loadInbox`, `loadInboxItem`, `approveAndSend`, promo-account functions, `loadReplyStatus`) and `apps/web/app/inbox/actions.ts`. Read the inbox implementer's report section in `docs/prep/run-4-briefs/inbox.md` and the code for exact types.
- Per the spec: filter Dropdown (Needs you / Drafted / Sent / Ignored) with counts, Comments | DMs segmented control, item cards, the status line linking to Settings.
- "Approve & send" is the single solid button per item card; while replies are drafts-only the button still works as a manual send (that is the point). The result note is shown at the top ("Sent to Instagram" / "Dry run: nothing was sent" / the refusal reason in plain words).
- Editing a reply is inline (a textarea in the raised well, Save) and re-runs the reply lint server-side; lint errors show under the field.
- Ignored filter: matched rule in plain words ("Looks like a promo account: asks you to send the clip to another page"), "Not spam", "Always ignore this account".
- `/inbox/item/[id]`: restyle the functional page into the push landing page: the post's Thumb + title, the comment, the drafted reply, one big "Approve & send", then "Edit" and "Ignore". Works when the item is already sent (shows the state, no button).
- The kill switch and per-platform modes leave this page (they live in Settings); keep their server actions intact for Settings to use.

## C. Research (`/research`, `/research/hooks`, `/research/creators`, `/research/used`)
Loaders/actions: `apps/web/lib/research/ideas.ts` and `apps/web/app/research/actions.ts` (see the code for types).
- Tabs as links. Ideas: filter chips for source (From creators / Your niche / Your scripts) and pillar. Idea card per the spec; a script idea has "Read the script" (expands in place or opens a Dialog with the script text and a "Copy" button). The Used checkbox submits immediately (a small form; works without JS) and the card leaves the list with an "Undo" note.
- Hooks: the fill-in template in sans as the main line, the quoted reference hook with attribution beneath it and the link; Used checkbox as above.
- Creators: add form (handle + platform + pillar), rows with remove (confirm Dialog; it only deactivates). A status card: last refresh, next refresh, ideas added last run, "AI notes: off" linking to Settings.
- Already used: both ideas and hooks, newest first, with Undo.

## D. Library + Touch-up (`/library`, `/library/touch-up`)
Loaders/actions: `apps/web/lib/library/` (`loadLibrary`, `loadTouchUp`, `requestFix`, `keepFix`, `keepOriginal`, `dismissIssue`) and `apps/web/app/library/actions.ts`.
- Library per the spec: search field (GET form `?q=`), pillar/tag Dropdown, Thumb grid (2 / 3 / 6 columns), title + duration + info tags. `?focus=<mediaId>` scrolls to and rings that clip. Clicking a clip opens a Dialog: larger poster, facts (duration, size, pillar), where it is scheduled (links to the calendar day), its tags and any open issue with "Fix it".
- Touch-up per the spec: header "N clips need a touch-up" with "Fix all N" (confirm Dialog listing what will be done; originals are kept); each card: Thumb, plain-word issues, state. States: none → "Fix it" + "Dismiss"; queued/running → "Fixing…" (no spinner animation; a static label and "Refresh"); done → before/after Thumbs and facts with "Keep the fix" (solid) / "Keep the original"; failed → the reason and "Try again". Empty state: "Nothing needs fixing."
- `/touch-up` redirects to `/library/touch-up`.

## E. Platforms + Settings (`/platforms/[platform]`, `/settings`)
- Platforms: one dynamic route for instagram | youtube | tiktok | snapchat (404 otherwise). Data: a new `apps/web/lib/platforms/load.ts` composing existing sources: route mode text (from `packages/core` capability matrix), token health (the token-health job's alerts / stored state), today's count vs cap (`loadCadence` + batch_items), next 5 scheduled (calendar loader), engagement mode (`apps/web/lib/engagement/settings.ts`), analytics card (`loadOverview().platforms`). Snapchat page embeds the handoff flow moved from `apps/web/app/handoff/` (keep `apps/web/lib/handoff/**`, its media proxy route and all its confirmations; restyle with a plain rounded `<video>` preview); `/handoff` redirects to `/platforms/snapchat`. Fix every link that pointed at `/handoff` (alerts, push payloads, tests).
- Settings: rebuild `/settings` per the spec from the existing pieces: caps (`apps/web/lib/settings/caps.ts`; set the **defaults** to the creator's choice Instagram 6, YouTube 10, TikTok 7, Snapchat 1 in the one place defaults are defined, keeping the hard `CAP_LIMITS` validation; update the tests that pin 5), reply modes + DM drafts toggle + pause-all (move the existing kill-switch and mode actions from the inbox here; going live still requires the existing typed confirmation and the server env gate; show "Needs your OK in chat" wording next to Auto), reply pings (`engagement.pings`), promo-spam accounts (list / add / remove), research (schedule shown, AI notes row as "Off. Needs your OK in chat" with tokens used this month), notifications (push enable + test, moved from /notifications if it lives there), appearance (Day / Night), security: "Log out everywhere" (confirm Dialog; revokes every session in the auth store, including the current one, then redirects to login; reuse the logic behind `pnpm auth:revoke-all`; audit it like other settings changes).
- Every settings change writes the existing settings audit entry (`apps/web/lib/settings/audit.ts`) and raises the `settings-change` alert as today.
