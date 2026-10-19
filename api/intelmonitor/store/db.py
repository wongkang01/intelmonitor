"""SQLite store at data/intelmonitor.db. Each phase adds its tables to SCHEMA."""

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from intelmonitor.config import DATA_DIR
from intelmonitor.store import search

DB_PATH = DATA_DIR / "intelmonitor.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_documents (
    id TEXT PRIMARY KEY,               -- sha256(canonical_url)[:16], stable across reruns
    source TEXT NOT NULL,              -- mas, fed, ecb, hkma, bis, fsb, exa, tavily, x or detector
    collection TEXT NOT NULL,          -- dms, official, news, social, or data (detections)
    doc_type TEXT NOT NULL,            -- e.g. Media Releases, Speeches, News
    classification TEXT NOT NULL,      -- public for every POC document
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,        -- ISO 8601, UTC
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE, -- sha256 of normalized text
    ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS source_documents_published ON source_documents (published_at);

-- Pipeline. Screening, tags and findings are per document and shared by every run; everything
-- keyed by run_id is rebuilt for that run from the documents published on or before its date.

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,               -- the as-of date, YYYY-MM-DD
    as_of TEXT NOT NULL,
    previous_run_id TEXT,              -- the run this one is diffed against
    status TEXT NOT NULL,              -- running, complete or failed
    documents INTEGER NOT NULL,        -- documents published on or before as_of
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT
);

-- One row per execution of a run: `im run` on the command line, or Run now in the app. There is
-- no scheduler yet. A rerun recomputes an existing run in place, so runs keeps one row per date
-- and the executions live here. The counts compare against the previous run, the latest earlier
-- as-of date, so every execution of a date reports what that date found.
CREATE TABLE IF NOT EXISTS run_log (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL,              -- the runs row it computed
    trigger TEXT NOT NULL,             -- cli (`im run`) or manual (Run now)
    triggered_by TEXT,                 -- the profile's display name, for manual runs
    status TEXT NOT NULL,              -- running, complete or failed
    sources INTEGER NOT NULL,          -- distinct ingest sources among its documents
    documents INTEGER NOT NULL,
    developments INTEGER,              -- set when complete, as are the counts below
    first_run INTEGER,                 -- 1 when there was nothing to compare against
    new_count INTEGER,
    updated_count INTEGER,
    needs_attention_count INTEGER,     -- new or updated developments needing attention
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS run_log_run ON run_log (run_id);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT PRIMARY KEY REFERENCES source_documents (id),
    relevance REAL NOT NULL,           -- Jev noul
    relevant INTEGER NOT NULL,         -- final decision after routing
    relevance_source TEXT NOT NULL,    -- jev or claude
    category TEXT NOT NULL,
    category_confidence REAL NOT NULL,
    stage TEXT,                        -- only for regulatory items
    stage_confidence REAL,
    subject_scores TEXT NOT NULL,      -- JSON {subject_id: noul}
    jurisdictions TEXT NOT NULL,       -- JSON {jurisdiction: noul}
    screened_chars INTEGER NOT NULL,   -- characters of text Jev saw
    truncated INTEGER NOT NULL         -- 1 when screened on title plus leading chunks
);

CREATE TABLE IF NOT EXISTS document_subjects (
    document_id TEXT NOT NULL REFERENCES source_documents (id),
    subject_id TEXT NOT NULL,
    confidence REAL NOT NULL,          -- Jev noul, or 1.0 / 0.0 when Claude decided
    source TEXT NOT NULL,              -- jev or claude
    PRIMARY KEY (document_id, subject_id)
);

CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,               -- <document_id>-<index>
    document_id TEXT NOT NULL REFERENCES source_documents (id),
    statement TEXT NOT NULL,
    category TEXT NOT NULL,
    event_date TEXT,                   -- YYYY-MM-DD
    subjects TEXT NOT NULL,            -- JSON [subject_id]: every subject it involves
    quotes TEXT NOT NULL,              -- JSON [{text, start, end}], offsets into the document text
    dates TEXT NOT NULL,               -- JSON [{date, label}] mentioned in the document
    -- JSON {subject_id: {role, adverse, tone}} from extraction: role is affected, actor,
    -- commentator or mentioned. Empty for detections, whose subjects are all affected.
    roles TEXT NOT NULL DEFAULT '{}',
    promotional INTEGER NOT NULL DEFAULT 0 -- 1 for marketing or routine product news
);
CREATE INDEX IF NOT EXISTS findings_document ON findings (document_id);

CREATE TABLE IF NOT EXISTS developments (
    run_id TEXT NOT NULL REFERENCES runs (id),
    id TEXT NOT NULL,                  -- id of its earliest finding, stable across runs
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    stage TEXT,
    event_date TEXT,
    first_published TEXT NOT NULL,
    last_published TEXT NOT NULL,
    materiality_level INTEGER NOT NULL, -- its highest priority_level over its subjects
    materiality_score REAL NOT NULL,    -- that subject's priority_score
    materiality_confidence REAL NOT NULL,
    needs_attention INTEGER NOT NULL,   -- materiality_level >= 3: High priority
    PRIMARY KEY (run_id, id)
);

-- The subjects a development happened to (affected) or that did it (actor), with its priority
-- for each. Subjects that only comment on it or are mentioned are in development_mentions.
CREATE TABLE IF NOT EXISTS development_subjects (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    confidence REAL NOT NULL,          -- the screening tag's confidence
    source TEXT NOT NULL,              -- who tagged it: jev, claude or detector
    role TEXT NOT NULL DEFAULT 'affected', -- affected or actor
    adverse INTEGER NOT NULL DEFAULT 0, -- 1 when a finding says something bad happened to it
    tone TEXT NOT NULL DEFAULT 'neutral', -- positive, negative or neutral, for this subject
    priority_level INTEGER NOT NULL DEFAULT 0, -- 0 Trivial to 4 Critical, for this subject
    priority_score REAL NOT NULL DEFAULT 0, -- Jev expected score
    priority_confidence REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, development_id, subject_id)
);

-- Subjects that only comment on a development or are mentioned in it. They never drive a page,
-- a priority or an impact.
CREATE TABLE IF NOT EXISTS development_mentions (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    role TEXT NOT NULL,                -- commentator or mentioned
    PRIMARY KEY (run_id, development_id, subject_id)
);

-- Indirect impacts (pipeline/impact.py): entities a development reaches through the relationship
-- store, as Claude judged them, kept apart from development_subjects. Code writes the route from
-- the path; Claude only picks the path and writes why.
CREATE TABLE IF NOT EXISTS development_impacts (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,          -- the entity reached
    rank INTEGER NOT NULL,             -- order within the development: direct loan shares first
    direction TEXT NOT NULL,           -- negative, positive or mixed, for this entity
    route TEXT NOT NULL,               -- plain words: "via its Hong Kong loans, 12.2% of total"
    why TEXT NOT NULL,                 -- one or two sentences citing the development
    confidence TEXT NOT NULL,          -- high, medium or low
    relationship_ids TEXT NOT NULL,    -- JSON [id], from the entity outward
    weight REAL,                       -- the path's share of loans, if it has an exposure
    region TEXT,                       -- the region endpoint, when the share covers a whole region
    evidence TEXT NOT NULL,            -- the weakest grade on the path: public or reported
    finding_ids TEXT NOT NULL,         -- JSON [finding id] the why relies on
    passages TEXT NOT NULL,            -- JSON [{document_id, domain, published, text}] it relies on
    PRIMARY KEY (run_id, development_id, subject_id)
);
CREATE INDEX IF NOT EXISTS development_impacts_subject ON development_impacts (run_id, subject_id);

CREATE TABLE IF NOT EXISTS development_sources (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    finding_id TEXT NOT NULL REFERENCES findings (id),
    document_id TEXT NOT NULL REFERENCES source_documents (id),
    PRIMARY KEY (run_id, development_id, finding_id)
);

CREATE TABLE IF NOT EXISTS question_answers (
    run_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    state TEXT NOT NULL,               -- stable, watch, needs_attention or new
    new_count INTEGER NOT NULL,        -- items behind a "new" state
    development_ids TEXT NOT NULL,     -- JSON [development_id]
    series_ids TEXT NOT NULL DEFAULT '[]', -- JSON [series_id], cited facts
    state_rules TEXT NOT NULL DEFAULT '[]', -- JSON [sentence], rules that fixed the state
    PRIMARY KEY (run_id, subject_id, question_id)
);

CREATE TABLE IF NOT EXISTS upcoming_dates (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    date TEXT NOT NULL,                -- YYYY-MM-DD, on or after the run date
    label TEXT NOT NULL,
    PRIMARY KEY (run_id, finding_id, date, label)
);

CREATE TABLE IF NOT EXISTS run_changes (
    run_id TEXT NOT NULL,
    base_run_id TEXT NOT NULL,
    kind TEXT NOT NULL,                -- new_development, updated_development, question_state
    subject_id TEXT,                   -- set for question_state
    ref_id TEXT NOT NULL,              -- development id or question id
    detail TEXT NOT NULL               -- JSON
);
CREATE INDEX IF NOT EXISTS run_changes_run ON run_changes (run_id, kind);

CREATE TABLE IF NOT EXISTS graph_nodes (
    run_id TEXT NOT NULL,
    id TEXT NOT NULL,                  -- subject or endpoint id, or dev:<development_id>
    type TEXT NOT NULL,                -- topic, group, entity, endpoint or development
    label TEXT NOT NULL,
    data TEXT NOT NULL,                -- JSON
    PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS graph_edges (
    run_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,                -- a relationship type in capitals, AFFECTS or IMPACTS
    source TEXT NOT NULL,              -- relationships, seed, jev, claude or detector
    confidence REAL NOT NULL,
    label TEXT NOT NULL DEFAULT '',    -- the link in plain words
    detail TEXT NOT NULL DEFAULT '{}', -- JSON: relationship id, or an impact's route
    PRIMARY KEY (run_id, from_id, to_id, type)
);

CREATE TABLE IF NOT EXISTS inference_records (
    id INTEGER PRIMARY KEY,
    run_id TEXT,                       -- the run that made the call
    stage TEXT NOT NULL,               -- screen, route, extract, same_event, priority, answer
    engine TEXT NOT NULL,              -- jev or claude
    model TEXT NOT NULL,               -- requested model
    model_version TEXT,                -- model reported by the response
    input_ref TEXT NOT NULL,           -- e.g. doc:<id>, pair:<a>|<b>, subject:<id>
    input_hash TEXT NOT NULL,          -- sha256 of the full input; a cache hit skips the call
    output TEXT,                       -- JSON
    confidence REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL,              -- ok, error, or refused (a usage-policy refusal)
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inference_records_cache ON inference_records (stage, input_hash, status);

-- App state written through the API.

CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    spec TEXT NOT NULL,                -- JSON DashboardSpec: name, subject ids and widgets
    starter INTEGER NOT NULL,          -- 1 for the seeded starter dashboards
    position INTEGER NOT NULL,         -- sidebar order
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT                    -- set when deleted; restoring clears it
);

-- Profiles stand in for identity (phase1-plan.md, item U3): each is a role with its own dashboards.
-- The user's own profile for a role has the role as its id; the preloaded department profiles
-- are tcrd and fmd. The active one is meta active_profile.
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                -- on the profile button: "TCRD", or the role's name
    role TEXT NOT NULL,                -- regulatory_supervisor, tech_cyber_supervisor, ...
    default_dashboard_id TEXT,
    position INTEGER NOT NULL,         -- order in the profile menu
    created_at TEXT NOT NULL
);

-- One row per app load with a profile, so days with a visit can be counted per role.
CREATE TABLE IF NOT EXISTS visits (
    date TEXT NOT NULL,                -- local calendar date
    role TEXT NOT NULL,
    path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_role ON visits (role, date);

CREATE TABLE IF NOT EXISTS analyst_actions (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                -- review or note
    subject_id TEXT,
    development_id TEXT,
    text TEXT,                         -- set for notes
    run_id TEXT,                       -- the latest run when the action was taken
    created_at TEXT NOT NULL,
    deleted_at TEXT                    -- set when a note is deleted; restoring clears it
);
CREATE INDEX IF NOT EXISTS analyst_actions_subject ON analyst_actions (subject_id, kind);

-- Triage per development, kept across runs. Read holds the latest run when it was read, so a
-- development that a later run changes is unread again. Flags and dismissals stay until cleared.
CREATE TABLE IF NOT EXISTS development_triage (
    development_id TEXT PRIMARY KEY,
    read_run_id TEXT,                  -- null when unread
    flagged_at TEXT,                   -- null when not flagged
    dismissed_at TEXT,                 -- null when not dismissed
    not_relevant_at TEXT               -- the analyst said it does not belong; kept for the eval set
);

-- The subjects the analyst follows; alerts cover these only. Seeded once from the subjects on
-- dashboards, and extended when a dashboard is created.
CREATE TABLE IF NOT EXISTS follows (
    subject_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

-- The analyst's corrections to the AI. A tag correction removes a subject from one development
-- in every later run. An answer correction goes into the answer prompt of the run that recomputes
-- the corrected answer's run and of the run after it. Undo deletes the row.
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                -- tag or answer
    subject_id TEXT NOT NULL,          -- the tag's subject, or the answer's subject
    development_id TEXT,               -- tag: the development it is removed from
    question_id TEXT,                  -- answer: the built-in question
    run_id TEXT NOT NULL,              -- the latest run when it was given
    answer_state TEXT,                 -- answer: the answer as it was marked wrong
    answer_summary TEXT,
    state TEXT,                        -- answer: what the state should be, when it is wrong
    summary_wrong INTEGER NOT NULL DEFAULT 0,
    development_ids TEXT NOT NULL DEFAULT '[]', -- answer: JSON [id], cited ones marked wrong
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_kind ON feedback (kind, subject_id);

CREATE TABLE IF NOT EXISTS custom_questions (
    id TEXT PRIMARY KEY,               -- custom-<hex>
    subject_id TEXT NOT NULL,
    question TEXT NOT NULL,
    label TEXT NOT NULL,
    lookback_days INTEGER NOT NULL,
    request TEXT NOT NULL,             -- what the user typed
    status TEXT NOT NULL,              -- draft until the user keeps it, then kept
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    series_ids TEXT NOT NULL DEFAULT '[]' -- JSON [series_id]: series whose facts answers get
);

CREATE TABLE IF NOT EXISTS custom_question_answers (
    question_id TEXT NOT NULL REFERENCES custom_questions (id),
    run_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    state TEXT NOT NULL,               -- stable, watch, needs_attention or new
    new_count INTEGER NOT NULL,
    development_ids TEXT NOT NULL,     -- JSON [development_id] in that run
    document_ids TEXT NOT NULL,        -- JSON [document_id]: the top matches Claude read
    series_ids TEXT NOT NULL DEFAULT '[]', -- JSON [series_id] the answer cites
    facts TEXT NOT NULL DEFAULT '[]',  -- JSON [SeriesFact]: what the answer was told
    PRIMARY KEY (question_id, run_id)
);

-- Structured data (docs/archive/structured-data-plan.md, store/series.py). The catalogue tables
-- mirror api/seed/series.yaml and are rewritten on every series fetch; observations keep the
-- latest value per period, and a changed value leaves a revision row.
CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY,               -- e.g. mas.ltd.overall
    source TEXT NOT NULL,              -- mas, fred, coingecko, defillama, yahoo, manual or derived
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    frequency TEXT NOT NULL,           -- daily, monthly, quarterly or yearly
    decimals INTEGER NOT NULL,
    bad_direction TEXT NOT NULL,       -- up, down or none
    source_url TEXT NOT NULL,
    derived_from TEXT                  -- JSON operation, e.g. {"kind": "share", ...}; null if raw
);

CREATE TABLE IF NOT EXISTS series_subjects (
    series_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    role TEXT NOT NULL,                -- primary or context
    PRIMARY KEY (series_id, subject_id)
);
CREATE INDEX IF NOT EXISTS series_subjects_subject ON series_subjects (subject_id);

CREATE TABLE IF NOT EXISTS observations (
    series_id TEXT NOT NULL,
    period TEXT NOT NULL,              -- period end, YYYY-MM-DD
    value REAL NOT NULL,
    preliminary INTEGER NOT NULL,      -- 1 while the source flags it preliminary
    available_at TEXT NOT NULL,        -- ISO 8601 UTC, when the value could first have been known
    fetched_at TEXT NOT NULL,          -- when it was stored or last changed
    PRIMARY KEY (series_id, period)
);

CREATE TABLE IF NOT EXISTS observation_revisions (
    id INTEGER PRIMARY KEY,
    series_id TEXT NOT NULL,
    period TEXT NOT NULL,
    old_value REAL NOT NULL,
    new_value REAL NOT NULL,
    revised_at TEXT NOT NULL           -- ISO 8601 UTC, the fetch that saw the new value
);
CREATE INDEX IF NOT EXISTS observation_revisions_series
ON observation_revisions (series_id, period);

-- Where each figure of a hand-collected series comes from (item M, ingest/series/manual.py).
-- Each fetch replaces the series' sources; its observations are saved as for any other series.
CREATE TABLE IF NOT EXISTS observation_sources (
    series_id TEXT NOT NULL,
    period TEXT NOT NULL,              -- period end, YYYY-MM-DD, as in observations
    url TEXT NOT NULL,
    title TEXT NOT NULL,               -- the publication
    quote TEXT,                        -- the verbatim sentence or table row
    chart_reading INTEGER NOT NULL,    -- 1 when the value was read from a chart
    PRIMARY KEY (series_id, period)
);

-- What each run saw per series, so runs diff and "since your last review" covers indicators.
CREATE TABLE IF NOT EXISTS run_indicators (
    run_id TEXT NOT NULL,
    series_id TEXT NOT NULL,
    period TEXT NOT NULL,              -- the latest period available as of the run
    value REAL NOT NULL,
    change TEXT NOT NULL,              -- JSON {window: change}
    state TEXT NOT NULL,
    detail TEXT NOT NULL,              -- JSON
    PRIMARY KEY (run_id, series_id)
);

-- The facts each run gave a subject's answers (pipeline/facts.py), so a cited series shows what the
-- answer saw.
CREATE TABLE IF NOT EXISTS run_facts (
    run_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    series_id TEXT NOT NULL,
    fact TEXT NOT NULL,                -- JSON SeriesFact
    PRIMARY KEY (run_id, subject_id, series_id)
);

-- Each run's note per subject on why its series moved in the week to the run (pipeline/notes.py),
-- with the facts code computed for it.
CREATE TABLE IF NOT EXISTS run_notes (
    run_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    since TEXT NOT NULL,               -- the week's start: the previous run's date
    headline TEXT NOT NULL,
    body TEXT NOT NULL,                -- [n] cites development_ids[n - 1]
    development_ids TEXT NOT NULL,     -- JSON, in citation order
    series_id TEXT,                    -- the series the headline is about
    moves TEXT NOT NULL,               -- JSON [SeriesMove], the facts the note was given
    PRIMARY KEY (run_id, subject_id)
);

-- Each run's brief per subject for the top of its monitor page (pipeline/summaries.py; item B of
-- phase1-plan.md). Claude writes the state, concerns and direction from the week's evidence and
-- the subject's standing position; code checks them and computes the counts. Rows written before
-- the brief have concerns and points null; briefs written before concerns have points instead.
CREATE TABLE IF NOT EXISTS run_summaries (
    run_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    text TEXT NOT NULL,                -- the state: the subject's situation now
    direction TEXT,                    -- worse, better, unchanged or mixed, against the last brief
    direction_basis TEXT NOT NULL,     -- code's signals for the direction, in words
    developments_in_scope INTEGER NOT NULL, -- its developments with a source in the last 7 days
    needs_attention INTEGER NOT NULL,  -- of those, High for it
    adverse INTEGER NOT NULL,          -- of those, adverse to it
    model TEXT NOT NULL,               -- the model that wrote the brief; none when code wrote it
    created_at TEXT NOT NULL,
    direction_reason TEXT NOT NULL DEFAULT '', -- the model's one line on the direction
    direction_flagged INTEGER NOT NULL DEFAULT 0, -- 1: the direction disagrees with code's signals
    concerns TEXT,                     -- JSON [{text, development_ids}]
    points TEXT,                       -- earlier briefs: JSON [{claim, why_it_matters, ...}]
    indirect TEXT NOT NULL DEFAULT '[]', -- earlier briefs: JSON [development_id]
    coming_up TEXT NOT NULL DEFAULT '[]', -- JSON [{date, label, development_id}]
    latest_news TEXT,                  -- YYYY-MM-DD, its latest development's last source
    problems TEXT NOT NULL DEFAULT '[]', -- JSON [rule], what the brief still broke after the retry
    PRIMARY KEY (run_id, subject_id)
);

-- Detector firings (pipeline/detectors.py): each one is a source document in the data collection
-- with one finding. Written once per event: the document id comes from the detector, the series and
-- the event's first period, so reruns find the row already there.
CREATE TABLE IF NOT EXISTS detections (
    document_id TEXT PRIMARY KEY REFERENCES source_documents (id),
    detector_id TEXT NOT NULL,         -- api/seed/detectors.yaml; its materiality applies
    series_id TEXT NOT NULL,
    start TEXT NOT NULL,               -- first period of the event, YYYY-MM-DD
    period TEXT NOT NULL,              -- the period whose value fired it
    value REAL NOT NULL,
    direction TEXT NOT NULL            -- the move's tone: positive, negative or neutral
);

-- Social posts and forum threads (ingest/sources/social.py): what a source document in the social
-- collection carries beyond the document itself. Engagement counts are as of the fetch.
CREATE TABLE IF NOT EXISTS social_posts (
    document_id TEXT PRIMARY KEY REFERENCES source_documents (id),
    platform TEXT NOT NULL,            -- x, reddit or hardwarezone
    subject_id TEXT NOT NULL,          -- the subject whose search found it
    query TEXT NOT NULL,
    post_id TEXT,                      -- X post id
    author_id TEXT,                    -- X author id
    likes INTEGER,
    reposts INTEGER,
    replies INTEGER,
    quotes INTEGER,
    impressions INTEGER,
    fetched_at TEXT NOT NULL
);

-- Search trends (ingest/sources/trends.py), one snapshot per ingest T0. Google trending searches
-- and X trends hold one row per trending term; Google interest over time holds one row per term
-- and day, relative (0 to 100) within the call that fetched it, so compare a term with its own
-- baseline.
CREATE TABLE IF NOT EXISTS trends (
    snapshot TEXT NOT NULL,            -- the ingest T0, YYYY-MM-DD
    source TEXT NOT NULL,              -- google (SerpApi), google_rss (no key) or x
    kind TEXT NOT NULL,                -- trending or interest
    geo TEXT NOT NULL,                 -- SG, MY, ...
    term TEXT NOT NULL,
    observed_at TEXT NOT NULL,         -- trending: when it started; interest: the day
    value REAL,                        -- search volume, post count or interest (0 to 100)
    subjects TEXT NOT NULL DEFAULT '[]', -- JSON ids of tracked subjects the term names
    detail TEXT NOT NULL DEFAULT '{}', -- JSON: increase, categories, related terms, call terms
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (snapshot, source, kind, geo, term, observed_at)
);

-- Full-text search (store/search.py). Both tables keep their own copy of the text, so they do not
-- depend on rowids staying put. Triggers index documents on every write; the pipeline indexes a
-- run's developments when it stores them, with the statements of all their findings as summary.
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, text, document_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS source_documents_fts_insert AFTER INSERT ON source_documents BEGIN
    INSERT INTO documents_fts (title, text, document_id) VALUES (new.title, new.text, new.id);
END;
CREATE TRIGGER IF NOT EXISTS source_documents_fts_delete AFTER DELETE ON source_documents BEGIN
    DELETE FROM documents_fts WHERE document_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS source_documents_fts_update AFTER UPDATE OF title, text
ON source_documents BEGIN
    DELETE FROM documents_fts WHERE document_id = old.id;
    INSERT INTO documents_fts (title, text, document_id) VALUES (new.title, new.text, new.id);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS developments_fts USING fts5(
    title, summary, run_id UNINDEXED, development_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
"""

# Columns added to tables after stores were created. connect() adds any a store lacks, in place.
ADDED_COLUMNS = [
    ("dashboards", "deleted_at", "TEXT"),
    # The profile that made the dashboard; null for starter and older ones, listed for every
    # profile (phase1-plan.md, item U3).
    ("dashboards", "profile_id", "TEXT"),
    ("analyst_actions", "deleted_at", "TEXT"),
    ("question_answers", "series_ids", "TEXT NOT NULL DEFAULT '[]'"),
    ("question_answers", "state_rules", "TEXT NOT NULL DEFAULT '[]'"),
    ("custom_questions", "series_ids", "TEXT NOT NULL DEFAULT '[]'"),
    ("custom_question_answers", "series_ids", "TEXT NOT NULL DEFAULT '[]'"),
    ("custom_question_answers", "facts", "TEXT NOT NULL DEFAULT '[]'"),
    # The detector whose rule set the level; null when Jev scored it (pipeline/developments.py).
    ("developments", "materiality_rule", "TEXT"),
    # Roles, adverse and priority per subject (phase1-plan.md, item A).
    ("findings", "roles", "TEXT NOT NULL DEFAULT '{}'"),
    ("findings", "promotional", "INTEGER NOT NULL DEFAULT 0"),
    ("development_subjects", "role", "TEXT NOT NULL DEFAULT 'affected'"),
    ("development_subjects", "adverse", "INTEGER NOT NULL DEFAULT 0"),
    ("development_subjects", "tone", "TEXT NOT NULL DEFAULT 'neutral'"),
    ("development_subjects", "priority_level", "INTEGER NOT NULL DEFAULT 0"),
    ("development_subjects", "priority_score", "REAL NOT NULL DEFAULT 0"),
    ("development_subjects", "priority_confidence", "REAL NOT NULL DEFAULT 0"),
    # Plain labels and relationship details on graph edges (phase1-plan.md, item I).
    ("graph_edges", "label", "TEXT NOT NULL DEFAULT ''"),
    ("graph_edges", "detail", "TEXT NOT NULL DEFAULT '{}'"),
    # The structured entity brief (phase1-plan.md, item B).
    ("run_summaries", "direction_reason", "TEXT NOT NULL DEFAULT ''"),
    ("run_summaries", "direction_flagged", "INTEGER NOT NULL DEFAULT 0"),
    ("run_summaries", "points", "TEXT"),
    ("run_summaries", "indirect", "TEXT NOT NULL DEFAULT '[]'"),
    ("run_summaries", "coming_up", "TEXT NOT NULL DEFAULT '[]'"),
    # Not relevant on a development, kept for the eval set (phase1-plan.md, item U1).
    ("development_triage", "not_relevant_at", "TEXT"),
    ("run_summaries", "latest_news", "TEXT"),
    ("run_summaries", "problems", "TEXT NOT NULL DEFAULT '[]'"),
    # The brief's concerns, in place of points and indirect (pipeline/summaries.py).
    ("run_summaries", "concerns", "TEXT"),
]


def _add_columns(conn: sqlite3.Connection) -> None:
    for table, column, declaration in ADDED_COLUMNS:
        columns = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
            except sqlite3.OperationalError as error:
                if "duplicate column" not in str(error):  # another process added it first
                    raise
    conn.commit()


def _per_subject_priority(conn: sqlite3.Connection) -> None:
    """Stores made before per-subject priority kept one materiality level, adverse score and
    direction per development, from the document-level screening. Each development subject takes
    its development's level until the next run scores it, with no adverse flag, and the
    development-level adverse and direction go, so nothing reads them."""
    stale = "SELECT 1 FROM pragma_table_info('developments') WHERE name = 'adverse'"
    if conn.execute(stale).fetchone() is None:
        return
    conn.execute("BEGIN IMMEDIATE")  # another connection may be migrating too
    if conn.execute(stale).fetchone() is None:
        conn.rollback()
        return
    conn.execute(
        "UPDATE development_subjects SET priority_level = d.materiality_level, "
        "priority_score = d.materiality_score, priority_confidence = d.materiality_confidence "
        "FROM developments d WHERE d.run_id = development_subjects.run_id "
        "AND d.id = development_subjects.development_id"
    )
    conn.execute("ALTER TABLE developments DROP COLUMN adverse")
    conn.execute("ALTER TABLE developments DROP COLUMN direction")
    conn.commit()


# Columns dropped once nothing read them: screening's document-level adverse and direction, and a
# detection's adverse score (phase1-decisions.md, S7). Tone is per subject, from extraction.
DROPPED_COLUMNS = [
    ("document_tags", "adverse"),
    ("document_tags", "direction"),
    ("document_tags", "direction_confidence"),
    ("detections", "adverse"),
]


def _drop_columns(conn: sqlite3.Connection) -> None:
    """Drops each column in DROPPED_COLUMNS that a store still has."""

    def present() -> list[tuple[str, str]]:
        return [
            (table, column)
            for table, column in DROPPED_COLUMNS
            if conn.execute(
                f"SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?", (column,)
            ).fetchone()
        ]

    if not present():
        return
    conn.execute("BEGIN IMMEDIATE")  # another connection may be dropping them too
    for table, column in present():
        conn.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
    conn.commit()


def _fold_alert_reads(conn: sqlite3.Connection) -> None:
    """Stores made before triage kept alert reads per run in alert_reads. Each development's
    latest read becomes its triage read, and the table goes."""
    exists = "SELECT 1 FROM sqlite_master WHERE name = 'alert_reads'"
    if conn.execute(exists).fetchone() is None:
        return
    conn.execute("BEGIN IMMEDIATE")  # another connection may be folding it too
    if conn.execute(exists).fetchone() is None:
        conn.rollback()
        return
    conn.execute(
        "INSERT INTO development_triage (development_id, read_run_id) "
        "SELECT development_id, max(run_id) FROM alert_reads WHERE true GROUP BY development_id "
        "ON CONFLICT (development_id) DO UPDATE SET read_run_id = "
        "max(coalesce(read_run_id, ''), excluded.read_run_id)"
    )
    conn.execute("DROP TABLE alert_reads")
    conn.commit()


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the store and make sure the schema exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # The API opens one connection per request, which FastAPI may use from a worker thread.
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # the API reads while a pipeline run writes
    indexed = conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'developments_fts'").fetchone()
    conn.executescript(SCHEMA)
    _add_columns(conn)
    _per_subject_priority(conn)
    _drop_columns(conn)
    _fold_alert_reads(conn)
    if indexed is None:
        search.rebuild(conn)  # the search tables are new: index what is already stored
    return conn


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return None if row is None else str(row["value"])


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


# Deleted dashboards and notes are kept this long, for Undo, before purge_deleted removes them.
PURGE_AFTER = timedelta(days=1)


def purge_deleted(conn: sqlite3.Connection) -> None:
    """Removes dashboards and notes deleted more than PURGE_AFTER ago. The API runs it when it
    starts; the delete toast's Undo is the only restore, so nothing reads them after that."""
    cutoff = (datetime.now(UTC) - PURGE_AFTER).isoformat()
    conn.execute("DELETE FROM dashboards WHERE deleted_at < ?", (cutoff,))
    conn.execute("DELETE FROM analyst_actions WHERE deleted_at < ?", (cutoff,))
    conn.commit()
