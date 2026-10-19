#!/bin/sh
# Refresh the demo data for a testing session: ./scripts/refresh-for-sessions.sh YYYY-MM-DD
# Backs up the store, ingests news, social posts and trends for the 60 days to that date
# (X search reaches back only 7 days, so run it on or just before the session date),
# computes that date's run and the run a week earlier, and redeploys the demo with the new store.
set -e
day=${1:?usage: scripts/refresh-for-sessions.sh YYYY-MM-DD}
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
sqlite3 data/intelmonitor.db ".backup 'data/intelmonitor-before-refresh-$day.db'"
cd api
uv run im ingest --t0 "$day"
uv run im run --both
cd "$root"
DEPLOY_MESSAGE="data refresh for $day" ./scripts/deploy.sh --data
