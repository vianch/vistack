# Playbook: pause-safely

**Match when work must stop and remain resumable.** The pause releases monitors and shared
claims, and leaves no half-written checkpoint.

## Steps

1. Stop dispatching. Let the current atomic operation reach a safe point or back out cleanly.
2. Stop the one monitor and set its state to `stopped`. Record the owner and reason.
3. Cancel nested workers that have not reached a safe point. Do not interrupt a known-broken
   edit without recording it.
4. Commit each worktree's work in progress on its own branch with a clear pause-point
   message. Record the commit and tree status.
5. Push each branch when the run's permissions allow it, so the checkpoint survives machine
   loss. A missing credential is FENCE 4.
6. Open a draft PR for a slice already at merge-ready. Do not create new work.
7. Release shared QA or environment claims through the repository procedure.
8. Write the final state with every phase, branch, SHA, PR, blocker, retry count, and resume
   note. Append one `paused` ledger row per slice.
9. Update the session record or host-local equivalent with the resume command
   `/vistack session-pickup <slug>`.
10. Report done work, paused work, blockers, the state path, the ledger path, and the first
    action on resume. Leave no credential or scratch artifact in a tracked path.
