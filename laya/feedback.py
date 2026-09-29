"""Evidence-backed summaries for improving policies without auto-editing skills."""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .history import HistoryStore


def analyze(path: str | Path) -> dict[str, Any]:
    records = HistoryStore(path).records()
    decisions = {item.get("decision_id"): item for item in records if item.get("kind") == "decision"}
    overrides = [item for item in records if item.get("kind") == "human-override"]
    outcomes = [item for item in records if item.get("kind") == "outcome"]
    override_pairs = Counter(
        (
            decisions.get(item.get("decision_id"), {}).get("decision", {}).get("action", "unknown"),
            item.get("human_action", "unknown"),
        )
        for item in overrides
    )
    by_type: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for item in overrides:
        decision = decisions.get(item.get("decision_id"), {}).get("decision", {})
        by_type[decision.get("decision_type", "unknown")][item.get("human_action", "unknown")] += 1
    return {
        "decision_count": len(decisions),
        "override_count": len(overrides),
        "outcome_count": len(outcomes),
        "override_pairs": {f"{left}->{right}": count for (left, right), count in override_pairs.items()},
        "overrides_by_type": {key: dict(value) for key, value in by_type.items()},
        "outcomes": dict(Counter(item.get("outcome", "unknown") for item in outcomes)),
    }


def proposals(path: str | Path, *, minimum_repeats: int = 3) -> list[dict[str, Any]]:
    records = HistoryStore(path).records()
    decisions = {item.get("decision_id"): item for item in records if item.get("kind") == "decision"}
    overrides = [item for item in records if item.get("kind") == "human-override"]
    by_pair: defaultdict[tuple[str, str], list[str]] = defaultdict(list)
    for item in overrides:
        decision = decisions.get(item.get("decision_id"), {}).get("decision", {})
        pair = (decision.get("action", "unknown"), item.get("human_action", "unknown"))
        by_pair[pair].append(str(item.get("decision_id")))
    result = []
    for (recommended, human), decision_ids in sorted(by_pair.items()):
        if len(decision_ids) < minimum_repeats:
            continue
        result.append(
            {
                "type": "review-policy",
                "recommended_action": recommended,
                "human_action": human,
                "count": len(decision_ids),
                "evidence_decision_ids": decision_ids,
                "proposal": "Review the decision rule, threshold, and question schema for this repeated override. Do not apply automatically.",
            }
        )
    return result


def fork_summary(path: str | Path) -> dict[str, Any]:
    """How many forks each decision type saw, how many ran in code, and who answered them."""

    decisions = [item.get("decision", {}) for item in HistoryStore(path).records() if item.get("kind") == "decision"]
    by_type: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        bucket = by_type.setdefault(
            decision.get("decision_type", "unknown"),
            {"forks": 0, "sharp": 0, "split": 0, "confidence_sum": 0.0, "backends": Counter()},
        )
        # Records written before the fork field existed count as neither.
        fork = decision.get("fork")
        bucket["forks"] += 1
        if fork in ("sharp", "split"):
            bucket[fork] += 1
        bucket["confidence_sum"] += float(decision.get("confidence", 0.0) or 0.0)
        bucket["backends"][decision.get("backend", "unknown")] += 1
    for bucket in by_type.values():
        bucket["mean_confidence"] = round(bucket.pop("confidence_sum") / bucket["forks"], 4)
        bucket["sharp_rate"] = round(bucket["sharp"] / bucket["forks"], 4)
        bucket["backends"] = dict(bucket["backends"])
    total = sum(bucket["forks"] for bucket in by_type.values())
    sharp = sum(bucket["sharp"] for bucket in by_type.values())
    split = sum(bucket["split"] for bucket in by_type.values())
    return {"forks": total, "sharp": sharp, "split": split, "by_type": dict(sorted(by_type.items()))}
