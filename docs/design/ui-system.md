# UI system v2 · Warm Industrial

v2 replaces v1's dark + Times New Roman look with the creator's chosen direction. The palette is warm gray (#EBEBE8). Inter carries the structure and Playfair Display italic adds editorial accents, over a visible 12-column grid. Labels are tiny tracked caps, readouts are monospace, and everything is sharp and rectangular with 1 px lines. There's one blue accent.
- Tokens: `apps/web/app/globals.css` (the `design system v2` block).
- Components: `apps/web/components/ui/`.
- Live guide: `/app/design` (`?view=home|batch|components`, `&theme=dark` for Night).
- Screenshots: `docs/design/ui-shots/`.
- Agent: `.claude/agents/designer.md`.

## Principles
1. **The grid is visible and binding.** Twelve faint vertical lines (four on phones) run the full page height. Every box and text edge sits on a line.
2. **Structure, not decoration.** Lines separate things, never shadows. Corners are square. Only CTA pills, badges, toggles and status dots are round.
3. **Editorial contrast.** Heavy Inter 900 and outline (stroke) display type sit beside Playfair italic. Labels are 10 px bold caps, tracked 0.22em. Machine facts are monospace readouts.
4. **Numbers stay the heroes.** The week's approval count is the hero headline, and every count uses tabular numerals.
5. **One accent.** Blue (#2F7BFF, a touch lighter than #0066FF) is for stars, live dots, progress, active state and focus, and nothing else. The primary button is black.
6. **Motion has inertia.** Everything moving uses `cubic-bezier(0.16, 1, 0.3, 1)`: 300 ms for hovers, 600 ms for clip-path reveals. `prefers-reduced-motion` stops marquees and pulses.
7. **Phone first.** It's designed at 390 px. There's a bottom tab bar for the thumb, tap targets are ≥ 44 px, and hover reveals have a tap/visible fallback.

## Source → app mapping
The reference is a SaaS marketing page. Each of its sections becomes a real job in the app:

| Reference section | In this app |
|---|---|
| Sticky header (nav · centered logo · pill CTA) | `SiteHeader`: desktop nav links in tiny caps; logo `run` (Playfair italic) + `MYSOCIALS` (Inter 900); pill CTA "New batch". Phone: logo + CTA only; nav moves to the bottom tab bar. |
| Split hero (status · 3-line display · readouts · Start) | Home `Hero`: the "Autopilot on" pulse; display `WEEK 47` (stroke) / *approved* (serif) / `18/24` (solid); readouts for pending, next post, alerts and outbox; a black rectangular "Review batch →" button. |
| Hero image + glass status card | The next post's thumbnail in grayscale with a 20 px inner frame, overlaid by a glass card with one status bar per platform plus mono IDs. |
| Marquee ticker | `Marquee`: platforms and this week's pillars, stroke sans alternating with serif, separated by blue ✦. |
| Project list (hover italic + clip-path reveal) | `RevealList`: "Up next", one row per scheduled post (index, time, title, platform logo). Hover/focus turns the title italic and wipes in the thumbnail. On a phone the thumbnail is always visible, small. |
| Philosophical parallax | `Statement`: one large serif-italic line from the weekly report ("Short hooks under 2 s held 31% longer."). |
| Technical journal | `Journal`: dated mono entries in a numbers grid (views, flagged, auto-replied, alerts), the posting calendar and the weekly-report items. |
| Massive footer | `FooterBand`: black band, a big "Inbox — 7 waiting →" link, a 20vw background marquee "RUNMYSOCIALS" at 10%, and a status row with "Worker operational" pulse + version. |

## Tokens

### Colour roles · Day (default)
| Token | Hex | Role | Contrast |
|---|---|---|---|
| `ds-bg` / `ds-frame` | #EBEBE8 | page, header, tab bar: keep everywhere | — |
| `ds-card` | #F4F4F2 | panels, marquee ribbon, sheets | — |
| `ds-raised` | #E2E2DE | inputs, wells, row hover | — |
| `ds-line` | #D4D4D8 | 1 px structure lines | decorative |
| `ds-line-strong` | #71717A | control borders | 4.1:1 on bg (UI ✓) |
| `ds-grid` | #18181B @ 10% | 12-column background lines | decorative |
| `ds-text` | #18181B | text, stroke-text outline | 14.8:1 |
| `ds-muted` | #52525B | secondary text | 6.5:1 |
| `ds-faint` | #5F5F68 | helper, readout keys | 5.3:1 on bg, 4.9:1 on raised |
| `ds-invert` / `ds-on-invert` | #18181B / #EBEBE8 | black button, footer band | 14.8:1 |
| `ds-accent` | #2F7BFF | stars, dots, bars, active marks | 3.3:1 on bg (graphic ✓); ink label 4.6:1 |
| `ds-accent-fg` / `ds-focus` | #0057D9 | blue text/icons, focus ring | 5.2:1 on bg, 5.7:1 on card |
| `ds-warn` / `ds-danger` | #8A5300 / #B42318 | warnings, destructive (with icon/word) | 5.9 / 5.6:1 |

### Night (`data-theme="dark"`, opt-in)
| Role | Hex | Contrast |
|---|---|---|
| bg/frame, card, raised | #18181B, #1F1F23, #27272A | — |
| line, line-strong | #3F3F46, #71717A | line-strong 3.7:1 |
| text, muted, faint | #EBEBE8, #A1A1AA, #8B8B94 | 14.8 / 6.9 / 5.3:1 |
| invert / on-invert | #EBEBE8 / #18181B | 14.8:1 |
| accent (= accent-fg, focus) | #6AA2FF | 6.9:1; ink label 6.9:1 |
| warn, danger | #F2B544, #F0716B | 9+ / 5.9:1 |

**Deviation: the status pulse is blue, not green.** The reference uses #22C55E, but the creator's standing rule is no green. "Live/operational" uses `ds-accent` plus the word. To switch, change `StatusPulse`'s `tone` default; it's a one-line change.

### Type
| Role | Spec | Utility |
|---|---|---|
| Display (hero) | Inter 900, `clamp(56px, 13vw, 160px)`, line 0.88, -0.05em | `ds-display` (+ `ds-stroke` for outline lines, `ds-serif` for italic lines) |
| Section title | Inter 900, 40 px phone / 64 px desktop, -0.04em, often with one serif word | — |
| Row title (RevealList) | Inter 700, 28 px phone / 48 px desktop, -0.03em; becomes `ds-serif` on hover | — |
| Big number | Inter 900, 40–64 px, -0.04em, `ds-num` | — |
| Body | Inter 400, 16 px / 1.5 | — |
| Label | 10 px (11 px on phone) Inter 700 caps, 0.22em | `ds-caps` |
| Readout | system mono 10 px (11 px on phone), `KEY · VALUE` | `ds-mono` |
| Editorial | Playfair Display italic 400 | `ds-serif` |

**Fonts** are self-hosted from npm (`@fontsource-variable/inter`, `@fontsource/playfair-display` latin italic, both pinned). There are no requests to Google; mono uses the system stack.

### Space, grid, shape, motion
- **Grid:**
  - 12 columns at ≥ 1024 px (max 1600 px, centred, 32 px gutters);
  - 4 columns on phones and tablets (16 px gutters);
  - lines are `ds-grid`, fixed, behind content (`GridLines`);
  - content uses `grid-cols-4 lg:grid-cols-12` with `gap-0`, so cell borders sit on the lines.
- **Sections** are full-bleed bands separated by 1 px `ds-line` borders. Inside them, cells have 24 px padding (phone) / 32 px (desktop).
- **Corners:** radius tokens are 0. Only `rounded-full` is allowed: on pill CTAs (`ButtonLink variant="pill"`), badges, toggles, status dots and the "View" cursor circle.
- **Elevation:** none. `shadow-ds-pop` is for sheets/tooltips only.
- **Noise:** a fixed fractal-noise SVG at 4% opacity over everything (`NoiseOverlay`, `pointer-events: none`).
- **Motion:**
  - all transitions use `ease-ds` = `cubic-bezier(0.16,1,0.3,1)`, at 150 / 300 / 600 ms;
  - the marquee runs 28 s linear;
  - the pulse is 2 s;
  - reduced motion turns all of it off.

## Components (`apps/web/components/ui`, import from `index.ts`)
Server components unless marked **client**.

**Frame**
- `AppShell`:
  - `.ds-root` + `NoiseOverlay` + `GridLines` + `SiteHeader` + `<main>` + phone `TabBar` (+ optional `FooterBand`);
  - theme prop (Day default);
  - replaces v1's sidebar.
- `SiteHeader`:
  - sticky, 64 / 80 px, `bg-ds-bg/80` + `backdrop-blur-[10px]`, 1 px bottom line;
  - nav (≥ lg) left, logo absolute-centred, pill CTA + theme toggle right.
- `TabBar`: phone only. Five items, square cells divided by 1 px lines, 10 px caps labels; the active item has a 2 px blue top rule plus bold text.
- `GridLines`, `NoiseOverlay`: decorative, `aria-hidden`.

**Editorial**
- `Display`: lines of `{ text, style: 'solid'|'stroke'|'serif' }`, rendered as one `<h1>`.
- `Readout`: mono `KEY · VALUE` list.
- `StatusPulse`: 6 px dot + ring pulse + caps label.
- `Marquee`: items alternate stroke/serif with blue ✦; duplicated track `aria-hidden`; reduced motion stops it; `size="xl"` (7xl ribbon, 120 px) or `"bg"` (20vw, 10%).
- `RevealList` / `RevealRow` **client**:
  - rows show an index, mono meta, a big title and a trailing platform logo;
  - the `clip-path` image reveal runs from `inset(0 0 0 100%)` to `inset(0)` over 600 ms, grayscale with a blue 20% multiply;
  - a "View" circle follows the cursor (pointer: fine only) and otherwise sits on the right;
  - phone: 120 px rows with a visible 64 px thumbnail.
- `FramedImage`: grayscale image or placeholder with a 20 px inner frame line. `GlassCard`: `bg-ds-card/60` + `backdrop-blur-md` + 1 px line, sharp.
- `StatusBars`: labelled mono bars (platform → %).
- `Statement`: big serif line with a small caps source.
- `FooterBand`: inverted band, big link with an underline grow, background marquee, and a status row.
- `SectionHead`: caps index "02 / UP NEXT" + title with optional serif word + right-side meta.

**Controls (v1, restyled by tokens + small edits)**
- `Button`:
  - `solid` = black rectangle (`ds-invert`), caps label, arrow slot that rotates −45° on hover;
  - `accent` = blue fill with ink label;
  - `outline` = 1 px line;
  - `ghost`; `icon` (44 px square);
  - `pill` = rounded-full 1 px border with 10 px caps, used for header CTAs.
- The rest:
  - `Toggle` (pill track allowed);
  - `Checkbox` / `Radio` (sharp squares);
  - `Tabs` (bordered cells, active = black fill);
  - `Badge` (pill) / `Chip` (sharp, 1 px line);
  - `Input` / `SearchField` (sharp, raised fill, 1 px line on focus);
  - `Select`, `Stepper`;
  - `ProgressBar` (4 px, square ends, blue);
  - `Slider`;
  - `Sheet` (sharp top edge, 1 px top line);
  - `AlertCard` (1 px line, caps title);
  - `EmptyState`, `Tooltip`, `PageDots` (square dashes);
  - `Card` (a bordered cell, no fill by default), `StatTile`, `ListRow`;
  - charts (blue line, no fill gradients, mono axis labels), `Donut`, `MonthCalendar` (square today marker);
  - `PlatformLogo`, `ThemeToggle` (Day/Night).

Rules:
- One black solid button per view. Secondary actions are outline/ghost.
- No shadows, gradients (except the image tint) or rounded rectangles.
- Labels are always caps (`ds-caps`). Values are tabular. Machine values (IDs, times, counts in readouts) are mono.
- Hover-only information must also show on focus and on phones.

## Layout rules
**Phone (< 1024 px):**
- The 64 px sticky header has the logo centred, the pill CTA right and the theme icon left.
- There are 4 grid lines and sections stack.
- The hero display is 56–64 px; the hero image goes below the text at 4:5.
- The 64 px bottom TabBar has 5 items, and content gets bottom padding for it.
- The footer band sits above the tab bar.

**Desktop (≥ 1024 px):**
- The 80 px header has nav on the left (Home, Batches, Inbox, Analytics, Research), the logo centred and CTA + theme on the right.
- There are 12 grid lines.
- The hero splits 7 columns / 5 columns, the numbers band is 4 × 3 columns, and the journal is 8 + 4.
- There's no tab bar.

## Restyle plan (F12) — one Opus designer task each, in order
Every task:
- wraps the page in `AppShell` (it adds the header, grid, noise and tab bar);
- uses `SectionHead` + bordered grid cells;
- keeps all data loading, server actions, `requireSession()` and tests.

Shared acceptance:
- `pnpm typecheck && pnpm test` and the web build pass;
- a 390 px phone shot plus a 1440 desktop shot have been reviewed, in Day and Night;
- there's no `rounded-` except `rounded-full` on allowed elements, no shadows, and no green;
- text contrast is AA;
- edges align to the grid lines.

1. **Shell + Home** (`app/layout.tsx` body bg → `ds-bg`, `app/page.tsx`). Uses the Hero, Marquee, Up next RevealList, numbers band, Statement and FooterBand. Accept: it matches `/design?view=home` with real data, and logout moves into the header menu.
2. **Batches list.** Uses RevealList rows per week (index = week number, meta = counts, Badge status). Accept: the status words are mapped (approved → accent badge).
3. **Batch detail / approval grid.** Uses "Batch card (proposed)" as a bordered grid cell, Chips, `Button solid` Approve, ProgressBar and ConfirmSheet. Accept: approve-all goes through the Sheet; actions are ≥ 44 px.
4. **Inbox + DMs.** Uses Tabs, Toggle (kill switch with ConfirmSheet), ListRow cells, StatusPulse for live mode, Readouts for limits.
5. **Library + touch-up.** Uses a grid of FramedImage cells (4 / 12 cols), Badge "file missing" (danger) and SearchField.
6. **Analytics.** Uses SectionHead, a numbers band, AreaChart, Donut, Statement (top insight) and Journal (report items).
7. **Research.** Uses Tabs (link mode), RevealList for ideas/hooks, Input/Select forms and warn Chips.
8. **Login.** Centred Display "Sign *in*", one black solid "Use passkey" button, GridLines + Noise, no tab bar.
9. **Alerts** (F8, merged). Uses AlertCard rows, StatusPulse, and ghost "Acknowledge" buttons; the open count shows on the tab-bar badge.
10. **Snapchat handoff** (F10, merged). Uses FramedImage preview, `Button solid` "Share to Snapchat", ProgressBar (1/day), and ConfirmSheet for posted/skip.
