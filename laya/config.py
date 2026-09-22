"""Default-on local decision-engine settings and the explicit on/off switch."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import os
from typing import Any


DEFAULT_CONFIG_PATH = ".codex/vistack/laya.json"
FALSE_VALUES = {"0", "false", "off", "no", "disabled"}


@dataclass(frozen=True)
class Settings:
    enabled: bool = True
    model: str | None = None
    fallback: str | None = None
    host: str | None = None
    host_model: str | None = None
    kev_url: str | None = None
    kev_model: str | None = None
    source: str = "default"


def read_settings(path: str | Path = DEFAULT_CONFIG_PATH) -> Settings:
    """Read project settings. A missing file means enabled by default."""

    env_value = os.environ.get("VISTACK_LAYA_ENABLED")
    if env_value is not None and env_value.strip().lower() in FALSE_VALUES:
        return Settings(
            enabled=False,
            model=os.environ.get("VISTACK_LAYA_MODEL"),
            fallback=os.environ.get("VISTACK_LAYA_FALLBACK"),
            host=os.environ.get("VISTACK_LAYA_HOST"),
            host_model=os.environ.get("VISTACK_LAYA_HOST_MODEL"),
            kev_url=os.environ.get("VISTACK_LAYA_KEV_URL"),
            kev_model=os.environ.get("VISTACK_LAYA_KEV_MODEL"),
            source="environment",
        )
    config_path = Path(path)
    if not config_path.exists():
        return Settings(
            enabled=True,
            model=os.environ.get("VISTACK_LAYA_MODEL"),
            fallback=os.environ.get("VISTACK_LAYA_FALLBACK"),
            host=os.environ.get("VISTACK_LAYA_HOST"),
            host_model=os.environ.get("VISTACK_LAYA_HOST_MODEL"),
            kev_url=os.environ.get("VISTACK_LAYA_KEV_URL"),
            kev_model=os.environ.get("VISTACK_LAYA_KEV_MODEL"),
            source="default",
        )
    value: Any = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Laya config must be a JSON object: {config_path}")
    enabled = value.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError(f"Laya config enabled must be boolean: {config_path}")
    model = value.get("model", os.environ.get("VISTACK_LAYA_MODEL"))
    if model is not None and not isinstance(model, str):
        raise ValueError(f"Laya config model must be a string: {config_path}")
    string_fields = {
        "fallback": value.get("fallback", os.environ.get("VISTACK_LAYA_FALLBACK")),
        "host": value.get("host", os.environ.get("VISTACK_LAYA_HOST")),
        "host_model": value.get("host_model", os.environ.get("VISTACK_LAYA_HOST_MODEL")),
        "kev_url": value.get("kev_url", os.environ.get("VISTACK_LAYA_KEV_URL")),
        "kev_model": value.get("kev_model", os.environ.get("VISTACK_LAYA_KEV_MODEL")),
    }
    for name, field_value in string_fields.items():
        if field_value is not None and not isinstance(field_value, str):
            raise ValueError(f"Laya config {name} must be a string: {config_path}")
    return Settings(enabled=enabled, model=model, source=str(config_path), **string_fields)


def write_enabled(path: str | Path, enabled: bool) -> Path:
    config_path = Path(path)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if config_path.exists():
        value = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError(f"Laya config must be a JSON object: {config_path}")
        existing = value
    existing.update({"schema_version": 1, "enabled": enabled})
    config_path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return config_path
