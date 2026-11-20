"""Whether a tier-selection request reads as an implementation slice.

Only the certain cases are not: a hand-back the host wraps in ``<agent-message`` or
``<task-notification``, and a brief that declares a read-only role. Such a request settles in
code, because no model can say which implementer owns work that is not there. Every other
request reaches the ladder, where a model may answer ``not-a-slice``.
"""

from __future__ import annotations

import re


HAND_BACK = re.compile(r"^\s*<(?:agent-message|task-notification)\b")
# Mirrors READ_ONLY_ROLES in hooks/lib/non-slice.ts.
READ_ONLY_ROLES = ("advisor", "analyst", "groomer", "health-check", "planner", "researcher", "reviewer")
READ_ONLY_BRIEF = re.compile(rf"^\s*role:\s*(?:{'|'.join(READ_ONLY_ROLES)})\b", re.I | re.M)
BRIEF_HEAD_CHARS = 600
NOT_A_SLICE = (
    "The request is a hand-back or a read-only role's brief, so it is not an implementation slice; "
    "an unclear tier is complex and no model is asked."
)


def slice_like(request: str) -> bool:
    """False only for a hand-back or a brief that declares a read-only role."""

    return not (HAND_BACK.match(request) or READ_ONLY_BRIEF.search(request[:BRIEF_HEAD_CHARS]))
