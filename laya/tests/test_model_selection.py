from __future__ import annotations

import unittest

from laya.engine import DecisionEngine
from laya.model_selection import PINNED_ROLES, RUNGS, rung_of, roster


def fake_model(answers):
    class FakeBackend:
        def predict(self, state, questions):
            return {"answers": answers}

    return FakeBackend()


def model_context(role, request, retries=0, **task):
    return {
        "decision_type": "model-selection",
        "task": {"role": role, "request": request, **task},
        "current_state": {"retries": retries} if retries else {},
        "evidence": [],
    }


def decide(context):
    return DecisionEngine(backend="deterministic").decide(context)


def refined(context, move, confidence=0.95):
    engine = DecisionEngine(backend="ollama", ollama_model="clef-flash")
    engine._backend = fake_model({"rung": {"type": "choice", "choice": move, "confidence": confidence}})
    return engine.decide(context)


def picked(result):
    return result.outputs["dispatch_model"], result.outputs["dispatch_effort"]


class RosterTests(unittest.TestCase):
    def test_defaults_come_from_the_agent_frontmatter(self):
        self.assertEqual(roster()["implementer"], ("sonnet", "high"))
        self.assertEqual(roster()["senior-implementer"], ("opus", "xhigh"))
        self.assertEqual(roster()["health-check"], ("haiku", None))

    def test_every_movable_role_sits_on_the_ladder(self):
        # A new agent whose model is off the ladder would silently never move.
        for role, (model, effort) in roster().items():
            if role not in PINNED_ROLES:
                self.assertIsNotNone(rung_of(model, effort), f"{role}: {model} {effort}")

    def test_a_missing_effort_sits_on_the_first_rung_of_its_model(self):
        self.assertEqual(RUNGS[rung_of("haiku", None)], ("haiku", "medium"))
        self.assertIsNone(rung_of("fable", "xhigh"))


class ModelSelectionTests(unittest.TestCase):
    def test_no_signal_keeps_the_frontmatter_default(self):
        result = decide(model_context("qa-verifier", "Verify the PR on its preview"))
        self.assertEqual((result.action, result.fork), ("keep", "sharp"))
        self.assertEqual(picked(result), ("sonnet", "medium"))
        self.assertFalse(result.outputs["changed"])

    def test_small_mechanical_work_with_a_pattern_steps_down_in_code(self):
        result = decide(model_context("implementer", "Add unit tests for the date util", pattern="lib/date.test.ts:3", estimated_changed_lines=30))
        self.assertEqual((result.action, result.fork), ("step-down", "sharp"))
        self.assertEqual(picked(result), ("sonnet", "medium"))

    def test_a_cheaper_signal_alone_is_split(self):
        result = decide(model_context("researcher", "Look up the rename API"))
        self.assertEqual((result.action, result.fork), ("keep", "split"))

    def test_a_contract_flag_steps_up_in_code(self):
        result = decide(model_context("analyst", "Map the order serializer callers", crosses_boundary=True))
        self.assertEqual((result.action, result.fork), ("step-up", "sharp"))
        self.assertEqual(picked(result), ("opus", "high"))

    def test_retries_climb_one_rung_each_up_to_the_top(self):
        self.assertEqual(picked(decide(model_context("health-check", "Audit the diff", retries=2))), ("sonnet", "high"))
        self.assertEqual(picked(decide(model_context("analyst", "Map the callers", retries=5))), ("opus", "xhigh"))

    def test_a_large_job_steps_up(self):
        result = decide(model_context("pr-author", "Open the PR", estimated_changed_lines=450))
        self.assertEqual((result.action, picked(result)), ("step-up", ("opus", "high")))

    def test_many_acceptance_criteria_step_a_qa_lane_up(self):
        criteria = [f"criterion {index}" for index in range(10)]
        result = decide(model_context("qa-verifier", "Verify the checkout PR", acceptance_criteria=criteria))
        self.assertEqual((result.action, result.fork, picked(result)), ("step-up", "sharp", ("sonnet", "high")))

    def test_a_mechanical_tier_role_stays_on_its_model(self):
        result = decide(model_context("implementer", "Fix the cart helper", retries=1))
        self.assertEqual((result.action, result.fork), ("keep", "sharp"))
        self.assertEqual(picked(result), ("sonnet", "high"))

    def test_pinned_roles_never_move(self):
        for role in ("advisor", "reviewer", "design-runner", "senior-implementer"):
            result = decide(model_context(role, "Rename one constant", retries=3, estimated_changed_lines=10, pattern="a.ts:1"))
            self.assertEqual((role, result.action, result.outputs["changed"]), (role, "keep", False))

    def test_codex_keeps_the_thread_model(self):
        context = model_context("analyst", "Map the callers", retries=2)
        context["constraints"] = {"host": "codex"}
        self.assertEqual(decide(context).action, "keep")

    def test_a_role_with_no_agent_file_names_its_own_default(self):
        result = decide(model_context("general-purpose", "Sweep the repo", model="sonnet", effort="high", estimated_changed_lines=500))
        self.assertEqual(picked(result), ("opus", "medium"))
        self.assertEqual(picked(decide(model_context("general-purpose", "Sweep the repo"))), (None, None))


class ModelSelectionRefinementTests(unittest.TestCase):
    def test_a_model_settles_a_split_fork_and_the_rung_is_resolved_in_code(self):
        result = refined(model_context("researcher", "Look up the rename API"), "step-down")
        self.assertEqual((result.action, result.fork), ("step-down", "sharp"))
        self.assertEqual(picked(result), ("sonnet", "high"))
        self.assertEqual(result.outputs["model"], "ollama:clef-flash")

    def test_a_model_step_down_needs_the_higher_floor(self):
        result = refined(model_context("researcher", "Look up the rename API"), "step-down", confidence=0.72)
        self.assertEqual((result.action, result.fork), ("keep", "split"))
        self.assertIn("0.85", result.fallback_reason)

    def test_a_model_cannot_step_down_with_risk_evidence(self):
        result = refined(model_context("analyst", "Trace the auth token refresh"), "step-down")
        self.assertEqual((result.action, result.fork), ("step-up", "split"))
        self.assertIn("step-down", result.fallback_reason)

    def test_a_model_may_keep_the_default_against_a_weak_up_signal(self):
        result = refined(model_context("analyst", "Trace the auth token refresh"), "keep")
        self.assertEqual((result.action, result.fork), ("keep", "sharp"))
        self.assertEqual(picked(result), ("opus", "medium"))

    def test_a_sharp_fork_is_not_re_read_by_a_model(self):
        result = refined(model_context("qa-verifier", "Verify the PR"), "step-up")
        self.assertEqual((result.action, result.backend), ("keep", "deterministic"))


if __name__ == "__main__":
    unittest.main()
