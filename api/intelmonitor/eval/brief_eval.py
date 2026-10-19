"""Judged brief eval (phase1-plan.md, item B): Opus 5.5 judges each listed subject's brief against
the evidence it was written from, on the latest complete run of a store (the app's by default).

For each brief the judge checks that:
- every concern is supported by the developments, open matters and indirect impacts it cites;
- the subject's top High developments in the window are covered (by a concern or the state), or
  rightly left out (the previous week's brief, which the judge also sees, may already have
  covered them);
- the state and direction agree with the concerns and the evidence, including the subject's
  standing position (Key data, main links, open matters);
- nothing is stale (an earlier event presented as this week's news) or about another entity as if
  it were the subject's own.
Code adds its own checks on the stored brief: status words and the rules still broken after the
retry. A brief passes when the judge finds no fault and code finds none.

`uv run python -m intelmonitor.eval brief [store path] [subject ...]` judges the stored briefs,
read only. `... brief-compare [store path] [subject ...]` copies the store to
eval-runs/.../db/brief-compare.db, writes each subject's brief on Opus 5.5 there too, and judges
both models' briefs on the same inputs (the one-off model comparison). Judge calls are cached
under the eval directory, so a rerun replays them. Writes brief_eval.json or brief_compare.json.
"""

import json
import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field

from intelmonitor.eval.common import EVAL_DIR, JUDGE_MODEL, ask
from intelmonitor.pipeline.diff import development_changes, previous_run
from intelmonitor.pipeline.inference import Inference
from intelmonitor.pipeline.subjects import monitored_subjects
from intelmonitor.pipeline.summaries import (
    BriefConcern,
    BriefDraft,
    BriefInputs,
    allowed_text,
    brief_inputs,
    brief_text,
    draft_brief,
    status_words,
    stored_concerns,
)
from intelmonitor.store.db import DB_PATH, connect

# DBS, UOB and OCBC (the Singapore banks group is no longer monitored, decision S3), a cloud
# provider for TCRD and an FMD topic.
SUBJECTS = ["dbs", "uob", "ocbc", "aws", "singapore-equities"]
COMPARE_MODEL = "claude-opus-5-5"
# The subject's High developments in the window the judge checks coverage of, newest first.
TOP_HIGH = 5


@dataclass(frozen=True)
class Brief:
    """A brief as the judge sees it, stored or freshly drafted."""

    state: str
    direction: str
    direction_reason: str
    concerns: list[BriefConcern]
    coming_up: list[tuple[date, str]]
    problems: list[str]  # rules the pipeline's checks still found broken
    model: str  # none when code wrote it


class ConcernCheck(BaseModel):
    concern: int = Field(description="The concern's number, from 1")
    supported: bool = Field(description="It is supported by its cited developments and impacts")
    reason: str


class HighCheck(BaseModel):
    development_id: str
    covered: bool = Field(description="A concern or the state covers it")
    rightly_left_out: bool = Field(
        description="Not covered, and leaving it out is right: it does not change the assessment"
    )
    reason: str


class BriefJudgement(BaseModel):
    concerns: list[ConcernCheck]
    top_high: list[HighCheck]
    consistent: bool = Field(description="State and direction agree with the concerns")
    consistency_reason: str
    stale_or_other: list[str] = Field(
        description="Each statement that is stale (an earlier event shown as this week's news) or "
        "about another entity as if it were the subject's own; empty if none"
    )
    verdict: str = Field(description="One or two sentences on the brief's quality")


JUDGE_SYSTEM = (
    "You are a strict, fair reviewer of briefs written for a financial supervisor's monitoring "
    "dashboard. Judge only from the evidence given, and apply the same standard to every brief."
)


def stored_brief(conn: sqlite3.Connection, run_id: str, subject_id: str) -> Brief | None:
    row = conn.execute(
        "SELECT * FROM run_summaries WHERE run_id = ? AND subject_id = ?", (run_id, subject_id)
    ).fetchone()
    if row is None or (concerns := stored_concerns(row)) is None:
        return None
    return Brief(
        state=row["text"],
        # As the page shows it: a flagged direction is unchanged, with no reason.
        direction="unchanged" if row["direction_flagged"] else row["direction"],
        direction_reason="" if row["direction_flagged"] else row["direction_reason"],
        concerns=concerns,
        coming_up=[
            (date.fromisoformat(c["date"]), c["label"]) for c in json.loads(row["coming_up"])
        ],
        problems=json.loads(row["problems"]),
        model=row["model"],
    )


def drafted_brief(draft: BriefDraft, problems: list[str], inp: BriefInputs, model: str) -> Brief:
    upcoming = {u.id: u for u in inp.upcoming}
    return Brief(
        state=draft.state,
        direction=draft.direction,
        direction_reason=draft.direction_reason,
        concerns=draft.concerns,
        coming_up=[(upcoming[u].date, upcoming[u].label) for u in draft.coming_up],
        problems=problems,
        model=model,
    )


def top_high(inp: BriefInputs) -> list[str]:
    """The subject's High developments in the window, adverse first, then newest."""
    high = [d for d in inp.developments if d.high]
    high.sort(key=lambda d: (-d.adverse, -d.last_published.toordinal(), d.id))
    return [d.id for d in high[:TOP_HIGH]]


def judge_prompt(inp: BriefInputs, brief: Brief) -> str:
    parts = [
        f"Subject: {inp.subject.description}.",
        f"The brief is as of {inp.as_of:%d %b %Y} and covers developments with a source after "
        f"{inp.since:%d %b %Y}. Developments are listed with the subject's priority for each "
        "(High, Medium or Low), whether it reports the cause of harm to the subject (adverse), "
        "the subject's role, whether the development is new this week or an update, and whether "
        "one news outlet alone reports it.",
        "",
        "The subject's standing position. Key data:",
        *([f"- {k}" for k in inp.key_data] or ["none"]),
        "Main links:",
        *([f"- {link}" for link in inp.links] or ["none"]),
        "Open matters from earlier weeks, High or adverse to it:",
        *(
            [
                f"[{m.id}] {m.title} (last source {m.last_published}, {m.priority}"
                f"{', adverse' if m.adverse else ''}"
                f"{', reported by one outlet' if m.single_outlet else ''})"
                for m in inp.earlier
            ]
            or ["none"]
        ),
        "",
        "Evidence: the subject's developments this week",
    ]
    for d in inp.developments:
        parts.append(
            f"[{d.id}] {d.title} | {d.priority} | {'adverse' if d.adverse else 'not adverse'} | "
            f"tone {d.tone} | {d.role} | {d.change} | sources {d.first_published} to "
            f"{d.last_published}{' | reported by one outlet' if d.single_outlet else ''}"
        )
        parts += [f"    - {f}" for f in d.findings]
    if not inp.developments:
        parts.append("none")
    parts += ["", "Indirect impacts (developments reaching the subject through a relationship):"]
    parts += [
        f"[{i.development_id}] {i.title} | {i.direction} | route: {i.route} | {i.why}"
        f"{' | reported by one outlet' if i.single_outlet else ''}"
        for i in inp.impacts
    ] or ["none"]
    parts += ["", "Series events:"] + ([f"- {e}" for e in inp.events] or ["none"])
    if inp.headline:
        parts.append(f"Why its series moved this week: {inp.headline}")
    parts += ["", "Upcoming dates:"]
    parts += [f"- {u.date} {u.label}" for u in inp.upcoming] or ["none"]
    # The brief is told to build on the previous one and not repeat what it covered.
    if (prev := inp.previous) is not None:
        parts += ["", f"Previous week's brief, {prev.as_of:%d %b %Y}, which the brief builds on:"]
        parts += [f"- State: {prev.state}", *(f"- Concern: {c}" for c in prev.concerns)]
    parts += ["", "The brief:", f"State: {brief.state}"]
    parts.append(f"Direction: {brief.direction}. {brief.direction_reason}")
    for n, c in enumerate(brief.concerns, 1):
        parts.append(f"Concern {n}: {f'{c.label}. ' if c.label else ''}{c.text}")
        parts.append(f"    cites {', '.join(c.development_ids) or 'nothing'}")
    parts.append(
        "Coming up: " + ("; ".join(f"{d} {label}" for d, label in brief.coming_up) or "none")
    )
    high = top_high(inp)
    parts += [
        "",
        f"Top High developments to check coverage of: {', '.join(high) or 'none'}",
        "",
        """Judge the brief:
- concerns: for each concern, whether it is supported by the developments, open matters and
  indirect impacts it cites, with the standing position, series events and upcoming dates as
  further evidence (why it matters may draw a reasonable consequence for the subject, but no new
  facts). A
  concern resting only on developments reported by one outlet must say so. A reference to what
  the previous week's brief said is supported when that brief says it.
- top_high: for each listed development, whether the brief covers it, and if not whether leaving
  it out is right because it does not change the assessment of the subject or the previous
  week's brief already covered it.
- consistent: whether the state and the direction agree with the concerns and the evidence
  (any of the evidence above, including the standing position, series events and upcoming
  dates). On a quiet week the state says there is nothing new to worry about and gives the
  standing position, with no concerns.
  A direction of worse needs something material that hurt the subject this week; commentary
  and analysts' views alone leave it unchanged.
- stale_or_other: statements that present an event from before the window as this week's news,
  or describe another entity's event as the subject's own.""",
    ]
    return "\n".join(parts)


class BriefResult(BaseModel):
    subject_id: str
    run_id: str
    model: str
    ok: bool
    faults: list[str]
    brief: dict[str, object]
    judgement: BriefJudgement


async def judge_brief(inp: BriefInputs, brief: Brief, run_id: str) -> BriefResult:
    """The judge's verdict plus code's checks; faults list every reason the brief fails."""
    judgement = await ask(
        "brief_judge", JUDGE_MODEL, JUDGE_SYSTEM, judge_prompt(inp, brief), BriefJudgement
    )
    faults = [
        f"concern {c.concern} unsupported: {c.reason}"
        for c in judgement.concerns
        if not c.supported
    ]
    faults += [
        f"top High {h.development_id} missed: {h.reason}"
        for h in judgement.top_high
        if not h.covered and not h.rightly_left_out
    ]
    if not judgement.consistent:
        faults.append(f"inconsistent: {judgement.consistency_reason}")
    faults += [f"stale or about another entity: {s}" for s in judgement.stale_or_other]
    text = brief_text(brief.state, brief.direction_reason, brief.concerns)
    if words := status_words(text, allowed_text(inp)):
        faults.append(f"status words: {', '.join(words)}")
    faults += [f"pipeline check: {p}" for p in brief.problems]
    return BriefResult(
        subject_id=inp.subject.id,
        run_id=run_id,
        model=brief.model,
        ok=not faults,
        faults=faults,
        brief={
            "state": brief.state,
            "direction": brief.direction,
            "direction_reason": brief.direction_reason,
            "concerns": [c.model_dump() for c in brief.concerns],
            "coming_up": [f"{d} {label}" for d, label in brief.coming_up],
        },
        judgement=judgement,
    )


def _open(path: Path, read_only: bool) -> tuple[sqlite3.Connection, str]:
    """The store and its latest complete run."""
    uri = f"{path.resolve().as_uri()}{'?mode=ro' if read_only else ''}"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id FROM runs WHERE status = 'complete' ORDER BY as_of DESC LIMIT 1"
    ).fetchone()
    if row is None:
        raise SystemExit(f"no complete run in {path}")
    return conn, str(row["id"])


def _inputs(conn: sqlite3.Connection, run_id: str, subject_id: str) -> BriefInputs:
    """The subject's brief inputs as the run built them: against the same previous run, with
    new or updated from the same diff."""
    base_id = previous_run(conn, run_id)
    return brief_inputs(
        conn,
        run_id,
        date.fromisoformat(run_id),
        base_id,
        monitored_subjects()[subject_id],
        development_changes(conn, run_id, base_id),
    )


def _report(title: str, results: list[BriefResult], out: str) -> None:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    (EVAL_DIR / out).write_text(json.dumps([r.model_dump(mode="json") for r in results], indent=2))
    lines = [title, "", "| Subject | Model | Result | Faults |", "|---|---|---|---|"]
    lines += [
        f"| {r.subject_id} | {r.model} | {'pass' if r.ok else 'FAIL'} | "
        f"{'; '.join(r.faults) or r.judgement.verdict} |"
        for r in results
    ]
    print("\n".join(lines))


async def run(path: Path = DB_PATH, subjects: list[str] | None = None) -> None:
    """Judges the stored briefs of the subjects on the store's latest complete run."""
    conn, run_id = _open(path, read_only=True)
    results: list[BriefResult] = []
    for sid in subjects or SUBJECTS:
        brief = stored_brief(conn, run_id, sid)
        if brief is None:
            raise SystemExit(f"run {run_id} of {path} has no brief for {sid}")
        results.append(await judge_brief(_inputs(conn, run_id, sid), brief, run_id))
    _report(f"Brief eval on run {run_id} of {path}", results, "brief_eval.json")


async def compare(path: Path = DB_PATH, subjects: list[str] | None = None) -> None:
    """Writes each subject's brief on COMPARE_MODEL in a copy of the store, from the same inputs
    as its stored brief, and judges both."""
    copy = EVAL_DIR / "db" / "brief-compare.db"
    copy.parent.mkdir(parents=True, exist_ok=True)
    source, _ = _open(path, read_only=True)
    target = connect(copy)
    source.backup(target)
    conn, run_id = _open(copy, read_only=False)
    inf = Inference(conn, run_id)
    results: list[BriefResult] = []
    for sid in subjects or SUBJECTS:
        inp = _inputs(conn, run_id, sid)
        if (stored := stored_brief(conn, run_id, sid)) is not None:
            results.append(await judge_brief(inp, stored, run_id))
        draft, problems = await draft_brief(inf, inp, COMPARE_MODEL)
        results.append(
            await judge_brief(inp, drafted_brief(draft, problems, inp, COMPARE_MODEL), run_id)
        )
    _report(f"Brief model comparison on run {run_id} of {path}", results, "brief_compare.json")
