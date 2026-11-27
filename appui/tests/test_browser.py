"""Serve AppUI locally and run its regression page in headless Chromium/Edge.

Uses only the standard library and the repository's CDP client. No running host.
"""
from __future__ import annotations

import functools
import argparse
import http.server
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from framework import bundler
from framework.cdp_client import CDP, find_browser
from framework.page_assets import minify_javascript


class Handler(http.server.SimpleHTTPRequestHandler):
    minify = False
    def log_message(self, *args):
        pass

    def do_GET(self):
        pathname = self.path.split("?")[0]
        if pathname.startswith("/appui/bundle/"):
            name = pathname.rsplit("/", 1)[-1].removesuffix(".js")
            files = bundler._load_bundle_defs().get(name)
            if not files:
                self.send_error(404)
                return
            body = b"\n;\n".join(Path(bundler._appui_path(file)).read_bytes() for file in files)
            if self.minify:
                body = minify_javascript(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if pathname.startswith("/appui/"):
            self.path = "/framework" + self.path
        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minify", action="store_true", help="serve production-minified bundles")
    args = parser.parse_args()
    Handler.minify = args.minify
    browser = find_browser()
    if not browser:
        print("SKIP: Chromium/Edge is unavailable")
        return 0
    handler = functools.partial(Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cdp = None
    try:
        with tempfile.TemporaryDirectory(prefix="appui-browser-", ignore_cleanup_errors=True) as profile:
            process = subprocess.Popen([browser, "--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--remote-allow-origins=*", "--remote-debugging-port=0",
                "--user-data-dir=" + profile, "about:blank"], stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                active_port = Path(profile) / "DevToolsActivePort"
                deadline = time.monotonic() + 20
                while not active_port.exists() and time.monotonic() < deadline:
                    time.sleep(0.1)
                port = int(active_port.read_text().splitlines()[0])
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5).read())
                tab = next(tab for tab in tabs if tab.get("type") == "page")
                cdp = CDP(tab["webSocketDebuggerUrl"])
                cdp.enable()
                navigation = cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{server.server_port}/appui/tests/qa_runtime.html"})
                cdp._pump(want_id=navigation)
                deadline = time.monotonic() + 30
                results = None
                while time.monotonic() < deadline:
                    results = cdp.evaluate("window.__runtimeResults || null")
                    if results is not None:
                        break
                    time.sleep(0.1)
                if results is None:
                    raise RuntimeError("Regression page did not finish")
                for result in results:
                    print(("PASS " if result["pass"] else "FAIL ") + result["name"])
                print("Timing (local, " + ("minified" if args.minify else "raw") + " bundles):", cdp.evaluate("window.__runtimeTiming"))
                print("Script errors:", cdp.evaluate("window.__runtimeErrors"))
                return int(any(not result["pass"] for result in results))
            finally:
                if cdp:
                    try:
                        cdp.send("Browser.close")
                    except Exception:
                        pass
                    cdp.close()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                # Chromium subprocesses can hold the profile briefly after exit.
                time.sleep(0.5)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
