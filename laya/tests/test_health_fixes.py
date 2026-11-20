"""Answers and inputs that must leave a fork split, or settle it in code, never settle it wrongly."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

from laya import engine as engine_module, schema as schema_module
from laya.policy import evaluate
from laya.questions import named_paths
from laya.schema import DecisionContext, trim_output
from laya.tests.test_loop_uses import Recorder, engine, noul, score, verification


SCENARIOS = Path(__file__).resolve().parents[2] / "examples" / "laya" / "scenarios.jsonl"
ROWS = {row["id"]: row for row in (json.loads(line) for line in SCENARIOS.read_text(encoding="utf-8").splitlines() if line.strip())}
FAIL_OUTPUT = "FAIL export_row_count: expected 3 got 0\n1 failed, 0 passed"
NON_FINITE = (float("nan"), "nan", "NaN", float("inf"), "inf", float("-inf"), "-inf", "1e999", 10**400)


def export_check(output, criteria=("the export writes three rows",)):
    return verification({"kind": "command", "ref": "pytest -q tests/test_export.py", "criterion": "1", "output": output}, criteria=criteria)


def present(state, path):
    found = [state]
    for part in path.replace("[]", ".[]").split("."):
        found = [item for value in found for item in (value if part == "[]" and isinstance(value, list) else [value[part]] if isinstance(value, dict) and part in value else [])]
    return any(value not in (None, "", [], {}) for value in found)


def size(state):
    return len(json.dumps(state, sort_keys=True, ensure_ascii=False))


class NonFiniteAnswerTests(unittest.TestCase):
    def decide_holds(self, value):
        try:
            return engine(Recorder({"holds_1": noul(value), "unjudgeable": noul(0.1)})).decide(export_check(FAIL_OUTPUT))
        except (OverflowError, ValueError) as exc:
            self.fail(f"{value!r} crashed the engine: {exc!r}")

    def test_a_non_finite_or_boolean_noul_leaves_the_fork_split(self):
        for value in (*NON_FINITE, True, False):
            with self.subTest(value=value):
                decision = self.decide_holds(value)
                self.assertEqual(decision.fork, "split")

    def test_the_parse_helpers_reject_every_non_finite_value(self):
        for value in (*NON_FINITE, True, False):
            with self.subTest(value=value):
                try:
                    self.assertIsNone(engine_module._noul_probability({"noul": value}))
                    self.assertEqual(engine_module._confidence({"confidence": value}), 0.0)
                    self.assertEqual(engine_module._probabilities({"probabilities": {"accept": value, "block": 0.2}}), {})
                except OverflowError as exc:
                    self.fail(f"{value!r} raised {exc!r}")

    def test_finite_numbers_still_clamp_into_the_unit_interval(self):
        self.assertEqual(engine_module._noul_probability({"noul": "0.25"}), 0.25)
        self.assertEqual(engine_module._noul_probability({"noul": 1.4}), 1.0)
        self.assertEqual(engine_module._confidence({"confidence": -0.2}), 0.0)
        self.assertEqual(engine_module._probabilities({"probabilities": {"accept": 0.7, "block": 0.3}}), {"accept": 0.7, "block": 0.3})

    def test_a_non_finite_file_score_is_no_ranking(self):
        answers = {"file_1": {"type": "score", "score": float("nan"), "probabilities": {"0": 0.0, "1": 0.0, "2": 1.0}}}
        answers.update({f"file_{index}": score(0.95, 0.04, 0.01) for index in range(2, 5)})
        context = {"decision_type": "file-selection", "task": {"request": "Round the tax line", "file_summaries": {"a.ts": "tax", "b.ts": "types", "c.ts": "panel", "d.md": "guide"}}, "available_actions": ["a.ts", "b.ts", "c.ts", "d.md"]}
        decision = engine(Recorder(answers)).decide(context)
        self.assertEqual(decision.fork, "split")
        self.assertIn("missing typed file score", decision.fallback_reason)

    def test_an_exit_answer_with_an_overflowing_confidence_does_not_crash_the_climb(self):
        context = {"decision_type": "grooming", "task": {"request": "Add a CSV export", "acceptance_criteria": ["the export has a header row"]}}
        try:
            decision = engine(Recorder({"readiness": {"type": "choice", "choice": "unclear", "confidence": 10**400}}), min_confidence=0.99).decide(context)
        except OverflowError as exc:
            self.fail(f"an overflowing confidence crashed the engine: {exc!r}")
        self.assertEqual(decision.fork, "split")


class TrimmedOutputTests(unittest.TestCase):
    def test_a_failure_cut_off_the_head_of_121_lines_is_not_accepted(self):
        output = "FAIL export_row_count: expected 3 got 0\n" + "\n".join(f"ok {index} - export row {index}" for index in range(1, 121))
        recorder = Recorder({"holds_1": noul(0.9), "unjudgeable": noul(0.1)})
        decision = engine(recorder).decide(export_check(output))
        self.assertNotIn("FAIL export_row_count", recorder.states[0]["evidence"][0]["output"])
        self.assertNotEqual(decision.action, "accept")
        self.assertEqual(decision.fork, "split")
        self.assertIn("trimmed", decision.fallback_reason)

    def test_the_trim_marker_survives_a_second_trim(self):
        output_trimmed = getattr(schema_module, "output_trimmed", None)
        self.assertIsNotNone(output_trimmed, "laya.schema names no trim marker")
        once = trim_output("\n".join(f"ok {index}" for index in range(1, 121)))
        self.assertTrue(output_trimmed(once))
        self.assertTrue(output_trimmed(trim_output(once, max_chars=200)))
        self.assertFalse(output_trimmed("2 passed"))

    def test_a_failing_read_of_a_cut_excerpt_still_requests_evidence(self):
        output = "\n".join(f"ok {index}" for index in range(1, 121)) + "\nFAIL export_row_count: expected 3 got 0"
        decision = engine(Recorder({"holds_1": noul(0.05), "unjudgeable": noul(0.1)})).decide(export_check(output))
        self.assertEqual((decision.action, decision.fork), ("request-evidence", "sharp"))


class StateBudgetTests(unittest.TestCase):
    def many_outputs(self, count=22):
        criteria = [f"criterion {index}: the export writes row {index} with its totals and tax" for index in range(1, count + 1)]
        entries = [
            {
                "kind": "command",
                "ref": f"pytest -q tests/test_export_{index}.py",
                "criterion": str(index),
                "output": "\n".join(f"tests/test_export_{index}.py::test_case_{case} PASSED" for case in range(8)) + "\n8 passed in 0.4s",
            }
            for index in range(1, count + 1)
        ]
        return verification(*entries, criteria=criteria)

    def test_22_outputs_at_6000_characters_fit_and_unsent_entries_are_not_asked(self):
        answers = {f"holds_{index}": noul(0.9) for index in range(1, 23)}
        recorder = Recorder({**answers, "unjudgeable": noul(0.1)}, max_state_chars=6000)
        decision = engine(recorder).decide(self.many_outputs())
        state = recorder.states[0]
        self.assertLessEqual(size(state), 6000)
        sent_refs = {entry["ref"] for entry in state["evidence"] if entry.get("output")}
        for name, question in recorder.questions.items():
            if name.startswith("holds_"):
                self.assertTrue(any(f'"{ref}"' in question["instructions"] for ref in sent_refs), f"{name} asks about an output the state does not carry")
        self.assertNotIn("holds_22", recorder.questions)
        self.assertNotEqual(decision.action, "accept")
        self.assertEqual(decision.fork, "split")

    def test_a_failing_read_among_the_sent_outputs_still_requests_evidence(self):
        answers = {f"holds_{index}": noul(0.9) for index in range(1, 23)}
        recorder = Recorder({**answers, "holds_1": noul(0.05), "unjudgeable": noul(0.1)}, max_state_chars=6000)
        self.assertEqual(engine(recorder).decide(self.many_outputs()).action, "request-evidence")

    def test_a_dispatch_question_naming_dropped_fields_is_not_asked(self):
        context = {
            "decision_type": "dispatch-readiness",
            "task": {
                "request": "Implement the export slice",
                "brief": "Write the CSV export. " * 45,
                "writable_files": [f"src/export/part_{index}.ts" for index in range(40)],
                "verification_command": "npm test -- export",
                "acceptance_criteria": ["the export has a header row"],
            },
        }
        recorder = Recorder({"readiness": {"type": "choice", "choice": "dispatch", "confidence": 0.99}}, max_state_chars=1200)
        found = engine(recorder, min_confidence=0.95)
        decision = found.decide(context)
        for state in recorder.states:
            for path in named_paths(recorder.questions):
                self.assertTrue(present(state, path), f"`{path}` is named but not in the {size(state)}-character state")
        self.assertEqual(decision.fork, "split")
        self.assertEqual(found._failures.get(found._backend_name, 0), 0, "a fork not asked is not a backend failure")


    def test_a_state_over_its_budget_is_not_sent(self):
        criteria = [f"criterion {index}: " + "the export writes every row with totals, tax, currency, and rounding applied " * 3 for index in range(30)]
        context = {"decision_type": "grooming", "task": {"request": "Groom the export", "acceptance_criteria": criteria}}
        recorder = Recorder({"readiness": {"type": "choice", "choice": "ready", "confidence": 0.99}}, max_state_chars=6000)
        decision = engine(recorder, min_confidence=0.99).decide(context)
        self.assertTrue(all(size(state) <= 6000 for state in recorder.states), [size(state) for state in recorder.states])
        self.assertEqual(decision.fork, "split")

    def test_output_on_a_fork_that_reads_no_output_does_not_stop_the_question(self):
        context = {"decision_type": "runtime-progress", "task": {"request": "Keep going on the export"}, "current_state": {"phase": "implementing"}, "evidence": [{"kind": "command", "ref": "npm test", "output": "3 passed"}]}
        recorder = Recorder({"next": {"type": "choice", "choice": "continue", "confidence": 0.99}})
        engine(recorder, min_confidence=0.99).decide(context)
        self.assertEqual(recorder.calls, 1)


class RankingTieTests(unittest.TestCase):
    SUMMARIES = {"laya/a.py": "the decision gate", "laya/b.py": "the decision ladder", "laya/c.py": "the cli"}

    def decide(self, order, answers):
        context = {"decision_type": "file-selection", "task": {"request": "Change the gate", "file_summaries": self.SUMMARIES}, "available_actions": list(order)}
        return engine(Recorder({f"file_{index}": answers[path] for index, path in enumerate(order, 1)})).decide(context)

    def test_two_files_with_equal_scores_at_different_levels_stay_split_in_either_order(self):
        answers = {
            "laya/a.py": {"type": "score", "score": 1.0, "probabilities": {"2": 1.0}},
            "laya/b.py": {"type": "score", "score": 1.0, "probabilities": {"0": 1.0}},
            "laya/c.py": score(1.0, 0.0, 0.0),
        }
        for order in (("laya/a.py", "laya/b.py", "laya/c.py"), ("laya/b.py", "laya/a.py", "laya/c.py")):
            with self.subTest(order=order):
                decision = self.decide(order, answers)
                self.assertEqual(decision.fork, "split")
                self.assertIn("laya/a.py", decision.fallback_reason)
                self.assertIn("laya/b.py", decision.fallback_reason)

    def test_a_top_unsure_between_writing_and_irrelevant_stays_split(self):
        answers = {"laya/a.py": score(0.4, 0.1, 0.5), "laya/b.py": score(0.98, 0.01, 0.01), "laya/c.py": score(0.98, 0.01, 0.01)}
        self.assertEqual(self.decide(tuple(self.SUMMARIES), answers).fork, "split")


class PlaybookDraftTests(unittest.TestCase):
    def test_a_route_outside_the_offered_candidates_is_rejected(self):
        context = {"decision_type": "playbook-selection", "task": {"request": "the login page throws a 500 after the last deploy, fix it"}}
        recorder = Recorder({"playbook": {"type": "choice", "choice": "worktree-cleanup", "confidence": 0.99}})
        decision = engine(recorder, min_confidence=0.95).decide(context)
        self.assertNotIn("worktree-cleanup", recorder.questions["playbook"]["criteria"])
        self.assertNotEqual(decision.action, "worktree-cleanup")
        self.assertEqual(decision.fork, "split")


class UnreachedTargetTests(unittest.TestCase):
    def test_a_startup_timeout_and_a_refused_connection_settle_block_in_code(self):
        for row_id in ("verify-output-timeout", "verify-output-db-refused"):
            with self.subTest(row_id):
                row = ROWS[row_id]
                draft = evaluate(DecisionContext.from_dict(row["context"], decision_type=row["decision_type"]))
                self.assertEqual(draft.action, "block")
                self.assertGreaterEqual(draft.confidence, 0.65)

    def test_each_unreached_shape_is_unavailable(self):
        for output in (
            "Error: connect ECONNREFUSED 127.0.0.1:5432",
            "FetchError: request to http://localhost:3000 failed, reason: connect ETIMEDOUT",
            "psql: error: could not connect to server: No such file or directory",
            'connection to server at "127.0.0.1", port 5432 failed: Connection refused\n1 error in 0.41s',
            "Error: Timed out waiting 120000ms from config.webServer.",
        ):
            with self.subTest(output):
                self.assertEqual(evaluate(DecisionContext.from_dict(export_check(output))).action, "block")

    def test_a_run_that_reached_its_target_is_still_read(self):
        for output in (
            "tests/test_db.py::test_retry PASSED\nWARNING upstream: connection refused, retried in 1s\n3 passed in 0.2s",
            "E   AssertionError: expected 3 rows, got 0\n1 failed in 0.3s",
            'E   AssertionError: expected banner "Could not connect to server"\n1 failed in 0.3s',
        ):
            with self.subTest(output):
                draft = evaluate(DecisionContext.from_dict(export_check(output)))
                self.assertEqual(draft.action, "request-evidence")
                self.assertLess(draft.confidence, 0.65)


if __name__ == "__main__":
    unittest.main()
