# Playbook: pause-safely

**Match when** the run must stop now and stay resumable. It holds nothing: no lock, no
claimed environment, no half-written state file.

## Steps

1. Stop dispatching. Do not start a phase, a slice, or an attempt that is not already
   running.
2. Cancel the coordinator's `/loop 10m /vistack babysit <slug>` monitor and set
   `monitor.status` to `stopped`.
3. Let each in-flight slice reach its next safe point: a passing test run, or a committed
   working tree. Do not interrupt mid-edit.
4. Commit every worktree's work-in-progress on its own branch, with a message that says it
   is a pause point. Nothing uncommitted survives a pause.
5. Push each branch so the work exists off this machine.
6. Raise a draft PR for any slice already at merge-ready. A finished slice is not left
   unpublished by a pause.
7. Release everything shared: shared QA resources via `the project QA environment procedure`, and
   any other environment claim recorded in the state file.
8. Write the final state file: every slice's phase, branch, commit sha, PR, blockers, and
   retry count. This is the resume point and it must be accurate.
9. Append the closing ledger rows — one per slice, `decision: paused`, with the reason.
10. Update the `Engineering work — agent sessions` comment with the final phases and the resume line
   `claude attach <coordinator-session-id>`.
11. Report: what is done, what is in flight and where it stopped, what is blocked, and the
    exact command to resume — `/vistack session-pickup <slug>`.
12. Leave no screenshot, credential, or scratch file in a tracked path.
