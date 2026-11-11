from __future__ import annotations

import itertools
import json
import unittest
from pathlib import Path

from laya.engine import DecisionEngine
from laya.policy import PolicyDraft
from laya.schema import ACTIONS_BY_TYPE, DecisionContext
from laya.seat_model import PAIRS, SEATS, STRUCTURAL_SIGNALS_FOR_ADVISOR, is_fable, switch_lines

SCENARIOS = Path(__file__).resolve().parents[2] / "examples" / "laya" / "scenarios.jsonl"
UNAVAILABLE = (
    ({"host": "codex"}, "codex"),
    ({"fable_available": False, "fable_unavailable_reason": "rate cap"}, "rate cap"),
    ({"fable_available": False, "fable_unavailable_reason": "consent"}, "consent"),
    ({"zdr": True}, "zdr"),
)
RISING = ("/advisor fable", "/model fable")
TO_ADVISOR = ("/advisor fable", "/model opus")
FALLING = ("/model opus", "/advisor opus")


def seat_context(seat=None, moment="plan", *, role=None, playbook=None, occurrence=None, decided=None, retries=0, seat_prior=None, constraints=None, **task):
    current_state = {"moment": moment, "seat": seat, "occurrence": occurrence, "seat_occurrence": decided, "retries": retries, "seat_prior": seat_prior}
    return {
        "decision_type": "seat-model",
        "metadata": {"source": "main-session"},
        "task": {"request": "Ship the order export", **({"role": role} if role else {}), **task},
        "playbook": playbook,
        "current_state": {key: value for key, value in current_state.items() if value not in (None, 0)},
        "constraints": constraints or {},
    }


def decide(context, **options):
    return DecisionEngine(backend="deterministic", history_path=None, **options).decide(context)


def answer(context):
    result = decide(context)
    return result.action, result.outputs["switch"]


def fake_model(answers, calls=None):
    class FakeBackend:
        def predict(self, state, questions):
            if calls is not None:
                calls.append(questions)
            return {"answers": answers}

    return FakeBackend()


def refined(context, answers, calls=None, **options):
    engine = DecisionEngine(backend="ollama", ollama_model="clef-flash", jev=False, cloudflare=False, fallback="none", history_path=None, **options)
    engine._backend = fake_model(answers, calls)
    return engine, engine.decide(context)


def walk(start, lines):
    main, advisor = start
    visited = []
    for line in lines:
        command, model = line.split()
        main, advisor = (model, advisor) if command == "/model" else (main, model)
        visited.append((main, advisor))
    return visited


SIGNAL_SETS = (
    {},
    {"crosses_boundary": True},
    {"playbook": "multi-phase-plan", "changes_data_shape": True, "changes_public_contract": True, "crosses_boundary": True},
    {"retries": 2},
    {"playbook": "autopilot-full", "retries": 5},
)


def sweep():
    for prior, moment, signals in itertools.product(SEATS, ("run-start", "plan", "repeat", "retry"), SIGNAL_SETS):
        yield prior, moment, signals, decide(seat_context(prior, moment, occurrence=f"{moment}:1", **signals))


class SeatShapeTests(unittest.TestCase):
    def test_pairs_name_three_states_and_never_a_fable_main_with_another_advisor(self):
        self.assertEqual(tuple(PAIRS), SEATS)
        self.assertEqual(SEATS, ACTIONS_BY_TYPE["seat-model"])
        self.assertEqual(set(PAIRS.values()), {("opus", "opus"), ("opus", "fable"), ("fable", "fable")})

    def test_switch_lines_raise_the_advisor_first_and_lower_the_main_first(self):
        self.assertEqual(switch_lines("fable"), RISING)
        self.assertEqual(switch_lines("fable-advisor"), TO_ADVISOR)
        self.assertEqual(switch_lines("opus"), FALLING)

    def test_every_switch_passes_only_through_valid_pairs_from_any_host_state(self):
        for start, target in itertools.product(PAIRS.values(), SEATS):
            with self.subTest(start=start, target=target):
                visited = walk(start, switch_lines(target))
                self.assertTrue(all(pair in PAIRS.values() for pair in visited), visited)
                self.assertEqual(visited[-1], PAIRS[target])

    def test_is_fable_matches_the_alias_full_ids_and_the_earlier_name(self):
        for model in ("fable", "FABLE", "claude-fable-5-2", "claude-fable-5-1[1m]", "mythos"):
            self.assertTrue(is_fable(model), model)
        for model in ("opus", "claude-opus-5-5", "sonnet", "", None):
            self.assertFalse(is_fable(model), model)


class SeatTransitionTests(unittest.TestCase):
    TRANSITIONS = (
        ("fresh plain run", seat_context(None, "run-start"), "opus", []),
        ("fresh heavy run alone", seat_context(None, "run-start", playbook="multi-phase-plan"), "opus", []),
        ("fresh heavy run with a flag", seat_context(None, "run-start", playbook="multi-phase-plan", crosses_boundary=True), "fable-advisor", list(TO_ADVISOR)),
        ("fresh run with every signal", seat_context(None, "run-start", playbook="multi-phase-plan", retries=4, crosses_boundary=True), "fable-advisor", list(TO_ADVISOR)),
        ("architect run alone", seat_context("opus", "run-start", architect=True), "opus", []),
        ("architect run with a flag", seat_context("opus", "run-start", architect=True, changes_data_shape=True), "fable-advisor", list(TO_ADVISOR)),
        ("resumed struggle", seat_context("fable-advisor", "run-start", occurrence="run-start:2", retries=2), "fable", list(RISING)),
        ("run-start struggle without an occurrence", seat_context("fable-advisor", "run-start", retries=2), "fable-advisor", []),
        ("resumed structural only", seat_context("fable-advisor", "run-start", playbook="multi-phase-plan", crosses_boundary=True), "fable-advisor", []),
        ("plan with one flag", seat_context("opus", "plan", changes_public_contract=True), "opus", []),
        ("plan with two flags", seat_context("opus", "plan", changes_public_contract=True, crosses_boundary=True), "fable-advisor", list(TO_ADVISOR)),
        ("plan with struggle", seat_context("fable-advisor", "plan", retries=3, crosses_boundary=True), "fable-advisor", []),
        ("plan without a signal", seat_context("opus", "plan"), "opus", []),
        ("plan ignores a stale occurrence", seat_context("opus", "plan", occurrence="repeat:1", decided="repeat:1", crosses_boundary=True, changes_data_shape=True), "fable-advisor", list(TO_ADVISOR)),
        ("absent moment reads as plan", seat_context("opus", None, crosses_boundary=True, changes_data_shape=True), "fable-advisor", list(TO_ADVISOR)),
        ("first repeat", seat_context("opus", "repeat", occurrence="repeat:1"), "fable-advisor", list(TO_ADVISOR)),
        ("second repeat", seat_context("fable-advisor", "repeat", occurrence="repeat:2"), "fable", list(RISING)),
        ("retry with struggle", seat_context("opus", "retry", occurrence="retry:2", retries=2), "fable-advisor", list(TO_ADVISOR)),
        ("retry never moves the main", seat_context("fable-advisor", "retry", occurrence="retry:3", retries=3), "fable-advisor", []),
        ("retry without struggle", seat_context("opus", "retry", occurrence="retry:1", retries=1), "opus", []),
        ("fable stays fable", seat_context("fable", "run-start"), "fable", []),
        ("unknown moment holds", seat_context("opus", "done", retries=4, crosses_boundary=True), "opus", []),
    )

    def test_the_transition_table(self):
        for label, context, seat, switch in self.TRANSITIONS:
            with self.subTest(label):
                self.assertEqual(answer(context), (seat, switch))

    def test_never_steps_down_mid_run(self):
        for prior, moment, signals, result in sweep():
            self.assertGreaterEqual(SEATS.index(result.action), SEATS.index(prior), (prior, moment, signals))

    def test_at_most_one_seat_step_per_call(self):
        for prior, moment, signals, result in sweep():
            self.assertLessEqual(SEATS.index(result.action), SEATS.index(prior) + 1, (prior, moment, signals))

    def test_the_main_moves_only_on_struggle_at_run_start_or_repeat(self):
        for prior, moment, signals, result in sweep():
            if result.action == "fable" and prior != "fable":
                self.assertIn(moment, ("run-start", "repeat"), signals)
                self.assertTrue(moment == "repeat" or signals.get("retries", 0) >= 2, (moment, signals))

    def test_plan_never_moves_the_main_seat(self):
        for signals in SIGNAL_SETS:
            for moment in ("plan", None):
                context = seat_context("fable-advisor", moment, **signals)
                self.assertEqual(moment is None, "moment" not in context["current_state"])
                self.assertEqual(decide(context).action, "fable-advisor", signals)

    def test_a_fresh_run_start_caps_at_fable_advisor_and_says_why(self):
        result = decide(seat_context(None, "run-start", playbook="autopilot-stack", retries=9, changes_data_shape=True))
        self.assertEqual((result.action, result.outputs["prior"]), ("fable-advisor", None))
        self.assertEqual(result.outputs["held"], "fable: one seat step per call")

    def test_a_heavy_playbook_and_an_architect_run_count_once(self):
        result = decide(seat_context("opus", "plan", playbook="multi-phase-plan", architect=True, crosses_boundary=True))
        self.assertEqual(result.outputs["signals"], ["playbook:multi-phase-plan", "flag:crosses_boundary"])

    def test_one_structural_signal_holds_and_two_move_the_advisor(self):
        one = decide(seat_context("opus", "plan", changes_data_shape=True))
        self.assertEqual((one.action, one.outputs["switch"]), ("opus", []))
        two = decide(seat_context("opus", "plan", changes_data_shape=True, crosses_boundary=True))
        self.assertEqual((two.action, two.outputs["switch"]), ("fable-advisor", list(TO_ADVISOR)))
        heavy_and_architect = decide(seat_context("opus", "plan", playbook="multi-phase-plan", architect=True))
        self.assertEqual((heavy_and_architect.action, heavy_and_architect.outputs["signals"]), ("opus", ["playbook:multi-phase-plan"]))
        self.assertEqual(STRUCTURAL_SIGNALS_FOR_ADVISOR, 2)

    def test_request_words_and_truthy_strings_never_escalate(self):
        context = seat_context("opus", "plan", request="A tough, cross-cutting, multi-phase rewrite", crosses_boundary="yes")
        self.assertEqual(answer(context), ("opus", []))


class OccurrenceTests(unittest.TestCase):
    def test_a_re_asked_repeat_does_not_climb_twice(self):
        first = decide(seat_context("opus", "repeat", occurrence="repeat:1"))
        self.assertEqual((first.action, first.outputs["occurrence"]), ("fable-advisor", "repeat:1"))
        again = decide(seat_context(first.action, "repeat", occurrence="repeat:1", decided="repeat:1"))
        self.assertEqual((again.action, again.outputs["switch"]), ("fable-advisor", []))
        self.assertEqual(again.outputs["held"], "occurrence repeat:1 is already decided")
        self.assertEqual(answer(seat_context(first.action, "repeat", occurrence="repeat:2", decided="repeat:1")), ("fable", list(RISING)))

    def test_a_re_asked_resumed_run_start_does_not_climb_twice(self):
        first = decide(seat_context("opus", "run-start", occurrence="run-start:2", retries=2))
        self.assertEqual(first.action, "fable-advisor")
        again = seat_context(first.action, "run-start", occurrence="run-start:2", decided="run-start:2", retries=2)
        self.assertEqual(answer(again), ("fable-advisor", []))

    def test_a_re_asked_run_start_without_an_occurrence_never_reaches_the_main_seat(self):
        first = decide(seat_context("opus", "run-start", retries=3))
        again = decide(seat_context(first.action, "run-start", retries=3))
        self.assertEqual((first.action, again.action, again.outputs["switch"]), ("fable-advisor", "fable-advisor", []))
        self.assertIn("current_state.occurrence", again.outputs["held"])

    def test_an_unknown_moment_holds_and_names_itself(self):
        result = decide(seat_context("opus", "done", crosses_boundary=True))
        self.assertEqual((result.outputs["moment"], result.outputs["switch"]), ("done", []))
        self.assertIn("done", result.outputs["held"])

    def test_a_repeat_or_retry_without_an_occurrence_holds(self):
        for moment in ("repeat", "retry"):
            with self.subTest(moment=moment):
                result = decide(seat_context("fable-advisor", moment, retries=5, crosses_boundary=True))
                self.assertEqual((result.action, result.outputs["switch"]), ("fable-advisor", []))
                self.assertIn("current_state.occurrence", result.outputs["held"])


class HoldAndForceTests(unittest.TestCase):
    def test_a_missing_or_unknown_seat_mid_run_holds_and_prints_no_switch(self):
        for seat, moment in itertools.product((None, "fable-main"), ("plan", "repeat", "retry", "run-end")):
            with self.subTest(seat=seat, moment=moment):
                result = decide(seat_context(seat, moment, occurrence=f"{moment}:1", retries=3, crosses_boundary=True))
                self.assertEqual((result.action, result.outputs["switch"], result.outputs["prior"]), ("opus", [], None))
                self.assertIn("current_state.seat is missing or unknown", result.outputs["held"])

    def test_unavailable_forces_opus_with_both_lines_from_any_seat(self):
        for (constraints, reason), seat in itertools.product(UNAVAILABLE, (*SEATS, None)):
            with self.subTest(reason=reason, seat=seat):
                result = decide(seat_context(seat, "repeat", occurrence="repeat:1", constraints=constraints, crosses_boundary=True))
                self.assertEqual((result.action, result.outputs["switch"]), ("opus", list(FALLING)))
                self.assertEqual(result.outputs["unavailable"], reason)

    def test_run_end_returns_to_the_recorded_prior_and_never_climbs(self):
        self.assertEqual(answer(seat_context("fable", "run-end")), ("opus", list(FALLING)))
        self.assertEqual(answer(seat_context("fable-advisor", "run-end", retries=4, crosses_boundary=True)), ("opus", list(FALLING)))
        self.assertEqual(answer(seat_context("opus", "run-end")), ("opus", []))
        self.assertEqual(answer(seat_context("fable", "run-end", seat_prior="fable-advisor")), ("fable-advisor", list(TO_ADVISOR)))
        self.assertEqual(answer(seat_context("opus", "run-end", seat_prior="fable")), ("opus", []))
        self.assertEqual(answer(seat_context("fable", "run-end", occurrence="repeat:2", decided="repeat:2")), ("opus", list(FALLING)))

    def test_only_the_seat_roles_may_ask(self):
        for role in (None, "coordinator", "advisor"):
            with self.subTest(role=role):
                self.assertEqual(answer(seat_context("opus", "plan", role=role, crosses_boundary=True, changes_data_shape=True)), ("fable-advisor", list(TO_ADVISOR)))
        for role in ("implementer", "senior-implementer", "general-purpose", "Plan"):
            with self.subTest(role=role):
                result = decide(seat_context("fable-advisor", "repeat", role=role, occurrence="repeat:1", constraints={"host": "codex"}))
                self.assertEqual((result.action, result.outputs["switch"], result.outputs["refused_role"]), ("opus", [], role))


class EngineContractTests(unittest.TestCase):
    def test_a_bare_request_is_a_sharp_hold_on_opus(self):
        result = DecisionEngine(backend="deterministic", history_path=None).decide(
            {"metadata": {"source": "main-session"}, "task": {"request": "Fix the failing upload test in the deck"}}, decision_type="seat-model"
        )
        self.assertEqual((result.action, result.fork, result.confidence, result.outputs["switch"]), ("opus", "sharp", 1.0, []))

    def test_every_seat_draft_is_sharp_under_the_highest_threshold(self):
        calls = []
        for _, context, _, _ in SeatTransitionTests.TRANSITIONS:
            _, result = refined(context, {"seat": {"type": "choice", "choice": "opus", "confidence": 0.99}}, calls, min_confidence=1.0)
            self.assertEqual((result.fork, result.backend), ("sharp", "deterministic"))
        self.assertEqual(calls, [])

    def test_a_model_opinion_is_recorded_but_never_moves_a_seat(self):
        _, result = refined(seat_context("opus", "plan"), {"seat": {"type": "choice", "choice": "fable", "confidence": 0.99}}, consult="always")
        self.assertEqual((result.action, result.outputs["switch"]), ("opus", []))
        self.assertEqual(result.outputs["model_opinion"]["action"], "fable")
        self.assertFalse(result.outputs["model_opinion"]["agrees"])

    def test_a_model_pick_is_recorded_under_its_own_key_and_never_rewrites_the_switch(self):
        engine, _ = refined(seat_context("opus", "plan"), {})
        context = DecisionContext.from_dict(seat_context("opus", "plan", crosses_boundary=True, changes_data_shape=True))
        baseline = decide(seat_context("opus", "plan", crosses_boundary=True, changes_data_shape=True))
        policy = PolicyDraft(baseline.action, baseline.confidence, baseline.rationale, (), (), (), (), baseline.outputs, {})
        draft, error = engine._model_draft(context, {"answers": {"seat": {"choice": "fable", "confidence": 0.99}}}, policy, "fake")
        self.assertIsNone(error)
        self.assertEqual((draft.action, draft.outputs["model_seat"], draft.outputs["switch"]), ("fable", "fable", list(TO_ADVISOR)))
        self.assertEqual(engine._model_draft(context, {"answers": {"seat": {"choice": "sonnet"}}}, policy, "fake"), (None, "invalid typed seat-model answer"))

    def test_the_gate_rejects_any_model_answer_that_differs_from_the_policy(self):
        engine, _ = refined(seat_context("opus", "plan"), {})
        context = DecisionContext.from_dict(seat_context("opus", "plan", crosses_boundary=True, changes_data_shape=True))
        policy = PolicyDraft("fable-advisor", 1.0, "", (), (), (), (), {}, {})
        for action in SEATS:
            safe, reason = engine._safe_model_draft(context, policy, PolicyDraft(action, 0.99, "", (), (), (), (), {}, {}), 0.5)
            self.assertEqual(safe, action == "fable-advisor", action)
            self.assertEqual(reason is None, safe)

    def test_the_question_offers_the_three_seats(self):
        from laya.questions import questions_for

        question = questions_for(DecisionContext.from_dict({"decision_type": "seat-model"}))["seat"]
        self.assertEqual((question["type"], tuple(question["criteria"])), ("choice", SEATS))

    def test_outputs_lead_with_seat_and_switch_and_carry_no_dispatch_or_pair_fields(self):
        for _, context, _, _ in SeatTransitionTests.TRANSITIONS:
            outputs = decide(context).outputs
            self.assertEqual(list(outputs)[:2], ["seat", "switch"])
            self.assertFalse({"dispatch_model", "dispatch_effort", "tier", "role", "main_model", "advisor_model", "pair"} & set(outputs))
            self.assertLessEqual(len(outputs), 16)


class LabelledSeatScenarioTests(unittest.TestCase):
    def test_every_labelled_seat_scenario_is_sharp_and_matches(self):
        rows = [json.loads(line) for line in SCENARIOS.read_text(encoding="utf-8").splitlines()]
        seats = [row for row in rows if row["decision_type"] == "seat-model"]
        self.assertGreaterEqual(len(seats), 10)
        self.assertEqual({row["human_action"] for row in seats}, set(SEATS))
        for row in seats:
            with self.subTest(row["id"]):
                result = DecisionEngine(backend="deterministic", history_path=None).decide(row["context"], decision_type="seat-model")
                self.assertEqual((result.action, result.fork), (row["human_action"], "sharp"))


if __name__ == "__main__":
    unittest.main()
