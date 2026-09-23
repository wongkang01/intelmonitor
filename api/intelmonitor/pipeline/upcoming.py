"""Upcoming dates: scheduled dates from extraction (step 4) that fall on or after the run date,
attached to the development their finding belongs to."""

import json
import sqlite3
from datetime import date

from intelmonitor.pipeline.developments import Development


def store_upcoming(
    conn: sqlite3.Connection, run_id: str, as_of: date, devs: list[Development]
) -> int:
    conn.execute("DELETE FROM upcoming_dates WHERE run_id = ?", (run_id,))
    finding_dev = {f.id: d.id for d in devs for f in d.findings}
    rows: set[tuple[str, str, str, str, str]] = set()
    for fid, dev_id in finding_dev.items():
        row = conn.execute("SELECT dates FROM findings WHERE id = ?", (fid,)).fetchone()
        for d in json.loads(row["dates"]):
            if d["date"] >= as_of.isoformat():
                rows.add((run_id, dev_id, fid, d["date"], d["label"]))
    conn.executemany(
        "INSERT INTO upcoming_dates (run_id, development_id, finding_id, date, label) "
        "VALUES (?, ?, ?, ?, ?)",
        sorted(rows),
    )
    conn.commit()
    return len(rows)
