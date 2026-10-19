"""Steps 2 and 3: Jev screens and tags each document in one fan-out call, and the uncertain band
on relevance and subject tags is routed to Claude. Results go to document_tags and
document_subjects, shared by every run."""

import asyncio
import json
import sqlite3
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel
from typesafe_sdk import Choice, Noul

from intelmonitor.pipeline.inference import (
    ClaudeRefused,
    Inference,
    JevAnswers,
    JevQuestion,
    StepFailed,
    choice,
    noul,
)
from intelmonitor.pipeline.params import CHARS_PER_TOKEN, ROUTE_HIGH, ROUTE_LOW, SCREEN_STATE_TOKENS
from intelmonitor.pipeline.subjects import Subject, monitored_subjects
from intelmonitor.seed import load_subjects
from intelmonitor.store.documents import SourceDocument

CATEGORIES: dict[str, str] = {
    "incident": "An operational, technology, cyber or conduct incident at an institution",
    "regulatory": "Rules, consultations, guidance, licensing, supervisory or enforcement action",
    "financial": "Earnings, capital, liquidity, asset quality or other financial results",
    "management": "Senior management or board changes",
    "strategy": "M&A, new products, technology moves, partnerships or market entry",
    "policy": "Monetary, fiscal, FX, trade, tariff or sanctions policy",
    "security": "Geopolitical, military or territorial security events",
    "market": "Market moves, prices, capital flows or depegs",
    "other": "None of the above",
}
Category = Literal[
    "incident",
    "regulatory",
    "financial",
    "management",
    "strategy",
    "policy",
    "security",
    "market",
    "other",
]

STAGES: dict[str, str] = {
    "signal": "A speech, statement or report hinting at future regulation",
    "consultation": "A consultation paper or request for comment",
    "proposed": "A proposed or draft rule, bill or framework",
    "enacted": "A rule, law or framework that has been adopted or taken effect",
    "enforced": "Enforcement: a penalty, sanction, licence action or supervisory finding",
}

JURISDICTIONS: dict[str, str] = {
    "sg": "Singapore",
    "my": "Malaysia",
    "id": "Indonesia",
    "th": "Thailand",
    "vn": "Vietnam",
    "hk": "Hong Kong",
    "cn": "mainland China",
    "tw": "Taiwan",
    "in": "India",
    "au": "Australia",
    "kr": "South Korea",
    "us": "the United States",
    "eu": "the European Union or euro area",
    "uk": "the United Kingdom",
    "jp": "Japan",
    "intl": "international bodies such as the BIS, FSB, Basel Committee, IMF or FATF",
}

Jurisdiction = Literal[
    "sg", "my", "id", "th", "vn", "hk", "cn", "tw", "in", "au", "kr", "us", "eu", "uk", "jp", "intl"
]

# Display names for JURISDICTIONS, which are phrased for the screening prompt.
JURISDICTION_NAMES: dict[Jurisdiction, str] = {
    "sg": "Singapore",
    "my": "Malaysia",
    "id": "Indonesia",
    "th": "Thailand",
    "vn": "Vietnam",
    "hk": "Hong Kong",
    "cn": "China",
    "tw": "Taiwan",
    "in": "India",
    "au": "Australia",
    "kr": "South Korea",
    "us": "United States",
    "eu": "European Union",
    "uk": "United Kingdom",
    "jp": "Japan",
    "intl": "International",
}


def relevance_criterion() -> str:
    """What the dashboard's users track, from subjects.yaml: each topic with what it covers, and
    the entities by name."""
    seed = load_subjects()
    topics = "\n".join(f"- {t.name}: {t.covers}" for t in seed.topics)
    countries = ", ".join(e.name for e in seed.entities if e.kind == "country")
    sectors = ", ".join(e.name for e in seed.entities if e.kind == "sector")
    others = ", ".join(e.name for e in seed.entities if e.kind not in ("country", "sector"))
    return (
        f"Staff at the Monetary Authority of Singapore track these topics:\n{topics}\n"
        f"They also track these institutions and systems: {others}; the economies, markets and "
        f"financial systems of {countries}; and these sectors: {sectors}. A document is relevant "
        "if it reports a concrete development, decision, action, statement or data point on any "
        "of these, including an institution's results, incidents, regulation, management or "
        "strategy, and an economy's markets and policy. Passing mentions, personal finance "
        "advice, generic market wraps, and companies or topics unrelated to these are not "
        "relevant."
    )


@lru_cache
def screen_questions() -> dict[str, JevQuestion]:
    questions: dict[str, JevQuestion] = {
        "relevant": Noul(instructions=f"Is this document relevant? {relevance_criterion()}"),
    }
    for s in monitored_subjects().values():
        questions[f"subject:{s.id}"] = Noul(
            instructions=f"Is this document materially about {s.description}?"
        )
    questions["category"] = Choice(
        instructions="What kind of development does this document mainly report?",
        criteria=dict(CATEGORIES),
    )
    for code, name in JURISDICTIONS.items():
        questions[f"jurisdiction:{code}"] = Noul(
            instructions=f"Does this document report actions, events or policy in {name}?"
        )
    questions["stage"] = Choice(
        instructions="If this document is about regulation, what stage has it reached?",
        criteria=dict(STAGES),
    )
    return questions


def screen_state(doc: SourceDocument) -> tuple[str, bool]:
    """Title, provenance and text for Jev. Text beyond the state budget is cut at a paragraph
    boundary, so long documents are screened on their title plus leading chunks."""
    header = (
        f"Title: {doc.title}\nSource: {doc.domain} ({doc.doc_type}), published "
        f"{doc.published_at:%Y-%m-%d}\n\n"
    )
    budget = SCREEN_STATE_TOKENS * CHARS_PER_TOKEN - len(header)
    if len(doc.text) <= budget:
        return header + doc.text, False
    kept: list[str] = []
    used = 0
    for chunk in doc.text.split("\n\n"):
        if used + len(chunk) + 2 > budget:
            break
        kept.append(chunk)
        used += len(chunk) + 2
    text = "\n\n".join(kept) if kept else doc.text[:budget]
    return header + text, True


class RouteDecision(BaseModel):
    relevant: bool
    subjects: list[str]


ROUTE_SYSTEM = (
    "You review borderline screening decisions for a financial supervisor's monitoring "
    "dashboard. Decide strictly from the document text."
)


def route_prompt(state: str, check_relevance: bool, uncertain: list[Subject]) -> str:
    parts = [f"<document>\n{state}\n</document>\n"]
    if check_relevance:
        parts.append(f"1. Is this document relevant? {relevance_criterion()}\n")
    else:
        parts.append("1. The document is already judged relevant: return relevant = true.\n")
    if uncertain:
        listed = "\n".join(f"- {s.id}: {s.description}" for s in uncertain)
        parts.append(
            "2. Which of these subjects is the document materially about? Return only the ids "
            f"that apply (possibly none).\n{listed}\n"
        )
    else:
        parts.append("2. Return an empty subjects list.\n")
    return "\n".join(parts)


class DocumentScreen(BaseModel):
    """The final screening outcome for one document."""

    relevance: float
    relevant: bool
    relevance_source: Literal["jev", "claude"]
    category: str
    category_confidence: float
    stage: str | None
    stage_confidence: float | None
    subject_scores: dict[str, float]
    jurisdictions: dict[str, float]
    subjects: dict[str, Literal["jev", "claude"]]  # tagged subject id -> who decided
    screened_chars: int
    truncated: bool


async def screen_document(inf: Inference, doc: SourceDocument) -> DocumentScreen:
    state, truncated = screen_state(doc)
    answers: JevAnswers = await inf.jev(
        "screen", f"doc:{doc.id}", state, screen_questions(), confidence_of="relevant"
    )
    relevance = noul(answers, "relevant")
    scores = {s: noul(answers, f"subject:{s}") for s in monitored_subjects()}
    category = choice(answers, "category")
    stage = choice(answers, "stage")
    is_regulatory = category.choice == "regulatory"

    relevant = relevance >= ROUTE_HIGH
    relevance_source: Literal["jev", "claude"] = "jev"
    subjects: dict[str, Literal["jev", "claude"]] = {
        s: "jev" for s, p in scores.items() if p >= ROUTE_HIGH
    }
    uncertain = [monitored_subjects()[s] for s, p in scores.items() if ROUTE_LOW < p < ROUTE_HIGH]
    # A clear "not relevant" next to a clear subject tag is a conflict, so it is uncertain too.
    conflict = relevance <= ROUTE_LOW and bool(subjects)
    check_relevance = ROUTE_LOW < relevance < ROUTE_HIGH or conflict
    if check_relevance or (relevance > ROUTE_LOW and uncertain):
        try:
            decision = await inf.claude(
                "route",
                f"doc:{doc.id}",
                route_prompt(state, check_relevance, uncertain),
                RouteDecision,
                ROUTE_SYSTEM,
            )
        except ClaudeRefused:
            decision = None
        if decision is None:
            # Claude declined this document, so Jev decides the band itself at an even split.
            relevant = relevant or (check_relevance and relevance >= 0.5)
            subjects |= {s.id: "jev" for s in uncertain if scores[s.id] >= 0.5}
        else:
            if check_relevance:
                relevant = decision.relevant
                relevance_source = "claude"
            allowed = {s.id for s in uncertain}
            subjects |= {s: "claude" for s in decision.subjects if s in allowed}

    return DocumentScreen(
        relevance=relevance,
        relevant=relevant,
        relevance_source=relevance_source,
        category=category.choice,
        category_confidence=category.confidence,
        stage=stage.choice if is_regulatory else None,
        stage_confidence=stage.confidence if is_regulatory else None,
        subject_scores=scores,
        jurisdictions={c: noul(answers, f"jurisdiction:{c}") for c in JURISDICTIONS},
        subjects=subjects if relevant else {},
        screened_chars=len(state),
        truncated=truncated,
    )


def store_screen(conn: sqlite3.Connection, doc_id: str, s: DocumentScreen) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO document_tags (document_id, relevance, relevant, "
        "relevance_source, category, category_confidence, stage, stage_confidence, "
        "subject_scores, jurisdictions, screened_chars, truncated) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            doc_id,
            s.relevance,
            int(s.relevant),
            s.relevance_source,
            s.category,
            s.category_confidence,
            s.stage,
            s.stage_confidence,
            json.dumps(s.subject_scores),
            json.dumps(s.jurisdictions),
            s.screened_chars,
            int(s.truncated),
        ),
    )
    conn.execute("DELETE FROM document_subjects WHERE document_id = ?", (doc_id,))
    conn.executemany(
        "INSERT INTO document_subjects (document_id, subject_id, confidence, source) "
        "VALUES (?, ?, ?, ?)",
        [(doc_id, sid, s.subject_scores[sid], src) for sid, src in s.subjects.items()],
    )
    conn.commit()


async def screen_documents(
    inf: Inference, conn: sqlite3.Connection, docs: list[SourceDocument]
) -> dict[str, DocumentScreen]:
    """Screen every document (cached calls are free) and return the outcomes by document id.
    Failures are collected so the other documents still finish; the step then raises."""
    results: dict[str, DocumentScreen] = {}
    failures: list[str] = []

    async def one(doc: SourceDocument) -> None:
        try:
            results[doc.id] = outcome = await screen_document(inf, doc)
        except Exception as error:
            failures.append(f"{doc.id}: {type(error).__name__}: {error}")
            return
        store_screen(conn, doc.id, outcome)

    await asyncio.gather(*(one(d) for d in docs))
    if failures:
        raise StepFailed("screen", failures)
    return results
