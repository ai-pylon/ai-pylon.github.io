#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONIOENCODING=utf-8
export PYLON2_DAEMON_MODE=server
export PYLON2_DATA_DIR="${PYLON2_DATA_DIR:-$HOME/pylon-server/data}"
mkdir -p "$PYLON2_DATA_DIR"

if [[ -x "$HOME/.venvs/aiweb/bin/python" ]]; then
  PY="$HOME/.venvs/aiweb/bin/python"
else
  PY="${PYTHON:-python3}"
fi

exec "$PY" "$SCRIPT_DIR/linux/agent.py" "$@"
