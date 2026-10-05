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

Invoke the canonical skill explicitly with `$vistack:vistack`, or use one of its equivalent
aliases: `$vistack:run`, `$vistack:orchestrator`, or `$vistack:coordinator`. You can also
describe the engineering request in a way that
matches its skill description:

```text
$vistack:run Fix the failing upload test. Done means the test passes and the upload error is
shown to users without changing successful uploads.
```

Codex does not load Claude's `commands/` or `agents/` directories as executable components.
The shared router therefore adapts the same playbooks to the current Codex thread:

- `Dispatch <role>` means adopt that role's contract in the current thread, recorded as a
  `dispatched` ledger row naming the role and tier. The thread writes only under an adopted
  role (`implementer`, `senior-implementer`, `qa-verifier`, …); the coordinator role itself
  never writes.
- A read-only or scratch-directory lane — a reviewer, a design runner, a judge, a QA lane —
  runs as its own `codex exec --ephemeral -m <model>` process so it keeps an independent
  context. The model is the one Codex runs, Luna (`gpt-6-luna`). Roles that write to a
  worktree are adopted in the thread.
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

The four names are equivalent. The aliases are thin shims that delegate to
`skills/vistack/SKILL.md`; they do not create separate Codex workflows.

Use `$overnight` for a direct overnight entry point, or include "going to bed" and the full
permission boundary in a `$vistack` request. Use `$automate-me` to capture personal working
preferences. Project invariants stay in viStack principles and playbooks.

## QA lanes and video

QA gets its own lane on Codex too (`skills/coordinate/SKILL.md`, QA lanes). A QA lane writes
only its evidence directory, `.codex/vistack/state/qa/<slug>/<slice-or-pr>/<head7>/`, so it
fans out as a scratch-directory process:
`codex exec --ephemeral --sandbox workspace-write -C <lane dir>`. Call the script with the
installed plugin path, `node <plugin path>/skills/qa-video/scripts/qa-video.mjs <command>`,
and pass absolute paths for `--playwright` (the consuming repository's
`node_modules/playwright`) and for the credential file, because neither resolves under
`-C`. Whether that sandbox allows network access to the preview and a browser launch is
unverified. When the lane cannot reach the target, the thread adopts the `qa-verifier` role
with a `dispatched` row instead. Either way, the thread posts the results table to the PR
after the lane exits. The Playwright MCP video tools named in `skills/qa-video/SKILL.md`
apply only when the Codex session has that MCP server configured.

## Reports

On Codex, `html-report` writes a local file only, and `report-writer` is adopted in the
thread, with a `dispatched` row, rather than spawned. There is no artifact publishing.

## Reviewing another author's PR

`review-pr` runs each reviewer as a `codex exec --ephemeral --sandbox read-only -m <model>
-C <checkout>` lane. Codex does not load `agents/`, so the filled brief
(`skills/review-pr/references/reviewer-brief.md`) carries the reviewer role, the stack
checklist, and the voice path. The reviewer drafts findings and never posts. The thread
gathers the PR, diff, and checkout before any lane starts, because network access inside a
read-only lane is unverified. After every lane exits, the thread posts one COMMENT review
through `skills/review-pr/scripts/post-review.mjs` (`post`, with the installed plugin path).

## Update

After changing a local checkout, update the Codex cachebuster and reinstall:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py /absolute/path/to/vistack
codex plugin add vistack@vistack
```

Use a new thread to test the updated skill.
