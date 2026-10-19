"""Alerts: the latest run's new or updated developments on followed subjects that need attention,
then those to watch. Read is the development's triage read, which holds the run it was read in,
so a development that a later run changes alerts again. Dismissed and unconfirmed developments
(pipeline/corroboration.py) do not alert."""

from intelmonitor.server.models import Alert, AlertBadge, AlertCounts, Alerts, DevelopmentSummary
from intelmonitor.server.queries import MATERIAL_LEVEL, Queries
from intelmonitor.server.triage import followed_ids, mark_read


def watched_ids(q: Queries) -> set[str]:
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


def alert_badge(d: DevelopmentSummary, watched: set[str]) -> AlertBadge | None:
    """Needs attention, or Watch for a Notable development or one a Watch answer cites."""
    if d.needs_attention:
        return "needs_attention"
    if d.materiality_level == MATERIAL_LEVEL or d.id in watched:
        return "watch"
    return None


def _meta(d: DevelopmentSummary) -> str:
    """ "OCBC, financial": the lead entity (else subject) and category. The web adds the source
    counts in the words rows use."""
    lead = next(
        (s for s in d.subjects if s.type == "entity"), d.subjects[0] if d.subjects else None
    )
    return ", ".join(p for p in (lead.name if lead else "", d.category) if p)


def alerts(q: Queries) -> Alerts:
    followed = followed_ids(q.conn)
    watched = watched_ids(q)
    flagged: list[tuple[AlertBadge, DevelopmentSummary]] = []
    for d in q.developments_in(followed) if followed else []:
        if d.change is None or q.is_dismissed(d.id):
            continue
        if badge := alert_badge(d, watched):
            flagged.append((badge, d))
    # Stable sort keeps display order within each badge: High adverse, other High, Medium
    # adverse, other Medium, the rest, most recent first in each (server/queries.py).
    flagged.sort(key=lambda t: t[0] != "needs_attention")
    items = [
        Alert(
            id=d.id,
            title=d.title,
            badge=badge,
            meta=_meta(d),
            outlet_count=d.outlet_count,
            social_count=d.social_count,
            source_types=d.source_types,
            read=q.is_read(d.id),
        )
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
