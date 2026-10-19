"""Scores from the exported answers, the gold and the judge's verdicts; no model calls. Writes
scores.json and scores.md (the tables in report.md)."""

import json
import sqlite3
from datetime import timedelta
from statistics import mean
from typing import Any

from intelmonitor.eval.common import (
    ANSWER_MODEL,
    EVAL_DIR,
    FROZEN_DB,
    SCORED_RUN,
    EvalQuestion,
    ExportedAnswer,
    all_questions,
    call_records,
    eval_spend,
    frozen,
    read_answers,
    v2_spend,
)
from intelmonitor.eval.gold import Gold, read_gold
from intelmonitor.eval.judge import JUDGE_DIR, VARIANTS, allowed_text
from intelmonitor.pipeline.answers import scope, unsupported_numbers
from intelmonitor.pipeline.custom import CustomConfig, candidates
from intelmonitor.pipeline.diff import development_changes
from intelmonitor.store.db import connect

V2_DB = EVAL_DIR / "db" / "v2.db"


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}"


def _avg(xs: list[float | None]) -> float | None:
    vals = [x for x in xs if x is not None]
    return mean(vals) if vals else None


def correctness(claims: list[dict[str, Any]]) -> tuple[float | None, int, int]:
    facts = [c for c in claims if c["kind"] != "absence"]
    ok = sum(bool(c["supported"]) and not c["after_run_date"] for c in facts)
    return (ok / len(facts) if facts else None), ok, len(facts)


def eligible_developments(v2: sqlite3.Connection, q: EvalQuestion) -> dict[str, set[str]]:
    """The 09-24 developments V2 offered the question's answer, with their documents."""
    run_id = SCORED_RUN.isoformat()
    since = (SCORED_RUN - timedelta(days=q.lookback_days)).isoformat()
    if q.custom:
        config = CustomConfig.model_validate_json(
            (EVAL_DIR / "v2" / "exposure-config.json").read_text()
        )
        ids = {
            i
            for c in candidates(
                v2, run_id, config, SCORED_RUN - timedelta(days=q.lookback_days), SCORED_RUN
            )
            for i in c.development_ids
        }
    else:
        tagged = scope(q.subject)
        ids = {
            r["development_id"]
            for r in v2.execute(
                "SELECT s.development_id, d.last_published FROM development_subjects s "
                "JOIN developments d ON d.run_id = s.run_id AND d.id = s.development_id "
                "WHERE s.run_id = ? AND d.last_published > ? AND s.subject_id IN "
                f"({','.join('?' * len(tagged))})",
                (run_id, since, *tagged),
            )
        }
    docs: dict[str, set[str]] = {}
    for r in v2.execute(
        "SELECT development_id, document_id FROM development_sources WHERE run_id = ?", (run_id,)
    ):
        if r["development_id"] in ids:
            docs.setdefault(r["development_id"], set()).add(r["document_id"])
    return docs


def change_scores(v2: sqlite3.Connection, q: EvalQuestion, gold: Gold) -> dict[str, Any]:
    """V2's new/updated flags on its eligible developments against the change gold, matching a
    development to the gold events that share a document with it."""
    run_id = SCORED_RUN.isoformat()
    flags = development_changes(v2, run_id, "2026-09-17")
    devs = eligible_developments(v2, q)
    events = [e for e in gold.gold.events]
    kinds = {int(i): k for i, k in gold.changes.items()}
    matched = {
        d: [i for i, e in enumerate(events) if docs & set(e.document_ids)]
        for d, docs in devs.items()
    }
    matched = {d: m for d, m in matched.items() if m}
    flagged = {d: m for d, m in matched.items() if d in flags}
    want = {"new_development": "new", "updated_development": "updated"}
    loose = [any(kinds.get(i) in ("new", "updated") for i in m) for m in flagged.values()]
    strict = [any(kinds.get(i) == want[flags[d].kind] for i in m) for d, m in flagged.items()]
    changed = [i for i, k in kinds.items() if k in ("new", "updated")]
    found = [i for i in changed if any(i in m for m in flagged.values())]
    return {
        "matched_developments": len(matched),
        "flagged": len(flagged),
        "precision": sum(loose) / len(loose) if loose else None,
        "precision_same_kind": sum(strict) / len(strict) if strict else None,
        "gold_changed_events": len(changed),
        "gold_unchanged_events": sum(k == "unchanged" for k in kinds.values()),
        "recall": len(found) / len(changed) if changed else None,
    }


def run() -> None:
    conn = frozen()
    v2 = connect(V2_DB)
    judged = json.loads((JUDGE_DIR / "judge.json").read_text())
    claims = {(c["variant"], c["eval_id"]): c["claims"] for c in judged["correctness"]}
    mentions: dict[tuple[str, str], list[bool]] = {}
    for item in judged["coverage"]:
        for m in item["mentions"]:
            mentions.setdefault((m["variant"], item["eval_id"]), []).append(m["mentioned"])
    items = {c["eval_id"]: c["items"] for c in judged["coverage"]}
    answers: dict[tuple[str, str], ExportedAnswer] = {
        (a.variant, a.eval_id): a for v in VARIANTS for a in read_answers(v)
    }
    questions = all_questions()
    rows: list[dict[str, Any]] = []
    for q in questions:
        gold = read_gold(q.id)
        for v in VARIANTS:
            a = answers.get((v, q.id))
            if a is None:
                continue
            corr, ok, n = correctness(claims[(v, q.id)])
            got = mentions.get((v, q.id), [])
            row: dict[str, Any] = {
                "eval_id": q.id,
                "variant": v,
                "summary": a.summary,
                "state": a.state,
                "gold_state": gold.gold.expected_state,
                "state_ok": a.state == gold.gold.expected_state,
                "correctness": corr,
                "claims_supported": ok,
                "claims": n,
                "absence_claims": sum(c["kind"] == "absence" for c in claims[(v, q.id)]),
                "after_run_date": sum(bool(c["after_run_date"]) for c in claims[(v, q.id)]),
                "coverage": (sum(got) / items[q.id]) if items[q.id] else None,
                "must_items": items[q.id],
                "unsupported_numbers": unsupported_numbers(a.summary, allowed_text(conn, a)),
                "citations": len({c.document_id or c.url for c in a.citations}),
            }
            if v == "V2":
                row["change"] = change_scores(v2, q, gold)
            rows.append(row)

    def overall(v: str, ids: set[str]) -> dict[str, Any]:
        mine = [r for r in rows if r["variant"] == v and r["eval_id"] in ids]
        out: dict[str, Any] = {
            "questions": len(mine),
            "correctness": _avg([r["correctness"] for r in mine]),
            "coverage": _avg([r["coverage"] for r in mine]),
            "state_accuracy": _avg([float(r["state_ok"]) for r in mine]),
            "unsupported_numbers": sum(len(r["unsupported_numbers"]) for r in mine),
        }
        if v == "V2":
            out["change_precision"] = _avg([r["change"]["precision"] for r in mine])
            out["change_recall"] = _avg([r["change"]["recall"] for r in mine])
        return out

    standing = {q.id for q in questions if not q.custom}
    every = {q.id for q in questions}
    totals = {
        "standing": {v: overall(v, standing) for v in VARIANTS},
        "all": {v: overall(v, every) for v in VARIANTS},
    }
    result = {
        "rows": rows,
        "overall": totals,
        "cost": cost(),
        "consistency": consistency(judged),
        "gold": gold_summary(questions),
    }
    (EVAL_DIR / "scores.json").write_text(json.dumps(result, indent=1, default=str))
    (EVAL_DIR / "scores.md").write_text(markdown(result))
    print(markdown(result))


def cost() -> dict[str, Any]:
    with sqlite3.connect(FROZEN_DB) as f:
        frozen_max = f.execute("SELECT max(id) FROM inference_records").fetchone()[0]
    with sqlite3.connect(V2_DB) as v2:
        v2_rows = v2.execute(
            "SELECT engine, model, stage, count(*), coalesce(sum(cost_usd), 0), "
            "coalesce(sum(duration_ms), 0) FROM inference_records WHERE id > ? GROUP BY 1, 2, 3",
            (frozen_max,),
        ).fetchall()
    meta = json.loads((EVAL_DIR / "v2" / "run.json").read_text())

    def group(name: str) -> dict[str, Any]:
        recs = call_records(name)
        return {
            "calls": len(recs),
            "cost_usd": sum(float(r["usage"]["cost_usd"] or 0) for r in recs),  # type: ignore[index]
            "call_seconds": sum(int(r["usage"]["duration_ms"]) for r in recs) / 1000,  # type: ignore[index]
            "input_tokens": sum(int(r["usage"]["input_tokens"] or 0) for r in recs),  # type: ignore[index]
            "output_tokens": sum(int(r["usage"]["output_tokens"] or 0) for r in recs),  # type: ignore[index]
        }

    return {
        "V2": {
            "records": [
                {
                    "engine": e,
                    "model": m,
                    "stage": s,
                    "calls": n,
                    "cost_usd": c,
                    "seconds": d / 1000,
                }
                for e, m, s, n, c, d in v2_rows
            ],
            "cost_usd": v2_spend(),
            "replay": meta["replay"],
            "answer_seconds": meta["answer_seconds"],
            "custom_seconds": meta.get("custom_seconds"),
            "wall_seconds": meta.get("wall_seconds"),
        },
        "V1": group("v1"),
        "V0-C": group("v0"),
        "gold": {g: group(g) for g in ("gold-screen", "gold")},
        "judge": {g: group(g) for g in ("judge-correctness", "judge-coverage", "judge-recheck")},
        "by_group": eval_spend(),
        "total_usd": sum(eval_spend().values()) + v2_spend(),
        "answer_model": ANSWER_MODEL,
    }


def consistency(judged: dict[str, Any]) -> dict[str, Any]:
    pairs = [p for r in judged["rejudge"]["correctness"] for p in r["pairs"]]
    first = {(c["eval_id"], c["seed"]): c for c in judged["coverage"]}
    cov_pairs: list[tuple[bool, bool]] = []
    for again in judged["rejudge"]["coverage"]:
        base = {
            (m["variant"], m["item"]): m["mentioned"]
            for m in first[(again["eval_id"], 1)]["mentions"]
        }
        cov_pairs += [
            (base[(m["variant"], m["item"])], m["mentioned"])
            for m in again["mentions"]
            if (m["variant"], m["item"]) in base
        ]
    gold_checks = json.loads((EVAL_DIR / "gold" / "consistency.json").read_text())
    return {
        "correctness_items": len(judged["rejudge"]["correctness"]),
        "correctness_claims": len(pairs),
        "correctness_agreement": sum(a == b for a, b in pairs) / len(pairs) if pairs else None,
        "coverage_questions": [r["eval_id"] for r in judged["rejudge"]["coverage"]],
        "coverage_decisions": len(cov_pairs),
        "coverage_agreement": (
            sum(a == b for a, b in cov_pairs) / len(cov_pairs) if cov_pairs else None
        ),
        "gold": gold_checks,
    }


def gold_summary(questions: list[EvalQuestion]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for q in questions:
        g = read_gold(q.id)
        sources: dict[str, int] = {}
        for e in g.pool:
            for s in e.sources:
                sources[s] = sources.get(s, 0) + 1
        out.append(
            {
                "eval_id": q.id,
                "pool": len(g.pool),
                "pool_sources": sources,
                "kept": sum(d.include for d in g.gold.decisions),
                "events": len(g.gold.events),
                "must_events": sum(e.must_mention for e in g.gold.events),
                "must_series": sum(s.must_mention for s in g.gold.series),
                "expected_state": g.gold.expected_state,
                "changes": {
                    k: sum(v == k for v in g.changes.values())
                    for k in ("new", "updated", "unchanged")
                },
            }
        )
    return out


def markdown(r: dict[str, Any]) -> str:
    lines = [
        "| Question | Variant | Correctness | Coverage | State (gold) | Unsupported numbers | "
        "Change P / R |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in r["rows"]:
        state = f"{'ok' if row['state_ok'] else 'miss'}: {row['state']} ({row['gold_state']})"
        change = ""
        if "change" in row:
            c = row["change"]
            change = f"{_pct(c['precision'])} / {_pct(c['recall'])}"
        corr = f"{_pct(row['correctness'])} ({row['claims_supported']}/{row['claims']})"
        required = f" ({row['must_items']} required)" if row["must_items"] else ""
        cov = _pct(row["coverage"]) + required
        nums = ", ".join(row["unsupported_numbers"]) or "0"
        lines.append(
            f"| {row['eval_id']} | {row['variant']} | {corr} | {cov} | {state} | {nums} "
            f"| {change} |"
        )
    for label, key in (("standing questions", "standing"), ("all questions", "all")):
        lines += [
            "",
            f"**Overall, {label}** (macro mean over questions; n/a items skipped)",
            "",
            "| Variant | Correctness | Coverage | State accuracy | Unsupported numbers | "
            "Change P / R |",
            "|---|---|---|---|---|---|",
        ]
        for v, o in r["overall"][key].items():
            change = (
                f"{_pct(o['change_precision'])} / {_pct(o['change_recall'])}"
                if "change_precision" in o
                else "n/a"
            )
            lines.append(
                f"| {v} | {_pct(o['correctness'])} | {_pct(o['coverage'])} | "
                f"{_pct(o['state_accuracy'])} | {o['unsupported_numbers']} | {change} |"
            )
    return "\n".join(lines) + "\n"
