"""`im report`: artifacts/pipeline/<timestamp>/report.md, the checks and numbers from the
Verification section of poc-plan.md, read from the store."""

import json
import random
import sqlite3
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime
from pathlib import Path

from intelmonitor.config import ARTIFACTS_DIR
from intelmonitor.ingest.series.collect import FetchSummary
from intelmonitor.pipeline.answers import load_run_developments
from intelmonitor.pipeline.extract import Extraction, locate_quote
from intelmonitor.pipeline.facts import SeriesFact
from intelmonitor.pipeline.notes import stored_note_problems
from intelmonitor.pipeline.params import MATERIALITY_LEVELS, ROUTE_HIGH, ROUTE_LOW
from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.store.db import connect, get_meta

SPOT_CHECK_FINDINGS = 10


def _table(header: Sequence[str], rows: Iterable[Sequence[object]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def _pct(n: int, d: int) -> str:
    return f"{n / d:.0%}" if d else "n/a"


def _runs(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM runs ORDER BY as_of").fetchall()


def _checks(conn: sqlite3.Connection, runs: list[sqlite3.Row]) -> list[str]:
    out = ["## Checks", ""]
    subjects = all_subjects()
    rows: list[tuple[str, str, str]] = []
    for run in runs:
        have = {
            (r["subject_id"], r["question_id"])
            for r in conn.execute(
                "SELECT subject_id, question_id FROM question_answers WHERE run_id = ?",
                (run["id"],),
            )
        }
        want = {(s.id, q.id) for s in subjects.values() for q in questions_for(s)}
        missing = sorted(want - have)
        rows.append(
            (
                f"Run {run['id']}: every subject answers every question",
                "pass" if not missing else "FAIL",
                f"{len(want & have)}/{len(want)} answers"
                + (f"; missing {missing[:5]}" if missing else ""),
            )
        )

    bad: list[str] = []
    findings = conn.execute(
        "SELECT f.id, f.quotes, d.text FROM findings f JOIN source_documents d "
        "ON d.id = f.document_id"
    ).fetchall()
    for f in findings:
        quotes = json.loads(f["quotes"])
        ok = [
            q
            for q in quotes
            if f["text"][q["start"] : q["end"]] == q["text"] and locate_quote(f["text"], q["text"])
        ]
        if not ok or len(ok) != len(quotes):
            bad.append(f["id"])
    rows.append(
        (
            "Every finding has at least one verified quote",
            "pass" if not bad else "FAIL",
            f"{len(findings) - len(bad)}/{len(findings)} findings"
            + (f"; bad {bad[:5]}" if bad else ""),
        )
    )

    refs = {
        (r["stage"], r["input_ref"])
        for r in conn.execute(
            "SELECT DISTINCT stage, input_ref FROM inference_records WHERE status = 'ok'"
        )
    }
    needed: list[tuple[str, str]] = [
        ("screen", f"doc:{r['document_id']}")
        for r in conn.execute("SELECT document_id FROM document_tags")
    ]
    needed += [
        ("extract", f"doc:{r['document_id']}")
        for r in conn.execute(
            "SELECT DISTINCT document_id FROM findings "
            "WHERE document_id NOT IN (SELECT document_id FROM detections)"
        )
    ]
    needed += [
        ("answer", f"subject:{r['subject_id']}")
        for r in conn.execute("SELECT DISTINCT subject_id FROM question_answers")
    ]
    # Developments made only of detections take their rule's materiality without a Jev call.
    for r in conn.execute(
        "SELECT d.id, count(s.finding_id) AS n FROM developments d JOIN development_sources s "
        "ON s.run_id = d.run_id AND s.development_id = d.id GROUP BY d.run_id, d.id "
        "HAVING sum(s.document_id NOT IN (SELECT document_id FROM detections)) > 0"
    ):
        needed.append(("materiality", f"dev:{r['id']}:{r['n']}"))
    missing_records = [n for n in needed if n not in refs]
    rows.append(
        (
            "Inference records exist for every call",
            "pass" if not missing_records else "FAIL",
            f"{len(needed) - len(missing_records)}/{len(needed)} outputs traced to a record"
            + (f"; missing {missing_records[:5]}" if missing_records else ""),
        )
    )
    out.append(_table(["Check", "Result", "Detail"], rows))
    return out


def _documents(conn: sqlite3.Connection, runs: list[sqlite3.Row]) -> list[str]:
    run_cols = [f"≤ {r['as_of']}" for r in runs]
    out = ["## Documents per source", ""]
    rows: list[list[object]] = []
    for r in conn.execute(
        "SELECT source, collection, count(*) AS n, sum(t.relevant) AS relevant, "
        + ", ".join(
            f"sum(substr(published_at, 1, 10) <= '{run['as_of']}') AS r{i}"
            for i, run in enumerate(runs)
        )
        + (", " if runs else "")
        + "1 FROM source_documents d LEFT JOIN document_tags t ON t.document_id = d.id "
        "GROUP BY source, collection ORDER BY collection, source"
    ):
        rows.append(
            [
                r["source"],
                r["collection"],
                r["n"],
                *(r[f"r{i}"] for i in range(len(runs))),
                r["relevant"] or 0,
            ]
        )
    out.append(_table(["Source", "Collection", "Documents", *run_cols, "Relevant"], rows))

    out += ["", "## Documents and developments per subject", ""]
    doc_counts = Counter(
        r["subject_id"] for r in conn.execute("SELECT subject_id FROM document_subjects")
    )
    dev_counts: dict[str, Counter[str]] = {
        run["id"]: Counter(
            r["subject_id"]
            for r in conn.execute(
                "SELECT subject_id FROM development_subjects WHERE run_id = ?", (run["id"],)
            )
        )
        for run in runs
    }
    rows = [
        [s.id, s.type, doc_counts[s.id], *(dev_counts[run["id"]][s.id] for run in runs)]
        for s in all_subjects().values()
    ]
    out.append(
        _table(
            ["Subject", "Type", "Tagged documents", *(f"Developments {r['id']}" for r in runs)],
            rows,
        )
    )
    return out


def _screening(conn: sqlite3.Connection) -> list[str]:
    tags = conn.execute("SELECT * FROM document_tags").fetchall()
    relevant = sum(t["relevant"] for t in tags)
    rel_jev = sum(t["relevance_source"] == "jev" for t in tags)
    subject_direct = subject_routed = 0
    for t in tags:
        if t["relevance"] <= ROUTE_LOW:
            continue  # archived on relevance; subject tags were not used
        for p in json.loads(t["subject_scores"]).values():
            if ROUTE_LOW < p < ROUTE_HIGH:
                subject_routed += 1
            else:
                subject_direct += 1
    routed_claude = conn.execute(
        "SELECT count(*) FROM document_subjects WHERE source = 'claude'"
    ).fetchone()[0]
    truncated = sum(t["truncated"] for t in tags)
    categories = Counter(t["category"] for t in tags if t["relevant"])
    return [
        "## Screening and routing",
        "",
        f"Thresholds: clear no at or below {ROUTE_LOW}, clear yes at or above {ROUTE_HIGH}; "
        "the band in between goes to Claude.",
        "",
        _table(
            ["Measure", "Value"],
            [
                ["Documents screened", len(tags)],
                ["Relevant", f"{relevant} ({_pct(relevant, len(tags))})"],
                ["Relevance decided by Jev directly", f"{rel_jev} ({_pct(rel_jev, len(tags))})"],
                [
                    "Relevance routed to Claude",
                    f"{len(tags) - rel_jev} ({_pct(len(tags) - rel_jev, len(tags))})",
                ],
                [
                    "Subject tags decided by Jev directly",
                    f"{subject_direct} ({_pct(subject_direct, subject_direct + subject_routed)})",
                ],
                [
                    "Subject tags routed to Claude",
                    f"{subject_routed} ({_pct(subject_routed, subject_direct + subject_routed)}), "
                    f"{routed_claude} kept",
                ],
                ["Screened on title plus leading chunks", truncated],
            ],
        ),
        "",
        "Relevant documents by category: "
        + ", ".join(f"{c} {n}" for c, n in categories.most_common()),
    ]


def _extraction(conn: sqlite3.Connection) -> list[str]:
    proposed = quotes = 0
    seen: set[str] = set()
    for r in conn.execute(
        "SELECT input_ref, output FROM inference_records WHERE stage = 'extract' AND status = 'ok' "
        "ORDER BY id DESC"
    ):
        if r["input_ref"] in seen:
            continue
        seen.add(r["input_ref"])
        ex = Extraction.model_validate_json(r["output"])
        proposed += len(ex.findings)
        quotes += sum(len(f.quotes) for f in ex.findings)
    kept = conn.execute("SELECT count(*), sum(json_array_length(quotes)) FROM findings").fetchone()
    return [
        "## Extraction",
        "",
        _table(
            ["Measure", "Value"],
            [
                ["Documents extracted", len(seen)],
                ["Findings proposed by Claude", proposed],
                [
                    "Findings kept (at least one verified quote)",
                    f"{kept[0]} ({_pct(kept[0], proposed)})",
                ],
                ["Quotes proposed", quotes],
                ["Quotes verified", f"{kept[1] or 0} ({_pct(kept[1] or 0, quotes)})"],
            ],
        ),
    ]


def _developments(conn: sqlite3.Connection, runs: list[sqlite3.Row]) -> list[str]:
    rows: list[list[object]] = []
    dist: list[list[object]] = []
    for run in runs:
        rid = run["id"]
        devs = conn.execute(
            "SELECT count(*) FROM developments WHERE run_id = ?", (rid,)
        ).fetchone()[0]
        src = conn.execute(
            "SELECT count(*) AS findings, count(DISTINCT document_id) AS docs FROM "
            "development_sources WHERE run_id = ?",
            (rid,),
        ).fetchone()
        per_dev = conn.execute(
            "SELECT count(DISTINCT document_id) AS n FROM development_sources WHERE run_id = ? "
            "GROUP BY development_id",
            (rid,),
        ).fetchall()
        multi = sum(r["n"] > 1 for r in per_dev)
        sources = sum(r["n"] for r in per_dev)
        rows.append(
            [
                rid,
                devs,
                src["findings"],
                src["docs"],
                f"{src['findings'] / devs:.2f}" if devs else "n/a",
                f"{sources / devs:.2f}" if devs else "n/a",
                multi,
            ]
        )
        levels = Counter(
            r[0]
            for r in conn.execute(
                "SELECT materiality_level FROM developments WHERE run_id = ?", (rid,)
            )
        )
        dist.append(
            [
                rid,
                *(levels[i] for i in range(len(MATERIALITY_LEVELS))),
                sum(levels[i] for i in range(3, len(MATERIALITY_LEVELS))),
            ]
        )
    same = conn.execute(
        "SELECT count(*), sum(json_extract(output, '$.same_event.noul') >= 0.5) FROM "
        "inference_records WHERE stage = 'same_event' AND status = 'ok'"
    ).fetchone()
    return [
        "## Developments and merges",
        "",
        f"Same-event pairs judged by Jev: {same[0]}, of which {same[1] or 0} merged.",
        "",
        _table(
            [
                "Run",
                "Developments",
                "Findings",
                "Documents",
                "Findings per development",
                "Sources per development",
                "Multi-source developments",
            ],
            rows,
        ),
        "",
        "## Materiality distribution",
        "",
        _table(
            ["Run", *(f"{i} {n}" for i, n in enumerate(MATERIALITY_LEVELS)), "Needs attention"],
            dist,
        ),
    ]


def _answers(conn: sqlite3.Connection, runs: list[sqlite3.Row]) -> list[str]:
    rows: list[list[object]] = []
    for run in runs:
        states = Counter(
            r[0]
            for r in conn.execute(
                "SELECT state FROM question_answers WHERE run_id = ?", (run["id"],)
            )
        )
        upcoming = conn.execute(
            "SELECT count(*) FROM upcoming_dates WHERE run_id = ?", (run["id"],)
        ).fetchone()[0]
        rows.append(
            [
                run["id"],
                sum(states.values()),
                states["stable"],
                states["new"],
                states["watch"],
                states["needs_attention"],
                upcoming,
            ]
        )
    out = [
        "## Answers",
        "",
        _table(
            ["Run", "Answers", "Stable", "New", "Watch", "Needs attention", "Upcoming dates"], rows
        ),
    ]
    changes = conn.execute(
        "SELECT * FROM run_changes ORDER BY run_id, kind, subject_id, ref_id"
    ).fetchall()
    if changes:
        kinds = Counter((c["run_id"], c["base_run_id"], c["kind"]) for c in changes)
        out += ["", "## Changes since the previous run", ""]
        out.append(
            _table(["Run", "Base", "Kind", "Count"], [[*k, n] for k, n in sorted(kinds.items())])
        )
        states = [c for c in changes if c["kind"] == "question_state"]
        if states:
            out += ["", "Question state changes (first 30):", ""]
            out.append(
                _table(
                    ["Subject", "Question", "From", "To", "Now"],
                    [
                        [
                            c["subject_id"],
                            c["ref_id"],
                            (d := json.loads(c["detail"]))["from"],
                            d["to"],
                            d["to_summary"],
                        ]
                        for c in states[:30]
                    ],
                )
            )
    return out


def _notes(conn: sqlite3.Connection, runs: list[sqlite3.Row]) -> list[str]:
    """Trend notes (F6) per run: written, asked again for a number outside their facts and
    developments or for the FX wording, and still breaking a rule under today's checks."""
    rows: list[list[object]] = []
    broken: list[list[object]] = []
    for run in runs:
        notes = conn.execute(
            "SELECT * FROM run_notes WHERE run_id = ? ORDER BY subject_id", (run["id"],)
        ).fetchall()
        asked = conn.execute(
            "SELECT count(DISTINCT input_ref) FROM inference_records WHERE stage = 'note' "
            "AND run_id = ? AND input_ref LIKE '%:retry%' AND status = 'ok'",
            (run["id"],),
        ).fetchone()[0]
        devs = load_run_developments(conn, run["id"]) if notes else []
        as_of = date.fromisoformat(run["as_of"])
        still = 0
        for n in notes:
            if problems := stored_note_problems(n, as_of, devs):
                still += 1
                broken.append([run["id"], n["subject_id"], "; ".join(problems)])
        rows.append([run["id"], len(notes), asked, still])
    out = [
        "## Trend notes",
        "",
        _table(["Run", "Notes written", "Asked again", "Still breaking a rule"], rows),
    ]
    if broken:
        out += ["", "Notes still breaking a rule:", "", _table(["Run", "Subject", "Why"], broken)]
    return out


def _spot_check(conn: sqlite3.Connection) -> list[str]:
    ids = [r[0] for r in conn.execute("SELECT id FROM findings ORDER BY id")]
    sample = random.Random(len(ids)).sample(ids, min(SPOT_CHECK_FINDINGS, len(ids)))
    out = ["## Spot check: random findings", ""]
    for i, fid in enumerate(sample, 1):
        f = conn.execute(
            "SELECT f.*, d.title, d.url, d.published_at FROM findings f JOIN source_documents d "
            "ON d.id = f.document_id WHERE f.id = ?",
            (fid,),
        ).fetchone()
        out.append(f"{i}. **{f['statement']}**")
        out.append(
            f"   Subjects: {', '.join(json.loads(f['subjects']))}. Category: {f['category']}. "
            f"Source: [{f['title']}]({f['url']}), {f['published_at'][:10]}."
        )
        out += [f"   > {q['text']}" for q in json.loads(f["quotes"])]
        out.append("")
    return out


def _usage(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT engine, stage, count(*) AS calls, sum(status = 'error') AS errors, "
        "sum(input_tokens) AS tin, sum(output_tokens) AS tout, sum(cost_usd) AS cost, "
        "group_concat(DISTINCT model_version) AS versions FROM inference_records "
        "GROUP BY engine, stage ORDER BY engine, stage"
    ).fetchall()
    totals = conn.execute(
        "SELECT engine, count(*), sum(input_tokens), sum(output_tokens), sum(cost_usd) "
        "FROM inference_records GROUP BY engine ORDER BY engine"
    ).fetchall()
    return [
        "## Model calls, tokens and cost",
        "",
        "Every Jev and Claude call writes an inference record; reruns are served from them. "
        "Claude cost is the list-price equivalent the Agent SDK reports (the calls run on the "
        "Claude subscription). Jev on OpenRouter reports tokens but not cost.",
        "",
        _table(
            [
                "Engine",
                "Stage",
                "Calls",
                "Errors",
                "Input tokens",
                "Output tokens",
                "Cost (USD)",
                "Model versions",
            ],
            [
                [
                    r["engine"],
                    r["stage"],
                    r["calls"],
                    r["errors"],
                    f"{r['tin'] or 0:,}",
                    f"{r['tout'] or 0:,}",
                    f"{r['cost']:.2f}" if r["cost"] is not None else "n/a",
                    r["versions"],
                ]
                for r in rows
            ],
        ),
        "",
        _table(
            ["Engine", "Calls", "Input tokens", "Output tokens", "Cost (USD)"],
            [
                [
                    r[0],
                    r[1],
                    f"{r[2] or 0:,}",
                    f"{r[3] or 0:,}",
                    f"{r[4]:.2f}" if r[4] is not None else "n/a",
                ]
                for r in totals
            ],
        ),
    ]


def _series(conn: sqlite3.Connection) -> list[str]:
    out = ["## Series", ""]
    stored = get_meta(conn, "series_last_fetch")
    if stored is None:
        return out + ["No series fetched yet: run `im series backfill`."]
    last = FetchSummary.model_validate_json(stored)
    calls = ", ".join(f"{k} {v}" for k, v in last.network.items()) or "none"
    total = conn.execute("SELECT count(*) FROM series").fetchone()[0]
    out += [
        f"Latest fetch {last.fetched_at:%Y-%m-%d %H:%M} UTC, up to {last.today}, history from "
        f"{last.floor}: {total - len(last.failures)} of {total} series fetched, "
        f"{last.added:,} rows added, {last.revised} revised, {len(last.failures)} series "
        f"failed. External calls: {calls}.",
        "",
    ]
    rows = conn.execute(
        "SELECT s.source, count(DISTINCT s.id) AS series, count(o.period) AS observations, "
        "max(o.period) AS latest, "
        "(SELECT count(*) FROM observation_revisions r JOIN series x ON x.id = r.series_id "
        "WHERE x.source = s.source) AS revisions "
        "FROM series s LEFT JOIN observations o ON o.series_id = s.id "
        "GROUP BY s.source ORDER BY s.source"
    ).fetchall()
    out.append(
        _table(
            ["Source", "Series", "Observations", "Latest period", "Revisions"],
            [
                [r["source"], r["series"], f"{r['observations']:,}", r["latest"], r["revisions"]]
                for r in rows
            ],
        )
    )
    if last.failures:
        out += ["", "Failed in the latest fetch:", ""]
        out += [f"- {series_id}: {reason}" for series_id, reason in last.failures.items()]
    if last.stale:
        stale = ", ".join(f"{k} ({v})" for k, v in last.stale.items())
        out += ["", f"Stale (latest point more than a day old): {stale}."]
    return out + [
        "",
        *_run_indicators(conn, total),
        "",
        *_run_facts(conn),
        "",
        *_run_detections(conn),
    ]


def _run_indicators(conn: sqlite3.Connection, total: int) -> list[str]:
    """What each run's indicators saw, and the look-ahead check: no run indicator may use an
    observation that became available after the run date."""
    rows: list[list[object]] = []
    for run in conn.execute("SELECT id, as_of FROM runs ORDER BY as_of").fetchall():
        states = Counter[str]()
        for r in conn.execute(
            "SELECT state, count(*) AS n FROM run_indicators WHERE run_id = ? GROUP BY state",
            (run["id"],),
        ):
            states[r["state"]] = r["n"]
        if not states:
            rows.append([run["id"], "none written", ""])
            continue
        states["no_data"] = total - states.total()
        late = conn.execute(
            "SELECT count(*) FROM run_indicators i JOIN observations o "
            "ON o.series_id = i.series_id AND o.period = i.period "
            "WHERE i.run_id = ? AND substr(o.available_at, 1, 10) > ?",
            (run["id"], run["as_of"]),
        ).fetchone()[0]
        rows.append(
            [
                run["id"],
                ", ".join(f"{k} {v}" for k, v in sorted(states.items()) if v),
                "pass" if not late else f"FAIL: {late} available after the run date",
            ]
        )
    return [
        "Run indicators, every series as of the run date:",
        "",
        _table(["Run", "States", "No look-ahead"], rows),
    ]


def _run_facts(conn: sqlite3.Connection) -> list[str]:
    """What each run's answers were told and cited, and the look-ahead check: no fact may state
    an observation that became available after the run date."""
    rows: list[list[object]] = []
    for run in conn.execute("SELECT id, as_of FROM runs ORDER BY as_of").fetchall():
        facts = [
            SeriesFact.model_validate_json(r["fact"])
            for r in conn.execute("SELECT fact FROM run_facts WHERE run_id = ?", (run["id"],))
        ]
        if not facts:
            rows.append([run["id"], "none written", "", "", ""])
            continue
        answers = conn.execute(
            "SELECT sum(series_ids != '[]') AS citing, sum(state_rules != '[]') AS fixed "
            "FROM question_answers WHERE run_id = ?",
            (run["id"],),
        ).fetchone()
        late = sum(
            o.available_at.date().isoformat() > run["as_of"]
            for f in facts
            for o in (f.latest, f.low, f.high)
            if o is not None
        )
        rows.append(
            [
                run["id"],
                len(facts),
                answers["citing"] or 0,
                answers["fixed"] or 0,
                "pass" if not late else f"FAIL: {late} available after the run date",
            ]
        )
    return [
        "Run facts, per subject and series its questions link (F2):",
        "",
        _table(
            ["Run", "Facts", "Answers citing series", "States fixed by rules", "No look-ahead"],
            rows,
        ),
    ]


def _run_detections(conn: sqlite3.Connection) -> list[str]:
    """Each run's developments from detectors (F3), with the look-ahead check: a detection's
    document is published no earlier than its firing value became available."""
    rows: list[list[object]] = []
    for r in conn.execute(
        "SELECT s.run_id, s.development_id, k.detector_id, k.series_id, k.period, "
        "d.published_at, v.materiality_level, "
        "(SELECT count(DISTINCT x.document_id) FROM development_sources x "
        "WHERE x.run_id = s.run_id AND x.development_id = s.development_id) AS sources, "
        "(SELECT o.available_at FROM observations o "
        "WHERE o.series_id = k.series_id AND o.period = k.period) AS available_at "
        "FROM development_sources s JOIN detections k ON k.document_id = s.document_id "
        "JOIN source_documents d ON d.id = s.document_id "
        "JOIN developments v ON v.run_id = s.run_id AND v.id = s.development_id "
        "ORDER BY s.run_id, d.published_at"
    ):
        early = r["available_at"] is not None and r["available_at"] > r["published_at"]
        rows.append(
            [
                r["run_id"],
                r["detector_id"],
                r["series_id"],
                r["period"],
                r["published_at"][:10],
                MATERIALITY_LEVELS[r["materiality_level"]],
                r["sources"],
                r["development_id"],
                "FAIL: published before its value" if early else "pass",
            ]
        )
    if not rows:
        return ["Detections (F3): none in any run."]
    return [
        "Detections in each run's developments (F3):",
        "",
        _table(
            [
                "Run",
                "Detector",
                "Series",
                "Period",
                "Published",
                "Materiality",
                "Sources",
                "Development",
                "No look-ahead",
            ],
            rows,
        ),
    ]


def _minutes(started: str, finished: str | None) -> str:
    if not finished:
        return ""
    elapsed = datetime.fromisoformat(finished) - datetime.fromisoformat(started)
    return f"{elapsed.total_seconds() / 60:.1f} min"


def build_report(conn: sqlite3.Connection) -> str:
    runs = _runs(conn)
    run_rows = [
        [
            r["id"],
            r["status"],
            r["documents"],
            r["previous_run_id"] or "",
            _minutes(r["started_at"], r["finished_at"]),
        ]
        for r in runs
    ]
    sections = [
        [
            "# IntelMonitor pipeline report",
            "",
            f"Generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC. T0 {get_meta(conn, 't0')}.",
            "",
            _table(
                ["Run (as of)", "Status", "Documents", "Diffed against", "Last duration"], run_rows
            ),
        ],
        _checks(conn, runs),
        _documents(conn, runs),
        _series(conn),
        _screening(conn),
        _extraction(conn),
        _developments(conn, runs),
        _answers(conn, runs),
        _notes(conn, runs),
        _spot_check(conn),
        _usage(conn),
    ]
    return "\n\n".join("\n".join(s) for s in sections) + "\n"


def write_report() -> Path:
    path = ARTIFACTS_DIR / "pipeline" / datetime.now(UTC).strftime("%Y%m%d-%H%M%S") / "report.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_report(connect()))
    return path
