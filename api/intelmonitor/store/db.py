"""SQLite store at data/intelmonitor.db. Each phase adds its tables to SCHEMA."""

import sqlite3
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
    source TEXT NOT NULL,              -- adapter: mas, fed, ecb, hkma, bis, fsb, exa, tavily
    collection TEXT NOT NULL,          -- dms, official or news
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

-- One row per execution of a run: `im run` counts as scheduled, Run now in the app as manual.
-- A manual rerun recomputes an existing run in place, so runs keeps one row per date and the
-- executions live here. The counts compare against what the execution replaced, or against the
-- previous run when the date had not been computed before.
CREATE TABLE IF NOT EXISTS run_log (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL,              -- the runs row it computed
    trigger TEXT NOT NULL,             -- scheduled or manual
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
    adverse REAL NOT NULL,             -- Jev noul
    direction TEXT NOT NULL,           -- positive, negative or neutral
    direction_confidence REAL NOT NULL,
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
    subjects TEXT NOT NULL,            -- JSON [subject_id]
    quotes TEXT NOT NULL,              -- JSON [{text, start, end}], offsets into the document text
    dates TEXT NOT NULL                -- JSON [{date, label}] mentioned in the document
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
    materiality_level INTEGER NOT NULL, -- 0 Trivial to 4 Critical
    materiality_score REAL NOT NULL,    -- Jev expected score
    materiality_confidence REAL NOT NULL,
    needs_attention INTEGER NOT NULL,   -- materiality_level >= 3
    adverse REAL NOT NULL,
    direction TEXT NOT NULL,
    PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS development_subjects (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (run_id, development_id, subject_id)
);

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
    id TEXT NOT NULL,                  -- subject id, or dev:<development_id>
    type TEXT NOT NULL,                -- topic, group, entity or development
    label TEXT NOT NULL,
    data TEXT NOT NULL,                -- JSON
    PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS graph_edges (
    run_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,                -- MEMBER_OF, EXPOSED_TO or AFFECTS
    source TEXT NOT NULL,              -- seed, jev or claude
    confidence REAL NOT NULL,
    PRIMARY KEY (run_id, from_id, to_id, type)
);

CREATE TABLE IF NOT EXISTS inference_records (
    id INTEGER PRIMARY KEY,
    run_id TEXT,                       -- the run that made the call
    stage TEXT NOT NULL,               -- screen, route, extract, same_event, materiality, answer
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
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyst_actions (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                -- review or note
    subject_id TEXT,
    development_id TEXT,
    text TEXT,                         -- set for notes
    run_id TEXT,                       -- the latest run when the action was taken
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analyst_actions_subject ON analyst_actions (subject_id, kind);

-- Alerts the analyst has read, per run: a development alerts again when a later run flags it.
CREATE TABLE IF NOT EXISTS alert_reads (
    run_id TEXT NOT NULL,
    development_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (run_id, development_id)
);

CREATE TABLE IF NOT EXISTS custom_questions (
    id TEXT PRIMARY KEY,               -- custom-<hex>
    subject_id TEXT NOT NULL,
    question TEXT NOT NULL,
    label TEXT NOT NULL,
    lookback_days INTEGER NOT NULL,
    request TEXT NOT NULL,             -- what the user typed
    status TEXT NOT NULL,              -- draft until the user keeps it, then kept
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_question_answers (
    question_id TEXT NOT NULL REFERENCES custom_questions (id),
    run_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    state TEXT NOT NULL,               -- stable, watch, needs_attention or new
    new_count INTEGER NOT NULL,
    development_ids TEXT NOT NULL,     -- JSON [development_id] in that run
    document_ids TEXT NOT NULL,        -- JSON [document_id]: the top matches Claude read
    PRIMARY KEY (question_id, run_id)
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


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the store and make sure the schema exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # The API opens one connection per request, which FastAPI may use from a worker thread.
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # the API reads while a pipeline run writes
    indexed = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name = 'developments_fts'"
    ).fetchone()
    conn.executescript(SCHEMA)
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
