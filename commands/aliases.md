---
description: "Install, list, or remove bare-name aliases such as /qa-video and /review-pr for every viStack skill and command; /run needs --replace run"
argument-hint: "status | install [--replace <names>] [--skip <names>] [--clear <names>] [--dry-run] | uninstall"
disable-model-invocation: true
---

# /vistack:aliases

Claude Code lists plugin skills only as `/vistack:<name>`. A bare `/<name>` reaches a viStack
skill only when nothing else claims the name: `/run` is Claude Code's bundled skill, and another
installed plugin can ship `/qa-video`. This command writes a personal skill at
`~/.claude/skills/<name>/SKILL.md` for each viStack skill and command, so a bare name such as
`/qa-video` or `/review-pr` always runs viStack. The namespaced names keep working.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-aliases.mjs" $ARGUMENTS
```

An empty request runs `status`. Each row is `<action>`, `/<name>`, and a detail, separated by
tabs; the last line counts the rows and names the skills directory.

Report the rows grouped by action, naming every alias in each group:

- `written`, `unchanged`, `installed`: the alias is in place.
- `stale`, `missing`, `root-missing`, `orphan`: `install` rewrites, writes, or removes it.
- `removed`, `kept-dir`: the alias is gone; `kept-dir` left its directory because the user put
  other files in it.
- `reserved`, `project`: name what the alias would replace, from the detail: a Claude Code
  built-in command, bundled skill, or built-in alias, or the project skill at the path shown.
  A `project` detail that says the installed alias stays means it already hides that skill here.
- `foreign`: a skill or personal command the user owns has that name. It is never touched, and
  `--replace` does not change that.
- `skipped`: the user left it out with `--skip`; `--clear <name>` restores it.

Pass `--replace <name>` only when the user asks for that name. A reserved alias replaces the
Claude Code command or skill in every session, and a project alias hides that project's own
skill. A `project` row never removes an alias. It depends on the directory this session runs
in, while aliases apply to every project, so an alias installed from elsewhere stays and hides
the project skill here until `--skip <name>` removes it.

`--replace`, `--skip`, and `--clear` persist per skills directory in `~/.vistack/aliases.json`,
so a later plain `install` keeps them.

New and removed aliases load in a new session, or after `/reload-skills`. An alias for a skill
that disables model invocation reads that skill by its absolute path in this plugin, so rerun
`install` after every plugin update.
