# Pipeline checks

Pipeline behavior with no UI entry point is proven by three scripted checks, `pnpm -C web verify check series|past-run|depeg`, which wrap `uv run im check <name>` and print one JSON object.
Each works in a temporary scratch store that is deleted afterwards, makes no network request and no paid model call, and leaves `data/intelmonitor.db` as it was.
`pnpm -C web e2e` is the full 26-step regression walkthrough, including these checks.
Run now, in the top bar's Runs popover, recomputes the live Run 2 and is documented here but not driven.

## Sub-features

- `check-series`: a backfill and a daily fetch replayed from cached responses in `data/raw/` reach no source, the second fetch adds nothing, and the values match the store.
- `check-past-run`: the run before the latest (17 Sep today) recomputed in a copy of the store, replaying only recorded model calls, uses nothing known after its date and equals the stored run.
- `check-depeg`: fixture USDC prices 48 hours below the peg fire the peg rule and the depeg detector.
- `e2e`: `pnpm -C web e2e`, the Playwright walkthrough with an HTML report.
- `run-now`: the Runs popover's `Run now` button.

## How to get to it (user POV)

- The checks have no UI; a developer runs them in a terminal.
- `Run now`: top bar button `Monitoring. Last run <date>. Show runs` opens the `Runs` popover, whose foot has `Runs are manual for now.` and `Run now`.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok. The checks need `uv` and the API's environment, not the servers; e2e needs both servers.
- The store holds Runs up to 24 Sep with `previous_run_id` 17 Sep on the latest (`pnpm -C web verify api /runs`).

- **Series fetch replay.** `pnpm -C web verify check series` (about 7 s). Assert: `backfill.network` 0, `backfill.missed` 0, `backfill.cached` > 0, `backfill.failures` `{}`, and the same four for `fetch`; `backfill.added` equals `observations`; `series` equals `catalogue` (62); `fetch.added` and `fetch.revised` both 0; `per_100` values `[0.3128, 0.038342]` for `fx.sgd.myr` and `fx.sgd.thb` on 2026-09-18, each equal to `pnpm -C web verify api "/series/<id>?from=2026-09-18&to=2026-09-18"` `observations[0].value` with the same `unit`; `compared` > 3000 (3811 on 30 Sep); `differences` `[]`.
- **Past-date run.** `pnpm -C web verify check past-run` (about 20 s). Assert: `as_of` equals the latest run's `previous_run_id` (`2026-09-17`); `later_documents`, `later_observations`, `later_detections` and `detections` all > 0; the last `log` line matches `] complete: `; every `log` line ends ` (<n>s, 0 calls, <n> cached)` (no model call); `late` is `{sources: 0, indicators: 0, facts: 0, notes: 0}`; `differences` `[]`; `developments` equals the stored run's `developments` in `/runs` (672); `answers`, `notes`, `indicators` > 0.
- **Depeg on fixtures.** `pnpm -C web verify check depeg` (about 3 s). Assert: `detections` is exactly `["USDC off its USD peg by more than 0.50% for 24 hours, from 8 Sep 2026 to 9 Sep 2026; 0.9915 USD (0.85% below) on 9 Sep 2026."]`; `developments` is one entry with that title, `materiality_label` `Significant`, `materiality_rule` `depeg`, `needs_attention` true, `sources` 1; `fixed_states` is one entry `issuer.peg`, `derived.usdc.peg`, `needs_attention`, `2026-09-08` to `2026-09-10`, 48 hours; `peg.state` `needs_attention` although `peg.summary` is the canned model's Stable text; `peg.state_rules` equals the `fixed_states` texts.
- **Full sweep.** `pnpm -C web e2e`. Playwright runs the one walkthrough test (26 steps, serial, 1440x900) and writes `artifacts/e2e/<timestamp>/index.html` with a screenshot per step, video, trace, and `series-fetch.json`, `past-run.json`, `depeg.json`, `detections.json`. It undoes its own store changes in a final cleanup.
- **Run now (not driven).** Would be: `ab click @ref` for button `Monitoring. Last run ... Show runs`, then `Run now`. The chip turns to `Run in progress. Show runs`, `pnpm -C web verify api /runs/status` shows `running: true`, and a new execution appears in `/runs` when it ends. Name it as skipped in the proof log.
- **Proof.** Save each check's JSON (`pnpm -C web verify check depeg > artifacts/verify/<run>/depeg.json`) and quote the asserted fields; for e2e, link the run's `index.html`.

## Gotchas

- `pnpm -C web e2e` is not free or read-only: step 5 (`New dashboard, Generate`) and step 8 (custom question) call Claude and take minutes, and the run mutates the live store until its cleanup. A run killed midway leaves its dashboard, custom question, triage and follows behind. It is one test, so steps cannot be run alone with `-g`; run the `verify check`s for the pipeline steps.
- Run now fetches live series from the network into `data/intelmonitor.db` and recomputes Run 2 without the recorded-calls-only guard, so it can make paid model calls and changes every answer other agents are reading. Never click it unless the task is about it; `doctor` warns while a run computes.
- `past-run`'s "Run 1" is `t0` minus the run spacing, so it tracks the store's `t0` meta (17 Sep today), not the oldest run in `/runs`.
- `/runs` lists one row per execution, so the same `as_of` repeats many times; match on `as_of` and `status: complete`, and read `developments` from the first match.
- `series` compares against the live store as known on 28 Sep. A store rebuilt or restored from another snapshot can make `differences` non-empty without a code bug; check `pnpm -C web verify doctor`'s `store` modified time first.
- The checks print only JSON on success. A Python traceback means the check itself failed (for example a missing cache in `data/raw/` shows as `missed` > 0 or an exception), not the harness.
