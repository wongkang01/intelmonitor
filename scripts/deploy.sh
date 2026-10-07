#!/bin/sh
# Deploy the demo to Railway: ./scripts/deploy.sh [--data]
# Uploads the repo's tracked and unignored files. --data also ships a snapshot of
# data/intelmonitor.db, which replaces the deployed store, testers' edits included.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cd "$root"
git ls-files -co --exclude-standard -z | xargs -0 -I{} sh -c '[ -f "$1" ] && mkdir -p "$2/$(dirname "$1")" && cp "$1" "$2/$1" || true' _ {} "$stage"
mkdir -p "$stage/deploy/seed"
if [ "$1" = "--data" ]; then
  sqlite3 data/intelmonitor.db ".backup '$stage/deploy/seed/intelmonitor.db'"
  sqlite3 "$stage/deploy/seed/intelmonitor.db" "PRAGMA journal_mode=DELETE" > /dev/null
fi
railway up "$stage" --path-as-root --no-gitignore --service site --detach -m "${DEPLOY_MESSAGE:-$(git log -1 --format=%s)}"
