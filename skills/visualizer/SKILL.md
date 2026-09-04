---
name: visualizer
description: "Start, stop, or inspect the local workflow observer. Use for visualizer on, visualizer off, visualizer status, or requests to watch coordinator state, agent lanes, skills, playbooks, run state, pull requests, and review threads."
---

# visualizer

Control the local workflow observer through its existing server script. Do not create a
second server, copy the dashboard, or mutate project state beyond the observer's lifecycle.

## Invocation

The supported form is `vistack:visualizer <action> [options]`.

| Action | Effect | Command delegated to the server script |
|---|---|---|
| `on` or `start` | Start the detached local observer and report its URL | `node <plugin-root>/scripts/visualizer-server.mjs --enable` |
| `off` or `stop` | Stop the observer; safe when it is already stopped | `node <plugin-root>/scripts/visualizer-server.mjs --disable` |
| `status` | Report whether it is running, its URL, PID, port, and observed repository | `node <plugin-root>/scripts/visualizer-server.mjs --status` |

Resolve `<plugin-root>` from the installed skill location. When the skill is being run from
this repository, use `node scripts/visualizer-server.mjs`. Pass `--repo` with the absolute
path of the consuming repository so the dashboard reads that repository's state, ledgers,
skills, playbooks, and pull requests. Use `--repo "$PWD"` when the current directory is the
repository to observe.

## Options and rules

- Pass `--port`, `--host`, `--flows`, `--pr-data`, or `--offline` through to the server when
  the user or project setup requires them.
- Keep the observer on localhost unless the user explicitly requests another bind address.
- `on` must report the URL printed by the server. Do not open a browser automatically.
- `off` and `status` are idempotent. A stale PID record may be removed by the server.
- If the action is missing or unsupported, print the three supported actions and make no
  lifecycle change.
- The observer is read-only with respect to workflow data. It does not open, edit, merge, or
  comment on pull requests.

## Examples

```text
vistack:visualizer on
vistack:visualizer status
vistack:visualizer off
```

For a project outside the plugin checkout:

```text
vistack:visualizer on --repo /absolute/path/to/project
```
