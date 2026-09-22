"""Append-only local decision history and human feedback records."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
from typing import Any, Iterable, Mapping

from .schema import Decision, DecisionContext, redact, utc_now


class HistoryStore:
    """A small JSONL store. Replaying the same event id is idempotent.

    Event ids already on disk are indexed incrementally: each append reads only the bytes
    written since this store last looked, so append cost stays flat as the history grows.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._ids: set[str] = set()
        self._offset = 0
        self._identity: tuple[int, int] | None = None

    def _records(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        records: list[dict[str, Any]] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                records.append(value)
        return records

    def records(self) -> list[dict[str, Any]]:
        return self._records()

    def _index_new_lines(self, stream: Any) -> None:
        info = os.fstat(stream.fileno())
        identity = (info.st_dev, info.st_ino)
        if identity != self._identity or info.st_size < self._offset:
            # A replaced or truncated file invalidates the index.
            self._ids.clear()
            self._offset = 0
            self._identity = identity
        stream.seek(self._offset)
        chunk = stream.read()
        complete = chunk.rfind(b"\n") + 1
        for line in chunk[:complete].splitlines():
            try:
                value = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if isinstance(value, dict) and value.get("event_id"):
                self._ids.add(str(value["event_id"]))
        self._offset += complete

    def _append(self, event: Mapping[str, Any]) -> bool:
        event_id = event.get("event_id")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("ab+") as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                self._index_new_lines(stream)
                if event_id and str(event_id) in self._ids:
                    return False
                encoded = (json.dumps(redact(dict(event)), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
                end = stream.seek(0, os.SEEK_END)
                if end:
                    # A crash can leave a final line without its newline. Terminate it so
                    # the new event starts on its own line instead of corrupting both.
                    stream.seek(end - 1)
                    if stream.read(1) != b"\n":
                        encoded = b"\n" + encoded
                    stream.seek(0, os.SEEK_END)
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
                self._offset = stream.tell()
                if event_id:
                    self._ids.add(str(event_id))
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        return True

    def append_decision(self, decision: Decision, context: DecisionContext) -> bool:
        return self._append(
            {
                "event_id": f"decision:{decision.decision_id}",
                "kind": "decision",
                "timestamp": decision.created_at,
                "decision_id": decision.decision_id,
                "decision": decision.to_dict(),
                "context": context.to_dict(),
                "result": None,
                "human_override": None,
            }
        )

    def record_override(
        self,
        decision_id: str,
        human_action: str,
        reason: str,
        outcome: str | None = None,
        recommended_action: str | None = None,
    ) -> bool:
        if recommended_action is None:
            for record in reversed(self._records()):
                if record.get("kind") == "decision" and record.get("decision_id") == decision_id:
                    recommended_action = record.get("decision", {}).get("action")
                    break
        return self._append(
            {
                "event_id": f"override:{decision_id}:{human_action}:{reason}",
                "kind": "human-override",
                "timestamp": utc_now(),
                "decision_id": decision_id,
                "recommended_action": recommended_action,
                "human_action": human_action,
                "reason": reason,
                "outcome": outcome,
            }
        )

    def record_outcome(self, decision_id: str, outcome: str, evidence: Iterable[str] = ()) -> bool:
        evidence_list = list(evidence)
        return self._append(
            {
                "event_id": f"outcome:{decision_id}:{outcome}:{','.join(evidence_list)}",
                "kind": "outcome",
                "timestamp": utc_now(),
                "decision_id": decision_id,
                "outcome": outcome,
                "evidence": evidence_list,
            }
        )

    def summary(self) -> dict[str, Any]:
        records = self._records()
        decisions = [item for item in records if item.get("kind") == "decision"]
        overrides = [item for item in records if item.get("kind") == "human-override"]
        outcomes = [item for item in records if item.get("kind") == "outcome"]
        return {
            "path": str(self.path),
            "records": len(records),
            "decisions": len(decisions),
            "overrides": len(overrides),
            "outcomes": len(outcomes),
            "backend_counts": dict(Counter(item.get("decision", {}).get("backend") for item in decisions)),
            "decision_type_counts": dict(Counter(item.get("decision", {}).get("decision_type") for item in decisions)),
            "action_counts": dict(Counter(item.get("decision", {}).get("action") for item in decisions)),
            "override_pairs": dict(
                Counter(
                    f"{item.get('recommended_action')}->{item.get('human_action')}"
                    for item in overrides
                )
            ),
            "outcome_counts": dict(Counter(item.get("outcome") for item in outcomes)),
        }


def now_for_tests() -> str:
    return datetime.now(timezone.utc).isoformat()
