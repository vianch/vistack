#!/usr/bin/env python3
"""Benchmark deterministic or configured decision-backend latency.

The MLX benchmark includes model load in ``cold_start_ms`` and measures repeated calls on
one long-lived engine for warm latency. Memory is process RSS where the host exposes it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import resource
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from laya.engine import DecisionEngine


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return ordered[position]


def context() -> dict:
    return {
        "decision_type": "grooming",
        "task": {
            "request": "Add a typed decision engine for orchestration tasks.",
            "acceptance_criteria": ["returns a typed decision", "falls back when unavailable"],
            "finish_condition": "unit tests and CLI fixture pass",
            "brief": "Implement the bounded adapter and tests.",
        },
        "current_state": {"phase": "planned"},
        "evidence": [],
        "constraints": {"parallelizable": False},
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("deterministic", "mlx", "kev", "host-llm", "auto"), default="deterministic")
    parser.add_argument("--model")
    parser.add_argument("--host", choices=("claude", "codex"))
    parser.add_argument("--host-model")
    parser.add_argument("--kev-url")
    parser.add_argument("--kev-model", default="kev-latest")
    parser.add_argument("--fallback", choices=("none", "kev", "host-llm"))
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="low")
    parser.add_argument("--runs", type=int, default=25)
    args = parser.parse_args(argv)
    if args.runs < 2:
        raise SystemExit("--runs must be at least 2")
    started = time.perf_counter()
    engine = DecisionEngine(
        backend=args.backend,
        model=args.model,
        host=args.host,
        host_model=args.host_model,
        kev_url=args.kev_url,
        kev_model=args.kev_model,
        fallback=args.fallback,
        effort=args.effort,
    )
    cold = (time.perf_counter() - started) * 1000
    timings: list[float] = []
    for _ in range(args.runs):
        one = time.perf_counter()
        engine.decide(context(), request_id=None)
        timings.append((time.perf_counter() - one) * 1000)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    rss_kb = usage.ru_maxrss // 1024 if sys.platform == "darwin" else usage.ru_maxrss
    result = {
        "backend": args.backend,
        "model": args.model,
        "runs": args.runs,
        "cold_start_ms": round(cold, 3),
        "warm_p50_ms": round(percentile(timings, 0.50), 3),
        "warm_p95_ms": round(percentile(timings, 0.95), 3),
        "warm_mean_ms": round(statistics.mean(timings), 3),
        "max_rss_kb": rss_kb,
        "cpu_user_ms": round(usage.ru_utime * 1000, 3),
        "cpu_system_ms": round(usage.ru_stime * 1000, 3),
        "note": "MLX GPU utilization is runtime-dependent; this harness reports process RSS and CPU time.",
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
