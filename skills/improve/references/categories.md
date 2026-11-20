# Run-cost categories

A sweep looks past repeated mistakes for what made runs slower, costlier, or blind. Each
finding still needs two occurrences, each tied to a session moment or a ledger row.

| Category | Use when | Where the fix goes |
|---|---|---|
| Automated check | a lint, type, test, or filesystem check could have caught a mechanical violation | a deterministic check run by the verify command and CI |
| Review standard | a reviewer passed a judgment problem a later run caught | the reviewer's review-time file |
| Navigation | an agent searched at length before finding a file, or broke a file it did not know depended on another | a one-line pointer in the nearest instruction file, or the dependency named beside the file |
| Tool economy | calls spent many tokens for little: whole reads of a file over the token limit, short polling of a lane the host tracks, a procedure retyped each run | a script, a narrower command, or a split file (`skills/token-guard/SKILL.md`) |
| Information access | the agent lacked logs, read access, or a command, and guessed | a script that fetches it; a new grant is the operator's call |
| No-ops and sediment | a line in an always-loaded file changes nothing when deleted, or steering only some tasks need loads every turn | delete it, or move it behind a pointer |

## Where each kind of text lives

- Always-loaded files (`CLAUDE.md`, `AGENTS.md`) hold navigation pointers and the rule
  table. Every line is paid on every turn, so moving a rule out of one counts as a fix.
- Review standards are read at review time, by the role that reads the diff.
- Reference docs sit behind a pointer and load when a task reaches them.
- A model-invoked skill keeps its description in context on every turn; make one only when
  its trigger must fire without the operator. A user-invoked skill
  (`disable-model-invocation: true`) costs no context, and the operator has to remember it
  exists.
