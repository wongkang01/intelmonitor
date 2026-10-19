"""Step 4: Claude extracts findings from each relevant document, and code keeps only the quotes it
can find verbatim in the document text (findings left without one are dropped). Each finding says
how it involves each subject (its role, whether it reports the cause of harm to it, and the
tone) and whether it is promotional (prd.md sections 7 and 8)."""

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel

from intelmonitor.pipeline.inference import ClaudeRefused, Inference, StepFailed
from intelmonitor.pipeline.params import EXTRACT_MAX_CHARS
from intelmonitor.pipeline.screen import CATEGORIES, Category, DocumentScreen
from intelmonitor.pipeline.subjects import monitored_subjects
from intelmonitor.store.documents import SourceDocument

MIN_QUOTE_CHARS = 20

# Affected and actor make a subject's development: it is listed, scored and flagged for them.
# Commentator and mentioned links are kept apart and never drive a page, priority or impact.
Role = Literal["affected", "actor", "commentator", "mentioned"]
DIRECT_ROLES: tuple[Role, ...] = ("affected", "actor")
Tone = Literal["positive", "negative", "neutral"]
# Where tones disagree evenly, the more telling one wins.
TONE_ORDER: list[Tone] = ["negative", "positive", "neutral"]


class MentionedDate(BaseModel):
    date: str
    label: str


class FindingRole(BaseModel):
    """How a finding involves one subject, as stored per subject on the finding."""

    role: Role
    adverse: bool
    tone: Tone


class SubjectRole(BaseModel):
    subject: str
    role: Role
    adverse: bool
    tone: Tone


class ExtractedFinding(BaseModel):
    statement: str
    subjects: list[SubjectRole]
    promotional: bool
    category: Category
    event_date: str | None
    dates: list[MentionedDate]
    quotes: list[str]


class Extraction(BaseModel):
    findings: list[ExtractedFinding]


EXTRACT_SYSTEM = (
    "You extract findings for a financial supervisor's monitoring dashboard. Every finding must "
    "be supported by exact quotes from the document. Never invent facts or quotes."
)


def extract_prompt(doc: SourceDocument, subject_ids: list[str]) -> str:
    subjects = monitored_subjects()
    listed = "\n".join(f"- {sid}: {subjects[sid].description}" for sid in subject_ids)
    categories = "\n".join(f"- {k}: {v}" for k, v in CATEGORIES.items())
    return f"""<document>
Title: {doc.title}
Source: {doc.domain} ({doc.doc_type}), published {doc.published_at:%Y-%m-%d}

{doc.text[:EXTRACT_MAX_CHARS]}
</document>

Extract the material developments this document reports about these tracked subjects:
{listed}

Return up to 5 findings, one per distinct development. Skip background, history, boilerplate and
anything not about the listed subjects. Return no findings if nothing material is reported.

For each finding:
- statement: one factual, self-contained sentence of at most 35 words (who did what, when).
- subjects: each listed subject the finding involves, with:
  - subject: its id above. Use only these ids.
  - role, one of:
    - affected: the development happened to the subject or directly changes its business,
      finances, operations or obligations, such as an outage at it, a penalty on it, its
      results, or a rule it must follow. For a topic: a development within the topic.
    - actor: the subject did it: decided, announced, launched, issued, bought or set policy.
    - commentator: the subject only gives a view on something else, such as its economists'
      forecast or its chief executive's remarks on another event.
    - mentioned: the subject is named in passing, such as a price line in a market wrap or one
      name in a list.
  - adverse: true when this finding reports an event or change that harms the subject or
    materially threatens it: the cause itself, not a reaction to it. Count it when:
    - something happened at the subject: an outage, breach, fraud, loss, penalty,
      enforcement action, rating downgrade, failure, a key departure under pressure;
    - a harmful trend or change bears directly on the subject: fraud or scam cases against
      its customers rising, defaults or NPLs rising in its book, deposits leaving it, a new
      rule or tax that raises its costs or limits its business.
    Ask: is this finding the cause of harm, or someone describing, forecasting or reacting
    to harm whose cause was reported elsewhere? Only the cause is adverse. Never adverse:
    - commentary, forecasts or outlooks, including the subject's own economists or
      analysts on the economy or another event;
    - market reactions and analyst views: share price moves, price-target changes,
      "investors worry";
    - follow-up reporting on an event already reported, unless it adds a new harm (more
      customers affected, a penalty now imposed);
    - good news, and anything for a commentator or a mentioned subject.
  - tone: positive, negative or neutral, for this subject. Tone is separate from adverse: an
    outlook can be negative in tone without being adverse.
  For example:
  - "DBS economists expect 2026 growth to slow on the Middle East crisis": DBS is a
    commentator, not adverse, and as a forecast it is not adverse for a tagged country either.
  - "DBS shares fell 2% after the outage": a reaction, not adverse; the outage finding is
    adverse.
  - "DBS digital banking down for 5 hours": DBS affected, adverse.
  - "Phishing scams targeting DBS customers doubled this quarter": DBS affected, adverse.
  - "MAS raises capital requirements for D-SIBs from 2027": DBS, OCBC and UOB affected,
    adverse, tone negative.
  - "Net profit rose 9% at DBS": DBS affected, not adverse, tone positive.
- promotional: true when the finding is marketing or routine product news: a product, service
  or campaign launch, an award, a sponsorship, a customer offer, or a pilot or partnership with
  no material consequence yet.
- category, one of:
{categories}
- event_date: the date the development happened, YYYY-MM-DD, or null if the text does not say.
- dates: scheduled or future dates the document gives for this development, such as deadlines,
  effective dates, meetings or consultation closes, each with a short label. YYYY-MM-DD only;
  leave out dates without a specific day.
- quotes: 1 to 3 passages copied character for character from the document text that support
  the statement, each one or two full sentences. No ellipses, no paraphrase, no added words."""


@dataclass(frozen=True)
class VerifiedQuote:
    text: str  # the quote as it appears in the document
    start: int  # offsets into the document text
    end: int


def _fold(ch: str) -> str:
    """Typographic variants that should not fail a verbatim match."""
    return {
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
        "−": "-",
        " ": " ",
        "…": "...",
    }.get(ch, ch).lower()


def _normalize(text: str) -> tuple[str, list[int]]:
    """Folded text with whitespace runs collapsed, plus each output char's offset in `text`."""
    out: list[str] = []
    offsets: list[int] = []
    for i, ch in enumerate(text):
        if ch.isspace():
            if out and out[-1] != " ":
                out.append(" ")
                offsets.append(i)
            continue
        for c in _fold(ch):
            out.append(c)
            offsets.append(i)
    return "".join(out), offsets


def locate_quote(doc_text: str, quote: str) -> VerifiedQuote | None:
    """Find `quote` in the document, ignoring case, whitespace and typographic variants."""
    haystack, offsets = _normalize(doc_text)
    needle = _normalize(quote)[0].strip().strip("\"'").strip()
    if len(needle) < MIN_QUOTE_CHARS:
        return None
    at = haystack.find(needle)
    if at < 0 and needle.endswith("."):
        needle = needle[:-1]
        at = haystack.find(needle)
    if at < 0:
        return None
    start, end = offsets[at], offsets[at + len(needle) - 1] + 1
    return VerifiedQuote(doc_text[start:end], start, end)


def _valid_date(value: str | None) -> str | None:
    try:
        return date.fromisoformat(value).isoformat() if value else None
    except ValueError:
        return None


@dataclass(frozen=True)
class Finding:
    id: str
    document_id: str
    statement: str
    category: str
    event_date: str | None
    roles: dict[str, FindingRole]  # by subject id, in the order Claude gave them
    promotional: bool
    quotes: list[VerifiedQuote]
    dates: list[MentionedDate]


def verify(doc: SourceDocument, allowed: set[str], extraction: Extraction) -> list[Finding]:
    """Keep verified quotes and known subjects; drop findings left without either. Only an
    affected subject or an actor can be adverse."""
    kept: list[Finding] = []
    for f in extraction.findings:
        quotes = [q for raw in f.quotes if (q := locate_quote(doc.text, raw))]
        roles: dict[str, FindingRole] = {}
        for s in f.subjects:
            if s.subject in allowed and s.subject not in roles:
                adverse = s.adverse and s.role in DIRECT_ROLES
                roles[s.subject] = FindingRole(role=s.role, adverse=adverse, tone=s.tone)
        if not quotes or not roles:
            continue
        dates = [
            MentionedDate(date=d, label=m.label) for m in f.dates if (d := _valid_date(m.date))
        ]
        kept.append(
            Finding(
                id=f"{doc.id}-{len(kept)}",
                document_id=doc.id,
                statement=f.statement.strip(),
                category=f.category,
                event_date=_valid_date(f.event_date),
                roles=roles,
                promotional=f.promotional,
                quotes=quotes,
                dates=dates,
            )
        )
    return kept


def store_findings(conn: sqlite3.Connection, doc_id: str, findings: list[Finding]) -> None:
    conn.execute("DELETE FROM findings WHERE document_id = ?", (doc_id,))
    conn.executemany(
        "INSERT INTO findings (id, document_id, statement, category, event_date, subjects, "
        "roles, promotional, quotes, dates) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                f.id,
                f.document_id,
                f.statement,
                f.category,
                f.event_date,
                json.dumps(list(f.roles)),
                json.dumps({s: r.model_dump() for s, r in f.roles.items()}),
                int(f.promotional),
                json.dumps([q.__dict__ for q in f.quotes]),
                json.dumps([d.model_dump() for d in f.dates]),
            )
            for f in findings
        ],
    )
    conn.commit()


@dataclass
class ExtractStats:
    documents: int = 0
    proposed: int = 0  # findings Claude returned
    kept: int = 0  # findings with at least one verified quote
    quotes_proposed: int = 0
    quotes_verified: int = 0
    refused: int = 0  # documents Claude declined


async def extract_documents(
    inf: Inference,
    conn: sqlite3.Connection,
    docs: list[SourceDocument],
    screens: dict[str, DocumentScreen],
) -> tuple[dict[str, list[Finding]], ExtractStats]:
    """Extract findings from every relevant document with at least one tagged subject."""
    results: dict[str, list[Finding]] = {}
    stats = ExtractStats()
    failures: list[str] = []

    async def one(doc: SourceDocument) -> None:
        subject_ids = sorted(screens[doc.id].subjects)
        try:
            extraction = await inf.claude(
                "extract",
                f"doc:{doc.id}",
                extract_prompt(doc, subject_ids),
                Extraction,
                EXTRACT_SYSTEM,
            )
        except ClaudeRefused:
            stats.refused += 1  # Claude declined the document; it contributes no findings
            store_findings(conn, doc.id, [])
            return
        except Exception as error:
            failures.append(f"{doc.id}: {type(error).__name__}: {error}")
            return
        findings = verify(doc, set(subject_ids), extraction)
        stats.documents += 1
        stats.proposed += len(extraction.findings)
        stats.kept += len(findings)
        stats.quotes_proposed += sum(len(f.quotes) for f in extraction.findings)
        stats.quotes_verified += sum(len(f.quotes) for f in findings)
        store_findings(conn, doc.id, findings)
        results[doc.id] = findings

    todo = [d for d in docs if screens[d.id].relevant and screens[d.id].subjects]
    keep = {d.id for d in todo}
    for doc in docs:
        if doc.id not in keep:
            store_findings(conn, doc.id, [])  # screened out: drop findings from earlier passes
    await asyncio.gather(*(one(d) for d in todo))
    if failures:
        raise StepFailed("extract", failures)
    return results, stats
