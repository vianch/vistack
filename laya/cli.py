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
from .ollama_models import OLLAMA_MODELS, describe, supported_ollama_model, unsupported_reason
from .schema import DECISION_TYPES
from .server import serve


OLLAMA_MODEL_HELP = (
    "local Ollama decision model, or none to turn the tier off. Supported: "
    + "; ".join(describe(model) for model in OLLAMA_MODELS.values())
)


def ollama_model_argument(value: str) -> str:
    """An argparse type: a supported tag or ``none``, as typed; anything else names the fix."""

    if value.strip().lower() == "none" or supported_ollama_model(value):
        return value.strip()
    raise argparse.ArgumentTypeError(unsupported_reason(value))


def _history(args: argparse.Namespace) -> str:
    return args.history or default_history_path()


def _engine(args: argparse.Namespace) -> DecisionEngine:
    settings = read_settings(args.config)
    enabled = settings.enabled and not args.disable_laya
    return DecisionEngine(
        backend=args.backend if enabled else "deterministic",
        jev=settings.jev if args.jev is None else args.jev,
        jev_model=args.jev_model or settings.jev_model,
        ollama_model=args.ollama_model or settings.ollama_model,
        ollama_url=args.ollama_url or settings.ollama_url,
        ollama_keep_alive=args.ollama_keep_alive or settings.ollama_keep_alive,
        ollama_timeout_ms=args.ollama_timeout_ms,
        ollama_min_confidence=args.ollama_min_confidence,
        consult=args.consult or settings.consult,
        fallback=args.fallback or settings.fallback,
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
    parser.add_argument("--fallback", choices=FALLBACKS, help="tiers after the primary; none keeps the primary only")
    parser.add_argument("--jev", action=argparse.BooleanOptionalAction, default=None, help="opt into hosted TypeSafe Jev")
    parser.add_argument("--jev-model", help="Jev model, default jev-latest")
    parser.add_argument("--ollama-model", type=ollama_model_argument, help=OLLAMA_MODEL_HELP)
    parser.add_argument("--ollama-url", help="Ollama server; defaults to OLLAMA_HOST, then http://127.0.0.1:11434")
    parser.add_argument("--ollama-keep-alive", help="how long Ollama keeps the model loaded, default 30m")
    parser.add_argument("--ollama-timeout-ms", type=int, help="Ollama budget; defaults to the larger of --timeout-ms and 8000")
    parser.add_argument(
        "--ollama-min-confidence",
        type=float,
        help="the Ollama model's own answer floor, default from its table entry; the stricter of it and --min-confidence applies",
    )
    parser.add_argument("--consult", choices=CONSULT_MODES, help="always also records a model opinion on sharp forks")
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

    toggle = commands.add_parser("decisions", aliases=["laya"], help="show or change the fork-layer decision models")
    toggle.add_argument("action", choices=("on", "off", "status"))
    toggle.add_argument("--config", help="switch file; defaults to the host's state root")
    toggle.add_argument("--jev", action=argparse.BooleanOptionalAction, default=None, help="on: opt this project into Jev")
    toggle.add_argument("--ollama-model", type=ollama_model_argument, help="on: " + OLLAMA_MODEL_HELP)
    toggle.add_argument("--ollama-url", help="on: the Ollama server URL")
    toggle.add_argument(
        "--probe",
        action="store_true",
        help="status: one tiny Jev call to prove key and credits (billed), and one local Ollama decision (free)",
    )
    return parser


def _configured_engine(settings: Settings) -> DecisionEngine:
    return DecisionEngine(
        backend="auto" if settings.enabled else "deterministic",
        jev=settings.jev,
        jev_model=settings.jev_model,
        ollama_model=settings.ollama_model,
        ollama_url=settings.ollama_url,
        ollama_keep_alive=settings.ollama_keep_alive,
        fallback=settings.fallback,
        consult=settings.consult,
    )


def _ollama_status(engine: DecisionEngine) -> dict:
    """Local calls with 1 s timeouts only, so status stays fast when Ollama is down."""

    from .system_one import ollama_inventory, same_model

    model = engine.ollama_model
    supported = supported_ollama_model(model)
    inventory = ollama_inventory(engine.ollama_url, model=model)
    reachable = inventory["reachable"]
    missing: bool | None = False
    if model:
        # Unknown, not false, while the server is down.
        missing = not any(same_model(model, name) for name in inventory["installed"]) if reachable else None
    floor = engine.ollama_min_confidence
    if supported and floor is None:
        floor = OLLAMA_MODELS[supported].min_confidence
    report = {"model": model, **inventory, "missing": missing, "min_confidence": floor}
    if model and not supported:
        report["hint"] = unsupported_reason(model)
    elif model and not reachable:
        report["hint"] = f"start Ollama with `ollama serve`, or point OLLAMA_HOST or --ollama-url at it ({inventory['url']})"
    elif model and inventory["version_ok"] is False:
        report["hint"] = f"Ollama {inventory['version']} cannot serve {model}; it needs Ollama {OLLAMA_MODELS[supported].min_ollama} or newer"
    elif missing:
        report["hint"] = f"run `ollama pull {model}` (about {OLLAMA_MODELS[supported].disk_gb:g} GB)"
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


def _obsolete_hint(settings: Settings) -> str | None:
    steps = []
    if settings.obsolete_env:
        steps.append(f"remove {', '.join(settings.obsolete_env)} from your shell profile")
    if settings.obsolete_fields:
        steps.append(f"run `decisions on` to rewrite the switch file without {', '.join(settings.obsolete_fields)}")
    return "; ".join(steps) + " (left over from removed decision tiers)" if steps else None


def _status(args: argparse.Namespace) -> dict:
    from .system_one import default_status_path, jev_api_key, probe_jev, probe_ollama, read_status

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
        "jev": {"enabled": engine.jev, "key": bool(jev_api_key()), "refused": refused or None},
        "fallback": settings.fallback,
        "ollama": _ollama_status(engine),
        "obsolete": {"fields": list(settings.obsolete_fields), "env": list(settings.obsolete_env)},
    }
    tally = fork_summary(default_history_path())
    report["forks"] = {
        "forks": tally["forks"],
        "sharp": tally["sharp"],
        "split": tally["split"],
        "by_type": {name: {key: bucket[key] for key in ("forks", "sharp", "mean_confidence")} for name, bucket in tally["by_type"].items()},
    }
    hint = _obsolete_hint(settings)
    if hint:
        report["hint"] = hint
    if args.probe:
        # A key alone is not consent to a billed call that sends state off the machine.
        if engine.jev:
            report["jev"]["probe"] = probe_jev()
        if engine.ollama_model:
            report["ollama"]["probe"] = probe_ollama(engine.ollama_model, engine.ollama_url)
    return report


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
                args.config, args.action == "on", jev=args.jev, ollama_model=args.ollama_model, ollama_url=args.ollama_url
            )
            preload = _preload_ollama(_configured_engine(read_settings(path))) if args.action == "on" else {}
            report = {**_status(argparse.Namespace(config=str(path), probe=False)), "config": str(path)}
            report["ollama"].update(preload)
            print(json.dumps(report, sort_keys=True))
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
