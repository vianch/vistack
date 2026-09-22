"""Command-line entry points for the local decision engine."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .engine import DecisionEngine
from .config import DEFAULT_CONFIG_PATH, read_settings, write_enabled
from .feedback import analyze, proposals
from .history import HistoryStore
from .schema import DECISION_TYPES
from .server import serve


DEFAULT_HISTORY = ".codex/vistack/decision-history.jsonl"


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
        fallback=args.fallback or settings.fallback,
        dtype=args.dtype,
        device=args.device,
        min_confidence=args.min_confidence,
        timeout_ms=args.timeout_ms,
        history_path=None if args.no_history else args.history,
    )


def _json_context(args: argparse.Namespace) -> dict:
    value = json.loads(Path(args.context).read_text(encoding="utf-8")) if args.context else json.loads(sys.stdin.read())
    if not isinstance(value, dict):
        raise ValueError("context must be a JSON object")
    value.setdefault("decision_type", args.decision_type)
    return value


def _add_runtime_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--backend", choices=("auto", "deterministic", "mlx", "kev", "host-llm"), default="auto")
    parser.add_argument("--model", help="local checkpoint directory or Hugging Face model id")
    parser.add_argument("--host", choices=("claude", "codex"), help="host CLI for the explicit cloud fallback")
    parser.add_argument("--host-model", help="host fallback model override")
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="low")
    parser.add_argument("--fallback", choices=("none", "kev", "host-llm"), help="fallback after MLX is unavailable")
    parser.add_argument("--kev-url", help="local Kev server URL, e.g. http://127.0.0.1:8009")
    parser.add_argument("--kev-model", help="Kev model name")
    parser.add_argument("--dtype", choices=("float16", "float32", "bfloat16"), default="float16")
    parser.add_argument("--device", choices=("cpu", "gpu", "metal"))
    parser.add_argument("--min-confidence", type=float, default=0.65)
    parser.add_argument("--timeout-ms", type=int, default=2000)
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--disable-laya", action="store_true", help="force deterministic policy for this request")
    parser.add_argument("--history", default=DEFAULT_HISTORY)
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
    override.add_argument("--history", default=DEFAULT_HISTORY)

    outcome = commands.add_parser("outcome", help="record a decision outcome")
    outcome.add_argument("decision_id")
    outcome.add_argument("outcome")
    outcome.add_argument("--evidence", action="append", default=[])
    outcome.add_argument("--history", default=DEFAULT_HISTORY)

    feedback = commands.add_parser("feedback", help="summarize decisions and propose policy reviews")
    feedback.add_argument("--history", default=DEFAULT_HISTORY)
    feedback.add_argument("--minimum-repeats", type=int, default=3)

    toggle = commands.add_parser("laya", help="show or change the default-on Laya switch")
    toggle.add_argument("action", choices=("on", "off", "status"))
    toggle.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    return parser


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
    if args.command == "laya":
        if args.action in {"on", "off"}:
            path = write_enabled(args.config, args.action == "on")
            print(json.dumps({"enabled": args.action == "on", "config": str(path)}, sort_keys=True))
        else:
            settings = read_settings(args.config)
            print(
                json.dumps(
                    {
                        "enabled": settings.enabled,
                        "model": settings.model,
                        "fallback": settings.fallback,
                        "host": settings.host,
                        "host_model": settings.host_model,
                        "kev_url": settings.kev_url,
                        "kev_model": settings.kev_model,
                        "source": settings.source,
                        "config": args.config,
                    },
                    sort_keys=True,
                )
            )
        return
    store = HistoryStore(args.history)
    if args.command == "override":
        changed = store.record_override(
            args.decision_id,
            args.human_action,
            args.reason,
            args.outcome,
            args.recommended_action,
        )
        print(json.dumps({"recorded": changed, "history": args.history}, sort_keys=True))
        return
    if args.command == "outcome":
        changed = store.record_outcome(args.decision_id, args.outcome, args.evidence)
        print(json.dumps({"recorded": changed, "history": args.history}, sort_keys=True))
        return
    if args.command == "feedback":
        print(
            json.dumps(
                {"summary": analyze(args.history), "proposals": proposals(args.history, minimum_repeats=args.minimum_repeats)},
                indent=2,
                sort_keys=True,
            )
        )
