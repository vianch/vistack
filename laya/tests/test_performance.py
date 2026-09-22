from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.history import HistoryStore
from laya.mlx_backend import LayaUnavailable, MLXBackend


CONTINUE = {"answers": {"next": {"type": "choice", "choice": "continue", "confidence": 0.9}}}
RUNTIME = {"decision_type": "runtime-progress", "task": {"request": "Finish the slice"}, "current_state": {"phase": "implementing"}}


class HistoryIndexTests(unittest.TestCase):
    def test_second_store_sees_ids_written_by_another_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            first, second = HistoryStore(path), HistoryStore(path)
            self.assertTrue(first.record_outcome("dec_1", "completed"))
            self.assertTrue(second.record_outcome("dec_2", "completed"))
            self.assertFalse(first.record_outcome("dec_2", "completed"))
            self.assertFalse(second.record_outcome("dec_1", "completed"))
            self.assertEqual(len(path.read_text(encoding="utf-8").splitlines()), 2)

    def test_truncated_history_resets_the_index(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            store = HistoryStore(path)
            store.record_outcome("dec_1", "completed")
            path.write_text("", encoding="utf-8")
            self.assertTrue(store.record_outcome("dec_1", "completed"))

    def test_append_after_a_torn_final_line_starts_a_new_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            path.write_text('{"event_id":"a"}\n{"event_id":"b"', encoding="utf-8")
            store = HistoryStore(path)
            self.assertTrue(store.record_outcome("dec_c", "completed"))
            self.assertFalse(store.record_outcome("dec_c", "completed"))
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 3)
            self.assertEqual(json.loads(lines[2])["decision_id"], "dec_c")
            self.assertEqual([item.get("event_id") for item in store.records()], ["a", "outcome:dec_c:completed:"])

    def test_append_cost_does_not_grow_with_history(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = DecisionEngine(backend="deterministic", history_path=str(Path(directory) / "h.jsonl"))
            timings = []
            for _ in range(1500):
                started = time.perf_counter()
                engine.decide(RUNTIME)
                timings.append(time.perf_counter() - started)
            early = sum(timings[:200]) / 200
            late = sum(timings[-200:]) / 200
            # The previous full-file rescan made late appends roughly 20x slower here.
            self.assertLess(late, early * 4)


class BackendLifecycleTests(unittest.TestCase):
    def test_model_load_is_not_charged_to_the_inference_timeout(self):
        class SlowLoadBackend:
            loads = 0

            def warm(self):
                if not self.loads:
                    time.sleep(0.05)
                self.loads += 1

            def predict(self, state, questions):
                self.warm()
                return CONTINUE

        engine = DecisionEngine(backend="mlx", model="configured", timeout_ms=20)
        engine._mlx = SlowLoadBackend()
        result = engine.decide(RUNTIME)
        self.assertEqual(result.backend, "laya-mlx")
        self.assertFalse(result.fallback_used)

    def test_failed_model_load_is_not_retried(self):
        backend = MLXBackend("configured")
        calls = []

        def failing_load():
            calls.append(1)
            raise LayaUnavailable("checkpoint missing")

        backend._load_agent = failing_load
        for _ in range(3):
            with self.assertRaises(LayaUnavailable):
                backend.predict({}, {})
        self.assertEqual(len(calls), 1)

    def test_repeatedly_failing_backend_is_skipped_during_cooldown(self):
        class FailingBackend:
            calls = 0

            def predict(self, state, questions):
                self.calls += 1
                raise LayaUnavailable("connection refused")

        engine = DecisionEngine(backend="mlx", model="configured", failure_threshold=2, cooldown_s=60)
        failing = FailingBackend()
        engine._mlx = failing
        results = [engine.decide(RUNTIME) for _ in range(4)]
        self.assertEqual(failing.calls, 2)
        self.assertTrue(all(item.action == "continue" and item.fallback_used for item in results))
        self.assertIn("skipped", results[-1].fallback_reason)

    def test_backend_recovers_after_cooldown(self):
        class FlakyBackend:
            calls = 0

            def predict(self, state, questions):
                self.calls += 1
                if self.calls <= 1:
                    raise LayaUnavailable("connection refused")
                return CONTINUE

        engine = DecisionEngine(backend="mlx", model="configured", failure_threshold=1, cooldown_s=0)
        engine._mlx = FlakyBackend()
        self.assertTrue(engine.decide(RUNTIME).fallback_used)
        self.assertEqual(engine.decide(RUNTIME).backend, "laya-mlx")

    def test_deterministic_cli_does_not_import_network_or_subprocess_adapters(self):
        root = Path(__file__).resolve().parents[2]
        code = (
            "import sys; import laya.cli; "
            "print(','.join(m for m in ('laya.kev_backend', 'laya.host_llm', 'urllib.request') if m in sys.modules))"
        )
        output = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, check=True)
        self.assertEqual(output.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
