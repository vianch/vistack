# Grok Build and OpenCode support

viStack carries host adapters for both plugin systems.

## Grok Build

Grok Build plugins can bundle skills, commands, agents, hooks, MCP servers, and LSP servers.
The repository includes `.grok-plugin/plugin.json`, points its component paths at the existing
viStack directories, and adds `laya-on`, `laya-off`, and `laya-status` commands. The commands
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

It exposes `vistack_decision` and `vistack_laya_toggle`. The first calls the typed decision
API. The second runs the same `laya on`, `laya off`, and `laya status` commands used by the
other hosts. The default is on, but the bridge still falls back to deterministic policy when
the model or MLX runtime is unavailable.

The bridge starts the Python helper per request. For high-frequency orchestration, run
`python3 scripts/vistack-decision.py serve` and adapt the bridge to a supervised JSONL process
owned by the consuming project. Do not hide a long-lived process behind an OpenCode hook
without recording its owner and stop condition.

The bridge needs the helper and `laya/` package. When the bridge is copied into a different
project, set `VISTACK_ROOT=/path/to/vistack` or copy those two paths into the consuming
project. Its toggle file remains project-local at `.codex/vistack/laya.json`.
