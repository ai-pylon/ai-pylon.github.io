"""Windows capability: cap:system.server_conn — HTTP server IPs, DuckDNS, and ngrok."""
from __future__ import annotations

import sys
from pathlib import Path

_DAEMONS_DIR = str(Path(__file__).resolve().parents[2])
if _DAEMONS_DIR not in sys.path:
    sys.path.insert(0, _DAEMONS_DIR)

import server_conn_runtime as _rt  # noqa: E402

CAPABILITY = "cap:system.server_conn"
VARIANT = "windows"
ATTRS = {"windows": True}


def _make(method: str):
    def _fn(args: dict, ctx: dict) -> dict:
        return _rt.dispatch_method(method, args or {}, ctx or {})

    return _fn


METHODS = {
    name: _make(name)
    for name in (
        "status",
        "network_info",
        "configure_server",
        "duckdns_configure",
        "duckdns_update",
        "ngrok_configure",
        "ngrok_start",
        "ngrok_stop",
    )
}


def shutdown() -> None:
    _rt.get_runtime().shutdown()
