#!/usr/bin/env python3
"""Invoke the optional local decision engine without third-party dependencies."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from laya.runtime import reexec_with_runtime

from laya.cli import main


if __name__ == "__main__":
    # Move to the venv that has laya-mlx, if one is configured, before the engine loads a model.
    reexec_with_runtime([str(Path(__file__).resolve()), *sys.argv[1:]])
    main()
