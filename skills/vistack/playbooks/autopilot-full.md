# Playbook: autopilot-full

**Match when a queue contains independent changes that should be built in parallel.** Each
item gets one owner and one branch. The coordinator keeps the queue, evidence, and topology
safe. The terminal state is merge-ready draft PRs because viStack never merges.

## Steps

1. Frame the queue. State every item, its objective, its finish check, its dependencies,
   its writable files, and the queue's terminal condition. A vague item does not enter the
   queue.
2. Mark operator-owned items. Items the user names for review or manual action stop at
   merge-ready. Record the withheld action in the ledger.
3. Resolve the forge and host once. Use the project's configured PR skill and default forge.
   Record any fallback. Do not require an unconfigured forge or a stacking tool that the
   repository does not provide.
4. Read the principles index, create the state file and ledger, and establish one monitor
   before dispatching owners. Use `make-operations-idempotent` to reconcile existing queue
   entries before adding new ones.
5. Create a standalone brief for each item. Include the goal, file scope, context, one
   acceptance check per line, exact verification commands, timebox, forbidden actions, and
   report shape. Include the standing permissions and escape hatch in every brief.
6. Verify the conflict matrix. Independent items branch from the base branch and run in
   parallel. Items that share a file serialize. Dependent items start from their declared
   parent after the parent reaches its required state.
7. Run the advisor `plan` checkpoint on the queue, briefs, and conflict matrix before
   dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
8. Dispatch one owner per item, starting with one pilot when the pilot rule in
   `skills/coordinate/SKILL.md` applies. The owner builds, tests, lints, commits, and
   reports the branch head. The coordinator remains the only writer of queue topology and
   run state.
9. Drain completions as queue events. Verify the report against the branch and captured
   artifacts. Dispatch the next eligible item immediately. Do not wait for a human between
   reversible phases.
10. Open a draft PR as soon as each owner finishes. Keep one concern per PR and at most 500
    changed lines excluding lockfiles and generated files. Assign the configured reviewers.
11. Dispatch a background `qa-verifier` lane on the PR's own environment to capture
    evidence at every assertion point (`skills/coordinate/SKILL.md`, QA lanes). Once it
    completes, run the health check against the acceptance criteria and diff hunks. A green
    build without behavioral evidence is not merge-ready.
12. When a PR is merge-ready, record its exact head SHA, evidence, and owner. Do not merge,
    arm auto-merge, retarget a branch, or rewrite history. Those are fences.
13. On a failed check, failed QA scenario, review finding, stalled owner, or broken tool,
    route the item to its owner or `unblock`. Other independent items keep running.
14. At each monitor tick, reread this playbook and the state file, inspect every owner and
    PR, and count only side effects as progress. Replace a lane that exceeds its timebox
    without a side effect. Record the replacement and reason.
15. When the router's Final report rule applies, render the run report with
    `skills/html-report/SKILL.md` first so the checkpoint reviews it. Run the advisor `done`
    checkpoint on every merge-ready item and its evidence before calling the run merge-ready
    (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it does not apply.
16. Stop the monitor when every queue item is merge-ready or fenced. Report the queue,
    owner, PR, head SHA, verdict, evidence, open gates, and ledger path. Refresh the run
    report if one was rendered, and give its path or link.

## Finish condition

Every independent item has a merge-ready draft PR with QA and health-check evidence, or its
fence dossier is recorded. viStack does not merge.
