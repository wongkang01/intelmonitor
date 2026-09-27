"""Derived series: the three operations api/seed/series.yaml can declare, computed from stored
observations after a fetch. There is no expression language."""

from bisect import bisect_right
from collections.abc import Callable, Sequence

from intelmonitor.seed import DerivedSource, Deviation, Product, Share
from intelmonitor.store.series import Observation


def derive(source: DerivedSource, inputs: Sequence[list[Observation]]) -> list[Observation]:
    """The derived observations, given each input's observations in derived_inputs order."""
    match source:
        case Deviation():
            target = source.target
            return [o.model_copy(update={"value": (o.value / target - 1) * 100}) for o in inputs[0]]
        case Product():
            return _combine(inputs[0], inputs[1], lambda a, b: a * b)
        case Share():
            return _combine(inputs[0], inputs[1], lambda part, total: part / total * 100)


def _combine(
    a: list[Observation], b: list[Observation], op: Callable[[float, float], float]
) -> list[Observation]:
    """op(a, b) for each period of a, with the latest b known when a was: the b of the latest
    period among those available by a's available_at. Inputs on different calendars (a coin
    priced daily, an exchange rate on weekdays) combine without gaps and without look-ahead, and
    a later b never changes an earlier result. A zero b gives no value."""
    known = sorted(b, key=lambda o: o.available_at)
    times = [o.available_at for o in known]
    latest: list[Observation] = []  # latest[i]: the latest period among known[: i + 1]
    for o in known:
        latest.append(o if not latest or o.period >= latest[-1].period else latest[-1])
    out: list[Observation] = []
    for x in a:
        i = bisect_right(times, x.available_at)
        if i == 0:
            continue
        y = latest[i - 1]
        if y.value == 0:
            continue
        out.append(
            Observation(
                period=x.period,
                value=op(x.value, y.value),
                preliminary=x.preliminary or y.preliminary,
                available_at=max(x.available_at, y.available_at),
            )
        )
    return out
