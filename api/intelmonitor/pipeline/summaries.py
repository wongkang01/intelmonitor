"""Step 11, after the diff: a brief per monitored subject per run for the top of its monitor page
(phase1-plan.md, item B).

The brief answers two questions for a reader who opens the page now and then: where the subject
stands, and whether anything needs worrying about. It is built from the evidence, not from other
summaries:
- this week: the subject's developments with a source in the last 7 days (only those it was
  affected by or acted in; new or updated, with their finding statements, the subject's priority,
  adverse flag and tone, and a mark on those reported by one outlet alone), most serious first as
  the feed orders them, its indirect impacts from development_impacts, detector events on its
  series with the Data tab note's headline, and its upcoming dates;
- its standing position: the latest values and recent moves of its Key data series, its main
  stored relationships, and open High or adverse matters from earlier weeks;
- the previous run's brief, so the brief continues rather than restarts.

One Claude call per subject (BRIEF_MODEL at high effort) returns the state (one sentence on the
subject's situation now), at most 2 concerns (a label of 2 to 4 words naming its topic, then a
risk or an opening for the subject and why it matters, citing the developments, indirect impacts
or open matters behind it), a direction against the previous run with its reason, and the
upcoming dates worth naming. On a quiet week the state says so and gives the standing position,
with no concerns, unless a matter High and adverse to the subject is open. Code checks the reply
and asks again once: cited ids must be in the inputs, an open High adverse matter (this week's or
an earlier week's) must be cited by a concern, labels must be 2 to 4 words without a full stop,
numbers must appear in the inputs, a concern resting only on one-outlet reports must say so, no
status words, dashes or invented FX pairs, and the direction must agree with code's signals (High
adverse and High positive developments for the subject, now against the previous run). A brief
whose direction still disagrees is stored flagged, and the page shows it as unchanged. Code, never
the model, counts the developments in scope, High and adverse and the date of the latest news,
stored with the brief for checks and the API; the page does not show them.

Every input leaves out developments the source gate holds back as unconfirmed
(pipeline/corroboration.py), as the monitor page does.
"""

import asyncio
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.pipeline.answers import answer_problems
from intelmonitor.pipeline.corroboration import Corroboration, corroborations
from intelmonitor.pipeline.detectors import Detection, live_events
from intelmonitor.pipeline.diff import DevelopmentChange, development_changes, previous_run
from intelmonitor.pipeline.facts import key_data, mapped_series, series_fact
from intelmonitor.pipeline.impact import link_words
from intelmonitor.pipeline.indicators import compute_indicators
from intelmonitor.pipeline.inference import ClaudeRefused, Inference, StepFailed
from intelmonitor.pipeline.params import NEEDS_ATTENTION_LEVEL, PRIORITY_LABELS, display_key
from intelmonitor.pipeline.subjects import Subject, monitored_subjects
from intelmonitor.pipeline.wording import day, fx_currency
from intelmonitor.relationships import EVIDENCE_GRADES, RelType, links_from
from intelmonitor.seed import load_series
from intelmonitor.store.series import read_observations

BRIEF_MODEL = "claude-sonnet-5-5"
# The brief's window: developments with a source in the last BRIEF_DAYS days.
BRIEF_DAYS = 7
# Most developments in one prompt (highest priority first) and finding statements per development.
BRIEF_MAX_DEVELOPMENTS = 40
BRIEF_MAX_FINDINGS = 5
# Upcoming dates offered, within this many days of the run date.
BRIEF_UPCOMING_DAYS = 90
BRIEF_MAX_UPCOMING = 12
# Open matters from earlier weeks given as standing context: High for the subject, or adverse to
# it at Medium or above, with their last source in the BRIEF_EARLIER_DAYS before the window.
BRIEF_EARLIER_DAYS = 90
BRIEF_MAX_EARLIER = 3
# The subject's main stored links: these types in this order, the strongest of each first.
BRIEF_LINK_TYPES: tuple[RelType, ...] = (
    "exposed_to",
    "depends_on",
    "participates_in",
    "owns",
    "subsidiary_of",
    "shareholder_of",
    "operates_in",
)
BRIEF_LINKS_PER_TYPE = 2
BRIEF_MAX_LINKS = 6
MAX_CONCERNS = 2
MAX_COMING_UP = 3
# Word limits: the prompt asks for these, and code asks again past a margin of a few words.
STATE_WORDS = 30
CONCERN_WORDS = 25
WORD_MARGIN = 5
# A concern's label: this many words, checked exactly.
LABEL_WORDS = (2, 4)

Direction = Literal["worse", "better", "unchanged", "mixed"]


class BriefConcern(BaseModel):
    """A concern as Claude writes it and the store keeps it. A brief stored before labels reads
    with an empty label."""

    label: str = Field(
        description="2 to 4 words naming its topic, such as Property loans or China stake"
    )
    text: str = Field(
        description="One sentence naming a risk or an opening for the subject and why it matters"
    )
    development_ids: list[str] = Field(
        description="The ids of the developments, open matters and indirect impacts behind it"
    )


# The list limits are in the prompt and the code checks, not the schema: a reply over a limit is
# asked again with the reason, then cut, instead of failing validation.
class BriefDraft(BaseModel):
    state: str = Field(description="One sentence on the subject's situation now")
    concerns: list[BriefConcern] = Field(
        description=f"At most {MAX_CONCERNS}, most serious first; none on a quiet week unless a "
        "matter High and adverse to the subject is open"
    )
    direction: Direction = Field(description="Against the previous brief")
    direction_reason: str = Field(description="One line on why")
    coming_up: list[str] = Field(
        description=f"At most {MAX_COMING_UP} upcoming date ids, such as U1"
    )


BRIEF_SYSTEM = (
    "You are a senior analyst writing the brief at the top of a subject's page on a financial "
    "supervisor's monitoring dashboard. You select what moves the assessment and leave out the "
    "rest, and you claim only what the evidence given supports."
)


@dataclass(frozen=True)
class BriefDevelopment:
    """One of the subject's developments, as the brief sees it: with the subject's own priority,
    adverse flag and tone, its finding statements, and whether one news outlet alone reports
    it."""

    id: str
    title: str
    category: str
    first_published: date
    last_published: date
    role: str  # affected or actor
    priority_level: int
    adverse: bool
    tone: str
    change: Literal["new", "updated"]
    findings: list[str]
    single_outlet: bool

    @property
    def priority(self) -> str:
        return PRIORITY_LABELS[self.priority_level]

    @property
    def high(self) -> bool:
        return self.priority_level >= NEEDS_ATTENTION_LEVEL


@dataclass(frozen=True)
class EarlierMatter:
    """An open matter from before the window: High for the subject, or adverse to it at Medium or
    above, and whether one news outlet alone reports it. Concerns cite it by its id."""

    id: str
    title: str
    last_published: date
    priority_level: int
    adverse: bool
    single_outlet: bool

    @property
    def priority(self) -> str:
        return PRIORITY_LABELS[self.priority_level]

    @property
    def high(self) -> bool:
        return self.priority_level >= NEEDS_ATTENTION_LEVEL


@dataclass(frozen=True)
class BriefImpact:
    """An indirect impact on the subject (pipeline/impact.py), and whether one news outlet alone
    reports the development behind it."""

    development_id: str
    title: str
    last_published: date
    direction: str
    route: str
    why: str
    evidence: str
    confidence: str
    single_outlet: bool


@dataclass(frozen=True)
class UpcomingDate:
    id: str  # U1, U2, in date order
    date: date
    label: str
    development_id: str


@dataclass(frozen=True)
class Signals:
    """What code compares for the direction: the subject's High developments in the window that
    are adverse to it, and those positive for it."""

    adverse_high: int
    positive_high: int


def signals(devs: list[BriefDevelopment]) -> Signals:
    return Signals(
        adverse_high=sum(d.high and d.adverse for d in devs),
        positive_high=sum(d.high and not d.adverse and d.tone == "positive" for d in devs),
    )


def subject_developments(
    conn: sqlite3.Connection,
    run_id: str,
    subject_id: str,
    since: date,
    gate: dict[str, Corroboration],
    changes: dict[str, DevelopmentChange] | None = None,
) -> list[BriefDevelopment]:
    """The run's developments that pass the source gate (`gate`, by id) and the subject was
    affected by or acted in with a source after `since`, in feed order. New or updated comes from
    the run's changes, else from whether its first source falls in the window."""
    rows = conn.execute(
        "SELECT d.id, d.title, d.category, d.first_published, d.last_published, s.role, "
        "s.priority_level, s.adverse, s.tone FROM developments d JOIN development_subjects s "
        "ON s.run_id = d.run_id AND s.development_id = d.id "
        "WHERE d.run_id = ? AND s.subject_id = ? AND d.last_published > ?",
        (run_id, subject_id, since.isoformat()),
    ).fetchall()
    statements: dict[str, list[str]] = {}
    for r in conn.execute(
        "SELECT DISTINCT s.development_id, f.statement FROM development_sources s "
        "JOIN findings f ON f.id = s.finding_id JOIN development_subjects t "
        "ON t.run_id = s.run_id AND t.development_id = s.development_id "
        "WHERE s.run_id = ? AND t.subject_id = ? ORDER BY s.development_id, f.id",
        (run_id, subject_id),
    ):
        statements.setdefault(r["development_id"], []).append(r["statement"])
    out: list[BriefDevelopment] = []
    for r in rows:
        if (backing := gate.get(r["id"])) is None or not backing.shown:
            continue
        first = date.fromisoformat(r["first_published"][:10])
        known = changes.get(r["id"]) if changes is not None else None
        new = known.kind == "new_development" if known else first > since
        out.append(
            BriefDevelopment(
                id=r["id"],
                title=r["title"],
                category=r["category"],
                first_published=first,
                last_published=date.fromisoformat(r["last_published"][:10]),
                role=r["role"],
                priority_level=r["priority_level"],
                adverse=bool(r["adverse"]),
                tone=r["tone"],
                change="new" if new else "updated",
                findings=statements.get(r["id"], [])[:BRIEF_MAX_FINDINGS],
                single_outlet=backing.single_outlet,
            )
        )
    out.sort(key=lambda d: display_key(d.priority_level, d.adverse, d.last_published, d.id))
    return out


def subject_impacts(
    conn: sqlite3.Connection,
    run_id: str,
    subject_id: str,
    since: date,
    gate: dict[str, Corroboration],
) -> list[BriefImpact]:
    """The subject's indirect impacts from developments that pass the source gate (`gate`, by id)
    with a source after `since`."""
    rows = conn.execute(
        "SELECT i.development_id, d.title, d.last_published, i.direction, i.route, i.why, "
        "i.evidence, i.confidence FROM development_impacts i JOIN developments d "
        "ON d.run_id = i.run_id AND d.id = i.development_id "
        "WHERE i.run_id = ? AND i.subject_id = ? AND d.last_published > ? "
        "ORDER BY d.last_published DESC, i.development_id",
        (run_id, subject_id, since.isoformat()),
    ).fetchall()
    return [
        BriefImpact(
            development_id=r["development_id"],
            title=r["title"],
            last_published=date.fromisoformat(r["last_published"][:10]),
            direction=r["direction"],
            route=r["route"],
            why=r["why"],
            evidence=r["evidence"],
            confidence=r["confidence"],
            single_outlet=backing.single_outlet,
        )
        for r in rows
        if (backing := gate.get(r["development_id"])) is not None and backing.shown
    ]


def subject_upcoming(
    conn: sqlite3.Connection, run_id: str, subject_id: str, as_of: date, shown: set[str]
) -> list[UpcomingDate]:
    """Dated items on the subject's shown developments (`shown`, the ids that pass the source
    gate) within BRIEF_UPCOMING_DAYS of the run date."""
    rows = conn.execute(
        "SELECT DISTINCT u.date, u.label, u.development_id FROM upcoming_dates u "
        "JOIN development_subjects s "
        "ON s.run_id = u.run_id AND s.development_id = u.development_id "
        "WHERE u.run_id = ? AND s.subject_id = ? AND u.date >= ? AND u.date <= ? "
        "ORDER BY u.date, u.label",
        (
            run_id,
            subject_id,
            as_of.isoformat(),
            (as_of + timedelta(days=BRIEF_UPCOMING_DAYS)).isoformat(),
        ),
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    out: list[UpcomingDate] = []
    for r in rows:
        if r["development_id"] not in shown:
            continue
        if (r["date"], r["label"].lower()) in seen or len(out) == BRIEF_MAX_UPCOMING:
            continue
        seen.add((r["date"], r["label"].lower()))
        out.append(
            UpcomingDate(
                f"U{len(out) + 1}", date.fromisoformat(r["date"]), r["label"], r["development_id"]
            )
        )
    return out


def key_data_lines(
    conn: sqlite3.Connection, subject_id: str, as_of: date, events: list[Detection]
) -> list[str]:
    """The subject's Key data series as code states them, in the Overview's order
    (pipeline/facts.py `key_data`): latest value, its changes over the windows its frequency
    allows and its range over the brief's week. A series with no data by the date has nothing to
    state and is left out."""
    by_id = {s.id: s for s in load_series().series}
    indicators = compute_indicators(conn, [s.id for s in mapped_series(subject_id)], as_of)
    picked = key_data(subject_id, indicators, events)
    return [
        series_fact(
            by_id[i], by_id, read_observations(conn, i, as_of), indicators[i], as_of, BRIEF_DAYS, []
        ).text
        for i in [*picked.flagged, *picked.rows]
        if indicators[i].state != "no_data"
    ]


def main_links(conn: sqlite3.Connection, subject: Subject) -> list[str]:
    """The subject's main stored relationships in plain words ("DBS has 44.4% of its loans in
    Singapore"): up to BRIEF_LINKS_PER_TYPE of each of BRIEF_LINK_TYPES, the largest share first,
    then the best evidenced, BRIEF_MAX_LINKS in all."""
    links = links_from(conn, subject.id, BRIEF_LINK_TYPES)
    links.sort(
        key=lambda x: (
            BRIEF_LINK_TYPES.index(x[0].type),
            x[0].weight is None,
            -(x[0].weight or 0.0),
            EVIDENCE_GRADES.index(x[0].evidence),
        )
    )
    taken: dict[str, int] = {}
    out: list[str] = []
    for r, to in links:
        if taken.get(r.type, 0) < BRIEF_LINKS_PER_TYPE and len(out) < BRIEF_MAX_LINKS:
            taken[r.type] = taken.get(r.type, 0) + 1
            out.append(f"{subject.name} {link_words(r, to)}")
    return out


def earlier_matters(
    conn: sqlite3.Connection,
    run_id: str,
    subject_id: str,
    since: date,
    gate: dict[str, Corroboration],
) -> list[EarlierMatter]:
    """The subject's open matters from earlier weeks: developments that pass the source gate
    (`gate`, by id) and are High for it, or adverse to it at Medium or above, with their last
    source in the BRIEF_EARLIER_DAYS before the window; High adverse first, as the feed orders
    them. They keep an open matter in the inputs on later quiet weeks instead of living on only
    through the previous brief."""
    rows = conn.execute(
        "SELECT d.id, d.title, d.last_published, s.priority_level AS level, s.adverse "
        "FROM developments d JOIN development_subjects s "
        "ON s.run_id = d.run_id AND s.development_id = d.id "
        "WHERE d.run_id = ? AND s.subject_id = ? AND d.last_published <= ? "
        "AND d.last_published > ? "
        "AND (s.priority_level >= ? OR (s.adverse AND s.priority_level >= 2)) "
        "ORDER BY s.priority_level >= ? DESC, s.adverse DESC, d.last_published DESC, d.id",
        (
            run_id,
            subject_id,
            since.isoformat(),
            (since - timedelta(days=BRIEF_EARLIER_DAYS)).isoformat(),
            NEEDS_ATTENTION_LEVEL,
            NEEDS_ATTENTION_LEVEL,
        ),
    ).fetchall()
    return [
        EarlierMatter(
            id=r["id"],
            title=r["title"],
            last_published=date.fromisoformat(r["last_published"][:10]),
            priority_level=int(r["level"]),
            adverse=bool(r["adverse"]),
            single_outlet=backing.single_outlet,
        )
        for r in rows
        if (backing := gate.get(r["id"])) is not None and backing.shown
    ][:BRIEF_MAX_EARLIER]


@dataclass(frozen=True)
class PreviousBrief:
    as_of: date
    state: str
    direction: str | None
    concerns: list[str]


def stored_concerns(row: sqlite3.Row) -> list[BriefConcern] | None:
    """A run_summaries row's concerns; None for a summary row written before briefs. A brief
    stored before concerns replaced points reads each point's claim as a concern, and one stored
    before labels reads with empty labels."""
    if row["concerns"] is not None:
        return [
            BriefConcern.model_validate({"label": "", **c}) for c in json.loads(row["concerns"])
        ]
    if row["points"] is not None:
        return [
            BriefConcern(label="", text=p["claim"], development_ids=p["development_ids"])
            for p in json.loads(row["points"])
        ]
    return None


def previous_brief(
    conn: sqlite3.Connection, base_id: str | None, subject_id: str
) -> PreviousBrief | None:
    """The previous run's brief of the subject, if a model wrote one: a brief code wrote for a
    subject with no evidence carries nothing to build on, and counting it as evidence would make
    every such subject cost a call in the next run. Its direction is the one the page showed."""
    if base_id is None:
        return None
    row = conn.execute(
        "SELECT * FROM run_summaries WHERE run_id = ? AND subject_id = ? AND model != 'none'",
        (base_id, subject_id),
    ).fetchone()
    if row is None or (concerns := stored_concerns(row)) is None:
        return None
    direction = "unchanged" if row["direction_flagged"] else row["direction"]
    return PreviousBrief(
        date.fromisoformat(base_id), row["text"], direction, [c.text for c in concerns]
    )


@dataclass(frozen=True)
class BriefInputs:
    """Everything one subject's brief is written and checked from."""

    subject: Subject
    as_of: date
    since: date
    base: date | None
    developments: list[BriefDevelopment]  # every one in the window; the prompt gets the first
    impacts: list[BriefImpact]
    events: list[str]
    headline: str | None
    upcoming: list[UpcomingDate]
    key_data: list[str]  # code's sentence per Key data series
    links: list[str]  # its main stored relationships in plain words
    earlier: list[EarlierMatter]
    previous: PreviousBrief | None
    now: Signals
    before: Signals
    latest_news: date | None

    @property
    def prompted(self) -> list[BriefDevelopment]:
        """The developments the prompt lists: the first BRIEF_MAX_DEVELOPMENTS."""
        return self.developments[:BRIEF_MAX_DEVELOPMENTS]

    @property
    def empty(self) -> bool:
        """No evidence at all: nothing this week, earlier or coming, no standing position and no
        previous brief."""
        return not (
            self.developments
            or self.impacts
            or self.events
            or self.upcoming
            or self.key_data
            or self.links
            or self.earlier
            or self.previous
        )


def empty_brief(inp: BriefInputs) -> BriefDraft:
    """The brief code writes, with no model call, when there is no evidence at all."""
    return BriefDraft(
        state=f"No developments in the week to {_short(inp.as_of)}.",
        concerns=[],
        direction="unchanged",
        direction_reason="Nothing new this week.",
        coming_up=[],
    )


def brief_inputs(
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    base_id: str | None,
    subject: Subject,
    changes: dict[str, DevelopmentChange] | None,
) -> BriefInputs:
    since = as_of - timedelta(days=BRIEF_DAYS)
    base = date.fromisoformat(base_id) if base_id else None
    gate = corroborations(conn, run_id)
    shown = {i for i, c in gate.items() if c.shown}
    devs = subject_developments(conn, run_id, subject.id, since, gate, changes)
    before = (
        signals(
            subject_developments(
                conn,
                base_id,
                subject.id,
                base - timedelta(days=BRIEF_DAYS),
                corroborations(conn, base_id),
            )
        )
        if base_id and base
        else Signals(0, 0)
    )
    series = [s.id for s in mapped_series(subject.id)]
    live = live_events(conn, series, as_of, base or since)
    note = conn.execute(
        "SELECT headline FROM run_notes WHERE run_id = ? AND subject_id = ?", (run_id, subject.id)
    ).fetchone()
    latest = max(
        (
            r["last_published"]
            for r in conn.execute(
                "SELECT d.id, d.last_published FROM developments d JOIN development_subjects s "
                "ON s.run_id = d.run_id AND s.development_id = d.id "
                "WHERE d.run_id = ? AND s.subject_id = ?",
                (run_id, subject.id),
            )
            if r["id"] in shown
        ),
        default=None,
    )
    return BriefInputs(
        subject=subject,
        as_of=as_of,
        since=since,
        base=base,
        developments=devs,
        impacts=subject_impacts(conn, run_id, subject.id, since, gate),
        events=[e.statement for e in live],
        headline=note["headline"] if note else None,
        upcoming=subject_upcoming(conn, run_id, subject.id, as_of, shown),
        key_data=key_data_lines(conn, subject.id, as_of, live),
        links=main_links(conn, subject),
        earlier=earlier_matters(conn, run_id, subject.id, since, gate),
        previous=previous_brief(conn, base_id, subject.id),
        now=signals(devs),
        before=before,
        latest_news=date.fromisoformat(latest[:10]) if latest else None,
    )


def _short(d: date) -> str:
    """A date as briefs write it: "30 Sep"."""
    return f"{d.day} {d:%b}"


def _development_lines(d: BriefDevelopment) -> list[str]:
    adverse = "adverse to it" if d.adverse else "not adverse to it"
    sources = (
        _short(d.last_published)
        if d.first_published == d.last_published
        else f"{_short(d.first_published)} to {_short(d.last_published)}"
    )
    head = (
        f"D:{d.id} | {d.title} | {d.priority} priority for it | {adverse} | tone {d.tone} | "
        f"{d.role} | {d.change}, sources {sources}"
        + (" | reported by one outlet" if d.single_outlet else "")
    )
    return [head, *(f"    - {f}" for f in d.findings)]


def brief_prompt(inp: BriefInputs, fx: bool, problems: list[str]) -> str:
    s = inp.subject
    parts = [
        f"Subject: {s.description}.",
        f"Brief as of {day(inp.as_of)}, on developments with a source from "
        f"{day(inp.since + timedelta(days=1))} to {day(inp.as_of)}.",
        "",
    ]
    if (p := inp.previous) is not None:
        parts.append(f"Previous brief, {day(p.as_of)} (direction {p.direction}):")
        parts.append(f"- State: {p.state}")
        parts += [f"- Concern: {c}" for c in p.concerns]
    else:
        parts.append("No previous brief: judge the direction against the week before.")
    parts += ["", "Where the subject stands.", "Key data, latest values and recent moves:"]
    parts += [f"- {k}" for k in inp.key_data] or ["none"]
    parts += ["", "Main links:"]
    parts += [f"- {link}" for link in inp.links] or ["none"]
    parts += ["", "Open matters from earlier weeks, High or adverse to it:"]
    parts += [
        f"D:{m.id} | {m.title} | {m.priority} priority for it | "
        f"{'adverse to it' if m.adverse else 'not adverse to it'} | "
        f"last source {_short(m.last_published)}"
        + (" | reported by one outlet" if m.single_outlet else "")
        for m in inp.earlier
    ] or ["none"]
    parts += [
        "",
        "This week's developments the subject was affected by or acted in, most serious first:",
    ]
    for d in inp.prompted:
        parts += _development_lines(d)
    if not inp.prompted:
        parts.append("none")
    if (hidden := len(inp.developments) - len(inp.prompted)) > 0:
        parts.append(f"({hidden} more at lower priority not shown)")
    parts += [
        "",
        "Indirect impacts: developments not about the subject that reach it through a stored "
        "relationship (exposure, dependency, ownership):",
    ]
    parts += [
        f"I:{i.development_id} | {i.title} | {i.direction} for it | route: {i.route} | {i.why} | "
        f"evidence {i.evidence}, confidence {i.confidence}"
        + (" | reported by one outlet" if i.single_outlet else "")
        for i in inp.impacts
    ] or ["none"]
    parts += ["", "Events flagged on the subject's measured series:"]
    parts += [f"- {e}" for e in inp.events] or ["none"]
    if inp.headline:
        parts += ["", f"Why its series moved this week: {inp.headline}"]
    parts += ["", "Upcoming dates:"]
    parts += [f"{u.id} | {_short(u.date)} | {u.label}" for u in inp.upcoming] or ["none"]
    if problems:
        parts += ["", "Your previous brief broke these rules; write it again without them:"]
        parts += [f"- {p}" for p in problems]
    parts += ["", _rules(s, fx)]
    return "\n".join(parts)


def _rules(s: Subject, fx: bool) -> str:
    opportunity = (
        "\n- This is a topic: opportunities and policy progress count as well as threats."
        if s.type == "topic"
        else "\n- For a market, sector or system, opportunities count as well as threats."
        if s.kind in ("country", "sector", "market_infrastructure", "payment_system")
        else ""
    )
    fx_rule = (
        "\n- Exchange rates: tell a move by the SGD's side (\"SGD weakened 0.55% against the "
        'MYR"); never write pairs such as SGD/MYR or say a rate went up or down.'
        if fx
        else ""
    )
    return f"""Write the brief for a supervisor who opens this page now and then and wants two
answers: where the subject stands, and whether anything needs worrying about. Keep it short.
Selecting is the job: leave out routine, promotional or Low priority items, commentary and items
only loosely about the subject.

- state: one sentence of at most {STATE_WORDS} words on the subject's situation now: its
  standing position from the key data, main links and open matters, and what this week changed
  in it. On a quiet week, with nothing this week worth a concern, say plainly there is nothing
  new to worry about and give the standing position ("Nothing new to worry about this week;
  loans stay concentrated in Singapore and the 19 Mar outage is the last notable incident").
- concerns: at most {MAX_CONCERNS}, the fewest that matter, most serious first, none on a quiet
  week but for the rule on High adverse matters below. Each is one sentence of at most
  {CONCERN_WORDS} words naming a risk or an opening for the subject and why it matters to it;
  group related developments into one concern. An indirect impact is a concern that names its
  route ("through its Thailand loans").
  development_ids lists the D: and I: ids behind it, without the prefix.
- label: each concern's topic in {LABEL_WORDS[0]} to {LABEL_WORDS[1]} words, with no full stop
  ("Property loans", "China stake").
- A development High and adverse to the subject, this week's or an open matter from earlier
  weeks, is always a concern, quiet week or not: at least one concern cites one. A concern on an
  earlier matter says it is still open and does not present it as new.
- A development, open matter or indirect impact marked "reported by one outlet" rests on a
  single news report: a concern that relies only on such items says so ("reported by one
  outlet").
- direction, against the previous brief: worse when something material happened to the subject
  that hurts it (an incident, loss, failure or enforcement at it) beyond what the previous brief
  covered; better when such a problem eased or a material gain happened to it (a binding
  approval, a major win); mixed for both; unchanged otherwise. Commentary, forecasts and
  analysts' or economists' views leave it unchanged whichever way they lean, and so do routine
  and promotional news. direction_reason: one line naming the events behind it.
- coming_up: the U ids of upcoming dates that matter for this subject, at most {MAX_COMING_UP}.
- Build on the previous brief: say what changed against it, and do not present what it already
  covered as new.{opportunity}
- Every sentence must be about the subject or say plainly how another entity's event reaches it.
- Write about the subject, not about these inputs: never say what was collected, provided,
  listed or available.
- Plain words. Never write Watch, Needs attention, focus area, run or runs (meaning this
  report), materiality, priority labels or ids in the text. Do not count developments; the page
  shows counts.
- No dashes as punctuation (no em or en dashes, no spaced hyphens): use commas, colons,
  semicolons or full stops.
- Numbers: quote only numbers the inputs give, as they give them; never compute, convert or
  round new ones. Dates as "30 Sep".{fx_rule}"""


# Status vocabulary the brief must not use, unless the inputs use the same words themselves (a
# rating agency's Watch, say). Only the capitalised status label Watch counts: "a move to watch"
# is plain English.
_STATUS = re.compile(
    r"\b(?:needs attention|(?-i:Watch)\b|watchlist|focus areas?|materiality|"
    r"(?:high|medium|low)[ -](?:priority|items?)|"
    r"(?:this|the|previous|last|latest|next|each) runs?\b(?!-| on))",
    re.IGNORECASE,
)
_DASHES = re.compile(r"[—–]| - ")


def status_words(text: str, allowed: str) -> list[str]:
    """Status and internal words in `text` that the inputs in `allowed` do not use themselves."""
    known = {m.group(0).lower() for m in _STATUS.finditer(allowed)}
    return sorted({m.group(0).lower() for m in _STATUS.finditer(text)} - known)


def brief_text(state: str, direction_reason: str, concerns: list[BriefConcern]) -> str:
    """A brief's prose as the status-word, dash and number checks read it, for the pipeline and the
    eval alike."""
    return "\n".join([state, direction_reason, *(f"{c.label}\n{c.text}" for c in concerns)])


def allowed_text(inp: BriefInputs) -> str:
    """The text a brief may quote numbers and words from."""
    lines = [inp.subject.name]
    for d in inp.prompted:
        lines += [d.title, *d.findings]
    for i in inp.impacts:
        lines += [i.title, i.route, i.why]
    lines += inp.events + ([inp.headline] if inp.headline else [])
    lines += [u.label for u in inp.upcoming] + inp.key_data + inp.links
    lines += [m.title for m in inp.earlier]
    if inp.previous:
        lines += [inp.previous.state, *inp.previous.concerns]
    return "\n".join(lines)


def allowed_directions(now: Signals, before: Signals) -> set[Direction]:
    """The directions code's signals allow. More High adverse developments than the previous week
    is worse (or mixed); fewer allows better or unchanged; a new High positive development allows
    better; equal counts otherwise are unchanged."""
    if now.adverse_high > before.adverse_high:
        return {"worse", "mixed"}
    gain = now.positive_high > before.positive_high
    allowed: set[Direction] = {"unchanged"}
    if now.adverse_high < before.adverse_high or gain:
        allowed.add("better")
        if now.adverse_high > 0:
            allowed.add("mixed")
    return allowed


def direction_basis(inp: BriefInputs) -> str:
    """Code's signals in words."""
    n, b = inp.now, inp.before
    stated = (
        f"{n.adverse_high} High developments adverse to it and {n.positive_high} High positive "
        "for it this week"
    )
    if inp.base is None:
        return f"{stated}; no previous week to compare with"
    return (
        f"{stated}, against {b.adverse_high} and {b.positive_high} in the week to {day(inp.base)}"
    )


# A concern resting only on one-outlet reports must say so ("reported by one outlet").
_HEDGE = re.compile(r"one outlet|\breport(?:s|ed)?\b", re.IGNORECASE)


def _bare(i: str) -> str:
    """A cited id without its D: or I: prefix."""
    return i.removeprefix("D:").removeprefix("I:")


def citable_ids(inp: BriefInputs) -> set[str]:
    """The ids a concern may cite: the prompted developments, the open matters and the indirect
    impacts."""
    return (
        {d.id for d in inp.prompted}
        | {m.id for m in inp.earlier}
        | {i.development_id for i in inp.impacts}
    )


def high_adverse_ids(inp: BriefInputs) -> list[str]:
    """The developments High and adverse to the subject, this week's then the open matters, of
    which a concern must cite at least one."""
    return [d.id for d in inp.prompted if d.high and d.adverse] + [
        m.id for m in inp.earlier if m.high and m.adverse
    ]


def brief_problems(draft: BriefDraft, inp: BriefInputs, allowed: str, fx: bool) -> list[str]:
    """Why a brief is asked again. Empty when it passes every check."""
    problems: list[str] = []
    cited_ids = citable_ids(inp)
    one_outlet = (
        {d.id for d in inp.prompted if d.single_outlet}
        | {m.id for m in inp.earlier if m.single_outlet}
        | {i.development_id for i in inp.impacts if i.single_outlet}
    )
    upcoming_ids = {u.id for u in inp.upcoming}
    if len(draft.concerns) > MAX_CONCERNS:
        problems.append(f"{len(draft.concerns)} concerns: give at most {MAX_CONCERNS}")
    # Only the concerns kept for storage count, so a cut one cannot satisfy the rule.
    cited = {_bare(i) for c in draft.concerns[:MAX_CONCERNS] for i in c.development_ids}
    if (must := high_adverse_ids(inp)) and cited.isdisjoint(must):
        problems.append(
            "no concern cites a development High and adverse to the subject: make one a "
            f"concern, citing one of {must}"
        )
    for n, c in enumerate(draft.concerns, 1):
        ids = [_bare(i) for i in c.development_ids]
        if not ids:
            problems.append(f"concern {n} cites no development")
        if unknown := [i for i in ids if i not in cited_ids]:
            problems.append(
                f"concern {n} cites ids not in the developments, open matters or indirect "
                f"impacts: {unknown}"
            )
        low, high = LABEL_WORDS
        if not low <= (words := len(c.label.split())) <= high:
            problems.append(f"concern {n} label has {words} words: give {low} to {high}")
        if c.label.strip().endswith("."):
            problems.append(f"concern {n} label ends with a full stop: drop it")
        if (words := len(c.text.split())) > CONCERN_WORDS + WORD_MARGIN:
            problems.append(f"concern {n} has {words} words: at most {CONCERN_WORDS}")
        if ids and set(ids) <= one_outlet and not _HEDGE.search(c.text):
            problems.append(
                f'concern {n} rests only on reports by one outlet: say so ("reported by one '
                'outlet")'
            )
    if len(draft.coming_up) > MAX_COMING_UP:
        problems.append(f"{len(draft.coming_up)} coming_up ids: give at most {MAX_COMING_UP}")
    if unknown := [i for i in draft.coming_up if i not in upcoming_ids]:
        problems.append(f"coming_up cites ids not in the upcoming dates: {unknown}")
    if (words := len(draft.state.split())) > STATE_WORDS + WORD_MARGIN:
        problems.append(f"state has {words} words: at most {STATE_WORDS}")
    text = brief_text(draft.state, draft.direction_reason, draft.concerns)
    problems += answer_problems(text, allowed, fx)
    if words := status_words(text, allowed):
        problems.append(f"status or internal words: {', '.join(words)}; say it in plain words")
    if _DASHES.search(text):
        problems.append("dashes as punctuation: use commas, colons, semicolons or full stops")
    if draft.direction not in allowed_directions(inp.now, inp.before):
        problems.append(
            f"direction {draft.direction} does not match the evidence ({direction_basis(inp)}): "
            "worse needs more High developments adverse to the subject than the previous week, "
            "better needs fewer or a new High gain for it. Give direction_reason as the events "
            "themselves, never as priority labels"
        )
    return problems


def _clean(draft: BriefDraft, inp: BriefInputs) -> BriefDraft:
    """The draft with id prefixes dropped, unknown ids removed and lists cut to their limits, as
    stored. Checks run on the raw draft first."""
    cited_ids = citable_ids(inp)
    upcoming_ids = {u.id for u in inp.upcoming}
    concerns = [
        BriefConcern(
            label=c.label.strip().rstrip("."),
            text=c.text.strip(),
            development_ids=list(
                dict.fromkeys(i for x in c.development_ids if (i := _bare(x)) in cited_ids)
            ),
        )
        for c in draft.concerns[:MAX_CONCERNS]
    ]
    return BriefDraft(
        state=draft.state.strip(),
        concerns=concerns,
        direction=draft.direction,
        direction_reason=draft.direction_reason.strip(),
        coming_up=list(dict.fromkeys(u for u in draft.coming_up if u in upcoming_ids))[
            :MAX_COMING_UP
        ],
    )


async def draft_brief(
    inf: Inference, inp: BriefInputs, model: str = BRIEF_MODEL
) -> tuple[BriefDraft, list[str]]:
    """Asks for the subject's brief, once more if it breaks a rule. Returns the cleaned draft and
    the rules it still breaks."""
    fx = any(fx_currency(s) for s in mapped_series(inp.subject.id))
    allowed = allowed_text(inp)
    problems: list[str] = []
    draft: BriefDraft | None = None
    for attempt in range(2):
        prompt = brief_prompt(inp, fx, problems)
        ref = f"subject:{inp.subject.id}" + (f":retry{attempt}" if attempt else "")
        draft = await inf.claude(
            "brief", ref, prompt, BriefDraft, BRIEF_SYSTEM, model=model, effort="high"
        )
        problems = brief_problems(draft, inp, allowed, fx)
        if not problems:
            break
    assert draft is not None
    return _clean(draft, inp), problems


async def summarize_subject(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    base_id: str | None,
    subject: Subject,
    changes: dict[str, DevelopmentChange] | None,
) -> int:
    """Writes the subject's brief for the run. Returns 1 if it still breaks a rule after the
    retry."""
    inp = brief_inputs(conn, run_id, as_of, base_id, subject, changes)
    if inp.empty:
        draft, problems, model = empty_brief(inp), [], "none"
    else:
        (draft, problems), model = await draft_brief(inf, inp), BRIEF_MODEL
    flagged = draft.direction not in allowed_directions(inp.now, inp.before)
    coming = {u.id: u for u in inp.upcoming}
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO run_summaries (run_id, subject_id, text, direction, "
            "direction_basis, developments_in_scope, needs_attention, adverse, model, created_at, "
            "direction_reason, direction_flagged, concerns, coming_up, latest_news, problems) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                subject.id,
                draft.state,
                draft.direction,
                direction_basis(inp),
                len(inp.developments),
                sum(d.high for d in inp.developments),
                sum(d.adverse for d in inp.developments),
                model,
                datetime.now(UTC).isoformat(),
                draft.direction_reason,
                int(flagged),
                json.dumps([c.model_dump() for c in draft.concerns]),
                json.dumps(
                    [
                        {
                            "date": coming[u].date.isoformat(),
                            "label": coming[u].label,
                            "development_id": coming[u].development_id,
                        }
                        for u in draft.coming_up
                    ]
                ),
                inp.latest_news.isoformat() if inp.latest_news else None,
                json.dumps(problems),
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
) -> tuple[int, int, int]:
    """Writes the briefs of the subjects (default every topic and entity, which also drops briefs
    of groups and of subjects no longer seeded). A subject whose brief Claude declines is skipped
    and keeps no brief for the run. Returns (briefs written, briefs still breaking a rule,
    subjects refused)."""
    everyone = monitored_subjects()
    subjects = [everyone[i] for i in subject_ids] if subject_ids else list(everyone.values())
    failures: list[str] = []
    broken = 0
    refused: list[str] = []

    async def one(subject: Subject) -> None:
        nonlocal broken
        try:
            # Awaited before adding: `broken += await ...` reads broken before the await, so
            # concurrent subjects would overwrite each other's counts.
            still_broken = await summarize_subject(
                inf, conn, run_id, as_of, base_id, subject, changes
            )
            broken += still_broken
        except ClaudeRefused:
            refused.append(subject.id)
        except Exception as error:
            failures.append(f"{subject.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(one(s) for s in subjects))
    if failures:
        raise StepFailed("brief", failures)
    with conn:
        conn.executemany(
            "DELETE FROM run_summaries WHERE run_id = ? AND subject_id = ?",
            [(run_id, s) for s in refused],
        )
        if subject_ids is None:
            kept = [s.id for s in subjects]
            conn.execute(
                f"DELETE FROM run_summaries WHERE run_id = ? AND subject_id NOT IN "
                f"({','.join('?' * len(kept))})",
                (run_id, *kept),
            )
    return len(subjects) - len(refused), broken, len(refused)


async def summarize_run(
    conn: sqlite3.Connection, run_id: str, subject_ids: list[str] | None = None
) -> tuple[int, int, int]:
    """`im summarize`: (re)writes a complete run's briefs from its stored rows, against the run
    before it, without recomputing anything else."""
    as_of = date.fromisoformat(run_id)
    base_id = previous_run(conn, run_id)
    changes = development_changes(conn, run_id, base_id)
    return await write_summaries(
        Inference(conn, run_id), conn, run_id, as_of, base_id, changes, subject_ids
    )
