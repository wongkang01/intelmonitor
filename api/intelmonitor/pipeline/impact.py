"""Step 7: indirect impact over the relationship store (phase1-plan.md, item I).

For each development at Medium priority or above for one of its affected or acting subjects
(the targets), code finds the tracked entities linked to a target in the relationship store
(relationships.candidates), keeps the routes that suit the development (`usable`: a loan
exposure carries only economic and market news, never into the bank's home country) and writes
each route in plain words. One Claude call per development
judges, per candidate, whether the development plausibly reaches it through one of those routes.
The model never supplies a route or a relationship: it picks one of the numbered routes code gave.
The call also gets the sentences in the development's own sources that name each candidate, so a
line such as DBS's US dollar rate sensitivity in an article about the Fed can ground the reason.

Affected candidates go to development_impacts, apart from development_subjects, so an indirect
impact is never shown as news about the entity itself.
"""

import asyncio
import json
import re
import sqlite3
from dataclasses import asdict, dataclass, field, replace
from functools import cache
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.pipeline.inference import ClaudeRefused, Inference, StepFailed
from intelmonitor.pipeline.params import PRIORITY_LABELS
from intelmonitor.pipeline.screen import Category
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.relationships import (
    LOAN_MEASURES,
    Candidate,
    HeadlineMeasure,
    ImpactPath,
    Node,
    Relationship,
    RelType,
    Service,
    candidates,
)
from intelmonitor.seed import EntityKind, load_subjects

# Developments judged: Notable or above (Medium or High priority) for one of their targets.
IMPACT_MIN_LEVEL = 2
# D5a: an exposure counts only with a disclosed share (of loans, reserves, revenue) of at least 5%.
EXPOSURE_MIN_WEIGHT = 0.05
# An exposure (a loan share in a country, region or sector) carries only economic and market
# news. A rule, a strategy move, a management change or an incident in a place binds or hits the
# institutions there, which reach a bank through its own unit in the place (owns, subsidiary_of),
# not through its loans.
EXPOSURE_CATEGORIES: tuple[Category, ...] = ("market", "financial", "policy", "security")
# A second hop into a place counts only through the subject's own unit there: OCBC owns OCBC
# Malaysia, which operates in Malaysia; not UOB depends on AWS, which operates in Singapore.
PLACE_FIRST_HOPS: tuple[RelType, ...] = ("owns", "subsidiary_of")
# Links that never carry impact: a regulator's or an exchange's own news names the institutions
# its rules or listings bind, so extraction tags them directly; the links stay for the graph.
NO_IMPACT: tuple[RelType, ...] = ("supervised_by", "listed_on")
# For the same reason, no path into a regulator or central bank counts: otherwise MEPS+, which
# depends on MAS, would carry every MAS development to every MEPS+ bank. News about MEPS+ itself
# tags MEPS+, and reaches the banks from there.
NO_IMPACT_TARGETS: tuple[EntityKind, ...] = ("regulator", "central_bank")


@cache
def _homes() -> dict[str, str]:
    """Each entity's home country from the seed: DBS, OCBC and UOB to Singapore."""
    return {e.id: e.home for e in load_subjects().entities if e.home is not None}


def usable(path: ImpactPath, category: Category) -> bool:
    """A path counts for impact on a development of `category`: no assumed link, no excluded link
    type, no regulator or central bank at its end, a second hop into a place only through the
    subject's own unit, and any exposure on it discloses a loan share of EXPOSURE_MIN_WEIGHT or
    more (D5a), is not to the lender's home country, and carries economic or market news
    (EXPOSURE_CATEGORIES)."""
    rels = path.relationships
    if path.evidence == "assumed" or path.nodes[-1].kind in NO_IMPACT_TARGETS:
        return False
    if len(rels) == 2 and rels[1].type == "operates_in" and rels[0].type not in PLACE_FIRST_HOPS:
        return False
    for r in rels:
        if r.type in NO_IMPACT:
            return False
        if r.type == "exposed_to" and (
            r.weight is None
            or r.weight < EXPOSURE_MIN_WEIGHT
            or r.to == _homes().get(r.from_)
            or category not in EXPOSURE_CATEGORIES
        ):
            return False
    return True


def impact_candidates(conn: sqlite3.Connection, dev: "ImpactInput") -> list[Candidate]:
    """candidates(dev's targets) less the targets, keeping only paths usable for the development's
    category, best first per candidate. Order: direct links with a loan share, largest first;
    then region-level ones (D5b); then links without a share (vendors, payment systems,
    ownership), by id."""
    found: list[Candidate] = []
    for c in candidates(conn, list(dev.targets)):
        paths = [p for p in c.paths if usable(p, dev.category)]  # already best first
        if paths:
            best = paths[0]
            found.append(
                c.model_copy(
                    update={
                        "paths": paths,
                        "weight": best.weight,
                        "region": best.region,
                        "evidence": best.evidence,
                    }
                )
            )
    return sorted(
        found, key=lambda c: (c.weight is None, c.region is not None, -(c.weight or 0), c.subject)
    )


SERVICE_WORDS: dict[Service, str] = {
    "banking": "banking",
    "blockchain": "blockchain infrastructure",
    "cloud": "cloud services",
    "core_banking": "core banking",
    "custody": "custody",
    "data_centre": "data centre services",
    "distribution": "distribution",
    "market_infrastructure": "market infrastructure",
    "payments": "payments",
    "print_mail": "print and mail",
    "reserve_management": "reserve management",
    "security": "security services",
    "telco": "telecoms",
}

# A link type in plain words, as the graph labels it: "DBS depends on AWS".
LINK_WORDS: dict[RelType, str] = {
    "exposed_to": "lends to",
    "depends_on": "depends on",
    "participates_in": "takes part in",
    "owns": "owns",
    "subsidiary_of": "is a subsidiary of",
    "operates_in": "operates in",
    "supervised_by": "is supervised by",
    "shareholder_of": "is a shareholder of",
    "member_of": "is a member of",
    "listed_on": "is listed on",
}


@dataclass(frozen=True)
class ExposureWords:
    """An exposure measure in plain words. In a sentence, the subject `verb`s a share of its
    `basis` `prep` the target: Circle "holds" 84.9% of its "stablecoin reserves" "in" the Circle
    Reserve Fund. Graph labels read `head` from the from end, `inbound` from the to end, and
    `short` after a share ("84.9% of reserves")."""

    verb: str
    basis: str
    prep: str
    head: str
    inbound: str
    short: str


_LOANS = ExposureWords("has", "loans", "in", "lends to", "lent to by", "loans")
EXPOSURE_WORDS: dict[HeadlineMeasure, ExposureWords] = {
    "gross_customer_loans": _LOANS,
    "loans_by_currency": _LOANS,
    "rwa": _LOANS,
    "reserve_assets": ExposureWords(
        "holds", "stablecoin reserves", "in", "holds reserves in", "holds reserves of", "reserves"
    ),
    "repo_principal": ExposureWords(
        "has", "reserve fund", "in repo with", "repo with", "repo counterparty to", "reserve fund"
    ),
    "revenue": ExposureWords(
        "earns", "revenue", "from", "earns revenue from", "a revenue source of", "revenue"
    ),
    "distribution_costs": ExposureWords(
        "pays",
        "distribution costs",
        "to",
        "pays distribution costs to",
        "paid distribution costs by",
        "distribution costs",
    ),
    "token_supply": ExposureWords(
        "issues", "token supply", "on", "issues tokens on", "carries tokens of", "token supply"
    ),
    "assets_on_platform": ExposureWords(
        "holds",
        "customer assets",
        "in",
        "holds customer assets in",
        "held for customers by",
        "customer assets",
    ),
    "stablecoin_holdings": ExposureWords(
        "holds",
        "stablecoins",
        "issued by",
        "holds stablecoins of",
        "stablecoins held by",
        "stablecoins",
    ),
    "card_volume": ExposureWords(
        "runs", "card volume", "on", "runs card volume on", "carries card volume of", "card volume"
    ),
}


def _exposure_words(r: Relationship) -> ExposureWords:
    return EXPOSURE_WORDS[r.measure] if r.measure else _LOANS


def _place(node: Node) -> str:
    """A place or sector as it reads inside a sentence: a sector's first letter in lower case,
    unless it starts with an acronym (US Treasury securities)."""
    name = node.name
    if node.kind != "sector" or name[:2].isupper():
        return name
    return name[0].lower() + name[1:]


def _share(weight: float) -> str:
    """12.2%, or 100% for a whole number."""
    return f"{weight * 100:.1f}".removesuffix(".0") + "%"


def link_words(r: Relationship, to: Node) -> str:
    """One link in plain words, without its subject: "depends on AWS for cloud services",
    "has 12.2% of its loans in Hong Kong", "holds 84.9% of its stablecoin reserves in the Circle
    Reserve Fund", "owns 40.0% of GXS Bank"."""
    if r.type == "exposed_to":
        w = _exposure_words(r)
        share = f"{_share(r.weight)} of its {w.basis}" if r.weight is not None else w.basis
        return f"{w.verb} {share} {w.prep} {_place(to)}"
    phrase = f"{LINK_WORDS[r.type]} {to.name}"
    if r.type in ("owns", "shareholder_of") and r.weight is not None:
        verb = "owns" if r.type == "owns" else "holds"
        phrase = f"{verb} {_share(r.weight)} of {to.name}"
    if r.type == "depends_on" and r.service:
        phrase += f" for {SERVICE_WORDS[r.service]}"
    if r.chart_reading:
        phrase += " (read from a chart)"
    return phrase


def relationship_label(r: Relationship) -> str:
    """A stored link in plain words without its ends, as the graph labels it: "lends to, 12.2%
    of loans", "earns revenue from, 24% of revenue", "depends on, for cloud services", "owns,
    100%"."""
    if r.type == "exposed_to":
        w = _exposure_words(r)
        if r.weight is None:
            return f"{w.head}, share not disclosed"
        return f"{w.head}, {_share(r.weight)} of {w.short}"
    label = LINK_WORDS[r.type]
    if r.type in ("owns", "shareholder_of") and r.weight is not None:
        label += f", {_share(r.weight)}"
    if r.type == "depends_on" and r.service:
        label += f", for {SERVICE_WORDS[r.service]}"
    return label


# A link type read from its `to` end, as the Related graph labels it: "AWS, depended on by DBS".
INBOUND_WORDS: dict[RelType, str] = {
    "exposed_to": "lent to by",
    "depends_on": "depended on by",
    "participates_in": "used by",
    "owns": "owned by",
    "subsidiary_of": "parent of",
    "operates_in": "hosts",
    "supervised_by": "supervises",
    "shareholder_of": "held by",
    "member_of": "includes",
    "listed_on": "lists",
}


def short_label(r: Relationship, outbound: bool) -> str:
    """A stored link in a few words from one end, for the Related graph: from its `from` end
    when `outbound` ("owns 100%", "24.4% of loans", "depends on"), else from its `to` end
    ("owned 100% by", "3.1% of its loans", "depended on by")."""
    share = _share(r.weight) if r.weight is not None else None
    if r.type == "exposed_to":
        w = _exposure_words(r)
        if share:
            return f"{share} of {w.short}" if outbound else f"{share} of its {w.short}"
        return w.head if outbound else w.inbound
    if r.type == "owns" and share:
        return f"owns {share}" if outbound else f"owned {share} by"
    if r.type == "shareholder_of" and share:
        return f"holds {share}" if outbound else f"{share} held by"
    if not outbound:
        return INBOUND_WORDS[r.type]
    return LINK_WORDS[r.type].removeprefix("is ").removeprefix("a ")


def route_text(path: ImpactPath) -> str:
    """The route in plain words, from the path's nodes and figures: "via its Hong Kong loans,
    12.2% of total"; "takes part in FAST, which depends on BCS for payments"; for a region-level
    exposure, "via its Greater China loans, 13.5% of total, a figure for the whole region
    including Taiwan"."""
    rels, nodes = path.relationships, path.nodes
    first = rels[0]
    loans = first.measure is None or first.measure in LOAN_MEASURES
    if first.type == "exposed_to" and first.weight is not None and loans:
        text = f"via its {_place(nodes[1])} loans, {_share(first.weight)} of total"
        if first.chart_reading:
            text += " (read from a chart)"
    else:
        text = link_words(first, nodes[1])
    for r, to in zip(rels[1:], nodes[2:], strict=True):
        text += f", which {link_words(r, to)}"
    if path.region:
        target = all_subjects()[path.target].name
        text += f", a figure for the whole region including {target}"
    return text


# What one development's call shows the model, at most.
MAX_FINDINGS = 12
MAX_PATHS = 3  # routes per candidate
MAX_PASSAGES = 3  # source passages per candidate
MAX_DOCUMENTS = 8  # documents searched for those passages
PASSAGE_CHARS = 600


@dataclass(frozen=True)
class SourceFinding:
    id: str
    statement: str
    quote: str
    document_id: str
    domain: str
    published: str  # YYYY-MM-DD


@dataclass
class ImpactInput:
    """A development as the impact step reads it from the store."""

    id: str
    title: str
    category: Category
    targets: dict[str, tuple[str, int]]  # subject id: (role, priority level)
    findings: list[SourceFinding] = field(default_factory=list[SourceFinding])

    @property
    def level(self) -> int:
        return max(level for _, level in self.targets.values())


def load_inputs(conn: sqlite3.Connection, run_id: str) -> list[ImpactInput]:
    """The run's developments at IMPACT_MIN_LEVEL or above for some target, with their targets
    and findings, earliest source first."""
    inputs: dict[str, ImpactInput] = {}
    rows = conn.execute(
        "SELECT d.id, d.title, d.category, s.subject_id, s.role, s.priority_level "
        "FROM developments d JOIN development_subjects s "
        "ON s.run_id = d.run_id AND s.development_id = d.id "
        "WHERE d.run_id = ? ORDER BY d.id, s.subject_id",
        (run_id,),
    )
    for r in rows:
        dev = inputs.setdefault(r["id"], ImpactInput(r["id"], r["title"], r["category"], {}))
        dev.targets[r["subject_id"]] = (r["role"], r["priority_level"])
    chosen = {i: d for i, d in inputs.items() if d.level >= IMPACT_MIN_LEVEL}
    for r in conn.execute(
        "SELECT s.development_id, f.id, f.statement, f.quotes, f.document_id, d.domain, "
        "d.published_at FROM development_sources s JOIN findings f ON f.id = s.finding_id "
        "JOIN source_documents d ON d.id = s.document_id WHERE s.run_id = ? "
        "ORDER BY d.published_at, f.id",
        (run_id,),
    ):
        if (dev := chosen.get(r["development_id"])) is not None:
            quotes = json.loads(r["quotes"])
            dev.findings.append(
                SourceFinding(
                    id=r["id"],
                    statement=r["statement"],
                    quote=quotes[0]["text"] if quotes else "",
                    document_id=r["document_id"],
                    domain=r["domain"],
                    published=r["published_at"][:10],
                )
            )
    return list(chosen.values())


@dataclass(frozen=True)
class Passage:
    """A sentence from one of the development's documents that names a candidate, with the next
    one."""

    document_id: str
    domain: str
    published: str
    text: str


_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“‘(\[])")


@cache
def _name_patterns() -> dict[str, re.Pattern[str]]:
    """Each entity subject's name and aliases as one whole-word pattern."""
    patterns: dict[str, re.Pattern[str]] = {}
    for e in load_subjects().entities:
        names = sorted({e.name, *e.aliases}, key=len, reverse=True)
        alternatives = "|".join(re.escape(n) for n in names)
        patterns[e.id] = re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)")
    return patterns


def passages(conn: sqlite3.Connection, dev: ImpactInput, subject_id: str) -> list[Passage]:
    """Up to MAX_PASSAGES passages from the development's documents that name the candidate: the
    naming sentence and the next one, since the substance often follows ("For DBS, the impact is
    less straightforward. The lender said its US dollar book..."). Passages naming fewer other
    entities come first, then in document order."""
    patterns = _name_patterns()
    own = patterns[subject_id]
    others = [p for i, p in patterns.items() if i != subject_id]
    scored: list[tuple[int, int, Passage]] = []
    documents = list(dict.fromkeys(f.document_id for f in dev.findings))[:MAX_DOCUMENTS]
    for document_id in documents:
        row = conn.execute(
            "SELECT text, domain, published_at FROM source_documents WHERE id = ?", (document_id,)
        ).fetchone()
        if row is None:  # an eval case's made-up finding
            continue
        sentences = [
            s.strip()
            for line in row["text"].splitlines()
            if not line.lstrip().startswith("#")
            for s in _SENTENCE_END.split(line.strip())
            if s.strip()
        ]
        for i, sentence in enumerate(sentences):
            if len(sentence) < 30 or not own.search(sentence):
                continue
            text = " ".join(sentences[i : i + 2])[:PASSAGE_CHARS]
            crowd = sum(bool(p.search(text)) for p in others)
            passage = Passage(document_id, row["domain"], row["published_at"][:10], text)
            scored.append((crowd, len(scored), passage))
    chosen: list[Passage] = []
    for _, _, p in sorted(scored, key=lambda x: x[:2]):
        if all(p.text not in c.text and c.text not in p.text for c in chosen):
            chosen.append(p)
        if len(chosen) == MAX_PASSAGES:
            break
    return chosen


Direction = Literal["negative", "positive", "mixed"]
Confidence = Literal["high", "medium", "low"]


class CandidateVerdict(BaseModel):
    subject: str = Field(description="The candidate id")
    affected: bool
    route: int = Field(description="Number of the route the judgement rests on: 1 for R1")
    direction: Direction
    why: str = Field(description="One or two sentences; empty when not affected")
    confidence: Confidence
    findings: list[int] = Field(description="Numbers of the findings relied on: 1 for F1")
    passages: list[int] = Field(description="Numbers of the source passages relied on: 1 for P1")


class ImpactVerdicts(BaseModel):
    candidates: list[CandidateVerdict]


IMPACT_SYSTEM = (
    "You judge indirect impact for a financial supervisor's monitoring dashboard. A development "
    "happened to some entities; other tracked entities are linked to them by stored "
    "relationships: loan exposures, vendor and payment-system dependencies, ownership. For each "
    "linked entity you decide whether the development plausibly affects it through one of the "
    "routes given. You only judge: never add a relationship, a route or a fact the input does "
    "not give."
)


@dataclass(frozen=True)
class Judged:
    """One candidate as shown to the model: its routes and the passages naming it."""

    candidate: Candidate
    paths: list[ImpactPath]
    routes: list[str]
    passages: list[Passage]


def _relationship_line(r: Relationship) -> str:
    when = f"as of {r.as_of}" if r.as_of else f"last confirmed {r.last_confirmed}"
    source = f" Source: {r.source_title}." if r.source_title else ""
    quote = f' "{r.quote}"' if r.quote else ""
    return f"{r.evidence}, {when}. {r.detail}{source}{quote}"


def _target_line(dev: ImpactInput) -> str:
    subjects = all_subjects()
    return ", ".join(
        f"{subjects[i].name} ({role}, {PRIORITY_LABELS[level]} priority)"
        for i, (role, level) in dev.targets.items()
        if i in subjects
    )


def impact_prompt(dev: ImpactInput, judged: list[Judged]) -> str:
    findings = "\n".join(
        f'[F{n}] {f.statement} ({f.domain}, {f.published})\n     Quote: "{f.quote}"'
        for n, f in enumerate(dev.findings[:MAX_FINDINGS], 1)
    )
    blocks: list[str] = []
    for j in judged:
        c = j.candidate
        routes = "\n".join(
            f"[R{n}] {text}\n" + "\n".join(f"     {_relationship_line(r)}" for r in p.relationships)
            for n, (text, p) in enumerate(zip(j.routes, j.paths, strict=True), 1)
        )
        found = "\n".join(
            f'[P{n}] "{p.text}" ({p.domain}, {p.published})' for n, p in enumerate(j.passages, 1)
        )
        blocks.append(
            f'<candidate id="{c.subject}" name="{c.name}">\nRoutes, best first:\n{routes}\n'
            f"Source passages that name {c.name}:\n{found or 'none'}\n</candidate>"
        )
    candidates_text = "\n".join(blocks)
    return f"""<development>
{dev.title}
It directly involves: {_target_line(dev)}
Findings:
{findings}
</development>

<candidates>
{candidates_text}
</candidates>

Return one entry per candidate, in the order given:
- subject: the candidate id.
- affected: true only when the development plausibly changes the candidate's risk, finances,
  operations or obligations through one of its routes. A link alone is not enough: the
  development must bear on what flows through that link. An outage, breach or failure at a
  cloud provider, vendor or payment system affects an institution the evidence shows using it,
  even for a narrow use: say how narrow in why and lower the confidence. The provider's product
  launch, earnings or hiring do not. Falling property prices or a slowdown in a market affect a
  bank with sizeable loans there; a single deal or a speech there usually does not. A larger
  share of loans makes an effect more plausible. A bank that reports only its region's figure
  counts through it: the figure is an upper bound for the place, so say so and lower the
  confidence. An owner rarely inherits its holding's vendor problems. Not affected is the
  expected answer for weak links.
- route: the number of the route that carries the development, 1 for R1. For news about one
  place, take the exposure to that place, or to its region, over a sector-wide figure.
- direction: negative, positive or mixed, for the candidate. Any value when not affected.
- why: one or two sentences for a reader who sees only this sentence, the route and the
  sources: how the development reaches the candidate, in terms of what happened. Use only
  facts and numbers given above. Never write the labels F1, P1 or R1, and never talk about
  "the findings", "the passages" or what they do or do not name; put those numbers in the
  findings and passages fields instead. Do not restate the route; the reader sees it beside
  your sentence. Plain words, no dashes as punctuation. Empty when not affected.
- confidence: high, medium or low.
- findings: numbers of the findings the sentence relies on, 1 for F1.
- passages: numbers of the source passages it relies on, 1 for P1."""


# Prompt labels the model may still leak into why: "(F1, F3)", "in P1", "R2".
_LABEL_REFS = re.compile(r"\s*\((?:[FPR]\d+(?:,\s*)?)+\)|\b(?:in |from |see )?[FPR]\d+\b")


def _strip_labels(why: str) -> str:
    """The why sentence without prompt labels, which the reader cannot resolve."""
    return re.sub(r"\s{2,}", " ", _LABEL_REFS.sub("", why)).replace(" .", ".").strip()


@dataclass(frozen=True)
class Impact:
    """An affected candidate, as development_impacts stores it."""

    subject_id: str
    rank: int  # within the development: by its route, direct loan shares first (see `ranked`)
    direction: Direction
    route: str
    why: str
    confidence: Confidence
    path: ImpactPath  # the route the verdict rests on
    finding_ids: list[str]
    passages: list[Passage]


async def judge(inf: Inference, conn: sqlite3.Connection, dev: ImpactInput) -> list[Impact]:
    """One Claude call over the development's candidates; the affected ones. No candidates, no
    call."""
    found = impact_candidates(conn, dev)
    if not found:
        return []
    judged = [
        Judged(
            candidate=c,
            paths=c.paths[:MAX_PATHS],
            routes=[route_text(p) for p in c.paths[:MAX_PATHS]],
            passages=passages(conn, dev, c.subject),
        )
        for c in found
    ]
    verdicts = await inf.claude(
        "impact", f"dev:{dev.id}", impact_prompt(dev, judged), ImpactVerdicts, IMPACT_SYSTEM
    )
    by_subject = {v.subject: v for v in verdicts.candidates}
    shown = dev.findings[:MAX_FINDINGS]
    impacts: list[Impact] = []
    for order, j in enumerate(judged):
        v = by_subject.get(j.candidate.subject)
        if v is None or not v.affected:
            continue
        n = v.route if 1 <= v.route <= len(j.paths) else 1
        impacts.append(
            Impact(
                subject_id=j.candidate.subject,
                rank=order,
                direction=v.direction,
                route=j.routes[n - 1],
                why=_strip_labels(v.why),
                confidence=v.confidence,
                path=j.paths[n - 1],
                finding_ids=[shown[i - 1].id for i in v.findings if 1 <= i <= len(shown)],
                passages=[j.passages[i - 1] for i in v.passages if 1 <= i <= len(j.passages)],
            )
        )
    return ranked(impacts)


def ranked(impacts: list[Impact]) -> list[Impact]:
    """Impacts in display order, by the route each rests on: direct links with a loan share,
    largest first; then region-level ones (D5b); then links without a share, in candidate
    order. `rank` becomes the position."""
    ordered = sorted(
        impacts,
        key=lambda i: (
            i.path.weight is None,
            i.path.region is not None,
            -(i.path.weight or 0),
            i.rank,
        ),
    )
    return [replace(i, rank=n) for n, i in enumerate(ordered)]


@dataclass
class ImpactStats:
    developments: int = 0  # at Medium priority or above for a target
    judged: int = 0  # of those, with candidates: one Claude call each
    candidates: int = 0
    impacts: int = 0  # affected candidates stored
    refused: int = 0
    calls: int = 0  # Claude calls made, cache hits apart
    cached: int = 0


async def store_impacts(inf: Inference, conn: sqlite3.Connection, run_id: str) -> ImpactStats:
    """Judge the run's developments and replace its development_impacts in one transaction."""
    inputs = load_inputs(conn, run_id)
    stats = ImpactStats(developments=len(inputs))
    calls, cached = inf.calls, inf.cache_hits
    failures: list[str] = []
    results: dict[str, list[Impact]] = {}

    async def one(dev: ImpactInput) -> None:
        n = len(impact_candidates(conn, dev))
        if n:
            stats.judged += 1
            stats.candidates += n
        try:
            results[dev.id] = await judge(inf, conn, dev)
        except ClaudeRefused:
            stats.refused += 1
        except Exception as error:
            failures.append(f"{dev.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(one(d) for d in inputs))
    stats.calls, stats.cached = inf.calls - calls, inf.cache_hits - cached
    if failures:
        raise StepFailed("impact", failures)
    conn.execute("DELETE FROM development_impacts WHERE run_id = ?", (run_id,))
    conn.executemany(
        "INSERT INTO development_impacts (run_id, development_id, subject_id, rank, direction, "
        "route, why, confidence, relationship_ids, weight, region, evidence, finding_ids, "
        "passages) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                run_id,
                dev_id,
                i.subject_id,
                i.rank,
                i.direction,
                i.route,
                i.why,
                i.confidence,
                json.dumps(i.path.relationship_ids),
                i.path.weight,
                i.path.region,
                i.path.evidence,
                json.dumps(i.finding_ids),
                json.dumps([asdict(p) for p in i.passages]),
            )
            for dev_id, impacts in results.items()
            for i in impacts
        ],
    )
    conn.commit()
    stats.impacts = sum(len(v) for v in results.values())
    return stats
