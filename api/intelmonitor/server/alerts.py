"""Alerts: the latest run's new or updated developments on followed subjects that need attention,
then those to watch. Read is the development's triage read, which holds the run it was read in,
so a development that a later run changes alerts again. Dismissed developments do not alert."""

from intelmonitor.server.models import Alert, AlertBadge, AlertCounts, Alerts, DevelopmentSummary
from intelmonitor.server.queries import MATERIAL_LEVEL, Queries
from intelmonitor.server.triage import followed_ids, mark_read


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
    followed = followed_ids(q.conn)
    watched = _watched(q)
    flagged: list[tuple[AlertBadge, DevelopmentSummary]] = []
    for d in q.developments_in(followed) if followed else []:
        if d.change is None or q.is_dismissed(d.id):
            continue
        if d.needs_attention:
            flagged.append(("needs_attention", d))
        elif d.materiality_level == MATERIAL_LEVEL or d.id in watched:
            flagged.append(("watch", d))
    # Stable sort keeps display order (most material, most recent) within each badge.
    flagged.sort(key=lambda t: t[0] != "needs_attention")
    items = [
        Alert(id=d.id, title=d.title, badge=badge, meta=_meta(d), read=q.is_read(d.id))
        for badge, d in flagged
    ]
    attention = sum(a.badge == "needs_attention" and not a.read for a in items)
    watch = sum(a.badge == "watch" and not a.read for a in items)
    return Alerts(
        run=q.run,
        followed=len(followed),
        alerts=items,
        unread=AlertCounts(needs_attention=attention, watch=watch, total=attention + watch),
    )


def mark_all_read(q: Queries) -> Alerts:
    mark_read(q, [a.id for a in alerts(q).alerts if not a.read])
    return alerts(Queries(q.conn))
