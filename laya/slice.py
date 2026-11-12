"""Whether a tier-selection request reads as an implementation slice.

Hosted Jev's tier confidence is the margin of its two probabilities, and it is flat on text
that is not a slice: a question, a hand-back, or chat. Such a request settles in code, because
no model can say which implementer owns work that is not there.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence


TIER_SIGNALS = ("complex_signals", "flags", "mechanical_signals", "pattern", "tier_mismatch")
IMPLEMENTATION_CLASSES = frozenset({"bug-fix", "crash-hunt", "design-implementation", "feature", "maintenance", "perf-issue", "prototype", "refactor"})
NOT_A_SLICE = (
    "The request names no tier signal and no implementation work, so it is not an implementation slice; "
    "an unclear tier is complex and no model is asked."
)


def slice_like(tier_signals: Mapping[str, Any], ranked_classes: Sequence[str]) -> bool:
    """True when the policy sees a tier signal or the request's leading task class is implementation work."""

    if any(tier_signals.get(name) for name in TIER_SIGNALS):
        return True
    return bool(ranked_classes) and ranked_classes[0] in IMPLEMENTATION_CLASSES
