---
name: design-agent
description: "Design and create a new agent for Claude Code, Codex, or OpenCode: ask a few preference questions, write a tight persona with one job, one voice, and explicit anti-jobs, create the host's agent file, and verify it against what the host actually loads. Coding agents meet the viStack bar. On first use on a machine, make sure the transcript-healthcheck and routine-healthcheck routines exist."
---

# design-agent

An agent is a job description the host can load. Write one job, the voice it answers in,
and the things it must never do, then prove the host loads it the way it was designed.

## First use on a machine

1. Check for the `transcript-healthcheck` and `routine-healthcheck` routines. Install any
   missing one with the Install section of `skills/routine-healthcheck/SKILL.md`: idempotent,
   and printing the exact scheduler entry and its removal command before writing it. Do not
   wait to be asked.
2. In a repository with no recorded verification command, name the command that proves a
   change works and record it with the project's other per-repo inputs
   (`build-the-lever`). Skip this on a machine with no repository.
3. Offer once to run a routine checkup now.

## Intake

Ask only what the request does not already answer, in one message, five questions at most:

1. The one job, in a sentence.
2. The host: Claude Code, Codex, OpenCode, or several.
3. Coding or non-coding.
4. The scope: personal (user-level) or project (checked into the repository).
5. The voice and output shape, and when it should say nothing.

For a non-coding agent, also ask for its anti-jobs when the request does not imply them.

## Write the persona

- **One job.** The description's first clause is the job; the host matches on it. An agent
  with two jobs is two agents.
- **Coding agents meet the viStack bar.** They read `skills/vistack/principles/index.md`,
  follow the repository's conventions, keep one concern per change, never widen scope, and
  prove their work with an artifact (`prove-it-works`, `evidence-over-inference`).
- **Non-coding agents get one job, one voice, and explicit anti-jobs.** A mentions scout does
  not post. A drafter does not send. A reporter stays quiet when there is nothing to report.
  Write each anti-job as a "Never" line.
- **Least privilege.** A read-only agent gets no edit or write tools. An agent that needs MCP
  tools, such as Figma, omits the `tools:` list: an explicit list hides MCP tools.
- **Model by uncertainty.** Judgment and prose on opus; precisely specified, mechanical work
  on sonnet; a pure check on haiku. Set effort only where the agent tree does
  (`skills/vistack/SKILL.md`). On Codex the model is the one Codex runs; on OpenCode it is a
  `provider/model` string.
- **Plain prose.** Run `unslop` over the body. Every sentence changes a decision.
- **The whole persona travels.** When the agent is also published as a template or shared
  file, copy the full body and description, not a one-line summary.

## Create

| Host | Project scope | Personal scope | Frontmatter |
|---|---|---|---|
| Claude Code | `.claude/agents/<name>.md` | `~/.claude/agents/<name>.md` | `name`, `description`, `model`, optional `effort`, `tools` |
| OpenCode | `.opencode/agents/<name>.md` | `~/.config/opencode/agents/<name>.md` | `name`, `description`, optional `mode: subagent`, `model` |
| Codex | a skill in the project's plugin | `~/.codex/skills/<name>/SKILL.md` | `name`, `description` |

Codex has no agent files, so a Codex agent is a skill whose body is the persona. The name
matches `^[a-z0-9]+(-[a-z0-9]+)*$` and the file or directory name matches it. Before writing,
look at the target: never overwrite an existing agent without showing the diff first.

## Verify against the live profile

A file on disk is a claim. The host's loaded profile is the evidence.

1. Start a new session on the host, so the inventory reloads.
2. Confirm the agent is listed — `/agents` in Claude Code, the agent picker in OpenCode, the
   skill list in Codex — with the model and tools you designed.
3. Dispatch it once on a harmless, read-only request that matches its job, and once on a
   request that matches an anti-job. The first should do the job; the second should decline.
4. Compare the live result with the persona. Fix the file and re-verify on any mismatch.

## Report

The path, the host and scope, the job, the anti-jobs, the model and effort, and the
verification evidence: the listing and both dry dispatches.
