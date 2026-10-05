from __future__ import annotations

import json
import os
import re
import tempfile
import unittest
from pathlib import Path

from unittest.mock import patch

from laya.config import KNOWN_ENV, default_config_path, read_settings, resolve_config_path, write_enabled


ROOT = Path(__file__).resolve().parents[2]
# A switch file as the removed tiers left it.
OLD_FILE = {
    "enabled": True,
    "jev": True,
    "ollama_model": "clef-flash",
    "model": "convaiinnovations/laya",
    "clef_model": "Cloudflare/clef-flash",
    "kev_url": "http://127.0.0.1:8009",
    "host": "codex",
    "host_model": 5,
}


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

    def test_obsolete_keys_are_tolerated_and_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            path.write_text(json.dumps(OLD_FILE))
            settings = read_settings(path)
        self.assertEqual((settings.enabled, settings.jev, settings.ollama_model), (True, True, "clef-flash"))
        self.assertEqual(settings.obsolete_fields, ("clef_model", "host", "host_model", "kev_url", "model"))

    def test_rewriting_the_switch_drops_obsolete_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            path.write_text(json.dumps(OLD_FILE))
            write_enabled(path, False)
            written = json.loads(path.read_text())
            settings = read_settings(path)
        self.assertEqual(written, {"enabled": False, "jev": True, "ollama_model": "clef-flash", "schema_version": 1})
        self.assertEqual(settings.obsolete_fields, ())

    def test_an_unknown_setting_is_refused_rather_than_dropped(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "unknown Laya setting: model"):
                write_enabled(Path(directory) / "laya.json", True, model="convaiinnovations/laya")

    def test_obsolete_environment_variables_are_reported(self):
        old = {"VISTACK_LAYA_MODEL": "convaiinnovations/laya", "VISTACK_LAYA_CLEF_URL": "http://127.0.0.1:8011", "VISTACK_LAYA_HOST": ""}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {**old, "VISTACK_LAYA_OLLAMA_MODEL": "clef-flash"}):
            settings = read_settings(Path(directory) / "missing.json")
        # An empty variable changes nothing, so it is not reported.
        self.assertEqual(settings.obsolete_env, ("VISTACK_LAYA_CLEF_URL", "VISTACK_LAYA_MODEL"))
        self.assertEqual(settings.ollama_model, "clef-flash")

    def test_every_variable_the_code_reads_is_known(self):
        # A variable missing from KNOWN_ENV would be reported as left over while it still works.
        sources = [*ROOT.glob("laya/*.py"), *ROOT.glob("scripts/*.py")]
        read = {name for path in sources for name in re.findall(r"VISTACK_LAYA_[A-Z][A-Z_]*", path.read_text(encoding="utf-8"))}
        self.assertIn("VISTACK_LAYA_OLLAMA_MIN_CONFIDENCE", read)
        self.assertEqual(read - KNOWN_ENV, set())


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
            self.assertEqual(default_config_path(), ".claude/vistack/decisions.json")
        with patch.dict(os.environ, {"CLAUDECODE": ""}):
            self.assertEqual(default_config_path(), ".codex/vistack/decisions.json")

    def test_an_earlier_codex_root_switch_still_holds_under_claude(self):
        Path(".codex/vistack").mkdir(parents=True)
        Path(".codex/vistack/laya.json").write_text('{"enabled": false}')
        with patch.dict(os.environ, {"CLAUDECODE": "1", "VISTACK_LAYA_ENABLED": ""}):
            self.assertFalse(read_settings().enabled)
            written = write_enabled(None, True, ollama_model="clef-flash", jev=True)
            self.assertEqual(str(written), ".claude/vistack/decisions.json")
            self.assertEqual(resolve_config_path(), Path(".claude/vistack/decisions.json"))
            settings = read_settings()
        self.assertTrue(settings.enabled)
        self.assertEqual((settings.ollama_model, settings.jev), ("clef-flash", True))

    def test_a_switch_under_its_earlier_name_holds_and_moves_on_the_next_write(self):
        Path(".claude/vistack").mkdir(parents=True)
        Path(".claude/vistack/laya.json").write_text('{"enabled": false, "ollama_model": "clef-flash"}')
        with patch.dict(os.environ, {"CLAUDECODE": "1", "VISTACK_LAYA_ENABLED": ""}):
            self.assertEqual(resolve_config_path(), Path(".claude/vistack/laya.json"))
            self.assertFalse(read_settings().enabled)
            written = write_enabled(None, True, cloudflare=True)
            settings = read_settings()
        self.assertEqual(str(written), ".claude/vistack/decisions.json")
        self.assertFalse(Path(".claude/vistack/laya.json").exists())
        self.assertEqual((settings.enabled, settings.ollama_model, settings.cloudflare), (True, "clef-flash", True))

    def test_an_explicit_decisions_path_finds_the_earlier_name_beside_it(self):
        Path("laya.json").write_text('{"enabled": false}')
        self.assertEqual(resolve_config_path("decisions.json"), Path("laya.json"))
        self.assertFalse(read_settings("decisions.json").enabled)
        write_enabled("decisions.json", True)
        self.assertEqual(sorted(path.name for path in Path(".").glob("*.json")), ["decisions.json"])

    def test_the_new_name_wins_when_both_exist(self):
        Path("laya.json").write_text('{"enabled": false}')
        Path("decisions.json").write_text('{"enabled": true}')
        self.assertTrue(read_settings("decisions.json").enabled)
        self.assertTrue(Path("laya.json").exists())

    def test_off_keeps_the_model_and_jev_choice(self):
        write_enabled("laya.json", True, ollama_model="clef-flash", jev=True)
        write_enabled("laya.json", False)
        value = json.loads(Path("laya.json").read_text())
        self.assertEqual((value["enabled"], value["ollama_model"], value["jev"]), (False, "clef-flash", True))


if __name__ == "__main__":
    unittest.main()
