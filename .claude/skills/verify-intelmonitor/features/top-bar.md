# Top bar

The top bar holds full text search over entities, topics, developments and documents, and `Week to <d Mon> · updated weekly`: the end of the week the latest weekly run covers.
An entity or topic result opens its page; a development or document result opens the development's popup over the current page.
The run status chip, Runs popover, Run now and the alerts bell are hidden for the testing sessions.

## Sub-features

- `search-open` focuses the search field with ⌘K (Ctrl+K) from anywhere.
- `search-results` lists up to five hits per group: Entities and topics, Developments, Documents (title, snippet, domain).
- `search-go` opens the highlighted hit by click or Enter; arrows move the highlight; Esc clears, then blurs.
- Development and document titles wrap in full; only a document's matched text is cut to one line.
- `search-empty` shows `Nothing matches “<text>”.`
- `updated` `Week to 8 Oct · updated weekly`, from `verify api /runs/latest` `as_of`.

## How to get to it (user POV)

- Present on every page of the shell.
- ⌘K or a click in `Search entities, topics and developments`.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- `pnpm -C web verify open home` (or any page), then drive with `ab`.

- **Updated.** `ab get text .topbar .updated` reads `Week to <d Mon> · updated weekly` and its date equals `as_of` of `verify api /runs/latest`. No `Show runs` chip, `Run now` or `Alerts` button is in `ab snapshot -i`.
- **Focus search.** `ab press Meta+k`. `document.activeElement` is `combobox "Search"`.
- **List results.** `ab keyboard type "ocbc"`, then `ab snapshot -i`. `combobox "Search" [expanded=true]` and `listbox "Search results"` show `option "OCBC Entity" [selected]`, development titles with a date, and documents with snippet and domain. Compare with `verify api "/search?q=ocbc"`.
- **Open a development hit.** Click an option in the Developments group. The current URL gains `development=<id>` and the popup's title is that development's title; the field is cleared.
- **Open a document hit.** Click a document option. The popup opens for that document's `development_id`.
- **Keyboard to an entity.** Type `ocbc`, ArrowDown then ArrowUp, then Enter. The selected option (`[role=option][aria-selected=true]`) moves and comes back; Enter lands on `/monitors/ocbc` with H1 `OCBC`.
- **Empty result.** Type `zzqxw`. The listbox holds only `Nothing matches “zzqxw”.`
- **Esc.** Press Esc once with text: the field clears and keeps focus. Press again: the field blurs.

## Gotchas

- A mouse pointer resting over where the results list opens hijacks the highlight on hover. Move the mouse away (`ab mouse move 700 850`) before keyboard assertions, or Enter opens the hovered hit.
- `snapshot -i` omits the `group` roles of search results; query `#search-results` or use a full `snapshot`.
- Opening a development hit marks it read, like any other way of opening it.
- The run chip, Runs popover, alerts bell and Following dialog are parked in `TopBar.tsx` (`RunsAndAlerts`), not deleted; `verify api /runs`, `/runs/status` and `/alerts` still answer.
