"""Profiles, visits and onboarding suggestions (phase1-plan.md, item U3).

There is no sign-in: a profile is a role with its own dashboards, and the active one stands in for
identity. The user's own profile for a role has the role as its id; TCRD and FMD are preloaded for
the testing sessions, each with the dashboard its role's suggestions make. Each app load logs a
visit with the active role, so days with a visit can be counted per role:

    SELECT role, count(DISTINCT date) FROM visits GROUP BY role

Suggestions are written by code from the seed and the relationship store, never by a model."""

import json
import sqlite3
from datetime import date, datetime

from intelmonitor.pipeline.impact import SERVICE_WORDS
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.relationships import EVIDENCE_GRADES, Evidence, Relationship
from intelmonitor.seed import load_subjects
from intelmonitor.server import dashboards as dash
from intelmonitor.server.impacts import display_names
from intelmonitor.server.models import (
    PickerGroup,
    PickerRow,
    Profile,
    ProfileCreate,
    Role,
    Suggestions,
)
from intelmonitor.server.queries import NotFoundError, Queries, now
from intelmonitor.server.widgets import DashboardSpec
from intelmonitor.store.db import get_meta, set_meta

ROLE_NAMES: dict[Role, str] = {
    "regulatory_supervisor": "Regulatory supervisor",
    "tech_cyber_supervisor": "Technology and cyber risk supervisor",
    "development_staff": "Development staff",
    "other": "Other",
}

# The department profiles preloaded for the testing sessions: id, name on the button, role.
PRESETS: list[tuple[str, str, Role]] = [
    ("tcrd", "TCRD", "tech_cyber_supervisor"),
    ("fmd", "FMD", "development_staff"),
]

BANKS = ["dbs", "ocbc", "uob"]
TCRD_TOPICS = ["tech-outages", "cyber-threats", "third-party-risk"]
FMD_TOPICS = [
    "singapore-equities",
    "asset-management",
    "fixed-income-fx",
    "insurance-risk-financing",
    "infrastructure-finance",
]

# Groups the picker opens for each role, in order; the rest follow under More to add.
OPEN_GROUPS: dict[Role, list[str]] = {
    "regulatory_supervisor": ["singapore-banks"],
    "tech_cyber_supervisor": ["singapore-banks", "topics", "tech-providers", "payment-systems"],
    "development_staff": ["topics", "exchanges"],
    "other": ["mas-supervised"],
}
DASHBOARD_NAMES: dict[Role, str] = {
    "regulatory_supervisor": "Bank supervision",
    "tech_cyber_supervisor": "Technology and cyber risk",
    "development_staff": "Markets",
    "other": "MAS supervised entities",
}


# ---- profiles


def _tour_seen_at(conn: sqlite3.Connection) -> datetime | None:
    """The tour is shown once per store, whichever profile is active. Stores made before profiles
    kept it in the single profile's JSON."""
    stored = get_meta(conn, "tour_seen_at")
    if stored is None and (old := get_meta(conn, "profile")):
        stored = json.loads(old).get("tour_seen_at")
    return datetime.fromisoformat(stored) if stored else None


def _from_row(row: sqlite3.Row, q: Queries | None = None) -> Profile:
    return Profile(
        id=row["id"],
        name=row["name"],
        role=row["role"],
        default_dashboard_id=row["default_dashboard_id"],
        last_visit=q.last_visit if q else None,
        tour_seen_at=_tour_seen_at(q.conn) if q else None,
    )


def list_profiles(conn: sqlite3.Connection) -> list[Profile]:
    """Every profile, in menu order: the preloaded ones first, then the user's own by creation."""
    rows = conn.execute("SELECT * FROM profiles ORDER BY position, created_at").fetchall()
    return [_from_row(r) for r in rows]


def active_profile(q: Queries) -> Profile:
    """The active profile, or one with no id and no role before the first visit picks one."""
    row = q.conn.execute(
        "SELECT p.* FROM profiles p JOIN meta m ON m.key = 'active_profile' AND m.value = p.id"
    ).fetchone()
    if row is None:
        return Profile(
            id=None,
            name="",
            role=None,
            default_dashboard_id=None,
            tour_seen_at=_tour_seen_at(q.conn),
        )
    return _from_row(row, q)


def activate(q: Queries, profile_id: str) -> Profile:
    if q.conn.execute("SELECT 1 FROM profiles WHERE id = ?", (profile_id,)).fetchone() is None:
        raise NotFoundError(f"profile {profile_id}")
    set_meta(q.conn, "active_profile", profile_id)
    return active_profile(q)


def update_active(q: Queries, change: Profile) -> Profile:
    """Sets the active profile's default dashboard, and when the tour was seen."""
    current = active_profile(q)
    if change.default_dashboard_id is not None:
        dash.get_dashboard(q.conn, change.default_dashboard_id)
    if current.id is not None:
        q.conn.execute(
            "UPDATE profiles SET default_dashboard_id = ? WHERE id = ?",
            (change.default_dashboard_id, current.id),
        )
        q.conn.commit()
    if change.tour_seen_at is not None:
        set_meta(q.conn, "tour_seen_at", change.tour_seen_at.isoformat())
    return active_profile(q)


def _save(
    conn: sqlite3.Connection, profile_id: str, name: str, role: Role, request: ProfileCreate
) -> None:
    """Makes the profile's new dashboard and stores the profile with it as the default."""
    spec = DashboardSpec(
        name=request.dashboard_name,
        subject_ids=request.subject_ids,
        widgets=[],
    )
    created = dash.create_dashboard(conn, spec, profile_id=profile_id)
    position = conn.execute("SELECT coalesce(max(position), -1) + 1 FROM profiles").fetchone()[0]
    conn.execute(
        "INSERT INTO profiles (id, name, role, default_dashboard_id, position, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (id) DO UPDATE SET default_dashboard_id = excluded.default_dashboard_id",
        (profile_id, name, role, created.id, position, now()),
    )
    conn.commit()


def create_profile(q: Queries, request: ProfileCreate) -> Profile:
    """Onboarding's end: the user's own profile for the role gets a new dashboard from the picks,
    which becomes its default, and the profile becomes the active one. Picking a role the user
    already has adds the dashboard to that profile; earlier dashboards stay."""
    _save(q.conn, request.role, ROLE_NAMES[request.role], request.role, request)
    return activate(q, request.role)


def seed_profiles(conn: sqlite3.Connection) -> None:
    """Preloads the department profiles once, so deleting one keeps it deleted. None is made
    active: the first visit still asks, and offers them."""
    if get_meta(conn, "profiles_seeded"):
        return
    for profile_id, name, role in PRESETS:
        s = suggestions(conn, role)
        request = ProfileCreate(role=role, dashboard_name=s.name, subject_ids=s.picks)
        _save(conn, profile_id, name, role, request)
    set_meta(conn, "profiles_seeded", now())


def log_visit(q: Queries, path: str) -> None:
    """Logs an app load with the active role; before a role is picked there is nothing to log."""
    role = active_profile(q).role
    if role is None:
        return
    q.conn.execute(
        "INSERT INTO visits (date, role, path) VALUES (?, ?, ?)",
        (date.today().isoformat(), role, path),
    )
    q.conn.commit()


# ---- suggestions


def _names(items: list[str], most: int = 3) -> str:
    """ "DBS", "DBS and UOB", "DBS, OCBC and UOB", "A, B, C and 2 more"."""
    if len(items) > most:
        return f"{', '.join(items[:most])} and {len(items) - most} more"
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


def _links_to(conn: sqlite3.Connection, ids: list[str]) -> list[Relationship]:
    marks = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT data FROM relationships WHERE to_id IN ({marks})", ids)
    return [Relationship.model_validate_json(r["data"]) for r in rows]


def _provider_rows(conn: sqlite3.Connection, provider_ids: list[str]) -> list[PickerRow]:
    """Each provider with who uses it, tracked institutions first: "Used by DBS and UOB, for
    cloud services". The evidence is the weakest grade among those links."""
    names = display_names(conn)
    tracked = set(all_subjects())
    users: dict[str, list[Relationship]] = {}
    for r in _links_to(conn, provider_ids):
        if r.type == "depends_on" and r.evidence != "assumed":
            users.setdefault(r.to, []).append(r)
    out: list[PickerRow] = []
    for provider in provider_ids:
        links = sorted(users.get(provider, []), key=lambda r: (r.from_ not in tracked, r.from_))
        if not links:
            out.append(PickerRow(subject_id=provider, reason=None, evidence=None))
            continue
        reason = f"Used by {_names([names.get(r.from_, r.from_) for r in links])}"
        services = {r.service for r in links}
        if len(services) == 1 and (service := links[0].service) is not None:
            reason += f", for {SERVICE_WORDS[service]}"
        evidence: Evidence = max(
            (r.evidence for r in links), key=lambda e: EVIDENCE_GRADES.index(e)
        )
        out.append(PickerRow(subject_id=provider, reason=reason, evidence=evidence))
    return out


def _used_by_banks(conn: sqlite3.Connection, member_ids: list[str]) -> list[str]:
    """The members the three banks link to, plus those a linked member depends on (FAST depends
    on BCS), in member order."""
    links = _links_to(conn, member_ids)
    used = {r.to for r in links if r.from_ in BANKS and r.evidence != "assumed"}
    used |= {r.to for r in links if r.from_ in used and r.type == "depends_on"}
    return [m for m in member_ids if m in used]


def _mas_supervised(conn: sqlite3.Connection) -> list[str]:
    """Tracked entities with a supervised-by-MAS link; the three banks when the store has none."""
    subjects = all_subjects()
    rows = conn.execute(
        "SELECT from_id FROM relationships WHERE type = 'supervised_by' AND to_id = 'mas'"
    ).fetchall()
    found = [r["from_id"] for r in rows if r["from_id"] in subjects]
    return sorted(found, key=list(subjects).index) or BANKS


def suggestions(conn: sqlite3.Connection, role: Role | None) -> Suggestions:
    seed = load_subjects()
    display_names(conn)  # makes sure the relationship tables exist
    groups = [
        PickerGroup(
            id="topics",
            name="Topics",
            rows=[PickerRow(subject_id=t.id, reason=None, evidence=None) for t in seed.topics],
            suggested=True,
        )
    ]
    for g in seed.groups:
        rows = (
            _provider_rows(conn, g.members)
            if g.id == "tech-providers"
            else [PickerRow(subject_id=m, reason=None, evidence=None) for m in g.members]
        )
        groups.append(PickerGroup(id=g.id, name=g.name, rows=rows, suggested=True))
    if role is None:
        return Suggestions(role=None, name="My dashboard", groups=groups, picks=[])

    by_id = {g.id: g for g in groups}
    if role == "other":
        supervised = _mas_supervised(conn)
        by_id["mas-supervised"] = PickerGroup(
            id="mas-supervised",
            name="Entities MAS supervises",
            rows=[PickerRow(subject_id=i, reason=None, evidence=None) for i in supervised],
            suggested=True,
        )
    picks: list[str] = {
        "regulatory_supervisor": lambda: BANKS,
        "tech_cyber_supervisor": lambda: [
            *BANKS,
            *TCRD_TOPICS,
            *_used_by_banks(conn, [r.subject_id for r in by_id["tech-providers"].rows]),
            *_used_by_banks(conn, [r.subject_id for r in by_id["payment-systems"].rows]),
        ],
        "development_staff": lambda: [*FMD_TOPICS, "sgx", "hkex"],
        "other": lambda: [r.subject_id for r in by_id["mas-supervised"].rows],
    }[role]()
    opened = OPEN_GROUPS[role]
    ordered = [by_id[i] for i in opened] + [
        g.model_copy(update={"suggested": False}) for g in groups if g.id not in opened
    ]
    return Suggestions(role=role, name=DASHBOARD_NAMES[role], groups=ordered, picks=picks)
