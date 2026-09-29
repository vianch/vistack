"""Pure classification of pull-request state. No process, network, or clock access."""

from __future__ import annotations

from dataclasses import dataclass


EXIT_READY = 0
EXIT_CONFLICTS = 2
EXIT_REVIEW_THREADS = 3
EXIT_FAILING_CHECKS = 4
EXIT_TIMEOUT = 5
EXIT_MERGE_GATE = 6
EXIT_QUERY_FAILURE = 7
EXIT_NO_REVIEWER = 8
EXIT_USAGE = 64

MAX_CHANGED_LINES = 500
FAILING_BUCKETS = frozenset({"fail", "cancel"})
PENDING_BUCKETS = frozenset({"pending"})
CONFLICT_STATES = frozenset({"CONFLICTING", "DIRTY"})


@dataclass(frozen=True)
class Check:
    name: str
    bucket: str
    link: str = ""


@dataclass(frozen=True)
class Thread:
    path: str
    line: int | None
    author: str
    body: str


@dataclass(frozen=True)
class Snapshot:
    number: int
    url: str
    state: str
    is_draft: bool
    mergeable: str
    merge_state: str
    review_decision: str | None
    head_sha: str
    changed_lines: int
    reviewer_requested: bool
    checks: tuple[Check, ...] = ()
    unresolved_threads: tuple[Thread, ...] = ()


@dataclass(frozen=True)
class Verdict:
    number: int
    kind: str
    reason: str
    exit_code: int
    head_sha: str = ""
    details: tuple[str, ...] = ()

    @property
    def terminal(self) -> bool:
        return self.kind != "waiting"


def classify(snapshot: Snapshot) -> Verdict:
    """Return the one verdict a babysit pass acts on. Blockers win over waiting.

    viStack PRs stay drafts, so a draft is never a blocker: merge-ready means a clean draft
    with green checks, no unresolved threads, and a reviewer on it.
    """

    def verdict(kind: str, reason: str, exit_code: int, details: tuple[str, ...] = ()) -> Verdict:
        notes = details
        if snapshot.changed_lines > MAX_CHANGED_LINES:
            notes = (*details, f"oversized: {snapshot.changed_lines} changed lines")
        return Verdict(snapshot.number, kind, reason, exit_code, snapshot.head_sha, notes)

    if snapshot.state == "MERGED":
        return verdict("merged", "merged by a person", EXIT_READY)
    if snapshot.state == "CLOSED":
        return verdict("blocked", "closed without merge", EXIT_MERGE_GATE)
    if snapshot.mergeable in CONFLICT_STATES or snapshot.merge_state in CONFLICT_STATES:
        return verdict("blocked", "merge conflicts with the base branch", EXIT_CONFLICTS)
    if snapshot.review_decision == "CHANGES_REQUESTED":
        return verdict("blocked", "changes requested", EXIT_MERGE_GATE)
    failing = tuple(
        f"{check.name}: {check.link}" if check.link else check.name
        for check in snapshot.checks
        if check.bucket in FAILING_BUCKETS
    )
    if failing:
        return verdict("blocked", "failing checks", EXIT_FAILING_CHECKS, failing)
    if snapshot.unresolved_threads:
        threads = tuple(
            f"{thread.path}:{thread.line if thread.line is not None else '-'} {thread.author}"
            for thread in snapshot.unresolved_threads
        )
        return verdict("blocked", "unresolved review threads", EXIT_REVIEW_THREADS, threads)
    pending = tuple(check.name for check in snapshot.checks if check.bucket in PENDING_BUCKETS)
    if pending or snapshot.mergeable == "UNKNOWN":
        return verdict("waiting", "checks or mergeability still computing", EXIT_READY, pending)
    if not snapshot.reviewer_requested:
        return verdict("blocked", "no reviewer requested", EXIT_NO_REVIEWER)
    return verdict("merge-ready", "clean draft with green checks and a reviewer", EXIT_READY)


def combine(verdicts: list[Verdict]) -> Verdict:
    """Fold a PR set into one verdict: the first blocker, else waiting, else merge-ready."""

    if not verdicts:
        raise ValueError("combine needs at least one verdict")
    for item in verdicts:
        if item.kind == "blocked":
            return item
    waiting = [item for item in verdicts if item.kind == "waiting"]
    if waiting:
        return Verdict(0, "waiting", f"{len(waiting)} of {len(verdicts)} still computing", EXIT_READY)
    return Verdict(0, "merge-ready", f"all {len(verdicts)} merge-ready or merged", EXIT_READY)
