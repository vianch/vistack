"""What a ladder tier reported besides a settled answer: the model that served it, and an
answer held under its floor that agrees with or dissents from the policy.

A near miss never changes the action or the fork; no held-out evidence shows that agreement
under the floor is right more often than the policy alone.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class NearMiss:
    tier: str
    action: str
    margin: float


def near_miss_note(miss: NearMiss, policy_action: str) -> str:
    """The suffix the deck shows inside the tier's ``<tier> unavailable or rejected: <reason>`` segment."""

    return f"agrees: {miss.action}" if miss.action == policy_action else f"dissents: {miss.action}"


def tally(policy_action: str, misses: Sequence[NearMiss]) -> dict[str, Any]:
    """Outputs naming the tiers that agreed or dissented below their floors, empty when none answered."""

    if not misses:
        return {}
    return {
        "corroborated_by": [miss.tier for miss in misses if miss.action == policy_action],
        "dissent": [miss.tier for miss in misses if miss.action != policy_action],
        "margins": {miss.tier: round(miss.margin, 4) for miss in misses},
    }


def served_model(response: Mapping[str, Any], backend: Any) -> str | None:
    """The model the response names, else the one the backend asked for; ``jev-latest`` is unpinned."""

    for value in (response.get("model"), getattr(backend, "model", None)):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None
