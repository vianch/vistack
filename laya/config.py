"""Default-on local decision-engine settings and the explicit on/off switch."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import os
from typing import Any


LEGACY_STATE_ROOT = ".codex/vistack"
FALSE_VALUES = {"0", "false", "off", "no", "disabled"}
TRUE_VALUES = {"1", "true", "on", "yes", "enabled"}
STRING_FIELDS = {
    "fallback": "VISTACK_LAYA_FALLBACK",
    "jev_model": "VISTACK_LAYA_JEV_MODEL",
    "ollama_model": "VISTACK_LAYA_OLLAMA_MODEL",
    "ollama_url": "VISTACK_LAYA_OLLAMA_URL",
    "ollama_keep_alive": "VISTACK_LAYA_OLLAMA_KEEP_ALIVE",
    "consult": "VISTACK_LAYA_CONSULT",
}
# Every switch-file key and every VISTACK_LAYA_ variable the package reads. Anything else is
# left over from a removed tier: it is ignored, reported by ``decisions status``, and dropped
# when the switch file is rewritten.
KNOWN_FIELDS = frozenset({*STRING_FIELDS, "enabled", "jev", "schema_version"})
ENV_PREFIX = "VISTACK_LAYA_"
KNOWN_ENV = frozenset(
    {
        *STRING_FIELDS.values(),
        "VISTACK_LAYA_CACHE_DIR",
        "VISTACK_LAYA_ENABLED",
        "VISTACK_LAYA_JEV",
        "VISTACK_LAYA_OLLAMA_MIN_CONFIDENCE",
        "VISTACK_LAYA_OLLAMA_TIMEOUT_MS",
    }
)


def state_root() -> str:
    """Claude Code sets ``CLAUDECODE`` in its shells; every other host keeps the Codex root."""

    return ".claude/vistack" if os.environ.get("CLAUDECODE") == "1" else LEGACY_STATE_ROOT


def default_config_path() -> str:
    return f"{state_root()}/laya.json"


def default_history_path() -> str:
    return f"{state_root()}/decision-history.jsonl"


def cache_dir() -> Path:
    """Machine-wide, never per-project: the Jev refusal record."""

    root = os.environ.get("VISTACK_LAYA_CACHE_DIR")
    if root:
        return Path(root)
    return Path(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")) / "vistack"


def resolve_config_path(path: str | Path | None = None) -> Path:
    """An explicit path wins. Otherwise the host's path, or the Codex-root file written before
    the Claude root existed, so an earlier ``decisions off`` keeps holding."""

    if path is not None:
        return Path(path)
    host = Path(default_config_path())
    legacy = Path(LEGACY_STATE_ROOT) / "laya.json"
    return legacy if not host.exists() and legacy.exists() else host


@dataclass(frozen=True)
class Settings:
    enabled: bool = True
    fallback: str | None = None
    jev: bool | None = None
    jev_model: str | None = None
    # ``none`` is kept as written: it is how a project turns off a model the environment names.
    ollama_model: str | None = None
    ollama_url: str | None = None
    ollama_keep_alive: str | None = None
    consult: str | None = None
    source: str = "default"
    obsolete_fields: tuple[str, ...] = ()
    obsolete_env: tuple[str, ...] = ()


def _env_flag(name: str) -> bool | None:
    value = os.environ.get(name, "").strip().lower()
    if value in TRUE_VALUES:
        return True
    if value in FALSE_VALUES:
        return False
    return None


def obsolete_env() -> tuple[str, ...]:
    return tuple(sorted(name for name, value in os.environ.items() if name.startswith(ENV_PREFIX) and name not in KNOWN_ENV and value.strip()))


def _environment_fields() -> dict[str, Any]:
    fields: dict[str, Any] = {name: os.environ.get(variable) or None for name, variable in STRING_FIELDS.items()}
    fields["jev"] = _env_flag("VISTACK_LAYA_JEV")
    fields["obsolete_env"] = obsolete_env()
    return fields


def read_settings(path: str | Path | None = None) -> Settings:
    """Read project settings over the environment. A missing file means enabled by default."""

    fields = _environment_fields()
    env_value = os.environ.get("VISTACK_LAYA_ENABLED")
    if env_value is not None and env_value.strip().lower() in FALSE_VALUES:
        return Settings(enabled=False, source="environment", **fields)
    config_path = resolve_config_path(path)
    if not config_path.exists():
        return Settings(enabled=True, source="default", **fields)
    value: Any = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Laya config must be a JSON object: {config_path}")
    enabled = value.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError(f"Laya config enabled must be boolean: {config_path}")
    for name in STRING_FIELDS:
        field_value = value.get(name, fields[name])
        if field_value is not None and not isinstance(field_value, str):
            raise ValueError(f"Laya config {name} must be a string: {config_path}")
        fields[name] = field_value
    jev = value.get("jev", fields["jev"])
    if jev is not None and not isinstance(jev, bool):
        raise ValueError(f"Laya config jev must be boolean: {config_path}")
    fields["jev"] = jev
    fields["obsolete_fields"] = tuple(sorted(key for key in value if key not in KNOWN_FIELDS))
    return Settings(enabled=enabled, source=str(config_path), **fields)


def write_enabled(path: str | Path | None, enabled: bool, **updates: Any) -> Path:
    """Flip the switch, and set any setting given, keeping the other known fields."""

    unknown = sorted(set(updates) - KNOWN_FIELDS)
    if unknown:
        raise ValueError(f"unknown Laya setting: {', '.join(unknown)}")
    source = resolve_config_path(path)
    config_path = Path(path) if path is not None else Path(default_config_path())
    config_path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if source.exists():
        value = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError(f"Laya config must be a JSON object: {source}")
        existing = {key: item for key, item in value.items() if key in KNOWN_FIELDS}
    existing.update({key: item for key, item in updates.items() if item is not None})
    existing.update({"schema_version": 1, "enabled": enabled})
    config_path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return config_path
