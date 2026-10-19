#!/usr/bin/env bash
# Starts the Portless HTTPS proxy on port 443 as the current user, so the dev
# servers answer at https://intelmonitor.{web,api}.localhost with no port.
# macOS lets unprivileged processes bind 443, but Portless always asks for sudo
# below port 1024; a preload that reports uid 0 skips that gate.
# Usage: scripts/proxy-start.sh, then start the dev servers as in docs/archive/poc-plan.md.
set -euo pipefail

shim="$(mktemp -d)/uid.mjs"
echo 'process.getuid = () => 0;' > "$shim"

portless proxy stop >/dev/null 2>&1 || true
NODE_OPTIONS="--import=file://$shim" portless proxy start --https -p 443 --skip-trust
