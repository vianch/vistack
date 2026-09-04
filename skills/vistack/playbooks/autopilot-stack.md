# Playbook: autopilot-stack

**The default for a groomed ticket.** Runs intake → plan → parallel implement → PR → QA →
audit → bot-comment cleanup, unattended, and **stops at merge-ready. It never merges.**

Requires a checkable finish condition before step 1. Without one, refuse to start (FENCE 2).

## Steps

1. Confirm the preconditions, all four: a groomed ticket, a checkable finish condition, a
   verification target (QA env recipe or preview), and credentials resolvable at
   `_private/knowledge/key-maker.json`. Any missing → the matching fence, and do not start.
2. Confirm the realm: `git remote -v` shows only `the project organization and its approved repositories`
   (`keep-origins-in-realm`).
3. Run the readiness gate: `review-ticket`. Not ready → dispatch `groomer`,
   then re-gate. Blocked on a product decision → FENCE 2.
4. Dispatch `analyst` read-only for the impact map: call sites, blast radius, existing
   patterns, coverage of the touched paths, with `file:line` refs.
5. Dispatch `planner`: slices ≤500 lines, each independently mergeable, file-level ownership
   per slice, plus the conflict matrix (`slice-plan`).
6. Write `.claude/state/<slug>.json` — every slice with its agent, model, worktree, branch,
   phase — and open `.claude/state/<slug>.tsv`.
7. Upsert the `Engineering work — agent sessions` comment on the parent issue
   (`session-ledger`). One comment, updated in place, never appended to.
8. Create one worktree per parallel slice at `.claude/worktrees/<slug>`. Verify the
   directory count equals the in-flight slice count before dispatching anything.
9. Dispatch the parallel slices: `implementer`, or `design-implementer` where the source is
   Figma. Slices sharing a file wait for their predecessor per the conflict matrix.
10. Each slice: test where a test is the check, then code, then lint and tests green, then
    the diff through `pruning-comments`.
11. A slice that blocks enters `unblock` — 20 attempts, one variable per attempt, early
    abort on three identical results. Other slices keep running.
12. A slice that finishes raises its PR immediately via `pr-author` — draft, one concern,
    ≤500 lines, linked to the issue, reviewer team assigned. Never batch.
13. Over 500 lines → `stack-split` into a parent→child chain before the PR opens.
14. `qa-verifier` runs the QA CONTRACT per PR and posts the results table with screenshots
    embedded (`qa-verify`).
15. `health-check` audits each diff on Haiku: every acceptance criterion satisfied, every QA
    scenario traceable to a diff hunk. Defects route back to the owning slice only.
16. `address-ai-reviews` clears bot comments on every PR.
17. Update the state file and the session comment on **every** transition, not at the end.
18. Report at phase boundaries only. Between them, run — no confirmations, no narration, no
    status questions outside the four fences.
19. Finish condition: every slice merge-ready, or a fence hit. Report the PR set, the
    evidence per PR, the ledger path, and anything left open.
20. Leave every PR a draft. Never merge. Merging is FENCE 3 and belongs to a human.
