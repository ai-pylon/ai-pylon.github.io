"""Linux capability: cap:system.daemon_stat — live daemon status snapshot."""
from __future__ import annotations

import sys
from pathlib import Path

_DAEMONS_DIR = str(Path(__file__).resolve().parents[2])
if _DAEMONS_DIR not in sys.path:
    sys.path.insert(0, _DAEMONS_DIR)

import status_http  # noqa: E402

CAPABILITY = "cap:system.daemon_stat"


def _status(args: dict, ctx: dict) -> dict:
    snap = status_http.get_active_snapshot()
    if snap is not None:
        return snap
    return {"ok": False, "error": "Daemon status state not initialized"}


METHODS = {
    "status": _status,
}
