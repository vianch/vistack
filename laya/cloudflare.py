"""Cloudflare Workers AI clef-flash: its facts, its credentials, and the daily Neuron ledger.

This is the only home for these numbers. It imports no HTTP client, so ``decisions status``
can read the ledger without loading urllib.
"""

from __future__ import annotations

from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any, Callable, Iterator

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore[assignment]

from .config import cache_dir
from .errors import LayaUnavailable


API_URL = "https://api.cloudflare.com/client/v4"
MODEL_ID = "@cf/cloudflare/clef-flash"
# The System One body names the model without the catalog prefix.
BODY_MODEL = "clef-flash"
# Pricing lists no output rate and the live call reported 0 output tokens; output is charged at
# the input rate, which can only over-count.
NEURONS_PER_M_INPUT = 8182
# "All limits reset daily at 00:00 UTC."
FREE_NEURONS_PER_DAY = 10_000
DEFAULT_DAILY_CAP = 9_000
# Inherited from Ollama clef-flash (laya.ollama_models): the same weights, unmeasured on
# Workers AI.
MIN_CONFIDENCE = 0.85
# The window is 65,536 tokens; this bounds the spend per call and matches the state size the
# inherited floor was measured at.
MAX_STATE_CHARS = 6000
# A live two-question call answered in 0.77 s.
DEFAULT_TIMEOUT_MS = 5000
REFUSAL_COOLDOWN_S = 3600.0
# Workers AI wraps the body in a prompt: the 135-byte probe billed 146 input tokens on
# 2026-10-05, so bytes / 3 alone under-counts a small body.
BYTES_PER_TOKEN = 3
PROMPT_OVERHEAD_TOKENS = 128
CAP_VARIABLE = "VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS"
DAILY_ALLOCATION_EXCEEDED = 3036
AUTHENTICATION_ERROR = 10000
# "This model requires a Workers Paid plan."
PAID_PLAN_REQUIRED = 5035
REFUSAL_CODES = frozenset({AUTHENTICATION_ERROR, PAID_PLAN_REQUIRED})
REFUSAL_HTTP_STATUSES = frozenset({401, 403})


def cloudflare_credentials() -> tuple[str | None, str | None]:
    """The API token (Wrangler's variable first, then the older name) and the account id."""

    token = next((value for value in (os.environ.get(name, "").strip() for name in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN")) if value), None)
    return token, os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip() or None


def missing_credentials(token: str | None, account: str | None) -> str | None:
    missing = [name for name, value in (("CLOUDFLARE_API_TOKEN", token), ("CLOUDFLARE_ACCOUNT_ID", account)) if not value]
    if not missing:
        return None
    return f"{' and '.join(missing)} not set; the tier needs CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN) and CLOUDFLARE_ACCOUNT_ID"


def run_url(account_id: str) -> str:
    return f"{API_URL}/accounts/{account_id}/ai/run/{MODEL_ID}"


def daily_cap() -> int:
    """The local cap may only be lowered: above the free allocation, Workers Paid bills overage."""

    raw = os.environ.get(CAP_VARIABLE, "").strip()
    if not raw:
        return DEFAULT_DAILY_CAP
    try:
        cap = int(raw)
    except ValueError:
        cap = 0
    if not 0 < cap <= FREE_NEURONS_PER_DAY:
        raise ValueError(
            f"{CAP_VARIABLE} must be a whole number from 1 to {FREE_NEURONS_PER_DAY:,}, the Workers AI free allocation per day; got {raw!r}"
        )
    return cap


def neurons(tokens: float) -> float:
    return tokens * NEURONS_PER_M_INPUT / 1_000_000


def estimate_neurons(body: bytes) -> float:
    return neurons(math.ceil(len(body) / BYTES_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _next_reset(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)


def _number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


@dataclass(frozen=True)
class Reservation:
    day: str
    neurons: float


class NeuronBudget:
    """Today's Neurons for one account, in a machine-wide file every process shares.

    The local count sees only this machine. The 10,000-Neuron free allocation is per account,
    so Cloudflare's 3036 refusal is authoritative and the margin below 10,000 covers use from
    elsewhere. The file names the account only by a short hash.
    """

    def __init__(self, account_id: str, *, cap: int, path: Path | None = None) -> None:
        self.key = hashlib.sha256(account_id.encode("utf-8")).hexdigest()[:12]
        self.cap = cap
        self.path = path or cache_dir() / "cloudflare-status.json"

    def _read(self) -> dict[str, Any]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def _record(self, ledger: dict[str, Any], now: datetime) -> dict[str, Any]:
        found = ledger.get(self.key)
        record = dict(found) if isinstance(found, dict) else {}
        day = now.date().isoformat()
        if record.get("day") != day:
            record.update(day=day, neurons=0.0, calls=0)
        return record

    @contextmanager
    def _locked(self) -> Iterator[None]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if fcntl is None:
            yield
            return
        with open(self.path.with_name(self.path.name + ".lock"), "a", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def _write(self, ledger: dict[str, Any]) -> None:
        handle, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(ledger, stream, sort_keys=True)
            os.replace(temporary, self.path)
        except BaseException:
            with suppress(OSError):
                os.unlink(temporary)
            raise

    def _update(self, change: Callable[[dict[str, Any], datetime], Any], *, required: bool = False) -> Any:
        try:
            with self._locked():
                ledger = self._read()
                now = _now()
                record = self._record(ledger, now)
                result = change(record, now)
                ledger[self.key] = record
                self._write(ledger)
                return result
        except OSError as exc:
            if required:
                # Without a record the cap cannot hold, so nothing is sent.
                raise LayaUnavailable(f"cannot record Cloudflare Neuron use in {self.path.parent}: {exc.strerror or exc}") from exc
            return None

    def reserve(self, estimate: float) -> Reservation:
        """Hold ``estimate`` Neurons for one request, or refuse before the request is sent."""

        def change(record: dict[str, Any], now: datetime) -> Reservation:
            blocked = _blocked(record, now)
            if blocked:
                raise LayaUnavailable(blocked)
            used = _number(record.get("neurons"))
            if used + estimate > self.cap:
                hours = (_next_reset(now) - now).total_seconds() / 3600
                raise LayaUnavailable(f"daily free Neuron cap reached: used {used:,.2f} of {self.cap:,}; resets 00:00 UTC in {hours:.1f}h")
            record["neurons"] = used + estimate
            record["calls"] = int(_number(record.get("calls"))) + 1
            return Reservation(record["day"], estimate)

        return self._update(change, required=True)

    def _adjust(self, reservation: Reservation, neurons_delta: float, calls_delta: int) -> None:
        def change(record: dict[str, Any], _moment: datetime) -> None:
            # A reservation from before midnight went with its day.
            if record["day"] == reservation.day:
                record["neurons"] = max(0.0, _number(record.get("neurons")) + neurons_delta)
                record["calls"] = max(0, int(_number(record.get("calls"))) + calls_delta)

        self._update(change)

    def reconcile(self, reservation: Reservation, actual: float) -> None:
        self._adjust(reservation, actual - reservation.neurons, 0)

    def release(self, reservation: Reservation) -> None:
        """For a request Cloudflare refused without running."""

        self._adjust(reservation, -reservation.neurons, -1)

    def mark_exhausted(self) -> None:
        def change(record: dict[str, Any], now: datetime) -> None:
            record["exhausted_until"] = _next_reset(now).timestamp()

        self._update(change)

    def mark_refused(self, status: int, code: int | None) -> None:
        def change(record: dict[str, Any], now: datetime) -> None:
            record.update(refused_until=now.timestamp() + REFUSAL_COOLDOWN_S, refused_status=status, refused_code=code)

        self._update(change)

    def snapshot(self) -> dict[str, Any]:
        now = _now()
        record = self._record(self._read(), now)
        used = _number(record.get("neurons"))
        refused_until = _number(record.get("refused_until"))
        refused = None
        if refused_until > now.timestamp():
            refused = {
                "until": datetime.fromtimestamp(refused_until, timezone.utc).isoformat(),
                "status": record.get("refused_status"),
                "code": record.get("refused_code"),
            }
        return {
            "day": record["day"],
            "used": round(used, 4),
            "cap": self.cap,
            "free_allocation": FREE_NEURONS_PER_DAY,
            "remaining": round(max(0.0, self.cap - used), 4),
            "calls": int(_number(record.get("calls"))),
            "resets_at": _next_reset(now).isoformat(),
            "exhausted": _number(record.get("exhausted_until")) > now.timestamp(),
            "refused": refused,
        }


def _blocked(record: dict[str, Any], now: datetime) -> str | None:
    stamp = now.timestamp()
    exhausted_until = _number(record.get("exhausted_until"))
    if exhausted_until > stamp:
        hours = (exhausted_until - stamp) / 3600
        return f"Cloudflare reported the daily free Neuron allocation used up (code 3036); resets 00:00 UTC in {hours:.1f}h"
    refused_until = _number(record.get("refused_until"))
    if refused_until > stamp:
        return (
            f"Cloudflare refused recently (HTTP {record.get('refused_status')}, code {record.get('refused_code')}); "
            f"retry in {(refused_until - stamp) / 60:.0f} min"
        )
    return None
