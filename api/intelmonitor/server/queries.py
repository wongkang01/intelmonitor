"""Read side of the API: everything is computed from the latest complete run and its base run.

`Queries` is built per request around one connection. The run's developments are loaded once per
run version and shared across requests, since the API reads far more often than runs change."""

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cached_property
from statistics import median

from intelmonitor.pipeline.answers import scope
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.subjects import Subject, all_subjects, questions_for
from intelmonitor.seed import load_subjects
from intelmonitor.server.models import (
    STAGE_ORDER,
    AnswerChange,
    CommonIssue,
    DevelopmentSummary,
    GroupInsights,
    Note,
    Outlier,
    QuestionAnswerView,
    QuestionStateChange,
    RunRef,
    StageBucket,
    StageTrack,
    State,
    SubjectDetail,
    SubjectLinks,
    SubjectRef,
    SubjectSummary,
    UpcomingItem,
    WhatChanged,
)

UPCOMING_HORIZON_DAYS = 90
STAGE_LOOKBACK_DAYS = 30
GROUP_LOOKBACK_DAYS = 14
# Developments at or above this materiality level (Notable) count as material.
MATERIAL_LEVEL = 2
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
    entity = next((e for e in load_subjects().entities if e.id == subject_id), None)
    return SubjectRef(
        id=s.id,
        name=s.name,
        type=s.type,
        kind=s.kind,
        logo=entity.logo if entity else None,
        logo_full=entity.logo_full if entity else None,
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
    sources = {
        r["development_id"]: r["n"]
        for r in conn.execute(
            "SELECT development_id, count(DISTINCT document_id) AS n FROM development_sources "
            "WHERE run_id = ? GROUP BY development_id",
            (run.id,),
        )
    }
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
            source_count=sources.get(r["id"], 0),
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
        devs = self.developments_in([subject_id])
        return SubjectSummary(
            **subject_ref(subject_id).model_dump(),
            aliases=aliases(subject_id),
            new_developments=sum(d.change is not None for d in devs),
            needs_attention=sum(d.needs_attention for d in devs),
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
            "SELECT question_id, summary, state, new_count, development_ids "
            "FROM question_answers WHERE run_id = ? AND subject_id = ? "
            "UNION ALL SELECT a.question_id, a.summary, a.state, a.new_count, a.development_ids "
            "FROM custom_question_answers a JOIN custom_questions q ON q.id = a.question_id "
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
                    change=change,
                )
            )
        return out

    # ---- what changed, upcoming, stages, group insights

    def what_changed(self, subject_ids: Iterable[str]) -> WhatChanged:
        ids = expand(subject_ids)
        devs = [d for d in self.developments_in(ids) if d.change is not None]
        question_changes: list[QuestionStateChange] = []
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
                        )
                    )
        question_changes.sort(key=lambda c: STATE_RANK[c.to_state])
        return WhatChanged(
            run=self.run,
            new_count=sum(d.change == "new" for d in devs),
            updated_count=sum(d.change == "updated" for d in devs),
            needs_attention_count=sum(d.needs_attention for d in devs),
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

    # ---- analyst actions

    def reviewed_at(self, subject_ids: Iterable[str]) -> datetime | None:
        """When every one of the subjects was last marked reviewed, or None if one never was."""
        latest: list[datetime] = []
        for sid in set(subject_ids):
            row = self.conn.execute(
                "SELECT max(created_at) AS at FROM analyst_actions "
                "WHERE kind = 'review' AND subject_id = ?",
                (sid,),
            ).fetchone()
            if row["at"] is None:
                return None
            latest.append(datetime.fromisoformat(row["at"]))
        return min(latest, default=None)

    def notes(self, subject_id: str | None = None, development_id: str | None = None) -> list[Note]:
        rows = self.conn.execute(
            "SELECT * FROM analyst_actions WHERE kind = 'note' "
            "AND (? IS NULL OR subject_id = ?) AND (? IS NULL OR development_id = ?) "
            "ORDER BY created_at DESC, id DESC",
            (subject_id, subject_id, development_id, development_id),
        ).fetchall()
        return [
            Note(
                id=r["id"],
                subject_id=r["subject_id"],
                development_id=r["development_id"],
                text=r["text"],
                run_id=r["run_id"],
                created_at=r["created_at"],
            )
            for r in rows
        ]


def expand(subject_ids: Iterable[str]) -> set[str]:
    """The subjects plus, for groups, their members."""
    return {i for sid in subject_ids for i in scope(subject(sid))}


def now() -> str:
    return datetime.now(UTC).isoformat()
