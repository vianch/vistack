# Playbook: investigation

**Match when** the ask is to understand rather than to change. **Read-only by contract:** no
edits, no branches, no worktrees, no PRs. If the answer turns out to require a change, this
playbook ends and `new task` starts the right one.

## Steps

1. State the question in one sentence, and state what a complete answer contains.
2. Confirm the read-only contract out loud: this run writes no product code. If the request
   actually wants a change, stop and say so.
3. Dispatch `analyst` with the question. Tools are read-only — `Read`, `Glob`, `Grep`,
   `Bash` for inspection, `gh` for issues and PRs.
4. Establish the entry points first: where the behaviour is triggered, with `file:line`.
5. Trace outward to call sites and consumers. Record the blast radius as a list of
   `file:line` refs, not prose.
6. Check history for the load-bearing lines: `git log -L`, `git blame`, and the PR that
   introduced them. A deliberate decision reads differently from an accident.
7. Check existing test coverage of the touched paths, and name what is uncovered.
8. Separate findings from hypotheses. Every finding cites evidence; every hypothesis names
   the check that would settle it.
9. Report: the answer, the evidence, the blast radius, what is uncovered, and the options
   with their trade-offs. Recommend one.
10. Post the report where the work lives — a comment on the issue, or the reply if there is
    no issue. Do not open a PR.
