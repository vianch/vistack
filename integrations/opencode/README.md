# OpenCode integration

OpenCode loads JavaScript or TypeScript plugins from `.opencode/plugins/` or from an npm
package. The bridge in `integrations/opencode/vistack.js` exposes three tools:

- `vistack_decision` calls the local typed decision API.
- `vistack_decisions_toggle` runs `decisions on`, `decisions off`, or `decisions status` for the
  current project. With `action` set to `on`, the optional `ollama_model` argument is passed as
  `--ollama-model`.
- `vistack_qa_video` runs the QA video script (`skills/qa-video/scripts/qa-video.mjs`) with
  `command` (`doctor`, `record`, `finish`, or `check`) and `args_json`, a JSON array of CLI
  arguments. Pass credentials through the environment, never in `args_json`. A step failure
  returns the JSON report instead of an error, so the agent can cite it.

For a local checkout, copy or symlink the bridge into the consuming project:

```bash
mkdir -p .opencode/plugins
cp /path/to/vistack/integrations/opencode/vistack.js .opencode/plugins/vistack.js
```

The bridge expects the Python helper, the `laya/` package, and `skills/qa-video/` to be
available from the consuming project. If viStack is checked out elsewhere, point it at that checkout instead:

```bash
export VISTACK_ROOT=/path/to/vistack
```

Alternatively, copy `scripts/vistack-decision.py`, the `laya/` directory, and
`skills/qa-video/` into the project. The QA video tool also needs Playwright in the
project's `node_modules`.
The bridge stores the toggle at `.codex/vistack/laya.json` in the consuming project.

OpenCode will load the file at startup. The bridge uses Node/Bun built-ins and the official
`@opencode-ai/plugin` helper. It starts the Python helper per tool call, so the deterministic
fallback remains available even when MLX is not installed. Use the Python JSONL server
separately when repeated decisions need a resident MLX model.

The bridge is advisory. It does not grant permission to dispatch, merge, deploy, change
secrets, delete data, or bypass viStack fences.
