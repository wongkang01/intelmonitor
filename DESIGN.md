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
- **Hero** (600, 22/28): the "Since your last review" lead line, and nothing else.
- **Lead** (600, 15/20): monitor section headers, widget answers, popup, drawer and dialog titles.
- **Body** (13/18): 400 for text; 500 for row titles, buttons and nav items; 600 for state words and popover titles.
- **Meta** (12/16): 400 `ink2` for meta and dates; 500 for widget titles, badges, column and group labels.

Row titles clamp at two lines.
State text wraps before it truncates.
Dates and counts use tabular figures and right-align in lists.
Prose caps at 70ch.

### Named Rules
**The One Hero Rule.** Only Since gets 22 px. Every other widget answers at 15 px.
**The No-700 Rule.** 600 is the heaviest weight.
**The Sentence Case Rule.** Sentence case everywhere, no uppercase labels.

## 4. Elevation

The system is nearly flat.
In-page surfaces separate from the canvas by fill and one thin shadow; floating things add a border so their edge holds on any background.

### Shadow Vocabulary
- **Low** (`--shadow-low`, `0 1px 3px` at 11%): widgets, panels, the current sidebar item.
- **Pop** (`--shadow-pop`, `0 6px 20px` at 12%) with a 1 px `line-strong` border: menus, the runs and alerts popovers, search results, the toast, the drawer, the lifted drag copy, and the floating Generate prompt.
- **Modal** (`--shadow-modal`, `0 12px 32px` at 16%) with a 1 px `line-strong` border over `--scrim`: the popup, the Add widget sheet and the profile dialogs.

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
- `.btn-icon.lg`: 32 px with the secondary border, widening to fit a count badge (the top bar bell).
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
- Stable is green text with no fill and no padding.
- Badges sit in the fixed `.stat` column (112 px), left-aligned, so row titles share one left edge.

### List rows (`.row`)
- A grid of the status column, the content and a right-aligned end value (`.row-end`, 12 px tabular).
- 34 px for a one-line row: 8 px above and below 13/18 text, a 1 px `line` rule between rows.
- `.row-title` is 500 and clamps at two lines; `.row-meta` is 12/16 `ink2` under it.
- `.row.no-stat` drops the status column.
- The same grammar serves development, watchlist, question, alert and run rows, the graph In view list and the gallery subject list.

### Widgets and panels
- `surface`, 10 px radius, `--shadow-low`, no border, 12 px inset, 16 px grid gap.
- Widget title 12/500 `ink2`, top-left, sentence case; meta right-aligned 12/400.
- Monitor sections share one panel with a 15/600 header, a 1 px `line-strong` rule, and 32 px between sections.

### Top bar
- 56 px, with the search field flexing from the left: 32 px, bordered, `ink3` placeholder, ⌘K as a `.kbd`.
- Run status chip: 32 px, 1 px `line-strong` border, control radius, a static 6 px `stable` dot or a static half-filled `new` mark while running, a fixed minimum width. No spinner, pulse or halo.
- Alerts: `.btn-icon.lg` with the bell and an unread count badge inside it.
- Popovers: 400 px, 10 px radius, 44 px head, 48 px footer, rows in the list-row grammar.

### Modal surfaces (`components/ui/Modal.tsx`)
- 14 px radius, 1 px `line-strong` border, `--shadow-modal`, `--scrim` backdrop.
- 48 px header (`.sheet-head`) with a 15/600 title and the 28 px ghost close.
- The New dashboard popup and the Add widget sheet cover about 80% of the screen; profile dialogs are 560 px.

### Generate prompt (the one floating input)
- The New dashboard Generate tab keeps a floating prompt box instead of a docked field, because it is the page's single call to action.
- 720 px wide, `surface`, 1 px `line-strong` ring plus `--shadow-pop`, 14 px radius (the sheet step, not a pill).
- A round 32 px `accent` send button with a `surface` arrow; disabled shows `ink3` on `rail`.
- On first open it is centered with the heading and three example prompts as plain text rows.
- On the first send it slides to the bottom and stays floating there with the same treatment; under reduced motion it moves without animating.

### Evidence drawer
- Square, 520 px, 1 px `line-strong` left border plus `--shadow-pop`.
- Sources are blocks separated by `line` rules, not grey cards; the quoted span gets `mark`.

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
- **Don't** add continuously running motion: no spinners, pulse or shimmer, including in the run chip.
- **Don't** repeat the AlphaSense failure: "dated, blank grid to start, feeds the analyst must read".
