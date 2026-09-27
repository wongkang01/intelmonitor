"""Read side of the API: everything is computed from the latest complete run and its base run.

`Queries` is built per request around one connection. The run's developments are loaded once per
run version and shared across requests, since the API reads far more often than runs change."""

import json
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import cached_property
from statistics import median
from typing import get_args

from intelmonitor.pipeline.answers import scope
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.screen import JURISDICTION_NAMES, Category
from intelmonitor.pipeline.subjects import Subject, all_subjects, questions_for
from intelmonitor.seed import load_subjects
from intelmonitor.server.models import (
    STAGE_ORDER,
    AnswerChange,
    AnswerFeedback,
    CategorySeries,
    ChangeCounts,
    ChangedDevelopment,
    Collection,
    CommonIssue,
    DevelopmentChangeKind,
    DevelopmentSummary,
    GroupInsights,
    MemberSeries,
    Note,
    Outlier,
    QuestionAnswerView,
    QuestionStateChange,
    QuestionTrend,
    RunRef,
    StageBucket,
    StageSeries,
    StageTrack,
    State,
    SubjectDetail,
    SubjectLinks,
    SubjectRef,
    SubjectSummary,
    SubjectTrend,
    TrendWeek,
    UpcomingItem,
    WhatChanged,
)

UPCOMING_HORIZON_DAYS = 90
STAGE_LOOKBACK_DAYS = 30
GROUP_LOOKBACK_DAYS = 14
TREND_WEEKS = 12
# Developments at or above this materiality level (Notable) count as material.
MATERIAL_LEVEL = 2
# A source reports on a jurisdiction when Jev scores it at least this likely.
JURISDICTION_THRESHOLD = 0.5
COLLECTION_ORDER: list[Collection] = ["official", "dms", "news"]
# Worst first: the state a subject shows when its answers disagree.
STATE_RANK: dict[State, int] = {"needs_attention": 0, "watch": 1, "new": 2, "stable": 3}


class NoRunError(RuntimeError):
    """No complete pipeline run exists yet."""


class NotFoundError(LookupError):
    """A requested id does not exist."""


def subject(subject_id: str) -> Subject:
    found = all_subjects().get(subject_id)
    if found is None:
        raise NotFoundError(f"subject {subject_id}")
    return found


def subject_ref(subject_id: str) -> SubjectRef:
    s = subject(subject_id)
    seed = load_subjects()
    entity = next((e for e in seed.entities if e.id == subject_id), None)
    topic = next((t for t in seed.topics if t.id == subject_id), None)
    return SubjectRef(
        id=s.id,
        name=s.name,
        type=s.type,
        kind=s.kind,
        logo=entity.logo if entity else None,
        logo_full=entity.logo_full if entity else None,
        icon=topic.icon if topic else None,
    )


def subject_links(subject_id: str) -> SubjectLinks:
    seed = load_subjects()
    s = subject(subject_id)
    if s.type == "topic":
        groups = [g for g in seed.groups if s.id in g.topics]
        topics: list[str] = []
        entities = [m for g in groups for m in g.members]
    elif s.type == "group":
        group = next(g for g in seed.groups if g.id == s.id)
        groups = []
        topics = group.topics
        entities = group.members
    else:
        groups = [g for g in seed.groups if s.id in g.members]
        topics = [t for g in groups for t in g.topics]
        entities = []
    return SubjectLinks(
        topics=[subject_ref(t) for t in dict.fromkeys(topics)],
        groups=[subject_ref(g.id) for g in groups],
        entities=[subject_ref(e) for e in dict.fromkeys(entities)],
    )


def aliases(subject_id: str) -> list[str]:
    return [a for e in load_subjects().entities if e.id == subject_id for a in e.aliases]


def domains(subject_id: str) -> list[str]:
    return [d for e in load_subjects().entities if e.id == subject_id for d in e.domains]


def description(subject_id: str) -> str:
    seed = load_subjects()
    if topic := next((t for t in seed.topics if t.id == subject_id), None):
        return topic.covers
    return subject(subject_id).description


@dataclass(frozen=True)
class RunDevelopments:
    """A run's developments by id, in display order, with the subjects each one is tagged to."""

    by_id: dict[str, DevelopmentSummary]
    subject_ids: dict[str, frozenset[str]]


_run_cache: dict[tuple[str, str], RunDevelopments] = {}


def _load_developments(conn: sqlite3.Connection, run: RunRef) -> RunDevelopments:
    tags: dict[str, list[str]] = {}
    for r in conn.execute(
        "SELECT development_id, subject_id FROM development_subjects WHERE run_id = ? "
        "ORDER BY confidence DESC",
        (run.id,),
    ):
        tags.setdefault(r["development_id"], []).append(r["subject_id"])
    documents: dict[str, set[str]] = {}
    collections: dict[str, set[Collection]] = {}
    jurisdictions: dict[str, set[str]] = {}
    for r in conn.execute(
        "SELECT s.development_id, s.document_id, d.collection, t.jurisdictions "
        "FROM development_sources s JOIN source_documents d ON d.id = s.document_id "
        "LEFT JOIN document_tags t ON t.document_id = s.document_id WHERE s.run_id = ?",
        (run.id,),
    ):
        dev = r["development_id"]
        documents.setdefault(dev, set()).add(r["document_id"])
        collections.setdefault(dev, set()).add(r["collection"])
        scores: dict[str, float] = json.loads(r["jurisdictions"] or "{}")
        jurisdictions.setdefault(dev, set()).update(
            JURISDICTION_NAMES[c]
            for c, p in scores.items()
            if p >= JURISDICTION_THRESHOLD and c in JURISDICTION_NAMES
        )
    changes: dict[str, tuple[str, int]] = {}
    for r in conn.execute(
        "SELECT kind, ref_id, detail FROM run_changes "
        "WHERE run_id = ? AND kind != 'question_state'",
        (run.id,),
    ):
        kind = "new" if r["kind"] == "new_development" else "updated"
        changes[r["ref_id"]] = (kind, len(json.loads(r["detail"])["new_documents"]))
    names = all_subjects()
    by_id: dict[str, DevelopmentSummary] = {}
    for r in conn.execute("SELECT * FROM developments WHERE run_id = ?", (run.id,)):
        change = changes.get(r["id"])
        by_id[r["id"]] = DevelopmentSummary(
            id=r["id"],
            title=r["title"],
            category=r["category"],
            stage=r["stage"],
            event_date=r["event_date"],
            first_published=r["first_published"],
            last_published=r["last_published"],
            materiality_level=r["materiality_level"],
            materiality_label=MATERIALITY_LEVELS[int(r["materiality_level"])],
            needs_attention=bool(r["needs_attention"]),
            adverse=r["adverse"] >= 0.5,
            direction=r["direction"],
            subjects=[subject_ref(s) for s in tags.get(r["id"], []) if s in names],
            source_count=len(documents.get(r["id"], ())),
            collections=[c for c in COLLECTION_ORDER if c in collections.get(r["id"], ())],
            jurisdictions=sorted(jurisdictions.get(r["id"], ())),
            change="new" if change and change[0] == "new" else "updated" if change else None,
            new_source_count=change[1] if change else 0,
        )
    ordered = sorted(by_id.values(), key=_display_key)
    return RunDevelopments(
        by_id={d.id: d for d in ordered},
        subject_ids={d.id: frozenset(tags.get(d.id, [])) for d in ordered},
    )


def _display_key(d: DevelopmentSummary) -> tuple[int, int, int, int, str]:
    """Needing attention first, then changed this run, most material, most recent."""
    return (
        not d.needs_attention,
        d.change is None,
        -d.materiality_level,
        -d.last_published.toordinal(),
        d.id,
    )


def week_spans(as_of: date, weeks: int) -> list[tuple[date, date]]:
    """Consecutive 7-day (start, end) spans, oldest first; the last ends on `as_of`."""
    return [
        (as_of - timedelta(days=7 * i + 6), as_of - timedelta(days=7 * i))
        for i in reversed(range(weeks))
    ]


def weekly_counts(dates: Iterable[date], spans: list[tuple[date, date]]) -> list[int]:
    """How many of the dates fall in each span; dates outside every span are not counted."""
    ds = list(dates)
    return [sum(start <= d <= end for d in ds) for start, end in spans]


def worst_state(states: Iterable[State]) -> State:
    worst: State = "stable"
    for s in states:
        if STATE_RANK[s] < STATE_RANK[worst]:
            worst = s
    return worst


@dataclass(frozen=True)
class QuestionDefView:
    id: str
    label: str
    question: str
    lookback_days: int
    custom: bool


class Queries:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    # ---- runs

    @cached_property
    def _run_row(self) -> sqlite3.Row:
        row = self.conn.execute(
            "SELECT * FROM runs WHERE status = 'complete' ORDER BY as_of DESC LIMIT 1"
        ).fetchone()
        if row is None:
            raise NoRunError("no complete run: run `im run --both` first")
        return row

    @cached_property
    def run(self) -> RunRef:
        r = self._run_row
        return RunRef(id=r["id"], as_of=r["as_of"], previous_run_id=r["previous_run_id"])

    # ---- developments

    @cached_property
    def devs(self) -> RunDevelopments:
        key = (self.run.id, str(self._run_row["finished_at"]))
        if key not in _run_cache:
            _run_cache.clear()
            _run_cache[key] = _load_developments(self.conn, self.run)
        return _run_cache[key]

    def development(self, development_id: str) -> DevelopmentSummary:
        found = self.devs.by_id.get(development_id)
        if found is None:
            raise NotFoundError(f"development {development_id} in run {self.run.id}")
        return found

    def developments_in(self, subject_ids: Iterable[str]) -> list[DevelopmentSummary]:
        """Developments tagged to any of the subjects or, for groups, their members."""
        ids = expand(subject_ids)
        return [d for d in self.devs.by_id.values() if self.devs.subject_ids[d.id] & ids]

    def subject_summary(self, subject_id: str) -> SubjectSummary:
        return SubjectSummary(
            **subject_ref(subject_id).model_dump(),
            aliases=aliases(subject_id),
            new_developments=self.unread_count(subject_id),
            needs_attention=sum(d.needs_attention for d in self.developments_in([subject_id])),
        )

    # ---- review and triage

    @cached_property
    def _changes(self) -> dict[str, list[tuple[str, DevelopmentChangeKind]]]:
        """Each development's changes by the runs up to the latest: (run id, new or updated)."""
        out: dict[str, list[tuple[str, DevelopmentChangeKind]]] = {}
        for r in self.conn.execute(
            "SELECT c.run_id, c.kind, c.ref_id FROM run_changes c JOIN runs r ON r.id = c.run_id "
            "WHERE r.status = 'complete' AND r.as_of <= ? AND c.kind != 'question_state'",
            (self.run.as_of.isoformat(),),
        ):
            kind: DevelopmentChangeKind = "new" if r["kind"] == "new_development" else "updated"
            out.setdefault(r["ref_id"], []).append((r["run_id"], kind))
        return out

    @cached_property
    def _triage(self) -> dict[str, sqlite3.Row]:
        return {
            r["development_id"]: r for r in self.conn.execute("SELECT * FROM development_triage")
        }

    @cached_property
    def _reviews(self) -> dict[str, sqlite3.Row]:
        """Each reviewed subject's latest review: its time and the run it covered."""
        return {
            r["subject_id"]: r
            for r in self.conn.execute(
                "SELECT subject_id, run_id, max(created_at) AS created_at FROM analyst_actions "
                "WHERE kind = 'review' GROUP BY subject_id"
            )
        }

    def baseline(self, subject_id: str) -> str:
        """The run a subject's What changed counts from: the run its last review covered, else the
        previous run. Run ids are their as-of dates, so they compare as strings."""
        review = self._reviews.get(subject_id)
        if review is not None and review["run_id"]:
            return str(review["run_id"])
        return self.run.previous_run_id or ""

    def change_since(self, development_id: str, baseline: str) -> DevelopmentChangeKind | None:
        """New if a run after `baseline` added the development, updated if one only updated it."""
        kinds = {k for run, k in self._changes.get(development_id, []) if run > baseline}
        return "new" if "new" in kinds else "updated" if kinds else None

    def is_read(self, development_id: str, read_run_id: str | None = None) -> bool:
        """Read in or after the latest run that changed it. Pass `read_run_id` to test a state
        not yet in `_triage`."""
        if read_run_id is None:
            row = self._triage.get(development_id)
            read_run_id = row["read_run_id"] if row else None
        if read_run_id is None:
            return False
        return all(run <= read_run_id for run, _ in self._changes.get(development_id, []))

    def is_dismissed(self, development_id: str) -> bool:
        row = self._triage.get(development_id)
        return row is not None and row["dismissed_at"] is not None

    def is_flagged(self, development_id: str) -> bool:
        row = self._triage.get(development_id)
        return row is not None and row["flagged_at"] is not None

    def unread_count(self, subject_id: str) -> int:
        """A subject's "new": developments changed since its review, not read or dismissed."""
        base = self.baseline(subject_id)
        return sum(
            self.change_since(d.id, base) is not None
            and not self.is_read(d.id)
            and not self.is_dismissed(d.id)
            for d in self.developments_in([subject_id])
        )

    def subject_detail(self, subject_id: str) -> SubjectDetail:
        summary = self.subject_summary(subject_id)
        return SubjectDetail(
            **summary.model_dump(),
            description=description(subject_id),
            domains=domains(subject_id),
            links=subject_links(subject_id),
        )

    # ---- standing questions and answers

    def question_defs(self, subject_id: str) -> list[QuestionDefView]:
        """Built-in questions in seed order, then kept custom questions, oldest first."""
        built_in = [
            QuestionDefView(q.id, q.label, q.question, q.lookback_days, False)
            for q in questions_for(subject(subject_id))
        ]
        custom = [
            QuestionDefView(r["id"], r["label"], r["question"], r["lookback_days"], True)
            for r in self.conn.execute(
                "SELECT * FROM custom_questions WHERE subject_id = ? AND status = 'kept' "
                "ORDER BY created_at",
                (subject_id,),
            )
        ]
        return built_in + custom

    def answer(self, subject_id: str, question_id: str) -> QuestionAnswerView:
        """One question's answer in the latest run. Custom questions count whether kept or still
        a draft, so previews (the gallery, Generate) fill and open their evidence too."""
        row = self.conn.execute(
            "SELECT * FROM custom_questions WHERE id = ? AND subject_id = ?",
            (question_id, subject_id),
        ).fetchone()
        defs = (
            [QuestionDefView(row["id"], row["label"], row["question"], row["lookback_days"], True)]
            if row
            else [d for d in self.question_defs(subject_id) if d.id == question_id]
        )
        found = self.answers(subject_id, defs)
        if not found:
            raise NotFoundError(f"answer to {question_id} for {subject_id} in run {self.run.id}")
        return found[0]

    def _answer_rows(self, run_id: str | None, subject_id: str) -> dict[str, sqlite3.Row]:
        if run_id is None:
            return {}
        rows = self.conn.execute(
            "SELECT question_id, summary, state, new_count, development_ids, series_ids, "
            "state_rules FROM question_answers WHERE run_id = ? AND subject_id = ? "
            "UNION ALL SELECT a.question_id, a.summary, a.state, a.new_count, a.development_ids, "
            "'[]', '[]' FROM custom_question_answers a "
            "JOIN custom_questions q ON q.id = a.question_id "
            "WHERE a.run_id = ? AND q.subject_id = ?",
            (run_id, subject_id, run_id, subject_id),
        ).fetchall()
        return {r["question_id"]: r for r in rows}

    def answers(
        self, subject_id: str, defs: list[QuestionDefView] | None = None
    ) -> list[QuestionAnswerView]:
        """Answers in the latest run with their change against the base run. Questions without
        an answer in the latest run (a custom question still being answered) are left out."""
        current = self._answer_rows(self.run.id, subject_id)
        base = self._answer_rows(self.run.previous_run_id, subject_id)
        feedback = self.pending_answer_feedback(subject_id)
        out: list[QuestionAnswerView] = []
        for q in defs if defs is not None else self.question_defs(subject_id):
            a = current.get(q.id)
            if a is None:
                continue
            b = base.get(q.id)
            if b is None:
                change = AnswerChange(
                    kind="first_answer", previous_state=None, previous_summary=None
                )
            else:
                change = AnswerChange(
                    kind="state_changed" if b["state"] != a["state"] else "unchanged",
                    previous_state=b["state"],
                    previous_summary=b["summary"],
                )
            ids = [i for i in json.loads(a["development_ids"]) if i in self.devs.by_id]
            out.append(
                QuestionAnswerView(
                    question_id=q.id,
                    label=q.label,
                    question=q.question,
                    lookback_days=q.lookback_days,
                    custom=q.custom,
                    summary=a["summary"],
                    state=a["state"],
                    new_count=a["new_count"],
                    development_ids=ids,
                    series_ids=json.loads(a["series_ids"]),
                    state_rules=json.loads(a["state_rules"]),
                    change=change,
                    feedback=feedback.get(q.id),
                )
            )
        return out

    def pending_answer_feedback(self, subject_id: str) -> dict[str, AnswerFeedback]:
        """Per question, the latest correction given after the latest run finished."""
        rows = self.conn.execute(
            "SELECT * FROM feedback WHERE kind = 'answer' AND subject_id = ? AND created_at > ? "
            "ORDER BY created_at, id",
            (subject_id, self._run_row["finished_at"] or ""),
        ).fetchall()
        return {r["question_id"]: answer_feedback(r) for r in rows}

    # ---- what changed, upcoming, stages, group insights

    def _scope_baseline(self, requested: list[str]) -> Callable[[Iterable[str]], str]:
        """The run a development's What changed counts from, given its subject tags: the latest
        review among the requested subjects it is shown under."""
        reach = {s: expand([s]) for s in requested}

        def baseline(tags: Iterable[str]) -> str:
            tagged = set(tags)
            return max(
                (self.baseline(s) for s in requested if reach[s] & tagged),
                default=self.run.previous_run_id or "",
            )

        return baseline

    def scope_developments(self, subject_ids: Iterable[str] | None) -> list[ChangedDevelopment]:
        """Every development of the subjects (all developments when None), in display order, with
        its change since the review and its triage state. A development tagged to several of the
        subjects counts from the latest of their reviews."""
        if subject_ids is None:
            requested, devs = list(all_subjects()), list(self.devs.by_id.values())
        else:
            requested = list(dict.fromkeys(subject_ids))
            devs = self.developments_in(requested)
        baseline = self._scope_baseline(requested)
        out: list[ChangedDevelopment] = []
        for d in devs:
            since = self.change_since(d.id, baseline(self.devs.subject_ids[d.id]))
            out.append(
                ChangedDevelopment(
                    **d.model_dump(exclude={"change"}),
                    change=since or d.change,
                    unreviewed=since is not None,
                    read=self.is_read(d.id),
                    flagged=self.is_flagged(d.id),
                    dismissed=self.is_dismissed(d.id),
                )
            )
        return out

    def what_changed(self, subject_ids: Iterable[str]) -> WhatChanged:
        """What changed for the subjects since each was reviewed: reviewing any subject a
        development is shown under clears it here."""
        requested = list(dict.fromkeys(subject_ids))
        baseline = self._scope_baseline(requested)
        devs = [d for d in self.scope_developments(requested) if d.change is not None]
        question_changes: list[QuestionStateChange] = []
        ids = expand(requested)
        for sid in sorted(ids, key=lambda i: list(all_subjects()).index(i)):
            for a in self.answers(sid):
                if a.change.kind == "state_changed" and a.change.previous_state is not None:
                    question_changes.append(
                        QuestionStateChange(
                            subject=subject_ref(sid),
                            question_id=a.question_id,
                            label=a.label,
                            custom=a.custom,
                            from_state=a.change.previous_state,
                            to_state=a.state,
                            summary=a.summary,
                            development_ids=a.development_ids,
                            unreviewed=self.run.id > baseline([sid]),
                        )
                    )
        question_changes.sort(key=lambda c: STATE_RANK[c.to_state])
        return WhatChanged(
            run=self.run,
            reviewed_at=self.reviewed_at(requested),
            **change_counts(devs).model_dump(),
            developments=devs,
            question_changes=question_changes,
        )

    def upcoming(self, subject_ids: Iterable[str]) -> list[UpcomingItem]:
        in_scope = {d.id: d for d in self.developments_in(subject_ids)}
        horizon = self.run.as_of + timedelta(days=UPCOMING_HORIZON_DAYS)
        items: dict[tuple[str, str], UpcomingItem] = {}
        for r in self.conn.execute(
            "SELECT date, label, development_id FROM upcoming_dates WHERE run_id = ? "
            "AND date >= ? AND date <= ? ORDER BY date, label",
            (self.run.id, self.run.as_of.isoformat(), horizon.isoformat()),
        ):
            dev = in_scope.get(r["development_id"])
            if dev is None or (dev.id, r["date"]) in items:
                continue
            items[(dev.id, r["date"])] = UpcomingItem(
                date=r["date"],
                label=r["label"],
                development_id=dev.id,
                development_title=dev.title,
                subjects=dev.subjects,
            )
        return list(items.values())

    def stage_track(self, topic_id: str) -> StageTrack:
        since = self.run.as_of - timedelta(days=STAGE_LOOKBACK_DAYS)
        devs = [d for d in self.developments_in([topic_id]) if d.stage and d.last_published > since]
        buckets: list[StageBucket] = []
        for stage in STAGE_ORDER:
            at = sorted(
                (d for d in devs if d.stage == stage),
                key=lambda d: (-d.materiality_level, -d.last_published.toordinal()),
            )
            buckets.append(StageBucket(stage=stage, count=len(at), developments=at[:3]))
        return StageTrack(lookback_days=STAGE_LOOKBACK_DAYS, stages=buckets)

    def group_insights(self, group_id: str) -> GroupInsights:
        members = list(subject(group_id).members)
        since = self.run.as_of - timedelta(days=GROUP_LOOKBACK_DAYS)
        recent = [d for d in self.developments_in([group_id]) if d.last_published > since]
        common: list[CommonIssue] = []
        per_member: dict[str, list[DevelopmentSummary]] = {m: [] for m in members}
        for d in recent:
            hit = [m for m in members if m in self.devs.subject_ids[d.id]]
            for m in hit:
                per_member[m].append(d)
            if len(hit) >= 2:
                common.append(CommonIssue(development=d, members=[subject_ref(m) for m in hit]))
        common.sort(key=lambda c: (-len(c.members), -c.development.materiality_level))
        counts = {m: len(ds) for m, ds in per_member.items()}
        attention = {m: sum(d.needs_attention for d in ds) for m, ds in per_member.items()}
        typical = median(counts.values()) if counts else 0
        typical_attention = median(attention.values()) if attention else 0
        outliers: list[Outlier] = []
        for m in members:
            reason = None
            if attention[m] > 0 and typical_attention == 0:
                reason = f"{attention[m]} development(s) needing attention; peers have none"
            elif counts[m] >= 2 * typical + 2:
                reason = f"{counts[m]} developments against a peer median of {typical:g}"
            elif counts[m] == 0 and typical >= 3:
                reason = f"No developments against a peer median of {typical:g}"
            if reason:
                outliers.append(
                    Outlier(
                        member=subject_ref(m),
                        reason=reason,
                        developments=counts[m],
                        needs_attention=attention[m],
                    )
                )
        return GroupInsights(
            lookback_days=GROUP_LOOKBACK_DAYS, common_issues=common[:5], outliers=outliers
        )

    # ---- trend

    def trend(self, subject_id: str) -> SubjectTrend:
        """Weekly series over TREND_WEEKS weeks ending on the run date, by first publication of
        the latest run's developments, and each standing question's state in the runs dated
        within those weeks."""
        s = subject(subject_id)
        spans = week_spans(self.run.as_of, TREND_WEEKS)
        devs = self.developments_in([subject_id])
        material = [d for d in devs if d.materiality_level >= MATERIAL_LEVEL]

        def counts(of: Iterable[DevelopmentSummary]) -> list[int]:
            return weekly_counts([d.first_published for d in of], spans)

        runs = [
            RunRef(id=r["id"], as_of=r["as_of"], previous_run_id=r["previous_run_id"])
            for r in self.conn.execute(
                "SELECT id, as_of, previous_run_id FROM runs WHERE status = 'complete' "
                "AND as_of >= ? AND as_of <= ? ORDER BY as_of",
                (spans[0][0].isoformat(), self.run.as_of.isoformat()),
            )
        ]
        answers = [self._answer_rows(r.id, subject_id) for r in runs]
        return SubjectTrend(
            subject=subject_ref(subject_id),
            run=self.run,
            min_materiality_level=MATERIAL_LEVEL,
            weeks=[
                TrendWeek(week_start=start, week_end=end, developments=all_n, material=material_n)
                for (start, end), all_n, material_n in zip(
                    spans, counts(devs), counts(material), strict=True
                )
            ],
            categories=[
                CategorySeries(category=c, counts=counts(d for d in material if d.category == c))
                for c in get_args(Category)
            ],
            stages=[
                StageSeries(stage=stage, counts=counts(d for d in devs if d.stage == stage))
                for stage in STAGE_ORDER
            ]
            if s.type == "topic"
            else None,
            members=[
                MemberSeries(
                    member=subject_ref(m),
                    counts=counts(d for d in devs if m in self.devs.subject_ids[d.id]),
                )
                for m in s.members
            ]
            if s.type == "group"
            else None,
            runs=runs,
            questions=[
                QuestionTrend(
                    question_id=q.id,
                    label=q.label,
                    custom=q.custom,
                    states=[a[q.id]["state"] if q.id in a else None for a in answers],
                )
                for q in self.question_defs(subject_id)
            ],
        )

    # ---- analyst actions

    def reviewed_at(self, subject_ids: Iterable[str]) -> datetime | None:
        """When every one of the subjects was last marked reviewed, or None if one never was."""
        latest: list[datetime] = []
        for sid in set(subject_ids):
            review = self._reviews.get(sid)
            if review is None:
                return None
            latest.append(datetime.fromisoformat(review["created_at"]))
        return min(latest, default=None)

    def notes(self, subject_id: str | None = None, development_id: str | None = None) -> list[Note]:
        """Notes that are not deleted, newest first."""
        rows = self.conn.execute(
            "SELECT * FROM analyst_actions WHERE kind = 'note' AND deleted_at IS NULL "
            "AND (? IS NULL OR subject_id = ?) AND (? IS NULL OR development_id = ?) "
            "ORDER BY created_at DESC, id DESC",
            (subject_id, subject_id, development_id, development_id),
        ).fetchall()
        return [_note(r) for r in rows]

    def note(self, note_id: int) -> Note:
        row = self.conn.execute(
            "SELECT * FROM analyst_actions WHERE id = ? AND kind = 'note' AND deleted_at IS NULL",
            (note_id,),
        ).fetchone()
        if row is None:
            raise NotFoundError(f"note {note_id}")
        return _note(row)


def answer_feedback(r: sqlite3.Row) -> AnswerFeedback:
    return AnswerFeedback(
        id=r["id"],
        subject_id=r["subject_id"],
        question_id=r["question_id"],
        run_id=r["run_id"],
        answer_state=r["answer_state"],
        answer_summary=r["answer_summary"],
        state=r["state"],
        summary_wrong=bool(r["summary_wrong"]),
        development_ids=json.loads(r["development_ids"]),
        reason=r["reason"],
        created_at=r["created_at"],
    )


def _note(r: sqlite3.Row) -> Note:
    return Note(
        id=r["id"],
        subject_id=r["subject_id"],
        development_id=r["development_id"],
        text=r["text"],
        run_id=r["run_id"],
        created_at=r["created_at"],
    )


def change_counts(devs: Iterable[ChangedDevelopment]) -> ChangeCounts:
    """What a Since widget counts: developments changed since the review and not dismissed."""
    counted = [d for d in devs if d.unreviewed and not d.dismissed]
    return ChangeCounts(
        new_count=sum(d.change == "new" and not d.read for d in counted),
        updated_count=sum(d.change == "updated" and not d.read for d in counted),
        needs_attention_count=sum(d.needs_attention for d in counted),
    )


def expand(subject_ids: Iterable[str]) -> set[str]:
    """The subjects plus, for groups, their members."""
    return {i for sid in subject_ids for i in scope(subject(sid))}


def now() -> str:
    return datetime.now(UTC).isoformat()
