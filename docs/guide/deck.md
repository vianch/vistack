# viStack deck

The deck is a Claude Code mod that ships inside viStack: a docked pane with nine tabs that
shows what a session is doing, what it costs, and what waits on you. It is a hooks module
(`hooks/hooks.json` names `hooks/register.tsx`), so it loads with the plugin. Installing or
updating viStack and running `/reload-plugins` is all it takes. It runs in the Claude Code
terminal and the desktop app's Code tab. Codex, Grok Build, and OpenCode do not load it.

## Open it

- `/deck` opens the pane, or closes it when it is open.
- `/deck cost`, `/deck 3`, or any other tab name or number opens the pane on that tab.
- In the pane, keys `1` to `9` switch tabs, `g` opens or closes lazygit, and `t` cycles the
  Decisions tab's type filter through all 12 decision types.

When a session starts, the deck opens on its own if the terminal is at least 144 columns
wide. Below that width it waits until you run `/deck` or widen the terminal. Turn this off
with the `autoOpen` option.

A pane docks beside the transcript, on the right, in the fullscreen layout. Outside the
fullscreen layout it opens inline above the prompt. A mod cannot place a pane on the left.

## Tabs

| Key | Tab | Shows |
|---|---|---|
| 1 | Board | What needs you, first, then what is running. Top to bottom: a status line (what the coordinator is doing and for how long, team size, advisor consults, cost, context fill); a delegates line that reads "coordinator delegates only" or counts the code edits the coordinator made itself; **Needs reply** (an open `AskUserQuestion`, a plan waiting for approval, a question that ends the last answer, or a waiting agent, each with a context view of what you asked, the tail of the answer, the files touched, and the cost); **Now** (running agents with face, nickname, what each is doing, and elapsed time, up to 5, then the coordinator's own running tool); **Last fork** (the newest fork on two lines, with a pointer to Decisions); **Monitors**, **Open PRs** (with CI and review state), and **Review watch**, each a fold; **Recent asks** (the last 3); and **Pending** (open tools, tasks, slices, and PRs, shown only when there are some). See below for Monitors |
| 2 | Agents | Each subagent with a nickname (drawn from a pool of 16 per role) and an animated ASCII face picked by role, its model, tokens, cost, and time, and what the fork layer suggested for it. The advisor seat counts its consults and shows the last one: model, tokens in and out, cost, and how long it took, then the first line of its advice, "advice redacted", or the error. A server-side advisor consult appears when the model request that made it ends, because the engine gives a mod no signal while it runs. A fallback advisor subagent shows "advising" until it answers. Comms, the messages between you, the coordinator, and the agents, are listed here and nowhere else. Also lists the skills the Skill tool ran, one row per finished call |
| 3 | Cost | The engine's session total next to the deck's estimate, a per-model table (requests, input, output, cache share, cost) that counts the advisor's consults under the advisor's model, cost by member as bars, a per-execution list (each main turn and each subagent, the newest 8), and Fork picks: the newest three forks on two lines each, with a pointer to Decisions for the full chain |
| 4 | Session | Context fill, the 5-hour and 7-day limits with reset times, recent tool calls with their durations and a tool histogram, Activity (tool calls per minute as a sparkline), and model requests (input, output, cache share, time) |
| 5 | Changes | The working tree, laid out like lazygit's Files panel and read-only. A header gives the branch with ahead and behind counts, then the last commit's short hash, subject, and age. Below it come the groups Staged, Unstaged, Untracked, and Conflicts, each with its file count and one row per file: a status letter, the path, and lines added and removed. A file with both staged and unstaged changes appears in both groups. A `·` marks a file the session edited. Pressing a row opens a diff preview of up to 24 lines under it, and pressing it again closes it. A Refresh button and the lazygit button sit above. A **This session** list follows: files edited, read from the Edit, MultiEdit, Write, and NotebookEdit calls, with lines added and removed, edit count, and how long ago. Outside the realm the working tree says why it is off, and the session list still shows |
| 6 | Timeline | Where the latest turn's time went: a strip of model, tool, and failed spans, totals for model, each tool, and idle, and the slowest steps. An advisor consult adds no span: its time is inside the request that made it |
| 7 | Flow | The workspace (directory, repository root, branch, remote, realm), viStack runs from `.claude/state/` and `.codex/vistack/state/` with each slice's phase, agent, model, PR, and blockers plus the last ledger row, and the slice worktrees |
| 8 | Decisions | A Types block with one row per decision type, then the fork layer: its mode, its ladder with each tier's readiness, how and when forks are asked, and this session's tally by backend and by type, then every fork of every decision type this session, the deck's and the main session's, newest first, filtered by type with `t`. Pressing a row shows the whole chain. See [Decisions](#decisions) |
| 9 | Settings | Where the pane docks, theme, icon set, animations, the git realm, and a reset to defaults |

## Monitors and loops

The Board has a Monitors fold for background shells, `Monitor` watches, agents, workflows,
`/loop` wakeups, and scheduled crons. The fold's heading counts running and active rows, and
pressing it opens or closes the block. Inside, rows are listed in three groups, Running,
Active, and Ended (the last 10). Ended is folded behind `show ended (n)`. The Open PRs and
Review watch blocks fold the same way. Which folds are open is kept in the deck's store
(`deckFolds`), so it persists across sessions.

Each row is in one of seven states:

| State | Meaning |
|---|---|
| running | Executing now: a shell, a watch, an agent, or a workflow |
| active | Armed and waiting for its next fire: a cron or a `/loop` wakeup |
| done | Finished on its own |
| stopped | Ended by `TaskStop`, from the deck or the session |
| canceled | A cron deleted with `CronDelete`, or a `/loop` wakeup stopped |
| killed | The engine reported the task as killed. The row shows the engine's word |
| dead | The task failed or errored, or it left the engine's list with no end report |

The deck learns that background work ended from the session's task notifications, so a task
whose notification never arrives stays running until you press Stop. A watch past its
deadline with no report ends `dead` after a two-minute grace. When the deck has seen no end
report this session, it ends the watch as `done` and adds "no end report seen" to the row.
A report that arrives later replaces the guess. Starts come from the session's tool calls,
crons are read every 20 seconds while the Board is visible and when you press Refresh, and
the deck rescans for finished work when a main-session turn completes.

The deck reads only events that run for a user-tier plugin. An account's built-in
`cc-plugin-sec-default` routes `classic.*` (such as Stop and TaskCreated), `skill.prompt`,
`prompt.section`, `prompt.context`, `prompt.compose`, `attribution.text`, and `settings.read`
past such a plugin, so a hook on one never runs. The skills list and the Tasks open block
come from `tool.call` (`Skill`, `TaskCreate`, `TaskUpdate`, `TodoWrite`), and
`scripts/check-playbooks.mjs` fails a hook on a bypassed event.

### Review watch block

When `state.json` exists, the Board also draws a Review watch fold after Open PRs. The header
reads `on · <realm>` or `off`. The loop line reads "armed · rotates in …", "arming…",
"turning off…", or "not armed in this session", followed by "· last pass <ago>"; an error line, such as
"command not loaded" or "names no valid realm", sits under it. Below come the needs-you items,
in a warning color; the clean reviews, titled "reviewed, nothing to flag, awaiting your approval
(n)"; and the last 5 posts. Pressing a row shows its URL. A two-press Turn off button (no
hotkey) shows while the watch is on and no off is pending. Cancel on the watch's row, and Stop
all while a watch row is open, also switch the watch off. The deck arms the loop at session
start in an interactive session inside the realm, unless a pass ran within 40 minutes, and
starts a fresh one before the 7-day expiry. See [`review-watch.md`](review-watch.md).

### Buttons

- A running row has Stop. An active row has Cancel. Each needs a second press to confirm.
- "Stop all" stops every running row, with the same second press.
- An ended row has Relaunch, or the reason it cannot be relaunched.

Relaunch re-runs the row from what the deck recorded when it started:

| Kind | Relaunch does |
|---|---|
| Shell | Runs the recorded command again in the background, when the command was recorded in full |
| Watch | Starts the same `Monitor` again |
| Agent | Hires a background agent again from its recorded prompt |
| Cron | Creates the same cron again. A cron that a `/loop` made runs that `/loop` again |
| `/loop` wakeup | Runs `/loop` again with the recorded arguments |

These cannot be relaunched, and the row says why: a row that is still running or active; a
workflow; a remote agent; a run monitor, which is a claim read from a state file; the cron
of an autonomous loop, which belongs to the session that started it; a `/loop` wakeup that
runs without a recorded prompt; and a shell whose command was cut short or never recorded.

Relaunch and New loop go through the session's permission check, the same as a tool call
the model makes, so a dialog can appear.

### New loop

The form sits behind a `New loop` fold, closed by default. It takes an interval (self-paced, `5m`, `10m`, `30m`, or `1h`) and a
prompt. Run, or Enter in the prompt, sends `/loop <interval> <prompt>` as if you had typed it,
and it waits until the session is idle. An empty prompt does nothing. A loop started this way,
or typed as `/loop ...`, can be relaunched later. The form is not drawn on surfaces without
text inputs or selectors.

### Keep awake

A chip and a selector set whether the machine may sleep: Off, While working (the default), or Always.
While working holds the lock while agents, turns, or monitors are in flight, and for two
minutes after. It counts work scheduled within 30 minutes, so a 30-minute `/loop` keeps the
machine awake for as long as the loop lives. Choose Off to let it sleep. Always holds the
lock all session. The setting is kept apart from the look settings, so Reset leaves it alone.

A lock prevents idle sleep and display sleep. It cannot stop a shutdown or a restart, and on
macOS closing the lid on battery still sleeps.

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
| `jevMode` | `suggest` | `off`: no suggestion. `suggest`: show and record the fork layer's model pick. `apply`: also set that model on built-in subagent types (`general-purpose`, `Explore`, `Plan`) that named no model. The deck never changes viStack's own agents; the coordinator picks their model with `model-selection` |
| `autoOpen` | `true` | Dock the deck when a session starts and the terminal is wide enough |
| `lazygitLauncher` | `auto` | Where lazygit opens: `tmux` (a split), `ghostty`, `iterm`, or `terminal` (a new window). `auto` picks tmux when inside tmux, otherwise the terminal app you run |
| `vistackRoot` | empty | The folder that holds `scripts/vistack-decision.py`. Empty looks beside the deck and then in the installed marketplace copy |

## Decisions

The deck asks the fork layer itself at three moments, for three of the 12 decision types:

- **Every prompt**, `tier-selection`: when a turn starts, the deck asks about the prompt.
- **The match path**, `playbook-selection` and `intake-analysis` as well: on the session's
  first prompt, or a prompt that begins with `new task`, the deck also asks which playbook
  fits the prompt as typed and what intake makes of it.
- **Every subagent spawn**, `tier-selection`: the deck asks about the spawn's description and
  prompt. In `apply` mode it decides before the spawn, because the answer sets the model.

The other nine types come from the coordinator's own calls at the boundaries in
`skills/laya-decision/SKILL.md`, which the deck reads from the decision history (below). The
deck does not ask them because each needs fields only the coordinator holds.
`dispatch-readiness` is the clearest case. The deck has no brief, acceptance criteria,
verification command, or writable files to send, so the policy would answer `hold` at .99 for
every request, a confident and misleading answer.

Three inputs are not asked, because the engine sees only the request text and would tier them
as slices: a subagent's hand-back (a prompt that opens with `<agent-message`), a background
task's end (`<task-notification`), and the spawn of a read-only role (advisor, analyst,
groomer, health-check, planner, researcher, reviewer, whatever prefix it carries).
Each leaves a row led by `not a slice`, with the reason on its final line. It counts as
`not asked` in this session's tally, never as a fork asked, and the Types block leaves it out.
A fork the engine itself marks `outputs.slice_like` false (`docs/guide/decision-engine.md`)
also leads with `not a slice`; that one was asked, so it counts.

Each question the deck asks is one call:

```
python3 scripts/vistack-decision.py decision <type> --backend auto [--history <file> | --no-history] [--config <file>]
```

with `{"metadata": {"source": "main-turn" | "agent-spawn"}, "task": {"request": "<text, at most 2400 characters>"}}`
on stdin. Deterministic policy answers first. The tiers you turned on with
`/vistack:decisions-on` answer only the split forks, Jev first, then the Cloudflare and Ollama
tiers. A `mechanical` tier maps to the model in `agents/implementer.md`, and a `complex` tier
maps to the model in `agents/senior-implementer.md`. The suggestion and viStack's own dispatch
therefore agree on the default, which the coordinator's `model-selection` may move.

The decisions run on the session's timer, never inside a hook, so a slow tier does not hold
a prompt or a spawn. The exception is `apply`, which has to decide before the spawn.

After each fork the deck asks with history on, it re-reads the history file once (a read
already queued is not queued again), so the Types block and the main session's rows catch up without waiting for
the next Bash call.

When the consuming repository has `.claude/vistack/`, the decision and its outcome are written
to `decision-history.jsonl` there, so the fork layer's review (`vistack-decision feedback`)
sees them. Elsewhere the deck runs the decision with `--no-history`.

### Forks from the main session

The deck reads the main session's CLI forks from the same file, with the status above and
after each Bash call of `vistack-decision.py decision`: the last 200 `decision` rows of any
type, stamped at or after the second the session started, one per decision id, marked `$`.
Rows the deck wrote (`metadata.source` `main-turn` or `agent-spawn`) and lines that are not
JSON are skipped. A history over 4 MiB, the read limit, shows nothing.

### The Types block

The top of the tab lists all 12 decision types in the engine's order, plus any other type the
history holds, so a type nobody asked is visible. The heading counts the types asked this
session. Each row has these columns:

| Column | Shows |
|---|---|
| `type` | The decision type |
| `now` | Forks asked this session. The deck's skipped inputs are not counted |
| `all` | Forks in the whole history file; `-` when the file could not be read and the status gave no count |
| `margin` | Mean confidence over the history, read as a margin (see the legend below) |
| `fall` | Share of those forks the deterministic fallback answered, meaning no tier settled them |
| `by` | Who asks the type: `deck` for the three above, `coord` for the other nine |
| `last` | The last action, or `never asked` when the session and the history hold no fork of that type. A `tier-selection` the engine marked not a slice reads `not a slice` |

A row with no forks is dim, and the row for the active filter is in the accent color. A pane
too narrow for `last` cuts each row at its width. A legend line under the block explains the
columns. Filtering to a type with no fork this session says who asks it and when
(`the coordinator asks it before each dispatched ledger row`), so an empty filter reads as a
call not yet made, not as a bug. The coordinator's side is in `skills/laya-decision/SKILL.md`,
Boundaries: a boundary call it skipped shows here as `never asked`.

### The fork layer block

Below the Types block, the block shows the fork layer as the deck last read it:

- **Mode**, from the `jevMode` option, in the `Fork layer` heading as `jevMode <mode>`, with
  the number of forks in the engine's history (`· N in history`).
- **Ladder**, the tiers in the order they are tried, each with its readiness: policy; Jev with
  its key present or missing, or a recent refusal; Cloudflare with the Neurons used out of the
  daily cap, or a missing token or account; Ollama reachable, down, or its model not pulled.
  Jev and Cloudflare show as off until you opt in. When the models are off, the block says
  the policy answers alone and names `/vistack:decisions-on`.
- **Asked on**: each prompt and each subagent spawn with `tier-selection`, and in `apply` mode
  before a built-in spawn. **And on** the first prompt or `new task`: `playbook-selection` and
  `intake-analysis`. **Not asked, no slice** names the three skipped inputs. **Other types**
  names the coordinator's CLI calls, read from the decision history, and shows even when the
  status failed.
- **How**: the command, the stdin shape, and the history file in use.
- **History by type**: forks per type across the whole history, with the mean confidence,
  from `decisions status`'s `forks.by_type`.
- **This session**: forks asked, how many were sharp and how many split, a count per answering
  tier, the count of failed and still-asking forks, and `not asked` for the skipped inputs.
  The per-type count is the Types block's `now` column.
- **A legend line**, `confidence = the margin between a model's top two odds`. Jev's
  confidence is that margin (a .73 and .27 split reads .46), not a chance of being right, so a
  rejection note reads `margin 0.300 is below 0.650`, where the engine's text says
  `confidence`.

The deck reads this with `python3 scripts/vistack-decision.py decisions status`, which sends
nothing off the machine and never probes a backend. It runs at session start, on the deck's
Refresh, on the tab's own Refresh button, and after `/vistack:decisions-on` or
`/vistack:decisions-off` runs, whether as a command or as a `vistack-decision.py decisions
on|off` call in Bash. A status that fails shows `decisions status failed:` with the reason.

Nothing fails silently. When `jevMode` is `off` the tab says "model suggestions are off
(jevMode)" and asks nothing. When the script cannot be found it says "vistack-decision.py not
found: set the vistackRoot option", and a fork the deck tries anyway turns into a failed row
reading `script not found`.

### A fork row

A row appears when the fork is asked and changes in place as the process returns. It takes two
lines. The first holds the time, a mark for the trigger, the decision type unless it is
`tier-selection`, and the subject: the prompt, the request, or for a subagent the nickname and
its description. The second leads with what was chosen, then the confidence, the tier that
answered, whether the fork was sharp or split, how long the call took, and `applied` when the
deck set that model:

```
10:04 ⌨ fix the failing upload test
   complex ▸ Opus 5.5 · .94 · jev · sharp · 0.5s
10:04 ⌨ playbook-selection fix the failing upload test
   playbook ▸ bug-fix · .92 · policy · sharp · 0.4s
10:12 $ model-selection implement slice A
   model ▸ step-up ▸ Opus 5.5 · .88 · policy · sharp
10:13 $ dispatch-readiness implement slice A
   dispatch ▸ hold · .99 · policy · sharp
```

Other types lead with a short label and the action (`intake`, `grooming`, `slices`,
`dispatch`, `progress`, `verify`), the chosen option (`tool`, `file`), or the action alone
(`skill-improvement`). A pick saved by an earlier deck, with no action, reads as a tier row.
`t`, or the `type:` button, cycles the filter: all, then each of the 12 types in the
engine's order, whether or not this session holds one, then any other type seen. The deck
keeps the choice in its store.

- `asking the fork layer…` means the process has not returned yet.
- `failed: …` means there is no answer: the exit code and the first line of its error, `parse
  failed` when the output was not a decision, or `script not found`. The row stays, in red.

### The expanded detail

Pressing a row shows the whole chain:

- **asked**: the time, the trigger, the decision type, and how long the call took.
- **sent**: the metadata source and the size of the request, then the command and the history
  file.
- **policy**: whether the deterministic policy answered sharp or split, and its rationale.
- **ladder**: one mark per rung, then a line for each rung that was rejected or unavailable,
  with the reason, or that answered, with its tier and confidence. A rung that answered under
  its floor ends its line with `agrees: <action>` or `dissents: <action>`, against the
  policy's action.
- **votes**, when the engine reported any: `corroborated by` the tiers that agreed under their
  floors, `dissent` from the tiers that did not, `margins` per tier, and `model`, the model
  that served the answer (`jev-latest` is unpinned, so this is the record). These keys are
  left out of the `out` lines.
- **P** and **signals**: the probability for each tier, the contract-change score, the signals
  that pointed to complex or mechanical, the flags, and whether a pattern or a tier mismatch
  was found.
- **type** and **out**, for any type but `tier-selection`: the type and action, then one line
  per output key with its value, eight at most, each cut to the line.
- **final**: tier, then role, then model, then the apply reason (below). For a request that is
  not a slice, `not a slice` and either the skip reason or `no model to suggest`. For any
  other type, what was chosen, marked advisory.
- **ran**: the model that actually ran and whether it matched, how the unit ended, its cost,
  and, once the outcome reached `decision-history.jsonl`, `outcome recorded` with the
  decision id. Any other type shows its decision **id** instead.
- **else**, **needs**, **changes if**, and **risks**: the alternatives the engine weighed, the
  evidence it wants before the choice holds, what would change it, and its risks.

### The apply reason

The last part of the final row says why the suggested model was or was not set. The deck
checks in this order, and the first match is the reason:

| Case | Reason shown |
|---|---|
| a skipped input | `<reason>: the deck asked nothing` |
| the deck set the model | `applied` |
| the fork came from a prompt | `advisory: a prompt has no model to set` |
| the main session asked it by CLI | `advisory: the main session asked it and decides` |
| a pick saved by an earlier deck, with no subagent type | `suggested; an earlier deck kept no reason` |
| the caller named a model | `kept the caller's model` |
| a viStack role (`vistack:` prefix) | `the coordinator picks this role's model (model-selection)` |
| a subagent type outside `general-purpose`, `Explore`, `Plan` | `the deck sets only general-purpose, Explore, Plan` |
| `jevMode` is not `apply` | `suggest mode; jevMode=apply would set it` |
| none of the above | `not applied: the answer named no model` |

### How the ladder line is derived

The deck builds the ladder from the answer, not from the configuration alone. Policy comes
first. The tier named in the answer's `backend` is the one that answered, and a tier whose
rationale ends "<tier> agreed at N." is marked as having agreed, at N. Each tier the
engine reported as "<tier> unavailable or rejected: <reason>" shows with that reason, cut to
60 characters, and counts as rejected when the reason names a gate or a malformed answer, and
as unavailable otherwise. Tiers after the answering one were skipped. A `deterministic`
answer was sharp and stopped at policy; a `deterministic-fallback` answer was split with no
tier to settle it, so it goes to the main session.

## Cost

Each model request is recorded once, keyed by its loop, turn, and position, so a subagent's
request is never counted again in the main turn. The estimate prices input, output, cache
reads, and five-minute cache writes from the table in `hooks/lib/pricing.ts` (first-party
list prices). The engine's total, `$.session.usage().cost`, is the authority. A wide gap
between the two means a price row is out of date. A model with no row shows `≈?` and marks
the estimate as partial.

A request's usage leaves out the advisor's tokens. The deck reads each server-side consult's
model and tokens from the session transcript and prices them as a request of their own,
under the turn that made it when the deck saw that turn. A consult whose transcript rows
cannot be read shows its time and result with no price. A fallback advisor subagent is
priced from its own requests, once.

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
  `.codex/vistack/`) and a checkout's `.git/HEAD` to show its branch;
- runs `gh pr list` and lazygit only inside the realm. Inside the realm it also runs read-only
  git for the Changes tab, all as `git -C <root>`: `status --porcelain=v2 --branch`,
  `diff --numstat` and `diff --numstat --cached`, `log -1`, and, when you press a row,
  `diff` for that one file (`diff --no-index` against `/dev/null` for an untracked file).
  It reads the tree when the tab opens, every 10 seconds while the tab is showing, after a
  file edit, after a Bash `git` command that changes the tree, and on Refresh. It never
  stages, commits, stashes, or checks out. Outside the realm it reads only `.git/HEAD`;
- runs `python3 scripts/vistack-decision.py decision tier-selection` for each fork,
  `decision playbook-selection` and `decision intake-analysis` on the match path, and
  `python3 scripts/vistack-decision.py decisions status` for the fork layer block, and reads
  `.claude/vistack/decision-history.jsonl` with it. The status call sends nothing and never
  probes a backend. It also runs `pgrep` or `pkill` for lazygit;
- runs `sh -c 'grep …'` for the advisor's rows in this session's transcript,
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/*/<session id>.jsonl`;
- reads the review watch's `state.json` (under `VISTACK_REVIEW_WATCH_DIR`, else
  `~/.vistack/review-watch/`) every 5 minutes and on Refresh, and sends
  `/loop 30m /vistack:review-watch pass --realm <realm>` to arm the watch once the session is
  idle. To turn it off, it runs `node <plugin root>/skills/review-watch/scripts/watch-state.mjs
  off` with `VISTACK_REVIEW_WATCH_DIR` set to the directory it read, retries exit 1 (write lock
  held) up to 3 attempts 2 s apart, and falls back to sending `/vistack:review-watch off`;
- keeps the shown or hidden state of each fold in the plugin's store under `deckFolds`;
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
