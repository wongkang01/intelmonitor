# Pipeline checks

Pipeline behavior with no UI entry point is proven by three scripted checks, `pnpm -C web verify check series|past-run|detector`, which wrap `uv run im check <name>` and print one JSON object.
Each works in a temporary scratch store that is deleted afterwards, makes no network request and no paid model call, and leaves `data/intelmonitor.db` as it was.
`pnpm -C web e2e` is the 14-step regression walkthrough, ending with the series and detector checks.
Run now is parked with the top bar's run chip, so no user can start a run from the app.

## Sub-features

- `check-series`: a backfill and a daily fetch replayed from cached responses in `data/raw/` reach no source, the second fetch adds nothing, and the values match the store.
- `check-past-run`: the run before the latest (17 Sep today) recomputed in a copy of the store, replaying only recorded model calls, uses nothing known after its date and equals the stored run.
- `check-detector`: fixture loan-to-deposit values crossing 90% fire the rule into one development.
- `e2e`: `pnpm -C web e2e`, the Playwright walkthrough with an HTML report.

## How to get to it (user POV)

- The checks have no UI; a developer runs them in a terminal.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok. The checks need `uv` and the API's environment, not the servers; e2e needs both servers.
- The store holds runs up to 8 Oct with `previous_run_id` 1 Oct on the latest (`pnpm -C web verify api /runs/latest`).

- **Series fetch replay.** `pnpm -C web verify check series` (about 7 s). Assert: `backfill.network` 0, `backfill.missed` 0, `backfill.cached` > 0, `backfill.failures` `{}`, and the same four for `fetch`; `backfill.added` equals `observations`; `series` at least `catalogue` minus one (80 of 81 on 8 Oct; the hand-collected series has no fetch); `fetch.added` and `fetch.revised` both 0; `per_100` values `[0.3128, 0.038342]` for `fx.sgd.myr` and `fx.sgd.thb` on 2026-09-18, each equal to `pnpm -C web verify api "/series/<id>?from=2026-09-18&to=2026-09-18"` `observations[0].value` with the same `unit`; `compared` > 1000 (1912 on 8 Oct); `differences` `[]`.
- **Past-date run.** `pnpm -C web verify check past-run` (about 20 s). Assert: `as_of` equals the latest run's `previous_run_id` (`2026-09-17`); `later_documents`, `later_observations`, `later_detections` and `detections` all > 0; the last `log` line matches `] complete: `; every `log` line ends ` (<n>s, 0 calls, <n> cached)` (no model call); `late` is `{sources: 0, indicators: 0, facts: 0, notes: 0}`; `differences` `[]`; `developments` equals the stored run's row count in the `developments` table (672; `/runs` counts only shown developments for runs logged since the source gate, see [developments](developments.md)); `answers`, `notes`, `indicators` > 0.
- **Detector on fixtures.** `pnpm -C web verify check detector` (about 2 s). Assert: `detections` is one line, `Loan-to-deposit ratio, all currencies rose above 90.0% to 90.4% for Jul 2026, ...`; `developments` is one entry with that title, `materiality_rule` `ltd-above-90`, `needs_attention` true, `subjects` `["singapore"]`, `sources` 1.
- **Full sweep.** `pnpm -C web e2e`. Playwright runs the one walkthrough test (14 steps, serial, 1440x900, about 15 s) and writes `artifacts/e2e/<timestamp>/index.html` with a screenshot per step, video, trace, `series-fetch.json` and `detector.json`. It restores the store from its own backup at the end.
- **Proof.** Save each check's JSON (`pnpm -C web verify check detector > artifacts/verify/<run>/detector.json`) and quote the asserted fields; for e2e, link the run's `index.html`.

## Gotchas

- `pnpm -C web e2e` writes to the live store (a profile, two dashboards, follows, visits, read marks) and then restores the backup it took at the start, which also drops anything else written meanwhile. A run killed midway leaves its writes; restore with `pnpm -C web verify store restore data/verify-snapshots/<timestamp>-e2e.db`. It is one test, so steps cannot be run alone with `-g`.
- `past-run` fails on 8 Oct with `UnrecordedCall` in extract: the stored runs were computed with prompts that no longer match the recorded calls, so it cannot replay until a run is recorded again. The walkthrough leaves it out.
- Priority's Jev input no longer carries the source count (`priority_state` in `pipeline/developments.py`), and Jev calls are cached on a hash of that input, so no recorded priority call matches any more. `past-run` raises `UnrecordedCall` at the priority stage until Run 1 is recomputed with live calls (a full `im run` for the Run 1 date); `im summarize` records no priority calls and does not fix it. The next `im run` or Run now re-scores priority for every development in the run (about 1450 Jev calls on the 8 Oct run), and levels may move.
- `past-run`'s "Run 1" is `t0` minus the run spacing, so it tracks the store's `t0` meta, not the oldest run in `/runs`.
- `/runs` lists one row per execution, so the same `as_of` repeats many times; match on `as_of` and `status: complete`, and read `developments` from the first match.
- `series` compares against the live store as known on 28 Sep. A store rebuilt or restored from another snapshot can make `differences` non-empty without a code bug; check `pnpm -C web verify doctor`'s `store` modified time first.
- The checks print only JSON on success. A Python traceback means the check itself failed (for example a missing cache in `data/raw/` shows as `missed` > 0 or an exception), not the harness.
