# Sidebar

The left navigation (`navigation "Main"`) lists dashboards in a saved order, each with an options popover for name, color, order and delete.
Below it, the Monitors section has collapsible Topics, Groups and Entities trees with a count of subjects and each subject's new developments.
The profile button at the bottom opens a menu leading to Settings, Data sources, Run history and Help.

## Sub-features

- `dash-list` lists dashboards in saved order; the open dashboard, or the dashboard whose developments list is open, is marked `aria-current="page"`.
- `dash-reorder-drag` drags a dashboard row with a mouse to a new slot and saves the order.
- `dash-reorder-menu` moves a dashboard with Move up and Move down in its options popover.
- `dash-options` renames, recolors or deletes a dashboard from `Options for <name>`, with Undo on delete.
- `dash-rename-inline` renames by double-clicking the row.
- `monitor-trees` expands Topics, Groups and Entities and opens a subject's monitor page; the tree holding the current subject opens itself.
- `profile-menu` opens Settings, Data sources, Run history and Help.

## How to get to it (user POV)

- Present on every page of the shell.
- `IntelMonitor` brand link goes home, which lands on the default dashboard (Settings, else first in the sidebar).
- `New dashboard` sits first in the list; it belongs to [new-dashboard](new-dashboard.md).
- The options button shows on row hover; keyboard users Tab to it.
- `?` anywhere opens Help without the menu ([help-and-tour](help-and-tour.md)).

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok; at least three dashboards exist (`pnpm -C web verify api /dashboards`).
- Save the order before any reorder: `pnpm -C web verify api /dashboards > /tmp/order-before.json`.
- `pnpm -C web verify open home`, then drive with `agent-browser --session <session>`.

- **Expand a tree.** Click `Entities`. Run `agent-browser find role button click --name "Entities"`. The button reports `expanded=true` and subject links appear, named with their new count, for example `link "Maybank 3 new"`.
- **Open a monitor from the tree.** Click a subject. Run `agent-browser snapshot -i -s nav`, then `agent-browser click @eN` on `link "Maybank 3 new"`. URL becomes `/monitors/maybank`, the H1 reads `Maybank`, and `document.querySelector("nav [aria-current=page]")` is that link.
- **Current tree opens itself.** Reload a monitor page. Run `agent-browser reload`. Only the tree holding that subject reports `expanded=true`; the others stay collapsed.
- **Open options.** Click `Options for <name>`. Run `agent-browser find role button click --name "Options for Stablecoin watch" --exact`. A `dialog "Edit Stablecoin watch"` shows textbox `Name`, radios `blue` to `brown` with the current one checked, `Move up`, `Move down` and `Delete dashboard`.
- **Move down, then back.** Click `Move down`, then `Move up`. Run `agent-browser find role button click --name "Move down"`, then `pnpm -C web verify api /dashboards`: the dashboard is one slot lower. Focus stays on `Move down` and the popover stays open. Then `agent-browser find role button click --name "Move up"` and `verify api /dashboards` matches the saved order again.
- **Ends are inert.** Open options on the first dashboard. `Move up` has `aria-disabled="true"` and does nothing; the last row's `Move down` likewise.
- **Close options.** Press Esc. Run `agent-browser press Escape`. The popover closes and focus returns to `Options for <name>`.
- **Drag to reorder.** Drag one row's link onto its neighbour. Run `agent-browser drag '[data-dashboard-id="stablecoin-watch"] a' '[data-dashboard-id="singapore-banks"] a'`. `verify api /dashboards` shows the two swapped and the URL is unchanged (the drop does not open the dashboard). Undo by dragging back the other way, then diff `verify api /dashboards` against the saved order.
- **Persistence.** After a reorder, `agent-browser reload`. Row order (`[...document.querySelectorAll(".dashrow")].map(r => r.dataset.dashboardId)`) equals `verify api /dashboards` and every row keeps its color dot.
- **Delete, cancel.** Click `Delete dashboard`, then `Cancel`. Run `agent-browser find role button click --name "Delete dashboard"`, then `agent-browser find role button click --name "Cancel" --exact`. The confirm row shows `Delete this dashboard?` with `Cancel` and `Delete`; Cancel returns to `Delete dashboard` and `verify api /dashboards` is unchanged.
- **Delete, undo.** Only on a throwaway dashboard: click `Delete`, then `Undo` in the toast `Deleted <name>`. `verify api /dashboards` loses and then regains the id. If the deleted dashboard was open, the page goes to `/` and Undo brings it back.
- **Rename in place.** Double-click a row. Run `agent-browser dblclick '[data-dashboard-id="<id>"] a'`. A textbox `Dashboard name` replaces the link with its text selected. Esc cancels; Enter or blur saves, read back with `verify api /dashboards`.
- **Profile menu.** Click the profile button. Run `agent-browser find role button click --name "Analyst"`. A menu shows `menuitem "Settings"`, `"Data sources"`, `"Run history"` and `"Help ?"`; ArrowDown and ArrowUp cycle them and Esc closes the menu, focusing the profile button.
- **Profile dialogs.** Choose a menu item. Run `agent-browser find role menuitem click --name "Run history"`. A modal with an H2 of the same name opens; `Run history` lists the rows of `verify api /runs`, `Data sources` the rows of `verify api /data-sources`. Settings edits `Display name` and `Default dashboard` with `Cancel` and `Save`; read back with `verify api /profile`.

## Gotchas

- Reorder has no Undo toast. Undo it with the reverse Move or drag, then diff `verify api /dashboards` against the saved order.
- Names collide: `OCBC` and `Singapore banks` are both a dashboard and a subject link in the same nav, and another agent's drive can add a second dashboard with a taken name. Scope by `[data-dashboard-id="<id>"]` or use `--exact` on the options button.
- `agent-browser drag` on `.dashrow-dot` fails because the link covers it; drag the row's `a`. Pointer-down on the options button does not start a drag.
- A double-click is two clicks first: the first click follows the link, so the rename box can end up on the dashboard page that just opened. Check the URL before asserting where you are.
- In the delete confirm, focus jumps to `Delete` (autofocus), so a stray Enter deletes. After `Cancel`, focus falls to the page body instead of returning to `Delete dashboard`.
- `find role button --name "Analyst Supervisory analyst"` does not match the profile button even though the snapshot prints that name; `--name "Analyst"` does.
- The trees' open state is per page load; only the current subject's tree reopens after a reload.
- Viewing a monitor does not clear its sidebar new count; Mark reviewed on the monitor page does ([monitor-page](monitor-page.md)).
