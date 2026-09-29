"""Read pull-request facts through the gh CLI. The only I/O in the package."""

from __future__ import annotations

import json
import subprocess
from typing import Any, Callable, Sequence

from .policy import Check, Snapshot, Thread


Runner = Callable[[Sequence[str], frozenset[int]], str]

PR_FIELDS = ",".join(
    (
        "number",
        "url",
        "state",
        "isDraft",
        "mergeable",
        "mergeStateStatus",
        "reviewDecision",
        "headRefOid",
        "additions",
        "deletions",
        "reviewRequests",
        "latestReviews",
    )
)
THREADS_QUERY = """query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 1) { nodes { author { login } body path line } }
        }
      }
    }
  }
}"""
# `gh pr checks` exits 1 when a check failed and 8 while checks are pending; both carry JSON.
CHECKS_OK = frozenset({0, 1, 8})
OK = frozenset({0})


class QueryError(RuntimeError):
    """A gh call failed or returned something unreadable. The watcher may retry it."""


def gh(args: Sequence[str], ok: frozenset[int] = OK) -> str:
    completed = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if completed.returncode not in ok:
        detail = completed.stderr.strip() or f"exit {completed.returncode}"
        raise QueryError(f"gh {' '.join(args[:2])}: {detail}")
    return completed.stdout


def _json(text: str, what: str) -> Any:
    if not text.strip():
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise QueryError(f"{what} returned invalid JSON: {exc}") from exc


def resolve_repo(run: Runner = gh) -> str:
    value = run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], OK).strip()
    if "/" not in value:
        raise QueryError(f"could not resolve the repository from the working directory: {value!r}")
    return value


def read_snapshot(number: int, repo: str, run: Runner = gh) -> Snapshot:
    owner, name = repo.split("/", 1)
    pr = _json(run(["pr", "view", str(number), "--repo", repo, "--json", PR_FIELDS], OK), "gh pr view")
    if not isinstance(pr, dict):
        raise QueryError(f"gh pr view returned no data for #{number}")
    checks = _json(
        run(["pr", "checks", str(number), "--repo", repo, "--json", "name,bucket,link"], CHECKS_OK),
        "gh pr checks",
    ) or []
    threads = _json(
        run(
            [
                "api",
                "graphql",
                "-f",
                f"query={THREADS_QUERY}",
                "-F",
                f"owner={owner}",
                "-F",
                f"repo={name}",
                "-F",
                f"number={number}",
            ],
            OK,
        ),
        "gh api graphql",
    )
    try:
        nodes = threads["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"] if threads else []
    except (KeyError, TypeError) as exc:
        raise QueryError(f"review threads response is missing {exc}") from exc
    unresolved = []
    for node in nodes:
        if node.get("isResolved"):
            continue
        comments = (node.get("comments") or {}).get("nodes") or [{}]
        first = comments[0]
        unresolved.append(
            Thread(
                path=str(first.get("path") or ""),
                line=first.get("line"),
                author=str((first.get("author") or {}).get("login") or "unknown"),
                body=str(first.get("body") or "")[:200],
            )
        )
    return Snapshot(
        number=int(pr["number"]),
        url=str(pr.get("url") or ""),
        state=str(pr.get("state") or ""),
        is_draft=bool(pr.get("isDraft")),
        mergeable=str(pr.get("mergeable") or "UNKNOWN"),
        merge_state=str(pr.get("mergeStateStatus") or "UNKNOWN"),
        review_decision=pr.get("reviewDecision") or None,
        head_sha=str(pr.get("headRefOid") or ""),
        changed_lines=int(pr.get("additions") or 0) + int(pr.get("deletions") or 0),
        reviewer_requested=bool(pr.get("reviewRequests") or pr.get("latestReviews")),
        checks=tuple(
            Check(name=str(item.get("name") or ""), bucket=str(item.get("bucket") or ""), link=str(item.get("link") or ""))
            for item in checks
        ),
        unresolved_threads=tuple(unresolved),
    )
