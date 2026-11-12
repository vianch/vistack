# Playbook: maintenance

**Match when the request asks for one change and names none, so the agent picks it by risk.**
Ranking lives in `skills/maintenance/references/risk-rubric.md`; the phrases that route here
are in `skills/maintenance/references/triggers.md`.

## Steps

1. State the scope (the whole repository, or the area the request names) and the base
   branch. The finish predicate is one draft PR for the top-ranked candidate, or a report
   that no candidate cleared the bar. Unchanged: all behavior outside the chosen candidate.
   Record all four in the state file.
2. Read the consuming repository's `CLAUDE.md` or `AGENTS.md` and every rule under its
   `.claude/rules/` that applies to the scope. Where they conflict with this playbook they
   win, except over the four fences (`skills/autonomy-has-fences/SKILL.md`), the merge
   boundary (`skills/vistack/SKILL.md`, Merge boundary), and the realm rule
   (`skills/keep-origins-in-realm/SKILL.md`). Name each file that applies; every later brief
   carries them.
3. List the open PRs whose head branch starts with `claude/`, with title, body, and changed
   files, and the `claude/*` PRs closed without merge in the last 30 days. Read the topics
   dropped in the last 30 days from `<state-root>/maintenance/dropped.jsonl`; a missing file
   means none yet. The three lists feed the in-flight and dropped exclusions of the rubric.
   A failed query is not an empty list. Missing or expired credentials are FENCE 4; any
   other failure goes through `unblock`. Carry the lists, with their counts, into the step 4
   brief.
4. Dispatch `analyst` with `skills/maintenance/references/risk-rubric.md`, the scope, the
   rules from step 2, and the lists from step 3. It returns up to five candidates in the
   rubric's return shape, every signal with its `file:line` evidence, and each candidate it
   dropped with the exclusion that dropped it.
5. Check every returned row against the rubric, then pick the top-ranked candidate not yet
   dropped. Record the ranked table as one `candidate-ranked` ledger row per candidate, with
   the score or exclusion as `reason` and the `file:line` as `evidence`. The pick's row
   names its topic as the slice, has result `ok`, and says why it won; every other row is
   run-level with result `skipped`. On a return from step 7 or 8, only the new pick gets a
   row, and a candidate step 8 dropped stays dropped. With no candidate left, record
   `step-skipped` for each of steps 6 to 11 that has not run, and go to step 12.
6. Classify the pick. A pick that changes behavior is a defect, and its proof is a test that
   fails on the base branch for the expected reason (`skills/vistack/playbooks/bug-fix.md`,
   step 4). A structural risk with no behavior change is pinned by characterization tests
   before the move (`skills/vistack/playbooks/refactor.md`, step 3). Set the tier
   (`skills/coordinate/SKILL.md`, Dispatch rules) and write the class, proof, and tier into
   the slice brief.
7. Run the advisor `plan` checkpoint on the pick, the ranked table, the class, the proof, and
   the tier before dispatch (`skills/advisor/SKILL.md`). Apply or rebut each point with
   evidence. A point that changes a score or an exclusion is a `deviation` row and a return
   to step 5 to re-rank.
8. Dispatch the tier owner in one worktree on a branch named `claude/maintenance-<topic>`
   from the base branch. The owner lands the proof first and runs it on the base branch,
   where the defect test fails for the expected reason or the pin passes. Then it makes the
   change, runs the suite in the run order of `skills/prove-it-works/SKILL.md` and lint, and
   passes the diff through `skills/pruning-comments/SKILL.md`. One concern, at most 500
   changed lines excluding lockfiles and generated files. A diff that would pass that
   ceiling, or a proof the base branch does not confirm, drops the candidate; this run opens
   one PR, so it is not stack-split. Record a `deviation` row and append one JSON line to
   `<state-root>/maintenance/dropped.jsonl` with `topic`, `files`, `reason`
   (`over-ceiling` or `proof-unconfirmed`), and `date` (ISO-8601 UTC), so later runs skip
   it. Remove the worktree, keep the branch, and return to step 5.
9. `pr-author` opens one draft PR, never a stack, carrying only the picked risk, its
   evidence (each signal's `file:line` and the score), and the proof's output on the base
   branch and on the head. Runner-ups and their scores stay out of PR text, because they
   name unfixed risks; they go to the ledger, the run report, and the step 13 report. It
   assigns the configured reviewers. The PR text follows the External naming boundary in
   `skills/vistack/principles/index.md`.
10. When the change has a runtime surface, dispatch a background `qa-verifier` lane on the
    PR's own environment (`skills/coordinate/SKILL.md`, QA lanes). Otherwise record
    `step-skipped` with the reason the change has none.
11. Run `health-check` once the QA lane completes, or once the PR opens when step 10 was
    skipped. For a defect it also confirms the proof fails with the change reverted. A
    defect it routes goes back to the tier owner on the same branch.
12. This run is unattended, so the router's Final report rule applies. Render the run report
    with `skills/html-report/SKILL.md` first so the checkpoint reviews it. Run the advisor
    `done` checkpoint on the PR, the proof output, and the QA and health-check results, or on
    the ranked table when no PR opened, before calling the run merge-ready
    (`skills/advisor/SKILL.md`). Resolve each gap it names or record why it does not apply.
13. Report the pick and why it won, the ranked table, the PR link or why none opened, the
    exclusions applied, and the runner-ups for the next run; a fence reports here with its
    dossier. In a headless run, apply the headless-run rule in `skills/maintenance/SKILL.md`
    before this message. Render or refresh the run report and give its path or link. Stop at
    merge-ready and never merge. Every exit path ends at this step.
