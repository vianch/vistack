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

    def split_fork(self):
        return self.context("tier-selection", task={"request": "Update the order summary panel"})

    def test_unavailable_tier_falls_back(self):
        result = DecisionEngine(backend="jev").decide(self.split_fork())
        self.assertEqual(result.backend, "deterministic-fallback")
        self.assertTrue(result.fallback_used)
        self.assertEqual(result.action, "complex")
        self.assertEqual(result.fork, "split")

    def test_sharp_fork_runs_in_code_without_a_model_turn(self):
        class RecordingBackend:
            calls = 0

            def predict(self, state, questions):
                self.calls += 1
                return {"answers": {"next": {"type": "choice", "choice": "pause", "confidence": 0.99}}}

        engine = DecisionEngine(backend="ollama", ollama_model="clef-flash")
        engine._backend = RecordingBackend()
        result = engine.decide(self.context("runtime-progress", current_state={"phase": "implementing"}))
        self.assertEqual((result.action, result.backend, result.fork), ("continue", "deterministic", "sharp"))
        self.assertEqual(engine._backend.calls, 0)

    def test_consult_always_records_a_model_opinion_without_applying_it(self):
        class DisagreeingBackend:
            def predict(self, state, questions):
                return {"answers": {"next": {"type": "choice", "choice": "pause", "confidence": 0.99}}}

        engine = DecisionEngine(backend="ollama", ollama_model="clef-flash", consult="always")
        engine._backend = DisagreeingBackend()
        result = engine.decide(self.context("runtime-progress", current_state={"phase": "implementing"}))
        self.assertEqual(result.action, "continue")
        self.assertEqual(result.outputs["model_opinion"], {"backend": "ollama:clef-flash", "action": "pause", "confidence": 0.99, "agrees": False})

    def test_environment_disable_cannot_be_bypassed_by_an_explicit_model_backend(self):
        previous = os.environ.get("VISTACK_LAYA_ENABLED")
        os.environ["VISTACK_LAYA_ENABLED"] = "0"
        try:
            result = DecisionEngine(backend="ollama", ollama_model="clef-flash").decide(
                self.context("runtime-progress", current_state={"phase": "implementing"})
            )
        finally:
            if previous is None:
                os.environ.pop("VISTACK_LAYA_ENABLED", None)
            else:
                os.environ["VISTACK_LAYA_ENABLED"] = previous
        self.assertEqual(result.backend, "deterministic")
        self.assertFalse(result.fallback_used)

    def test_slow_model_call_falls_back_after_timeout(self):
        class SlowBackend:
            def predict(self, state, questions):
                time.sleep(0.05)
                return {"answers": {}}

        engine = DecisionEngine(backend="ollama", ollama_model="clef-flash", timeout_ms=5)
        engine._backend = SlowBackend()
        result = engine.decide(self.split_fork())
        self.assertTrue(result.fallback_used)
        self.assertIn("exceeded", result.fallback_reason)

    def test_valid_typed_model_answer_is_advisory_refinement(self):
        class FakeBackend:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "tier": {
                            "type": "choice",
                            "choice": "mechanical",
                            "confidence": 0.91,
                            "probabilities": {"mechanical": 0.91, "complex": 0.09},
                        }
                    }
                }

        engine = DecisionEngine(backend="ollama", ollama_model="clef-flash")
        engine._backend = FakeBackend()
        result = engine.decide(self.split_fork())
        self.assertEqual(result.backend, "ollama:clef-flash")
        self.assertFalse(result.fallback_used)
        self.assertEqual(result.action, "mechanical")
        self.assertEqual(result.fork, "sharp")

    def test_configured_fallback_can_refine_after_primary_failure(self):
        class FailingBackend:
            def predict(self, state, questions):
                raise RuntimeError("primary unavailable")

        class JevStandIn:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "tier": {
                            "type": "choice",
                            "choice": "mechanical",
                            "confidence": 0.91,
                            "probabilities": {"mechanical": 0.91, "complex": 0.09},
                        }
                    }
                }

        engine = DecisionEngine(backend="ollama", ollama_model="clef-flash", jev=True)
        self.assertEqual([name for name, _ in engine.ladder()], ["ollama:clef-flash", "jev"])
        engine._backend = FailingBackend()
        engine._fallback_backend = JevStandIn()
        engine._fallbacks = [("jev", engine._fallback_backend)]
        result = engine.decide(self.split_fork())
        self.assertEqual(result.backend, "jev")
        self.assertTrue(result.fallback_used)
        self.assertIn("ollama:clef-flash unavailable", result.fallback_reason)

    def test_low_confidence_typed_answer_uses_baseline(self):
        class FakeBackend:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "tier": {
                            "type": "choice",
                            "choice": "mechanical",
                            "confidence": 0.2,
                            "probabilities": {"mechanical": 0.6, "complex": 0.4},
                        }
                    }
                }

        engine = DecisionEngine(backend="ollama", ollama_model="clef-flash")
        engine._backend = FakeBackend()
        result = engine.decide(self.split_fork())
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
