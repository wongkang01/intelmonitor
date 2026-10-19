"""A dashboard's overview beside its feed: the new count, the watchlist and the upcoming dates."""

from datetime import timedelta

from intelmonitor.server.developments import DevelopmentQuery, development_list
from intelmonitor.server.models import DashboardOverview, WatchItem
from intelmonitor.server.queries import Queries, subject, subject_ref

MONTH_DAYS = 30


def watch_entities(subject_ids: list[str]) -> list[str]:
    """The dashboard's entities in its order, a group standing for its members (decision S11)."""
    out: dict[str, None] = {}
    for sid in subject_ids:
        s = subject(sid)
        for member in (sid,) if s.type == "entity" else s.members:
            out[member] = None
    return list(out)


def watch_item(q: Queries, entity_id: str) -> WatchItem:
    devs = [d for d in q.developments_in([entity_id]) if not q.is_dismissed(d.id)]
    start = q.run.as_of - timedelta(days=MONTH_DAYS)
    month = [d for d in devs if d.last_published > start]
    top = month[0] if month else None
    return WatchItem(
        subject=subject_ref(entity_id),
        new_high=q.new_high(devs, q.changes_since),
        month_count=len(month),
        top=top,
        latest=None if top else max(devs, key=lambda d: d.last_published, default=None),
    )


def new_count(q: Queries, subject_ids: list[str]) -> int:
    """Developments in scope new since the last visit and unread, as the feed counts them."""
    return development_list(q, subject_ids, DevelopmentQuery(limit=1)).new_count


def dashboard_overview(q: Queries, subject_ids: list[str]) -> DashboardOverview:
    feed = development_list(q, subject_ids, DevelopmentQuery(limit=1))
    return DashboardOverview(
        since=feed.since,
        new_count=feed.new_count,
        watchlist=[watch_item(q, e) for e in watch_entities(subject_ids)],
        upcoming=q.upcoming(subject_ids),
    )
