# Graph

The graph view draws one subject's neighbourhood on a canvas and lists the same nodes beside it.
It opens at 1 hop with every node and link type over all time, and it can expand to 2 hops or filter by node type, link type and how recent developments are.
Nodes new or updated this run carry a ring on the canvas and `New:` in the list.
Clicking a subject node opens its monitor page; clicking a development opens its evidence over the graph.
Each development is coloured by its Jev theme and pulled into that theme's sector, labelled on the canvas; sectors sit clockwise from the top in the order Regulation, Digital assets, Technology and AI, Strategy, Earnings and markets, Macro and geopolitics.
The layout animates until it settles, then the camera fits the graph.
Dragging a node carries it and its neighbours; on release it floats back and the layout settles again.

## Sub-features

- `head` `heading [level=1]` with the subject name, `link "Open monitor page"`.
- `hops` `group "Hops"`: `button "1 hop"`, `button "2 hops"`.
- `nodes-filter` `button "Nodes: All"` opens `group "Nodes shown"` with `checkbox "Topics"`, `"Groups"`, `"Entities"`, `"Developments"`; the last checked box is disabled; the button summarises (`Nodes: 3 of 4`, `Nodes: Topics, Groups`). Escape or an outside click closes it.
- `links-filter` `button "Links: All"` opens `group "Links shown"` with `checkbox "Member of"`, `"Exposed to"`, `"Affects"`.
- `window` `group "Developments from"`: `All time`, `7 days`, `14 days`, `30 days`.
- `canvas` `[data-testid=graph-canvas]`, `image "Graph of <n> nodes and <m> links around <Subject>"`, `data-layout` `running` or `settled`, `data-hovered=<node id>` under the pointer, `data-dragging=<node id>` while a node is dragged (the layout reads `running` until it cools); `button "Fit graph to view"`.
- `regions` the theme labels over the canvas, `.graph-regions [data-region=<theme>]`, one per theme in view.
- `legend` the node types in view other than themed developments, `New or updated this run`, and `<n> lower-priority developments not shown` when the API truncated.
- `in-view` `region "In view"` (`[data-testid=graph-nodes]`): `<n> nodes, <k> new`, H3s `<Type>, <h> hop(s) <count>`, with developments under their theme instead (`Digital assets, 1 hop 7`), one link per node (`[data-node=<id>]`, developments `dev:<id>`), `New: ` prefix and `Needs attention` badge. Hovering a row highlights its node and neighbours on the canvas.
- `open` subject node or row: `/monitors/<id>`; development node or row: `?evidence=<id>` over the graph.

## How to get to it (user POV)

- A monitor page's `region "Links"`, `link "Open graph view"` (e2e step 9).
- Direct URL `/monitors/<id>/graph`.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).
- Node counts come from `verify api "/graph?center=<id>&hops=1"` (`nodes`, `edges`, `truncated_developments`, `has_new`).
  On 30 Sep: `ocbc` has 27 nodes at 1 hop and 51 at 2 hops with no truncation (small and readable); `central-banks` has 49 at 1 hop with 117 developments truncated; `bangkok-bank` has 5 at 1 hop (sparse); `banking-regulation` has 44 at 1 hop with 119 truncated.
- Read only: nothing here writes to the store.

- **Open from the monitor page.** `pnpm -C web verify open monitor OCBC`, `S snapshot -i`, `S click @<link "Open graph view">`, `S wait '[data-testid=graph-canvas][data-layout=settled]'`. The URL ends `/monitors/ocbc/graph`; the canvas reads `Graph of 27 nodes and 47 links around OCBC`; `In view` reads `26 nodes, 13 new` under `Groups, 1 hop 1` and `Developments, 1 hop 25`.
- **2 hops.** `S find role button click --name "2 hops"`. The canvas goes `running`, then `settled` within about 3 s, and reads `Graph of 51 nodes and 119 links around OCBC`. The list adds `Topics, 2 hops 3`, `Groups, 2 hops 1`, `Entities, 2 hops 5`, `Developments, 2 hops 15`, and the legend adds `11 lower-priority developments not shown`.
- **Node types.** `S find role button click --name "Nodes: All"`, `S snapshot -i` (four checked checkboxes), `S uncheck @<checkbox "Developments">`, `S press Escape`. The button reads `Nodes: 3 of 4`, `S get count '[data-node^="dev:"]'` is 0, and at 2 hops the canvas reads `Graph of 7 nodes and 6 links around OCBC`. Check the box again to restore.
- **Link types.** `Links: All`, uncheck `Affects`, Escape. The button reads `Links: Member of, Exposed to` and the development nodes go, because developments join the graph only through Affects links.
- **Window.** Click `button "7 days"`. At 2 hops, OCBC reads `Graph of 26 nodes and 52 links`, `25 nodes, 25 new`, with no truncation line. `All time` restores.
- **New developments highlighted.** The legend shows `New or updated this run`; new rows start `New:` (`link "New: Singapore banks"`), and `In view` counts them (`13 new`). The count excludes the centre node, so it is one below the API's `has_new` total when the centre is new.
- **Click a subject node on the canvas.** Take a screenshot (`S screenshot <file>`) to find a node, then `S mouse move <x> <y>` and read `S eval 'document.querySelector("[data-testid=graph-canvas]").dataset.hovered ?? "none"'` until it names a node other than the centre. Then `S mouse down left` and `S mouse up left`. With OCBC at 1 hop, `singapore-banks` was at (669, 368) in one layout (coordinates vary, so measure each time): the URL became `/monitors/singapore-banks` with `heading "Singapore banks" [level=1]` and `What changed since last review`.
- **Click from the list.** `S click '.graph-list [data-node="singapore-banks"]'` opens `/monitors/singapore-banks`. `S click '[data-node^="dev:"]'` adds `?evidence=<id>` and opens the drawer over the graph; `S press Escape` returns to `/monitors/ocbc/graph`.
- **Drag a node.** Find a node as in the click recipe, then `S mouse down left`, two or three `S mouse move` steps more than 3 px away, and read `S get attr '[data-testid=graph-canvas]' data-dragging` (the node id) and `data-layout` (`running`). `S mouse up left` leaves the URL unchanged, clears `data-dragging`, and `data-layout` returns to `settled` within a few seconds. A press that moves 3 px or less is a click.
- **Hover sync.** `S mouse move` onto a list row sets the canvas's `data-hovered` to that node's id.
- **Proof.** `pnpm -C web verify shot <run>/<step>` after each settle; the ARIA file carries the canvas label and the list.

## Gotchas

- Filter changes keep the previous graph on screen while the new one loads, and that graph still reads `settled`. Waiting for `data-layout=settled` right after a click can return before the new data lands. Wait for the canvas label to change (or `wait --load networkidle`) first, then for `settled`.
- Hops, filters and window live only in page state. Back, reload, or leaving and returning resets to 1 hop, all nodes and links, all time.
- The canvas is WebGL, so nodes have no ARIA handles. Find them by pointer and `data-hovered`, or use the `In view` links. The e2e's `findNode` spirals out from the centre the same way.
- Run agent-browser commands one at a time per session. A leftover background loop moving the mouse made a canvas click land elsewhere, and concurrent or killed commands left the daemon returning `daemon may be busy or unresponsive` with the page renderer at 100% CPU. Only killing that session's renderer and closing the session recovered it.
- Feed `agent-browser` from `</dev/null` inside `while read` loops; it reads stdin and swallows the loop's input.
- `S hover <selector>` on an `In view` row did not set `data-hovered` in one try; `S mouse move` to the row's box did.
- At 1 hop, an entity's topics are often missing because they link through its group; they appear at 2 hops even though the monitor page's Links lists them.
- The last checked box in a filter menu is disabled; the API reads an empty filter as all.
- Themes come from the pipeline's graph step. A run built before themes existed has none: its developments keep the single development colour, no sector labels show, and the list groups them as `Developments`.
