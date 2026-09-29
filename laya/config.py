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
    "model": "VISTACK_LAYA_MODEL",
    "fallback": "VISTACK_LAYA_FALLBACK",
    "host": "VISTACK_LAYA_HOST",
    "host_model": "VISTACK_LAYA_HOST_MODEL",
    "kev_url": "VISTACK_LAYA_KEV_URL",
    "kev_model": "VISTACK_LAYA_KEV_MODEL",
    "jev_model": "VISTACK_LAYA_JEV_MODEL",
    "consult": "VISTACK_LAYA_CONSULT",
}


def state_root() -> str:
    """Claude Code sets ``CLAUDECODE`` in its shells; every other host keeps the Codex root."""

    return ".claude/vistack" if os.environ.get("CLAUDECODE") == "1" else LEGACY_STATE_ROOT


def default_config_path() -> str:
    return f"{state_root()}/laya.json"


def default_history_path() -> str:
    return f"{state_root()}/decision-history.jsonl"


def cache_dir() -> Path:
    """Machine-wide, never per-project: the runtime venv and the Jev refusal record."""

    root = os.environ.get("VISTACK_LAYA_CACHE_DIR")
    if root:
        return Path(root)
    return Path(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")) / "vistack"


def resolve_config_path(path: str | Path | None = None) -> Path:
    """An explicit path wins. Otherwise the host's path, or the Codex-root file written before
    the Claude root existed, so an earlier ``laya off`` keeps holding."""

    if path is not None:
        return Path(path)
    host = Path(default_config_path())
    legacy = Path(LEGACY_STATE_ROOT) / "laya.json"
    return legacy if not host.exists() and legacy.exists() else host


@dataclass(frozen=True)
class Settings:
    enabled: bool = True
    model: str | None = None
    fallback: str | None = None
    host: str | None = None
    host_model: str | None = None
    kev_url: str | None = None
    kev_model: str | None = None
    jev: bool | None = None
    jev_model: str | None = None
    consult: str | None = None
    source: str = "default"


def _env_flag(name: str) -> bool | None:
    value = os.environ.get(name, "").strip().lower()
    if value in TRUE_VALUES:
        return True
    if value in FALSE_VALUES:
        return False
    return None


def _environment_fields() -> dict[str, Any]:
    fields: dict[str, Any] = {name: os.environ.get(variable) or None for name, variable in STRING_FIELDS.items()}
    fields["jev"] = _env_flag("VISTACK_LAYA_JEV")
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
    return Settings(enabled=enabled, source=str(config_path), **fields)


def write_enabled(path: str | Path | None, enabled: bool, **updates: Any) -> Path:
    """Flip the switch, and set any of ``model`` or ``jev`` given, keeping other fields."""

    source = resolve_config_path(path)
    config_path = Path(path) if path is not None else Path(default_config_path())
    config_path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if source.exists():
        value = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError(f"Laya config must be a JSON object: {source}")
        existing = value
    existing.update({key: item for key, item in updates.items() if item is not None})
    existing.update({"schema_version": 1, "enabled": enabled})
    config_path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return config_path
