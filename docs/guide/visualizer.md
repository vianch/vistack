# Workflow observer

The workflow observer is a dependency-free local HTML view of a run. It combines coordinator
state, agent slices, playbook and skill inventory, ledger evidence, the optional workflow graph,
and pull-request review threads in one screen.

## Start and stop it

From the repository root:

```bash
node scripts/visualizer-server.mjs --enable
node scripts/visualizer-server.mjs --status
node scripts/visualizer-server.mjs --disable
```

The default URL is `http://127.0.0.1:47319`. The server binds to localhost only. `--enable`
starts a detached server and records its PID outside the repository. `--disable` stops that
server. `--status` reports whether it is enabled and removes a stale PID record.

Run it in the foreground while debugging:

```bash
node scripts/visualizer-server.mjs --serve --port 47319
```

The HTML can also be opened directly at `visualizer/index.html`. That enables the static view,
but it cannot load live state through the API until the local server is running. Inside the page,
`HTML VIEW: ON/OFF` hides or shows the dashboard without stopping the server. `LIVE SYNC: ON/OFF`
pauses or resumes polling without stopping the server. `STOP SERVER` disables the active server
from the page.

## Data sources

The server reads these sources from the observed repository:

- `.claude/state/*.json` and `.codex/vistack/state/*.json` for runs and agent ownership
- matching `.tsv` files for the decision ledger
- `skills/*/SKILL.md` and `skills/vistack/playbooks/*.md` for the local inventory
- the newest workflow `flows.json` under `~/.claude/workflow-docs/projects`, when available
- GitHub pull requests and review threads through the authenticated `gh` CLI

The observer never requires GitHub access to start. If `gh` is unavailable, the PR panel shows
the source error and the rest of the page remains live.

To use a known workflow graph or an offline PR fixture explicitly:

```bash
node scripts/visualizer-server.mjs --enable \
  --flows /path/to/flows.json \
  --pr-data /path/to/prs.json
```

Use `--offline` to prevent GitHub calls entirely.

The PR fixture accepts either an array or this shape:

```json
{
  "pullRequests": [
    {
      "number": 42,
      "title": "Improve the review flow",
      "state": "OPEN",
      "isDraft": true,
      "url": "https://github.com/example/project/pull/42",
      "headRefName": "feature/review-flow",
      "baseRefName": "main",
      "comments": {
        "available": true,
        "addressed": 3,
        "unaddressed": 1,
        "threads": [
          { "addressed": true, "author": "reviewer" },
          { "addressed": false, "author": "maintainer" }
        ]
      }
    }
  ]
}
```

## What the page shows

- Run pulse and phase pipeline from intake through merge-ready
- Coordinator monitor status and every dispatched agent lane
- Active skill/playbook chips and the architecture columns from `flows.json`
- PR state, branch, update time, addressed review threads, and open threads
- The newest ledger decisions and evidence paths

## Architecture canvas

The Architecture panel uses the authored `components`, `categories`, and flow `steps` from
`flows.json` to render a dependency-free SVG canvas. It supports the same reader-friendly
progression as Archify: `MAP` for topology, `READ` for node context, and `FULL` for edge
labels. Use the diagram selector for Architecture, Workflow, Sequence, Data Flow, Lifecycle,
or Code Review views. Workflow-oriented types can trace a named route; Code Review scrolls to
the PR review monitor, where addressed and open threads are shown as a progress bar.

The canvas also provides light/dark themes, Signal Flow / Classic / Blueprint / Editorial
presets, node search, focus inspection, fit-to-canvas, and self-contained SVG export. These
controls are viewer-only; they do not edit the workflow source or project state.

The live overlay is built from the server snapshot rather than from guessed topology. It
surfaces the current run phase, active agent lanes, open review threads, and evidence count;
matching authored nodes and relationships pulse in the canvas. `PLAY STORY` cycles through the
named authored flows at a finite pace, and `PAUSE STORY` leaves the current route selected.

Review-thread resolution comes from GitHub's `isResolved` value. Fixture data uses the explicit
`addressed` field. A missing thread source is shown as unavailable, never as zero open comments.
