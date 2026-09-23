"""Steps 5 and 6: findings that report the same event are merged into Developments, and Jev scores
each development's materiality. Developments are rebuilt per run from the findings in documents
published on or before the run date; a development's id is its earliest finding's id, so the same
event keeps its id from one run to the next."""

import asyncio
import json
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache

import numpy as np
from fastembed import TextEmbedding
from numpy.typing import NDArray
from typesafe_sdk import Noul, Score

from intelmonitor.config import DATA_DIR
from intelmonitor.pipeline.inference import Inference, StepFailed, noul, score
from intelmonitor.pipeline.params import (
    EMBEDDING_MODEL,
    MATERIALITY_LEVELS,
    MERGE_MAX_NEIGHBOURS,
    MERGE_MIN_SIMILARITY,
    MERGE_WINDOW_DAYS,
    NEEDS_ATTENTION_LEVEL,
    SAME_EVENT_THRESHOLD,
)
from intelmonitor.pipeline.subjects import all_subjects

_COLLECTION_RANK = {"dms": 0, "official": 1, "news": 2}


@dataclass(frozen=True)
class RunFinding:
    """A verified finding with what the merge needs from its document and tags."""

    id: str
    document_id: str
    statement: str
    category: str
    event_date: date | None
    subjects: tuple[str, ...]
    first_quote: str
    published: date
    collection: str
    domain: str
    title: str
    stage: str | None
    adverse: float
    direction: str

    @property
    def when(self) -> date:
        return self.event_date or self.published

    @property
    def rank(self) -> tuple[int, date, str]:
        """Primary sources first, then earliest."""
        return (_COLLECTION_RANK.get(self.collection, 3), self.published, self.id)


def load_findings(conn: sqlite3.Connection, as_of: date) -> list[RunFinding]:
    rows = conn.execute(
        "SELECT f.*, d.published_at, d.collection, d.domain, d.title, t.stage, t.adverse, "
        "t.direction FROM findings f JOIN source_documents d ON d.id = f.document_id "
        "JOIN document_tags t ON t.document_id = f.document_id "
        "WHERE substr(d.published_at, 1, 10) <= ? ORDER BY d.published_at, f.id",
        (as_of.isoformat(),),
    ).fetchall()
    return [
        RunFinding(
            id=r["id"],
            document_id=r["document_id"],
            statement=r["statement"],
            category=r["category"],
            event_date=date.fromisoformat(r["event_date"]) if r["event_date"] else None,
            subjects=tuple(json.loads(r["subjects"])),
            first_quote=json.loads(r["quotes"])[0]["text"],
            published=date.fromisoformat(r["published_at"][:10]),
            collection=r["collection"],
            domain=r["domain"],
            title=r["title"],
            stage=r["stage"],
            adverse=r["adverse"],
            direction=r["direction"],
        )
        for r in rows
    ]


@lru_cache
def _embedder() -> TextEmbedding:
    return TextEmbedding(EMBEDDING_MODEL, cache_dir=str(DATA_DIR / "models"))


def embed(texts: list[str]) -> NDArray[np.float32]:
    """Unit-length embeddings, one row per text."""
    vectors = np.array(list(_embedder().embed(texts)), dtype=np.float32)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def candidate_pairs(findings: list[RunFinding]) -> list[tuple[RunFinding, RunFinding]]:
    """Pairs from different documents that share a subject, fall within MERGE_WINDOW_DAYS and are
    similar, keeping each finding's MERGE_MAX_NEIGHBOURS most similar partners."""
    if len(findings) < 2:
        return []
    vectors = embed([f.statement for f in findings])
    sims = vectors @ vectors.T
    pairs: set[tuple[int, int]] = set()
    for i, a in enumerate(findings):
        near: list[tuple[float, int]] = []
        for j, b in enumerate(findings):
            if (
                j != i
                and a.document_id != b.document_id
                and sims[i, j] >= MERGE_MIN_SIMILARITY
                and abs((a.when - b.when).days) <= MERGE_WINDOW_DAYS
                and set(a.subjects) & set(b.subjects)
            ):
                near.append((float(sims[i, j]), j))
        for _, j in sorted(near, reverse=True)[:MERGE_MAX_NEIGHBOURS]:
            pairs.add((min(i, j), max(i, j)))
    ordered = sorted(pairs, key=lambda p: (findings[p[0]].id, findings[p[1]].id))
    return [(findings[i], findings[j]) for i, j in ordered]


SAME_EVENT = Noul(
    instructions=(
        "Do finding A and finding B report the same real-world event or development (the same "
        "announcement, decision, action or incident, possibly described differently), rather than "
        "two separate events on a similar topic?"
    )
)


def _describe(label: str, f: RunFinding) -> str:
    when = f"event date {f.event_date}" if f.event_date else "event date not given"
    return (
        f"Finding {label} (published {f.published} by {f.domain}, {when}):\n{f.statement}\n"
        f'Quote: "{f.first_quote}"'
    )


async def same_event(inf: Inference, a: RunFinding, b: RunFinding) -> float:
    state = f"{_describe('A', a)}\n\n{_describe('B', b)}"
    answers = await inf.jev("same_event", f"pair:{a.id}|{b.id}", state, {"same_event": SAME_EVENT})
    return noul(answers, "same_event")


@dataclass
class Development:
    id: str
    findings: list[RunFinding]
    subjects: dict[str, tuple[float, str]] = field(default_factory=dict[str, tuple[float, str]])
    materiality_level: int = 0
    materiality_score: float = 0.0
    materiality_confidence: float = 0.0

    @property
    def lead(self) -> RunFinding:
        return min(self.findings, key=lambda f: f.rank)

    @property
    def category(self) -> str:
        counts = Counter(f.category for f in self.findings)
        return max(counts, key=lambda c: (counts[c], c == self.lead.category))

    @property
    def stage(self) -> str | None:
        if self.category != "regulatory":
            return None
        stages = Counter(f.stage for f in self.findings if f.stage)
        return stages.most_common(1)[0][0] if stages else None

    @property
    def document_ids(self) -> list[str]:
        return list(dict.fromkeys(f.document_id for f in self.findings))


def cluster(
    findings: list[RunFinding], merges: list[tuple[RunFinding, RunFinding]]
) -> list[Development]:
    """Union the merged pairs; each cluster is one development, id'd by its earliest finding."""
    parent = {f.id: f.id for f in findings}

    def root(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in merges:
        parent[root(a.id)] = root(b.id)
    groups: dict[str, list[RunFinding]] = {}
    for f in findings:
        groups.setdefault(root(f.id), []).append(f)
    devs = [
        Development(id=min(g, key=lambda f: (f.published, f.id)).id, findings=g)
        for g in groups.values()
    ]
    return sorted(devs, key=lambda d: d.id)


MATERIALITY_CRITERIA = [
    f"{name}: {desc}"
    for name, desc in zip(
        MATERIALITY_LEVELS,
        [
            "routine or without consequence for the subjects",
            "small, expected or narrowly local impact",
            "worth knowing; a moderate change for a tracked subject",
            "an important change likely to need supervisory follow-up",
            "severe, urgent or systemic; needs immediate attention",
        ],
        strict=True,
    )
]
MATERIALITY = Score(
    instructions=(
        "How material is this development for a financial supervisor at the Monetary Authority "
        "of Singapore who monitors these subjects?"
    ),
    criteria=MATERIALITY_CRITERIA,
)


def materiality_state(dev: Development) -> str:
    names = ", ".join(all_subjects()[s].name for s in dev.subjects)
    sources = "\n".join(
        f'- {f.published} {f.domain}: {f.title}\n  "{f.first_quote}"'
        for f in sorted(dev.findings, key=lambda f: f.rank)[:6]
    )
    return (
        f"Development: {dev.lead.statement}\nCategory: {dev.category}\nSubjects: {names}\n"
        f"Sources ({len(dev.document_ids)}):\n{sources}"
    )


async def score_materiality(inf: Inference, dev: Development) -> None:
    answers = await inf.jev(
        "materiality",
        f"dev:{dev.id}:{len(dev.findings)}",
        materiality_state(dev),
        {"materiality": MATERIALITY},
    )
    s = score(answers, "materiality")
    # Levels come back indexed 0 to 4 in the order sent; the most likely one is the level.
    dev.materiality_level = max(s.probabilities, key=lambda k: s.probabilities[k])
    dev.materiality_score = s.score
    dev.materiality_confidence = s.confidence


def _subject_confidence(
    conn: sqlite3.Connection, doc_ids: list[str]
) -> dict[tuple[str, str], tuple[float, str]]:
    marks = ",".join("?" for _ in doc_ids)
    rows = conn.execute(
        f"SELECT document_id, subject_id, confidence, source FROM document_subjects "
        f"WHERE document_id IN ({marks})",
        doc_ids,
    ).fetchall()
    return {(r["document_id"], r["subject_id"]): (r["confidence"], r["source"]) for r in rows}


@dataclass
class MergeStats:
    findings: int = 0
    pairs: int = 0
    merged_pairs: int = 0
    developments: int = 0


async def build_developments(
    inf: Inference, conn: sqlite3.Connection, run_id: str, as_of: date
) -> tuple[list[Development], MergeStats]:
    findings = load_findings(conn, as_of)
    pairs = candidate_pairs(findings)
    failures: list[str] = []

    async def decide(a: RunFinding, b: RunFinding) -> bool:
        try:
            return await same_event(inf, a, b) >= SAME_EVENT_THRESHOLD
        except Exception as error:
            failures.append(f"{a.id}|{b.id}: {type(error).__name__}: {error}")
            return False

    decisions = await asyncio.gather(*(decide(a, b) for a, b in pairs))
    if failures:
        raise StepFailed("same_event", failures)
    merges = [p for p, same in zip(pairs, decisions, strict=True) if same]
    devs = cluster(findings, merges)

    tags = _subject_confidence(conn, list({f.document_id for f in findings}))
    for dev in devs:
        for f in dev.findings:
            for sid in f.subjects:
                conf, source = tags.get((f.document_id, sid), (0.0, "claude"))
                best = dev.subjects.get(sid)
                if best is None or conf > best[0]:
                    dev.subjects[sid] = (conf, source)

    async def rate(dev: Development) -> None:
        try:
            await score_materiality(inf, dev)
        except Exception as error:
            failures.append(f"{dev.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(rate(d) for d in devs))
    if failures:
        raise StepFailed("materiality", failures)
    store_developments(conn, run_id, devs)
    return devs, MergeStats(len(findings), len(pairs), len(merges), len(devs))


def store_developments(conn: sqlite3.Connection, run_id: str, devs: list[Development]) -> None:
    for table in ("developments", "development_subjects", "development_sources"):
        conn.execute(f"DELETE FROM {table} WHERE run_id = ?", (run_id,))
    for d in devs:
        published = [f.published for f in d.findings]
        events = [f.event_date for f in d.findings if f.event_date]
        directions = Counter(f.direction for f in d.findings)
        conn.execute(
            "INSERT INTO developments (run_id, id, title, category, stage, event_date, "
            "first_published, last_published, materiality_level, materiality_score, "
            "materiality_confidence, needs_attention, adverse, direction) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                d.id,
                d.lead.statement,
                d.category,
                d.stage,
                min(events).isoformat() if events else None,
                min(published).isoformat(),
                max(published).isoformat(),
                d.materiality_level,
                d.materiality_score,
                d.materiality_confidence,
                int(d.materiality_level >= NEEDS_ATTENTION_LEVEL),
                max(f.adverse for f in d.findings),
                directions.most_common(1)[0][0],
            ),
        )
        conn.executemany(
            "INSERT INTO development_subjects (run_id, development_id, subject_id, confidence, "
            "source) VALUES (?, ?, ?, ?, ?)",
            [(run_id, d.id, sid, c, s) for sid, (c, s) in d.subjects.items()],
        )
        conn.executemany(
            "INSERT INTO development_sources (run_id, development_id, finding_id, document_id) "
            "VALUES (?, ?, ?, ?)",
            [(run_id, d.id, f.id, f.document_id) for f in d.findings],
        )
    conn.commit()
