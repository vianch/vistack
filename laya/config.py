"""Default-on local decision-engine settings and the explicit on/off switch."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import os
from typing import Any


LEGACY_STATE_ROOT = ".codex/vistack"
CONFIG_NAME = "decisions.json"
# The switch file's name before 0.23.0: read while no decisions.json exists beside it, and
# removed when the switch is next written.
LEGACY_CONFIG_NAME = "laya.json"
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
BOOLEAN_FIELDS = {"jev": "VISTACK_LAYA_JEV", "cloudflare": "VISTACK_LAYA_CLOUDFLARE"}
KNOWN_FIELDS = frozenset({*STRING_FIELDS, *BOOLEAN_FIELDS, "enabled", "schema_version"})
ENV_PREFIX = "VISTACK_LAYA_"
KNOWN_ENV = frozenset(
    {
        *STRING_FIELDS.values(),
        *BOOLEAN_FIELDS.values(),
        "VISTACK_LAYA_CACHE_DIR",
        "VISTACK_LAYA_CLOUDFLARE_DAILY_NEURONS",
        "VISTACK_LAYA_CLOUDFLARE_TIMEOUT_MS",
        "VISTACK_LAYA_ENABLED",
        "VISTACK_LAYA_OLLAMA_MIN_CONFIDENCE",
        "VISTACK_LAYA_OLLAMA_TIMEOUT_MS",
    }
)


def state_root() -> str:
    """Claude Code sets ``CLAUDECODE`` in its shells; every other host keeps the Codex root."""

    return ".claude/vistack" if os.environ.get("CLAUDECODE") == "1" else LEGACY_STATE_ROOT


def default_config_path() -> str:
    return f"{state_root()}/{CONFIG_NAME}"


def default_history_path() -> str:
    return f"{state_root()}/decision-history.jsonl"


def cache_dir() -> Path:
    """Machine-wide, never per-project: the Jev refusal record and the Cloudflare Neuron ledger."""

    root = os.environ.get("VISTACK_LAYA_CACHE_DIR")
    if root:
        return Path(root)
    return Path(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")) / "vistack"


def _earlier_name(path: Path) -> Path | None:
    """The same switch under its pre-0.23.0 name, when only that file exists."""

    legacy = path.with_name(LEGACY_CONFIG_NAME)
    return legacy if path.name == CONFIG_NAME and not path.exists() and legacy.exists() else None


def resolve_config_path(path: str | Path | None = None) -> Path:
    """An explicit path wins. Otherwise the host's path, or the Codex-root file written before
    the Claude root existed, so an earlier ``decisions off`` keeps holding. Each is also found
    under its earlier name, ``laya.json``."""

    if path is not None:
        explicit = Path(path)
        return _earlier_name(explicit) or explicit
    host = Path(default_config_path())
    for candidate in (host, Path(LEGACY_STATE_ROOT) / CONFIG_NAME):
        found = candidate if candidate.exists() else _earlier_name(candidate)
        if found is not None:
            return found
    return host


@dataclass(frozen=True)
class Settings:
    enabled: bool = True
    fallback: str | None = None
    jev: bool | None = None
    jev_model: str | None = None
    cloudflare: bool | None = None
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
    fields.update({name: _env_flag(variable) for name, variable in BOOLEAN_FIELDS.items()})
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
    for name in BOOLEAN_FIELDS:
        field_value = value.get(name, fields[name])
        if field_value is not None and not isinstance(field_value, bool):
            raise ValueError(f"Laya config {name} must be boolean: {config_path}")
        fields[name] = field_value
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
    if source.name == LEGACY_CONFIG_NAME and source != config_path and source.parent == config_path.parent:
        source.unlink(missing_ok=True)
    return config_path
