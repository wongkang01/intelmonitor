"""`uv run python -m intelmonitor.eval <step>`: v2, v1, v0, gold, judge, score, or rescore
(gold, judge and score from cached calls only, with no model call allowed)."""

import asyncio
import os
import sys


def main() -> None:
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    if step == "rescore":
        os.environ["IM_EVAL_CACHED_ONLY"] = "1"
    # Imported after the flag is set: common reads it at import.
    from intelmonitor.eval import gold, judge, score, v0, v1, v2

    steps = {
        "v2": v2.run,
        "v1": v1.run,
        "v0": v0.run,
        "gold": gold.run,
        "judge": judge.run,
    }
    if step in steps:
        asyncio.run(steps[step]())
    elif step == "score":
        score.run()
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
