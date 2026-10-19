# Development popup

A development opens in a popup over the page it was opened from, the size of the New dashboard popup (80% of the screen, at least 900 px wide).
The URL carries it: `?development=<id>&scope=subject:<id>` or `&scope=dashboard:<id>` on the current page's URL, the scope naming the subjects in view whose priority it shows.
The header holds the labels line (the priority badge for the subjects in view, with `For OCBC` when the subjects disagree, `Adverse event` when it applies, the tone, the source types as a jump link to the sources, the category and the date or date span), the full title (heading level 2, focused on open), `Not relevant` and `Dismiss`, and the close button (`Close development`). There is no Back button.
Below, two columns that each scroll inside the popup: on the left `Who it impacts` over `Connections`; on the right the sources, with the `News N` and `Social N` tabs at the top.
`Who it impacts` lists the subjects it is about (priority, adverse, tone, `Took the action` for actors), then `Could also be affected, through their links`: each entity with its route in plain words, `Could hurt`, `Could help` or `Mixed effect`, why, and one evidence line per stored link (`Public disclosure` or `Press report` with a hover definition, the source with page as a link, the size or `Size not disclosed`, `Figures as of` or `Source dated` with `over N years old` when it is three years or more, and `Link last checked`).
`Connections` has one claim line per route and a graph snippet: `This news`, the thing it is about, any company in between, and each entity, edges labelled (`44.4% of loans`, `cloud services`, `takes part`). Without indirect impacts it says `No stored link carries this news to another tracked entity.`
`News` holds news, official and research sources (and a detector's series); `Social` holds posts. Each source keeps its highlighted excerpts. Social posts read `Social, X` or `Social, forum`, then `Unverified`, or `Confirmed by news` when a news or official source is in the same development; the Social tab says `Posts came 40 min before the first news report.` when posts came first (date-only news compares by day).
Close, Esc and a backdrop click return to the page underneath with its URL, filters and scroll, and focus returns to the link that opened it. Opening it marks the development read.
Under 1024 px the popup fills the screen less 16 px and the columns stack in one scroll (the app shell itself has a 1024 px minimum).

## Sub-features

- `dp-open`: every development link (feed rows, top developments, Upcoming dates, Could affect, linked institutions, the dashboard's watchlist and upcoming dates, ⌘K results, the Data tab's indicator rows and note cites, the graph, the answer drawer) opens the popup over the current page with that page's scope.
- `dp-close`: the close button, Esc and a backdrop click go back to the history entry underneath (same URL and scroll); browser Back does the same and Forward reopens it; on a fresh load of a popup URL, closing drops the parameters and stays on the page.
- `dp-focus`: the title has focus on open, Tab and Shift+Tab wrap inside the popup, and focus returns to the opener on close (the search field for a ⌘K result).
- `dp-priority`: the priority shown is for the subjects in view, not the highest over every subject.
- `dp-who`: direct subjects, then indirect impacts with route, direction, why and evidence.
- `dp-graph`: `Connections`, its claim lines and the snippet; a plain line without indirect impacts.
- `dp-sources`: News and Social tabs (arrow keys switch), highlighted excerpts, Unverified or Confirmed by news, the lead-time line; the tabs stay at the top as the column scrolls.
- `dp-triage`: `Not relevant` (dismisses too, stored for the eval set) and `Dismiss`, each with a toast inside the popup and Undo; a dismissed development shows `Restore to feed`.
- `dp-read`: opening marks it read.
- `dp-legacy`: `/developments/<id>?dashboard=<id>` redirects to `/dashboards/<id>?development=<id>&scope=dashboard:<id>`, `?subject=<id>` to that monitor page, and no scope to the default dashboard; an old `?evidence=<id>` link on any page opens the popup there.
- `dp-error`: an unknown id shows `This development could not be loaded. It may have left the latest update.` with the close button.

## How to get to it (user POV)

- A feed row on the developments page, a monitor page's Developments tab or its Overview's top 5 (see [developments](developments.md)); on the Overview also the summary band's `Next:` date and a Related card popover row (the brief itself links no developments); on the Related tab a `Could affect` title and a linked institution's week line (see [monitor-page](monitor-page.md)).
- A dashboard's feed row, watchlist title or upcoming date label (see [dashboard](dashboard.md)).
- The Data tab's `View the development` rows and note cites, a graph development node, ⌘K development and document results, the answer drawer's development titles.

## Driving it with verify

Preconditions:

- `ab` means `agent-browser --session im-verify`; `@ref` is the ref `ab snapshot -i` prints.
- `pnpm -C web verify open development <id> [dashboard]` opens the popup over that dashboard (or the default one).
- Find a development with indirect impacts: `pnpm -C web verify api "/developments?dashboard_id=<id>&days=30"` and pick a row whose `also_affects` is not empty; one with social sources has `source_types` with `social`.
- Not relevant and Dismiss write to the live store; use the toast's Undo at once and read the state back with `pnpm -C web verify api /developments/<id>` (`triage`).

- **Open from the feed.** On the developments page, scroll down and click a row's title link. The URL gains `development=<id>&scope=dashboard%3A<id>`, `dialog "<title>"` shows with heading level 2 focused and `Close development`; no Back button.
- **Size.** `ab eval '(() => document.querySelector("dialog.dp-pop").getBoundingClientRect().width)()'` is 80% of the window (1152 at 1440, 900 at 1024).
- **Priority for the scope.** Compare `pnpm -C web verify api "/developments/<id>?subject_id=<a>"` and `?subject_id=<b>` for a development whose `direct_subjects` disagree; the popup opened from each monitor page shows that subject's priority and `For <name>`.
- **Who it impacts.** `ab snapshot` shows heading `Who it impacts`, `This development is about`, `Could also be affected, through their links`, each entity link, route and direction word. `ab get text ".imp-ev"` shows the evidence lines.
- **Connections.** `ab snapshot -c` shows heading `Connections` and `image "<claim>."`; `ab get count ".snippet .n.ent"` equals the number of impact rows.
- **Sources tabs.** Click tab `Social N`: the panel lists posts with `Unverified` or `Confirmed by news`; ArrowLeft returns to `News`. `ab get text ".source blockquote mark"` equals the API's highlight text.
- **Close.** Note `main.main`'s `scrollTop`, open a row, press Escape: the feed's URL comes back exactly, `scrollTop` is unchanged and the row's link has focus. Reopen and click the close button, then the backdrop: same. Reopen and use `ab back`: same; `ab forward` reopens it. Open a popup URL fresh and click the close button: the parameters go and the page stays.
- **Dismiss and Undo.** Click `Dismiss`: toast `Dismissed. Undo` inside the popup, the header shows `Dismissed.` and `Restore to feed`; the API's `triage.dismissed` is true. Click `Undo`: back to false. `Not relevant` the same, with `not_relevant` and `dismissed` both set and cleared.
- **Read.** Before opening, the list API shows `read: false`; after, `read: true`. Mark it unread with `pnpm -C web verify api PATCH /developments/<id>/triage '{"read": false}'` to leave no trace.
- **Legacy links.** `ab open <web>/developments/<id>?dashboard=<id>`: the URL becomes `/dashboards/<id>?development=<id>&scope=dashboard%3A<id>` with the popup open. `/monitors/dbs?evidence=<id>` becomes `/monitors/dbs?development=<id>&scope=subject%3Adbs`.
- **Proof.** `pnpm -C web verify record start <run>/<name>` before the first click, `record stop` at the end state.

## Gotchas

- The popup marks the development read when it loads, so take any "unread" readout before opening it.
- The passage and `<mark>` are not in `snapshot -i` text; read them with `ab get text`.
- A title link that wraps onto two lines can have its centre in the gap between them, so `ab click` on it lands on the list item; focus it and press Enter instead.
- `scope` is URL-encoded in the address bar (`scope=subject%3Adbs`).
