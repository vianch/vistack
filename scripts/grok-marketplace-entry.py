#!/usr/bin/env python3
"""Print a SHA-pinned xAI marketplace entry for a published viStack revision."""

from __future__ import annotations

import argparse
import json
import re


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True, help="full 40-character commit SHA published for this plugin")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.sha):
        raise SystemExit("--sha must be a full lowercase 40-character commit SHA")
    print(json.dumps({
        "name": "vistack",
        "description": "Evidence-driven engineering workflows with an optional local typed decision engine.",
        "category": "development",
        "source": {
            "source": "url",
            "url": "https://github.com/vianch/viStack.git",
            "sha": args.sha,
        },
        "homepage": "https://github.com/vianch/viStack",
        "keywords": ["vistack", "engineering workflow", "playbooks", "decision engine", "laya"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
