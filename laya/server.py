"""Long-lived JSONL protocol for low-latency repeated decisions."""

from __future__ import annotations

import json
import sys
from typing import TextIO

from .engine import DecisionEngine
from .schema import DecisionContext


def serve(engine: DecisionEngine, stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> None:
    """Read one request per line and write one response per line.

    The process keeps ``engine`` and its configured local backend alive where possible, so a
    model is loaded or a client is initialized at most once. Malformed requests become
    structured errors and do not terminate the server.
    """

    for line in stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("request must be a JSON object")
            request_id = request.get("id")
            decision_type = request.get("decision_type")
            payload = request.get("context", request)
            if not isinstance(payload, dict):
                raise ValueError("context must be a JSON object")
            decision = engine.decide(payload, decision_type=decision_type, request_id=request_id)
            response = {"id": request_id, "ok": True, "decision": decision.to_dict()}
        except Exception as exc:
            response = {"id": request_id, "ok": False, "error": str(exc)}
        stdout.write(json.dumps(response, sort_keys=True, ensure_ascii=False) + "\n")
        stdout.flush()
