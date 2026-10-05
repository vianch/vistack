---
description: "Turn on the fork-layer decision models (Jev, Cloudflare, Ollama) for this consuming project"
argument-hint: "[--ollama-model clef-flash|none] [--jev | --no-jev] [--cloudflare | --no-cloudflare] [--config <path>]"
---

# /vistack:decisions-on

1. If `$ARGUMENTS` already sets `--ollama-model`, go to step 5.
2. Run `decisions status` and read its `ollama` block (`reachable`, `version`, `version_ok`,
   `supported`, `model`):

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions status
   ```

3. If `ollama.reachable` is false, skip the question. Tell the user that `ollama serve`, or
   opening the Ollama app, starts Ollama, and go to step 5 without `--ollama-model`.
   Otherwise ask one multiple-choice question. Under Claude Code, make it a single
   AskUserQuestion call; on other hosts, ask in plain text.

   **Which Ollama decision model runs on split forks after Jev and Cloudflare?**

   - `clef-flash` (recommended). Cloudflare's 9B decision model, served by Ollama on this
     machine. Measured on an Apple M3 Pro with 36 GB:
     - 10.9 GB on disk and 14.2 GB of memory while loaded, about 7 s to load;
     - about 1 s per split fork it answers;
     - on the 108 labelled scenarios it settled 7 of 10 split forks, none wrong, at its
       0.85 threshold.

     When `ollama.supported` is empty, say that choosing it first runs
     `ollama pull clef-flash`, about 11 GB. When `ollama.version_ok` is false, say that it
     needs Ollama 0.35.1 or newer.
   - `none`: no Ollama tier.
4. If the user chose `clef-flash` and `ollama.supported` is empty, pull it now. The choice
   in step 3 is the consent for the download:

   ```bash
   ollama pull clef-flash
   ```

   If the pull fails, report its error and continue with `--ollama-model none`.
5. Run the switch. Omit `--ollama-model <choice>` when step 1 or step 3 skipped the question:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/vistack-decision.py" decisions on --ollama-model <choice> $ARGUMENTS
   ```

6. Report:
   - the returned `ladder`;
   - `ollama`: `model`, `preloaded`, `missing`, `min_confidence`;
   - `jev`: `enabled`, `key`, `refused` (never a key value);
   - `cloudflare`: `enabled`, `token`, `account`, `budget.used`, `budget.remaining`,
     `budget.resets_at` (never a credential value);
   - the top-level `hint`, when there is one. It names settings left over from removed
     decision tiers and how to clear them.

The switch is written to the host's state root, `.claude/vistack/decisions.json` under
Claude Code; an earlier `laya.json` there is read once and replaced. `--ollama-model none`
turns the Ollama tier off. `decisions on` loads the model at once, so the first fork does
not pay for the load.

`--jev` opts this project into hosted TypeSafe Jev, which sends the bounded, redacted
decision state to TypeSafe. `--cloudflare` opts it into Workers AI
`@cf/cloudflare/clef-flash`, which sends the same state to Cloudflare, inside the free daily
Neurons, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` read from the environment.
Credentials alone do not opt in, and `--no-cloudflare` turns the tier off. Ollama keeps the
state on the machine. Without `--jev` or `--cloudflare`, `decisions on` never adds a cloud tier.
