"""Alerts: the latest run's new or updated developments that need attention, then those to
watch. Read state is kept per run, so a development flagged again by a later run alerts again."""

from datetime import UTC, datetime

from intelmonitor.server.models import Alert, AlertBadge, AlertCounts, Alerts, DevelopmentSummary
from intelmonitor.server.queries import MATERIAL_LEVEL, Queries


def _watched(q: Queries) -> set[str]:
    """Developments cited by a standing question answer in the Watch state, built-in or kept."""
    rows = q.conn.execute(
        "SELECT j.value AS id FROM question_answers a, json_each(a.development_ids) j "
        "WHERE a.run_id = ? AND a.state = 'watch' "
        "UNION SELECT j.value FROM custom_question_answers a "
        "JOIN custom_questions c ON c.id = a.question_id AND c.status = 'kept', "
        "json_each(a.development_ids) j WHERE a.run_id = ? AND a.state = 'watch'",
        (q.run.id, q.run.id),
    )
    return {str(r["id"]) for r in rows}


def _meta(d: DevelopmentSummary) -> str:
    """ "OCBC, financial, 3 sources": the lead entity (else subject), category and sources."""
    lead = next(
        (s for s in d.subjects if s.type == "entity"), d.subjects[0] if d.subjects else None
    )
    sources = f"{d.source_count} source{'' if d.source_count == 1 else 's'}"
    return ", ".join(p for p in (lead.name if lead else "", d.category, sources) if p)


def alerts(q: Queries) -> Alerts:
    watched = _watched(q)
    read = {
        str(r["development_id"])
        for r in q.conn.execute(
            "SELECT development_id FROM alert_reads WHERE run_id = ?", (q.run.id,)
        )
    }
    flagged: list[tuple[AlertBadge, DevelopmentSummary]] = []
    for d in q.devs.by_id.values():
        if d.change is None:
            continue
        if d.needs_attention:
            flagged.append(("needs_attention", d))
        elif d.materiality_level == MATERIAL_LEVEL or d.id in watched:
            flagged.append(("watch", d))
    # Stable sort keeps display order (most material, most recent) within each badge.
    flagged.sort(key=lambda t: t[0] != "needs_attention")
    items = [
        Alert(id=d.id, title=d.title, badge=badge, meta=_meta(d), read=d.id in read)
        for badge, d in flagged
    ]
    attention = sum(a.badge == "needs_attention" and not a.read for a in items)
    watch = sum(a.badge == "watch" and not a.read for a in items)
    return Alerts(
        run=q.run,
        alerts=items,
        unread=AlertCounts(needs_attention=attention, watch=watch, total=attention + watch),
    )


def mark_all_read(q: Queries) -> Alerts:
    at = datetime.now(UTC).isoformat()
    q.conn.executemany(
        "INSERT OR IGNORE INTO alert_reads (run_id, development_id, read_at) VALUES (?, ?, ?)",
        [(q.run.id, a.id, at) for a in alerts(q).alerts],
    )
    q.conn.commit()
    return alerts(q)
