"""Command-line entry points for the local decision engine."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .engine import BACKENDS, CONSULT_MODES, FALLBACKS, DecisionEngine
from .config import Settings, default_history_path, read_settings, resolve_config_path, write_enabled
from .feedback import analyze, fork_summary, proposals
from .history import HistoryStore
from .schema import DECISION_TYPES
from .server import serve


def _history(args: argparse.Namespace) -> str:
    return args.history or default_history_path()


def _engine(args: argparse.Namespace) -> DecisionEngine:
    settings = read_settings(args.config)
    enabled = settings.enabled and not args.disable_laya
    return DecisionEngine(
        backend=args.backend if enabled else "deterministic",
        model=args.model or settings.model,
        host=args.host or settings.host,
        host_model=args.host_model or settings.host_model,
        effort=args.effort,
        kev_url=args.kev_url or settings.kev_url,
        kev_model=args.kev_model or settings.kev_model or "kev-latest",
        jev=settings.jev if args.jev is None else args.jev,
        jev_model=args.jev_model or settings.jev_model,
        ollama_model=args.ollama_model or settings.ollama_model,
        ollama_url=args.ollama_url or settings.ollama_url,
        ollama_keep_alive=args.ollama_keep_alive or settings.ollama_keep_alive,
        ollama_timeout_ms=args.ollama_timeout_ms,
        clef_model=args.clef_model or settings.clef_model,
        clef_url=args.clef_url or settings.clef_url,
        clef_timeout_ms=args.clef_timeout_ms,
        clef_min_confidence=args.clef_min_confidence,
        consult=args.consult or settings.consult,
        fallback=args.fallback or settings.fallback,
        dtype=args.dtype,
        device=args.device,
        min_confidence=args.min_confidence,
        timeout_ms=args.timeout_ms,
        history_path=None if args.no_history else _history(args),
    )


def _json_context(args: argparse.Namespace) -> dict:
    value = json.loads(Path(args.context).read_text(encoding="utf-8")) if args.context else json.loads(sys.stdin.read())
    if not isinstance(value, dict):
        raise ValueError("context must be a JSON object")
    value.setdefault("decision_type", args.decision_type)
    return value


def _add_runtime_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--backend", choices=BACKENDS, default="auto")
    parser.add_argument("--model", help="Hugging Face id, owner/repo/subfolder, or a local checkpoint directory")
    parser.add_argument("--host", choices=("claude", "codex"), help="host CLI for the explicit cloud fallback")
    parser.add_argument("--host-model", help="host fallback model override")
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="low")
    parser.add_argument("--fallback", choices=FALLBACKS, help="tiers after the primary; none keeps the primary only")
    parser.add_argument("--kev-url", help="local Kev server URL, e.g. http://127.0.0.1:8009")
    parser.add_argument("--kev-model", help="Kev model name")
    parser.add_argument("--jev", action=argparse.BooleanOptionalAction, default=None, help="opt into hosted TypeSafe Jev")
    parser.add_argument("--jev-model", help="Jev model, default jev-latest")
    parser.add_argument("--ollama-model", help="local Ollama System One model, e.g. nimble; none turns the tier off")
    parser.add_argument("--ollama-url", help="Ollama server; defaults to OLLAMA_HOST, then http://127.0.0.1:11434")
    parser.add_argument("--ollama-keep-alive", help="how long Ollama keeps the model loaded, default 30m")
    parser.add_argument("--ollama-timeout-ms", type=int, help="Ollama budget; defaults to the larger of --timeout-ms and 8000")
    parser.add_argument("--clef-model", help="Clef model served by `decisions clef-start`: a Hugging Face id or local directory; none turns the tier off")
    parser.add_argument("--clef-url", help="Clef server, default http://127.0.0.1:8011")
    parser.add_argument("--clef-timeout-ms", type=int, help="Clef budget; defaults to the larger of --timeout-ms and 8000")
    parser.add_argument("--clef-min-confidence", type=float, help="Clef's own answer floor, default 0.85; the stricter of it and --min-confidence applies")
    parser.add_argument("--consult", choices=CONSULT_MODES, help="always also records a model opinion on sharp forks")
    parser.add_argument("--dtype", choices=("float16", "float32", "bfloat16"), default="float16")
    parser.add_argument("--device", choices=("cpu", "gpu", "metal"))
    parser.add_argument("--min-confidence", type=float, default=0.65)
    parser.add_argument("--timeout-ms", type=int, default=2000)
    parser.add_argument("--config", help="switch file; defaults to the host's state root")
    parser.add_argument("--disable-laya", action="store_true", help="force deterministic policy for this request")
    parser.add_argument("--history", help="decision history; defaults to the host's state root")
    parser.add_argument("--no-history", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vistack-decision")
    commands = parser.add_subparsers(dest="command", required=True)

    decision = commands.add_parser("decision", help="evaluate one typed decision")
    decision.add_argument("decision_type", choices=DECISION_TYPES)
    decision.add_argument("--context", help="JSON context file; stdin is used when omitted")
    decision.add_argument("--request-id", help="stable id for retry-safe history recording")
    _add_runtime_options(decision)

    server = commands.add_parser("serve", help="run the long-lived JSONL decision server")
    _add_runtime_options(server)

    override = commands.add_parser("override", help="record a human override")
    override.add_argument("decision_id")
    override.add_argument("human_action")
    override.add_argument("--reason", required=True)
    override.add_argument("--outcome")
    override.add_argument("--recommended-action")
    override.add_argument("--history")

    outcome = commands.add_parser("outcome", help="record a decision outcome")
    outcome.add_argument("decision_id")
    outcome.add_argument("outcome")
    outcome.add_argument("--evidence", action="append", default=[])
    outcome.add_argument("--history")

    feedback = commands.add_parser("feedback", help="summarize decisions and propose policy reviews")
    feedback.add_argument("--history")
    feedback.add_argument("--minimum-repeats", type=int, default=3)

    forks = commands.add_parser("forks", help="tally forks per decision type: sharp, split, backend")
    forks.add_argument("--history")

    toggle = commands.add_parser("decisions", aliases=["laya"], help="show, change, or install the fork-layer decision models")
    toggle.add_argument("action", choices=("on", "off", "status", "setup", "clef-start", "clef-stop"))
    toggle.add_argument("--config", help="switch file; defaults to the host's state root")
    toggle.add_argument("--model", help="on/setup: the checkpoint to use")
    toggle.add_argument("--jev", action=argparse.BooleanOptionalAction, default=None, help="on: opt this project into Jev")
    toggle.add_argument("--ollama-model", help="on: the local Ollama model, e.g. nimble; none turns the tier off")
    toggle.add_argument("--ollama-url", help="on: the Ollama server URL")
    toggle.add_argument("--clef-model", help="on/setup/clef-start: Cloudflare/clef-flash or a local directory; none turns the tier off")
    toggle.add_argument("--clef-url", help="on/clef-start: the Clef server URL, default http://127.0.0.1:8011")
    toggle.add_argument("--clef-revision", help="on/setup/clef-start: the full commit sha a Hub id must resolve to")
    toggle.add_argument("--clef", action="store_true", help="setup: install the Clef runtime instead of laya-mlx")
    toggle.add_argument("--wait", type=float, default=0.0, help="clef-start: seconds to wait for the model to load and warm up")
    toggle.add_argument(
        "--probe",
        action="store_true",
        help="status: one tiny Jev call to prove key and credits, one local Ollama decision, and one Clef decision when its server is ready",
    )
    toggle.add_argument("--dry-run", action="store_true", help="setup: print the commands only")
    return parser


def _configured_engine(settings: Settings) -> DecisionEngine:
    return DecisionEngine(
        backend="auto" if settings.enabled else "deterministic",
        model=settings.model,
        kev_url=settings.kev_url,
        jev=settings.jev,
        ollama_model=settings.ollama_model,
        ollama_url=settings.ollama_url,
        ollama_keep_alive=settings.ollama_keep_alive,
        clef_model=settings.clef_model,
        clef_url=settings.clef_url,
        fallback=settings.fallback,
        host=settings.host,
        consult=settings.consult,
    )


def _ollama_status(model: str | None, url: str | None) -> dict:
    """Local calls with 1 s timeouts only, so status stays fast when Ollama is down."""

    from .system_one import ollama_inventory, same_model

    inventory = ollama_inventory(url)
    reachable = inventory["reachable"]
    missing: bool | None = False
    if model:
        # Unknown, not false, while the server is down.
        missing = not any(same_model(model, name) for name in inventory["installed"]) if reachable else None
    report = {"model": model, **inventory, "missing": missing}
    if model and not reachable:
        report["hint"] = f"start Ollama with `ollama serve`, or point OLLAMA_HOST or --ollama-url at it ({inventory['url']})"
    elif missing:
        report["hint"] = f"run `ollama pull {model}`"
    return report


def _preload_ollama(engine: DecisionEngine) -> dict:
    """Load the configured model now so the first fork does not pay for it. A failed load is
    reported, never raised."""

    if not engine.ollama_model:
        return {}
    from .system_one import OllamaBackend

    try:
        OllamaBackend(engine.ollama_model, url=engine.ollama_url, keep_alive=engine.ollama_keep_alive).warm()
    except Exception as exc:
        return {"preloaded": False, "preload_error": str(exc) or type(exc).__name__}
    return {"preloaded": True, "preload_error": None}


# Clef holds about 20 GB and nimble about 9.5 GB. With both resident on a 36 GB Mac, swap reached
# 25 of 26.6 GB, every Clef call ran past its 8 s budget, and the ladder fell through to nimble.
BOTH_LOCAL_MIN_GB = 48


def _memory_warning(engine: DecisionEngine, memory_gb: float | None) -> str | None:
    if not (engine.clef_model and engine.ollama_model) or memory_gb is None or memory_gb >= BOTH_LOCAL_MIN_GB:
        return None
    return (
        f"Clef (about 20 GB) and Ollama {engine.ollama_model} are both configured on a {memory_gb:g} GB machine; "
        "with both resident the Clef calls time out. Keep one: `decisions on --ollama-model none` or `--clef-model none`"
    )


def _status(args: argparse.Namespace) -> dict:
    from . import clef, runtime
    from .system_one import default_status_path, jev_api_key, read_status

    settings = read_settings(args.config)
    engine = _configured_engine(settings)
    refused = read_status(default_status_path())
    report = {
        "enabled": settings.enabled,
        "config": str(resolve_config_path(args.config)),
        "source": settings.source,
        "ladder": ["deterministic", *(name for name, _ in engine.ladder())],
        "consult": engine.consult,
        "python": sys.executable,
        "laya_mlx": runtime.runtime_available(),
        "model": engine.model,
        "checkpoint_cached": runtime.checkpoint_cached(engine.model),
        "jev": {"enabled": engine.jev, "key": bool(jev_api_key()), "refused": refused or None},
        "fallback": settings.fallback,
        "host": settings.host,
        "host_model": settings.host_model,
        "kev_url": settings.kev_url,
        "kev_model": settings.kev_model,
        "ollama": _ollama_status(engine.ollama_model, engine.ollama_url),
        "clef": clef.status(engine.clef_model, settings.clef_revision, engine.clef_url),
    }
    tally = fork_summary(default_history_path())
    report["forks"] = {
        "forks": tally["forks"],
        "sharp": tally["sharp"],
        "split": tally["split"],
        "by_type": {name: {key: bucket[key] for key in ("forks", "sharp", "mean_confidence")} for name, bucket in tally["by_type"].items()},
    }
    warning = _memory_warning(engine, clef.memory_gb())
    if warning:
        report["warning"] = warning
    if engine.model and not report["laya_mlx"]:
        report["hint"] = "run `vistack-decision.py decisions setup`, or set VISTACK_LAYA_PYTHON to a Python with laya-mlx"
    if args.probe:
        report["jev"]["probe"] = runtime.probe_jev()
        if engine.ollama_model:
            report["ollama"]["probe"] = runtime.probe_ollama(engine.ollama_model, engine.ollama_url)
        if report["clef"]["server"]["health"].get("status") == "ready":
            report["clef"]["probe"] = clef.probe(engine.clef_url)
    return report


def _clef_target(args: argparse.Namespace) -> tuple[str | None, str | None, str | None]:
    """``clef`` fills in the pinned defaults for anything left unset."""

    settings = read_settings(args.config)
    return args.clef_model or settings.clef_model, args.clef_revision or settings.clef_revision, args.clef_url or settings.clef_url


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.command == "decision":
        context = _json_context(args)
        result = _engine(args).decide(context, decision_type=args.decision_type, request_id=args.request_id)
        print(json.dumps(result.to_dict(), indent=2, sort_keys=True, ensure_ascii=False))
        return
    if args.command == "serve":
        engine = _engine(args)
        engine.warm()
        serve(engine)
        return
    # argparse records the spelling that was typed, so the alias is matched here too.
    if args.command in {"decisions", "laya"}:
        if args.action in {"on", "off"}:
            path = write_enabled(
                args.config,
                args.action == "on",
                model=args.model,
                jev=args.jev,
                ollama_model=args.ollama_model,
                ollama_url=args.ollama_url,
                clef_model=args.clef_model,
                clef_url=args.clef_url,
                clef_revision=args.clef_revision,
            )
            preload = _preload_ollama(_configured_engine(read_settings(path))) if args.action == "on" else {}
            report = {**_status(argparse.Namespace(config=str(path), probe=False)), "config": str(path)}
            report["ollama"].update(preload)
            # Loading and warming the 19 GB model takes most of a minute, so `on` only reports the
            # server; clef-start runs it.
            if args.action == "on" and report["clef"]["model"]:
                report["clef"]["running"] = report["clef"]["server"]["running"]
            print(json.dumps(report, sort_keys=True))
        elif args.action == "setup":
            if args.clef:
                from .clef import setup as clef_setup

                model, revision, _ = _clef_target(args)
                result = clef_setup(model, revision, dry_run=args.dry_run)
            else:
                from .runtime import setup

                result = setup(args.model or read_settings(args.config).model, dry_run=args.dry_run)
            print(json.dumps(result, indent=2, sort_keys=True))
            if not result["ok"]:
                raise SystemExit(1)
        elif args.action == "clef-start":
            from .clef import start

            model, revision, url = _clef_target(args)
            result = start(model, revision, url, wait_s=args.wait)
            print(json.dumps(result, sort_keys=True))
            if not result["ok"]:
                raise SystemExit(1)
        elif args.action == "clef-stop":
            from .clef import stop

            result = stop()
            print(json.dumps(result, sort_keys=True))
            if not result["ok"]:
                raise SystemExit(1)
        else:
            print(json.dumps(_status(args), sort_keys=True))
        return
    if args.command == "forks":
        print(json.dumps(fork_summary(_history(args)), indent=2, sort_keys=True))
        return
    history = _history(args)
    store = HistoryStore(history)
    if args.command == "override":
        changed = store.record_override(
            args.decision_id,
            args.human_action,
            args.reason,
            args.outcome,
            args.recommended_action,
        )
        print(json.dumps({"recorded": changed, "history": history}, sort_keys=True))
        return
    if args.command == "outcome":
        changed = store.record_outcome(args.decision_id, args.outcome, args.evidence)
        print(json.dumps({"recorded": changed, "history": history}, sort_keys=True))
        return
    if args.command == "feedback":
        print(
            json.dumps(
                {"summary": analyze(history), "proposals": proposals(history, minimum_repeats=args.minimum_repeats)},
                indent=2,
                sort_keys=True,
            )
        )
