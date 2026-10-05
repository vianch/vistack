# viStack deck

The deck is a Claude Code mod that ships inside viStack: a docked pane with eight tabs that
shows what a session is doing, what it costs, and what waits on you. It is a hooks module
(`hooks/hooks.json` names `hooks/register.tsx`), so it loads with the plugin. Installing or
updating viStack and running `/reload-plugins` is all it takes. It runs in the Claude Code
terminal and the desktop app's Code tab. Codex, Grok Build, and OpenCode do not load it.

## Open it

- `/deck` opens the pane, or closes it when it is open.
- `/deck cost`, `/deck 3`, or any other tab name or number opens the pane on that tab.
- In the pane, keys `1` to `8` switch tabs and `g` opens or closes lazygit.

When a session starts, the deck opens on its own if the terminal is at least 144 columns
wide. Below that width it waits until you run `/deck` or widen the terminal. Turn this off
with the `autoOpen` option.

A pane docks beside the transcript, on the right, in the fullscreen layout. Outside the
fullscreen layout it opens inline above the prompt. A mod cannot place a pane on the left.

## Tabs

| Key | Tab | Shows |
|---|---|---|
| 1 | Board | What needs a reply: an open `AskUserQuestion`, a plan waiting for approval, a question that ends the last answer, or a waiting agent. Each has a context view: what you asked, the tail of the answer, the files touched, and the cost. Also: recent asks, open PRs with CI and review state, and open work grouped as agents, tools, tasks, slices, and PRs |
| 2 | Agents | Each subagent with a nickname and an animated ASCII face picked by role, its model, tokens, cost, and time, and what Jev suggested for it. Also lists skills that ran |
| 3 | Cost | The engine's session total next to the deck's estimate, a per-model table (requests, input, output, cache share, cost), a per-execution table (each main turn and each subagent), and the chain of Jev's pick, the model actually used, the result, and the cost |
| 4 | Session | Context fill, the 5-hour and 7-day limits with reset times, recent tool calls with their durations, and model requests (input, output, cache share, time) |
| 5 | Changes | Files edited this session, read from the Edit, MultiEdit, Write, and NotebookEdit calls: lines added and removed, edit count, and how long ago. Holds the lazygit button |
| 6 | Timeline | Where the latest turn's time went: a strip of model, tool, and failed spans, totals for model, each tool, and idle, and the slowest steps |
| 7 | Flow | The workspace (directory, repository root, branch, remote, realm), viStack runs from `.claude/state/` and `.codex/vistack/state/` with each slice's phase, agent, model, PR, and blockers plus the last ledger row, and the slice worktrees |
| 8 | Recall | Search the session's prompts by keywords or a `"quoted phrase"`; pick a result to read what you asked and the answer |

## Options

Set options in `~/.claude/settings.json` under `pluginConfigs`, keyed by the plugin name. They
also appear as rows in the `/config` menu.

```json
{
  "pluginConfigs": {
    "vistack": {
      "options": { "realm": "github.com/your-org", "jevMode": "suggest" }
    }
  }
}
```

| Option | Default | Meaning |
|---|---|---|
| `realm` | empty | The host and owner whose repositories the deck may run `gh` and lazygit against, for example `github.com/your-org`. Empty means neither runs. A repository whose `origin` is outside the realm shows why it was skipped |
| `jevMode` | `suggest` | `off`: no suggestion. `suggest`: show and record the fork layer's model pick. `apply`: also set that model on built-in subagent types (`general-purpose`, `Explore`, `Plan`) that named no model. viStack's own agents keep the model their agent file names |
| `autoOpen` | `true` | Dock the deck when a session starts and the terminal is wide enough |
| `lazygitLauncher` | `auto` | Where lazygit opens: `tmux` (a split), `ghostty`, `iterm`, or `terminal` (a new window). `auto` picks tmux when inside tmux, otherwise the terminal app you run |
| `vistackRoot` | empty | The folder that holds `scripts/vistack-decision.py`. Empty looks beside the deck and then in the installed marketplace copy |

## Model suggestions

For each prompt and each subagent spawn, the deck asks the fork layer one `tier-selection`
question (`scripts/vistack-decision.py`, `--backend auto`). Deterministic policy answers first.
The tiers you turned on with `/vistack:decisions-on` answer only the split forks, Jev first.
A `mechanical` tier maps to the model in `agents/implementer.md`, and a `complex` tier maps
to the model in `agents/senior-implementer.md`. The suggestion and viStack's own dispatch
therefore agree.

The Cost tab records each suggestion as a chain: the recommended model, the model that
answered, the result, and the cost. When the consuming repository has `.claude/vistack/`,
the decision and its outcome are written to `decision-history.jsonl` there, so the fork
layer's review (`vistack-decision feedback`) sees them. Elsewhere the deck runs the
decision with `--no-history`.

The decisions run on the session's timer, never inside a hook, so a slow tier does not hold
a prompt or a spawn. The exception is `apply`, which has to decide before the spawn.

## Cost

Each model request is recorded once, keyed by its loop, turn, and position, so a subagent's
request is never counted again in the main turn. The estimate prices input, output, cache
reads, and five-minute cache writes from the table in `hooks/lib/pricing.ts` (first-party
list prices). The engine's total, `$.session.usage().cost`, is the authority. A wide gap
between the two means a price row is out of date. A model with no row shows `≈?` and marks
the estimate as partial.

API retries are not visible to a mod. The Cost tab counts failed requests (no response
arrived) and tool calls that errored.

## lazygit

A mod cannot hand the session's terminal to another program, so lazygit opens beside the
session: as a tmux split inside tmux, or otherwise as a new terminal window. It runs as
`lazygit -p <directory>`. The close button and the liveness check match that exact
command, so another lazygit you opened elsewhere is left alone.

## What the deck reads and runs

`claude plugin validate .` lists every event the module hooks and every call it makes. The
deck:

- reads files under the session's directory (`.claude/state/`, `.claude/worktrees/`,
  `.codex/vistack/`) and a checkout's `.git/HEAD` to show its branch. It runs no `git`
  command;
- runs `gh pr list` and lazygit only inside the realm;
- runs `python3 scripts/vistack-decision.py` for model suggestions, and `pgrep` or `pkill`
  for lazygit;
- reads the environment variables `HOME`, `TERM_PROGRAM`, and `TMUX`.

## Develop it

The module is TypeScript compiled by the engine:

- `hooks/register.tsx` holds the wiring.
- `hooks/lib/` holds pure logic, which the tests cover.
- `hooks/tabs/` holds one view per tab.
- `types/index.d.ts` declares the session state contract.

Two rules from `claude plugin validate` shape the code:

- `$` may only be passed to functions declared at the top level of `register.tsx`.
- Atoms are declared in the file that reads and writes them.

Check a change with:

```bash
claude plugin validate .
claude plugin test .
```

`scripts/verify.sh` runs both when the `claude` CLI is installed.
