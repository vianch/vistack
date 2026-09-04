# Playbook: overnight

**Match when the user is stepping away and wants a run to continue.** This is the viStack
version of an autonomous run. It drives one task or a clearly bounded queue to
merge-ready drafts, records every decision, and stops at a real fence or the finish
predicate. It never merges.

## Steps

1. State the objective, the checkable finish predicate, the behavior that must not change,
   the permissions granted, and the permissions withheld.
2. State the escape hatch. A genuine blocker goes through `unblock`; an unresolved blocker,
   acceptance ambiguity, irreversible action, or credential problem returns control to the
   user with its dossier.
3. Resolve the host, `<state-root>`, `<worktree-root>`, and one wake mechanism. Claude Code
   uses `/loop 10m /vistack babysit <slug>`. Codex uses its recurring-task or background
   equivalent when available. If no wake mechanism can survive the session, record that
   limitation before starting.
4. Read `skills/vistack/principles/index.md` and the matched execution contract. Record the
   playbook match and the overnight permissions in the ledger.
5. Create or reconcile `<state-root>/<slug>.json` and `<state-root>/<slug>.tsv`. Record the
   objective, finish predicate, unchanged behavior, host, wake mechanism, escape hatch,
   current phase, and last progress time before dispatching work.
6. Establish exactly one live monitor. Verify its owner and wake mechanism. A persisted
   active flag is not proof that a monitor is running.
7. Create one worktree per slice and dispatch only slices allowed by the conflict matrix.
   Every owner receives a complete brief with scope, checks, timebox, forbidden actions,
   and report shape.
8. At every iteration, check the finish predicate, make the smallest evidence-backed
   change, verify against the real artifact, and record one ledger row. Commit only when
   the predicate moved. Discard a change that did not help.
9. Drain completions without waiting for a human. Route side fixes, review noise, tooling
   failures, and broken skill contracts through the appropriate playbook. Keep unrelated
   fixes in their own branch or PR and return to the original predicate.
10. Treat a lane with no commit, captured artifact, check delta, or report within its
    expected runtime as stalled. Run `unblock` with a distinct hypothesis, or replace the
    lane after its retry limit. Do not repeat an identical attempt.
11. Reconcile state before every resume or monitor pass. If state, branches, worktrees,
    PRs, comments, or live owners disagree, record each divergence before taking action.
12. Raise each finished slice as a draft PR immediately. Keep each PR to one concern and
    at most 500 changed lines excluding lockfiles and generated files. Run QA and the
    adversarial health check before calling it merge-ready.
13. Keep the finish predicate fixed. A plateau changes the approach, not the target. Stop
    only when the predicate is met or a fence is reached.
14. Stop the monitor and record the terminal state. For a fence, include the full dossier.
    For success, include the PRs, evidence, discarded attempts, and the final predicate
    result.
15. Run the morning audit from the ledger. Check that every row maps to a real action, every
    evidence pointer resolves, and every important pivot or abandoned approach is recorded.

## Finish condition

Every required slice is merge-ready, or a fence has been recorded. Every PR remains a
draft. No merge, deployment, data deletion, secret change, or other irreversible action is
performed by this playbook.
