from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from laya.host_llm import HostLLMBackend, _extract_answers, _validate_answers
from laya.kev_backend import KevBackend


class OptionalBackendTests(unittest.TestCase):
    def test_kev_adapter_accepts_system_one_response(self):
        response = type(
            "Response",
            (),
            {
                "__enter__": lambda self: self,
                "__exit__": lambda self, *args: False,
                "read": lambda self: json.dumps({"answers": {"next": {"choice": "continue"}}}).encode(),
            },
        )()
        with patch("laya.kev_backend.urlopen", return_value=response):
            result = KevBackend().predict({"phase": "implementing"}, {"next": {"type": "choice"}})
        self.assertIn("answers", result)

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


if __name__ == "__main__":
    unittest.main()
