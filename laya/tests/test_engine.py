from __future__ import annotations

import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.server import serve
from laya.schema import DecisionContext


class DecisionEngineTests(unittest.TestCase):
    def context(self, decision_type: str, **overrides):
        value = {
            "decision_type": decision_type,
            "task": {"request": "Add the local decision adapter."},
            "current_state": {},
            "evidence": [],
        }
        value.update(overrides)
        return value

    def test_intake_classifies_feature_but_requires_grooming(self):
        result = DecisionEngine(backend="deterministic").decide(
            self.context("intake-analysis", task={"request": "Add a CLI command"})
        )
        self.assertEqual(result.action, "ready-for-grooming")
        self.assertEqual(result.outputs["classification"], "feature")
        self.assertEqual(result.backend, "deterministic")
        self.assertEqual(result.authority, "advisory-only")

    def test_intake_classifies_failed_behavior_as_bug(self):
        result = DecisionEngine(backend="deterministic").decide(
            self.context("intake-analysis", task={"request": "Fix the failing upload test"})
        )
        self.assertEqual(result.outputs["classification"], "bug-fix")

    def test_grooming_requires_finish_predicate(self):
        result = DecisionEngine(backend="deterministic").decide(
            self.context(
                "grooming",
                task={"request": "Add a CLI command", "acceptance_criteria": ["prints JSON"]},
            )
        )
        self.assertEqual(result.action, "needs-information")
        self.assertIn("finish condition", result.required_evidence)

    def test_decomposition_serializes_shared_files(self):
        result = DecisionEngine(backend="deterministic").decide(
            self.context(
                "decomposition",
                task={"request": "Split the adapter", "shared_files": ["index.ts"]},
            )
        )
        self.assertEqual(result.action, "sequence")
        self.assertFalse(result.outputs["parallelizable"])

    def test_dispatch_holds_an_incomplete_brief(self):
        result = DecisionEngine(backend="deterministic").decide(
            self.context(
                "dispatch-readiness",
                task={"request": "Implement it", "acceptance_criteria": ["it works"]},
            )
        )
        self.assertEqual(result.action, "hold")
        self.assertFalse(result.outputs["ready"])

    def test_verification_requires_one_allowed_artifact_per_criterion(self):
        result = DecisionEngine(backend="deterministic").decide(
            self.context(
                "verification",
                task={"request": "Verify it", "acceptance_criteria": ["one", "two"]},
                evidence=[{"kind": "test", "ref": "test-output.txt"}],
            )
        )
        self.assertEqual(result.action, "request-evidence")

        accepted = DecisionEngine(backend="deterministic").decide(
            self.context(
                "verification",
                task={"request": "Verify it", "acceptance_criteria": ["one", "two"]},
                evidence=[
                    {"kind": "test", "ref": "test-one.txt"},
                    {"kind": "screenshot", "ref": "scenario-two.png"},
                ],
            )
        )
        self.assertEqual(accepted.action, "accept")

    def test_unavailable_mlx_falls_back(self):
        result = DecisionEngine(backend="mlx", model="/definitely/missing/model").decide(
            self.context("runtime-progress", current_state={"phase": "implementing"})
        )
        self.assertEqual(result.backend, "deterministic-fallback")
        self.assertTrue(result.fallback_used)
        self.assertEqual(result.action, "continue")

    def test_environment_disable_cannot_be_bypassed_by_explicit_mlx(self):
        previous = os.environ.get("VISTACK_LAYA_ENABLED")
        os.environ["VISTACK_LAYA_ENABLED"] = "0"
        try:
            result = DecisionEngine(backend="mlx", model="configured").decide(
                self.context("runtime-progress", current_state={"phase": "implementing"})
            )
        finally:
            if previous is None:
                os.environ.pop("VISTACK_LAYA_ENABLED", None)
            else:
                os.environ["VISTACK_LAYA_ENABLED"] = previous
        self.assertEqual(result.backend, "deterministic")
        self.assertFalse(result.fallback_used)

    def test_slow_mlx_call_falls_back_after_timeout(self):
        class SlowBackend:
            def predict(self, state, questions):
                time.sleep(0.05)
                return {"answers": {}}

        engine = DecisionEngine(backend="mlx", model="configured", timeout_ms=5)
        engine._mlx = SlowBackend()
        result = engine.decide(self.context("runtime-progress", current_state={"phase": "implementing"}))
        self.assertTrue(result.fallback_used)
        self.assertIn("exceeded", result.fallback_reason)

    def test_valid_typed_mlx_answer_is_advisory_refinement(self):
        class FakeBackend:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "next": {
                            "type": "choice",
                            "choice": "continue",
                            "confidence": 0.91,
                            "probabilities": {"continue": 0.91, "block": 0.09},
                        }
                    }
                }

        engine = DecisionEngine(backend="mlx", model="configured")
        engine._mlx = FakeBackend()
        result = engine.decide(self.context("runtime-progress", current_state={"phase": "implementing"}))
        self.assertEqual(result.backend, "laya-mlx")
        self.assertFalse(result.fallback_used)
        self.assertEqual(result.action, "continue")

    def test_configured_local_fallback_can_refine_after_primary_failure(self):
        class FailingBackend:
            def predict(self, state, questions):
                raise RuntimeError("primary unavailable")

        class KevBackend:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "next": {
                            "type": "choice",
                            "choice": "continue",
                            "confidence": 0.91,
                            "probabilities": {"continue": 0.91, "block": 0.09},
                        }
                    }
                }

        engine = DecisionEngine(
            backend="mlx",
            model="configured",
            fallback="kev",
            kev_url="http://127.0.0.1:8009",
        )
        engine._mlx = FailingBackend()
        engine._fallback_backend = KevBackend()
        engine._fallbacks = [("kev", engine._fallback_backend)]
        result = engine.decide(self.context("runtime-progress", current_state={"phase": "implementing"}))
        self.assertEqual(result.backend, "kev")
        self.assertTrue(result.fallback_used)
        self.assertIn("laya-mlx unavailable", result.fallback_reason)

    def test_low_confidence_typed_answer_uses_baseline(self):
        class FakeBackend:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "next": {
                            "type": "choice",
                            "choice": "continue",
                            "confidence": 0.2,
                            "probabilities": {"continue": 0.6, "block": 0.4},
                        }
                    }
                }

        engine = DecisionEngine(backend="mlx", model="configured")
        engine._mlx = FakeBackend()
        result = engine.decide(self.context("runtime-progress", current_state={"phase": "implementing"}))
        self.assertEqual(result.backend, "deterministic-fallback")
        self.assertIn("below", result.fallback_reason)

    def test_context_rejects_unknown_type(self):
        with self.assertRaises(ValueError):
            DecisionContext.from_dict({"decision_type": "unknown"})

    def test_jsonl_server_keeps_processing_after_malformed_request(self):
        incoming = io.StringIO(
            json.dumps({"id": "ok", "decision_type": "runtime-progress", "context": self.context("runtime-progress")})
            + "\n"
            + "not json\n"
        )
        output = io.StringIO()
        serve(DecisionEngine(backend="deterministic"), incoming, output)
        rows = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(rows[0]["id"], "ok")
        self.assertTrue(rows[0]["ok"])
        self.assertFalse(rows[1]["ok"])

    def test_history_deduplicates_stable_request_id(self):
        with tempfile.TemporaryDirectory() as directory:
            history = str(Path(directory) / "decisions.jsonl")
            engine = DecisionEngine(backend="deterministic", history_path=history)
            context = self.context("runtime-progress")
            engine.decide(context, request_id="retryable-request")
            engine.decide(context, request_id="retryable-request")
            lines = Path(history).read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)


if __name__ == "__main__":
    unittest.main()
