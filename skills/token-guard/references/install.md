# token-guard: install

A git hook runs outside Claude Code and Codex. `${CLAUDE_PLUGIN_ROOT}` is unset there, and a
tracked hook such as `.husky/pre-commit` must not carry a path that exists on one machine only.
So `install` copies `token-guard.mjs` and `split-plan.mjs` next to the hook it writes and calls
them by relative paths, which is why both import nothing outside Node. Run it in the consuming
repository.

| The repository has | `install` |
|---|---|
| `.husky/` | copies both scripts into `.husky/` and creates `.husky/pre-commit` or appends the block to it; commit all three files |
| `lefthook.yml` or `.pre-commit-config.yaml`, and no `.husky/` | writes nothing; prints the entry to add and the command that writes both copies to `scripts/` |
| neither | copies both scripts into the hooks directory (`git rev-parse --git-path hooks`, `.git/hooks` unless `core.hooksPath` is set) and creates or appends `pre-commit`, mode 0755 |

The block names only `token-guard.mjs`, which loads `split-plan.mjs` itself; ` --limit <n>` is
appended when `--limit` was given:

```sh
# >>> token-guard (keeps staged files under the token limit; remove this block to uninstall)
node "$(dirname "$0")/token-guard.mjs" check
# <<< token-guard
```

A second `install` with the block present changes nothing; a different `--limit` rewrites the
block. Each copy is one generated first line followed by the plugin's script, and `install`
rewrites a copy only when it differs from that, so a plugin upgrade reaches a repository only
when someone runs the plugin's `install` there again; run from a copy, `install` refreshes the
copies from themselves. `uninstall` removes the block and both copies from
whichever location holds them, and deletes a hook left holding only its shebang.
