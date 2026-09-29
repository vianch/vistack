from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from unittest.mock import patch

from laya.config import default_config_path, read_settings, resolve_config_path, write_enabled


class ConfigTests(unittest.TestCase):
    def test_missing_config_is_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = read_settings(Path(directory) / "missing.json")
            self.assertTrue(settings.enabled)

    def test_off_command_persists_and_on_command_restores(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            write_enabled(path, False)
            self.assertFalse(read_settings(path).enabled)
            write_enabled(path, True)
            self.assertTrue(read_settings(path).enabled)
            self.assertEqual(json.loads(path.read_text())["schema_version"], 1)

    def test_environment_disable_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            write_enabled(path, True)
            previous = os.environ.get("VISTACK_LAYA_ENABLED")
            os.environ["VISTACK_LAYA_ENABLED"] = "0"
            try:
                self.assertFalse(read_settings(path).enabled)
            finally:
                if previous is None:
                    os.environ.pop("VISTACK_LAYA_ENABLED", None)
                else:
                    os.environ["VISTACK_LAYA_ENABLED"] = previous

    def test_local_and_host_fallback_settings_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            path.write_text(
                json.dumps(
                    {
                        "enabled": True,
                        "fallback": "kev",
                        "kev_url": "http://127.0.0.1:8009",
                        "kev_model": "kev-0.8b",
                        "host": "codex",
                        "host_model": "gpt-5.4-mini",
                    }
                )
            )
            settings = read_settings(path)
            self.assertEqual(settings.fallback, "kev")
            self.assertEqual(settings.kev_model, "kev-0.8b")
            self.assertEqual(settings.host_model, "gpt-5.4-mini")


class HostStateRootTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)

    def tearDown(self):
        os.chdir(self.previous)
        self.directory.cleanup()

    def test_claude_code_uses_the_claude_state_root(self):
        with patch.dict(os.environ, {"CLAUDECODE": "1"}):
            self.assertEqual(default_config_path(), ".claude/vistack/laya.json")
        with patch.dict(os.environ, {"CLAUDECODE": ""}):
            self.assertEqual(default_config_path(), ".codex/vistack/laya.json")

    def test_an_earlier_codex_root_switch_still_holds_under_claude(self):
        Path(".codex/vistack").mkdir(parents=True)
        Path(".codex/vistack/laya.json").write_text('{"enabled": false}')
        with patch.dict(os.environ, {"CLAUDECODE": "1", "VISTACK_LAYA_ENABLED": ""}):
            self.assertFalse(read_settings().enabled)
            written = write_enabled(None, True, model="convaiinnovations/laya", jev=True)
            self.assertEqual(str(written), ".claude/vistack/laya.json")
            self.assertEqual(resolve_config_path(), Path(".claude/vistack/laya.json"))
            settings = read_settings()
        self.assertTrue(settings.enabled)
        self.assertEqual((settings.model, settings.jev), ("convaiinnovations/laya", True))

    def test_off_keeps_the_model_and_jev_choice(self):
        write_enabled("laya.json", True, model="convaiinnovations/laya", jev=True)
        write_enabled("laya.json", False)
        value = json.loads(Path("laya.json").read_text())
        self.assertEqual((value["enabled"], value["model"], value["jev"]), (False, "convaiinnovations/laya", True))


if __name__ == "__main__":
    unittest.main()
