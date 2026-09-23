"""Step 4: Claude extracts findings from each relevant document, and code keeps only the quotes it
can find verbatim in the document text (findings left without one are dropped)."""

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel

from intelmonitor.pipeline.inference import ClaudeRefused, Inference, StepFailed
from intelmonitor.pipeline.params import EXTRACT_MAX_CHARS
from intelmonitor.pipeline.screen import CATEGORIES, Category, DocumentScreen
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.store.documents import SourceDocument

MIN_QUOTE_CHARS = 20


class MentionedDate(BaseModel):
    date: str
    label: str


class ExtractedFinding(BaseModel):
    statement: str
    subjects: list[str]
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
    subjects = all_subjects()
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
- subjects: the ids above that the finding is about. Use only these ids.
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
    subjects: list[str]
    quotes: list[VerifiedQuote]
    dates: list[MentionedDate]


def verify(doc: SourceDocument, allowed: set[str], extraction: Extraction) -> list[Finding]:
    """Keep verified quotes and known subjects; drop findings left without either."""
    kept: list[Finding] = []
    for f in extraction.findings:
        quotes = [q for raw in f.quotes if (q := locate_quote(doc.text, raw))]
        subjects = [s for s in dict.fromkeys(f.subjects) if s in allowed]
        if not quotes or not subjects:
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
                subjects=subjects,
                quotes=quotes,
                dates=dates,
            )
        )
    return kept


def store_findings(conn: sqlite3.Connection, doc_id: str, findings: list[Finding]) -> None:
    conn.execute("DELETE FROM findings WHERE document_id = ?", (doc_id,))
    conn.executemany(
        "INSERT INTO findings (id, document_id, statement, category, event_date, subjects, "
        "quotes, dates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                f.id,
                f.document_id,
                f.statement,
                f.category,
                f.event_date,
                json.dumps(f.subjects),
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
