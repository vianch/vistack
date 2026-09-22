"""Explicit, read-only host-CLI fallback for Claude Code and Codex.

This backend is intentionally opt-in. It asks the current host's CLI for typed
answers, never gives that CLI write access, and rejects anything that is not a
valid answer to the existing question schema. The normal fallback remains the
deterministic viStack policy.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Mapping

from .mlx_backend import LayaUnavailable


HOSTS = {"claude", "codex"}


def _json_candidates(value: str) -> list[Any]:
    candidates: list[Any] = []
    stripped = value.strip()
    if not stripped:
        return candidates
    for text in (stripped, stripped.removeprefix("```").removesuffix("```").strip()):
        try:
            candidates.append(json.loads(text))
        except json.JSONDecodeError:
            pass
    for line in stripped.splitlines():
        try:
            candidates.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return candidates


def _extract_answers(stdout: str) -> dict[str, Any]:
    """Extract the typed answer object from Claude JSON or Codex JSONL."""

    pending: list[Any] = _json_candidates(stdout)
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            answers = value.get("answers")
            if isinstance(answers, dict):
                return {"answers": answers, "usage": value.get("usage", {})}
            for key in ("result", "text", "message", "content", "output", "finalResponse"):
                child = value.get(key)
                if isinstance(child, str):
                    pending.extend(_json_candidates(child))
                elif isinstance(child, (dict, list)):
                    pending.append(child)
            item = value.get("item")
            if isinstance(item, dict):
                pending.append(item)
        elif isinstance(value, list):
            pending.extend(value)
    raise LayaUnavailable("host LLM did not return a typed answers object")


def _validate_answers(result: dict[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    answers = result["answers"]
    sanitized: dict[str, Any] = {}
    for name, question in questions.items():
        answer = answers.get(name)
        if not isinstance(answer, Mapping):
            continue
        kind = question.get("type")
        if kind == "choice":
            choice = answer.get("choice")
            criteria = question.get("criteria", {})
            if not isinstance(choice, str) or not isinstance(criteria, Mapping) or choice not in criteria:
                continue
            value: dict[str, Any] = {"type": "choice", "choice": choice}
            try:
                value["confidence"] = max(0.0, min(1.0, float(answer.get("confidence", 0.0))))
            except (TypeError, ValueError):
                value["confidence"] = 0.0
            probabilities = answer.get("probabilities")
            if isinstance(probabilities, Mapping):
                value["probabilities"] = {
                    str(key): max(0.0, min(1.0, float(probability)))
                    for key, probability in probabilities.items()
                    if isinstance(key, str) and _is_number(probability)
                }
            sanitized[name] = value
        elif kind == "noul":
            value = answer.get("noul")
            if isinstance(value, bool):
                value = 1.0 if value else 0.0
            if _is_number(value):
                sanitized[name] = {"type": "noul", "noul": max(0.0, min(1.0, float(value)))}
    if not sanitized:
        raise LayaUnavailable("host LLM returned no valid typed answers")
    return {"answers": sanitized, "usage": result.get("usage", {})}


def _is_number(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


class HostLLMBackend:
    """Use a host's authenticated CLI as a bounded, read-only decision refiner."""

    name = "host-llm"

    def __init__(
        self,
        host: str,
        *,
        model: str | None = None,
        effort: str = "low",
        timeout_ms: int = 5000,
        workdir: str | None = None,
        max_budget_usd: str = "0.10",
    ) -> None:
        if host not in HOSTS:
            raise ValueError(f"host must be one of: {', '.join(sorted(HOSTS))}")
        self.host = host
        self.model = model or ("claude-haiku-4-5-20251001" if host == "claude" else "gpt-5.4-mini")
        self.effort = effort
        self.timeout_ms = timeout_ms
        self.workdir = workdir
        self.max_budget_usd = max_budget_usd

    def _command(self, prompt: str) -> list[str]:
        if self.host == "claude":
            binary = os.environ.get("VISTACK_LAYA_CLAUDE_BIN", "claude")
            return [
                binary,
                "-p",
                "--bare",
                "--output-format",
                "json",
                "--model",
                self.model,
                "--effort",
                self.effort,
                "--permission-mode",
                "plan",
                "--permission-prompts",
                "none",
                "--no-session-persistence",
                "--max-turns",
                "1",
                "--max-budget-usd",
                self.max_budget_usd,
                prompt,
            ]
        binary = os.environ.get("VISTACK_LAYA_CODEX_BIN", "codex")
        return [
            binary,
            "exec",
            "--json",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--model",
            self.model,
            "-c",
            'model_reasoning_effort="low"',
            prompt,
        ]

    def predict(self, state: Mapping[str, Any], questions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        if shutil.which(self._command("")[0]) is None and not os.path.isabs(self._command("")[0]):
            raise LayaUnavailable(f"{self.host} CLI is not installed")
        prompt = json.dumps(
            {
                "task": "Answer the typed viStack decision questions only.",
                "rules": [
                    "Do not edit files, run commands, call tools, or claim that work was performed.",
                    "Return one JSON object with an answers object and no markdown.",
                    "For choice questions use {type, choice, confidence, probabilities}.",
                    "For noul questions use {type, noul} where noul is a probability from 0 to 1.",
                    "Use only options present in each question's criteria.",
                ],
                "state": dict(state),
                "questions": dict(questions),
            },
            ensure_ascii=False,
        )
        try:
            completed = subprocess.run(
                self._command(prompt),
                cwd=self.workdir,
                capture_output=True,
                text=True,
                timeout=max(self.timeout_ms, 1) / 1000.0,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise LayaUnavailable(f"{self.host} host fallback failed: {exc}") from exc
        if completed.returncode != 0:
            detail = completed.stderr.strip() or f"exit code {completed.returncode}"
            raise LayaUnavailable(f"{self.host} host fallback failed: {detail[:300]}")
        return _validate_answers(_extract_answers(completed.stdout), questions)
