"""Every choice's exit sends its fork back split; no exit value ever becomes an action."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.questions import EXIT_OPTIONS, ACTION_QUESTION, NoQuestion, questions_for, route_descriptions
from laya.schema import DECISION_TYPES, PLAYBOOKS, DecisionContext


SCENARIOS = Path(__file__).resolve().parents[2] / "examples" / "laya" / "scenarios.jsonl"


class Recorder:
    def __init__(self, answers):
        self.answers = answers
        self.calls = 0

    def predict(self, state, questions):
        self.calls += 1
        return {"answers": self.answers}


def engine(*tiers, min_confidence=0.65):
    found = DecisionEngine(backend="ollama", ollama_model="clef-flash", min_confidence=min_confidence)
    found._backend, found._fallbacks = tiers[0], [(f"tier-{index}", tier) for index, tier in enumerate(tiers[1:], 1)]
    found._fallback_name, found._fallback_backend = (found._fallbacks[0] if found._fallbacks else (None, None))
    return found


def scenarios():
    return [json.loads(line) for line in SCENARIOS.read_text(encoding="utf-8").splitlines() if line.strip()]


def tier(request):
    return {"decision_type": "tier-selection", "task": {"request": request}}


class ExitTests(unittest.TestCase):
    def test_no_exit_value_ever_reaches_the_action(self):
        every_fork_split = 1.0
        for row in scenarios():
            context = DecisionContext.from_dict(row["context"], decision_type=row["decision_type"])
            try:
                questions = questions_for(context)
            except NoQuestion:
                continue
            for name, question in questions.items():
                for exit_option in EXIT_OPTIONS & set(question.get("criteria") or ()):
                    with self.subTest(row["id"], question=name, answer=exit_option):
                        result = engine(Recorder({name: {"type": "choice", "choice": exit_option, "confidence": 1.0}}), min_confidence=every_fork_split).decide(
                            row["context"], decision_type=row["decision_type"]
                        )
                        self.assertNotIn(result.action, EXIT_OPTIONS)
                        if name == ACTION_QUESTION[row["decision_type"]] and result.backend != "deterministic":
                            self.assertEqual(result.fork, "split")
                            self.assertEqual(result.outputs["declined"]["answer"], exit_option)

    def test_the_deterministic_policy_never_returns_an_exit(self):
        for row in scenarios():
            result = DecisionEngine(backend="deterministic").decide(row["context"], decision_type=row["decision_type"])
            self.assertNotIn(result.action, EXIT_OPTIONS, row["id"])

    def test_every_primary_choice_offers_an_exit(self):
        # A fan-out has no exit option; test_loop_uses pins how code reads its unsure answers.
        fan_outs = {"verification": {"noul"}, "file-selection": {"score"}}
        covered, fanned = set(), set()
        for row in scenarios():
            context = DecisionContext.from_dict(row["context"], decision_type=row["decision_type"])
            try:
                questions = questions_for(context)
            except NoQuestion:
                continue
            question = questions.get(ACTION_QUESTION[row["decision_type"]])
            if question is None:
                self.assertIn(row["decision_type"], fan_outs, row["id"])
                self.assertEqual({item["type"] for item in questions.values()}, fan_outs[row["decision_type"]], row["id"])
                fanned.add(row["decision_type"])
                continue
            covered.add(row["decision_type"])
            self.assertEqual(question["type"], "choice", row["id"])
            self.assertTrue(EXIT_OPTIONS & set(question["criteria"]), row["id"])
        self.assertEqual(covered | fanned, set(DECISION_TYPES))

    def test_not_a_slice_keeps_the_fork_split_and_marks_it(self):
        first, second = Recorder({"tier": {"type": "choice", "choice": "not-a-slice", "confidence": 0.9}}), Recorder({"tier": {"type": "choice", "choice": "complex", "confidence": 0.99}})
        result = engine(first, second).decide(tier("Update the order summary panel"))
        self.assertEqual((result.fork, result.action, result.outputs["slice_like"]), ("split", "complex", False))
        self.assertEqual((result.outputs["declined"]["backend"], result.outputs["declined"]["answer"]), ("ollama:clef-flash", "not-a-slice"))
        self.assertEqual(second.calls, 0, "an exit that clears the floor ends the climb")
        self.assertIn("not-a-slice", result.fallback_reason)

    def test_an_exit_below_the_floor_climbs_on(self):
        first, second = Recorder({"tier": {"type": "choice", "choice": "not-a-slice", "confidence": 0.4}}), Recorder({"tier": {"type": "choice", "choice": "mechanical", "confidence": 0.95}})
        result = engine(first, second).decide(tier("Update the order summary panel"))
        self.assertEqual((result.fork, result.action, result.backend), ("sharp", "mechanical", "tier-1"))
        self.assertTrue(result.outputs["slice_like"])

    def test_the_raw_opinion_reports_an_exit_instead_of_an_action(self):
        found = engine(Recorder({"tier": {"type": "choice", "choice": "not-a-slice", "confidence": 0.8}}))
        context = DecisionContext.from_dict(tier("Thanks, that worked"))
        from laya.policy import evaluate

        opinion = found._opinion(context, evaluate(context), found.ladder())
        self.assertEqual((opinion["exit"], opinion["question"]), ("not-a-slice", "tier"))
        self.assertNotIn("action", opinion)

    def test_a_model_situation_maps_to_a_rung_move_in_code(self):
        context = {"decision_type": "model-selection", "task": {"role": "researcher", "request": "Look up the rename API"}}
        for situation, move in (("routine", "keep"), ("judgment", "step-up")):
            result = engine(Recorder({"rung": {"type": "choice", "choice": situation, "confidence": 0.95}})).decide(context)
            self.assertEqual((result.action, result.outputs["model_situation"]), (move, situation))

    def test_the_contract_change_answer_is_recorded_and_does_not_gate(self):
        answers = {"tier": {"type": "choice", "choice": "mechanical", "confidence": 0.95}, "contract_change": {"type": "noul", "noul": 0.7}}
        result = engine(Recorder(answers)).decide(tier("Update the order summary panel"))
        self.assertEqual((result.fork, result.action), ("sharp", "mechanical"))
        self.assertEqual(result.outputs["model_contract_change"]["noul"], 0.7)


class NoulBandTests(unittest.TestCase):
    def intake(self, ambiguity):
        answers = {
            "task_type": {"type": "choice", "choice": "feature", "confidence": 0.9},
            "readiness": {"type": "choice", "choice": "ready", "confidence": 0.9},
            "ambiguity": {"type": "noul", "noul": ambiguity},
        }
        context = {"decision_type": "intake-analysis", "task": {"request": "Handle the thing", "acceptance_criteria": ["handled"], "finish_condition": "done"}}
        return engine(Recorder(answers), min_confidence=1.0).decide(context)

    def test_a_noul_between_0_4_and_0_6_cannot_tell_and_stays_split(self):
        for value in (0.4, 0.5, 0.59):
            result = self.intake(value)
            self.assertEqual(result.fork, "split", value)
            self.assertIn("cannot tell", result.fallback_reason)

    def test_a_noul_outside_the_band_reads_as_yes_or_no(self):
        from laya.policy import evaluate

        context = DecisionContext.from_dict({"decision_type": "intake-analysis", "task": {"request": "Handle the thing", "acceptance_criteria": ["handled"], "finish_condition": "done"}})
        for value, action in ((0.6, "clarify"), (0.39, "ready-for-grooming")):
            answers = {"task_type": {"choice": "feature", "confidence": 0.9}, "readiness": {"choice": "ready", "confidence": 0.9}, "ambiguity": {"noul": value}}
            draft, error = DecisionEngine(backend="deterministic")._model_draft(context, {"answers": answers}, evaluate(context), "fake")
            self.assertEqual((draft.action, error), (action, None), value)


class NotAskedTests(unittest.TestCase):
    def tools(self, count, described=True):
        names = [f"tool-{index}" for index in range(count)]
        return {
            "decision_type": "tool-selection",
            "task": {"request": "Pick one", **({"tools": {name: f"runs job {name}" for name in names}} if described else {})},
            "available_actions": names,
        }

    def test_more_candidates_than_a_choice_carries_are_not_cut_silently(self):
        backend = Recorder({})
        result = engine(backend).decide(self.tools(12))
        self.assertEqual((result.fork, backend.calls), ("split", 0))
        self.assertIn("12 candidate tools", result.fallback_reason)

    def test_undescribed_candidates_are_not_asked(self):
        backend = Recorder({})
        result = engine(backend).decide(self.tools(3, described=False))
        self.assertEqual((result.fork, backend.calls), ("split", 0))
        self.assertIn("describes no tool", result.fallback_reason)

    def test_the_router_describes_every_playbook(self):
        self.assertEqual(set(PLAYBOOKS) - set(route_descriptions()), set())


if __name__ == "__main__":
    unittest.main()
