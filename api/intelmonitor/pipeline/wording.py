"""Numbers in words, written by code: series values in their units, dates and periods, peg sides
and which way an FX change moved the SGD. Facts (facts.py) and detections (detectors.py) share
them, so an answer and a detected development state a value the same way."""

import re
from datetime import date

from intelmonitor.seed import Deviation, Frequency, SeriesDef

_FX_UNIT = re.compile(r"SGD per ([A-Z]{3})")


def num(v: float, decimals: int) -> str:
    return f"{v:,.{decimals}f}"


def value(s: SeriesDef, v: float) -> str:
    """A value in the series' unit: 70.3%, USD 73.21bn, SGD 1,234m, 0.3128 SGD per MYR."""
    match s.unit:
        case "%":
            return f"{v:.{s.decimals}f}%"
        case "index":
            return num(v, s.decimals)
        case "SGD m":
            return f"SGD {v:,.0f}m"
        case "USD" | "SGD" if abs(v) >= 1e9:
            return f"{s.unit} {v / 1e9:,.2f}bn"
        case "USD" | "SGD" if abs(v) >= 1e6:
            return f"{s.unit} {v / 1e6:,.1f}m"
        case "USD" | "SGD":
            return f"{s.unit} {num(v, s.decimals)}"
        case _:
            return f"{num(v, s.decimals)} {s.unit}"


def day(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


def period(d: date, frequency: Frequency) -> str:
    match frequency:
        case "daily":
            return day(d)
        case "monthly":
            return f"{d:%b %Y}"
        case "quarterly":
            return f"Q{(d.month - 1) // 3 + 1} {d.year}"


def fx_currency(s: SeriesDef) -> str | None:
    """For an FX series (SGD per unit of a currency), that currency's code."""
    quoted = _FX_UNIT.fullmatch(s.unit)
    return quoted.group(1) if quoted else None


def fx_move(s: SeriesDef, change: float) -> str | None:
    """For an FX series, a change in percent told only by the SGD's side: "SGD weakened 0.23%
    against the USD". A rate going up or down is easy to read backwards, so FX changes never say
    it. The size is the change in SGD per unit, as the indicators give it."""
    currency = fx_currency(s)
    if currency is None:
        return None
    if round(change, 2) == 0:
        return f"SGD unchanged against the {currency}"
    moved = "weakened" if change > 0 else "strengthened"
    return f"SGD {moved} {abs(change):.2f}% against the {currency}"


def peg_side(s: SeriesDef, source: Deviation, by_id: dict[str, SeriesDef], v: float) -> str:
    """A deviation value as the price and its side of the target: 0.9987 USD (0.13% below)."""
    target = by_id[source.input]
    price = source.target * (1 + v / 100)
    rounded = round(abs(v), s.decimals)
    side = (
        "at the peg"
        if rounded == 0
        else f"{rounded:.{s.decimals}f}% {'below' if v < 0 else 'above'}"
    )
    return f"{num(price, target.decimals)} {target.unit} ({side})"
