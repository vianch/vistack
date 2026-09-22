#!/usr/bin/env python3
"""Compare deterministic, optional MLX, human, and final outcomes on JSONL scenarios."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from laya.engine import DecisionEngine


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario_file", nargs="?", default="examples/laya/scenarios.jsonl")
    parser.add_argument("--backend", choices=("deterministic", "mlx", "kev", "host-llm", "auto"), default="deterministic")
    parser.add_argument("--model")
    parser.add_argument("--host", choices=("claude", "codex"))
    parser.add_argument("--host-model")
    parser.add_argument("--kev-url")
    parser.add_argument("--kev-model", default="kev-latest")
    parser.add_argument("--fallback", choices=("none", "kev", "host-llm"))
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="low")
    args = parser.parse_args(argv)
    deterministic = DecisionEngine(backend="deterministic")
    assisted = DecisionEngine(
        backend=args.backend,
        model=args.model,
        host=args.host,
        host_model=args.host_model,
        kev_url=args.kev_url,
        kev_model=args.kev_model,
        fallback=args.fallback,
        effort=args.effort,
    )
    rows = []
    for line in Path(args.scenario_file).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        scenario = json.loads(line)
        context = scenario["context"]
        decision_type = scenario["decision_type"]
        baseline = deterministic.decide(context, decision_type=decision_type, request_id=f"baseline:{scenario['id']}")
        recommendation = assisted.decide(context, decision_type=decision_type, request_id=f"assisted:{scenario['id']}")
        rows.append(
            {
                "id": scenario["id"],
                "decision_type": decision_type,
                "deterministic_action": baseline.action,
                "assisted_action": recommendation.action,
                "assisted_backend": recommendation.backend,
                "assisted_fallback": recommendation.fallback_used,
                "human_action": scenario.get("human_action"),
                "final_outcome": scenario.get("final_outcome"),
            }
        )
    matches = sum(row["assisted_action"] == row["human_action"] for row in rows if row["human_action"])
    print(json.dumps({"scenarios": rows, "human_action_match_count": matches, "scenario_count": len(rows)}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
