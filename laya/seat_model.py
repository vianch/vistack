"""The seat-model fork: whether the coordinator and advisor seats run Opus or Fable.

The host silently drops an Opus advisor under a Fable main session, so only the three ``PAIRS``
exist. A seat is always one of their names, never a (main, advisor) pair a caller supplies.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .policy import TIER_FLAGS, PolicyDraft, _common, _int
from .schema import ACTIONS_BY_TYPE, PLAYBOOKS, DecisionContext


SEATS: tuple[str, ...] = ACTIONS_BY_TYPE["seat-model"]
PAIRS: Mapping[str, tuple[str, str]] = {
    "opus": ("opus", "opus"),
    "fable-advisor": ("opus", "fable"),
    "fable": ("fable", "fable"),
}
SEAT_ROLES = ("coordinator", "advisor")
FABLE_FAMILIES = ("fable", "mythos")
MOMENTS = ("run-start", "plan", "repeat", "retry", "run-end")
DEFAULT_MOMENT = "plan"
MAIN_SEAT_MOMENTS = ("run-start", "repeat")
COUNTED_MOMENTS = ("run-start", "repeat", "retry")
OCCURRENCE_REQUIRED_MOMENTS = ("repeat", "retry")
HEAVY_PLAYBOOKS = ("multi-phase-plan", "autopilot-stack", "autopilot-full")
STRUCTURAL_SIGNALS_FOR_ADVISOR = 2
STRUGGLE_RETRIES = 2
ALWAYS_SHARP_CONFIDENCE = 1.0
ADVISOR_SEAT = SEATS.index("fable-advisor")
MAIN_SEAT = SEATS.index("fable")

assert tuple(PAIRS) == SEATS, "PAIRS keys exactly the schema vocabulary, in ladder order"
assert all(advisor == "fable" for main, advisor in PAIRS.values() if main == "fable"), "a Fable main accepts only a Fable advisor"
assert set(HEAVY_PLAYBOOKS) <= set(PLAYBOOKS)


@dataclass(frozen=True)
class SeatInputs:
    prior: str | None
    restore_to: str
    moment: str
    occurrence: str | None
    decided: bool
    structural: tuple[str, ...]
    struggle: tuple[str, ...]
    unavailable: str | None
    refused_role: str | None


@dataclass(frozen=True)
class SeatMove:
    seat: str
    switch: tuple[str, ...]
    rationale: str
    held: str | None = None


def is_fable(model: str | None) -> bool:
    name = (model or "").lower()
    return any(family in name for family in FABLE_FAMILIES)


def switch_lines(seat: str) -> tuple[str, str]:
    main, advisor = PAIRS[seat]
    if advisor == "fable":
        return f"/advisor {advisor}", f"/model {main}"
    return f"/model {main}", f"/advisor {advisor}"


def _seat(value: Any) -> str | None:
    return value if isinstance(value, str) and value in SEATS else None


def unavailable_reason(constraints: Mapping[str, Any]) -> str | None:
    if str(constraints.get("host") or "").lower() == "codex":
        return "codex"
    if constraints.get("zdr") is True:
        return "zdr"
    if constraints.get("fable_available") is False:
        return str(constraints.get("fable_unavailable_reason") or "unavailable")
    return None


def structural_signals(context: DecisionContext) -> tuple[str, ...]:
    task = context.task
    flags = tuple(f"flag:{name}" for name in TIER_FLAGS if task.get(name) is True)
    if context.playbook in HEAVY_PLAYBOOKS:
        return (f"playbook:{context.playbook}", *flags)
    if task.get("architect") is True:
        return ("architect", *flags)
    return flags


def struggle_signals(context: DecisionContext, moment: str) -> tuple[str, ...]:
    retries = _int(context.current_state.get("retries")) or 0
    repeat = ("repeat",) if moment == "repeat" else ()
    return (*repeat, f"retries:{retries}") if retries >= STRUGGLE_RETRIES else repeat


def read_inputs(context: DecisionContext) -> SeatInputs:
    state = context.current_state
    moment = str(state["moment"]) if state.get("moment") else DEFAULT_MOMENT
    occurrence = str(state["occurrence"]) if moment in COUNTED_MOMENTS and state.get("occurrence") else None
    role = str(context.task.get("role") or "")
    return SeatInputs(
        prior=_seat(state.get("seat")),
        restore_to=_seat(state.get("seat_prior")) or "opus",
        moment=moment,
        occurrence=occurrence,
        decided=occurrence is not None and occurrence == str(state.get("seat_occurrence") or ""),
        structural=structural_signals(context),
        struggle=struggle_signals(context, moment),
        unavailable=unavailable_reason(context.constraints),
        refused_role=role if role and role not in SEAT_ROLES else None,
    )


def _hold(seat: str, reason: str) -> SeatMove:
    return SeatMove(seat, (), f"Nothing switches: {reason}.", reason)


def _move(current: int, target: int, rationale: str, held: str | None = None) -> SeatMove:
    seat = SEATS[target]
    return SeatMove(seat, switch_lines(seat) if target != current else (), rationale, held)


def next_seat(inputs: SeatInputs) -> SeatMove:
    if inputs.refused_role:
        return _hold("opus", f"{inputs.refused_role} holds no seat; only the coordinator and advisor run Fable")
    if inputs.unavailable:
        return SeatMove("opus", switch_lines("opus"), f"Fable is unavailable ({inputs.unavailable}), so both seats run opus.")
    if inputs.moment not in MOMENTS:
        return _hold(inputs.prior or "opus", f"moment {inputs.moment} is not one of {', '.join(MOMENTS)}")
    if inputs.prior is None and inputs.moment != "run-start":
        return _hold("opus", f"current_state.seat is missing or unknown at {inputs.moment}")
    prior = inputs.prior or "opus"
    current = SEATS.index(prior)
    if inputs.moment == "run-end":
        target = min(SEATS.index(inputs.restore_to), current)
        return _move(current, target, f"The run ended, so the seats return to {SEATS[target]}.")
    if inputs.moment in OCCURRENCE_REQUIRED_MOMENTS and inputs.occurrence is None:
        return _hold(prior, f"a {inputs.moment} call needs current_state.occurrence")
    if inputs.decided:
        return _hold(prior, f"occurrence {inputs.occurrence} is already decided")
    main_moment = inputs.moment in MAIN_SEAT_MOMENTS and inputs.occurrence is not None
    wanted = MAIN_SEAT if inputs.struggle else ADVISOR_SEAT if len(inputs.structural) >= STRUCTURAL_SIGNALS_FOR_ADVISOR else current
    ceiling = min(current + 1, MAIN_SEAT) if main_moment else max(current, ADVISOR_SEAT)
    target = max(current, min(wanted, ceiling))
    held = None
    if wanted > current + 1:
        held = "fable: one seat step per call"
    elif wanted > target and inputs.moment == "run-start":
        held = "fable: a run-start moves the main seat only with current_state.occurrence"
    elif wanted > target:
        held = "fable: the main seat moves only at run-start or repeat"
    named = ", ".join((*inputs.structural, *inputs.struggle)) or "No named signal"
    outcome = f"moves the seats from {prior} to {SEATS[target]}" if target != current else f"keeps the seats at {prior}"
    return _move(current, target, f"{named} at {inputs.moment} {outcome}." + (f" Held: {held}." if held else ""), held)


def select_seat(context: DecisionContext) -> PolicyDraft:
    inputs = read_inputs(context)
    move = next_seat(inputs)
    outputs = {
        "seat": move.seat,
        "switch": list(move.switch),
        "prior": inputs.prior,
        "moment": inputs.moment,
        "occurrence": inputs.occurrence,
        "signals": [*inputs.structural, *inputs.struggle],
        "held": move.held,
        "unavailable": inputs.unavailable,
        "refused_role": inputs.refused_role,
    }
    return _common(context, action=move.seat, confidence=ALWAYS_SHARP_CONFIDENCE, rationale=move.rationale, outputs=outputs)
