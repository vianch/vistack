# Playbook: agent-design

**Match when the user wants a new agent, bot, or subagent for Claude Code, Codex, or
OpenCode.** The contract is `skills/design-agent/SKILL.md`. The deliverable is an agent the
host loads and that behaves as designed.

## Steps

1. On a machine's first use, confirm the `transcript-healthcheck` and `routine-healthcheck`
   routines exist. Install any missing one idempotently, printing its entry and removal
   command first.
2. Ask the intake questions the request does not answer, in one message.
3. State the job in one sentence, the anti-jobs, the host, the scope, and whether it codes.
4. Write the persona. A coding agent meets the viStack bar; a non-coding agent gets one job,
   one voice, and explicit anti-jobs.
5. Choose least-privilege tools and the model by uncertainty. An agent that needs MCP tools
   omits `tools:`.
6. Look at the target path, then create the agent file. The name matches the filename.
7. Verify in a new session: listed with the designed model and tools, does its job on a
   harmless request, and declines an anti-job.
8. Report the path, job, anti-jobs, model, and verification evidence. Offer once to run a
   routine checkup.
