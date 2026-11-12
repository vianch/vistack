---
name: maintenance
description: "'maintenance change', 'maintenance pass', 'maintenance PR', 'one high-value change', 'tech debt', 'hardening pass', 'riskiest fix', 'highest-risk fix', 'pick something to fix', 'find something worth fixing', or a scheduled maintenance routine firing. Picks the one change most likely to prevent a production incident, after checking open claude/* PRs so nothing in flight is repeated, and lands it as one draft PR or reports that no candidate cleared the bar. A request that names its target goes to refactor, bug-fix, or feature instead."
---

# maintenance

Use `skills/vistack/playbooks/maintenance.md` as the executable contract. This skill is a
direct entry point for the same run. Candidates rank by
`skills/maintenance/references/risk-rubric.md`; which requests belong here is in
`skills/maintenance/references/triggers.md`.

- **Risk ranks; size does not.** Line count never ranks a candidate, in either direction.
  Its one use is the 500-line ceiling. A ten-line missing permission check outranks a large
  cleanup, because the size of a change does not measure the incident it prevents.
- **One PR per run.** Runner-ups go in the report for the next run, which re-ranks them
  against the PRs in flight by then. A candidate that outgrows the ceiling is dropped, not
  stack-split.
- **Headless runs.** In a headless `claude -p` run, every dispatched lane, the QA lane
  included, finishes before the final message, because lanes still running when the session
  ends are lost. Wait on each lane's completion; a lane that will not finish is stalled
  (`skills/coordinate/SKILL.md`, Dispatch rules), and the report names it.
- **PR text** carries only the picked risk, its evidence, and the proof, never the
  runner-ups (playbook step 9), in the project's own voice under the External naming
  boundary in `skills/vistack/principles/index.md`.
- **Schedule.** Nightly, through `skills/routine-healthcheck/SKILL.md` (Install, Nightly
  repository routines) and `scripts/run-routine.sh`. `/loop` dies with its session, so it
  cannot hold a nightly routine. A Claude Code cloud routine cannot reach the local app and
  database, and whether it loads this plugin is unverified.
