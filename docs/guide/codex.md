# Codex

viStack is a dual-host package. Claude Code uses the Claude plugin manifest, slash command,
and role agents. Codex uses the Codex plugin manifest and discovers the same workflow through
the `vistack` skill.

## Install from GitHub

Add the repository as a Codex marketplace, then install the plugin:

```bash
codex plugin marketplace add https://github.com/vianch/viStack
codex plugin add vistack@vistack
```

The repository's `.agents/plugins/marketplace.json` points the marketplace entry at the
repository root, where `.codex-plugin/plugin.json` lives.

For local development, add the checked-out repository instead:

```bash
codex plugin marketplace add /absolute/path/to/vistack
codex plugin add vistack@vistack
```

Start a new Codex thread after installing or updating the plugin so the skill inventory is
reloaded.

## Use it

Invoke the skill explicitly with `$vistack`, or describe the engineering request in a way that
matches its skill description:

```text
$vistack Fix the failing upload test. Done means the test passes and the upload error is
shown to users without changing successful uploads.
```

Codex does not load Claude's `commands/` or `agents/` directories as executable components.
The shared router therefore adapts the same playbooks to the current Codex thread:

- `Dispatch <role>` means adopt that role's contract in the current thread.
- Playbook steps remain the source of truth and are followed in order.
- Run state and the decision ledger live under `.codex/vistack/state/`.
- Slice worktrees live under `.codex/vistack/worktrees/`.
- Claude-only `/loop`, `claude attach`, and session-comment operations are skipped with an
  explicit ledger reason. Codex continues with the equivalent sequential phase in-thread.
- An overnight run uses the Codex recurring-task or background equivalent when the host
  provides one. If it does not, the run still writes resumable state but must not claim that
  work continued after the thread ended.

The workflow still requires a checkable finish condition, keeps the four fences, uses one
concern per draft PR, and stops at merge-ready. It never merges.

Use `$overnight` for a direct overnight entry point, or include "going to bed" and the full
permission boundary in a `$vistack` request. Use `$automate-me` to capture personal working
preferences. Project invariants stay in viStack principles and playbooks.

## Update

After changing a local checkout, update the Codex cachebuster and reinstall:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py /absolute/path/to/vistack
codex plugin add vistack@vistack
```

Use a new thread to test the updated skill.
