---
name: IntelMonitor
description: Pre-answered standing questions for supervisory analysts, every claim linked to its sources.
colors:
  canvas: "oklch(0.972 0.004 260)"
  surface: "oklch(0.993 0.002 260)"
  rail: "oklch(0.955 0.005 260)"
  hover: "oklch(0.925 0.006 260)"
  line: "oklch(0.93 0.005 260)"
  line-strong: "oklch(0.885 0.007 260)"
  line-field: "oklch(0.80 0.01 260)"
  ink: "oklch(0.23 0.012 260)"
  ink2: "oklch(0.47 0.014 260)"
  ink3: "oklch(0.56 0.012 260)"
  accent: "oklch(0.52 0.17 258)"
  accent-strong: "oklch(0.46 0.16 258)"
  new: "oklch(0.48 0.15 258)"
  new-bg: "oklch(0.955 0.022 250)"
  watch: "oklch(0.47 0.105 62)"
  watch-bg: "oklch(0.965 0.035 80)"
  attn: "oklch(0.50 0.17 28)"
  attn-bg: "oklch(0.955 0.022 25)"
  stable: "oklch(0.47 0.10 155)"
  mark: "oklch(0.94 0.07 95)"
  on-ink: "oklch(0.97 0.004 260)"
  on-ink-link: "oklch(0.80 0.10 258)"
  on-ink-hover: "oklch(0.32 0.012 260)"
  scrim: "oklch(0.23 0.012 260 / 0.24)"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "34px"
    letterSpacing: "-0.015em"
  hero:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  badge: "4px"
  control: "6px"
  widget: "10px"
  sheet: "14px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  status-column: "112px"
components:
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
    typography: "{typography.body}"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
  button-small:
    height: "28px"
    padding: "0 10px"
  icon-button:
    textColor: "{colors.ink2}"
    rounded: "{rounded.control}"
    size: "28px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.line-field}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  segmented:
    backgroundColor: "{colors.rail}"
    rounded: "{rounded.control}"
    height: "28px"
  segmented-selected:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line-strong}"
    textColor: "{colors.ink}"
  badge-new:
    backgroundColor: "{colors.new-bg}"
    textColor: "{colors.new}"
    rounded: "{rounded.badge}"
    padding: "0 6px"
    height: "18px"
    typography: "{typography.meta}"
  badge-watch:
    backgroundColor: "{colors.watch-bg}"
    textColor: "{colors.watch}"
    rounded: "{rounded.badge}"
  badge-attn:
    backgroundColor: "{colors.attn-bg}"
    textColor: "{colors.attn}"
    rounded: "{rounded.badge}"
  badge-stable:
    textColor: "{colors.stable}"
  badge-neutral:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink2}"
    rounded: "{rounded.badge}"
  list-row:
    minHeight: "34px"
    padding: "8px 0"
    divider: "{colors.line}"
  widget:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.widget}"
    padding: "12px"
    shadow: "0 1px 3px oklch(0.23 0.012 260 / 0.11)"
  popover:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.widget}"
    width: "400px"
    shadow: "0 6px 20px oklch(0.23 0.012 260 / 0.12)"
  modal:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.sheet}"
    headerHeight: "48px"
    shadow: "0 12px 32px oklch(0.23 0.012 260 / 0.16)"
  generate-prompt:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.sheet}"
    width: "720px"
    shadow: "0 6px 20px oklch(0.23 0.012 260 / 0.12)"
  generate-send:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "50%"
    size: "32px"
  run-chip:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.control}"
    height: "32px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.control}"
    height: "36px"
---

# Design System: IntelMonitor

## 1. Overview

**Creative North Star: "The Briefing Desk"**

IntelMonitor reads like a well-run internal tool: a desk where the morning's answers are already laid out, each stamped with its state and a way back to its sources.
PRODUCT.md sets the tone as "Calm, exact, trustworthy", and the aim is an interface the analyst learns once and stops noticing.
The direction is "Tightened Apple" (`mocks/refine-a.html`): the calm and polish of a current Apple app, sized for a desktop analyst tool rather than a phone.
It should feel modern and exact, never like older enterprise software and never like a consumer widget screen.

The system is light mode only, set in the platform system font, on a cool near-white canvas with near-white surfaces, one blue accent and four status colors that carry meaning and nothing else.
Density is deliberate: 34 px rows of 13 px text with hairline dividers, widget insets of 12 px inside a 16 px grid gap, 32 px page gutters.
Depth is low: one thin shadow under in-page surfaces, and a border plus a soft shadow on anything that floats.
Motion only follows user actions and is off under reduced motion.

Tokens live on `:root` in `web/app/globals.css`, together with the shared controls (`.btn`, `.btn-icon`, `.input`, `.seg`, `.badge`, `.row`, `.kbd`).
Areas reuse those classes instead of restyling their own.

**Key Characteristics:**
- OKLCH colors tinted toward hue 260; no pure white or black anywhere.
- Four radius steps: 4 badge, 6 control, 10 widget and popover, 14 popup and sheet.
- One low shadow on widgets and panels; overlays add a 1 px border.
- Five type sizes (12, 13, 15, 22, 28) and three weights (400, 500, 600).
- Status in a fixed 112 px column of small tinted badges, always with a word.
- One focus ring, one button spec, 44 px hit areas on every control.

## 2. Colors

A restrained palette: cool neutrals, one saturated blue, four status pairs.

### Primary
- **Signal Blue** (`accent`): the one primary button per view, links, the focus ring, the selected state.
- **Pressed Signal Blue** (`accent-strong`): primary hover and pressed.

### Status
- **New** (`new` on `new-bg`): New badges, and a count only when it means "new since your review".
- **Watch** (`watch` on `watch-bg`): Watch badges.
- **Needs attention** (`attn` on `attn-bg`): Needs attention badges and the alert count.
- **Stable** (`stable`): state text with no fill.
- Updated, Changed and Custom are neutral labels: `ink2` on `rail`.

### Neutral
- **Canvas** (`canvas`): page background and the area behind widgets in the popup.
- **Surface** (`surface`): widgets, panels, the drawer, the popup, popovers and inputs.
- **Rail** (`rail`): sidebar, segmented track, neutral badges.
- **Hover** (`hover`): hover fill on nav items, ghost and icon buttons, popover rows.
- **Line** (`line`): row dividers inside a surface.
- **Line strong** (`line-strong`): button, popover and overlay borders, section rules.
- **Line field** (`line-field`): input and select borders.
- **Ink** (`ink`, `ink2`, `ink3`): primary text; labels, meta and counts; icons and placeholders on `surface` only.
- **Mark** (`mark`): the evidence highlight on the quoted span only.
- **On ink** (`on-ink`, `on-ink-link`, `on-ink-hover`): text, the action and the edge on the dark toast.

### Named Rules
**The Status-Only Color Rule.** Color outside the neutrals means status or the one accent. Topic, group, entity and provider colors exist only inside the graph canvas and its legend.
**The Tint Budget Rule.** A status tint may fill a badge. It never fills a tile, row, card or button.
**The One Accent Rule.** Blue stays under 10% of any screen.

## 3. Typography

**Font:** system UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`).
**Character:** one neutral grotesque; hierarchy comes from size between levels and weight within a level.

### Hierarchy
- **Title** (600, 28/34, -0.015em): page title only.
- **Hero** (600, 22/28): the brief's state line on a monitor Overview, and the development popup's title. One per screen; the dashboard has none, so its watchlist and feed lead.
- **Lead** (600, 15/20): monitor section headers, widget answers, popup, drawer and dialog titles.
- **Body** (13/18): 400 for text; 500 for row titles, buttons and nav items; 600 for state words and popover titles.
- **Meta** (12/16): 400 `ink2` for meta and dates; 500 for widget titles, badges, column and group labels.

Row titles clamp at two lines, except feed rows, whose titles wrap in full.
State text wraps before it truncates.
Dates and counts use tabular figures and right-align in lists.
Prose caps at 70ch.

### Named Rules
**The One Hero Rule.** At most one 22 px line per screen: the brief's state line on a monitor page, the title in a development popup. Every other section answers at 15 px.
**The No-700 Rule.** 600 is the heaviest weight.
**The Sentence Case Rule.** Sentence case everywhere, no uppercase labels.

## 4. Elevation

The system is nearly flat.
In-page surfaces separate from the canvas by fill and one thin shadow; floating things add a border so their edge holds on any background.

### Shadow Vocabulary
- **Low** (`--shadow-low`, `0 1px 3px` at 11%): widgets, panels, the current sidebar item.
- **Pop** (`--shadow-pop`, `0 6px 20px` at 12%) with a 1 px `line-strong` border: menus, facet popovers, search results, the toast, the drawer and the lifted drag copy.
- **Modal** (`--shadow-modal`, `0 12px 32px` at 16%) with a 1 px `line-strong` border over `--scrim`: the New dashboard and Edit dashboard popup, the development popup and the profile dialogs.

Selected segments, pressed toggles and page-head buttons have no shadow.

### Named Rules
**The One Float Rule.** A resting surface gets `--shadow-low` at most. Larger shadows are only for things that sit above the page.
**The No Nesting Rule.** No rounded box inside a rounded box. Inside a surface, structure comes from hairline rows and section rules.

## 5. Components

### Buttons (`.btn`)
- **Secondary** (default): 32 px, padding 0 12px, 13/500, `surface` fill, 1 px `line-strong` border, `hover` fill on hover.
- **Primary** (`.btn-primary`): `accent` fill, `surface` text, `accent-strong` on hover. At most one per view.
- **Ghost** (`.btn-ghost`): no fill or border at rest, `hover` on hover.
- **Small** (`.btn-sm`): 28 px, for widget heads, toolbars and popovers.
- **Disabled:** `ink3` text on the normal fill, no hover, never opacity.
- **Hit area:** a 44 px `::after` on every size.

### Icon buttons (`.btn-icon`)
- 28 px ghost square at the control radius, `ink2` glyph, `hover` fill and `ink` glyph on hover, 44 px hit area.
- Close is always the 28 px ghost icon button, never a grey circle.
- Icons draw in `currentColor`; the host sets the color with a token.

### Inputs (`.input`)
- 32 px, `surface` fill, 1 px `line-field` border, control radius, 13 px text, `ink3` placeholder.
- Textareas start at 64 px and resize vertically.
- No borderless grey fills.

### Segmented control (`.seg`)
- 28 px: a `rail` track with 2 px padding; segments 24 px, 12/500 `ink2`.
- The selected segment is `surface` with a 1 px `line-strong` border and `ink` text. No shadow.

### Badges (`.badge` with `.b-new`, `.b-watch`, `.b-attn`, `.b-stable`, `.b-neutral`)
- 18 px tall, padding 0 6px, 4 px radius, 12/500, tinted fill in the status pair.
- Development priority is the one filled badge on a development: High is `.b-attn`, Medium `.b-watch`, Low `.b-neutral` (`components/developments/labels.tsx`).
- New is `.b-new`. Updated is a plain 12/500 word in `new` with no fill (`.upd`), so it never reads as a priority.
- Adverse is the words `Adverse event` in 600 `attn` text, shown only when true, followed by the tone word ("Negative tone"). Unverified on a social post is 600 `watch` text.
- Stable is green text with no fill and no padding.
- Badges sit in the fixed `.stat` column (112 px), left-aligned, so row titles share one left edge.

### List rows (`.row`)
- A grid of the status column, the content and a right-aligned end value (`.row-end`, 12 px tabular).
- 34 px for a one-line row: 8 px above and below 13/18 text, a 1 px `line` rule between rows.
- `.row-title` is 500 and clamps at two lines; `.row-meta` is 12/16 `ink2` under it.
- `.row.no-stat` drops the status column.
- The same grammar serves development, watchlist, question, alert and run rows, the graph In view list and the gallery subject list.
- Feed rows (`.frow`, `components/developments/FeedRow.tsx`) never clamp: the status column holds the priority badge with New or Updated under it, then the full title, one line on who it impacts, a 12 px facts line, and the date with a visible accent "View sources" cue in the end column. The whole row opens the development's popup.
- Feeds group their rows under a heading per priority (`.fgroup`): `High priority 4` at 13/600 `ink` with the count, then on the same line, in 13/400 `ink`, what that priority means, over a 1 px `line-strong` rule. The Overview's top 5 rows carry only their badges, no headings.

### Widgets and panels
- `surface`, 10 px radius, `--shadow-low`, no border, 12 px inset, 16 px grid gap.
- Widget title 12/500 `ink2`, top-left, sentence case; meta right-aligned 12/400.
- Monitor sections share one panel with a 15/600 header, a 1 px `line-strong` rule, and 32 px between sections.
- The monitor Overview (`components/monitor/MonitorView.tsx`): a full-width summary band, the brief on the left (the direction, the 22 px state, concerns led by a bold label) and on the right, past a 1 px `line` rule, the top 3 Key data figures at 15/600, the next date in one line and `Open Data`; under 900 px the right column goes under the brief. Below it the top 5 developments this month, with `See all` to the Developments tab, beside the Related card (the subject's links as a graph), stacking when a column would be under 520 px. The head carries `Ask about <name>` on the right. The Developments tab holds the full feed and its filters. The Related tab (`components/monitor/Related.tsx`), shown only when something links to the subject, holds Could affect (grouped Exposure, Ownership and structure, Dependency), linked institutions and Shared with; the Related card's `See all links` opens it. Development titles inside running text are ink links with a quiet `line-field` underline (`.tlink`), not accent blue; source titles in evidence lines are ink2 and underlined.

### Dashboard (`components/dashboard/DashboardView.tsx`)
- One fixed layout: the page head (title, its subjects, `Edit dashboard`), then the Watchlist panel, a table of entity, new High count, the top development this month in full with its priority badge, and date, busiest first: up to 3 entities with news this month (4 when that is all), then `Show all N entities`, so the feed starts above the fold; then the feed panel beside a 300 px Upcoming dates panel, which drops below under 1100 px. Each upcoming date's label links to its development, with the development's title under it in 12 px `ink2`, since labels such as "Applications close" need it.
- The feed head carries the new count in `new` 600 ("48 new since 1 Oct") as its right-aligned meta; 15 rows, then `Show all N` to the developments list.
- No widget grid, sizes, edit mode or Add widget.

### Sidebar
- Dashboards, each with "28 new" in `ink3` (unread developments new since the last visit), then Entities with each group as a collapsible heading and its member count, then Topics. No Groups section.
- Names wrap in full; the icon and any count stay on the first line. A new High development shows "1 High" in 500 `attn`; other counts are `ink3`.

### Top bar
- 56 px, with the search field flexing from the left: 32 px, bordered, `ink3` placeholder, ⌘K as a `.kbd`.
- "Updated 8 Oct" at the right in 12 px `ink2`: the date of the latest news covered, the one date the app shows for freshness.

### Modal surfaces (`components/ui/Modal.tsx`)
- 14 px radius, 1 px `line-strong` border, `--shadow-modal`, `--scrim` backdrop.
- 48 px header (`.sheet-head`) with a 15/600 title and the 28 px ghost close.
- The New dashboard and Edit dashboard popup and the development popup cover about 80% of the screen; profile dialogs are 560 px.
- Tab and Shift+Tab wrap inside a modal; focus returns to the opener on close.

### Development popup and evidence drawer
- A development opens in a popup over the current page (`?development=<id>&scope=...`, `components/developments/DevelopmentPopup.tsx`), the New dashboard popup's size. No Back button: the 28 px close, Esc and a backdrop click return to the page underneath with its URL and scroll.
- The header: the labels line, the title at 22 px, Not relevant and Dismiss, the close at the top right, over a 1 px `line` rule.
- Below, two equal columns split by a `line` rule, each scrolling inside the popup: "Who it impacts" over "Connections" (the claim lines and the graph snippet) on the left; the sources down the right. Under 1024 px the popup fills the screen less 16 px and the columns stack.
- Sources sit under two tabs at the top of their column, News (news, official and research) and Social, underlined like the monitor tabs and pinned while the column scrolls.
- The answer drawer is square, 520 px, 1 px `line-strong` left border plus `--shadow-pop`.
- Sources are blocks separated by `line` rules, not grey cards; the quoted span gets `mark`.

### Onboarding and the subject picker (`components/shell/Setup.tsx`, `components/dashboard/EntityPicker.tsx`)
- `/setup` is a page of its own, without the sidebar: a 56 px bar with the product name, `Step 1 of 2` and, when a role is already active (Add a role), a small secondary `Cancel`; then the step.
- Step 1: the page head, then plain role rows split by hairlines, each a link with a chevron (no raised card on any row), then `Preloaded for your department` at 15/600 with the same rows.
- Step 2: the picker beside a 400 px preview panel (stacked under 900 px), and a sticky footer with a secondary Back, the name, the count and the one primary button. The preview's feed rows are not links, and the panel scrolls inside itself when taller than the screen. Under 700 px the footer wraps, the name on its own line.
- The picker: a 15/600 heading per group over a 1 px `line-strong` rule, `n of m` and an accent `Add all` or `Remove all`, rows in two columns split by `line`, the 30-day count right-aligned in 12 px `ink2` with only the word High in `attn`, zero in `ink3`. Groups outside the role's suggestion sit under `More to add` as rows with a chevron.
- The New dashboard popup shows the same picker on `surface`, every group open.

### Toast (`components/ui/Toast.tsx`)
- `ink` fill with `on-ink` text, 36 px, control radius, 1 px `on-ink-hover` edge, `--shadow-pop`.
- Anchored bottom-left of the content column, 24 px from the bottom; the action is `on-ink-link`, 600.

### Focus
- One ring everywhere: `outline: 2px solid var(--accent); outline-offset: 2px`, following the element's radius.
- No box-shadow halos.

## 6. Do's and Don'ts

### Do:
- **Do** reuse the shared classes in `globals.css` before writing a new control.
- **Do** reference tokens; no hex, rgb or literal OKLCH in area stylesheets or components.
- **Do** separate content inside a surface with hairline rows and section rules.
- **Do** keep status in the fixed 112 px column, with a word in every badge.
- **Do** step radius down or hold it when nesting: sheet 14, widget 10, control 6, badge 4.
- **Do** give every control a 44 px hit area and the one focus ring.
- **Do** keep motion to user-triggered transitions and switch it off under reduced motion.

### Don't:
- **Don't** use pills, grey circle buttons or radii above 14 px.
- **Don't** stack shadows on resting surfaces or float every region in its own box.
- **Don't** fill tiles, rows or buttons with status tints, or use color that means neither status nor the accent.
- **Don't** use more than one primary button in a view.
- **Don't** add side-stripe borders, gradient text, glass or blur effects.
- **Don't** add continuously running motion: no spinners, pulse or shimmer, including in loading states.
- **Don't** repeat the AlphaSense failure: "dated, blank grid to start, feeds the analyst must read".
