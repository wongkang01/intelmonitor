#!/bin/sh
# Container start: install a newly shipped store on the volume, then serve the site. The store's
# hash is kept beside it, so restarts and code-only deploys keep what testers changed.
set -e
seed=/app/deploy/seed/intelmonitor.db
if [ -f "$seed" ]; then
  hash=$(sha256sum "$seed" | cut -d' ' -f1)
  if [ "$hash" != "$(cat "$INTELMONITOR_DATA_DIR/seed.sha256" 2>/dev/null)" ]; then
    mkdir -p "$INTELMONITOR_DATA_DIR"
    rm -f "$INTELMONITOR_DATA_DIR"/intelmonitor.db*
    cp "$seed" "$INTELMONITOR_DATA_DIR/intelmonitor.db"
    echo "$hash" > "$INTELMONITOR_DATA_DIR/seed.sha256"
    echo "Installed the shipped store ($hash)"
  fi
fi
exec /app/api/.venv/bin/uvicorn intelmonitor.server.site:site --host 0.0.0.0 --port "${PORT:-8000}"
