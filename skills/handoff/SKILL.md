---
name: handoff
description: "'/handoff', 'write a handoff', 'hand this off', 'pick up the handoff'. Writes a handoff document a fresh agent on any host can act on, or resumes from the newest one for this project after checking it against the repository."
argument-hint: "[pickup] | <what the next session will focus on>"
---

# handoff

A handoff lets an agent that never saw this conversation continue it. It records what is
done, what was decided and why, what is open, and the next concrete steps, and points at
every artifact instead of copying it. Claude Code, Codex, Grok, and OpenCode share the same
folder, so a session on one host picks up a handoff written on another.

`pickup` as the first argument resumes from a handoff. Anything else, or nothing, writes one,
and the argument is the next session's focus.

The script path resolves from the plugin root: on Claude Code it is
`${CLAUDE_PLUGIN_ROOT}/skills/handoff/scripts/handoff.sh`, elsewhere the installed plugin
path. Run it from the project, because it reads the project's git state. `HANDOFF_DIR`
overrides the folder.

## Write

1. Run `handoff.sh new`. Use its `HANDOFF_FILE` exactly; never rebuild the path.
2. Collect what the next agent cannot see: `git status --short`, `git log --oneline -10`,
   the PR for this branch when one exists and its origin is inside the realm
   (`skills/keep-origins-in-realm/SKILL.md`), and an open viStack run, which is a state file
   under `.claude/state/` or `.codex/vistack/state/` with a slice not yet `merge-ready`. A
   run's state file and ledger already hold its slices and decisions: cite their paths, do
   not restate them.
3. Write `HANDOFF_FILE` from the template below. Omit a section with nothing true to say.
   Every finished item names its evidence: a `file:line`, a command and its result, a commit,
   or a URL. A claim nobody checked goes under Unverified, never under Done.
4. Redact before writing: API keys, tokens, passwords, connection strings, and personal data
   become `[REDACTED:<kind>]`.
5. Print the confirmation block and stop. Writing a handoff edits no code and touches nothing
   outside `HANDOFF_DIR`.

```markdown
---
project: {PROJECT_SLUG}
cwd: {CWD}
branch: {BRANCH}
head: {HEAD}
timestamp: {TIMESTAMP}
next_session_focus: {the argument verbatim, or "unspecified"}
run_state: {state file path, or "none"}
---

# Handoff: {short title}

## Context
{1 to 3 sentences: the work, where it stands, and the focus for the next session.}

## Done
- {one finished thing} ({evidence})

## Decisions
- {decision}: {the reason, one line}

## Unverified
- {claimed but not checked, and the check that would settle it}

## Open questions
- {what the next agent must decide or confirm before acting}

## Next steps
1. {a concrete action with paths, commands, and its done condition}

## References
- {absolute paths or URLs that hold the detail}

## Gotchas
- {a dead end, a flaky command, or an environment quirk that costs 10+ minutes}
```

```
HANDOFF SAVED
Project: {PROJECT_SLUG}   Branch: {BRANCH} @ {HEAD}
File:    {HANDOFF_FILE}
Focus:   {next_session_focus}
Resume:  /vistack:handoff pickup  (Codex: $vistack:handoff pickup)
```

## Pickup

1. Run `handoff.sh latest`. It lists the newest handoffs for this project, preferring ones
   written from this checkout over another checkout with the same name. Exit `1` means none:
   say so and stop. Take the newest unless the user names another.
2. Read it in full, then measure drift before trusting it: commits since its `head`
   (`git log --oneline <head>..HEAD`), a branch other than its `branch`, uncommitted
   changes, and referenced files that no longer exist.
3. When `run_state` names a state file, resume through the router's `session-pickup`
   playbook, because that file and its ledger are the run's record. Otherwise continue from
   Next steps.
4. Tell the user in at most five lines: the focus, the first next step, and any drift.
   Start the first next step unless the user asked only to read, or drift changed what it
   means.

## Rules

- Never overwrite a handoff. Every write is a new timestamped file.
- Infer from the conversation, git, and run state. Ask only when the focus is ambiguous and
  nothing in the session points to one.
- A handoff is internal. Its text never goes into a PR, ticket, or comment; the External
  naming boundary in `skills/vistack/principles/index.md` applies to anything that does.
