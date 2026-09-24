---
name: IntelMonitor
description: Pre-answered standing questions for supervisory analysts, every claim linked to its sources.
colors:
  accent: "#0a64d8"
  accent-hover: "#0850ae"
  canvas: "#f5f5f7"
  surface: "#ffffff"
  sidebar: "#ececf0"
  sidebar-rule: "#dcdce2"
  ink: "#1c1c1e"
  ink-secondary: "#5b5b63"
  ink-tertiary: "#6e6e76"
  hairline: "#efeff3"
  field: "#e8e8ed"
  field-soft: "#f2f2f5"
  chip: "#f0f0f3"
  hover-grey: "#e2e2e8"
  active-grey: "#dcdce3"
  new: "#0a56bc"
  new-bg: "#e6f0fd"
  watch: "#8a4b00"
  watch-bg: "#fff4e2"
  attention: "#b3261e"
  attention-bg: "#fdecea"
  stable: "#1f6f43"
  topic: "#6b4fd8"
  topic-ink: "#5236b8"
  topic-bg: "#efebfc"
  provider: "#0e7c7b"
  entity: "#3a3a40"
  highlight: "#fff1b8"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "38px"
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "30px"
    letterSpacing: "-0.018em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: "22px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
rounded:
  mark: "3px"
  badge: "6px"
  icon-tile: "8px"
  nav: "9px"
  control: "12px"
  popover: "14px"
  inset-card: "16px"
  preview: "18px"
  widget: "22px"
  generate-card: "24px"
  sheet: "28px"
  pill: "9999px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  sm-plus: "10px"
  md: "12px"
  md-plus: "14px"
  lg: "16px"
  widget-y: "18px"
  xl: "20px"
  xxl: "24px"
  page: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.widget}"
    padding: "0 20px"
    height: "44px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.ink}"
    rounded: "{rounded.widget}"
    padding: "0 20px"
    height: "44px"
  button-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  badge-new:
    backgroundColor: "{colors.new-bg}"
    textColor: "{colors.new}"
    rounded: "{rounded.badge}"
    padding: "3px 8px"
    typography: "{typography.label}"
  badge-watch:
    backgroundColor: "{colors.watch-bg}"
    textColor: "{colors.watch}"
    rounded: "{rounded.badge}"
    padding: "3px 8px"
  badge-attention:
    backgroundColor: "{colors.attention-bg}"
    textColor: "{colors.attention}"
    rounded: "{rounded.badge}"
    padding: "3px 8px"
  badge-stable:
    textColor: "{colors.stable}"
    padding: "3px 0"
  tag-topic:
    backgroundColor: "{colors.topic-bg}"
    textColor: "{colors.topic-ink}"
    rounded: "{rounded.badge}"
    padding: "2px 7px"
  widget-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.widget}"
    padding: "18px 20px"
  question-tile:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  search-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px 0 14px"
    height: "42px"
    width: "560px"
  nav-item:
    textColor: "{colors.ink}"
    rounded: "{rounded.nav}"
    padding: "0 10px"
    height: "36px"
  nav-item-hover:
    backgroundColor: "{colors.hover-grey}"
  nav-item-active:
    backgroundColor: "{colors.active-grey}"
  generate-prompt:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.widget}"
    padding: "10px 10px 10px 18px"
    width: "720px"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sheet}"
  evidence-source:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.inset-card}"
    padding: "14px 16px"
---

# Design System: IntelMonitor

## 1. Overview

**Creative North Star: "The Briefing Desk"**

IntelMonitor should read like a well-run internal tool: a desk where the morning's answers are already laid out, each one stamped with its state and a way back to its sources.
PRODUCT.md sets the tone as "Calm, exact, trustworthy", and the intent is that an analyst "learns once and stops noticing" the interface.
The system is light mode only, set in the platform system font (SF on Apple hardware), on a cool grey canvas with white surfaces, one blue accent and four status colors that carry meaning and nothing else.

What the code actually ships today leans further toward consumer softness than PRODUCT.md allows.
The spec in ui-ux.md calls itself "Apple-inspired, not an Apple copy", and the implementation took the Apple half literally: 22 px widget corners, 28 px sheets, fully rounded 40 to 44 px buttons, a two-layer floating shadow on every widget, and tinted rounded boxes nested inside rounded cards.
That combination is the main source of the "AI slop" feel the user reported.
Every region is its own soft floating tile with the same radius, the same shadow and roughly the same padding, which is exactly the "every element in its own rounded box" and "uniform padding everywhere" anti-reference in PRODUCT.md.
This document records the current tokens faithfully so they can be revised, and the Do's and Don'ts state where the system should go.

Density is moderate: a four-column grid of 170 px rows with 20 px gutters and 36 px page margins, 14 px body text, 12 to 13 px meta.
Motion only follows user actions (sheet and drawer slides at 0.24 to 0.26 s, a 0.28 s rise for new widgets, a 0.3 s shadow fade) and all of it is off under reduced motion.

Uncertainty: the North Star name, the descriptive color names and the reading of the shadow as "ambient float" are my own wording, written without a user to confirm them.
Radius, shadow and spacing values are extracted verbatim; the scale names in the frontmatter (`nav`, `control`, `preview` and so on) are labels I assigned to the values in use, since the code has no radius or spacing tokens at all.

**Key Characteristics:**
- Cool grey canvas (`canvas`), white widgets, grey sidebar with a single hairline rule.
- One accent blue for actions, links and focus; status colors only on badges and state text.
- System font, weights 600 and 700 for nearly everything above body; 12 distinct font sizes in use.
- Large, soft corners (22 px widgets, 28 px sheets, pill buttons) and an ambient two-layer shadow on every widget.
- No design tokens for radius, spacing, type or focus; values are literals repeated per selector.

## 2. Colors

A restrained palette of cool neutrals, one saturated blue, and four paired status tints.

### Primary
- **Signal Blue** (accent): primary buttons, links, the brand tile, the "changed" ring around a widget, focus rings (at 35 to 45 percent alpha), and the Generate prompt's focus ring.
- **Pressed Signal Blue** (accent-hover): hover state of primary buttons only.

### Secondary
- **Analyst Violet** (topic, with topic-ink for text and topic-bg for tint): topic tags, topic dots in the sidebar, the AI sparkle, the `.ai` avatar tile, and the current stop on the monitor stage track.
  It is a second accent in practice, which conflicts with ui-ux.md's "one accent".
- **Provider Teal** (provider): graph only, provider nodes and links.

### Status
- **Dispatch Blue on Ice** (new on new-bg): New badges and "5 new" counts.
- **Amber Ledger on Cream** (watch on watch-bg): Watch badges and tinted Watch question tiles.
- **Alarm Red on Blush** (attention on attention-bg): Needs attention badges and tiles.
- **Settled Green** (stable): Stable state text, deliberately with no tint behind it.

### Neutral
- **Morning Grey** (canvas): page background, and reused as the fill of question tiles, evidence sources and gallery previews inside white cards.
- **Paper White** (surface): widgets, sheets, drawers, menus.
- **Rail Grey** (sidebar) with **Rail Rule** (sidebar-rule): the navigation column and its 1 px right border.
- **Near Black** (ink): primary text, toast background.
- **Slate** (ink-secondary): labels, meta lines, section heads.
- **Pewter** (ink-tertiary): declared as a token but only used as hard-coded hex inside SVG icons.
- **Hairline** (hairline): 1 px row dividers inside widgets.
- **Field Grey** (field, field-soft, chip): search field, inline add fields, secondary button fill.
- **Hover Grey / Active Grey** (hover-grey, active-grey): sidebar item hover and current page; these are literals in shell.css, not tokens.
- **Entity Graphite** (entity): entity tags, avatar fill, graph entity nodes.
- **Source Highlight** (highlight): `mark` in evidence excerpts.

### Named Rules
**The Status-Only Color Rule.** Color outside the neutrals means status (New, Watch, Needs attention, Stable) or an action. A color that means neither is prohibited.
**The Tint Budget Rule.** A status tint may fill a badge. It may not fill a whole tile, row or card; the standing-questions grid currently breaks this.

## 3. Typography

**Display Font:** system UI stack (-apple-system, SF Pro Text, with Helvetica Neue, Arial fallback)
**Body Font:** same stack
**Label/Mono Font:** none; `kbd` uses the same stack.

**Character:** one neutral grotesque carrying all hierarchy through size and weight, tightened with small negative tracking at large sizes.

### Hierarchy
- **Display** (700, 32 px, 38 px line, -0.022em): page title only.
- **Headline** (600, 24 px, 30 px line, -0.018em): widget hero answer, for example "79 new, 9 need attention". The `.big` stat is 700 at 26 px.
- **Title** (700, 17 to 20 px): sheet and panel headings (20 px sheet, 17 px drawer and panel, 18 px gallery and drawer section).
- **Body** (400 to 600, 14 px, 20 px line): row titles at 600, everything else at 400. Form inputs step up to 15 px, the Generate prompt to 16 px.
- **Label** (600, 12 px): widget section heads, badges, question tile labels, sidebar section heads. Tags drop to 11 px.

Sizes in use: 11, 12, 13, 14, 15, 16, 17, 18, 20, 24, 26, 32 px, twelve steps with no ratio behind them.
Weights in use: 400 (3 rules), 600 (37 rules), 700 (9 rules).

### Named Rules
**The Two-Weight Rule.** Body is 400, emphasis is 600, and 700 is reserved for the page title. Bold headings at 17 to 20 px in sheets compete with the page title and should drop to 600.
**The Sentence Case Rule.** Sentence case everywhere, no uppercase labels, no tracking-widened eyebrows.

## 4. Elevation

The system is lifted, not flat.
Every widget floats on an ambient two-layer shadow over the grey canvas, with no border; popovers and drawers use a heavier two-layer shadow; modals use a third, heavier single-layer shadow.
Depth is therefore the main way surfaces are separated, which is what makes the grid read as a field of floating tiles.

### Shadow Vocabulary
- **Resting float** (`box-shadow: 0 1px 2px rgba(18,22,38,0.05), 0 8px 24px rgba(18,22,38,0.05)`): every widget and monitor panel (`--shadow`).
- **Pop** (`box-shadow: 0 2px 6px rgba(18,22,38,0.08), 0 16px 40px rgba(18,22,38,0.14)`): menus, search results, toast, drawer, a widget being dragged (`--shadow-pop`).
- **Modal** (`box-shadow: 0 24px 80px rgba(18,22,38,0.28)`): dialog sheets and panels.
- **Generate card** (`box-shadow: 0 16px 60px rgba(18,22,38,0.24)`): the New dashboard Generate surface; a one-off.
- **Prompt float** (`box-shadow: 0 0 0 1px #e3e3e8, 0 8px 28px rgba(18,22,38,0.08)`): the Generate input; a one-off.
- **Button nudge** (`box-shadow: 0 1px 2px rgba(18,22,38,0.08)`): white header pill buttons.
- **Selected segment** (`box-shadow: 0 1px 3px rgba(18,22,38,0.12)`): selected segmented control and graph filter chip.
- **Changed ring** (`box-shadow: 0 0 0 2px accent, resting float`): a widget whose answer changed.
- **Focus ring** (`box-shadow: 0 0 0 3px rgba(10,100,216,0.35)` on fields, `outline: 3px solid rgba(10,100,216,0.45)` with 2 px offset elsewhere): two treatments for the same job.

### Named Rules
**The One Float Rule.** Resting surfaces get at most one shadow token, and it must be quieter than it is today; a 1 px hairline border is the preferred separator on a dashboard. Shadows grow only for things that genuinely sit above the page (menus, drawers, dialogs).
**The Squint Test.** If the dashboard at arm's length looks like a tray of floating tiles, the resting shadow is doing the layout's job and must be reduced.

## 5. Components

### Buttons
Soft, fully rounded, Apple-sheet style.
- **Shape:** fully rounded pills; radius is set to half the height by hand (22 px on 44 px, 20 px on 40 px, 17 px on 34 px suggestion chips, 16 px on 32 px icon buttons).
- **Primary:** accent fill, white 14 px 600 text, 44 px tall, 20 px side padding; hover goes to accent-hover.
- **Secondary:** chip grey fill, ink text, same shape.
- **Header pill:** white fill, accent text, 40 px, button nudge shadow ("Add widget", "Edit").
- **Small:** 34 px, 16 px padding, 13 px text.
- **Disabled:** 40 percent opacity.
- **Focus:** 3 px accent outline at 45 percent alpha, 2 px offset.

### Badges and Tags
- **Status badge:** 12 px 600 text, 3 px by 8 px padding, 6 px radius, tinted background in the status pair. Stable has no tint and no side padding.
- **Tag:** 11 px 600, 2 px by 7 px, 6 px radius; topic tags violet, group tags blue, entity and custom tags graphite.
- **Keyboard chip:** 6 px radius, field grey.

### Cards / Containers
- **Widget:** white, 22 px radius, resting float shadow, no border, 18 px by 20 px padding, 10 px internal gap. Sizes S (1 col), M (2 col), L (2 by 2) on a 4-column grid of 170 px rows, 20 px gutters.
- **Nested tiles:** question tiles (canvas fill, 12 px radius), evidence sources (canvas fill, 16 px radius), gallery previews (canvas fill, 18 px radius). Each nests a rounded grey box inside a rounded white one.
- **Rows:** list rows inside widgets separated by 1 px hairlines with 10 px vertical padding; this is the calmest pattern in the system.

### Inputs / Fields
- **Search:** 560 by 42 px, field grey fill, 12 px radius, no border; focus adds a 3 px blue ring.
- **Form fields and selects:** 12 px radius, 15 px text; graph and widget-settings selects use 9 px.
- **Inline add field:** 10 px radius, field fill, same focus ring.
- **Generate prompt:** 720 px wide, white, 22 px radius, 1 px grey ring plus float shadow; focus swaps the ring for 2 px accent. The send button is a 40 px circle.

### Navigation
- **Sidebar:** 248 px, rail grey, 1 px right rule, 20 by 14 px padding, 22 px between sections.
- **Nav item:** 36 px tall, 9 px radius, 10 px side padding, 14 px ink text with a 16 px line icon; hover hover-grey, current page active-grey (no accent, no weight change).
- **Section heads:** 12 px 600 slate.
- **Brand:** 16 px 700 wordmark beside a 28 px accent tile with 8 px radius.
- **Top bar:** 72 px, search field left-aligned at the 36 px page margin.

### Sheets, Drawers and Menus
- **Sheet:** 80 by 80 vw/vh, 28 px radius, modal shadow, 0.24 s rise.
- **Panel dialog:** 560 px, 22 px radius.
- **Drawer (evidence, notes):** 520 px from the right, square, pop shadow, 0.26 s slide.
- **Menu and search list:** 14 px radius, pop shadow; menu items 9 px radius.
- **Toast:** near-black, 14 px radius, bottom-centre.

### Stage Track (signature)
The monitor page's horizontal track of stops with round knobs; the current knob gets a 4 px violet halo, stops are 12 px-radius hover targets.

### Graph (signature)
sigma.js canvas with node color by type (topic violet, group blue, entity graphite, provider teal) and a blue ring for new developments; filter chips are 9 px-radius segmented pills.

## 6. Do's and Don'ts

### Do:
- **Do** keep color for status and action only: accent for actions and focus, the four status pairs for New, Watch, Needs attention and Stable, words on every badge.
- **Do** collapse the radius scale to three steps: small (4 to 6 px) for badges, tags and inline controls, medium (8 to 10 px) for widgets, fields and menus, and 12 px at most for sheets.
- **Do** separate widgets with a 1 px hairline (hairline or sidebar-rule) or a much quieter single shadow, not the current two-layer float.
- **Do** use hairline-divided rows for lists inside widgets, the pattern already used for developments and the watchlist, instead of nested tinted tiles.
- **Do** put radius, spacing, type size and focus ring into `:root` tokens and reference them; today only color and two shadows are tokens.
- **Do** keep one focus ring: 3 px accent at a single alpha, applied the same way on fields and buttons.
- **Do** snap spacing to the 8 px base in ui-ux.md (4, 8, 12, 16, 20, 24, 36), and vary padding by role so the hero widget and a small widget do not share one rhythm.

### Don't:
- **Don't** use "oversized corner radii, floating glassy panels, playful motion" (PRODUCT.md, consumer app softness). 22 px widgets, 24 px Generate card and 28 px sheets are in this category.
- **Don't** put "every element in its own rounded box" or use "uniform padding everywhere" (PRODUCT.md, anything that looks generated). A rounded grey tile inside a rounded white card inside a grey canvas is the pattern to remove.
- **Don't** use "hero metrics, identical card grids, gradient accents, pill chrome" (PRODUCT.md, SaaS dashboard templates). Fully rounded header buttons and suggestion chips are pill chrome.
- **Don't** repeat the AlphaSense failure: "dated, blank grid to start, feeds the analyst must read".
- **Don't** fill whole tiles with status tints; a Watch tile in cream beside a Needs attention tile in blush turns status into decoration.
- **Don't** add decorative icons; the AI sparkle and violet `.ai` tile are the only decorative marks and should justify themselves or go.
- **Don't** hard-code hex in components or icons; SVGs in `components/ui/icons.tsx` and `GraphCanvas.tsx` repeat token values as literals.
- **Don't** add continuously running motion (pulse, shimmer, spinners); motion follows a user action or does not happen.
