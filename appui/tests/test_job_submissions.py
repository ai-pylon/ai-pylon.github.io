"""Exercise Work Runner submission-key deduplication without starting jobs."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import importlib
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
IMPL = ROOT / "apps/platform/work_runner/impl"
package = types.ModuleType("appui_submission_test")
package.__path__ = [str(IMPL)]
sys.modules[package.__name__] = package
worker = importlib.import_module(package.__name__ + ".worker")
core = importlib.import_module(package.__name__ + ".core")
state = worker.state


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="appui-submission-")
        self.patches = [patch.object(state, "_DATA_DIR", self.directory.name),
            patch.object(state, "_DEBOUNCE_S", 0), patch.object(state, "queue", []),
            patch.object(state, "history", []), patch.object(core, "_ensure_started", lambda ctx: None)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        state.flush()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    def submit(self, **changes):
        return worker.submit(target="local", kind="op", app="example/app", op="change",
            idempotency_key="same-key", **changes)

    def test_concurrent_identical_submissions_enqueue_once(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            jobs = list(pool.map(lambda _: self.submit(args={"a": 1}), range(16)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(len(state.queue), 1)

    def test_changed_payload_is_rejected(self):
        self.submit(args={"a": 1})
        with self.assertRaisesRegex(ValueError, "different submission"):
            self.submit(args={"a": 2})
        self.assertEqual(len(state.queue), 1)

    def test_key_survives_queue_reload_and_completion(self):
        original = self.submit(args={"a": 1})
        state.load()
        self.assertEqual(self.submit(args={"a": 1})["id"], original["id"])
        job = state.queue.pop()
        job.update(status="done", op_result={"ok": True})
        state.history.append(job)
        state.save_queue()
        state.save_history()
        state.load()
        self.assertEqual(self.submit(args={"a": 1})["id"], original["id"])
        self.assertEqual(state.queue, [])

    def test_core_scopes_keys_by_caller_and_hides_internal_metadata(self):
        async def run():
            args = {"kind": "op", "app": "example/app", "op": "change", "idempotency_key": "shared"}
            first = await core._submit(args, {"user_id": None, "user": "alice"})
            retry = await core._submit(args, {"user_id": None, "user": "alice"})
            other = await core._submit(args, {"user_id": None, "user": "bob"})
            return first, retry, other
        first, retry, other = asyncio.run(run())
        self.assertEqual(first["job"]["id"], retry["job"]["id"])
        self.assertNotEqual(first["job"]["id"], other["job"]["id"])
        self.assertFalse(any(key.startswith("_submission") for key in first["job"]))

    def test_core_rejects_invalid_keys(self):
        for value in ("", 42, "a" * 201):
            result = asyncio.run(core._submit({"kind": "op", "app": "x", "op": "y", "idempotency_key": value}, {}))
            self.assertFalse(result["ok"])
        self.assertEqual(state.queue, [])


if __name__ == "__main__":
    unittest.main()
