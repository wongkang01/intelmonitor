---
name: verify-intelmonitor
description: "Drive the running IntelMonitor web app (Vite and TanStack Router dashboard over the FastAPI store) the way an analyst does, and keep proof. Use to verify any UI or API change, reproduce a reported bug, check a feature still works, or take screenshots and recordings of dashboards, monitor pages, developments, the evidence drawer, trend and graph views."
---

# Verify IntelMonitor

`pnpm -C web verify <command>` is the harness (`web/verify/control.ts`).
It health checks the dev servers, resolves a feature to its page with real ids, and keeps evidence.
The page itself is driven with `agent-browser --session im-verify`, which the harness opens at the e2e viewport (1440x900).
`pnpm -C web verify help` lists every command.

## Launch

The app is two Portless dev servers over one SQLite store (`data/intelmonitor.db`).

```bash
pnpm -C web verify doctor   # first, and again whenever something looks off
pnpm -C web verify up       # starts only what is missing: proxy, API, web
```

Ready means doctor prints `"ok": true`.
The user usually has the servers running already; `up` then starts nothing.
There is one store and one pair of servers, so no isolated second instance exists.
Two agents driving at once each set `VERIFY_SESSION=<name>` for their own browser and keep to read-only drives, or undo each mutation at once with the app's Undo.

## Doctor

`doctor` is read-only and prints one JSON object of checks, each with a `fix` command when it fails:

- `proxy`, `api`, `web`: Portless routes exist and both servers answer.
- `api-types`: the live API schema equals `web/lib/api/openapi.json`. When it differs, run `pnpm -C web gen:api` before trusting any UI result.
- `run`: warns while a pipeline run is computing, because answers change under you.
- `store`, `agent-browser`, `git`: the store exists, the driver is installed, HEAD and dirty count for the proof log.

## Drive

1. Match the change to a file in [`features/`](features/README.md) and read it. It lists every entry point, stable handles and gotchas.
2. `pnpm -C web verify open <target> [args]` to reach the starting page.
   Targets: `home`, `dashboard <dashboard>`, `monitor <subject>`, `trend <subject>`, `graph <subject>`, `developments <dashboard> [query]`, `evidence <development-id> [dashboard]`.
   A dashboard or subject is an id or a name; a name that matches several items fails and lists their ids.
3. Find ids from the API when a recipe needs one: `pnpm -C web verify api /subjects`, `/dashboards`, `/developments?limit=5`, `/runs`.
4. Drive with `agent-browser --session im-verify snapshot -i`, then `click @eN`, `fill @eN "text"`, `press "Meta+k"`, `wait --load networkidle`.
   Act on refs from a fresh snapshot. `agent-browser find role ... --name` misses links, textboxes and checkboxes here and can hang.
   Some names repeat (developments facet buttons and column sorts share names), so check the ref's context in the snapshot.
   Popovers, dialogs and watchlist groups can be missing from `snapshot -i`; take a full `snapshot` when something you see is not listed.
   `eval` shares one global scope across calls, so wrap each script as `(() => { ... })()`.
5. After the user action, read the side effect back from the API (`verify api ...`) or a reload, not just the pixels.

Pipeline behavior with no UI entry point has scripted checks: `pnpm -C web verify check series|past-run|depeg`, each printing JSON.
The full regression walkthrough is `pnpm -C web e2e` (Playwright, 26 steps, writes `artifacts/e2e/<timestamp>/index.html`).
It is one test, so steps cannot run alone; it calls Claude (Generate, the custom question) and writes to the live store until its own cleanup at the end.

## Evidence

```bash
pnpm -C web verify shot <run>/<step>          # artifacts/verify/<run>/<step>.png + .aria.txt
pnpm -C web verify record start <run>/<name>  # .webm; record stop when the end state is stable
```

Proof bar:

- Drive the production user path: visible controls, keyboard shortcuts, links. Opening a URL is how to reach a starting page, not proof that its entry point works.
- Show the trigger and the stable end state in the same recording, or a shot before and after.
- Verify side effects: the API returns the new state, a reload keeps it, Undo restores it.
- Cover every entry point, and the empty, error, cancel and persistence paths the change can affect, per the feature file.
- Name a path you could not reach and why (for example, Generate and custom questions call Claude and cost money; Run now recomputes the live run).

## Mutations and cleanup

Most actions write to the live store the user relies on.

```bash
pnpm -C web verify store save <label>     # before any drive that mutates; SQLite backup, safe while serving
pnpm -C web verify store restore <file>   # puts it back; keeps a copy of what it replaced
pnpm -C web verify cleanup                # closes the harness browser
pnpm -C web verify down                   # stops only servers that `up` started
```

Prefer the app's own Undo for small mutations.
Undo toasts last 5 seconds, so chain the action and Undo in one shell command, or undo through the API afterwards (`verify api DELETE /reviews/<id>`, the call Undo makes).
Creating a dashboard follows its subjects, and deleting it does not unfollow them; compare `verify api /follows` before and after.
Snapshots live in `data/verify-snapshots/`, evidence in `artifacts/verify/`; cleanup removes neither.
Never kill servers by name; the user's servers are not ours.
If the browser stops answering or lands on `about:blank`, run `verify cleanup`, then `verify open` again; do not keep driving a wedged session.

## Keeping the map honest

A change that adds, moves or renames a user-visible control updates its feature file in the same commit.
When a recipe here or in `features/` turns out wrong, fix it as part of the task.
