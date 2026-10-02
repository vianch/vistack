---
description: "Turn on the fork-layer decision models (Jev, Clef, Ollama, Laya) for this consuming project"
argument-hint: "[--clef-model <hub-id>|none] [--ollama-model <tag>|none] [--jev | --no-jev] [--model <hub-id>] [--config <path>]"
---

# /vistack:decisions-on

1. If `$ARGUMENTS` already has both `--clef-model` and `--ollama-model`, go to step 5.
2. Run `decisions status`. Read the `clef` block (`venv_exists`, `cached`, `server.running`)
   and the `ollama` block (`reachable`, `decision_models`, `model`):

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions status
   ```

3. Ask the user in one message, with one multiple-choice question for each flag that
   `$ARGUMENTS` does not already set. Under Claude Code, put both questions in a single
   question-tool call (AskUserQuestion); on other hosts, ask in plain text.

   **Clef:** should the local Clef-flash decision model run after Jev?

   - `Cloudflare/clef-flash` (recommended). A 9B decision model on this machine:
     - about 19 GB on disk, and about 20 GB of GPU memory while its server runs;
     - 1 to 2 s per split fork on an Apple M3 Pro;
     - on the labelled scenarios it settled 8 of 10 split forks, none wrong, at its 0.85
       threshold.

     When `clef.venv_exists` or `clef.cached` is false, say that choosing it first runs a
     setup that downloads about 19 GB.
   - `none`: no Clef tier.

   **Ollama:** which local Ollama decision model runs after Clef? Offer only installed
   models:

   - `nimble`: about 9.5 GB while loaded, 1 to 4 s per split fork.
   - `tev1:0.8b`: fastest at about 0.1 to 0.4 s, but it settled none of the measured split
     forks at the default threshold.
   - `none`: no Ollama tier.

   Name a model that is not installed with its `ollama pull <tag>` command instead of
   offering it. If Ollama is unreachable or has no decision model, skip the Ollama question,
   tell the user (`ollama serve` starts it), and continue without `--ollama-model`.

   On a machine with less than about 40 GB of memory, add to the question text that Clef and
   `nimble` together hold about 30 GB, so it is better to keep only one of them resident.
4. If the user chose Clef while `clef.venv_exists` or `clef.cached` is false, run the setup
   now. The user's choice in step 3 is the consent for the download. Show the plan, then run
   it:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions setup --clef --dry-run
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions setup --clef
   ```

   If setup fails, report the failing command it returns and continue with
   `--clef-model none`.
5. Run the switch. Omit any flag whose question was skipped:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions on --clef-model <choice> --ollama-model <choice> $ARGUMENTS
   ```

6. If Clef is on, start its server and wait for it to be ready:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions clef-start --wait 180
   ```

   The server is machine-wide: it listens on `127.0.0.1:8011`, serves every project, and
   runs until `decisions clef-stop`. Report its `pid`, `log`, and `stop_command`.
7. Report:
   - the returned `ladder`;
   - `clef`: `model`, `server.running`, `memory_gb`, `status`;
   - `ollama`: `model`, `preloaded`, `missing`;
   - `jev`: `enabled`, `key`, `refused` (never a key value);
   - `laya_mlx` and `checkpoint_cached`.

The switch is written to the host's state root, `.claude/vistack/laya.json` under Claude
Code. `--clef-model none` and `--ollama-model none` turn those tiers off. `--model` records
the Laya checkpoint, for example `convaiinnovations/laya`.

`--jev` opts this project into hosted TypeSafe Jev, which sends the bounded, redacted
decision state to TypeSafe. Clef and Ollama keep the state on the machine. Without `--jev`,
`decisions on` never adds a cloud tier.

If the report shows a Laya model with `laya_mlx: false`, offer `/vistack:laya-setup` and do
not install anything unasked.
