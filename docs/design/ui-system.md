# UI system v1

The look for the creator's dashboard: calm, dark, serif, one light-blue accent, numbers first.
Tokens: `apps/web/app/globals.css` (the `design system v1` block). Components: `apps/web/components/ui/`.
Live style guide: `/app/design` (`?view=home|batch|components`). Screenshots: `docs/design/ui-shots/` (home, batch card and desktop in both themes, plus the approve sheet). UI work goes through the `designer` agent (`.claude/agents/designer.md`).

## Principles
1. **One accent.** Light blue (#29ABE2) marks the one thing to do or the one thing that's on. Everything else is gray.
2. **Numbers are the heroes.** Big tabular figures, small muted captions. A card answers one question at a glance.
3. **Quiet surfaces.** No borders on cards. Separation comes from three gray steps plus a soft shadow.
4. **Phone first.** It's designed at 390 px and scaled up. The thumb reaches the primary action; tap targets are ≥ 44 px.
5. **Serif, tuned.** Times New Roman everywhere: regular weight for big numbers and titles, uppercase tracking for small labels, and never below 13 px.
6. **No green.** Approved, on, done and published use blue or white with a check. Warning is amber and danger is coral, and each always comes with an icon or a word.
7. **Say it in words.** Status is never shown by colour alone. Empty states say what happens next.

## Tokens

### Colour roles: dark (primary theme)
| Token (Tailwind name) | Hex | Role | Contrast |
|---|---|---|---|
| `ds-frame` | #0B0C0E | sidebar, bottom tab bar | — |
| `ds-bg` | #0F1113 | page | — |
| `ds-card` | #1A1D21 | cards, sheets | — |
| `ds-raised` | #23272C | inputs, wells, row hover, toggle-off track | — |
| `ds-line` | #2E3338 | hairlines, progress track | 1.6:1 (decorative) |
| `ds-line-strong` | #3D434A | control borders | 3.0:1 on card (UI ≥ 3:1 ✓) |
| `ds-text` | #F5F6F7 | primary text | 15.6:1 on card |
| `ds-muted` | #A7AEB6 | secondary text, captions | 7.5:1 on card, 8.4:1 on bg |
| `ds-faint` | #8E959D | helper text, placeholders, disabled labels | 5.6:1 on card, 5.0:1 on raised |
| `ds-accent` | #29ABE2 | primary fill, active, on, links | 6.5:1 as text on card, 7.2:1 on bg |
| `ds-accent-hi` | #5BC0EB | hover, focus ring | 8.2:1 on card |
| `ds-accent-lo` | #1679B5 | accent text on white | 4.7:1 on white |
| `ds-accent-fg` | #29ABE2 | accent as **text/icon** (use this, not `ds-accent`, for blue text) | 6.5:1 on card |
| `ds-focus` | #5BC0EB | focus ring | 8.2:1 on card |
| `ds-ink` | #0B0D10 | text on accent and white fills | 7.4:1 on accent |
| `ds-paper` / `ds-paper-2` | #FFFFFF / #ECEEF0 | white tab bar, light alert, menu rows | — |
| `ds-paper-muted` | #5F6770 | muted text on white | 5.7:1 |
| `ds-warn` | #F2B544 | warnings (with ⚠ icon) | 9.2:1 on card |
| `ds-danger` | #F0716B | destructive, failed | 5.9:1 on card |

### Light theme (optional, per device)
`data-theme="light"` on the `.ds-root` element redefines the same roles, so components need no light-specific classes.
- `AppShell` takes `theme` (read with `getTheme()` from `components/ui/theme-server.ts`).
- `ThemeToggle` flips it instantly and stores it in the `ds-theme` cookie; it has an icon variant for the top bar and a row variant for settings.
- Dark stays the default.

| Role | Light hex | Contrast |
|---|---|---|
| frame / bg / card / raised | #E9ECEF / #F2F4F6 / #FFFFFF / #EEF0F3 | — |
| line / line-strong | #E1E4E8 / #858E98 | line-strong 3.3:1 on white (UI ✓) |
| text / muted / faint | #15191D / #4E5660 / #5E6670 | 17.7 / 7.4 / 5.8:1 on card; faint 4.9:1 on frame |
| accent (fills) | #1E9BD6 | ink label 6.2:1; 3.1:1 vs white as a graphic ✓ |
| accent-hi (hover) | #4FBBEA | ink 8.9:1 |
| accent-fg / focus | #13649A | 6.3:1 on card, 5.3:1 on frame |
| warn / danger | #9A6200 / #C0392B | 5.1 / 5.4:1 on card |

Rule: blue **text and icons** use `ds-accent-fg`. Blue **fills, bars, chart lines and rings** use `ds-accent`. Graphics need 3:1 and text needs 4.5:1, and one blue can't do both on white.

**Decision: labels on blue fills are ink, not white.** White on #29ABE2 is only 2.6:1, which fails AA even for large bold text. Ink on blue is 7.4:1 and reads crisper in a serif. Platforms are shown by their **logo glyph in the text colour** (`PlatformLogo`: white in dark, near-black in light). There are no brand colours and no circles behind the logos, so the screen stays one-accent.

### Type (Times New Roman stack, `font-ds`; `ds-num` = tabular-nums)
| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Display number (hero) | 44 / 1.0 | 400 | -0.02em, `ds-num` |
| Page title | 30 phone, 38 desktop / 1.1 | 400 | -0.015em |
| Stat number | 30 / 1.05 | 400 | -0.01em, `ds-num` |
| Card title | 18 / 1.25 | 700 | 0 |
| Body | 17 / 1.45 | 400 | 0.005em |
| Secondary | 15 / 1.35 | 400 | 0 (`ds-muted`) |
| Label caps (`ds-caps`) | 13 / 1.2 | 700 | 0.08em uppercase |
| Minimum | 13 | — | never smaller |

Serifs thin out at small sizes on dark backgrounds, so small text gets a heavier weight (caps 700) or a bigger size rather than a lighter colour. Thin page titles use weight 400, because Times has no 300.

### Spacing, radius, elevation, motion
- **Spacing:** 4 px base; Tailwind steps 1/2/3/4/5/6/8. The card padding is 20 px (`p-5`); the gaps between cards are 16 px on phone and 20 px on desktop; the page gutter is 16 px on phone and 32 px on desktop.
- **Radius:** `rounded-ds-sm` 8 (chips, checkbox), `rounded-ds-md` 12 (buttons, inputs), `rounded-ds-lg` 16 (cards), `rounded-ds-xl` 22 (sheets, big + button); pills use `rounded-full`.
- **Elevation:** cards use `shadow-ds-card`, and popovers and sheets use `shadow-ds-pop`. The active nav pill and the primary + button get `shadow-ds-glow` (the only glow).
- **Motion:** 120 ms for presses, 200 ms for toggles, tabs and hover, and 320 ms for the sheet, all with the `ease-ds` curve. `prefers-reduced-motion` turns all of it off (globals.css).
- **Scope:** everything lives under a `.ds-root` element (`AppShell` adds it), so the old pages are untouched until F12.

## Components (`apps/web/components/ui`, import from `components/ui/index.ts`)
Server components unless marked **client**.

| Component | Use it for | Rules |
|---|---|---|
| `AppShell` | every page (F12) | Sidebar ≥ 1024 px, bottom tabs below. Nav max 5 on phone. Takes `active`, `nav`, optional `accounts` (label + small value). |
| `TopBar` | page title + one primary action | Phone: sticky, title left, one icon action right. Desktop: big thin title, search + accent "+" right. |
| `Card` | every grouped block | Title top-left, optional corner action (thin +, link). `hero` slot = full-width accent band. `bleed` lets charts touch the bottom edge. |
| `StatTile` | KPI pairs | Round icon, big number, muted caption. Numbers always `ds-num`. |
| `ListRow` | posts, comments, accounts | Avatar (monogram), title, muted subtitle, trailing value right-aligned. Whole row is the link/button; ≥ 56 px tall. |
| `Button` | actions | `solid` (accent, ink caps label) = the one primary per view; `outline`; `white`; `ghost`; `icon` (44 px square); `size="sm"`; `block` for full width. Destructive = `tone="danger"` outline. |
| `Toggle` **client** | on/off settings | Pill track: off = raised, on = accent, white knob. Optional `variant="icon"` (✓/✕) or `"text"` (ON/OFF). Always has a visible label. |
| `Checkbox` / `Radio` | multi / single choice | Raised rounded squares; checked = accent fill + white mark (radio = dot). Real inputs, label wraps. |
| `Tabs` **client** (or link mode, server) | 2–5 sibling views | White segmented bar, thin dividers, caps labels, active = accent fill + ink text. Link mode for URL tabs. |
| `Badge` / `Chip` | status, counts, warnings | Status: neutral, accent, warn, danger. Always text, plus an icon for warn and danger. |
| `Input` / `SearchField` | text entry | Raised rounded rects, light text, helper text under. Label above (visually hidden allowed for search). |
| `Select` / `Stepper` | choose from list / small numbers | Native `<select>` styled dark with caret; Stepper = dark pill with − / + (≥ 44 px), **client**. |
| `ProgressBar` | approval progress, quota | Thick rounded accent fill on `ds-line` track; `role=progressbar` with values. |
| `Slider` | rare numeric settings | Native range: thin track, accent fill, white knob. |
| `Sheet` **client** | confirms on phone | Bottom sheet over dim scrim; native `<dialog>`; focus trapped by the browser; Esc closes. On desktop renders as centered dialog. |
| `AlertCard` | "Attention" banners | `tone="dark"` (default) or `"light"`; ⚠ + caps title, small body, optional small accent pill action. |
| `EmptyState` | empty lists | Icon in a raised circle, one line of what this is, one of what happens next, optional action. |
| `Tooltip` | brief hints on icon buttons | CSS-only (hover + focus-within), dark card with pointer; never the only place information lives. |
| `PageDots` | carousels/steps | Dots; active = white, wider. |
| `Sparkline` / `MiniBars` / `AreaChart` | trends | Pure SVG from `components/ui/chart-math.ts`. Area bleeds to card bottom. No axes on phone. |
| `Donut` | share of total | SVG ring + legend; ≤ 5 segments, accent + grays only. |
| `MonthCalendar` | scheduled days | `weekStartsOn` 1 (Monday, default) or 0. 7-col grid, tabular day numbers, small dots under days (accent = scheduled, warn = needs action), today ringed. |
| `Icon` | everything above | Inline SVG set, 1.5 px stroke, `aria-hidden`. |
| `PlatformLogo` | anywhere a platform is named | Monochrome Instagram / YouTube / TikTok / Snapchat glyphs in `currentColor`. Shown bare, never in a circle. 26 px in rows, 16–18 px in chips and the sidebar. `title` makes it labelled. `ListRow avatar={{ platform }}`. |
| `ThemeToggle` **client** | top bar (icon) / settings (row) | Flips `data-theme` on the nearest `.ds-root` and writes the `ds-theme` cookie. |

Usage rules:
- **One solid button per screen region.** A second action is outline or ghost.
- **Lists are card-backed.** Rows separate with `ds-line` hairlines, inset to the text start.
- **Truncation:** one line for titles in rows, two lines for captions; full text always in the detail view.
- **Every interactive element is a real `<button>`/`<a>`/`<input>`** with a visible or `sr-only` label and ≥ 44 px target.

Implementation notes:
- **Barrel:** `components/ui/index.ts` exports everything. Client islands are Toggle, TabsClient (re-exported by `Tabs.tsx`), Stepper, Slider and Sheet; everything else is server-safe.
- **Tests:** view logic is in pure modules (`chart-math.ts`, `toggle-state.ts`, `stepper-math.ts`, `buttonClasses`), plus `renderToStaticMarkup` smoke tests. The root `vitest.config.ts` only sets the automatic JSX runtime.
- **Button labels:** all variants use caps (`ds-caps`), so labels have one voice, as in reference 2.

## Layout rules
**Phone (< 1024 px, designed at 390):**
- The top bar is 56 px and sticky, with the page title (24 px) on the left and one primary icon action on the right.
- Cards stack in one column with a 16 px gutter.
- The bottom tab bar is fixed, 64 px plus the safe area, `ds-frame`, and holds 5 items max: Home, Batches, Inbox, Analytics, More. The active item gets an accent icon and label plus a small accent bar.
- The page has bottom padding equal to the tab bar height + 16 px.

**Desktop (≥ 1024 px):**
- The 260 px sidebar (`ds-frame`) shows the wordmark, the nav list (icon + label), an "Accounts" caps label over platform rows with small values, and the accent "+" pinned at the bottom. The active nav item is an accent pill with ink text and a glow.
- In the content area, the title is 38 px thin at top-left, with the search icon button + the accent "+" at top-right.
- The card grid is 2 columns ≥ 1024 px and 3 columns ≥ 1280 px, with a 20 px gap and max content width 1200 px.

Tablet (640–1023 px) uses the phone shell with a 2-column grid.

## Restyle plan (F12) — one task per Opus implementer, in order
Each task: wrap the page in `AppShell` + `TopBar`, replace ad-hoc classes with `components/ui`, keep all data loading, server actions, `requireSession()` and tests unchanged. Shared acceptance for every task: `pnpm typecheck && pnpm test` green, `pnpm --filter web build` green, phone-shot (390 px) + desktop shot reviewed, no green classes, no new one-off colours (grep `-(green|emerald|lime)-` = 0), contrast AA.

1. **Shell rollout + home** (`app/layout.tsx` body classes → `ds-root` bg; `app/page.tsx`). Uses AppShell, TopBar, Card, StatTile, ListRow, MonthCalendar, AreaChart. Accept: the home matches "Home (proposed)" on `/design` with real data; logout moves into the More menu.
2. **Batches list** (`app/batches/page.tsx`, `batches/ui/WarningChip.tsx` → re-export from ui). Uses ListRow, Badge, Card, EmptyState. Accept: each batch row shows week, counts and a status badge; StatusPill colours are mapped to Badge tones (approved → accent).
3. **Batch detail / approval grid** (`app/batches/[id]/page.tsx`, `batches/ui/{PostCard,WeekGrid,ApproveBar,ItemForm,AddClipSheet}.tsx`). Uses Card ("Batch card (proposed)"), Chip, Button, ProgressBar, Sheet, Tabs. Accept: Approve-all confirm runs through a Sheet on phone; per-post actions are ≥ 44 px; warnings show as warn Chips.
4. **Inbox + DMs** (`app/inbox/page.tsx`, `inbox/dms/page.tsx`, `inbox/ui/*`). Uses Tabs (link mode), Toggle (kill switch, mode rows), ListRow, Button, AlertCard, Badge. Accept: the kill switch is a labelled Toggle with confirm Sheet; tab counts are tabular.
5. **Library + touch-up** (`app/library/page.tsx`, `app/touch-up/page.tsx`). Uses ListRow, Badge, EmptyState, SearchField. Accept: the file-missing state shows as a danger Badge with an icon; the list is readable at 390 px without horizontal scroll.
6. **Analytics** (`app/analytics/page.tsx`). Uses StatTile, Card, AreaChart, MiniBars, Donut, Tabs (week prev/next as buttons). Accept: platform comparison as Donut + legend; every number is tabular; demo mode is badged.
7. **Research (overview, ideas, hooks, creators)** (`app/research/**/page.tsx`, `research/ui.tsx`). Uses Tabs (link mode replaces ResearchHeader), Card, ListRow, Input, Select, Button, Badge. Accept: add-forms use Input/Select with helper text; lint warnings are warn Chips.
8. **Login** (`app/login/page.tsx`, `PasskeyPanel.tsx`). This is a centered Card on `ds-bg` with no shell, using Button and AlertCard. Accept: it still works without JS errors; the passkey button is the only solid button.
9. **Alerts** (F8 page, from the other branch). Uses AlertCard, ListRow, Badge, Button, EmptyState. Accept: acknowledge is a ghost/outline button and the open count shows in the nav badge.
10. **Snapchat handoff** (F10 page, from the other branch). Uses Card, Button (solid "Share to Snapchat"), Badge, ProgressBar (1/day cap), Sheet (mark posted / skip). Accept: the share button stays the only solid one; the daily cap is visible.
