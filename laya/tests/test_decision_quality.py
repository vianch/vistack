from __future__ import annotations

import json
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.questions import state_for_laya
from laya.schema import DecisionContext


SCENARIOS = Path(__file__).resolve().parents[2] / "examples" / "laya" / "scenarios.jsonl"


def model(answers):
    class FakeBackend:
        def predict(self, state, questions):
            return {"answers": answers}

    return FakeBackend()


def choice(name, value, confidence=0.95):
    return {name: {"type": "choice", "choice": value, "confidence": confidence}}


def refined(context, answers):
    engine = DecisionEngine(backend="mlx", model="configured")
    engine._mlx = model(answers)
    return engine.decide(context)


class LabelledScenarioTests(unittest.TestCase):
    def test_deterministic_policy_matches_every_labelled_scenario(self):
        engine = DecisionEngine(backend="deterministic")
        misses = []
        for line in SCENARIOS.read_text(encoding="utf-8").splitlines():
            scenario = json.loads(line)
            action = engine.decide(scenario["context"], decision_type=scenario["decision_type"]).action
            if action != scenario["human_action"]:
                misses.append(f"{scenario['id']}: {action} != {scenario['human_action']}")
        self.assertEqual(misses, [])


class ResponseQualityTests(unittest.TestCase):
    def test_route_rationale_names_the_matched_signals_and_runner_up(self):
        result = DecisionEngine(backend="deterministic").decide(
            {"decision_type": "playbook-selection", "task": {"request": "Fix the slow checkout page"}}
        )
        self.assertEqual(result.action, "perf-issue")
        self.assertIn("'slow'", result.rationale)
        self.assertIn("bug-fix", [item.action for item in result.alternatives])
        self.assertIn("bug-fix", result.probabilities)
        self.assertAlmostEqual(sum(result.probabilities.values()), 1.0, places=2)

    def test_verification_names_uncovered_criteria(self):
        result = DecisionEngine(backend="deterministic").decide(
            {
                "decision_type": "verification",
                "task": {"acceptance_criteria": ["saves", "shows toast", "logs event"]},
                "evidence": [{"kind": "test", "ref": "save.txt", "criterion": "1"}],
            }
        )
        self.assertEqual(result.action, "request-evidence")
        self.assertEqual(result.outputs["uncovered_criteria"], [2, 3])
        self.assertIn("2, 3", result.rationale)

    def test_evidence_criterion_and_status_round_trip(self):
        context = DecisionContext.from_dict(
            {"decision_type": "verification", "evidence": [{"kind": "test", "ref": "a", "criterion": 1, "status": "pass"}]}
        )
        self.assertEqual(context.to_dict()["evidence"][0]["criterion"], "1")
        self.assertEqual(state_for_laya(context)["evidence"][0]["status"], "pass")

    def test_oversized_state_keeps_acceptance_criteria(self):
        context = DecisionContext.from_dict(
            {
                "decision_type": "verification",
                "task": {"request": "x" * 2000, "acceptance_criteria": ["criterion one"], "notes": ["y" * 2000] * 20},
                "current_state": {"phase": "qa", "log": "z" * 2000},
            }
        )
        state = state_for_laya(context, max_chars=3000)
        self.assertLessEqual(len(json.dumps(state)), 3000)
        self.assertEqual(state["task"]["acceptance_criteria"], ["criterion one"])
        self.assertEqual(state["current_state"]["phase"], "qa")


class RefinementGateTests(unittest.TestCase):
    def test_model_cannot_route_around_a_blocked_state(self):
        result = refined(
            {"decision_type": "playbook-selection", "task": {"request": "Add a flag"}, "current_state": {"phase": "blocked"}},
            choice("playbook", "feature"),
        )
        self.assertEqual(result.action, "blocker")
        self.assertIn("route gate", result.fallback_reason)

    def test_model_cannot_invent_an_unattended_route(self):
        result = refined(
            {"decision_type": "playbook-selection", "task": {"request": "Add a CLI flag"}},
            choice("playbook", "overnight"),
        )
        self.assertEqual(result.action, "feature")
        self.assertIn("unattended", result.fallback_reason)

    def test_model_route_is_used_when_signals_are_weak(self):
        result = refined(
            {"decision_type": "playbook-selection", "task": {"request": "Add a CLI flag"}},
            choice("playbook", "prototype"),
        )
        self.assertEqual(result.action, "prototype")
        self.assertEqual(result.backend, "laya-mlx")

    def test_model_fence_conflict_flag_rejects_its_route(self):
        answers = {**choice("playbook", "prototype"), "route_conflict": {"type": "noul", "noul": 0.8}}
        result = refined({"decision_type": "playbook-selection", "task": {"request": "Add a CLI flag"}}, answers)
        self.assertEqual(result.action, "feature")

    def test_model_cannot_keep_an_oversized_unit_whole(self):
        result = refined(
            {"decision_type": "decomposition", "task": {"request": "Add it", "estimated_changed_lines": 900}},
            choice("shape", "single-slice"),
        )
        self.assertEqual(result.action, "split")

    def test_model_cannot_parallelize_computed_slice_overlap(self):
        result = refined(
            {
                "decision_type": "decomposition",
                "task": {"request": "Two slices", "slices": [{"files": ["a.ts"]}, {"files": ["a.ts", "b.ts"]}]},
            },
            choice("shape", "parallelize"),
        )
        self.assertEqual(result.action, "sequence")
        self.assertEqual(result.outputs["shared_files"], ["a.ts"])

    def test_model_cannot_skip_a_fence(self):
        result = refined(
            {"decision_type": "runtime-progress", "current_state": {"phase": "merge-ready", "next_action": "merge"}},
            choice("next", "continue"),
        )
        self.assertEqual(result.action, "escalate")
        self.assertEqual(result.outputs["fence"], 3)

    def test_model_cannot_continue_a_stalled_lane(self):
        result = refined(
            {"decision_type": "runtime-progress", "current_state": {"phase": "implementing", "stalled": True}},
            choice("next", "continue"),
        )
        self.assertEqual(result.action, "retry")

    def test_model_cannot_accept_failing_evidence(self):
        result = refined(
            {
                "decision_type": "verification",
                "task": {"acceptance_criteria": ["works"]},
                "evidence": [{"kind": "test", "ref": "out.txt", "summary": "2 tests failed"}],
            },
            choice("result", "accept"),
        )
        self.assertEqual(result.action, "request-evidence")
        self.assertEqual(result.outputs["failing_evidence"], ["out.txt"])


if __name__ == "__main__":
    unittest.main()
