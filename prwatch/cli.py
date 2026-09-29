"""Watch one PR or a PR set until it is merge-ready, blocked, merged, or the watch times out.

Output is NDJSON: one line when the combined verdict changes, and a final `verdict` line. The
process exit code is the final verdict's exit code, so a host can wake on process exit.
The watcher never writes to GitHub and never merges.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import sys
import time
from typing import Callable, TextIO

from .github import QueryError, read_snapshot, resolve_repo
from .policy import (
    EXIT_QUERY_FAILURE,
    EXIT_TIMEOUT,
    EXIT_USAGE,
    Snapshot,
    Verdict,
    classify,
    combine,
)


BACKOFF_CAP_S = 300


def backoff(interval: int, failures: int) -> int:
    """Seconds to wait after the nth consecutive query failure."""
    return min(max(interval, 60) * 2 ** (failures - 1), BACKOFF_CAP_S)


def _pr_numbers(value: str) -> list[int]:
    numbers = []
    for part in value.split(","):
        text = part.strip().lstrip("#")
        if not text.isdigit():
            raise argparse.ArgumentTypeError(f"not a PR number: {part!r}")
        numbers.append(int(text))
    return numbers


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(EXIT_USAGE, f"watch-pr: {message}\n")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="watch-pr", description=__doc__.splitlines()[0])
    parser.add_argument("--pr", required=True, type=_pr_numbers, help="PR number or comma-separated set, e.g. 12,#13")
    parser.add_argument("--repo", help="owner/name; defaults to the working directory's repository")
    parser.add_argument("--interval", type=int, default=60, help="seconds between polls")
    parser.add_argument("--timeout", type=int, default=0, help="overall deadline in seconds; 0 disables it")
    parser.add_argument("--max-query-errors", type=int, default=5, help="consecutive query failures before exit 7")
    parser.add_argument("--status-only", action="store_true", help="read once, print, and exit 0")
    return parser


def _emit(out: TextIO, event: str, overall: Verdict, verdicts: list[Verdict]) -> None:
    record = {"event": event, "overall": asdict(overall), "prs": [asdict(item) for item in verdicts]}
    out.write(json.dumps(record, sort_keys=True) + "\n")
    out.flush()


def main(
    argv: list[str] | None = None,
    *,
    read: Callable[[int], Snapshot] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    out: TextIO = sys.stdout,
) -> int:
    args = _parser().parse_args(argv)
    if read is None:
        try:
            repo = args.repo or resolve_repo()
        except QueryError as exc:
            out.write(json.dumps({"event": "query-error", "error": str(exc)}) + "\n")
            return EXIT_QUERY_FAILURE

        def read(number: int) -> Snapshot:
            return read_snapshot(number, repo)

    started = clock()
    failures = 0
    last_seen: tuple[str, str] | None = None
    while True:
        try:
            verdicts = [classify(read(number)) for number in args.pr]
        except QueryError as exc:
            failures += 1
            out.write(json.dumps({"event": "query-error", "error": str(exc), "failures": failures}) + "\n")
            if failures >= args.max_query_errors:
                return EXIT_QUERY_FAILURE
            sleep(backoff(args.interval, failures))
            continue
        failures = 0
        overall = combine(verdicts)
        if args.status_only:
            _emit(out, "verdict", overall, verdicts)
            return 0
        if overall.terminal:
            _emit(out, "verdict", overall, verdicts)
            return overall.exit_code
        seen = (overall.kind, overall.reason)
        if seen != last_seen:
            _emit(out, "progress", overall, verdicts)
            last_seen = seen
        if args.timeout and clock() - started >= args.timeout:
            timed_out = Verdict(0, "timeout", f"no terminal verdict within {args.timeout}s", EXIT_TIMEOUT)
            _emit(out, "verdict", timed_out, verdicts)
            return EXIT_TIMEOUT
        sleep(args.interval)
