from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path

from laya.engine import DecisionEngine


ROOT = Path(__file__).resolve().parents[2]


def fake_model(answers):
    class FakeBackend:
        def predict(self, state, questions):
            return {"answers": answers}

    return FakeBackend()


def tier_context(request, **task):
    return {"decision_type": "tier-selection", "task": {"request": request, **task}, "current_state": {}, "evidence": []}


def decide(context):
    return DecisionEngine(backend="deterministic").decide(context)


def refined(context, tier, confidence=0.95):
    engine = DecisionEngine(backend="ollama", ollama_model="clef-flash")
    engine._backend = fake_model({"tier": {"type": "choice", "choice": tier, "confidence": confidence}})
    return engine.decide(context)


def load_evaluator():
    spec = importlib.util.spec_from_file_location("evaluate_laya", ROOT / "scripts" / "evaluate-laya.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TierSelectionTests(unittest.TestCase):
    def test_mechanical_work_with_a_pattern_goes_to_implementer(self):
        result = decide(tier_context("Add unit tests for the date util", pattern="lib/date.test.ts:3"))
        self.assertEqual(result.action, "mechanical")
        self.assertEqual(result.outputs["role"], "implementer")

    def test_complex_signal_wins_over_a_pattern(self):
        result = decide(tier_context("Make the upload queue safe under concurrent retries", pattern="lib/queue.ts:30"))
        self.assertEqual(result.action, "complex")
        self.assertEqual(result.outputs["role"], "senior-implementer")
        self.assertIn("concurrent", result.outputs["complex_signals"])

    def test_unclear_tier_is_complex_below_the_refinement_threshold(self):
        result = decide(tier_context("Update the order summary panel"))
        self.assertEqual(result.action, "complex")
        self.assertLess(result.confidence, 0.65)

    def test_tier_mismatch_moves_the_slice_to_complex(self):
        context = tier_context("Add unit tests for the cart helper", pattern="lib/cart.test.ts:4")
        context["current_state"] = {"tier_mismatch": True}
        self.assertEqual(decide(context).action, "complex")

    def test_model_cannot_downgrade_evidenced_complex_work(self):
        result = refined(tier_context("Rotate the refresh token on every request"), "mechanical")
        self.assertEqual((result.action, result.fork, result.backend), ("complex", "sharp", "deterministic"))

    def test_model_can_settle_an_unclear_tier(self):
        result = refined(tier_context("Update the order summary panel"), "mechanical")
        self.assertEqual(result.action, "mechanical")
        self.assertEqual(result.outputs["role"], "implementer")

    def test_sharp_mechanical_work_is_not_re_read_by_a_model(self):
        result = refined(tier_context("Add unit tests for the date util", pattern="lib/date.test.ts:3"), "complex")
        self.assertEqual((result.action, result.fork), ("mechanical", "sharp"))
        self.assertEqual(result.outputs["role"], "implementer")

    def test_dispatch_keeps_the_senior_implementer_role(self):
        result = decide(
            {
                "decision_type": "dispatch-readiness",
                "task": {
                    "request": "Implement the slice",
                    "brief": "Add the field to the order response",
                    "acceptance_criteria": ["the new field is returned"],
                    "verification_command": "npm test",
                    "writable_files": ["api/orders.ts"],
                    "role": "senior-implementer",
                },
                "current_state": {},
                "evidence": [],
            }
        )
        self.assertEqual(result.action, "dispatch")
        self.assertEqual(result.outputs["role"], "senior-implementer")


class EvaluationSplitTests(unittest.TestCase):
    def scored_ids(self, split):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            load_evaluator().main([str(ROOT / "examples" / "laya" / "scenarios.jsonl"), "--split", split])
        report = json.loads(output.getvalue())
        return {row["id"] for row in report["scenarios"]}

    def test_train_and_held_out_partition_the_scenarios(self):
        train, held_out, everything = self.scored_ids("train"), self.scored_ids("held-out"), self.scored_ids("all")
        self.assertTrue(train and held_out)
        self.assertFalse(train & held_out)
        self.assertEqual(train | held_out, everything)

    def test_split_assignment_depends_only_on_the_id(self):
        evaluator = load_evaluator()
        self.assertEqual(evaluator.split_of("tier-rename"), evaluator.split_of("tier-rename"))
        self.assertIn(evaluator.split_of("tier-rename"), ("train", "held-out"))


if __name__ == "__main__":
    unittest.main()
