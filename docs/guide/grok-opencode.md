# Grok Build and OpenCode support

viStack carries host adapters for both plugin systems.

## Grok Build

Grok Build plugins can bundle skills, commands, agents, hooks, MCP servers, and LSP servers.
The repository includes `.grok-plugin/plugin.json`, points its component paths at the existing
viStack directories, and adds `decisions-on`, `decisions-off`, and `decisions-status` commands. The commands
control the same default-on local decision engine as the Python CLI.

The xAI marketplace requires remote plugin entries to pin a full 40-character commit SHA.
The repository cannot publish an entry for an uncommitted working tree, so generate the
catalog entry after the release commit is pushed:

```bash
python3 scripts/grok-marketplace-entry.py --sha <published-commit-sha>
```

Submit that JSON object to `.grok-plugin/marketplace.json` in
`xai-org/plugin-marketplace`, then regenerate its component index with the marketplace's
`scripts/generate-plugin-index.py`. Do not use a moving branch or a placeholder SHA.

Grok Build loads `skills/qa-video/` with the other skills. Its script runs from the
installed plugin path, the same way as on Codex (`docs/guide/codex.md`).

Install from the Grok Build terminal after the marketplace change is accepted:

```bash
grok plugin marketplace list
grok plugin install vistack --trust
```

Grok's marketplace warning applies: third-party plugins can execute code and access local
data. Review the pinned source and the local Python/OpenCode bridges before trusting it.

## OpenCode

OpenCode loads `.opencode/plugins/*.js|ts` from a project or global config directory, or
loads an npm package named in `opencode.json`. The native bridge is at
`integrations/opencode/vistack.js`; installation instructions are in
`integrations/opencode/README.md`.

It exposes `vistack_decision`, `vistack_decisions_toggle`, and `vistack_qa_video`. The first
calls the typed decision API. The second runs the same `decisions on`, `decisions off`, and
`decisions status` commands used by the other hosts, and passes `ollama_model` to
`decisions on` as `--ollama-model`. The default is on, but the bridge still falls back to
deterministic policy when Jev or the Ollama model is unavailable.

`vistack_qa_video` runs `skills/qa-video/scripts/qa-video.mjs` with `command` set to `doctor`,
`record`, `finish`, or `check`, and `args_json` holding the CLI arguments as a JSON array.
Credentials stay in the environment, never in `args_json`. The contract is
`skills/qa-video/SKILL.md`.

The bridge starts the Python helper per request. For high-frequency orchestration, run
`python3 scripts/vistack-decision.py serve` and adapt the bridge to a supervised JSONL process
owned by the consuming project. Do not hide a long-lived process behind an OpenCode hook
without recording its owner and stop condition.

The bridge needs the helper, the `laya/` package, and `skills/qa-video/`. When the bridge is
copied into a different project, set `VISTACK_ROOT=/path/to/vistack` or copy those three paths
into the consuming project. Its toggle file remains project-local at `.codex/vistack/laya.json`.
