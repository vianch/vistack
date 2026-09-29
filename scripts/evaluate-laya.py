#!/usr/bin/env python3
"""Compare deterministic, optional MLX, human, and final outcomes on JSONL scenarios."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from laya.engine import DecisionEngine
from laya.policy import evaluate
from laya.runtime import reexec_with_runtime
from laya.schema import DecisionContext

HELD_OUT_PERCENT = 30
SPLITS = ("all", "train", "held-out")


def split_of(scenario_id: str, held_out_percent: int = HELD_OUT_PERCENT) -> str:
    """Assign a scenario to train or held-out from a stable hash of its id."""
    bucket = int(hashlib.sha256(scenario_id.encode("utf-8")).hexdigest(), 16) % 100
    return "held-out" if bucket < held_out_percent else "train"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario_file", nargs="?", default="examples/laya/scenarios.jsonl")
    parser.add_argument("--backend", choices=("deterministic", "mlx", "kev", "jev", "host-llm", "auto"), default="deterministic")
    parser.add_argument("--model")
    parser.add_argument("--host", choices=("claude", "codex"))
    parser.add_argument("--host-model")
    parser.add_argument("--kev-url")
    parser.add_argument("--kev-model", default="kev-latest")
    parser.add_argument("--jev", action=argparse.BooleanOptionalAction, default=None)
    parser.add_argument("--fallback", choices=("none", "kev", "jev", "host-llm"))
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="low")
    parser.add_argument("--min-confidence", type=float, default=0.65)
    parser.add_argument("--raw", action="store_true", help="also score the first model answer before any gate")
    parser.add_argument("--check", action="store_true", help="exit 1 when a sharp fork misses a labelled human action")
    parser.add_argument("--split", choices=SPLITS, default="all", help="score only the train or the held-out scenarios")
    parser.add_argument("--held-out-percent", type=int, default=HELD_OUT_PERCENT)
    args = parser.parse_args(argv)
    deterministic = DecisionEngine(backend="deterministic", min_confidence=args.min_confidence)
    assisted = DecisionEngine(
        backend=args.backend,
        model=args.model,
        host=args.host,
        host_model=args.host_model,
        kev_url=args.kev_url,
        kev_model=args.kev_model,
        jev=args.jev,
        fallback=args.fallback,
        effort=args.effort,
        min_confidence=args.min_confidence,
    )
    rows = []
    for line in Path(args.scenario_file).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        scenario = json.loads(line)
        split = scenario.get("split") or split_of(scenario["id"], args.held_out_percent)
        if args.split != "all" and split != args.split:
            continue
        context = scenario["context"]
        decision_type = scenario["decision_type"]
        baseline = deterministic.decide(context, decision_type=decision_type, request_id=f"baseline:{scenario['id']}")
        started = time.perf_counter()
        recommendation = assisted.decide(context, decision_type=decision_type, request_id=f"assisted:{scenario['id']}")
        row = {
            "id": scenario["id"],
            "split": split,
            "decision_type": decision_type,
            "deterministic_action": baseline.action,
            "deterministic_fork": baseline.fork,
            "assisted_action": recommendation.action,
            "assisted_backend": recommendation.backend,
            "assisted_fallback": recommendation.fallback_used,
            "assisted_confidence": recommendation.confidence,
            "assisted_fork": recommendation.fork,
            "assisted_ms": round((time.perf_counter() - started) * 1000, 1),
            "human_action": scenario.get("human_action"),
            "final_outcome": scenario.get("final_outcome"),
        }
        if args.raw:
            ctx = DecisionContext.from_dict(context, decision_type=decision_type)
            row["raw"] = assisted._opinion(ctx, evaluate(ctx), assisted.ladder())
        rows.append(row)
    labelled = [row for row in rows if row["human_action"]]
    sharp = [row for row in labelled if row["assisted_fork"] == "sharp"]
    matches = sum(row["assisted_action"] == row["human_action"] for row in labelled)
    by_type: dict[str, dict[str, float]] = {}
    for row in labelled:
        bucket = by_type.setdefault(
            row["decision_type"], {"matched": 0, "total": 0, "sharp": 0, "sharp_matched": 0, "confidence_sum": 0.0}
        )
        bucket["total"] += 1
        bucket["matched"] += row["assisted_action"] == row["human_action"]
        bucket["sharp"] += row["assisted_fork"] == "sharp"
        bucket["sharp_matched"] += row["assisted_fork"] == "sharp" and row["assisted_action"] == row["human_action"]
        bucket["confidence_sum"] += row["assisted_confidence"]
    for bucket in by_type.values():
        bucket["accuracy"] = round(bucket["matched"] / bucket["total"], 4)
        bucket["sharp_precision"] = round(bucket["sharp_matched"] / bucket["sharp"], 4) if bucket["sharp"] else None
        bucket["sharp_coverage"] = round(bucket["sharp"] / bucket["total"], 4)
        bucket["mean_confidence"] = round(bucket.pop("confidence_sum") / bucket["total"], 4)
    # A split fork defers to the main session; only a sharp fork that picks the wrong action is
    # a decision error.
    mismatches = [
        {key: row[key] for key in ("id", "decision_type", "assisted_action", "human_action", "assisted_backend")}
        for row in sharp
        if row["assisted_action"] != row["human_action"]
    ]
    report = {
        "scenarios": rows,
        "split": args.split,
        "held_out_percent": args.held_out_percent,
        "human_action_match_count": matches,
        "scenario_count": len(rows),
        "human_action_accuracy": round(matches / len(labelled), 4) if labelled else None,
        "sharp_count": len(sharp),
        "sharp_precision": round((len(sharp) - len(mismatches)) / len(sharp), 4) if sharp else None,
        "sharp_coverage": round(len(sharp) / len(labelled), 4) if labelled else None,
        "by_decision_type": by_type,
        "mismatches": mismatches,
    }
    if args.raw:
        answered = [row for row in labelled if "action" in row["raw"]]
        report["raw_accuracy"] = (
            round(sum(row["raw"]["action"] == row["human_action"] for row in answered) / len(answered), 4) if answered else None
        )
        report["raw_answered"] = len(answered)
    print(json.dumps(report, indent=2, sort_keys=True))
    if args.check and mismatches:
        raise SystemExit(1)


if __name__ == "__main__":
    # Move to the venv that has laya-mlx, if one is configured, before the engine loads a model.
    reexec_with_runtime([str(Path(__file__).resolve()), *sys.argv[1:]])
    main()
