---
name: html-report
description: "Make a report, summary, status or progress page, chart, graph, diagram, flow, path or architecture view, timeline, incident or bug timeline, kanban or triage board, agent state page, feature-flag or toggle editor, design system or design tokens page, code review, PR write-up, or file comparison as one self-contained HTML page. Use when asked to 'make an HTML file' or 'make an artifact', and to render the run report for a run with more than one slice and for every unattended run. Turns run state, a diff, code evidence, or user data into one page with one job, writes it locally, and publishes it as a Claude artifact where the host allows."
---

# html-report

One page, one job, one reader. The page turns evidence the run already holds into something
a person scans once and acts on.

## When to use it

Use a page when the answer has structure a reader scans (a board, a timeline, a diff, a
chart, a set of toggles) or runs past about 30 lines. A Markdown report over about 100 lines
goes unread. An answer under about 30 lines with no structure stays in the chat as Markdown.

A run with more than one slice, and every unattended run, gets a run report. Render it before
the advisor `done` checkpoint (`skills/advisor/SKILL.md`) so the advisor reviews it, and
render it again at exit so the file shows the final state.

## One page, one job, one reader

Before writing, state three things in one sentence each: what the page is for, who reads it,
and the decision it lets them make. The type in `skills/html-report/references/page-types.md`
fixes the section order from there. A request that needs two jobs gets two pages.

Write for someone reading it once. Summary before detail, the thing that needs a human
first, `file:line` locators instead of pasted file bodies.

## The data rule

Every number, status, name, and claim on the page comes from the state file, the ledger, the
diff, command output, or a `file:line`. Nothing is invented, estimated, or filled from
memory. Missing data is shown as missing ("not recorded"), never dropped and never guessed.
The footer names every source the page was built from. A chart is drawn to one scale, and
its caption states that scale and the source.

## Steps

1. Pick the type from `skills/html-report/references/page-types.md`.
2. Gather the data the type names, keeping each source path. For a run report that is the
   state file and ledger. For a code, flow, path, or architecture page, dispatch `analyst`
   for an impact map with `file:line`. For a design-system page, read the project's real
   token files.
3. Render. A run report comes only from the script, never by hand:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/html-report/scripts/run-report.mjs" --state <json> --ledger <tsv> --out <path>`.
   Any other type starts from `skills/html-report/assets/base.html`: keep its doctype and
   meta lines and its `<style>` and `<script>` blocks whole, delete the example sections the
   type does not use, and replace every example value in the ones you keep. `report-writer`
   does this; the main session dispatches it and never renders a page itself.
4. Check, and fix what fails:
   - self-contained: `grep -nE "(src|href)=\"https?:|url\([\"']?(https?:|//)|@import|<link" <page>`
     shows nothing except evidence links written as `<a href>`;
   - both themes: no literal color outside the `:root` token blocks, SVG text colored by class;
   - phone width: nothing wider than 400 px except tables, code, and diagrams, each inside
     its own `overflow-x: auto` container;
   - every number traces to a source named in the footer;
   - every `href="#x"` has a matching `id="x"`;
   - an editor page carries its export buttons.
   When the session has a browser or screenshot tool, look once at desktop and phone width
   and make one pass of fixes. Do not loop.
5. Deliver, then report the path or link in one line.

## Delivery

Always write a local file, at the user's path or at
`<state-root>/reports/<slug>-<type>.html`. A run report is `<state-root>/reports/<slug>.html`.
The state root is git-ignored, so reports never land in a commit.

On Claude Code, when the Artifact tool exists, the main session also publishes the artifact
form. The artifact form is `--artifact` output for a run report, and for any other page the
file without its doctype and meta lines. Load the host's `artifact-design` skill first, plus
`dataviz` for a chart and `artifact-diagramming` for a diagram when the host has them.
Publish and give the link. Artifacts start private; sharing is the user's call. A page that
holds a credential, token, cookie, or secret value is never published. Keep the local file
and say why.

On Codex and OpenCode, deliver the local file only.

`report-writer` renders the file and returns its path; it never publishes and never writes
the ledger. The main session, which is the coordinator in a coordinated run, records both
rows: `report-rendered` with the file path as evidence, and `report-published` with the
artifact URL as evidence (`docs/guide/ledger-format.md`).

The script path resolves from the plugin root; run it from the consuming repository, so
relative `--state`, `--ledger`, and `--out` paths stay in the project. On Claude Code that is
`node "${CLAUDE_PLUGIN_ROOT}/skills/html-report/scripts/run-report.mjs" ...`; on Codex, put
the installed plugin path in place of `${CLAUDE_PLUGIN_ROOT}`. The script needs Node 18 or
later and nothing else.

## Naming boundary

A run report is the operator's own record. It may show slice, role, and decision names from
the ledger, but its title and headings use the project's words. The slug becomes the name
and the objective becomes the lede. A page meant for anyone else (a PR write-up, an incident
report, a stakeholder status page) follows the External naming boundary in
`skills/vistack/principles/index.md`.

## Look precedence

1. The user's words about the look.
2. The consuming project's own design tokens (CSS variables, a tokens file, a Tailwind
   config), mapped onto the semantic token names with the table in
   `skills/html-report/references/design-tokens.md`. Change values in the `:root` blocks
   only; the component rules stay.
3. The defaults in `skills/html-report/references/design-tokens.md`.

## Export rule

A page whose controls change state (a board, a flag editor, a task list, a reorderable list,
sliders) ends with Copy as Markdown, Copy as JSON, or Copy as prompt, built from a frozen copy
of the initial state compared with the current one. An artifact cannot write back to the
session, so pasted text is the only way the user's changes reach the agent. The base script
builds all three from data attributes; `skills/html-report/references/page-types.md` lists
them.

## Gotchas

- Table of contents links landed on the wrong card because the cards had no `id`. Give every
  anchor target an `id` and check each `href="#x"`.
- SVG `<text>` with a literal hex `fill` stays dark on a dark theme. Color SVG text and
  shapes by class or `currentColor`.
- A hard-coded tint (`#fdecea` behind an error) breaks the other theme. Derive tints with
  `color-mix()` from the status token.
- An interactive editor with no export cannot hand its state back. Ship the copy buttons.
- Drag and drop with no keyboard path locks out keyboard and many touch users. Keep Alt with
  an arrow key, and add move buttons where phones matter.
- Redrawing a list with `innerHTML` drops focus and screen-reader position. Move nodes and
  toggle classes.
- `navigator.clipboard.writeText` called outside the click handler, or with no catch, fails
  silently. Call it in the handler and fall back to selecting the text.
- The host's artifact page contract (the `artifact-design` skill) blocks `print()`,
  `alert`/`confirm`/`prompt`, `<a download>`, iframes, form submission, and every external
  load except pinned cdnjs scripts and Google Fonts. These pages need neither.
- The same contract renders Mermaid only inside a published artifact. A local file draws
  diagrams as inline SVG.
- ASCII diagrams and unicode color squares read as noise. Draw SVG, use the status pills.
- The example pages this structure came from use a cream, clay, and serif palette. It is
  another product's look and reads as generic AI design. Do not reuse it.

Structure and components adapted from the Apache-2.0 example pages accompanying Thariq
Shihipar's post "Using Claude Code: The unreasonable effectiveness of HTML"; no markup copied
verbatim.
