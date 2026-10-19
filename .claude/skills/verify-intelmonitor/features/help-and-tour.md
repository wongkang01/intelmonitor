# Help and tour

Help is a modal that says what each label on a development means (High, Medium, Low, Adverse event, the tone, New, Updated) and lists the keyboard shortcuts; `?` opens it from anywhere outside a text field.
The coach-mark tour is off: nothing starts it, since the sessions test whether screens explain themselves. Its code is parked in `components/shell/Tour.tsx` until the sessions decide.
There is no general feedback entry in the shell; feedback on the AI is Mark wrong on answers and Wrong on tags, covered in [evidence-drawer](evidence-drawer.md) and [monitor-page](monitor-page.md).

## Sub-features

- `help-open` opens Help with `?` or the profile menu's `Help ?` item.
- `help-content` shows regions `Labels on a development` (one row per label with its meaning) and `Keyboard shortcuts` (⌘K, ?, Esc).
- `tour-off` no tour starts on any page, whatever `tour_seen_at` holds.

## How to get to it (user POV)

- Press `?` on any page, with focus outside a text field and no modal open.
- Profile button (bottom of the sidebar), then `Help ?`.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- Read the profile first: `pnpm -C web verify api /profile` (`tour_seen_at`).
- `pnpm -C web verify open home`, then drive with `agent-browser --session <session>`.

- **Open Help by key.** Press `?`. Run `agent-browser press "?"`. A modal with `heading "Help"` opens with `button "Close"` and regions `Labels on a development` (seven rows) and `Keyboard shortcuts`.
- **Open Help from the menu.** Click the profile button, then `Help ?`. Run `agent-browser click ".profile"`, then `agent-browser find role menuitem click --name "Help"`. The same modal opens.
- **Close Help.** Press Esc or click `Close`. Run `agent-browser press Escape`. No `dialog[open]` remains and focus is on the profile button (`button.profile`).
- **`?` while typing.** Focus search and type `?`. Run `agent-browser press Meta+k` and `agent-browser keyboard type "?"`. The field holds `?` and Help does not open.
- **No tour.** Open any dashboard. `document.querySelector("dialog.tour")` is null and `verify api /profile` `tour_seen_at` is unchanged.

## Gotchas

- `?` does nothing while any `dialog[open]` is showing, such as Data sources or Edit dashboard.
- The profile menu item is named `Help ?` because of its key hint; match with `--name "Help"`.
- `agent-browser eval` shares one global scope across calls, so a second `const t = ...` throws `Identifier 't' has already been declared`. Wrap each expression in `(() => { ... })()`.
- The harness browser sometimes stops answering (`Resource temporarily unavailable (os error 35)`, one renderer at 100% CPU) or reports `relaunched browser` and lands on `about:blank`, most often right after `press Escape` on a modal or popover. Run `verify cleanup` and `verify open` again, then redo the step; it did not reproduce on retry.
