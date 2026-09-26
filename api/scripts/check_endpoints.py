"""Hit every API endpoint against the running server for a sample of subjects and assert each
returns data. Writes artifacts/api-check/<timestamp>/results.json.

Usage (from api/): uv run python scripts/check_endpoints.py [--base https://intelmonitor.api.localhost]
The custom question check makes Claude and Jev calls the first time; reruns hit the cache. The
AG-UI check runs the Generate agent, one Claude session. The Run now check recomputes Run 2
from cache and adds a Run now execution to the run history.
"""

import argparse
import json
import ssl
import sys
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from intelmonitor.config import ARTIFACTS_DIR
from intelmonitor.store.db import connect

SAMPLE = [
    "banking-regulation",
    "stablecoins",
    "singapore-banks",
    "sea-countries",
    "dbs",
    "mas",
    "circle",
    "singapore",
]
WIDGET_TYPES = {
    "since",
    "question",
    "summary",
    "developments",
    "direction",
    "watchlist",
    "upcoming",
}
CUSTOM_REQUEST = {
    "text": "Which Singapore banks are working on stablecoins, tokenised deposits or crypto?",
    "subject_id": "singapore-banks",
}

type Json = Any  # response bodies are checked field by field below


class Check:
    def __init__(self, base: str) -> None:
        ca = Path.home() / ".portless" / "ca.pem"
        verify = ssl.create_default_context(cafile=str(ca)) if ca.exists() else True
        self.http = httpx.Client(base_url=base, verify=verify, timeout=600)
        self.results: list[dict[str, object]] = []

    def call(self, method: str, path: str, expect: int = 200, **kwargs: Any) -> Json:
        started = time.monotonic()
        r = self.http.request(method, path, **kwargs)
        ms = int((time.monotonic() - started) * 1000)
        if r.status_code != expect:
            raise AssertionError(f"{method} {path}: {r.status_code} {r.text[:300]}")
        self.results.append({"method": method, "path": path, "status": r.status_code, "ms": ms})
        return r.json() if r.content and "json" in r.headers.get("content-type", "") else r.text

    def get(self, path: str, **kwargs: Any) -> Json:
        return self.call("GET", path, **kwargs)


def need(condition: object, what: str) -> None:
    if not condition:
        raise AssertionError(what)


def widgets_for(sid: str, kind: str, page: Json) -> list[dict[str, object]]:
    first_q = page["questions"][0]["question_id"]
    entities = [e["id"] for e in page["subject"]["links"]["entities"]] or [sid]
    if kind == "entity":
        entities = [sid]
    specs: list[tuple[str, str, dict[str, object]]] = [
        ("since", "L", {"subject_id": sid}),
        ("question", "S", {"subject_id": sid, "question_id": first_q}),
        ("summary", "M", {"subject_id": sid}),
        ("developments", "M", {"subject_id": sid}),
        ("direction", "S", {"subject_id": sid}),
        ("watchlist", "M", {"entity_ids": entities[:5]}),
        ("upcoming", "M", {"subject_id": sid}),
    ]
    return [
        {"id": f"check-{t}", "order": i, "type": t, "size": size, "settings": settings}
        for i, (t, size, settings) in enumerate(specs)
    ]


def check_widget(data: Json) -> None:
    t = data["type"]
    need(data["run"]["id"], f"{t}: run")
    if t == "since":
        wc = data["what_changed"]
        need(wc["developments"] or wc["question_changes"], "since: no changes")
    elif t == "question":
        need(data["answer"]["summary"], "question: no summary")
    elif t == "summary":
        need(data["answers"], "summary: no answers")
    elif t == "developments":
        need(data["developments"], "developments: empty")
    elif t == "direction":
        need(len(data["weeks"]) == 8 and sum(w["count"] for w in data["weeks"]), "direction: empty")
    elif t == "watchlist":
        need(data["entries"] and all(e["state"] for e in data["entries"]), "watchlist: empty")
    elif t == "upcoming":
        need(isinstance(data["items"], list), "upcoming: no items list")


def check_subject(c: Check, sid: str) -> dict[str, int]:
    detail = c.get(f"/subjects/{sid}")
    kind = detail["type"]
    links = detail["links"]
    need(links["topics"] or links["groups"] or links["entities"], f"{sid}: no links")

    page = c.get(f"/subjects/{sid}/page")
    need(page["questions"], f"{sid}: no standing question answers")
    need(all(q["summary"] and q["state"] and q["change"] for q in page["questions"]), sid)
    wc = page["what_changed"]
    need(wc["developments"] or wc["question_changes"], f"{sid}: nothing changed")
    if kind == "topic":
        need(sum(b["count"] for b in page["stage_track"]["stages"]) > 0, f"{sid}: stage track")
        need(page["upcoming"], f"{sid}: no upcoming dates")
    if kind == "group":
        g = page["group"]
        need(g["common_issues"] or g["outliers"], f"{sid}: no common issues or outliers")

    hits = c.get("/search", params={"q": detail["name"]})["subjects"]
    need(hits and hits[0]["subject"]["id"] == sid, f"{sid}: search by name")
    if detail["aliases"]:
        hits = c.get("/search", params={"q": detail["aliases"][0]})["subjects"]
        need(any(h["subject"]["id"] == sid for h in hits), f"{sid}: search by alias")

    one = c.get("/graph", params={"center": sid, "hops": 1})
    two = c.get("/graph", params={"center": sid, "hops": 2})
    need(len(one["nodes"]) > 1 and one["edges"], f"{sid}: graph at 1 hop")
    need(len(two["nodes"]) >= len(one["nodes"]), f"{sid}: graph at 2 hops")
    need(any(n["has_new"] for n in two["nodes"]), f"{sid}: no new developments in graph")
    subjects_only = c.get(
        "/graph",
        params={"center": sid, "hops": 2, "node_type": ["topic", "group", "entity"]},
    )
    need(all(n["type"] != "development" for n in subjects_only["nodes"]), "node type filter")
    need(len(subjects_only["nodes"]) > 1, f"{sid}: subject-only graph")
    affects = c.get("/graph", params={"center": sid, "link_type": "AFFECTS", "window_days": 14})
    need(all(e["type"] == "AFFECTS" for e in affects["edges"]), "link type filter")

    devs = c.get("/developments", params={"subject_id": sid, "limit": 5})
    need(devs, f"{sid}: no developments")
    check_evidence(c, devs[0]["id"])

    cited = next(q for q in page["questions"] if q["development_ids"])
    evidence = c.get(f"/subjects/{sid}/answers/{cited['question_id']}/evidence")
    need(evidence["answer"]["summary"] == cited["summary"], f"{sid}: answer evidence")
    need(
        [d["id"] for d in evidence["developments"]] == cited["development_ids"],
        f"{sid}: answer evidence developments",
    )
    check_evidence(c, cited["development_ids"][0])

    for w in widgets_for(sid, kind, page):
        data = c.call("POST", "/widgets/data", json={"widget": w, "dashboard_subject_ids": [sid]})
        check_widget(data)
    return {"questions": len(page["questions"]), "developments": wc["new_count"]}


def check_evidence(c: Check, dev_id: str) -> None:
    dev = c.get(f"/developments/{dev_id}")
    need(dev["sources"], f"{dev_id}: no sources")
    for src in dev["sources"]:
        for f in src["findings"]:
            need(f["quotes"], f"{dev_id}: finding without quotes")
            p = f["passage"]
            for q, h in zip(f["quotes"], p["highlights"], strict=True):
                need(p["text"][h["start"] : h["end"]] == q["text"], f"{dev_id}: highlight")
    doc = c.get(f"/documents/{dev['sources'][0]['document_id']}")
    need(doc["quotes"], "document: no quotes")
    for q in doc["quotes"]:
        need(doc["text"][q["start"] : q["end"]] == q["text"], "document: quote offsets")


def check_dashboards(c: Check) -> None:
    catalog = c.get("/widgets/catalog")
    need({w["type"] for w in catalog} == WIDGET_TYPES, "catalog: 7 widget types")
    need(all(w["settings_schema"]["properties"] for w in catalog), "catalog: settings schemas")

    dashboards = c.get("/dashboards")
    names = {d["name"] for d in dashboards}
    need({"Singapore banks", "Stablecoin watch", "Geopolitics in SEA"} <= names, "starters")
    seen: set[str] = set()
    for d in dashboards:
        if not d["starter"]:
            continue
        data = c.get(f"/dashboards/{d['id']}/data")
        need(len(data) == len(d["widgets"]), f"{d['id']}: widget data count")
        for w in data:
            check_widget(w)
            seen.add(w["type"])
    need(seen == WIDGET_TYPES, f"starters cover every widget type, missing {WIDGET_TYPES - seen}")

    def spec(*widgets: tuple[str, int, str, str, dict[str, str]]) -> dict[str, object]:
        return {
            "name": "API check",
            "subject_ids": ["ocbc"],
            "widgets": [
                {"id": i, "order": o, "type": t, "size": z, "settings": st}
                for i, o, t, z, st in widgets
            ],
        }

    summary = ("a", 0, "summary", "M", {"subject_id": "ocbc"})
    since = ("b", 1, "since", "L", dict[str, str]())
    created = c.call("POST", "/dashboards", expect=201, json=spec(summary, since))
    did = created["id"]
    need(c.get(f"/dashboards/{did}")["name"] == "API check", "dashboard get")
    reordered = spec(("a", 1, "summary", "M", {"subject_id": "ocbc"}), ("b", 0, "since", "L", {}))
    updated = c.call("PUT", f"/dashboards/{did}", json=reordered)
    need([w["id"] for w in updated["widgets"]] == ["b", "a"], "dashboard reorder")
    bad = spec(("x", 0, "direction", "L", {"subject_id": "ocbc"}))  # direction has no L size
    c.call("PUT", f"/dashboards/{did}", expect=422, json=bad)
    c.call("DELETE", f"/dashboards/{did}", expect=204)
    c.call("GET", f"/dashboards/{did}", expect=404)


def check_actions(c: Check) -> None:
    reviews = c.call("POST", "/reviews", expect=201, json={"subject_ids": ["ocbc", "dbs"]})
    need(len(reviews) == 2, "reviews")
    need(c.get("/subjects/ocbc/page")["reviewed_at"], "reviewed_at after review")
    dev_id = c.get("/developments", params={"subject_id": "ocbc", "limit": 1})[0]["id"]
    note = c.call(
        "POST",
        "/notes",
        expect=201,
        json={"subject_id": "ocbc", "development_id": dev_id, "text": "API check note"},
    )
    need(any(n["id"] == note["id"] for n in c.get("/notes", params={"subject_id": "ocbc"})), "note")
    need(any(n["id"] == note["id"] for n in c.get(f"/developments/{dev_id}")["notes"]), "dev note")
    c.call("DELETE", f"/notes/{note['id']}", expect=204)


def check_custom_questions(c: Check) -> None:
    before = c.get("/subjects/singapore-banks/page")["custom_question_slots"]
    draft = c.call("POST", "/custom-questions", expect=201, json=CUSTOM_REQUEST)
    qid = draft["id"]
    try:
        need(draft["status"] == "draft" and draft["question"] and draft["label"], "draft config")
        need(len(draft["runs"]) == 2, "custom answers for both runs")
        need(draft["answer"] and draft["answer"]["change"]["kind"] != "first_answer", "badge")
        page = c.get("/subjects/singapore-banks/page")
        need(all(q["question_id"] != qid for q in page["questions"]), "draft hidden from page")

        kept = c.call("POST", f"/custom-questions/{qid}/keep")
        need(kept["status"] == "kept", "keep")
        page = c.get("/subjects/singapore-banks/page")
        need(any(q["question_id"] == qid and q["custom"] for q in page["questions"]), "on page")
        need(page["custom_question_slots"] == before - 1, "cap slots")
        widget = {
            "id": "custom",
            "order": 0,
            "type": "question",
            "size": "S",
            "settings": {"subject_id": "singapore-banks", "question_id": qid},
        }
        data = c.call("POST", "/widgets/data", json={"widget": widget})
        need(data["answer"]["custom"], "custom question widget")
        edited = c.call("PATCH", f"/custom-questions/{qid}", json={"label": "Digital assets"})
        need(edited["label"] == "Digital assets", "edit label")
        need(any(q["id"] == qid for q in c.get("/custom-questions", params={"status": "kept"})), "")
        need(c.get(f"/custom-questions/{qid}")["id"] == qid, "get custom question")
    finally:
        c.call("DELETE", f"/custom-questions/{qid}", expect=204)
    c.call("GET", f"/custom-questions/{qid}", expect=404)


def check_profile_menu(c: Check) -> None:
    runs = c.get("/runs")
    complete = [r for r in runs if r["status"] == "complete"]
    need(len({r["id"] for r in complete}) >= 2, "two complete runs")
    need(all(r["documents"] and r["developments"] and r["result"] for r in complete), "counts")
    sources = c.get("/data-sources")
    need(sources["total_documents"] and sources["sources"], "data sources")
    profile = c.get("/profile")
    changed = c.call("PUT", "/profile", json=dict(profile, display_name="API check"))
    need(changed["display_name"] == "API check", "profile update")
    c.call("PUT", "/profile", json=profile)


def check_run_now(c: Check) -> str:
    """Run now recomputes Run 2 from cache: 202, then 409 while running, then a Run now row
    whose result compares with the previous as-of date, like the execution before it."""
    before = c.get("/runs")
    started = c.call("POST", "/runs/now", expect=202)
    need(started["running"] and started["sources"] and started["how"].startswith("Run now"), "")
    c.call("POST", "/runs/now", expect=409)
    deadline = time.monotonic() + 600
    while c.get("/runs/status")["running"]:
        need(time.monotonic() < deadline, "Run now finished within 10 minutes")
        time.sleep(1)
    runs = c.get("/runs")
    latest = runs[0]
    need(len(runs) == len(before) + 1, "Run now adds a run")
    need(latest["status"] == "complete" and latest["trigger"] == "manual", f"run now {latest}")
    need(latest["id"] == before[0]["id"], "Run now recomputes the latest run")
    need(latest["result"] == before[0]["result"], "a rerun reports what its date found")
    return f"{latest['result']} in {latest['duration_seconds']:.0f}s"


def check_alerts(c: Check) -> str:
    """Alerts list needing attention first; Mark all read clears the counts. The check restores
    the read state it found, so it leaves the analyst's unread alerts alone."""
    alerts = c.get("/alerts")
    badges = [a["badge"] for a in alerts["alerts"]]
    need(badges, "alerts: none")
    need(badges == sorted(badges, key=lambda b: b != "needs_attention"), "needs attention first")
    need(all(a["title"] and a["meta"] for a in alerts["alerts"]), "alert title and meta")
    conn = connect()
    reads = conn.execute("SELECT * FROM alert_reads").fetchall()
    try:
        after = c.call("POST", "/alerts/read")
        need(after["unread"]["total"] == 0, "mark all read")
        need(all(a["read"] for a in after["alerts"]) and len(after["alerts"]) == len(badges), "")
        need(c.get("/alerts")["unread"]["total"] == 0, "reads persist")
    finally:
        conn.execute("DELETE FROM alert_reads")
        conn.executemany("INSERT INTO alert_reads VALUES (?, ?, ?)", [tuple(r) for r in reads])
        conn.commit()
        conn.close()
    u = alerts["unread"]
    return f"{len(badges)} alerts, {u['needs_attention']} + {u['watch']} unread"


def check_agent(c: Check) -> str:
    body: dict[str, object] = {
        "threadId": "check",
        "runId": "check-1",
        "state": {"widgets": []},
        "messages": [{"id": "m1", "role": "user", "content": "Monitor OCBC"}],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }
    text = c.call("POST", "/agent/generate", json=body)
    events = [
        json.loads(line[6:])["type"] for line in text.splitlines() if line.startswith("data: ")
    ]
    need(events[0] == "RUN_STARTED" and events[-1] == "RUN_FINISHED", f"AG-UI events {events}")
    for kind in ("TEXT_MESSAGE_CONTENT", "TOOL_CALL_START", "STATE_DELTA"):
        need(kind in events, f"AG-UI {kind}")
    return f"{events.count('STATE_DELTA')} state deltas"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://intelmonitor.api.localhost")
    args = parser.parse_args()
    c = Check(args.base)
    need(c.get("/health")["status"] == "ok", "health")
    subjects = c.get("/subjects")
    need(len(subjects) == 30, "30 subjects")

    steps: list[tuple[str, Callable[[], object]]] = [
        *((f"subject {sid}", lambda sid=sid: check_subject(c, sid)) for sid in SAMPLE),
        ("dashboards and widgets", lambda: check_dashboards(c)),
        ("analyst actions", lambda: check_actions(c)),
        ("custom questions", lambda: check_custom_questions(c)),
        ("profile menu", lambda: check_profile_menu(c)),
        ("run now", lambda: check_run_now(c)),
        ("alerts", lambda: check_alerts(c)),
        ("AG-UI generate", lambda: check_agent(c)),
    ]
    outcomes: list[dict[str, object]] = []
    for name, step in steps:
        try:
            detail = step()
            outcomes.append({"step": name, "ok": True, "detail": detail})
            print(f"ok    {name}" + (f"  {detail}" if detail else ""))
        except (AssertionError, KeyError, IndexError, TypeError, httpx.HTTPError) as error:
            outcomes.append(
                {"step": name, "ok": False, "error": f"{type(error).__name__}: {error}"}
            )
            print(f"FAIL  {name}: {type(error).__name__}: {error}")

    out = ARTIFACTS_DIR / "api-check" / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    paths = sorted({f"{r['method']} {r['path']}" for r in c.results})
    (out / "results.json").write_text(
        json.dumps({"base": args.base, "steps": outcomes, "calls": c.results}, indent=2)
    )
    failed = [o for o in outcomes if not o["ok"]]
    passed = len(outcomes) - len(failed)
    print(
        f"\n{passed}/{len(outcomes)} steps passed, {len(c.results)} calls ({len(paths)} distinct)"
    )
    print(f"results in {out / 'results.json'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
