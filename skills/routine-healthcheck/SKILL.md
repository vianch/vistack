---
name: routine-healthcheck
description: "Standing Monday routine (49 8 * * 1, local time) that audits the machine's agent routines for token waste and failures and proposes fixes ranked by saving. Also owns installing the two standing healthcheck routines, and installs the nightly maintenance and crash-hunt routines for one named repository on request. Read-only when auditing; stays quiet when nothing is worth proposing; changes nothing until the user picks."
---

# routine-healthcheck

Every routine spends tokens on a schedule. Find the ones that spend without producing, and
propose the fix. Propose; never change a routine from a report.

## Inventory

- The OS scheduler entries viStack installed: launchd labels `dev.vistack.*` on macOS, crontab
  lines tagged `# vistack:` elsewhere.
- Claude Code cloud routines, listed with `/schedule` or the remote-trigger list, with their
  recent runs and run logs.
- Session-only jobs — `/loop` monitors and session cron jobs — noted as session-bound.
- Codex or OpenCode scheduled runs, when the host exposes them.

## Per routine

Its cadence, model and effort, prompt size, runs in the last week, yield (runs that produced a
report, proposal, or side effect, against quiet runs), failures, and cost where the host
reports it.

## Waste signals

- Quiet on every run in the window: lower the cadence or retire it.
- High effort or a large model for a scan: lower it.
- A prompt or loaded context far larger than the job needs: trim it.
- Two routines doing the same job: merge them.
- Repeated failures: fix or pause it.

## Output

Fixes ranked by saving, each with the evidence and the exact change. When nothing is worth
proposing, print nothing.

## Install

The designer's first run calls this section; it may also run on request. Resolve the
plugin root once, then for each of the two routines:

1. Look for the existing entry by label or tag. If it exists, stop: installation is
   idempotent.
2. Print the exact entry and its removal command.
3. Write the entry.

The entry runs `scripts/run-healthcheck.sh <routine> <host>`, its path resolved from the plugin
root. The script runs the host's headless CLI read-only and writes
`~/.vistack/healthchecks/<routine>-<date>.md` only when the run printed something.

| Routine | Cron | launchd `StartCalendarInterval` |
|---|---|---|
| `transcript-healthcheck` | `44 8 * * 1-5` | Weekday 1–5, Hour 8, Minute 44 |
| `routine-healthcheck` | `49 8 * * 1` | Weekday 1, Hour 8, Minute 49 |

On macOS, write `~/Library/LaunchAgents/dev.vistack.<routine>.plist` and load it with
`launchctl bootstrap gui/$(id -u) <plist>`; remove it with
`launchctl bootout gui/$(id -u)/dev.vistack.<routine>` and delete the plist. Elsewhere, append
`<cron> <plugin-root>/scripts/run-healthcheck.sh <routine> <host> # vistack:<routine>` to the
crontab; remove it with `crontab -l | grep -v 'vistack:<routine>' | crontab -`.

Claude Code's session cron jobs expire with the session, and its cloud routines cannot read
local transcripts, so neither can hold a standing healthcheck.

### Nightly repository routines

`maintenance` and `crash-hunt` can run nightly against one repository. This is opt-in: the
designer's first run never installs them, and they are installed only when the operator asks
for a named repository. The two Install rules above apply unchanged: look for the entry
first and stop if it exists, print the entry and its removal command, then write it.

The repo key is the repository directory's basename with every character outside
`A-Za-z0-9._-` replaced by `_`, a hyphen, and the first six hex digits of the `cksum` of the
repository's absolute, symlink-resolved path, so two repositories with the same basename never
share a lock, a log directory, a label, or a tag. The entry runs
`scripts/run-routine.sh <routine> <repo-dir> <host>`, its path resolved from the plugin root,
with `<repo-dir>` the repository's absolute path. The script locks per repository, logs to
`~/.vistack/routines/<repo-key>/<routine>-<date>.log`, and ends a run at
`VISTACK_ROUTINE_MAX_MINUTES` (default 240).

| Routine | Cron | launchd `StartCalendarInterval` |
|---|---|---|
| `crash-hunt` | `30 1 * * *` | Hour 1, Minute 30, no Weekday |
| `maintenance` | `0 6 * * 1-5` | One dict per Weekday 1 to 5, Hour 6, Minute 0 |

The launchd label is `dev.vistack.<routine>.<repo-key>`, with its plist at
`~/Library/LaunchAgents/<label>.plist`, loaded and removed as above. The crontab line ends in
the tag `# vistack:<routine>:<repo-key>`; find and remove it with an end-anchored match,
`grep -v '# vistack:<routine>:<repo-key>$'`, so a key that prefixes another does not remove the
other's line.

Before writing, check and print each prerequisite, and write nothing while one fails:

- For `crash-hunt`, `.claude/vistack/crash-hunt.json` exists in the repository.
- The repository's Claude Code settings allow every command the run needs: build, test, the
  database commands, pushing `claude/*` branches, and opening a draft PR. The run passes
  `--permission-prompts none`, so anything that would prompt is denied, and the run cannot
  take that step. Print each missing permission; add none yourself.
- The scheduler's PATH reaches the tools. launchd starts jobs with a minimal PATH, so the plist
  sets `PATH` under `EnvironmentVariables` to the directories of `claude`, `node`, and the
  repository's build and container tools, each found with `command -v` at install time, then
  `/usr/bin:/bin`. A crontab line gets the same value as a `PATH=...` prefix.

`VISTACK_ROUTINE_PERMISSION_MODE`, `VISTACK_ROUTINE_BUDGET_USD`, and `VISTACK_ROUTINE_MODEL`
override the Claude run's permission mode, spend cap, and model, `VISTACK_ROUTINE_DIR` the log
root. The Inventory above already covers `dev.vistack.*` labels and `# vistack:` tags, so these
routines are audited like the others.

## Never

Change, pause, or delete a routine from a report — the user picks. Install a routine twice.
Write an entry without printing it and its removal command first.
