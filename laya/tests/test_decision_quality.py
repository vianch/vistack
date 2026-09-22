from __future__ import annotations

import json
import unittest
from pathlib import Path

from laya.engine import DecisionEngine


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


if __name__ == "__main__":
    unittest.main()
