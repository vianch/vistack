# recall: find what past sessions decided

The question is about the project's own past: a decision, an attempt, a dead end, a promise.
Search the cheapest records first and stop as soon as one answers.

## Order

1. **This conversation**, including anything compaction kept.
2. **Memory and instructions.** Claude Code's project memory
   (`~/.claude/projects/<project-slug>/memory/MEMORY.md` and the files it lists), the
   repository's `CLAUDE.md` and `AGENTS.md`, and Codex's `~/.codex/AGENTS.md`.
3. **Handoffs.** `handoff.sh latest 10` (`skills/handoff/SKILL.md`), then read the one whose
   date and focus fit.
4. **viStack run records.** Ledgers record each decision with its reason:
   `grep -i '<term>' .claude/state/*.tsv .codex/vistack/state/*.tsv`, then the run's state
   file and `reports/`.
5. **Git.** `git log --grep '<term>' -i`, and PR descriptions through
   `gh pr list --state all --search '<term>'` for origins inside the realm.
6. **Transcripts**, last, through the script below. Never open a transcript whole; read only
   around a matched timestamp.

## The script

```
node <skill folder>/scripts/recall.mjs search <term> [<term>...] [--project <dir>] [--all-projects]
     [--host claude|codex|grok|opencode|all] [--since YYYY-MM-DD] [--limit N] [--json] [--home <dir>]
node <skill folder>/scripts/recall.mjs sessions [--project <dir>] [--all-projects] [--host ...]
     [--since YYYY-MM-DD] [--limit N] [--json] [--home <dir>]
```

`search` returns messages that contain every term, case-insensitive, newest first: a dated
snippet with host, session id, role, and the file to drill into. `sessions` lists the
project's sessions with their first prompt. Both default to the current directory's project,
which includes its worktrees, and to every host. Exit codes: `0` results printed, `1` nothing
matched, `2` a usage error. Snippets come out redacted; credentials, tokens, keys, and email
addresses become `[REDACTED:<kind>]`.

Pick terms the past session would have used: an identifier, a file name, an error string, a
ticket number. Two distinctive terms beat one common one. A multi-word term must appear as one
contiguous string. Only message text is searched, not tool calls, tool results, or subagent
sidechains. `sessions --since` means active since, by last modification.

| Host | Store | Support |
|---|---|---|
| Claude Code | `~/.claude/projects/<project-slug>/*.jsonl` | verified |
| Codex | `~/.codex/sessions/` and `~/.codex/archived_sessions/` rollout files | verified |
| Grok Build | `~/.grok/sessions/<encoded cwd>/<id>/chat_history.jsonl` | best effort; assistant turns unverified |
| OpenCode | `~/.local/share/opencode/opencode.db` | best effort; needs Node 22.5 or later for `node:sqlite` |

## Answer shape

```
<the answer, one paragraph>

Source: <host> session <id8>, <date> | handoff <path> | ledger <path:line> | commit <sha>
Status: decided | discussed, not decided | done | abandoned
Still true? <checked against HEAD: yes, no, or not checked>
```

Separate what was decided from what was only discussed, and from what was done. When records
disagree, the newest wins, and the answer names the conflict. A recalled decision about code
is checked against HEAD before anyone acts on it.

## Privacy

Transcripts hold whatever was pasted into them. Quote only the redacted snippet the answer
needs, never raw transcript lines, and never send transcript text to an external service or
into project-facing text.
