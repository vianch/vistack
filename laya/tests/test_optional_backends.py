from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from laya.engine import DecisionEngine
from laya.host_llm import HostLLMBackend, _extract_answers, _validate_answers
from laya.mlx_backend import LayaUnavailable, split_model
from laya.system_one import JevBackend, KevBackend, jev_api_key


def response(payload):
    return type(
        "Response",
        (),
        {
            "__enter__": lambda self: self,
            "__exit__": lambda self, *args: False,
            "read": lambda self: json.dumps(payload).encode(),
        },
    )()


class OptionalBackendTests(unittest.TestCase):
    def test_kev_adapter_accepts_system_one_response(self):
        with patch("laya.system_one.urlopen", return_value=response({"answers": {"next": {"choice": "continue"}}})) as call:
            result = KevBackend().predict({"phase": "implementing"}, {"next": {"type": "choice"}})
        self.assertIn("answers", result)
        self.assertNotIn("authorization", call.call_args.args[0].headers)

    def test_host_parser_accepts_claude_json_and_codex_jsonl(self):
        answers = {"next": {"type": "choice", "choice": "continue", "confidence": 0.9}}
        self.assertEqual(_extract_answers(json.dumps({"answers": answers}))["answers"], answers)
        codex = json.dumps({"type": "item.completed", "item": {"text": json.dumps({"answers": answers})}})
        self.assertEqual(_extract_answers(codex)["answers"], answers)

    def test_host_parser_rejects_unavailable_choice(self):
        questions = {"next": {"type": "choice", "criteria": {"continue": "keep going"}}}
        with self.assertRaises(RuntimeError):
            _validate_answers(
                {"answers": {"next": {"type": "choice", "choice": "merge", "confidence": 1.0}}},
                questions,
            )

    def test_host_profiles_choose_low_cost_defaults(self):
        self.assertEqual(HostLLMBackend("claude").model, "claude-haiku-4-5-20251001")
        self.assertEqual(HostLLMBackend("codex").model, "gpt-5.4-mini")
        self.assertIn('model_reasoning_effort="low"', HostLLMBackend("codex")._command("prompt"))

    def test_model_spec_selects_a_bundled_checkpoint(self):
        self.assertEqual(split_model("convaiinnovations/laya"), ("convaiinnovations/laya", None))
        self.assertEqual(split_model("convaiinnovations/laya/multilingual"), ("convaiinnovations/laya", "multilingual"))
        self.assertEqual(split_model("/models/laya/english"), ("/models/laya/english", None))


class JevTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.status = Path(self.directory.name) / "jev-status.json"
        # The developer's shell may export a model, a Kev URL, or a key; none may leak in here.
        cleared = ("TYPESAFE_API_KEY", "TYPESAFE_KEY", "VISTACK_LAYA_MODEL", "VISTACK_LAYA_KEV_URL", "VISTACK_LAYA_JEV", "VISTACK_LAYA_FALLBACK")
        self.environment = patch.dict(os.environ, {name: "" for name in cleared})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def jev(self):
        return JevBackend(api_key="test-key", status_path=self.status)

    def test_jev_sends_a_bearer_key_to_the_hosted_endpoint(self):
        with patch("laya.system_one.urlopen", return_value=response({"answers": {}})) as call:
            self.jev().predict({"task": "x"}, {"q": {"type": "noul", "instructions": "?"}})
        sent = call.call_args.args[0]
        self.assertEqual(sent.full_url, "https://api.typesafe.ai/v1/systemone")
        self.assertEqual(sent.headers["Authorization"], "Bearer test-key")
        self.assertEqual(json.loads(sent.data)["model"], "jev-latest")

    def test_refused_credits_skip_jev_without_another_request(self):
        refusal = HTTPError("https://api.typesafe.ai/v1/systemone", 402, "Payment Required", {}, io.BytesIO(b""))
        with patch("laya.system_one.urlopen", side_effect=refusal):
            with self.assertRaises(LayaUnavailable):
                self.jev().predict({}, {})
        with patch("laya.system_one.urlopen") as call:
            with self.assertRaisesRegex(LayaUnavailable, "credits"):
                self.jev().predict({}, {})
        call.assert_not_called()

    def test_rate_limit_is_not_treated_as_exhausted_credits(self):
        limited = HTTPError("https://api.typesafe.ai/v1/systemone", 429, "Too Many Requests", {}, io.BytesIO(b""))
        with patch("laya.system_one.urlopen", side_effect=limited):
            with self.assertRaises(LayaUnavailable):
                self.jev().predict({}, {})
        self.assertFalse(self.status.exists())

    def test_key_lookup_prefers_the_sdk_variable(self):
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": "sdk", "TYPESAFE_KEY": "short"}):
            self.assertEqual(jev_api_key(), "sdk")
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": "", "TYPESAFE_KEY": "short"}):
            self.assertEqual(jev_api_key(), "short")

    def test_a_key_alone_does_not_opt_into_jev(self):
        with patch.dict(os.environ, {"TYPESAFE_KEY": "short", "VISTACK_LAYA_JEV": ""}):
            self.assertEqual(DecisionEngine(backend="auto").ladder(), [])
            self.assertEqual([name for name, _ in DecisionEngine(backend="auto", jev=True).ladder()], ["jev"])

    def test_jev_without_a_key_falls_back_to_the_policy(self):
        result = DecisionEngine(backend="auto", jev=True).decide(
            {"decision_type": "tier-selection", "task": {"request": "Update the order summary panel"}}
        )
        self.assertEqual((result.backend, result.fork), ("deterministic-fallback", "split"))
        self.assertIn("TYPESAFE", result.fallback_reason)

    def test_opted_in_jev_leads_and_local_tiers_follow(self):
        engine = DecisionEngine(backend="auto", model="configured", kev_url="http://127.0.0.1:8009", jev=True)
        self.assertEqual([name for name, _ in engine.ladder()], ["jev", "laya-mlx", "kev"])
        local = DecisionEngine(backend="auto", model="configured", kev_url="http://127.0.0.1:8009")
        self.assertEqual([name for name, _ in local.ladder()], ["laya-mlx", "kev"])
        self.assertEqual(DecisionEngine(backend="auto", model="configured", jev=True, fallback="none").ladder()[1:], [])


class TypedAnswerTests(unittest.TestCase):
    def refined(self, context, answers):
        class Backend:
            def predict(self, state, questions):
                self.questions = questions
                return {"answers": answers}

        engine = DecisionEngine(backend="mlx", model="configured")
        engine._mlx = Backend()
        return engine.decide(context), engine._mlx

    def test_noul_without_confidence_uses_distance_from_even(self):
        context = {
            "decision_type": "intake-analysis",
            "task": {"request": "Handle the thing", "acceptance_criteria": ["handled"], "finish_condition": "done"},
        }
        engine = DecisionEngine(backend="deterministic")
        from laya.policy import evaluate
        from laya.schema import DecisionContext

        ctx = DecisionContext.from_dict(context)
        draft, _ = engine._model_draft(
            ctx,
            {
                "answers": {
                    "task_type": {"type": "choice", "choice": "unclear", "confidence": 0.1},
                    "readiness": {"type": "choice", "choice": "needs-clarification", "confidence": 0.9},
                    "ambiguity": {"type": "noul", "noul": 0.95},
                }
            },
            evaluate(ctx),
        )
        # 0.95 from the noul; the nine-way task class is reported, not part of the action.
        self.assertEqual((draft.action, draft.confidence), ("clarify", 0.9))
        self.assertEqual(draft.outputs["classification_confidence"], 0.1)

    def test_grooming_question_offers_split(self):
        from laya.questions import questions_for
        from laya.schema import DecisionContext

        criteria = questions_for(DecisionContext.from_dict({"decision_type": "grooming"}))["readiness"]["criteria"]
        self.assertIn("split", criteria)

    def test_every_choice_stays_within_the_calibrated_option_budget(self):
        from laya.questions import MAX_CHOICE_OPTIONS, questions_for
        from laya.schema import DECISION_TYPES, DecisionContext

        for decision_type in DECISION_TYPES:
            actions = [f"option-{index}" for index in range(15)]
            context = DecisionContext.from_dict({"decision_type": decision_type, "available_actions": actions}) if decision_type.endswith("selection") and decision_type not in {"playbook-selection", "tier-selection"} else DecisionContext.from_dict({"decision_type": decision_type})
            for name, question in questions_for(context).items():
                if question["type"] == "choice":
                    self.assertLessEqual(len(question["criteria"]), MAX_CHOICE_OPTIONS, f"{decision_type}.{name}")


class OpenForkTests(unittest.TestCase):
    TOOLS = {"grep": "search file contents", "read": "read one file", "edit": "change lines", "bash": "run a command"}

    def context(self, request, tools=None, **task):
        options = list(tools or self.TOOLS)
        return {"decision_type": "tool-selection", "task": {"request": request, "tools": tools or self.TOOLS, **task}, "available_actions": options}

    def test_named_tool_is_sharp_in_code(self):
        result = DecisionEngine(backend="deterministic").decide(self.context("Use grep to list the TODO comments"))
        self.assertEqual((result.action, result.fork), ("grep", "sharp"))

    def test_unnamed_tool_is_split_until_a_model_settles_it(self):
        self.assertEqual(DecisionEngine(backend="deterministic").decide(self.context("Find every caller of decide")).fork, "split")
        result, backend = TypedAnswerTests.refined(self, self.context("Find every caller of decide"), {"tool": {"type": "choice", "choice": "grep", "confidence": 0.96}})
        self.assertEqual((result.action, result.fork, result.backend), ("grep", "sharp", "laya-mlx"))
        self.assertEqual(backend.questions["tool"]["criteria"]["grep"], "search file contents")

    def test_model_cannot_pick_an_irreversible_tool(self):
        tools = {"bash": "run a command", "deploy": "deploy to production"}
        result, _ = TypedAnswerTests.refined(self, self.context("Ship it", tools), {"tool": {"type": "choice", "choice": "deploy", "confidence": 0.99}})
        self.assertEqual((result.action, result.fork), ("bash", "split"))
        self.assertIn("irreversible", result.fallback_reason)

    def test_model_cannot_invent_an_option(self):
        result, _ = TypedAnswerTests.refined(self, self.context("Look around"), {"tool": {"type": "choice", "choice": "curl", "confidence": 0.99}})
        self.assertEqual(result.fork, "split")

    def test_file_named_by_basename_is_sharp(self):
        result = DecisionEngine(backend="deterministic").decide(
            {"decision_type": "file-selection", "task": {"request": "Add the gate in engine.py"}, "available_actions": ["laya/engine.py", "laya/cli.py"]}
        )
        self.assertEqual((result.action, result.fork), ("laya/engine.py", "sharp"))

    def test_open_fork_requires_its_options(self):
        with self.assertRaises(ValueError):
            DecisionEngine(backend="deterministic").decide({"decision_type": "file-selection", "task": {"request": "x"}})


if __name__ == "__main__":
    unittest.main()
