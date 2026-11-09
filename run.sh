#!/usr/bin/env bash
# Start the stained-glass demo: installs dependencies on first run, then serves it.
# Usage: ./run.sh [port]      (default 5173)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-5173}"
[ -d node_modules ] || npm install
exec npx vite --port "$PORT" --open
