---
description: "Turn on the fork-layer decision models (Jev, Ollama, Laya) for this consuming project"
argument-hint: "[--ollama-model <tag>|none] [--jev | --no-jev] [--model <hub-id>] [--config <path>]"
---

# /vistack:decisions-on

1. If `$ARGUMENTS` already has `--ollama-model`, go to step 3.
2. Run `decisions status` and read `ollama.reachable`, `ollama.decision_models`, and
   `ollama.model`:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions status
   ```

   Ask the user one multiple-choice question: which local Ollama decision model backs Jev.
   Offer only installed models:

   - `nimble` (recommended): stronger, about 9.5 GB while loaded, 1 to 4 s per split fork.
   - `tev1:0.8b`: fastest at about 0.1 to 0.4 s, but it settled none of the measured split
     forks at the default threshold.
   - `none`: no Ollama tier.

   Name a model that is not installed with its `ollama pull <tag>` command instead of
   offering it. If Ollama is unreachable or has no decision model, skip the question, tell
   the user (`ollama serve` starts it), and continue without `--ollama-model`. Under Claude
   Code use the question tool (AskUserQuestion); on other hosts ask in plain text.
3. Run, omitting `--ollama-model <choice>` when step 2 was skipped:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions on --ollama-model <choice> $ARGUMENTS
   ```

4. Report the returned `ladder`, `ollama` (`model`, `preloaded`, `missing`), `jev`
   (`enabled`, `key`, `refused`; never a key value), `laya_mlx`, and `checkpoint_cached`.

The switch is written to the host's state root, `.claude/vistack/laya.json` under Claude
Code. `--model` records the Laya checkpoint, for example `convaiinnovations/laya`.
`--ollama-model none` turns the Ollama tier off. `--jev` opts this project into hosted
TypeSafe Jev, which sends the bounded, redacted decision state to TypeSafe; Ollama keeps it
on the machine. Without `--jev`, `decisions on` never adds a cloud tier. If the report shows
a Laya model with `laya_mlx: false`, offer `/vistack:laya-setup` and do not install
anything unasked.
