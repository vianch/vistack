---
name: figma-sync
description: "Keep a live line to Figma while implementing a design: resolve the file key and node id for every frame, ask precisely for any missing URL, node id, breakpoint, or state, pull structure, design context, variables, and Code Connect mappings through the Figma MCP server, map tokens and primitives to the repository, and re-query before every frame and before QA. Use whenever Figma is the source of truth."
---

# figma-sync

Figma is the source of truth, so it is read live, often, and by node. A screenshot is a
reference; the node is the source. Nothing is guessed: not a node id, not a token, not a
state the design does not show.

## Access

Use the Figma MCP server configured for the host: the Figma connector in Claude Code, or the
Figma MCP server in the Codex or OpenCode configuration. The tool names are the same on every
host. Before the first design-context call, load Figma's own `figma-design-to-code` guidance —
the Figma plugin skill, or the `skill://figma/figma-design-to-code/SKILL.md` resource — and
follow it. This skill adds viStack's contract on top; it does not replace Figma's.

A missing Figma MCP server is a blocker: park the slice and name the setup step. Missing or
expired Figma authentication, or a file the account cannot open, is FENCE 4. Never work from
pasted pixels instead. An agent with an explicit `tools:` list cannot see MCP tools, so a
Figma role omits that list.

## Resolve every source

A design input is complete when every frame in scope has all of these:

| Input | Where it comes from |
|---|---|
| File key | the URL: `figma.com/design/<fileKey>/<name>`; for a branch URL, the branch key |
| Node id | the URL's `node-id=12-34`, written `12:34`; never guessed |
| Breakpoints | frames per breakpoint, or the user |
| States | variants or frames for hover, focus, active, disabled, loading, error, empty |
| Design-system library | the library that owns the variables and components |

When a URL has no `node-id`, call `get_metadata` without one to list the pages, then ask for
the node-specific URL. Do not pick a frame on the user's behalf.

## Ask once, precisely

Collect every missing input, then ask in one message. List each item: the frame, what is
missing, and the exact form of the answer — "the node-specific URL for the mobile checkout
frame (right-click the frame → Copy link to selection)". Do not ask what Figma can answer.

In an unattended run, a missing input parks that slice as blocked with the question as its
dossier, and independent slices keep running. A missing input that changes acceptance
criteria is FENCE 2; missing access is FENCE 4.

## Pull the design, per frame

For each node, in this order:

1. `get_metadata` — the structure and child node ids.
2. `get_design_context` with the file key, node id, and the project's frameworks and
   languages — the reference code, assets, and a screenshot. Adapt it to the repository's
   components and tokens; never paste it verbatim.
3. `get_variable_defs` — the variables the node uses: colors, spacing, radii, type.
4. `get_code_connect_map` — which repository component each design component maps to.
5. `search_design_system` — one batched call for the components, variables, or styles the
   first four left unresolved.
6. `get_screenshot` — the parity reference, downloaded to the evidence folder.

Record the file key, node ids, and the variable and mapping results under
`<state-root>/<slug>/figma/` so a resumed run starts from the same sources.

## Map tokens and primitives

- **Tokens.** Map every Figma variable to a repository token. A variable with no repository
  token, or a raw value with no variable, is a deviation: frame, node, the value expected,
  and the nearest token used in the interim.
- **Primitives.** Use the Code Connect mapping when one exists. Otherwise compose from an
  existing repository component that `search_design_system` or the codebase shows is the
  same primitive. A new primitive is a decision, not a default: list it with its reason.
- **States.** Build what the design shows. A state it does not show is a deviation to report,
  not a gap to fill.

## Stay in sync

Re-query the node before implementing each frame, before capturing parity evidence, and
before QA. When the structure, variables, or mappings changed since the last pull, record
the change, re-plan the affected frame, and tell the user in the boundary report. Never
finish a frame from a cached copy of the design.

## Evidence

Per frame and breakpoint: the fresh Figma screenshot beside the implementation screenshot,
the token map, the component map, and the deviation list. Attach new screenshots per
`docs/guide/github-attachments.md`.
