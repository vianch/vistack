from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from laya.config import read_settings, write_enabled


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


if __name__ == "__main__":
    unittest.main()
