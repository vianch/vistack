---
name: transcript-healthcheck
description: "Standing weekday routine (44 8 * * 1-5, local time) that scans recent Claude Code, Codex, and OpenCode transcripts for user friction and proposes new or changed skills, agents, or routines with evidence. Read-only; stays quiet when nothing is worth proposing; creates nothing until the user picks."
---

# transcript-healthcheck

Find the places where the user keeps correcting the agents, and propose the smallest fix
that would stop it. Propose; never create.

## Window and sources

Scan the transcripts written since the last report, or the last 24 hours when there is none.
Monday's run covers the weekend. Read only the hosts present on the machine:

| Host | Transcripts |
|---|---|
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` |
| Codex | `~/.codex/sessions/` and `~/.codex/archived_sessions/` |
| OpenCode | the session storage OpenCode reports for the machine |

This routine is read-only. It never edits a transcript, a skill, an agent, or a routine.

## Friction signals

- The user corrects the agent: "no", "stop", "don't", "I said", "that's wrong", "again".
- The same instruction repeated across sessions.
- A rejected tool call, a denied permission, or an interrupted turn.
- The same request retried, or the user redoing the agent's work by hand.

A signal becomes a proposal only when it recurs: at least two occurrences, in at least two
sessions.

## Proposals

For each, name:

- the kind: a new skill, a new agent, a new routine, or a change to an existing one;
- the evidence: session id, timestamp, and a one-line quote per occurrence;
- the smallest fix, with the file it would touch;
- what it would stop, in one sentence.

Rank by how often the friction recurs. Five proposals at most.

## Stay quiet

When nothing reaches the bar, print nothing. The scheduler wrapper writes a report only
when there is output, so a quiet run leaves no file and sends no message.

## Never

Create or change anything from a report — the user picks. Copy a credential, token, or
secret into a report; quote the smallest fragment that shows the friction. Send a report
anywhere but the local report folder.
