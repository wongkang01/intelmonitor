# Sidebar

The left navigation (`navigation "Main"`) opens with `link "Ask"` to the [Ask](ask.md) page, then lists dashboards in a saved order, each with an options popover for name, color, order and delete.
Below it, `Entities` lists the groups (Singapore banks, Payment systems, ...) as collapsible headings with their member count, and `Topics` lists the topics. The `Entities` and `Topics` headings are buttons (`aria-expanded`) that collapse their whole list; which are closed is kept in localStorage `im.sidebar.closed`, and opening an entity's or topic's page opens its section again.
A dashboard shows `<n> new` in gray: its developments new since the last visit and unread, the same number as its feed head.
An entity or topic with a High development new since the last visit shows `<n> High` in red, with a tooltip saying since when.
Long names wrap; nothing is cut off.
The profile button at the bottom shows the active profile and opens a menu that switches role, adds a role ([onboarding](onboarding.md)), and leads to Data sources and Help.
The Dashboards list holds the active profile's dashboards and those no profile made.

## Sub-features

- `ask` `link "Ask"` above the Dashboards heading opens `/ask` and is marked `aria-current="page"` there.
- `dash-list` lists dashboards in saved order; the open dashboard, or the dashboard whose developments list is open, is marked `aria-current="page"`.
- `dash-reorder-drag` drags a dashboard row with a mouse to a new slot and saves the order.
- `dash-reorder-menu` moves a dashboard with Move up and Move down in its options popover.
- `dash-options` renames, recolors or deletes a dashboard from `Options for <name>`, with Undo on delete.
- `dash-rename-inline` renames by double-clicking the row.
- `entity-groups` expands a group heading under Entities and opens a member's page; the group holding the current entity opens itself.
- `topics` opens a topic's page.
- `dash-new` `<n> new` on a dashboard with unread developments new since the last visit.
- `new-high` `<n> High` on entities and topics with a new High development.
- `profile-menu` switches between profiles (`Switch role`), opens `Add a role`, Data sources and Help.

## How to get to it (user POV)

- Present on every page of the shell.
- `IntelMonitor` brand link goes home, which lands on the active profile's default dashboard, else the first in the sidebar, or onboarding when no profile is active.
- `New dashboard` sits first in the list; it belongs to [new-dashboard](new-dashboard.md).
- The options button shows on row hover; keyboard users Tab to it.
- `?` anywhere opens Help without the menu ([help-and-tour](help-and-tour.md)).

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok; at least three dashboards exist (`pnpm -C web verify api /dashboards`).
- Save the order before any reorder: `pnpm -C web verify api /dashboards > /tmp/order-before.json`.
- `pnpm -C web verify open home`, then drive with `agent-browser --session <session>`.

- **Expand a group.** Run `agent-browser snapshot -i -s nav`, then click `button "Singapore banks 3"`. It reports `expanded=true` and member links appear, for example `link "OCBC 1 High"` or `link "DBS"`. The groups and members match `verify api /subjects` (`type: "group"`, `members`).
- **Open an entity.** Click a member link. URL becomes `/monitors/<id>`, the H1 is its name, and `document.querySelector("nav [aria-current=page]")` is that link.
- **Current group opens itself.** Reload an entity page. Only the group holding it reports `expanded=true`.
- **Dashboard new count.** A dashboard row's `<n> new` equals `new_count` in `verify api /dashboards` and the `<n> new` in its dashboard's feed head; opening one of its New developments lowers both.
- **New High.** A row's `<n> High` equals `new_high` in `verify api /subjects`; its `title` reads `<n> new High development(s) since your last visit on <date>` (or `since the last update` with no earlier visit).
- **Open options.** Click `Options for <name>`. Run `agent-browser find role button click --name "Options for Stablecoin watch" --exact`. A `dialog "Edit Stablecoin watch"` shows textbox `Name`, radios `blue` to `brown` with the current one checked, `Move up`, `Move down` and `Delete dashboard`.
- **Move down, then back.** Click `Move down`, then `Move up`. Run `agent-browser find role button click --name "Move down"`, then `pnpm -C web verify api /dashboards`: the dashboard is one slot lower. Focus stays on `Move down` and the popover stays open. Then `agent-browser find role button click --name "Move up"` and `verify api /dashboards` matches the saved order again.
- **Ends are inert.** Open options on the first dashboard. `Move up` has `aria-disabled="true"` and does nothing; the last row's `Move down` likewise.
- **Close options.** Press Esc. Run `agent-browser press Escape`. The popover closes and focus returns to `Options for <name>`.
- **Drag to reorder.** Drag one row's link onto its neighbour. Run `agent-browser drag '[data-dashboard-id="stablecoin-watch"] a' '[data-dashboard-id="singapore-banks"] a'`. `verify api /dashboards` shows the two swapped and the URL is unchanged (the drop does not open the dashboard). Undo by dragging back the other way, then diff `verify api /dashboards` against the saved order.
- **Persistence.** After a reorder, `agent-browser reload`. Row order (`[...document.querySelectorAll(".dashrow")].map(r => r.dataset.dashboardId)`) equals `verify api /dashboards` and every row keeps its color dot.
- **Delete, cancel.** Click `Delete dashboard`, then `Cancel`. Run `agent-browser find role button click --name "Delete dashboard"`, then `agent-browser find role button click --name "Cancel" --exact`. The confirm row shows `Delete this dashboard?` with `Cancel` and `Delete`; Cancel returns to `Delete dashboard` and `verify api /dashboards` is unchanged.
- **Delete, undo.** Only on a throwaway dashboard: click `Delete`, then `Undo` in the toast `Deleted <name>`. `verify api /dashboards` loses and then regains the id. If the deleted dashboard was open, the page goes to `/` and Undo brings it back.
- **Rename in place.** Double-click a row. Run `agent-browser dblclick '[data-dashboard-id="<id>"] a'`. A textbox `Dashboard name` replaces the link with its text selected. Esc cancels; Enter or blur saves, read back with `verify api /dashboards`.
- **Profile menu.** Click the profile button. Run `agent-browser click ".profile"`. A menu shows `group "Switch role"` with one `menuitemradio` per profile of `verify api /profiles` (the active one `checked=true`), then `menuitem "Add a role"`, `"Data sources"` and `"Help ?"`; ArrowDown and ArrowUp cycle them and Esc closes the menu, focusing the profile button. Switching is covered in [onboarding](onboarding.md).
- **Profile dialogs.** Choose `Data sources`. A modal with that H2 lists the rows of `verify api /data-sources`. `Help` is covered in [help-and-tour](help-and-tour.md).

## Gotchas

- Reorder has no Undo toast. Undo it with the reverse Move or drag, then diff `verify api /dashboards` against the saved order.
- Names collide: `OCBC` and `Singapore banks` are both a dashboard and a subject link in the same nav, and another agent's drive can add a second dashboard with a taken name. Scope by `[data-dashboard-id="<id>"]` or use `--exact` on the options button.
- `agent-browser drag` on `.dashrow-dot` fails because the link covers it; drag the row's `a`. Pointer-down on the options button does not start a drag.
- A double-click is two clicks first: the first click follows the link, so the rename box can end up on the dashboard page that just opened. Check the URL before asserting where you are.
- In the delete confirm, focus jumps to `Delete` (autofocus), so a stray Enter deletes. After `Cancel`, focus falls to the page body instead of returning to `Delete dashboard`.
- The profile button's name is the profile's name and role (`TCRD Technology and cyber risk supervisor`); click it with `agent-browser click ".profile"` rather than by name.
- The groups' open state is per page load; only the current entity's group reopens after a reload.
- `<n> High` drops when those developments are read (opened) or dismissed; viewing the entity page alone does not clear it.
- There is no Groups section, Following list or dashboard new count; group pages (`/monitors/<group>`) are reachable by URL and list their members.
