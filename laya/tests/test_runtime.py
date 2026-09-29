from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from laya import runtime
from laya.engine import DecisionEngine
from laya.feedback import fork_summary


class RuntimeTests(unittest.TestCase):
    def test_no_reexec_without_a_configured_interpreter(self):
        with patch.dict(os.environ, {"VISTACK_LAYA_PYTHON": "/definitely/missing/python", runtime.REEXEC_MARKER: ""}):
            with patch.object(runtime, "runtime_available", return_value=False), patch("os.execv") as execv:
                runtime.reexec_with_runtime(["script.py"])
        execv.assert_not_called()

    def test_reexec_happens_once(self):
        with patch.dict(os.environ, {"VISTACK_LAYA_PYTHON": sys.executable + "-other", runtime.REEXEC_MARKER: "1"}):
            with patch("os.execv") as execv:
                runtime.reexec_with_runtime(["script.py"])
        execv.assert_not_called()

    def test_reexec_moves_to_the_runtime_interpreter(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "python"
            target.write_text("")
            target.chmod(0o755)
            with patch.dict(os.environ, {"VISTACK_LAYA_PYTHON": str(target), runtime.REEXEC_MARKER: ""}):
                with patch.object(runtime, "runtime_available", return_value=False), patch("os.execv") as execv:
                    runtime.reexec_with_runtime(["script.py", "laya", "status"])
                    self.assertEqual(os.environ[runtime.REEXEC_MARKER], "1")
        execv.assert_called_once_with(str(target), [str(target), "script.py", "laya", "status"])

    def test_checkpoint_cache_lookup_follows_the_hub_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "models--convaiinnovations--laya" / "snapshots" / "abc"
            (snapshot / "multilingual").mkdir(parents=True)
            (snapshot / "model.safetensors").write_text("")
            with patch.dict(os.environ, {"HF_HUB_CACHE": directory}):
                self.assertTrue(runtime.checkpoint_cached("convaiinnovations/laya"))
                self.assertFalse(runtime.checkpoint_cached("convaiinnovations/laya/multilingual"))
                self.assertIsNone(runtime.checkpoint_cached(None))

    def test_setup_plan_pins_python_and_prefetches_the_checkpoint(self):
        commands = runtime.setup_commands(Path("/venv"), "convaiinnovations/laya/multilingual", uv="/bin/uv")
        self.assertEqual(commands[0], ["/bin/uv", "venv", "--python", runtime.RUNTIME_PYTHON, "/venv"])
        self.assertIn("laya-mlx", commands[1])
        self.assertIn("subfolder='multilingual'", commands[2][-1])


class ForkTallyTests(unittest.TestCase):
    def test_tally_counts_sharp_and_split_forks_per_type(self):
        with tempfile.TemporaryDirectory() as directory:
            history = str(Path(directory) / "history.jsonl")
            engine = DecisionEngine(backend="deterministic", history_path=history)
            engine.decide({"decision_type": "tool-selection", "task": {"request": "Use grep"}, "available_actions": ["grep", "read"]})
            engine.decide({"decision_type": "tool-selection", "task": {"request": "Look"}, "available_actions": ["grep", "read"]})
            tally = fork_summary(history)
        self.assertEqual((tally["forks"], tally["sharp"], tally["split"]), (2, 1, 1))
        self.assertEqual(tally["by_type"]["tool-selection"]["backends"], {"deterministic": 2})


if __name__ == "__main__":
    unittest.main()
