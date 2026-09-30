"""The Ollama tier. Every test patches ``laya.system_one.urlopen``: a live server may be
listening on the default URL, and a test must never reach it."""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from laya import cli, runtime
from laya.config import read_settings, write_enabled
from laya.engine import DecisionEngine
from laya.mlx_backend import ContextOverflow, LayaUnavailable
from laya.system_one import OllamaBackend, default_ollama_url, ollama_inventory


URL = "http://127.0.0.1:11434"
TWO = {"continue": "keep going", "block": "stop"}
MECHANICAL = {"answers": {"tier": {"type": "choice", "choice": "mechanical", "confidence": 0.91}}}
SPLIT_FORK = {"decision_type": "tier-selection", "task": {"request": "Update the order summary panel"}}
OVERFLOW = '{"error":"prompt 0 has 2510 tokens; expected 1–2050 (input is never truncated)"}'


def response(payload):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return type(
        "Response",
        (),
        {"__enter__": lambda self: self, "__exit__": lambda self, *args: False, "read": lambda self: body},
    )()


def http_error(code, body=b""):
    return HTTPError(f"{URL}/v1/systemone", code, "error", {}, io.BytesIO(body.encode() if isinstance(body, str) else body))


class FakeOllama:
    """Routes each request by path; a route may be a payload, an exception, or a list of them."""

    def __init__(self, **routes):
        self.routes = {f"/{path.replace('_', '/')}": value for path, value in routes.items()}
        self.requests = []

    def __call__(self, request, timeout=None):
        path = request.full_url.removeprefix(URL)
        self.requests.append((path, json.loads(request.data) if request.data else None, timeout))
        value = self.routes[path]
        if isinstance(value, list):
            value = value.pop(0)
        if isinstance(value, BaseException):
            raise value
        return response(value)

    def paths(self):
        return [path for path, _, _ in self.requests]

    def bodies(self, path):
        return [body for seen, body, _ in self.requests if seen == path]


class OllamaBackendTests(unittest.TestCase):
    def backend(self, **options):
        return OllamaBackend("nimble", url=URL, **options)

    def test_request_goes_to_system_one_without_a_key(self):
        fake = FakeOllama(v1_systemone={"answers": {}})
        with patch("laya.system_one.urlopen", fake):
            self.backend().predict({"phase": "x"}, {"next": {"type": "choice", "criteria": TWO}})
        sent = fake.bodies("/v1/systemone")[0]
        self.assertEqual(fake.paths(), ["/v1/systemone"])
        self.assertEqual((sent["model"], sent["keep_alive"], sent["state"]), ("nimble", "30m", {"phase": "x"}))
        with patch("laya.system_one.urlopen", return_value=response({"answers": {}})) as call:
            self.backend(keep_alive="-1").predict({}, {"next": {"type": "noul", "instructions": "?"}})
        request = call.call_args.args[0]
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(json.loads(request.data)["keep_alive"], -1)

    def test_ollama_host_is_normalized_like_the_ollama_cli(self):
        cases = {
            "0.0.0.0:11434": "http://127.0.0.1:11434",
            "gpu-box:11500": "http://gpu-box:11500",
            "https://ollama.internal": "https://ollama.internal",
            "": "http://127.0.0.1:11434",
        }
        for value, expected in cases.items():
            with patch.dict(os.environ, {"OLLAMA_HOST": value}):
                self.assertEqual(default_ollama_url(), expected, value)

    def test_a_malformed_port_is_left_for_the_request_to_reject(self):
        with patch.dict(os.environ, {"OLLAMA_HOST": "gpu-box:abc"}):
            self.assertEqual(default_ollama_url(), "http://gpu-box:abc")
            with patch("laya.system_one.urlopen", side_effect=ValueError("nonnumeric port: 'abc'")):
                self.assertFalse(ollama_inventory()["reachable"])
                result = DecisionEngine(backend="auto", ollama_model="nimble").decide(SPLIT_FORK)
        self.assertEqual(result.fork, "split")

    def test_missing_model_says_to_pull_it(self):
        missing = http_error(404, '{"error":"model \'nimble\' not found"}')
        with patch("laya.system_one.urlopen", side_effect=missing):
            with self.assertRaisesRegex(LayaUnavailable, "ollama pull nimble"):
                self.backend().predict({}, {"next": {"type": "choice", "criteria": TWO}})

    def test_refused_connection_says_to_start_the_server(self):
        refused = URLError(ConnectionRefusedError(61, "Connection refused"))
        with patch("laya.system_one.urlopen", side_effect=refused):
            with self.assertRaisesRegex(LayaUnavailable, f"not reachable at {URL}.*ollama serve"):
                self.backend().predict({}, {"next": {"type": "choice", "criteria": TWO}})

    def test_server_error_text_is_reported(self):
        with patch("laya.system_one.urlopen", side_effect=http_error(400, '{"error":"model does not support decisions"}')):
            with self.assertRaisesRegex(LayaUnavailable, "HTTP 400: model does not support decisions"):
                self.backend().predict({}, {"next": {"type": "choice", "criteria": TWO}})

    def test_one_option_choice_is_dropped_before_sending(self):
        fake = FakeOllama(v1_systemone={"answers": {}})
        questions = {"only": {"type": "choice", "criteria": {"continue": "go"}}, "next": {"type": "choice", "criteria": TWO}}
        with patch("laya.system_one.urlopen", fake):
            self.backend().predict({}, questions)
        self.assertEqual(list(fake.bodies("/v1/systemone")[0]["questions"]), ["next"])

    def test_no_answerable_question_raises_without_a_request(self):
        with patch("laya.system_one.urlopen") as call:
            with self.assertRaisesRegex(LayaUnavailable, "two or more options"):
                self.backend().predict({}, {"only": {"type": "choice", "criteria": {"continue": "go"}}})
        call.assert_not_called()

    def test_context_overflow_carries_the_token_counts(self):
        for body in (OVERFLOW, OVERFLOW.replace("–", "-")):
            with patch("laya.system_one.urlopen", side_effect=http_error(400, body)):
                with self.assertRaises(ContextOverflow) as caught:
                    self.backend().predict({}, {"next": {"type": "choice", "criteria": TWO}})
            self.assertEqual((caught.exception.prompt_tokens, caught.exception.limit_tokens), (2510, 2050))

    def test_warm_skips_the_load_when_the_model_is_resident(self):
        fake = FakeOllama(api_ps={"models": [{"name": "nimble:latest", "context_length": 8194}]})
        with patch("laya.system_one.urlopen", fake):
            backend = self.backend()
            backend.warm()
            backend.warm()
        # The second warm is inside the confirmed-loaded window and makes no request.
        self.assertEqual(fake.paths(), ["/api/ps"])

    def test_warm_blocks_on_the_load_when_the_model_is_absent(self):
        fake = FakeOllama(api_ps={"models": []}, api_generate={"done": True, "done_reason": "load"})
        with patch("laya.system_one.urlopen", fake):
            self.backend(load_timeout_ms=45000).warm()
        self.assertEqual(fake.paths(), ["/api/ps", "/api/generate"])
        self.assertEqual(fake.requests[1][1:], ({"model": "nimble", "keep_alive": "30m"}, 45.0))
        self.assertEqual(fake.requests[0][2], 1.0)

    def test_warm_rechecks_after_the_confirmed_window(self):
        fake = FakeOllama(api_ps=[{"models": [{"name": "nimble:latest"}]}, {"models": [{"name": "nimble:latest"}]}])
        with patch("laya.system_one.urlopen", fake):
            backend = self.backend()
            backend.warm()
            backend._loaded_at = time.monotonic() - 61
            backend.warm()
        self.assertEqual(fake.paths(), ["/api/ps", "/api/ps"])

    def test_warm_failure_names_the_remedy(self):
        with patch("laya.system_one.urlopen", side_effect=URLError(ConnectionRefusedError(61, "refused"))):
            with self.assertRaisesRegex(LayaUnavailable, "ollama serve"):
                self.backend().warm()
        fake = FakeOllama(api_ps={"models": []}, api_generate=http_error(404, '{"error":"model not found"}'))
        with patch("laya.system_one.urlopen", fake):
            with self.assertRaisesRegex(LayaUnavailable, "ollama pull nimble"):
                self.backend().warm()


class InventoryTests(unittest.TestCase):
    def test_unreachable_server_is_reported_not_raised(self):
        with patch("laya.system_one.urlopen", side_effect=URLError(ConnectionRefusedError(61, "refused"))):
            report = ollama_inventory(URL)
        self.assertEqual((report["reachable"], report["installed"], report["loaded"]), (False, [], []))
        self.assertIn("error", report)

    def test_decision_models_are_the_installed_models_with_the_capability(self):
        fake = FakeOllama(
            api_version={"version": "0.35.0"},
            api_tags={"models": [{"name": "nimble:latest"}, {"name": "llama3:8b"}]},
            api_ps={"models": [{"name": "nimble:latest", "context_length": 8194, "expires_at": "2026-09-30T12:00:00Z", "size": 1}]},
            api_show=[{"capabilities": ["decision"]}, {"capabilities": ["completion"]}],
        )
        with patch("laya.system_one.urlopen", fake):
            report = ollama_inventory(URL)
        self.assertEqual(report["version"], "0.35.0")
        self.assertEqual(report["decision_models"], ["nimble:latest"])
        self.assertEqual(report["loaded"], [{"name": "nimble:latest", "context_length": 8194, "expires_at": "2026-09-30T12:00:00Z"}])
        self.assertNotIn("error", report)


class OllamaLadderTests(unittest.TestCase):
    def names(self, **options):
        return [name for name, _ in DecisionEngine(**options).ladder()]

    def test_ollama_follows_opted_in_jev_and_leads_the_local_tiers(self):
        configured = {"model": "configured", "kev_url": "http://127.0.0.1:8009", "ollama_model": "nimble"}
        self.assertEqual(self.names(backend="auto", jev=True, **configured), ["jev", "ollama:nimble", "laya-mlx", "kev"])
        self.assertEqual(self.names(backend="auto", **configured), ["ollama:nimble", "laya-mlx", "kev"])
        self.assertEqual(self.names(backend="ollama", jev=True, **configured), ["ollama:nimble", "jev", "laya-mlx", "kev"])
        self.assertEqual(self.names(backend="ollama", fallback="none", **configured), ["ollama:nimble"])

    def test_none_turns_the_tier_off_over_the_environment(self):
        with patch.dict(os.environ, {"VISTACK_LAYA_OLLAMA_MODEL": "nimble"}):
            self.assertEqual(self.names(backend="auto"), ["ollama:nimble"])
            self.assertEqual(self.names(backend="auto", ollama_model="none"), [])
            self.assertEqual(self.names(backend="auto", ollama_model="None"), [])
            self.assertEqual(self.names(backend="auto", ollama_model=""), [])

    def test_ollama_backend_requires_a_model(self):
        with self.assertRaisesRegex(ValueError, "ollama-model"):
            DecisionEngine(backend="ollama")

    def test_ollama_gets_a_longer_budget_than_the_engine_default(self):
        def timeout(**options):
            return DecisionEngine(backend="ollama", ollama_model="nimble", **options).ladder()[0][1].timeout_ms

        self.assertEqual(timeout(), 8000)
        self.assertEqual(timeout(timeout_ms=12000), 12000)
        self.assertEqual(timeout(ollama_timeout_ms=3000), 3000)
        with patch.dict(os.environ, {"VISTACK_LAYA_OLLAMA_TIMEOUT_MS": "4500"}):
            self.assertEqual(timeout(), 4500)

    def test_settled_fork_names_the_ollama_model(self):
        fake = FakeOllama(api_ps={"models": [{"name": "nimble:latest"}]}, v1_systemone=MECHANICAL)
        with patch("laya.system_one.urlopen", fake):
            result = DecisionEngine(backend="auto", ollama_model="nimble").decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.action, result.fork), ("ollama:nimble", "mechanical", "sharp"))
        self.assertEqual(fake.bodies("/v1/systemone")[0]["keep_alive"], "30m")


class OverflowRetryTests(unittest.TestCase):
    CONTEXT = {"decision_type": "tier-selection", "task": {"request": "Update the order summary panel. " + "detail " * 700}}

    def engine(self):
        engine = DecisionEngine(backend="ollama", ollama_model="nimble", fallback="none")
        engine.ladder()[0][1]._loaded_at = time.monotonic()
        return engine

    def test_overflow_retries_once_with_a_smaller_state_that_settles_the_fork(self):
        fake = FakeOllama(v1_systemone=[http_error(400, OVERFLOW), MECHANICAL])
        with patch("laya.system_one.urlopen", fake):
            engine = self.engine()
            result = engine.decide(self.CONTEXT)
        first, second = (json.dumps(body["state"]) for body in fake.bodies("/v1/systemone"))
        self.assertLess(len(second), len(first) * 2050 / 2510)
        self.assertEqual((result.backend, result.action, result.fork), ("ollama:nimble", "mechanical", "sharp"))
        self.assertEqual(engine._failures["ollama:nimble"], 0)

    def test_a_failed_retry_counts_as_one_failure(self):
        fake = FakeOllama(v1_systemone=[http_error(400, OVERFLOW), http_error(400, OVERFLOW)])
        with patch("laya.system_one.urlopen", fake):
            engine = self.engine()
            result = engine.decide(self.CONTEXT)
        self.assertEqual(len(fake.bodies("/v1/systemone")), 2)
        self.assertEqual((result.fork, engine._failures["ollama:nimble"]), ("split", 1))
        self.assertIn("2510 tokens", result.fallback_reason)


class PerBackendBudgetTests(unittest.TestCase):
    def test_a_backend_timeout_overrides_the_engine_alarm(self):
        class Patient:
            timeout_ms = 400

            def predict(self, state, questions):
                time.sleep(0.2)
                return MECHANICAL

        class Impatient(Patient):
            timeout_ms = None

        engine = DecisionEngine(backend="mlx", model="configured", timeout_ms=100)
        engine._mlx = Patient()
        self.assertEqual(engine.decide(SPLIT_FORK).backend, "laya-mlx")
        engine = DecisionEngine(backend="mlx", model="configured", timeout_ms=100)
        engine._mlx = Impatient()
        self.assertIn("exceeded 100 ms", engine.decide(SPLIT_FORK).fallback_reason)

    def test_each_backend_receives_state_within_its_own_budget(self):
        seen = {}

        class Recording:
            def __init__(self, name, budget):
                self.name, self.max_state_chars = name, budget

            def predict(self, state, questions):
                seen[self.name] = state
                raise LayaUnavailable("recorded")

        engine = DecisionEngine(backend="mlx", model="configured", kev_url="http://127.0.0.1:8009")
        engine._mlx = Recording("small", 1500)
        engine._fallback_backend = Recording("large", 12000)
        engine._fallbacks = [("kev", engine._fallback_backend)]
        engine.decide({"decision_type": "tier-selection", "task": {"request": "Update the panel. " + "word " * 600}})
        self.assertLess(len(json.dumps(seen["small"])), len(json.dumps(seen["large"])))


class OllamaSettingsTests(unittest.TestCase):
    def test_ollama_keys_round_trip_through_the_switch_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            write_enabled(path, True, ollama_model="nimble", ollama_url="http://gpu-box:11434", ollama_keep_alive="1h")
            settings = read_settings(path)
            self.assertEqual(json.loads(path.read_text())["schema_version"], 1)
        self.assertEqual((settings.ollama_model, settings.ollama_url, settings.ollama_keep_alive), ("nimble", "http://gpu-box:11434", "1h"))

    def test_the_file_turns_off_a_model_the_environment_names(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"VISTACK_LAYA_OLLAMA_MODEL": "nimble"}):
            path = Path(directory) / "laya.json"
            self.assertEqual(read_settings(path).ollama_model, "nimble")
            write_enabled(path, True, ollama_model="none")
            self.assertEqual(read_settings(path).ollama_model, "none")


class DecisionsCommandTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        self.config = str(Path(self.directory.name) / "laya.json")
        self.unreachable = patch("laya.system_one.urlopen", side_effect=URLError(ConnectionRefusedError(61, "refused")))
        self.unreachable.start()

    def tearDown(self):
        self.unreachable.stop()
        os.chdir(self.previous)
        self.directory.cleanup()

    def run_cli(self, *argv):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(list(argv))
        return json.loads(output.getvalue())

    def test_both_spellings_run_the_status_action(self):
        for command in ("decisions", "laya"):
            report = self.run_cli(command, "status", "--config", self.config)
            self.assertIn("ollama", report, command)

    def test_on_writes_the_model_and_preloads_it(self):
        with patch("laya.system_one.OllamaBackend.warm") as warm:
            report = self.run_cli("decisions", "on", "--ollama-model", "nimble", "--config", self.config)
        warm.assert_called_once_with()
        self.assertEqual(json.loads(Path(self.config).read_text())["ollama_model"], "nimble")
        self.assertEqual((report["ollama"]["model"], report["ollama"]["preloaded"]), ("nimble", True))
        self.assertIn("ollama:nimble", report["ladder"])

    def test_a_failed_preload_is_reported_and_does_not_fail_the_command(self):
        report = self.run_cli("decisions", "on", "--ollama-model", "nimble", "--config", self.config)
        self.assertFalse(report["ollama"]["preloaded"])
        self.assertIn("ollama serve", report["ollama"]["preload_error"])

    def test_status_with_an_unreachable_server_hints_at_starting_it(self):
        write_enabled(self.config, True, ollama_model="nimble")
        report = self.run_cli("decisions", "status", "--config", self.config)
        self.assertEqual((report["ollama"]["model"], report["ollama"]["reachable"]), ("nimble", False))
        self.assertIn("ollama serve", report["ollama"]["hint"])

    def test_status_names_a_configured_model_that_is_not_pulled(self):
        write_enabled(self.config, True, ollama_model="nimble")
        fake = FakeOllama(
            api_version={"version": "0.35.0"},
            api_tags={"models": [{"name": "tev1:0.8b"}]},
            api_ps={"models": []},
            api_show={"capabilities": ["decision"]},
        )
        with patch("laya.system_one.urlopen", fake):
            report = self.run_cli("decisions", "status", "--config", self.config)
        self.assertTrue(report["ollama"]["missing"])
        self.assertIn("ollama pull nimble", report["ollama"]["hint"])

    def test_off_by_none_removes_the_tier(self):
        report = self.run_cli("decisions", "on", "--ollama-model", "none", "--config", self.config)
        self.assertIsNone(report["ollama"]["model"])
        self.assertNotIn("preloaded", report["ollama"])

    def test_runtime_options_reach_the_engine(self):
        args = cli.build_parser().parse_args(
            ["decision", "tier-selection", "--ollama-model", "tev1:0.8b", "--ollama-url", URL, "--config", self.config]
            + ["--ollama-keep-alive", "1h", "--ollama-timeout-ms", "3000"]
        )
        backend = cli._engine(args).ladder()[0][1]
        self.assertEqual((backend.model, backend.url, backend.keep_alive, backend.timeout_ms), ("tev1:0.8b", URL, "1h", 3000))


class ProbeTests(unittest.TestCase):
    def test_probe_reports_latency_or_the_reason(self):
        fake = FakeOllama(api_ps={"models": [{"name": "nimble:latest"}]}, v1_systemone={"answers": {"green": {"type": "noul", "noul": 0.9}}})
        with patch("laya.system_one.urlopen", fake):
            result = runtime.probe_ollama("nimble", URL)
        self.assertTrue(result["ok"])
        self.assertIn("latency_ms", result)
        with patch("laya.system_one.urlopen", side_effect=URLError(ConnectionRefusedError(61, "refused"))):
            result = runtime.probe_ollama("nimble", URL)
        self.assertFalse(result["ok"])
        self.assertIn("ollama serve", result["reason"])


if __name__ == "__main__":
    unittest.main()
