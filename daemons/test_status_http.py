"""Unit tests for daemons/status_http.py."""
from __future__ import annotations

import json
import unittest
import urllib.request
from urllib.request import ProxyHandler, build_opener

import status_http


class StatusHttpTest(unittest.TestCase):
    def _get(self, url: str) -> tuple[int, str]:
        opener = build_opener(ProxyHandler({}))
        with opener.open(url, timeout=3) as resp:
            return resp.status, resp.read().decode("utf-8")

    def test_health_status_and_html(self) -> None:
        state = status_http.DaemonStatusState(
            endpoint="test-daemon",
            platform="linux",
            mode="server",
            framework_url="ws://127.0.0.1:8771/agent",
        )
        state.set_connected()
        srv = status_http.DaemonStatusServer(
            state,
            capabilities_fn=lambda: [{"name": "cap:system.server_conn", "methods": ["status"]}],
            port=0,
            log=lambda _m: None,
        ).start()
        try:
            self.assertTrue(srv.url.startswith("http://127.0.0.1:"))

            code, body = self._get(srv.url + "/health")
            self.assertEqual(code, 200)
            self.assertEqual(json.loads(body)["endpoint"], "test-daemon")

            code, body = self._get(srv.url + "/api/status")
            self.assertEqual(code, 200)
            data = json.loads(body)
            self.assertTrue(data["ok"])
            self.assertEqual(data["daemon"]["endpoint"], "test-daemon")
            self.assertTrue(data["channel"]["connected"])
            self.assertEqual(data["capabilities"][0]["name"], "cap:system.server_conn")

            code, html = self._get(srv.url + "/")
            self.assertEqual(code, 200)
            self.assertIn("Pylon Daemon (Client Mode)", html)
            self.assertNotIn("/appui/loader.js", html)
        finally:
            srv.stop()

    def test_port_conflict_falls_back_cleanly(self) -> None:
        s1 = status_http.DaemonStatusServer(
            status_http.DaemonStatusState(endpoint="d1", platform="linux", mode="server"),
            port=0,
            log=lambda _m: None,
        ).start()
        s2 = status_http.DaemonStatusServer(
            status_http.DaemonStatusState(endpoint="d2", platform="linux", mode="passive"),
            port=s1.port,
            log=lambda _m: None,
        ).start()
        try:
            self.assertIsNotNone(s1.port)
            self.assertIsNotNone(s2.port)
            self.assertNotEqual(s1.port, s2.port)
        finally:
            s2.stop()
            s1.stop()

    def test_disable_via_zero_and_server_mode(self) -> None:
        self.assertIsNone(status_http.resolve_status_port({"status_port": 0}))
        self.assertIsNone(status_http.resolve_status_port({"status_port": "off"}))
        self.assertEqual(status_http.resolve_status_port({}, daemon_mode="client", default_port=18772), 18772)
        self.assertIsNone(status_http.resolve_status_port({}, daemon_mode="server", default_port=18772))
        self.assertEqual(status_http.resolve_status_port({"status_port": 18775}, daemon_mode="server"), 18775)

    def test_client_config_post_normalizes_and_invokes_callback(self) -> None:
        import os, tempfile
        from unittest.mock import patch

        updates = []
        with tempfile.TemporaryDirectory() as td, patch.dict(os.environ, {"PYLON2_DATA_DIR": td}):
            state = status_http.DaemonStatusState(endpoint="win-local", platform="windows", mode="client")
            srv = status_http.DaemonStatusServer(
                state,
                port=0,
                on_client_config_update=lambda u, h, e: updates.append((u, h, e)),
                log=lambda _m: None,
            ).start()
            try:
                opener = build_opener(ProxyHandler({}))
                req = urllib.request.Request(
                    srv.url + "/api/client-config",
                    data=json.dumps({"central_server": "pylon-server.duckdns.org", "endpoint_id": "managed-win-pc"}).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(req, timeout=3) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(data["ok"])
                self.assertEqual(data["framework_url"], "wss://pylon-server.duckdns.org/agent")
                self.assertEqual(len(updates), 1)
                self.assertEqual(updates[0][0], "wss://pylon-server.duckdns.org/agent")
                self.assertEqual(updates[0][2], "managed-win-pc")
            finally:
                srv.stop()


if __name__ == "__main__":
    unittest.main()
