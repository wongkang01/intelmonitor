"""`uv run python -m intelmonitor.eval <step>`: v2, v1, v0, gold, judge, score, rescore (gold,
judge and score from cached calls only, with no model call allowed), cases [store path] (the
gold cases for roles, adverse and priority, on the app's store by default), adverse (the
adverse flag's gold cases through the extraction prompt, in their own store), impact (the impact
step's gold cases, in their own store), brief [store path] [subject ...] (the judged brief eval
on a store's latest complete run, the app's by default) or brief-compare [store path]
[subject ...] (the same subjects' briefs on Opus 5.5 beside the stored ones, in a store copy)."""

import asyncio
import os
import sys
from pathlib import Path


def main() -> None:
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    if step == "rescore":
        os.environ["IM_EVAL_CACHED_ONLY"] = "1"
    # Imported after the flag is set: common reads it at import.
    from intelmonitor.eval import (
        adverse_cases,
        brief_eval,
        cases,
        gold,
        impact_cases,
        judge,
        score,
        v0,
        v1,
        v2,
    )

    steps = {
        "v2": v2.run,
        "v1": v1.run,
        "v0": v0.run,
        "gold": gold.run,
        "judge": judge.run,
        "impact": impact_cases.run,
        "adverse": adverse_cases.run,
    }
    if step in steps:
        asyncio.run(steps[step]())
    elif step == "score":
        score.run()
    elif step == "cases":
        cases.run(*(Path(p) for p in sys.argv[2:3]))
    elif step in ("brief", "brief-compare"):
        path = Path(sys.argv[2]) if len(sys.argv) > 2 else brief_eval.DB_PATH
        chosen = sys.argv[3:] or None
        asyncio.run((brief_eval.run if step == "brief" else brief_eval.compare)(path, chosen))
    elif step == "rescore":

        async def again() -> None:
            await gold.run()
            await judge.run()

        asyncio.run(again())
        score.run()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
