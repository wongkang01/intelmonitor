"""Derived series: the three operations api/seed/series.yaml can declare, computed from stored
observations after a fetch. There is no expression language."""

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
    """op(a, b) for each period both inputs have, known once both values are. Pairing by period
    keeps the two values from the same day: XSGD's 00:00 UTC price in USD with that day's MAS
    USD rate, never an earlier day's, whose gap to the price is FX movement and not a depeg. A
    period missing from either input (a weekend with no MAS rate) gives no value. A zero b gives
    no value."""
    by_period = {o.period: o for o in b}
    out: list[Observation] = []
    for x in a:
        y = by_period.get(x.period)
        if y is None or y.value == 0:
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
