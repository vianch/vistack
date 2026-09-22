# OpenCode integration

OpenCode loads JavaScript or TypeScript plugins from `.opencode/plugins/` or from an npm
package. The bridge in `integrations/opencode/vistack.js` exposes two tools:

- `vistack_decision` calls the local typed decision API.
- `vistack_laya_toggle` runs `laya on`, `laya off`, or `laya status` for the current project.

For a local checkout, copy or symlink the bridge into the consuming project:

```bash
mkdir -p .opencode/plugins
cp /path/to/vistack/integrations/opencode/vistack.js .opencode/plugins/vistack.js
```

The bridge expects the Python helper and `laya/` package to be available from the consuming
project. If viStack is checked out elsewhere, point it at that checkout instead:

```bash
export VISTACK_ROOT=/path/to/vistack
```

Alternatively, copy `scripts/vistack-decision.py` and the `laya/` directory into the project.
The bridge stores the toggle at `.codex/vistack/laya.json` in the consuming project.

OpenCode will load the file at startup. The bridge uses Node/Bun built-ins and the official
`@opencode-ai/plugin` helper. It starts the Python helper per tool call, so the deterministic
fallback remains available even when MLX is not installed. Use the Python JSONL server
separately when repeated decisions need a resident MLX model.

The bridge is advisory. It does not grant permission to dispatch, merge, deploy, change
secrets, delete data, or bypass viStack fences.
