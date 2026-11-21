# UI system v3 · Quiet dashboard

v3 replaces v2 ("Warm Industrial"). The creator used v2 on his phone and called it clunky and decorative. v3 keeps what he liked (the warm palette, thin hairlines, an open and wide feel, high contrast, symmetry, a little italic display text) and removes everything that was decoration: background grid lines, marquees, the rotating footer logo, the centred logo, giant hero numbers, outline text, debug-style labels and the monospace readouts.

- Tokens: `apps/web/app/globals.css` (the `design system v3` block).
- Components: `apps/web/components/ui/` (import from `index.ts`).
- Screenshots: `docs/design/ui-shots/v3/` (`<screen>-phone.png`, `-phone-night.png`, `-desktop.png`, `-desktop-night.png`).

## Hard rules (a screen that breaks one is not done)
1. **One font and one style per phrase.** A heading, label, button or sentence is entirely display or entirely sans. Never "Up *next*". No overlapping text, ever.
2. **Nothing moves unless the user caused it.** No marquees, no pulses, no rotating or parallax elements. Allowed motion: the sidebar slide, pop-over/dialog fade (150 ms), hover colour changes. `prefers-reduced-motion` removes the slide.
3. **No decoration without function.** No background grid, noise, glass, outline (stroke) text, index labels like "02 /", feature ids like "F12", or "Week 46" style debug text. Weeks are written as dates ("Nov 16 – 22").
4. **Nothing draws over content.** Lines belong to a card's own border or a table's own row divider, never to the page behind.
5. **No monospace.** Numbers use Inter with tabular numerals.
6. **The word "batch" never appears in the UI.** It is "this week", "the calendar", "posts".
7. Every screen works on the seed data and has an empty state that names the next action with one button.
8. Text contrast is AA in Day and Night. Tap targets are ≥ 44 px on phones. Hover-only information is also reachable by tap and by keyboard focus.
9. No green (the creator's standing rule). Positive = accent blue or plain ink with a word.

## Type
| Role | Font | Spec | Used for |
|---|---|---|---|
| Display | **Imbue** (variable, OFL, self-hosted via `@fontsource-variable/imbue`, `opsz` axis on) | weight 400 for the logo and page titles, **500** for card/section titles; uppercase off, letter-spacing 0, line-height 1.0; `font-optical-sizing: auto` so `opsz` follows the size | the logo (28 px), page titles (40 px phone / 56 px desktop), card and section titles (26 px phone / 28 px desktop), post titles (20–22 px); KPI numbers are **not** display |
| Sans | Inter variable | 400 body, 600 labels and buttons, 700 KPI numbers | everything else |
| Editorial italic | Playfair Display italic | whole sentences only, 20–28 px | one pull-quote per screen at most ("what worked" headline, an empty-state line). Never inside a phrase with another font. |

Imbue is a tall, condensed, high-contrast didone: the closest free match to the magazine masthead reference. If it fails to load the fallback stack is `"Bodoni Moda", "Didot", "Bodoni 72", Georgia, serif`.

Sizes (phone / desktop):
- page title 40 / 56 display;
- section or card title 26 / 28 display, weight 500;
- KPI number 28 / 32 Inter 700 tabular;
- body 15 / 15;
- label 12 / 12 Inter 600, sentence case, `ds-muted` (no tracked caps walls; caps only for 1–2 word tags such as GYM, TRADING, at 11 px tracked 0.06em);
- helper 13.

## Colour (unchanged palette, new roles)
Day: page `#EBEBE8`, card `#F4F4F2`, raised/hover `#E2E2DE`, hairline `#D4D4D8`, control border `#71717A`, text `#18181B`, muted `#52525B`, accent `#2F7BFF` (text use `#0057D9`), warn `#8A5300`, danger `#B42318`.
Night: page `#18181B`, card `#1F1F23`, raised `#27272A`, hairline `#3F3F46` (the thin light lines he likes come from `#EBEBE8` at 14% on cards), text `#EBEBE8`, muted `#A1A1AA`, accent `#6AA2FF`, warn `#F2B544`, danger `#F0716B`.

New tokens:
- `ds-tint-1..4`: four very soft tile tints for the KPI row (Day: `#E4E9F2` blue-gray, `#EDE8DF` sand, `#E6E6EA` cool gray, `#E9E4E4` rose-gray; Night: the same hues at 12% over card). Text on tints stays `ds-text`.
- Chart series (fixed order, never cycled): Instagram = accent blue, YouTube = ink (`ds-text`), TikTok = slate `#8A8F98`, Snapchat = sand `#B08D57` (Night: `#C9A56B`). Every multi-series chart has a legend with the platform glyph and name; colour is never the only key.

## Shape and space
- Radius: cards and dialogs 12 px, controls and thumbnails 8 px, pills (nav active item, badges, toggles) full.
- Cards: `ds-card` fill, 1 px hairline, no shadow. Pop-overs, menus, the drawer and dialogs: 1 px hairline plus `shadow-ds-pop`.
- Spacing scale 4 / 8 / 12 / 16 / 24 / 32. Page gutter 16 px phone, 32 px desktop. Card padding 16 phone, 20 desktop. Gap between cards 12 phone, 16 desktop.
- Content max width 1280 px, centred. Layout is a simple 12-column CSS grid with gaps (cards never share borders).
- Symmetry: KPI tiles are equal width; two-column rows are 8 + 4 or 6 + 6; a row's cards stretch to equal height.

## Shell
```
┌──────────────────────────────────────────────────────────────┐
│ [≡] Logo                                  [⌕] [☾] [✉ 3] [🔔 2] │  top bar, 56 px, sticky, page colour, hairline below
├──────────────────────────────────────────────────────────────┤
│  Page title (display)                     [This week ▾]      │
│  cards…                                                      │
```
- **Top bar.** Left: menu button (44 px square, icon only) then the logo: the word "My Socials" in Imbue, 28 px, linking Home. Right: two 40 px square icon buttons with 8 px radius and a hairline border: Inbox (count badge), Notifications (count badge). Nothing else: no profile block, no CTA.
- **Sidebar** (`Sidebar`, client). 264 px wide, card fill, hairline right edge, pop shadow. Logo at the top-left in the same position as the top-bar logo, so opening it doesn't shift the mark. Items, each with a 20 px line icon and an Inter 600 15 px label; the active item is a soft pill (`ds-raised`):
  Home · Calendar · Inbox · Analytics (expandable: Overview, Instagram, YouTube, TikTok, Snapchat) · Research · Library (expandable: All clips, Touch-up) · Platforms (expandable: Instagram, YouTube, TikTok, Snapchat) · Settings. "Log out" sits at the bottom. Groups expand in place; the group containing the current page starts open.
  - **Desktop (≥ 1024 px, fine pointer):** hidden by default. A 12 px invisible hot zone on the left screen edge opens it on `pointerenter`; the menu button and keyboard focus also open it. It stays open while the pointer or focus is inside, and closes **2.5 s after the pointer leaves** (timer cancelled on re-entry). Esc closes at once. It overlays content and never reflows the page.
  - **Phone / touch:** the menu button opens it as a drawer with a scrim; tap the scrim, a link or Esc to close. Focus is trapped while open and returns to the menu button.
- **Notifications** opens a pop-over (full-width sheet on phones): the newest 6 open alerts, each with its message, age and an Acknowledge button, then "See all" → `/notifications`. The badge is the open count. This replaces the Alerts tab.
- **Inbox** links to `/inbox`; the badge is flagged comments + DMs waiting.
- No bottom tab bar, no "More" page, no footer band.

## Core components
Kept and restyled by tokens: `Button` (solid ink, outline, ghost, icon; sentence-case labels, 8 px radius), `Badge`, `Chip`, `Toggle`, `Checkbox`, `Input`, `Select`, `Stepper`, `Sheet` / `ConfirmSheet`, `EmptyState`, `PlatformLogo`, `ThemeToggle`, `TabLinks` / `SegmentBar`.

New:
- `AppShell` v3 (top bar + sidebar + `<main>`), `Sidebar`, `TopBar`, `IconButton` (with `badge`), `NotificationsPopover`.
- `Popover` and `Menu` (click to open, Esc/outside click to close, arrow-key navigation, anchored, flips at the viewport edge), `Dropdown` (a button showing the current value plus a `Menu`; used for "This week ▾" range pickers; it is a link list, so it works without JS state).
- `Dialog` (centred on desktop, bottom sheet at ≤ 640 px; focus trap; URL-driven when it shows server data, e.g. `?day=2026-11-18`).
- `PageHeader` (display title, optional one-line sans subtitle, right-side slot for a Dropdown or one button).
- `Card` (title in display, optional right-side action or `Menu`), `StatTile` (icon, label, number, delta "▲ 12% vs last week" in accent or muted; optional tint), `Thumb` (9:16 poster from `/app/media/poster/<mediaId>`, 8 px radius, neutral placeholder with a film icon when missing; never a striped pattern).
- `PostCard` (compact, horizontal; see Calendar).
- `BarChart` (per-day bars, optional stacked series, value on hover/focus and in a visually hidden table), `LineChart` (multi-series with legend), `HeatRow` if needed. Charts have y-axis ticks in Inter 11 px, no gradients, 2 px lines, bars with 3 px top radius.
- `DataRow` (icon or thumb, title, meta, right-side value or action) for list cards; `external` opens a platform permalink in a new tab (`rel="noopener noreferrer"`), `wrapMeta` lets a long meta line wrap instead of ending in an ellipsis. `InlineNotice` is the one-line status strip (info / warn / danger, optional link, optional `action` outline button-link such as "Reschedule all"; it wraps on phones).

Generic pieces added while building the screens:
- `Textarea`: the `Input` look for multi-line text (16 px so iOS doesn't zoom, vertical resize only, label / helper / error wiring).
- `ChipLink`: a filter chip that is a link (44 px on phones, 36 px from lg; current = raised well with `aria-current`, optional count).
- `Chip size="sm"`: a quiet 24 px tag (12 px text) for dense grids such as library cards.
- `CheckButton`: a submit button that looks like a labelled checkbox (`aria-pressed`), for "tick it and it's saved" rows (Research "Used").
- `CopyButton`: copies text; the label reads "Copied" (announced) for 2 s; optional `onCopied` server action.
- `MenuItem.scroll`: `false` on a link item keeps the scroll position (URL-driven dialogs such as `?move=`).
- `LineChart`: client readout on hover / tap / focus (guide line, a dot per series, tooltip; arrow keys, Home / End, Esc); `xTitles` are the full day labels for the tooltip and hidden table; `baseline="auto"` fits the y axis to the data (followers), default starts at 0.
- `BarChart` (and `LineChart`) `labelEvery`: show every nth x label plus the last, for 30–60 day ranges on a phone.
- `Toggle` and `Checkbox` text: label 15 px Inter 600, description 13 px muted (the helper size); `Input` helpers are 13 px muted too.

The v2 components, the `/design` page, the v2 alias utilities (`ds-caps`, `ds-mono`, `ds-serif`, `ds-stroke`, `ds-display`) and the unused generic ones (`Tooltip`, `Sparkline` / `AreaChart` / `MiniBars`, `Donut`, `ProgressBar`, `Radio`, `Slider`, `PageDots`, `ListRow`, `MonthCalendar`, `AlertCard`, client `Tabs`) were removed in run 4; `v2-static-scan.test.ts` keeps the v2 ones out.

## Screens
Routes are under the `/app` base path. Old routes redirect: `/batches` and `/batches/[id]` → `/calendar` (the latter with `?d=<week start>&view=week`), `/alerts` → `/notifications`, `/more` and `/more/settings` → `/settings`, `/handoff` → `/platforms/snapchat`, `/touch-up` → `/library/touch-up`.

### Home `/`
A quick dashboard, one screen on desktop.
1. `PageHeader` "Home" + range Dropdown (Last 7 days, the default / Last 30 days / This week). Rolling ranges compare with the equal-length period before; "This week" with the same weekdays last week. No delta when the previous value is 0 or unknown; a current 0 reads "None yet".
2. Four `StatTile`s (2 × 2 on phone): Followers (all platforms, change in the range), Views, Engagement (likes + comments + shares), Posts published. Each compares with the previous period. A metric with no data yet shows "–" and a one-line reason, not 0.
3. Row 8 + 4: **Activity** card (`BarChart` of views per day stacked by platform, with its own metric Dropdown: Views / Engagement) and **This week** card (seven rows or columns Mon–Sun with the number of posts scheduled per day as small bars; today marked; each day links to `/calendar?day=`).
4. Row 6 + 6: **From your editors** (up to 4 compact `PostCard`s waiting for approval with Approve; "See all" → calendar filtered to drafts) and **Needs a reply** (up to 4 flagged inbox items: who, the comment, the drafted reply, "Approve & send" and "Open").
5. Only when relevant: a single-line strip for "Snapchat: today's Spotlight is ready" → `/platforms/snapchat`.

### Calendar `/calendar`
- `PageHeader` "Calendar" + month/week segmented control + prev / today / next + "Approve all N" (solid, only when N > 0, where N counts the lines in state `needs-approval`; the confirm Dialog is titled "Approve N posts", has one collapsible group per platform listing each post with day + 12-hour time, and a separate collapsed "Not included: needs a fix first (N)" that is not part of N).
- **Month view:** a 7-column grid of day cells inside one card; cells are separated by the card's own hairlines only. A cell shows the day number and, on desktop, up to three one-line entries (platform glyph, time, truncated title) then "+N more"; on phone, the day number and up to four small platform dots plus a count. Days outside the month are muted. Today has an ink ring. A day with something needing him (draft, failed, unknown) has a small accent dot beside the number.
- **Week view:** desktop = seven columns of compact entries; phone = a vertical agenda grouped by day.
- **Day Dialog** (`?day=YYYY-MM-DD`): title = the date in display font; a list of `PostCard`s, one per clip (its platforms grouped), ordered by first time.
- **`PostCard`**: `Thumb` 63 px on the left; then the title in display 20 px (one line) with the `Menu` (⋯) top-right, the caption (two lines, clamped), and one line per platform: logo, 12-hour time, and that line's own small `Chip` (`lineState` in `lib/calendar/model.ts`: Needs approval, Needs a fix + reason, Approved, Posting, Missed, Failed, Check it, Share by hand). Posted lines and fully-posted cards show a quiet check + "Posted" (no bubble; a fully-posted card shows it where the ⋯ would be). With two or more lines a card-level `Badge` sums up: all alike → that label, mixed → a count ("1 of 3 needs approval"); an approved card is never labelled "Needs approval" because of a sibling. The same menu and card are used on Home (no inline Approve): "Approve <Platform>" per approvable line and "Approve all N on this card", a disabled "Can't approve <Platform>: <reason>" per blocked draft, "Auto-schedule at nearest slot" per missed post (opens the `?reschedule=<id>` confirm: "Post at Fri 9:30 AM? It stays approved."), Edit text, Move…, Reject, Retry or record, Open handoff. Hovering or focusing the thumbnail (tap on phone) opens a `Popover` with a larger preview, the full caption and each platform's own text.
- **Posting banner** (`PostingBanner`): when every missed post is inside the viewed range it says "N missed posts are marked below" with a "Reschedule all" action (`?reschedule=all`, a confirm listing the proposed times, series rows labelled "Series · Day 10") and no "Open week" link; otherwise it keeps the link to the oldest missed week plus the action. `?notice=rescheduled&n=3` shows "Rescheduled 3 posts".
- Every action is a server action through the existing `planTransition` gates; the F11 reset and record flows keep their confirm steps. Snapchat items appear like the others and their menu has "Open handoff".
- Empty month: "Nothing scheduled yet. Drop renders into the editor folder or plan the week." + button to Library.

### Inbox `/inbox`
- `PageHeader` "Inbox" + filter Dropdown (Needs you / Drafted · shadow / Sent / Ignored) + a Comments | DMs segmented control.
- Each item is a `DataRow` card: avatar initial, name, platform glyph, age; the comment; the drafted reply in a raised well (editable); "Approve & send" (solid), "Edit", "Ignore". Triage reason as one Chip.
- The Ignored filter lists promo-spam with the matched rule and "Not spam" (moves it back) / "Always ignore this account".
- `/inbox/item/[id]` is the push-notification landing page: the single item, large "Approve & send".
- The kill switch and per-platform modes move to Settings; the Inbox shows one status line ("Replies are drafts only" or "Auto-reply is on for Instagram") linking there.

### Analytics `/analytics`, `/analytics/[platform]`
- Overview: range Dropdown (7 / 30 / 60 days); four `StatTile`s; views-per-day `LineChart` by platform; "Top posts" list (Thumb, title, platform, views, engagement rate, a "posted by hand" Chip for unmatched posts); **What worked** card (each finding one sentence with "n = 14 posts"; fewer than 5 posts in a group shows "not enough posts yet"); four platform cards linking to the sub-pages.
- Platform page: follower `LineChart`, views `BarChart` per day, posts table, best posting hours, that platform's findings. TikTok page explains: "TikTok numbers aren't collected on the free plan. Add them by hand here or upgrade later." with the manual entry form if it exists.

### Research `/research`
Tabs as links: Ideas · Hooks · Creators · Already used.
- Idea card: title in display; "What it's about"; "How to adapt it" ; the reference link ("Watch the reference", opens the platform); source creator; a **Used** checkbox (moves it to Already used; undo there).
- Creators: add / remove only. Shows when ideas were last refreshed and the next run.

### Library `/library`, `/library/touch-up`
- Library: search field, filter Dropdown (pillar, status), a responsive grid of `Thumb` cards (2 columns on phone, 6 on desktop) with title, duration and tags (e.g. "No sound yet").
- Touch-up: `PageHeader` "Touch-up", subtitle "N clips need a touch-up. Originals are always kept." (empty: "Clips with something to fix show up here."). Only clips with a real issue. Each card: Thumb, the issue in plain words, "Fix it" (solid) and "Dismiss"; a "Fix all N" button on top. After a fix: before → after thumbs and durations, "Keep the fix" / "Keep the original". "Find in library" links to `/library?q=<label>` and highlights the clip.

### Platforms `/platforms/[platform]`
One page per platform: how posts go out (one sentence), connection and token health, today's count against the daily cap, the next 5 scheduled posts, the engagement mode, links to its analytics and (Snapchat) the share-sheet handoff with the video preview, "Share to Snapchat", "Mark posted", "Skip today".

### Settings `/settings`
Sections as cards: Daily posts per platform (Steppers), Replies (per-platform mode: Off / Drafts only / Auto; DM drafts toggle; pause-all switch), Promo-spam accounts (list + add), Research (refresh schedule, AI notes toggle with the monthly budget shown), Notifications (push enable + test), Appearance ("Dark mode" switch), Security (Log out everywhere, with confirm: it signs out every session, this device too; passkeys stay registered. The full lost-phone revoke, passkeys included, is the server command in the runbook). Anything that changes what goes public or costs money shows "Needs your OK in chat" instead of a live control.

### Notifications `/notifications`
Open / Acknowledged filter; rows with icon, message, age, Acknowledge; "Acknowledge all" via confirm; one line linking to Settings for phone notifications.

### Login `/login`
Centred card: logo in display, one solid "Use passkey" button. No shell.

## Decisions made while building
- **One solid button per card or view section**, not per page. Touch-up may show "Fix all N" in the header and "Keep the fix" inside a review card.
- **Home range:** Last 7 days is the default (also when `?range=` is missing or unknown).
- **Push setup lives in Settings only.** `/notifications` links there with one line ("Phone notifications: Settings").
- **"Log out everywhere"** signs out sessions only; passkeys stay. Revoking passkeys is the server command.

## Review checklist (per screen, before commit)
Phone 390 px and desktop 1440 px, Day and Night: no horizontal scroll; no clipped or overlapping text; equal card heights in a row; one solid button per card or view section; empty state present; hard rules 1–9 hold.
