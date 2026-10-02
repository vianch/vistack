"""The Clef tier. Nothing here loads the model or imports torch: the backend talks to a stdlib
fake on a free loopback port, the server runs with a fake loader, and every test that reads
the cache or the Hub cache points both at a temporary directory, because the real ones may
hold a live Clef venv, server, and snapshot."""

from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import URLError

from laya.config import read_settings, write_enabled
from laya.engine import LADDER, DecisionEngine
from laya.mlx_backend import LayaUnavailable
from laya.system_one import ClefBackend, clef_health


ROOT = Path(__file__).resolve().parents[2]
MECHANICAL = {"model": "clef-flash", "answers": {"tier": {"type": "choice", "choice": "mechanical", "confidence": 0.91}}}
SPLIT_FORK = {"decision_type": "tier-selection", "task": {"request": "Update the order summary panel"}}
NOUL = {"green": {"type": "noul", "instructions": "Is the build passing?"}}


def closed_url() -> str:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"http://127.0.0.1:{port}"


class FakeClef:
    """Answers ``/health`` and ``/v1/systemone`` the way ``laya.clef_server`` does."""

    def __init__(self, health: dict | None = None, answer: dict | None = None, code: int = 200) -> None:
        self.health = health or {"status": "ready"}
        self.answer = answer or MECHANICAL
        self.code = code
        self.requests: list[tuple[str, str, object]] = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def reply(self, code, payload):
                body = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                fake.requests.append(("GET", self.path, None))
                self.reply(200, fake.health)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                fake.requests.append(("POST", self.path, body))
                self.reply(fake.code, fake.answer if fake.code == 200 else {"error": "Clef is loading"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def __enter__(self) -> "FakeClef":
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        return self

    def __exit__(self, *_exc) -> None:
        self.server.shutdown()
        self.server.server_close()

    def paths(self) -> list[str]:
        return [path for _, path, _ in self.requests]


class ClefSettingsTests(unittest.TestCase):
    def test_clef_fields_round_trip_and_none_is_kept_as_written(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "laya.json"
            write_enabled(path, True, clef_model="Cloudflare/clef-flash", clef_url="http://127.0.0.1:8011", clef_revision="abc123")
            settings = read_settings(path)
            self.assertEqual(
                (settings.clef_model, settings.clef_url, settings.clef_revision), ("Cloudflare/clef-flash", "http://127.0.0.1:8011", "abc123")
            )
            write_enabled(path, True, clef_model="none")
            self.assertEqual(read_settings(path).clef_model, "none")

    def test_environment_names_the_clef_fields(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"VISTACK_LAYA_CLEF_MODEL": "Cloudflare/clef-flash", "VISTACK_LAYA_CLEF_REVISION": "abc123"}
        ):
            settings = read_settings(Path(directory) / "missing.json")
        self.assertEqual((settings.clef_model, settings.clef_revision, settings.clef_url), ("Cloudflare/clef-flash", "abc123", None))


class ClefLadderTests(unittest.TestCase):
    CONFIGURED = {"model": "configured", "kev_url": "http://127.0.0.1:8009", "ollama_model": "nimble", "clef_model": "Cloudflare/clef-flash"}

    def names(self, **options):
        return [name for name, _ in DecisionEngine(**options).ladder()]

    def test_clef_follows_opted_in_jev_and_leads_the_other_local_tiers(self):
        self.assertEqual(LADDER, ("jev", "clef", "ollama", "mlx", "kev", "host-llm"))
        self.assertEqual(self.names(backend="auto", jev=True, **self.CONFIGURED), ["jev", "clef:clef-flash", "ollama:nimble", "laya-mlx", "kev"])
        self.assertEqual(self.names(backend="auto", **self.CONFIGURED), ["clef:clef-flash", "ollama:nimble", "laya-mlx", "kev"])
        self.assertEqual(self.names(backend="clef", jev=True, **self.CONFIGURED), ["clef:clef-flash", "jev", "ollama:nimble", "laya-mlx", "kev"])
        self.assertEqual(self.names(backend="mlx", fallback="clef", **self.CONFIGURED), ["laya-mlx", "clef:clef-flash", "ollama:nimble", "kev"])
        self.assertEqual(self.names(backend="clef", fallback="none", **self.CONFIGURED), ["clef:clef-flash"])

    def test_the_tier_is_named_for_the_last_path_component(self):
        self.assertEqual(self.names(backend="auto", clef_model="/models/clef-flash-local/"), ["clef:clef-flash-local"])
        backend = DecisionEngine(backend="clef", clef_model="Cloudflare/clef-flash").ladder()[0][1]
        self.assertIsInstance(backend, ClefBackend)
        self.assertEqual((backend.url, backend.model, backend.max_state_chars), ("http://127.0.0.1:8011", "clef-flash", 6000))

    def test_environment_turns_the_tier_on_and_none_turns_it_off(self):
        with patch.dict(os.environ, {"VISTACK_LAYA_CLEF_MODEL": "Cloudflare/clef-flash", "VISTACK_LAYA_CLEF_URL": "http://127.0.0.1:9011"}):
            self.assertEqual(self.names(backend="auto"), ["clef:clef-flash"])
            self.assertEqual(DecisionEngine(backend="auto").ladder()[0][1].url, "http://127.0.0.1:9011")
            for off in ("none", "None", ""):
                self.assertEqual(self.names(backend="auto", clef_model=off), [], off)

    def test_clef_is_absent_when_unset(self):
        self.assertEqual(self.names(backend="auto"), [])
        self.assertEqual(self.names(backend="auto", model="configured", fallback="clef"), ["laya-mlx"])

    def test_clef_backend_requires_a_model(self):
        with self.assertRaisesRegex(ValueError, "clef-model"):
            DecisionEngine(backend="clef")

    def test_clef_budget_defaults_to_eight_seconds_and_is_validated(self):
        def timeout(**options):
            return DecisionEngine(backend="clef", clef_model="Cloudflare/clef-flash", **options).ladder()[0][1].timeout_ms

        self.assertEqual(timeout(), 8000)
        self.assertEqual(timeout(timeout_ms=12000), 12000)
        self.assertEqual(timeout(clef_timeout_ms=3000), 3000)
        with patch.dict(os.environ, {"VISTACK_LAYA_CLEF_TIMEOUT_MS": "4500"}):
            self.assertEqual(timeout(), 4500)
        with patch.dict(os.environ, {"VISTACK_LAYA_CLEF_TIMEOUT_MS": "soon"}), self.assertRaisesRegex(ValueError, "VISTACK_LAYA_CLEF_TIMEOUT_MS"):
            timeout()
        with self.assertRaisesRegex(ValueError, "clef_timeout_ms must be positive"):
            timeout(clef_timeout_ms=0)

    def test_constructing_the_tier_does_not_touch_the_network(self):
        with patch("laya.system_one.urlopen") as call:
            DecisionEngine(backend="auto", clef_model="Cloudflare/clef-flash").ladder()
        call.assert_not_called()


class ClefBackendTests(unittest.TestCase):
    def test_warm_reports_a_load_in_progress_with_its_elapsed_seconds(self):
        with FakeClef({"status": "loading", "load_seconds": 42.4}) as fake:
            with self.assertRaisesRegex(LayaUnavailable, "still loading its model \\(42s elapsed\\)"):
                ClefBackend(fake.url).warm()

    def test_warm_carries_the_load_error(self):
        with FakeClef({"status": "failed", "error": "RevisionMismatch: snapshot abc"}) as fake:
            with self.assertRaisesRegex(LayaUnavailable, "failed to load: RevisionMismatch: snapshot abc"):
                ClefBackend(fake.url).warm()

    def test_ready_is_cached_so_a_second_warm_skips_health(self):
        with FakeClef() as fake:
            backend = ClefBackend(fake.url)
            backend.warm()
            backend.warm()
        self.assertEqual(fake.paths(), ["/health"])

    def test_unreachable_names_the_start_command(self):
        url = closed_url()
        with self.assertRaises(LayaUnavailable) as caught:
            ClefBackend(url).warm()
        self.assertEqual(str(caught.exception), f"Clef is not running at {url}; start it with `vistack-decision.py decisions clef-start`")

    def test_predict_round_trip(self):
        with FakeClef() as fake:
            result = ClefBackend(fake.url).predict({"phase": "x"}, NOUL)
        method, path, body = fake.requests[0]
        self.assertEqual((method, path), ("POST", "/v1/systemone"))
        self.assertEqual(body, {"state": {"phase": "x"}, "model": "clef-flash", "questions": NOUL})
        self.assertEqual(result, MECHANICAL)

    def test_a_503_while_loading_is_unavailable(self):
        with FakeClef(code=503) as fake, self.assertRaisesRegex(LayaUnavailable, "HTTP 503: Clef is loading"):
            ClefBackend(fake.url).predict({}, NOUL)

    def test_health_helper_never_raises(self):
        report = clef_health(closed_url())
        self.assertEqual((report["reachable"], report["status"]), (False, None))
        with FakeClef({"status": "ready", "pid": 7}) as fake:
            report = clef_health(fake.url)
        self.assertEqual((report["reachable"], report["status"], report["pid"], report["url"]), (True, "ready", 7, fake.url))


class ClefEngineTests(unittest.TestCase):
    def engine(self, url):
        return DecisionEngine(backend="auto", clef_model="Cloudflare/clef-flash", clef_url=url)

    def test_a_ready_server_settles_the_split_fork(self):
        with FakeClef() as fake:
            result = self.engine(fake.url).decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.action, result.fork), ("clef:clef-flash", "mechanical", "sharp"))

    def test_a_loading_server_falls_through_to_the_policy(self):
        with FakeClef({"status": "loading", "load_seconds": 5}) as fake:
            result = self.engine(fake.url).decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.fork), ("deterministic-fallback", "split"))
        self.assertIn("still loading", result.fallback_reason)
        self.assertNotIn("/v1/systemone", fake.paths())

    def test_a_503_after_ready_falls_through_to_the_policy(self):
        with FakeClef(code=503) as fake:
            result = self.engine(fake.url).decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.fork), ("deterministic-fallback", "split"))
        self.assertIn("HTTP 503", result.fallback_reason)

    def test_a_down_server_leaves_the_fork_split_without_torch(self):
        result = self.engine(closed_url()).decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.fork), ("deterministic-fallback", "split"))
        self.assertIn("decisions clef-start", result.fallback_reason)
        self.assertNotIn("torch", sys.modules)

    def test_the_engine_path_imports_neither_torch_nor_the_server(self):
        script = (
            "import json, sys\n"
            "from laya.engine import DecisionEngine\n"
            f"result = DecisionEngine(backend='auto', clef_model='Cloudflare/clef-flash', clef_url={closed_url()!r}).decide({SPLIT_FORK!r})\n"
            "print(json.dumps([result.fork, sorted(name for name in ('torch', 'laya.clef', 'laya.clef_server') if name in sys.modules)]))\n"
        )
        environment = {key: value for key, value in os.environ.items() if not key.startswith(("VISTACK_LAYA_", "TYPESAFE_"))}
        completed = subprocess.run([sys.executable, "-c", script], cwd=ROOT, env=environment, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(completed.stdout), ["split", []])


class ClefThresholdTests(unittest.TestCase):
    BORDERLINE = {"answers": {"tier": {"type": "choice", "choice": "mechanical", "confidence": 0.80}}}

    def test_a_clef_answer_below_its_floor_falls_through_while_another_tier_accepts_it(self):
        with FakeClef(answer=self.BORDERLINE) as fake:
            engine = DecisionEngine(backend="auto", clef_model="Cloudflare/clef-flash", clef_url=fake.url, kev_url=fake.url)
            self.assertEqual([name for name, _ in engine.ladder()], ["clef:clef-flash", "kev"])
            result = engine.decide(SPLIT_FORK)
        self.assertEqual((result.backend, result.action, result.fork), ("kev", "mechanical", "sharp"))
        self.assertIn("clef:clef-flash unavailable or rejected: confidence 0.800 is below 0.850", result.fallback_reason)

    def test_the_floor_is_configurable_and_never_lowers_the_engine_threshold(self):
        def floor(**options):
            return DecisionEngine(backend="clef", clef_model="Cloudflare/clef-flash", **options).ladder()[0][1].min_confidence

        self.assertEqual(floor(), 0.85)
        self.assertEqual(floor(clef_min_confidence=0.7), 0.7)
        with patch.dict(os.environ, {"VISTACK_LAYA_CLEF_MIN_CONFIDENCE": "0.75"}):
            self.assertEqual(floor(), 0.75)
        with patch.dict(os.environ, {"VISTACK_LAYA_CLEF_MIN_CONFIDENCE": "high"}), self.assertRaisesRegex(ValueError, "VISTACK_LAYA_CLEF_MIN_CONFIDENCE"):
            floor()
        with self.assertRaisesRegex(ValueError, "clef_min_confidence must be between 0 and 1"):
            floor(clef_min_confidence=1.5)
        with FakeClef(answer=self.BORDERLINE) as fake:
            lowered = DecisionEngine(backend="clef", clef_model="Cloudflare/clef-flash", clef_url=fake.url, clef_min_confidence=0.7).decide(SPLIT_FORK)
            stricter = DecisionEngine(
                backend="clef", clef_model="Cloudflare/clef-flash", clef_url=fake.url, clef_min_confidence=0.5, min_confidence=0.82
            ).decide(SPLIT_FORK)
        self.assertEqual((lowered.backend, lowered.fork), ("clef:clef-flash", "sharp"))
        self.assertIn("below 0.820", stricter.fallback_reason)


REPO = "Cloudflare/clef-flash"
REVISION = "17f0b0ad64efb65d273590632833508766b2aae6"
SECRET = "do-not-log-7f3a"
VALID = {"model": "clef-flash", "state": {"note": SECRET}, "questions": NOUL}


class FakeRelease:
    """Stands in for the snapshot's ``joint_schema_model``: it can hold the load open, and it
    records every ``systemone`` call and how many ran at once."""

    def __init__(self, *, hold: bool = False, delay: float = 0.0) -> None:
        self.release = threading.Event()
        if not hold:
            self.release.set()
        self.delay = delay
        self.calls: list[dict] = []
        self.loaded: tuple | None = None
        self.active = self.peak = 0
        self.counter = threading.Lock()

    def load_release_model(self, path, device, dtype):
        self.release.wait(5)
        self.loaded = (path, device, dtype)
        return "model", "processor"

    def systemone(self, model, processor, request):
        with self.counter:
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            time.sleep(self.delay)
            self.calls.append(request)
            if "bad" in request["questions"]:
                raise ValueError("bad: type must be noul, choice, or score")
            if "boom" in request["questions"]:
                raise RuntimeError(f"device lost while reading {request['state']}")
            return {"model": request["model"], "answers": {name: {"type": "noul", "noul": 0.9} for name in request["questions"]}, "usage": {}}
        finally:
            with self.counter:
                self.active -= 1


def fake_loader(release: FakeRelease, *, download=None, memory=None):
    from laya import clef_server

    return clef_server.Loader(
        download=download or (lambda repo, revision: f"/hub/snapshots/{revision}"),
        import_code=lambda path: release,
        backend=lambda device, dtype: ("cpu", dtype),
        memory=memory or (lambda device: 19.5),
    )


class ServerHarness:
    """The real handler and load thread around a fake release; the server log is captured."""

    def __init__(self, release: FakeRelease, *, model: str = REPO, memory=None) -> None:
        from laya import clef_server

        self.downloads: list[tuple[str, str]] = []

        def fetch(repo, revision):
            self.downloads.append((repo, revision))
            return f"/hub/snapshots/{revision}"

        self.state = clef_server.ServerState(model, REVISION, device="auto", dtype="bfloat16")
        self.server = clef_server.ClefServer(self.state, 0)
        self.port = self.server.server_address[1]
        self.loading = threading.Thread(target=clef_server.load, args=(self.state, fake_loader(release, download=fetch, memory=memory)), daemon=True)
        self.log = io.StringIO()
        self._quiet = patch("sys.stderr", self.log)

    def __enter__(self) -> "ServerHarness":
        self._quiet.start()
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.loading.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.server.shutdown()
        self.server.server_close()
        self._quiet.stop()

    def ready(self) -> "ServerHarness":
        self.loading.join(5)
        return self

    def request(self, method: str, path: str, body: bytes | None = None, *, length: int | None = None) -> tuple[int, object]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.putrequest(method, path)
        if length is not None or body is not None:
            connection.putheader("content-length", str(len(body or b"") if length is None else length))
        connection.endheaders(body)
        response = connection.getresponse()
        raw = response.read()
        connection.close()
        return response.status, json.loads(raw) if raw else None

    def post(self, payload: object) -> tuple[int, object]:
        return self.request("POST", "/v1/systemone", json.dumps(payload).encode())


class ClefServerTests(unittest.TestCase):
    def test_health_answers_during_the_load_and_requests_get_503_until_ready(self):
        release = FakeRelease(hold=True)
        with ServerHarness(release) as harness:
            code, health = harness.request("GET", "/health")
            self.assertEqual((code, health["status"], health["pid"], health["model"], health["revision"]), (200, "loading", os.getpid(), REPO, REVISION))
            self.assertIsInstance(health["load_seconds"], (int, float))
            self.assertEqual(harness.post(VALID)[0], 503)
            release.release.set()
            harness.ready()
            code, health = harness.request("GET", "/health")
            self.assertEqual((health["status"], health["device"], health["error"], health["memory_gb"]), ("ready", "cpu", None, 19.5))
            # The warm-up call runs before ready, so the first request finds the kernels compiled.
            self.assertEqual(len(release.calls), 1)
            code, answer = harness.post(VALID)
        self.assertEqual((code, answer["answers"]["green"]["noul"]), (200, 0.9))
        self.assertEqual(release.loaded, (f"/hub/snapshots/{REVISION}", "cpu", "bfloat16"))
        self.assertEqual(release.calls[1], VALID)

    def test_the_request_envelope_is_checked_before_inference(self):
        from laya.clef_server import MAX_BODY_BYTES

        with ServerHarness(FakeRelease()) as harness:
            harness.ready()
            self.assertEqual(harness.request("POST", "/v1/systemone")[0], 411)
            self.assertEqual(harness.request("POST", "/v1/systemone", length=MAX_BODY_BYTES + 1)[0], 413)
            self.assertEqual(harness.request("POST", "/v1/systemone", b"{not json")[0], 400)
            self.assertEqual(harness.post([VALID])[0], 400)
            code, error = harness.post({**VALID, "questions": {"bad": {"type": "maybe"}}})
            self.assertEqual((code, error["error"]), (400, "bad: type must be noul, choice, or score"))
            self.assertEqual(harness.request("GET", "/v1/systemone")[0], 404)
            self.assertEqual(harness.request("POST", "/health", b"{}")[0], 404)

    def test_one_inference_runs_at_a_time(self):
        release = FakeRelease(delay=0.05)
        with ServerHarness(release) as harness:
            harness.ready()
            codes: list[int] = []
            workers = [threading.Thread(target=lambda: codes.append(harness.post(VALID)[0])) for _ in range(4)]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(5)
        self.assertEqual((codes, release.peak), ([200] * 4, 1))

    def test_request_bodies_never_reach_the_log(self):
        with ServerHarness(FakeRelease()) as harness:
            harness.ready()
            harness.post(VALID)
            harness.request("POST", "/v1/systemone", f"{{{SECRET}".encode())
            code, _ = harness.post({**VALID, "questions": {"boom": NOUL["green"]}})
        self.assertEqual(code, 500)
        self.assertIn("RuntimeError", harness.log.getvalue())
        self.assertNotIn(SECRET, harness.log.getvalue())

    def test_health_still_answers_when_the_memory_query_fails(self):
        def broken(device):
            raise RuntimeError("allocator busy")

        with ServerHarness(FakeRelease(), memory=broken) as harness:
            harness.ready()
            code, health = harness.request("GET", "/health")
        self.assertEqual((code, health["status"], health["memory_gb"]), (200, "ready", None))

    def test_the_server_binds_loopback_and_has_no_host_flag(self):
        from laya import clef_server

        with ServerHarness(FakeRelease()) as harness:
            self.assertEqual(harness.server.server_address[0], "127.0.0.1")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            clef_server.build_parser().parse_args(["--host", "0.0.0.0"])

    def test_a_revision_mismatch_fails_the_load_and_never_imports_the_code(self):
        from laya import clef_server

        imported: list[Path] = []
        state = clef_server.ServerState(REPO, REVISION, device="auto", dtype="bfloat16")
        loader = fake_loader(FakeRelease(), download=lambda repo, revision: "/hub/snapshots/0123456789abcdef0123456789abcdef01234567")
        loader = clef_server.Loader(download=loader.download, import_code=imported.append, backend=loader.backend, memory=loader.memory)
        with contextlib.redirect_stderr(io.StringIO()):
            clef_server.load(state, loader)
        health = state.health()
        self.assertEqual((health["status"], imported), ("failed", []))
        self.assertIn(f"pinned revision {REVISION}", health["error"])

    def test_a_local_directory_loads_as_given_with_a_warning(self):
        with tempfile.TemporaryDirectory() as directory, ServerHarness(FakeRelease(), model=directory) as harness:
            harness.ready()
            health = harness.state.health()
            self.assertEqual((health["status"], health["revision"], harness.downloads), ("ready", None, []))
            self.assertIn("revision pin does not apply", health["warning"])

    def test_auto_prefers_cuda_then_mps_then_cpu(self):
        from laya.clef_server import pick_device

        self.assertEqual(pick_device("auto", cuda=True, mps=True), "cuda")
        self.assertEqual(pick_device("auto", cuda=False, mps=True), "mps")
        self.assertEqual(pick_device("auto", cuda=False, mps=False), "cpu")
        self.assertEqual(pick_device("cpu", cuda=True, mps=True), "cpu")


@contextlib.contextmanager
def private_caches(**environment: str):
    """The viStack cache and the Hub cache, both empty and temporary."""

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        with patch.dict(os.environ, {"VISTACK_LAYA_CACHE_DIR": str(root / "cache"), "HF_HUB_CACHE": str(root / "hub"), **environment}):
            yield root


def write_snapshot(directory: Path, *, shards: int = 2) -> Path:
    names = [f"model-{index:05d}-of-{shards:05d}.safetensors" for index in range(1, shards + 1)]
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {f"layer.{index}": name for index, name in enumerate(names)}}))
    for name in [*names, "joint_head.safetensors", "joint_head_config.json", "joint_schema_model.py"]:
        (directory / name).write_text("")
    return directory


def hub_snapshot(root: Path, revision: str = REVISION) -> Path:
    return write_snapshot(root / "hub" / "models--Cloudflare--clef-flash" / "snapshots" / revision)


def stop_quietly(pid: object) -> None:
    if isinstance(pid, int):
        with contextlib.suppress(OSError):
            os.kill(pid, 15)


class ClefCacheTests(unittest.TestCase):
    def test_cached_needs_every_indexed_shard_at_the_pinned_revision(self):
        from laya import clef

        with private_caches() as root:
            snapshot = hub_snapshot(root)
            self.assertTrue(clef.cached(REPO, REVISION))
            self.assertFalse(clef.cached(REPO, "0" * 40))
            (snapshot / "model-00002-of-00002.safetensors").unlink()
            self.assertFalse(clef.cached(REPO, REVISION))
            self.assertIsNone(clef.cached(None, REVISION))
            local = write_snapshot(root / "local-clef")
            self.assertTrue(clef.cached(str(local), REVISION))


class ClefSetupTests(unittest.TestCase):
    def test_dry_run_pins_the_runtime_and_prefetches_the_revision(self):
        from laya import clef

        with private_caches() as root, patch("laya.clef.shutil.which", return_value="/bin/uv"), patch("laya.clef.subprocess.run") as run:
            result = clef.setup(REPO, REVISION, dry_run=True)
        run.assert_not_called()
        venv = str(root / "cache" / "clef-venv")
        self.assertEqual((result["ok"], result["venv"], result["model"], result["revision"]), (True, venv, REPO, REVISION))
        self.assertEqual(result["commands"][0], f"/bin/uv venv --python 3.12 {venv}")
        for pin in ("torch==2.11.*", "torchvision==0.26.*", "transformers==5.10.2", "huggingface_hub", "safetensors", "accelerate", "pillow"):
            self.assertIn(pin, result["commands"][1])
        self.assertIn(f"snapshot_download('{REPO}', revision='{REVISION}')", result["commands"][2])
        self.assertIsInstance(result["memory_gb"], float)

    def test_an_existing_venv_is_kept_and_low_memory_is_flagged(self):
        from laya import clef

        with private_caches() as root, patch("laya.clef.memory_gb", return_value=16.0):
            python = root / "cache" / "clef-venv" / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_text("")
            result = clef.setup(REPO, REVISION, dry_run=True)
        self.assertFalse(any(" venv " in command for command in result["commands"]))
        self.assertIn("16.0 GB", result["warning"])

    def test_the_first_failing_command_stops_setup(self):
        from laya import clef

        failed = subprocess.CompletedProcess([], 3)
        with private_caches(), patch("laya.clef.subprocess.run", return_value=failed) as run:
            result = clef.setup(REPO, REVISION)
        self.assertEqual((result["ok"], result["exit_code"], run.call_count), (False, 3, 1))
        self.assertEqual(result["failed"], result["commands"][0])


class ClefLifecycleTests(unittest.TestCase):
    def test_stop_refuses_a_pid_that_is_not_a_clef_server(self):
        from laya import clef

        with private_caches(), patch("laya.clef.os.kill") as kill:
            clef.pid_path().parent.mkdir(parents=True)
            clef.pid_path().write_text(json.dumps({"pid": os.getpid(), "url": "http://127.0.0.1:8011"}))
            result = clef.stop()
            self.assertFalse(clef.pid_path().exists())
        kill.assert_not_called()
        self.assertEqual((result["stopped"], result["pid"]), (False, os.getpid()))
        self.assertIn("not a Clef server", result["reason"])

    def test_stop_without_a_record_has_nothing_to_do(self):
        from laya import clef

        with private_caches():
            result = clef.stop()
        self.assertEqual((result["ok"], result["stopped"]), (True, False))

    def test_start_without_a_runtime_points_at_setup(self):
        from laya import clef

        with private_caches(), patch("laya.clef.subprocess.Popen") as spawn:
            result = clef.start(REPO, REVISION, closed_url())
        spawn.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertIn("decisions setup --clef", result["hint"])

    def test_start_reports_a_server_that_is_already_up(self):
        from laya import clef

        with private_caches(VISTACK_LAYA_CLEF_PYTHON=sys.executable), FakeClef({"status": "ready", "pid": 4242}) as fake:
            with patch("laya.clef.subprocess.Popen") as spawn:
                result = clef.start(REPO, REVISION, fake.url)
        spawn.assert_not_called()
        self.assertEqual((result["ok"], result["started"], result["status"], result["pid"]), (True, False, "ready", 4242))

    def test_start_only_runs_a_loopback_server(self):
        from laya import clef

        with private_caches(VISTACK_LAYA_CLEF_PYTHON=sys.executable), patch("laya.clef.subprocess.Popen") as spawn:
            result = clef.start(REPO, REVISION, "http://gpu-box:8011")
        spawn.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertIn("loopback", result["reason"])

    def test_start_spawns_a_detached_server_and_stop_terminates_it(self):
        """A real server process on this interpreter, given an empty model directory: it has
        neither torch nor the release code, so the load fails without a download."""

        from laya import clef

        with private_caches(VISTACK_LAYA_CLEF_PYTHON=sys.executable) as root:
            model = root / "empty-model"
            model.mkdir()
            url = closed_url()
            with warnings.catch_warnings():
                # The server is detached on purpose, so its Popen handle is dropped while it runs.
                warnings.simplefilter("ignore", ResourceWarning)
                result = clef.start(str(model), REVISION, url, wait_s=20)
            self.addCleanup(stop_quietly, result.get("pid"))
            self.assertEqual((result["ok"], result["started"], result["status"]), (False, True, "failed"), result)
            self.assertIn("ModuleNotFoundError", result["health"]["error"])
            record = json.loads(clef.pid_path().read_text())
            self.assertEqual((record["pid"], record["url"], record["model"], record["log"]), (result["pid"], url, str(model), result["log"]))
            again = clef.start(str(model), REVISION, url)
            self.assertEqual((again["started"], again["pid"]), (False, result["pid"]))
            stopped = clef.stop()
            self.assertEqual((stopped["ok"], stopped["stopped"]), (True, True), stopped)
            self.assertFalse(clef.pid_path().exists())
            log = Path(result["log"]).read_text()
        self.assertIn("listening on", log)
        self.assertIn("clef: stopped", log)
        self.assertFalse(clef_health(url)["reachable"])


class ClefStatusTests(unittest.TestCase):
    def test_status_reports_driver_memory_and_rss_without_raising(self):
        from laya import clef

        with private_caches() as root, FakeClef({"status": "ready", "pid": os.getpid(), "memory_gb": 20.1}) as fake:
            hub_snapshot(root)
            report = clef.status(REPO, None, fake.url)
        server = report["server"]
        self.assertEqual((report["model"], report["revision"], report["cached"]), (REPO, REVISION, True))
        self.assertEqual((server["running"], server["pid"], server["memory_gb"]), (True, os.getpid(), 20.1))
        self.assertGreater(server["rss_mb"], 0)
        self.assertIsNone(report["hint"])

    def test_status_with_the_server_down_hints_at_the_next_step(self):
        from laya import clef

        with private_caches() as root:
            report = clef.status(REPO, REVISION, closed_url())
            self.assertEqual((report["venv_exists"], report["server"]["running"]), (False, False))
            self.assertIn("decisions setup --clef", report["hint"])
            with patch.dict(os.environ, {"VISTACK_LAYA_CLEF_PYTHON": sys.executable}):
                hub_snapshot(root)
                report = clef.status(REPO, REVISION, closed_url())
        self.assertNotIn("setup", report["hint"])
        self.assertIn("decisions clef-start", report["hint"])

    def test_probe_times_one_decision_after_warm(self):
        from laya import clef

        with FakeClef(answer={"answers": {"green": {"type": "noul", "noul": 0.9}}}) as fake:
            result = clef.probe(fake.url)
        self.assertTrue(result["ok"])
        self.assertIn("latency_ms", result)
        result = clef.probe(closed_url())
        self.assertFalse(result["ok"])
        self.assertIn("decisions clef-start", result["reason"])


class ClefCommandTests(unittest.TestCase):
    def setUp(self):
        from laya import cli

        self.cli = cli
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        root = Path(self.directory.name)
        self.config = str(root / "laya.json")
        self.caches = patch.dict(os.environ, {"VISTACK_LAYA_CACHE_DIR": str(root / "cache"), "HF_HUB_CACHE": str(root / "hub")})
        self.caches.start()
        # Ollama and Clef may both be live on their default ports; no test may reach either.
        self.unreachable = patch("laya.system_one.urlopen", side_effect=URLError(ConnectionRefusedError(61, "refused")))
        self.unreachable.start()

    def tearDown(self):
        self.unreachable.stop()
        self.caches.stop()
        os.chdir(self.previous)
        self.directory.cleanup()

    def run_cli(self, *argv):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.cli.main(list(argv))
        return json.loads(output.getvalue())

    def test_on_writes_the_model_and_does_not_start_the_server(self):
        with patch("laya.clef.subprocess.Popen") as spawn:
            report = self.run_cli("decisions", "on", "--clef-model", REPO, "--config", self.config)
        spawn.assert_not_called()
        self.assertEqual(json.loads(Path(self.config).read_text())["clef_model"], REPO)
        self.assertIn("clef:clef-flash", report["ladder"])
        self.assertFalse(report["clef"]["running"])
        self.assertIn("decisions clef-start", report["clef"]["hint"])

    def test_status_with_the_server_down_reports_it_with_a_hint(self):
        write_enabled(self.config, True, clef_model=REPO, clef_revision=REVISION)
        report = self.run_cli("decisions", "status", "--config", self.config)
        self.assertEqual((report["clef"]["model"], report["clef"]["revision"], report["clef"]["server"]["running"]), (REPO, REVISION, False))
        self.assertIn("decisions clef-start", report["clef"]["hint"])

    def test_status_without_clef_configured_stays_quiet(self):
        report = self.run_cli("decisions", "status", "--config", self.config)
        self.assertEqual((report["clef"]["model"], report["clef"]["hint"]), (None, None))
        self.assertNotIn("clef", " ".join(report["ladder"]))

    def test_status_probe_runs_one_decision_when_the_server_is_ready(self):
        self.unreachable.stop()
        with FakeClef(answer={"answers": {"green": {"type": "noul", "noul": 0.9}}}) as fake, patch("laya.cli._ollama_status", return_value={}):
            write_enabled(self.config, True, clef_model=REPO, clef_url=fake.url)
            report = self.run_cli("decisions", "status", "--probe", "--config", self.config)
        self.assertTrue(report["clef"]["probe"]["ok"], report["clef"])
        self.assertTrue(report["clef"]["server"]["running"])

    def test_setup_clef_dry_run_lists_the_pinned_commands(self):
        with patch("laya.clef.subprocess.run") as run:
            result = self.run_cli("decisions", "setup", "--clef", "--dry-run", "--config", self.config)
        run.assert_not_called()
        joined = "\n".join(result["commands"])
        for pin in ("torch==2.11.*", "torchvision==0.26.*", "transformers==5.10.2", f"revision='{REVISION}'"):
            self.assertIn(pin, joined)
        self.assertEqual((result["model"], result["revision"]), (REPO, REVISION))

    def test_clef_start_without_a_runtime_fails_with_the_setup_hint(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as caught:
            self.cli.main(["decisions", "clef-start", "--wait", "5", "--config", self.config])
        self.assertEqual(caught.exception.code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual((result["ok"], result["started"]), (False, False))
        self.assertIn("decisions setup --clef", result["hint"])

    def test_clef_stop_with_nothing_recorded(self):
        result = self.run_cli("decisions", "clef-stop", "--config", self.config)
        self.assertEqual((result["ok"], result["stopped"]), (True, False))

    def test_runtime_options_and_settings_reach_the_engine(self):
        args = self.cli.build_parser().parse_args(
            ["decision", "tier-selection", "--clef-model", REPO, "--clef-url", "http://127.0.0.1:9011", "--config", self.config]
            + ["--clef-timeout-ms", "3000", "--clef-min-confidence", "0.9"]
        )
        backend = self.cli._engine(args).ladder()[0][1]
        self.assertEqual((backend.url, backend.model, backend.timeout_ms, backend.min_confidence), ("http://127.0.0.1:9011", "clef-flash", 3000, 0.9))
        write_enabled(self.config, True, clef_model="/models/clef-local", clef_url="http://127.0.0.1:9012")
        engine = self.cli._configured_engine(read_settings(self.config))
        self.assertEqual([(name, backend.url) for name, backend in engine.ladder()], [("clef:clef-local", "http://127.0.0.1:9012")])


if __name__ == "__main__":
    unittest.main()
