# Playbook: crash-hunt

**Match when the real app should be sent random and malformed HTTP requests until it crashes, and one new crash fixed.**
A request to fix one named crash is `bug-fix`. The hard limits, config, gate, and driver are in
`skills/crash-hunt/SKILL.md`; crash kinds, signatures, and validity are in
`skills/crash-hunt/references/crash.md`. Every exit path reaches step 18, and no exit leaves the
app or the disposable database running.

## Steps

1. Load `.claude/vistack/crash-hunt.json` from the consuming repository and check every field
   the Config table in `skills/crash-hunt/SKILL.md` marks required. A missing file or field
   goes to step 18, naming it, and nothing is booted. Record the result in the ledger.
2. Read the consuming repository's `CLAUDE.md` and every file the config's `rules` names, and
   record each path read in the ledger. Their conventions win over this playbook, except the
   hard limits in `skills/crash-hunt/SKILL.md`.
3. List the open PRs on `claude/*` branches and the `claude/*` PRs closed unmerged in the last
   30 days, and record their `claude/crash-<slug>` branches; a crash whose slug matches one is
   not new (`skills/crash-hunt/references/crash.md`, When a crash is new). Read
   `<state-root>/crash-hunt/known.jsonl` for each signature's first seen, last seen, and picked
   state. It is history and excludes nothing.
4. Create a detached worktree at the base branch head, `<worktree-root>/crash-hunt-<run-id>`,
   and record it as the hunt's slice under the worktree count rule
   (`skills/coordinate/SKILL.md`, Dispatch rules). Dispatch `crash-hunter`
   (`agents/crash-hunter.md`) to run the pre-boot gate in `skills/crash-hunt/SKILL.md` from that
   worktree. It passes when the resolved datasource and every outbound host of the active
   profile pass `check-target`, and the port is free or its listener matches a crash-hunt boot
   record and is stopped. A leftover database that an earlier run's boot record names is then
   dropped. Any failure goes to step 18 with the offending value, and the app is never booted.
5. `crash-hunter` creates the disposable local database and writes its identifier and the run
   id to `<state-root>/crash-hunt/<run-id>/boot.json` before booting. It builds and boots the
   app in the hunt worktree, never in the operator's checkout, waits for `healthPath`, and adds
   PID, command line, port, and commit to `boot.json`. A boot failure drops the database and
   goes to step 18 with the log tail.
6. `crash-hunter` writes the routes file from the config's `routes` source and runs the driver
   `run` within the config's budget, which sends a control request per route first. Record the
   summary path, seed, requests sent, each route's control status, and the skipped routes in
   the ledger. When `auth.headerCommand` is set the driver runs with `--auth-required`, and a
   `stopped` of `auth-rejected` means every control answered 401 or 403 and the local auth setup
   is broken. That, or any other driver exit 2, tears down the app and database and goes to step
   18 with the finding and the summary.
7. `crash-hunter` triages each line of `crashes.jsonl` against the app log, drops the
   harness-induced crashes, and proves each remaining crash with `replay` on a fresh boot of
   the same commit (`skills/crash-hunt/references/crash.md`, Validity). It returns one dossier
   per proven crash, with its signature and slug, and the dropped crashes with the rule each
   failed. It then stops the app, drops the database, and confirms the port is free.
8. `crash-hunter` appends one row per proven crash to `<state-root>/crash-hunt/known.jsonl`,
   with its first seen, last seen, and picked state. Keep the crashes that are new by
   `skills/crash-hunt/references/crash.md`, When a crash is new, which means no open or recently
   closed PR on its slug. A crash already picked that reproduces again is a regression and stays.
   None new goes to step 18.
9. Dispatch `analyst` to score each new crash with `skills/maintenance/references/risk-rubric.md`
   in its return shape, citing the crash's app log line as its recorded failure and its replay
   as its proof. At an equal score process-exit ranks above server-error, and server-error above
   hang; then the older first seen ranks first, and a remaining tie follows the rubric. Pick the
   top row, and record the pick, its score, and why in the ledger.
10. Dispatch `analyst` with the dossier to trace the root cause to `file:line` and list every
    other caller of the faulty code. A trace that ends in the harness or a blocked outbound
    call instead of repository code drops the crash as harness-induced; return to step 9 with
    the next one, or go to step 18 when none is left.
11. Run the advisor `plan` checkpoint on the root cause, the blast radius, and the fix scope
    before dispatch (`skills/advisor/SKILL.md`).
12. Dispatch the tier owner (`skills/coordinate/SKILL.md`, Dispatch rules) in one worktree on
    `claude/crash-<signature-slug>`. It reads the rules that apply to the files it touches,
    writes a regression test that drives the real app against a real database with no mock of
    the code under test, and watches it fail for the crash's reason. It fixes the cause, runs
    the suite in the order of `skills/prove-it-works/SKILL.md`, runs lint, and passes the diff
    through `skills/pruning-comments/SKILL.md`. A slice still blocked after `unblock` goes to
    step 18 with its dossier.
13. `crash-hunter` proves the fix on a fresh boot from the fix slice's worktree, with PID and
    commit recorded and no base-branch instance on the port. The proof holds when `replay`
    exits 0, the response follows the config's `errorContract`, and a same-seed `run` of only that
    route finds no new crash, and only then does it append the crash's `picked` row to the known
    list. Whether or not the proof holds, it then stops the app, drops the database, and
    confirms the port is free. A failed proof returns the slice to step 12 with the replay
    output.
14. Dispatch `pr-author` to open one draft PR from `claude/crash-<signature-slug>` with the
    crashing request and the stack excerpt, both redacted, the root cause at `file:line`, the
    regression test's failing-then-passing output, the replay before and after, and the proof
    commit. The text follows the External naming boundary in
    `skills/vistack/principles/index.md`.
15. Run `health-check` (`agents/health-check.md`) to confirm the regression test fails when the
    fix is absent. Route a defect back to the slice owner and return to step 13.
16. Render the run report with `skills/html-report/SKILL.md` from the state, the ledger, and the
    evidence under `<state-root>/crash-hunt/<run-id>/`.
17. Run the advisor `done` checkpoint on the PR, the proof, and the run report
    (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it does not apply.
18. Ask `crash-hunter` to confirm that no app instance or database from this run remains, and
    to tear down whatever does, then remove the hunt worktree
    `<worktree-root>/crash-hunt-<run-id>`. Report the config and boot state, the requests sent,
    the proven crashes with their signatures, each marked new, regression, or in flight, the
    pick and why, the PR or why none was opened, what blocked, and the teardown and worktree
    removal confirmed. Refresh the run report, or render it
    with `skills/html-report/SKILL.md` when the run reached this step early, and give its path.
    Update state and ledger. Stop at merge-ready; the PR stays a draft.
