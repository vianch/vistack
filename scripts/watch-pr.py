#!/usr/bin/env python3
"""Watch one PR or a PR set for the babysit pass without third-party dependencies."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from prwatch.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
