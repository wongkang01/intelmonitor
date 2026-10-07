"""Step 7c, after the notes: a summary per subject per run for the top of its monitor page.

One Claude call per subject, on SUMMARY_MODEL, writes a paragraph of at most SUMMARY_MAX_WORDS
words from the run's stored rows: the subject's focus area answers with their previous states,
its developments new or updated in the run that need attention or are adverse, the detector
events on its series, and its Trend note's headline. As in answers, the paragraph may quote
numbers only from those inputs; one that breaks a rule is asked again once.

Code, not the model, sets the direction: the run against the previous run on a pressure score,
each focus area at Watch 1 and at Needs attention 2 (so a move between the two counts), plus 1
per adverse development needing attention. The counts are over the developments the subject's
Developments tab lists: those tagged to it, or for a group to it or its members.
"""

import asyncio
import sqlite3
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel

from intelmonitor.pipeline.answers import (
    RunDevelopment,
    answer_problems,
    load_run_developments,
    scope,
)
from intelmonitor.pipeline.detectors import live_events
from intelmonitor.pipeline.diff import DevelopmentChange, development_changes, previous_run
from intelmonitor.pipeline.facts import mapped_series
from intelmonitor.pipeline.inference import Inference, StepFailed
from intelmonitor.pipeline.params import MATERIALITY_LEVELS, NEEDS_ATTENTION_LEVEL
from intelmonitor.pipeline.subjects import Subject, all_subjects, questions_for
from intelmonitor.pipeline.wording import day, fx_currency

SUMMARY_MODEL = "claude-sonnet-5-5"
SUMMARY_MAX_WORDS = 60
# Most developments listed in one summary prompt, most material first.
SUMMARY_MAX_DEVELOPMENTS = 12

Direction = Literal["more_adverse", "less_adverse", "unchanged"]

_STATE_LABELS = {
    "stable": "Stable",
    "watch": "Watch",
    "needs_attention": "Needs attention",
    "new": "New",
}
_DASHES = ("—", "–")


class SummaryDraft(BaseModel):
    text: str


SUMMARY_SYSTEM = (
    "You write the opening paragraph of a subject's page on a financial supervisor's monitoring "
    "dashboard. It is plain, specific and claims only what the inputs support."
)


@dataclass(frozen=True)
class FocusArea:
    label: str
    state: str
    previous: str | None
    summary: str


@dataclass(frozen=True)
class Pressure:
    """What the direction compares between two runs."""

    attention: int  # focus areas at Needs attention
    watch: int  # focus areas at Watch
    adverse: int  # adverse developments needing attention

    @property
    def score(self) -> int:
        """Needs attention weighs twice Watch, so escalating or easing between them moves it."""
        return 2 * self.attention + self.watch + self.adverse


def is_adverse(d: RunDevelopment) -> bool:
    return d.adverse >= 0.5


def needs_attention(d: RunDevelopment) -> bool:
    return d.level >= NEEDS_ATTENTION_LEVEL


def in_scope(devs: list[RunDevelopment], subject: Subject) -> list[RunDevelopment]:
    """The subject's developments, as its Developments tab lists them."""
    ids = scope(subject)
    return [d for d in devs if ids & set(d.subjects)]


def focus_areas(
    conn: sqlite3.Connection, run_id: str, base_id: str | None, subject: Subject
) -> list[FocusArea]:
    """The subject's built-in focus area answers in the run, in seed order, with the state each
    had in the base run."""
    rows = {
        (r["run_id"], r["question_id"]): r
        for r in conn.execute(
            "SELECT run_id, question_id, state, summary FROM question_answers "
            "WHERE subject_id = ? AND run_id IN (?, ?)",
            (subject.id, run_id, base_id or ""),
        )
    }
    out: list[FocusArea] = []
    for q in questions_for(subject):
        if (row := rows.get((run_id, q.id))) is None:
            continue
        before = rows.get((base_id or "", q.id))
        out.append(
            FocusArea(q.label, row["state"], before["state"] if before else None, row["summary"])
        )
    return out


def pressure(areas: list[FocusArea], devs: list[RunDevelopment]) -> Pressure:
    return Pressure(
        attention=sum(a.state == "needs_attention" for a in areas),
        watch=sum(a.state == "watch" for a in areas),
        adverse=sum(is_adverse(d) and needs_attention(d) for d in devs),
    )


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def direction(
    now: Pressure, before: Pressure | None, base: date | None
) -> tuple[Direction | None, str]:
    """The direction against the previous run, and its basis in words."""
    stated = (
        f"{_count(now.attention, 'focus area', 'focus areas')} at Needs attention, "
        f"{now.watch} at Watch and "
        f"{_count(now.adverse, 'adverse development', 'adverse developments')} needing attention"
    )
    if before is None or base is None:
        return None, f"{stated}; no earlier run to compare with"
    basis = (
        f"{stated}, against {before.attention}, {before.watch} and {before.adverse} "
        f"on {base.day} {base:%b}"
    )
    if now.score > before.score:
        return "more_adverse", basis
    if now.score < before.score:
        return "less_adverse", basis
    return "unchanged", basis


def summary_prompt(
    subject: Subject,
    as_of: date,
    base: date | None,
    areas: list[FocusArea],
    devs: list[tuple[RunDevelopment, DevelopmentChange]],
    events: list[str],
    headline: str | None,
    problems: list[str],
) -> str:
    since = f", compared with the run of {day(base)}" if base else ", the first run"
    parts = [f"Subject: {subject.description}.", f"Run of {day(as_of)}{since}.", ""]
    parts.append("Focus areas (label | state | answer):")
    parts += [
        f"- {a.label} | {_STATE_LABELS[a.state]}"
        + (f" (was {_STATE_LABELS[a.previous]})" if a.previous and a.previous != a.state else "")
        + f" | {a.summary}"
        for a in areas
    ] or ["none"]
    parts += ["", "Developments new or updated in this run that need attention or are adverse:"]
    parts += [
        f"- {d.title} | {MATERIALITY_LEVELS[d.level]}"
        + (" | adverse" if is_adverse(d) else "")
        + f" | {'new' if c.kind == 'new_development' else 'updated'}, last source "
        f"{day(d.last_published)}"
        for d, c in devs
    ] or ["none"]
    parts += ["", "Events detectors flagged on the subject's measured series:"]
    parts += [f"- {e}" for e in events] or ["none"]
    if headline:
        parts += ["", f"Why the subject's series moved this week: {headline}"]
    if problems:
        parts += ["", "Your previous paragraph broke these rules; write it again without them:"]
        parts += [f"- {p}" for p in problems]
    parts += [
        "",
        f"""Write text: one paragraph of at most {SUMMARY_MAX_WORDS} words saying what matters most
for the subject in this run and what changed since the previous run.
- Lead with the most serious item. Name the focus areas and developments you mean; no generic
  phrases such as "remains a key area to monitor".
- If nothing needs attention or changed, say so plainly in one sentence.
- Do not count focus areas or developments; the page shows the counts.
- Numbers: quote only numbers the inputs give, as they give them; never compute new ones.
- Exchange rates: tell a move by the SGD's side ("SGD weakened 0.55% against the MYR"); never
  write pairs such as SGD/MYR or say a rate went up or down.
- No em dashes or en dashes, no lists, no headings.""",
    ]
    return "\n".join(parts)


def summary_problems(text: str, allowed: str, fx: bool) -> list[str]:
    """Why a summary is asked again: the answers' number and FX rules, its length and dashes."""
    problems = answer_problems(text, allowed, fx)
    if (words := len(text.split())) > SUMMARY_MAX_WORDS:
        problems.append(f"{words} words: write at most {SUMMARY_MAX_WORDS}")
    if any(dash in text for dash in _DASHES):
        problems.append("em or en dashes: use commas, colons or full stops")
    return problems


async def summarize_subject(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    base_id: str | None,
    subject: Subject,
    devs: list[RunDevelopment],
    base_devs: list[RunDevelopment],
    changes: dict[str, DevelopmentChange],
) -> int:
    """Writes the subject's summary for the run. Returns 1 if it still breaks a rule after the
    retry."""
    base = date.fromisoformat(base_id) if base_id else None
    areas = focus_areas(conn, run_id, base_id, subject)
    mine = in_scope(devs, subject)
    flagged = [
        (d, changes[d.id])
        for d in mine
        if d.id in changes and (needs_attention(d) or is_adverse(d))
    ]
    flagged.sort(key=lambda p: (-p[0].level, -is_adverse(p[0]), -p[0].last_published.toordinal()))
    flagged = flagged[:SUMMARY_MAX_DEVELOPMENTS]
    series = mapped_series(subject.id)
    after = base or as_of - timedelta(days=7)
    events = [e.statement for e in live_events(conn, [s.id for s in series], as_of, after)]
    note = conn.execute(
        "SELECT headline FROM run_notes WHERE run_id = ? AND subject_id = ?", (run_id, subject.id)
    ).fetchone()
    headline: str | None = note["headline"] if note else None
    allowed = "\n".join(
        [f"{a.label} {a.summary}" for a in areas]
        + [d.title for d, _ in flagged]
        + events
        + ([headline] if headline else [])
    )
    fx = any(fx_currency(s) for s in series)
    problems: list[str] = []
    draft: SummaryDraft | None = None
    for attempt in range(2):
        prompt = summary_prompt(subject, as_of, base, areas, flagged, events, headline, problems)
        ref = f"subject:{subject.id}" + (f":retry{attempt}" if attempt else "")
        draft = await inf.claude(
            "summary", ref, prompt, SummaryDraft, SUMMARY_SYSTEM, model=SUMMARY_MODEL
        )
        problems = summary_problems(draft.text.strip(), allowed, fx)
        if not problems:
            break
    assert draft is not None
    before = (
        pressure(focus_areas(conn, base_id, None, subject), in_scope(base_devs, subject))
        if base_id
        else None
    )
    way, basis = direction(pressure(areas, mine), before, base)
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO run_summaries (run_id, subject_id, text, direction, "
            "direction_basis, developments_in_scope, needs_attention, adverse, model, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                subject.id,
                draft.text.strip(),
                way,
                basis,
                len(mine),
                sum(needs_attention(d) for d in mine),
                sum(is_adverse(d) for d in mine),
                SUMMARY_MODEL,
                datetime.now(UTC).isoformat(),
            ),
        )
    return 1 if problems else 0


async def write_summaries(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    base_id: str | None,
    changes: dict[str, DevelopmentChange],
    subject_ids: list[str] | None = None,
) -> tuple[int, int]:
    """Writes the summaries of the subjects (default all, which also drops summaries of subjects
    no longer seeded). Returns (summaries written, summaries still breaking a rule)."""
    devs = load_run_developments(conn, run_id)
    base_devs = load_run_developments(conn, base_id) if base_id else []
    everyone = all_subjects()
    subjects = [everyone[i] for i in subject_ids] if subject_ids else list(everyone.values())
    failures: list[str] = []
    broken = 0

    async def one(subject: Subject) -> None:
        nonlocal broken
        try:
            broken += await summarize_subject(
                inf, conn, run_id, as_of, base_id, subject, devs, base_devs, changes
            )
        except Exception as error:
            failures.append(f"{subject.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(one(s) for s in subjects))
    if failures:
        raise StepFailed("summary", failures)
    if subject_ids is None:
        with conn:
            kept = [s.id for s in subjects]
            conn.execute(
                f"DELETE FROM run_summaries WHERE run_id = ? AND subject_id NOT IN "
                f"({','.join('?' * len(kept))})",
                (run_id, *kept),
            )
    return len(subjects), broken


async def summarize_run(
    conn: sqlite3.Connection, run_id: str, subject_ids: list[str] | None = None
) -> tuple[int, int]:
    """`im summarize`: (re)writes a complete run's summaries from its stored rows, against the
    run before it, without recomputing anything else."""
    as_of = date.fromisoformat(run_id)
    base_id = previous_run(conn, run_id)
    changes = development_changes(conn, run_id, base_id)
    return await write_summaries(
        Inference(conn, run_id), conn, run_id, as_of, base_id, changes, subject_ids
    )
