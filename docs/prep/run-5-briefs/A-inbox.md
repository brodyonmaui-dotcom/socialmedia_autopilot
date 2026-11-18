# Brief A: inbox follow-ups (run 5 cleanup, 2026-11-18)

Read `CLAUDE.md` and `docs/prep/run-4-agent-rules.md` first; they hold. Another implementer edits other files in this checkout at the same time. **Do not commit.** Port 3101, `NEXT_DIST_DIR=.next-a` if you run the web app. `export DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_dev` (already migrated + seeded).

## A1. Add a promo account by handle (Settings)
Today promo accounts are added only from an inbox item (`ignoreAccountAction` in `apps/web/app/inbox/actions.ts:188` → `addPromoAccount`), and removed in Settings (`apps/web/app/settings/page.tsx:176-196`, action `apps/web/app/settings/actions.ts:122`). Table `engagement_promo_accounts` (0012): unique open row per (platform, author_key). The matcher (`packages/engagement/src/rules.ts` `onPromoList`) already matches a listed `authorKey` against the author id **or** the lower-cased handle, so a handle-only key works.

- In `apps/web/lib/inbox/promo.ts` add a pure `parsePromoHandle(platform: string, raw: string): { platform: Platform; handle: string } | { error: string }` and `addPromoAccountByHandle(pool, platform, handle, now)`. Rules: platform must be one with comments in this app (instagram, youtube, tiktok; check the existing Platform type / engagement platforms and use what the inbox supports); trim, strip leading `@`s and a pasted profile URL is out of scope (reject it); lower-case; allow `[a-z0-9._-]{1,40}`; error strings are short, plain sentences. Store `author_key = promoAuthorKey(null, handle)`, `display_handle = "@"+handle` or match how existing rows store it (look at `addPromoAccount`), `source = 'manual'`. Idempotent: an already-open row returns `{ added: false }`-style result, never a duplicate or an error. Reuse `addPromoAccount` if its shape fits rather than writing a second insert.
- Server action `addPromoAccountAction(fd)` in `apps/web/app/settings/actions.ts` (requireSession like its siblings; redirect back to Settings with the existing note/error convention used in that file).
- Settings UI: a small form under the "Accounts the inbox always ignores" list: platform select + handle text input + "Add" button. Follow `docs/design/ui-system.md` v3 and the existing form controls in `apps/web/components/ui/`. Copy: label "Add an account by handle", placeholder "@handle".
- Tests first: pure tests for `parsePromoHandle` (good handle, `@@Name` → `name`, URL rejected, empty, too long, bad platform); a DB test in `apps/web/lib/inbox/__tests__/inbox.db.test.ts` style (add, add again = no duplicate, then the matcher sees it: a comment from that handle with no author id goes to promo via `promoRule`); a settings action test in `apps/web/app/settings/__tests__/actions.test.ts` style.
- Phone shot of Settings at 390 px, Day and Night, saved to `logs/shots/a/`. Report the paths.

## A2. Inbox item returns `mediaId`
`apps/web/lib/inbox/item.ts` `loadInboxItem` joins `batch_items bi` but selects no `bi.media_id`. Add `mediaId: string | null` to `InboxItem` and the select. In `apps/web/app/inbox/item/[id]/page.tsx:78` pass `mediaId={item.mediaId}` to `<Thumb>`. Extend the existing item test (find it) to assert `mediaId` (null when the comment has no batch item).

## A3. `pathFrom` keeps `filter=`
`apps/web/app/inbox/actions.ts:34-38` `pathFrom` reads only the hidden `tab` field. The list now uses `?filter=` (`INBOX_FILTERS` in `apps/web/lib/inbox/list.ts:16`, `parseFilter` in `apps/web/lib/inbox/view.ts:183`) and DMs live at `/inbox/dms` (check how DMs filters are expressed). After an action on DMs or Ignored, the user must land on the same list.
- Export `pathFrom` (or move it into a pure lib file such as `apps/web/lib/inbox/view.ts` next to `parseFilter`) and make it read a `filter` field: a valid filter id → `/inbox?filter=<id>` (or `/inbox/dms?filter=<id>` for DMs); `needs-you` → plain `/inbox`; unknown values ignored; legacy `tab` still works.
- Make every inbox form that posts to these actions send the current filter as a hidden `filter` input (components in `apps/web/components/inbox/`, `apps/web/app/inbox/**`). Grep for the hidden `tab` input to find them all.
- Tests: unit table for `pathFrom` (each filter, DMs + filter, legacy tab, junk), plus one action test in `apps/web/app/inbox/__tests__/actions.test.ts` that the redirect keeps `filter=ignored`.

## Files you may touch
`apps/web/lib/inbox/{promo,item,view,list}.ts` and their `__tests__`, `apps/web/app/inbox/**`, `apps/web/components/inbox/**`, `apps/web/app/settings/{page,actions}.tsx?` and `apps/web/app/settings/__tests__/`. Nothing else; report needed edits elsewhere.

## Done when
`pnpm typecheck` 0 errors; `pnpm test` (with DATABASE_URL) all green with numbers; web build with `NEXT_DIST_DIR=.next-a` OK, then restore `apps/web/tsconfig.json` and `apps/web/next-env.d.ts` with `git show HEAD:<path> > <path>`. Report per the rules file (<40 lines).
