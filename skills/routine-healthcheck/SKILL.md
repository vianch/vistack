---
name: routine-healthcheck
description: "Standing Monday routine (49 8 * * 1, local time) that audits the machine's agent routines for token waste and failures and proposes fixes ranked by saving. Also owns installing the two standing healthcheck routines. Read-only when auditing; stays quiet when nothing is worth proposing; changes nothing until the user picks."
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

## Never

Change, pause, or delete a routine from a report — the user picks. Install a routine twice.
Write an entry without printing it and its removal command first.
