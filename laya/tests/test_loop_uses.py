"""Two loop decisions: "is this done?" read against fresh output, and "which file?" as a ranking."""

from __future__ import annotations

import json
import unittest

from laya.engine import DecisionEngine
from laya.policy import evaluate
from laya.questions import candidate_playbooks, questions_for
from laya.schema import OUTPUT_MAX_CHARS, OUTPUT_MAX_LINES, DecisionContext, Evidence


class Recorder:
    def __init__(self, answers, max_state_chars=None):
        self.answers = answers
        self.calls = 0
        self.states = []
        self.questions = None
        if max_state_chars:
            self.max_state_chars = max_state_chars

    def predict(self, state, questions):
        self.calls += 1
        self.states.append(state)
        self.questions = questions
        return {"answers": self.answers}


def engine(*tiers, min_confidence=0.65):
    found = DecisionEngine(backend="ollama", ollama_model="clef-flash", min_confidence=min_confidence)
    found._backend, found._fallbacks = tiers[0], [(f"tier-{index}", tier) for index, tier in enumerate(tiers[1:], 1)]
    found._fallback_name, found._fallback_backend = (found._fallbacks[0] if found._fallbacks else (None, None))
    return found


def noul(value):
    return {"type": "noul", "noul": value}


def score(*probabilities):
    return {"type": "score", "score": sum(index * value for index, value in enumerate(probabilities)), "probabilities": {str(index): value for index, value in enumerate(probabilities)}}


def verification(*entries, criteria=("the cart total includes tax", "an empty cart shows a message")):
    return {"decision_type": "verification", "task": {"request": "Verify the cart change", "acceptance_criteria": list(criteria)}, "evidence": list(entries)}


TAX = {"kind": "command", "ref": "pytest -q tests/test_tax.py", "criterion": "1", "output": "tests/test_tax.py ....\n4 passed in 0.31s"}
EMPTY = {"kind": "command", "ref": "pytest -q tests/test_empty.py", "criterion": "2", "output": "tests/test_empty.py ..\n2 passed in 0.12s"}
FILES = {
    "src/cart/total.ts": "computes the cart subtotal, tax, and total",
    "src/cart/types.ts": "the Cart and LineItem types",
    "src/cart/CartPanel.tsx": "renders the cart drawer",
    "docs/cart.md": "user guide for the cart",
}


def files(request="Round the tax line to two decimals"):
    return {"decision_type": "file-selection", "task": {"request": request, "file_summaries": FILES}, "available_actions": list(FILES)}


class TrimTests(unittest.TestCase):
    def test_output_is_trimmed_in_code_to_its_tail(self):
        text = "\n".join(f"line {index}" for index in range(500))
        output = Evidence.from_value({"kind": "command", "ref": "npm test", "output": text}).output
        self.assertLessEqual(len(output), OUTPUT_MAX_CHARS)
        self.assertLessEqual(len(output.splitlines()), OUTPUT_MAX_LINES + 1)
        self.assertTrue(output.endswith("line 499"))
        self.assertTrue(output.startswith("...[earlier output trimmed]"))

    def test_one_long_line_keeps_its_last_characters(self):
        output = Evidence.from_value({"kind": "command", "ref": "npm test", "output": "x" * 9000 + "VERDICT"}).output
        self.assertLessEqual(len(output), OUTPUT_MAX_CHARS)
        self.assertTrue(output.endswith("VERDICT"))

    def test_old_contexts_parse_without_output(self):
        item = Evidence.from_value({"kind": "test", "ref": "out.txt", "status": "pass"})
        self.assertIsNone(item.output)
        self.assertEqual(Evidence.from_value({"kind": "test", "ref": "a", "output": "2 passed"}).output, "2 passed")

    def test_the_state_sent_keeps_every_output_tail_within_the_budget(self):
        entries = [
            {"kind": "command", "ref": f"suite-{index}", "criterion": str(index + 1), "output": "\n".join(f"noise {line}" for line in range(300)) + f"\nEND-{index}"}
            for index in range(4)
        ]
        context = verification(*entries, criteria=[f"criterion {index}" for index in range(4)])
        backend = Recorder({}, max_state_chars=3000)
        engine(backend).decide(context)
        state = backend.states[0]
        self.assertLessEqual(len(json.dumps(state, sort_keys=True, ensure_ascii=False)), 3000)
        self.assertEqual([item["output"].rsplit("\n", 1)[-1] for item in state["evidence"]], [f"END-{index}" for index in range(4)])


class VerificationPolicyTests(unittest.TestCase):
    def test_output_without_status_splits_the_fork(self):
        result = DecisionEngine(backend="deterministic").decide(verification(TAX, EMPTY))
        self.assertEqual((result.fork, result.action), ("split", "request-evidence"))
        self.assertEqual(result.outputs["judged_evidence"], [TAX["ref"], EMPTY["ref"]])

    def test_a_failed_status_keeps_the_deterministic_path(self):
        result = DecisionEngine(backend="deterministic").decide(verification({**TAX, "status": "fail"}, EMPTY))
        self.assertEqual((result.fork, result.action), ("sharp", "request-evidence"))

    def test_a_criterion_with_no_evidence_stays_sharp(self):
        result = DecisionEngine(backend="deterministic").decide(verification(TAX))
        self.assertEqual((result.fork, result.action, result.outputs["uncovered_criteria"]), ("sharp", "request-evidence", [2]))

    def test_one_noul_per_entry_and_one_for_the_brief(self):
        context = DecisionContext.from_dict(verification(TAX, {**EMPTY, "criterion": None}))
        questions = questions_for(context)
        self.assertEqual(set(questions), {"holds_1", "holds_2", "unjudgeable"})
        self.assertEqual({question["type"] for question in questions.values()}, {"noul"})
        self.assertIn('"pytest -q tests/test_empty.py"', questions["holds_2"]["instructions"])

    def test_an_output_that_covers_no_criterion_is_not_asked_and_never_accepted(self):
        failing = {"kind": "command", "ref": "pytest -q tests/test_tax_rounding.py", "output": "E   AssertionError: assert 0.1 == 0.10\n1 failed in 0.2s"}
        backend = Recorder({"holds_1": noul(0.95), "unjudgeable": noul(0.05)})
        result = engine(backend).decide(verification({**TAX, "criterion": None}, failing, criteria=["the cart total includes tax"]))
        self.assertEqual((result.fork, result.action, backend.calls), ("split", "request-evidence", 0))
        self.assertIn("covers no acceptance criterion", result.fallback_reason)

    def test_an_output_with_a_status_counts_by_its_kind_as_before(self):
        result = DecisionEngine(backend="deterministic").decide(verification({"kind": "reference", "ref": "notes.md", "status": "pass", "output": "ok"}, criteria=["a"]))
        self.assertEqual((result.fork, result.action, result.outputs["uncovered_criteria"]), ("sharp", "request-evidence", [1]))

    def test_code_resolves_each_entry_to_its_criterion_text(self):
        backend = Recorder({})
        engine(backend).decide(verification(TAX, {**EMPTY, "criterion": None}))
        self.assertEqual([item["criterion"] for item in backend.states[0]["evidence"]], ["the cart total includes tax", "an empty cart shows a message"])


class VerificationCombinationTests(unittest.TestCase):
    def decide(self, tax, empty, unjudgeable, *entries, min_confidence=0.65):
        backend = Recorder({"holds_1": noul(tax), "holds_2": noul(empty), "unjudgeable": noul(unjudgeable)})
        return engine(backend, min_confidence=min_confidence).decide(verification(*(entries or (TAX, EMPTY)))), backend

    def test_every_criterion_shown_accepts_in_one_call(self):
        result, backend = self.decide(0.95, 0.9, 0.05)
        self.assertEqual((result.fork, result.action, backend.calls), ("sharp", "accept", 1))
        self.assertEqual([item["noul"] for item in result.outputs["output_reads"]], [0.95, 0.9])

    def test_a_criterion_the_output_does_not_show_requests_evidence(self):
        result, _ = self.decide(0.05, 0.95, 0.05)
        self.assertEqual((result.fork, result.action), ("sharp", "request-evidence"))

    def test_an_unjudgeable_brief_escalates_to_a_person(self):
        result, _ = self.decide(0.95, 0.95, 0.9)
        self.assertEqual((result.fork, result.action), ("sharp", "escalate"))

    def test_an_unjudgeable_brief_wins_then_a_failing_output_then_the_band(self):
        self.assertEqual(self.decide(0.05, 0.95, 0.9)[0].action, "escalate")
        self.assertEqual(self.decide(0.05, 0.5, 0.05)[0].action, "request-evidence")

    def test_the_band_leaves_the_fork_split(self):
        for tax, unjudgeable in ((0.5, 0.05), (0.95, 0.5)):
            result, _ = self.decide(tax, 0.95, unjudgeable)
            self.assertEqual(result.fork, "split", (tax, unjudgeable))
            self.assertIn("cannot tell", result.fallback_reason)

    def test_the_band_edges(self):
        context = DecisionContext.from_dict(verification(TAX, EMPTY))
        for tax, unjudgeable, action in ((0.4, 0.05, None), (0.39, 0.05, "request-evidence"), (0.6, 0.05, "accept"), (0.59, 0.05, None), (0.95, 0.6, "escalate"), (0.95, 0.59, None)):
            answers = {"holds_1": noul(tax), "holds_2": noul(0.95), "unjudgeable": noul(unjudgeable)}
            draft, _ = DecisionEngine(backend="deterministic")._model_draft(context, {"answers": answers}, evaluate(context), "fake")
            self.assertEqual(draft.action if draft else None, action, (tax, unjudgeable))

    def test_a_failed_status_is_never_accepted(self):
        result, _ = self.decide(0.99, 0.99, 0.01, {**TAX, "status": "fail"}, EMPTY, min_confidence=0.99)
        self.assertNotEqual(result.action, "accept")
        self.assertEqual(result.fork, "split")


class FileRankingTests(unittest.TestCase):
    def test_one_score_per_candidate_in_one_call(self):
        backend = Recorder({f"file_{index}": score(0.9, 0.08, 0.02) for index in range(1, 5)})
        engine(backend).decide(files())
        self.assertEqual(backend.calls, 1)
        self.assertEqual(set(backend.questions), {f"file_{index}" for index in range(1, 5)})
        self.assertEqual({question["type"] for question in backend.questions.values()}, {"score"})
        self.assertIn('"src/cart/types.ts"', backend.questions["file_2"]["instructions"])

    def test_code_ranks_by_score_and_acts_on_the_top_file(self):
        answers = {"file_1": score(0.04, 0.06, 0.9), "file_2": score(0.1, 0.85, 0.05), "file_3": score(0.9, 0.08, 0.02), "file_4": score(0.95, 0.04, 0.01)}
        result = engine(Recorder(answers)).decide(files())
        self.assertEqual((result.fork, result.action), ("sharp", "src/cart/total.ts"))
        self.assertEqual([item["path"] for item in result.outputs["ranking"]], ["src/cart/total.ts", "src/cart/types.ts", "src/cart/CartPanel.tsx", "docs/cart.md"])
        self.assertEqual(result.outputs["ranking"][0]["score"], 1.86)

    def test_a_tie_at_the_top_level_leaves_the_fork_split(self):
        answers = {"file_1": score(0.04, 0.06, 0.9), "file_2": score(0.1, 0.1, 0.8), "file_3": score(0.9, 0.08, 0.02), "file_4": score(0.95, 0.04, 0.01)}
        found = engine(Recorder(answers))
        result = found.decide(files())
        self.assertEqual(result.fork, "split")
        self.assertIn("src/cart/types.ts", result.fallback_reason)
        context = DecisionContext.from_dict(files())
        self.assertEqual(found._opinion(context, evaluate(context), found.ladder())["action"], "src/cart/total.ts")

    def test_an_all_low_ranking_declines_like_the_none_exit(self):
        first, second = Recorder({f"file_{index}": score(0.9, 0.08, 0.02) for index in range(1, 5)}), Recorder({f"file_{index}": score(0.0, 0.0, 1.0) for index in range(1, 5)})
        result = engine(first, second).decide(files())
        self.assertEqual((result.fork, result.outputs["declined"]["answer"], result.outputs["declined"]["question"]), ("split", "none", "file"))
        self.assertEqual(second.calls, 0)


class PlaybookFamilyTests(unittest.TestCase):
    def test_the_improve_route_offers_its_neighbours(self):
        context = DecisionContext.from_dict({"decision_type": "playbook-selection", "task": {"request": "Agents keep making the same mistake; improve the rules so it cannot happen again"}})
        self.assertEqual(candidate_playbooks(context)[0], "improve")
        self.assertIn("authoring-skill", candidate_playbooks(context))


if __name__ == "__main__":
    unittest.main()
