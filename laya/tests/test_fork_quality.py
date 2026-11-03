from __future__ import annotations

import re
import unittest

from laya.engine import DecisionEngine
from laya.errors import LayaUnavailable
from laya.policy import evaluate
from laya.schema import DecisionContext


DECK_SEGMENT = re.compile(r"(?:^|; )([\w:.-]+) unavailable or rejected: ")


def tier_context(request, state=None, **task):
    return {"decision_type": "tier-selection", "task": {"request": request, **task}, "current_state": state or {}, "evidence": []}


class StandIn:
    def __init__(self, choice=None, confidence=0.0, *, floor=None, served=None, configured=None, answer="tier"):
        self.calls = 0
        self.reply = {"answers": {answer: {"type": "choice", "choice": choice, "confidence": confidence}}}
        if served:
            self.reply["model"] = served
        if floor is not None:
            self.min_confidence = floor
        if configured:
            self.model = configured

    def predict(self, state, questions):
        self.calls += 1
        return self.reply


class Down:
    calls = 0

    def predict(self, state, questions):
        self.calls += 1
        raise LayaUnavailable("Ollama is not reachable at http://127.0.0.1:11434; start it with `ollama serve`")


def engine_with_ladder(*tiers, consult=None):
    engine = DecisionEngine(backend="ollama", ollama_model="clef-flash", consult=consult)
    (engine._backend_name, engine._backend), rest = tiers[0], list(tiers[1:])
    engine._fallbacks = rest
    engine._fallback_name, engine._fallback_backend = rest[0] if rest else (None, None)
    return engine


def deck_reasons(reason):
    marks = list(DECK_SEGMENT.finditer(reason or ""))
    return {
        mark.group(1): reason[mark.end() : marks[index + 1].start() if index + 1 < len(marks) else len(reason)].strip()
        for index, mark in enumerate(marks)
    }


class SliceLikenessTests(unittest.TestCase):
    def slice_like(self, context):
        value = DecisionEngine(backend="deterministic").decide(context).outputs["slice_like"]
        self.assertIs(type(value), bool)
        return value

    def test_each_work_signal_makes_the_request_slice_like(self):
        for context in (
            tier_context("Add unit tests for the cart helper", {"tier_mismatch": True}, pattern="lib/cart.test.ts:4"),
            tier_context("Add a field to the order response", changes_public_contract=True),
            tier_context("Rotate the refresh token on every request"),
            tier_context("Add the boilerplate export for the new icon"),
            tier_context("Copy the panel", pattern="components/Panel.tsx:8"),
            tier_context("Update the order summary panel"),
            tier_context("Fix the broken checkout button"),
        ):
            with self.subTest(request=context["task"]["request"]):
                self.assertTrue(self.slice_like(context))

    def test_questions_investigations_and_chat_are_not_slices(self):
        for request in (
            "How does the decision cache work?",
            "thanks, that looks right",
            "Investigate why the deck pane is slow",
        ):
            with self.subTest(request=request):
                self.assertFalse(self.slice_like(tier_context(request)))

    def test_a_non_slice_keeps_the_unclear_tier_answer_and_says_why(self):
        result = DecisionEngine(backend="deterministic").decide(tier_context("How does the decision cache work?"))
        unclear = evaluate(DecisionContext.from_dict(tier_context("Update the order summary panel")))
        self.assertEqual((result.action, result.confidence), (unclear.action, unclear.confidence))
        self.assertIn("not an implementation slice", result.rationale)

    def test_a_non_slice_never_touches_the_ladder_even_when_consulting_always(self):
        tiers = [("jev", StandIn("complex", 0.99)), ("cloudflare:clef-flash", StandIn("complex", 0.99, floor=0.85)), ("ollama:clef-flash", Down())]
        engine = engine_with_ladder(*tiers, consult="always")
        result = engine.decide(tier_context("thanks, that looks right"))
        self.assertEqual([backend.calls for _, backend in tiers], [0, 0, 0])
        self.assertEqual((result.backend, result.fork, result.fallback_used, result.fallback_reason), ("deterministic", "split", False, None))
        self.assertNotIn("model_opinion", result.outputs)

    def test_a_slice_like_split_fork_still_climbs(self):
        jev = StandIn("mechanical", 0.95)
        result = engine_with_ladder(("jev", jev)).decide(tier_context("Update the order summary panel"))
        self.assertEqual((jev.calls, result.backend, result.action), (1, "jev", "mechanical"))

    def test_a_slice_like_sharp_fork_still_records_an_opinion_when_consulting_always(self):
        jev = StandIn("complex", 0.9)
        result = engine_with_ladder(("jev", jev), consult="always").decide(tier_context("Add unit tests for the date util", pattern="lib/date.test.ts:3"))
        self.assertEqual((result.action, result.fork, jev.calls), ("mechanical", "sharp", 1))
        self.assertEqual(result.outputs["model_opinion"]["action"], "complex")


class CorroborationTests(unittest.TestCase):
    split_fork = tier_context("Update the order summary panel")

    def test_every_tier_agreeing_below_its_floor_never_changes_the_answer(self):
        engine = engine_with_ladder(
            ("jev", StandIn("complex", 0.64)),
            ("cloudflare:clef-flash", StandIn("complex", 0.84, floor=0.85)),
            ("ollama:clef-flash", StandIn("complex", 0.84, floor=0.85)),
        )
        result = engine.decide(self.split_fork)
        baseline = evaluate(DecisionContext.from_dict(self.split_fork))
        self.assertEqual((result.action, result.confidence, result.fork, result.backend), ("complex", baseline.confidence, "split", "deterministic-fallback"))
        self.assertEqual(result.outputs["corroborated_by"], ["jev", "cloudflare:clef-flash", "ollama:clef-flash"])
        self.assertEqual(result.outputs["dissent"], [])
        self.assertEqual(result.outputs["margins"], {"jev": 0.64, "cloudflare:clef-flash": 0.84, "ollama:clef-flash": 0.84})

    def test_dissent_and_unavailable_tiers_are_kept_apart_in_the_deck_format(self):
        engine = engine_with_ladder(
            ("jev", StandIn("complex", 0.3)),
            ("cloudflare:clef-flash", StandIn("mechanical", 0.5, floor=0.85)),
            ("ollama:clef-flash", Down()),
        )
        result = engine.decide(self.split_fork)
        self.assertEqual(result.action, "complex")
        self.assertEqual((result.outputs["corroborated_by"], result.outputs["dissent"]), (["jev"], ["cloudflare:clef-flash"]))
        self.assertEqual(result.outputs["margins"], {"jev": 0.3, "cloudflare:clef-flash": 0.5})
        reasons = deck_reasons(result.fallback_reason)
        self.assertEqual(list(reasons), ["jev", "cloudflare:clef-flash", "ollama:clef-flash"])
        self.assertEqual(reasons["jev"], "confidence 0.300 is below 0.650; agrees: complex")
        self.assertEqual(reasons["cloudflare:clef-flash"], "confidence 0.500 is below 0.850; dissents: mechanical")
        self.assertNotIn("agrees", reasons["ollama:clef-flash"])
        self.assertTrue(all(len(note) <= 60 for note in reasons.values() if "below" in note))

    def test_a_tier_that_also_fails_a_safety_gate_is_neither_corroboration_nor_dissent(self):
        context = {
            "decision_type": "tool-selection",
            "available_actions": ["run-tests", "merge-pr"],
            "task": {"request": "Pick the next tool"},
            "current_state": {},
            "evidence": [],
        }
        result = engine_with_ladder(("jev", StandIn("merge-pr", 0.5, answer="tool"))).decide(context)
        self.assertEqual((result.backend, result.action), ("deterministic-fallback", "run-tests"))
        self.assertNotIn("corroborated_by", result.outputs)
        self.assertNotIn("agrees", result.fallback_reason)

    def test_an_unavailable_ladder_records_no_corroboration(self):
        result = engine_with_ladder(("ollama:clef-flash", Down())).decide(self.split_fork)
        self.assertEqual(result.backend, "deterministic-fallback")
        self.assertNotIn("corroborated_by", result.outputs)


class FallbackRiskTests(unittest.TestCase):
    def test_fallback_keeps_the_policy_risks_and_carries_the_reason_once(self):
        context = tier_context("Update the order summary panel")
        result = engine_with_ladder(("ollama:clef-flash", Down())).decide(context)
        self.assertEqual(result.risks, tuple(evaluate(DecisionContext.from_dict(context)).risks))
        self.assertFalse(any("refinement was not used" in risk for risk in result.risks))
        self.assertIn("Ollama is not reachable", result.fallback_reason)


class BackendModelTests(unittest.TestCase):
    split_fork = tier_context("Update the order summary panel")

    def test_the_served_model_is_recorded(self):
        result = engine_with_ladder(("jev", StandIn("mechanical", 0.95, served="jev-2026-11-01", configured="jev-latest"))).decide(self.split_fork)
        self.assertEqual((result.backend, result.outputs["backend_model"]), ("jev", "jev-2026-11-01"))

    def test_the_configured_model_stands_in_when_the_response_names_none(self):
        result = engine_with_ladder(("jev", StandIn("mechanical", 0.95, configured="jev-latest"))).decide(self.split_fork)
        self.assertEqual(result.outputs["backend_model"], "jev-latest")

    def test_no_model_name_records_nothing(self):
        result = engine_with_ladder(("jev", StandIn("mechanical", 0.95))).decide(self.split_fork)
        self.assertNotIn("backend_model", result.outputs)


if __name__ == "__main__":
    unittest.main()
