# Page types

Each type has one job. Its skeleton is the section order, top to bottom. Component names are
classes in `skills/html-report/assets/base.html`; every type uses them unchanged and replaces
only the content.

Every page, whatever the type:

- The doctype, charset, and viewport lines from the template, then `<title>`; the artifact form
  drops the first three, so `<title>` leads it. The title is the subject's own name in two to
  four words, with no explainer after a dash or colon. "Checkout Rounding Incident", not
  "Incident Report: Checkout".
- Header: a `.label` eyebrow naming the type, the `h1`, a `.lede` saying what the reader
  should take away, and `.meta` pills for state.
- Footer (`.sources`): every source the page was built from, and the generation time.

## Run report

- **Job:** show the operator where a run stands and what needs a human, at a glance.
- **Data:** `<state-root>/<slug>.json` and `<state-root>/<slug>.tsv`.
- **Skeleton:** header with phase, playbook, and host pills; toolbar with Copy as Markdown;
  goal (`.kv`: done when, must not change); counts (`.tiles`: slices by phase, ledger rows,
  advisor consultations, skipped steps, failed or blocked); needs attention (`.rows`:
  escalated, blocked, failed, and step-skipped rows, plus slice blockers); slices (`.board`,
  one `.col` per phase); decision log (`.timeline` filtered by phase and result chips);
  evidence (`.table` of links, paths, and commits); other recorded state fields
  (`details`); sources footer.
- **Export:** Copy as Markdown summary.
- Render it only with `skills/html-report/scripts/run-report.mjs`. When it is required and
  when it is refreshed: `skills/html-report/SKILL.md`, When to use it.

## Status report with charts

- **Job:** tell a stakeholder what moved in a period and what carries over.
- **Data:** merged PRs, ledger rows, or tracker exports for the stated date range.
- **Skeleton:** header with the date range; `.tiles` with deltas against the previous
  period; highlights as `.rows`; shipped work as `.table` with state pills; one inline SVG
  `.chart` in a `.figure`; carryover as `.rows` tagged in review, blocked, or slipped.
- **Components:** the `.chart` SVG gets `width` and `height` attributes equal to its
  `viewBox`, so labels render at true size and only shrink on narrow screens. Place every
  bar with one scale and write that scale in the `figcaption` (baseline, units per step, bar
  width and gap) with the data source. Highlight one bar with `.peak` only when it is the
  point.
- **Export:** none; the page is read, not edited.

## Task or agent state

- **Job:** show where each task or agent lane stands and what it moved through.
- **Data:** the state file's slices, or the host's task list, with the ledger for transitions.
- **Skeleton:** the `.task` rows inside one `form[data-flags]` with a `data-export-label`;
  each row has a checkbox whose `name` is the task title, the title as its `label`, and a
  due pill. A `.track` under a row lists the states passed (`ok` pills), the current one
  (`aria-current="step"`, `info` pill), and those ahead (plain pills). Then an agent lanes
  `.board`, one `.col` per lane.
- **Export:** Copy as Markdown (`data-export="markdown"` targeting the form), which lists
  each task as `- [x]` or `- [ ]` and the check-offs made since the page loaded. A page that
  only displays state renders the checkboxes `disabled` and has no export.

## Incident or bug timeline

- **Job:** let someone who was not there understand what broke, why, and what is left.
- **Data:** logs, alerts, the ledger, the fixing diff, and the impact query output.
- **Skeleton:** `.tldr` (what happened, how long, the fix); `.timeline` of events with UTC
  times, each dot toned impact (`bad`), mitigated (`warn`), or resolved (`ok`); root cause
  as prose plus the `.diff` that fixed it; impact as `.kv` (users, orders, window); action
  items as `.checklist` with owner and due date in `.who`.
- **Components:** a `nav.toc` in the `.aside` once the page passes about four sections.
- **Export:** none.

## Code review

- **Job:** point a reviewer at the risky lines first.
- **Data:** the diff, plus `analyst` call sites for anything the diff changes the contract of.
- **Skeleton:** what the change does (two sentences); risk map as `nav.meta` of pills that
  link to file cards; one `article.file` per risky file (path, risk pill, `.diff`, margin
  notes as `.callout.note` toned `bad` for blocking and `info` for a nit); low-risk files
  collapsed as `details.file`; next steps as `.checklist`.
- **Components:** every risk-map `href="#file-x"` has a card with `id="file-x"`;
  `.file:target` outlines the card the reader jumped to.
- **Export:** Copy as Markdown of the notes when the review is handed back to the author.

## PR write-up and PR queue

- **Job (write-up):** let a reviewer understand a change before reading the diff.
- **Data:** the diff, the ticket, the test output, and the rollout plan.
- **Skeleton (write-up):** `.tldr`; why, as `.prose`; before and after as `.pair` of
  `.panel`s; file-by-file `details` in the order a reader should take them, each with
  `file:line` locators; where to focus as `.steps`; test plan as `.checklist`; rollout as
  `.track`.
- **Job (queue):** show which PRs wait on whom.
- **Skeleton (queue):** one `.table` row per PR: number, title, state pill, size in lines,
  reviewer, age.
- **Export:** none for a write-up; Copy as Markdown for a queue that is triaged on the page.

## Code understanding, flow, path, and architecture

- **Job:** explain how a path through the code works, for someone reading it once.
- **Data:** an `analyst` impact map: entry points, call sites, and patterns with `file:line`.
- **Skeleton:** summary `.lede`; `.layout.has-aside` with the main column holding an inline
  SVG `.diagram` (nodes as `g` with `rect` and `text`, the path the change touches marked
  `.hot`, arrows through `marker` elements) and a numbered `.steps` walkthrough, each step
  with a `file:line` and a `details` snippet; the `.aside` holds key files and a gotchas
  `.callout`.
- **Components:** the diagram carries `role="img"` and an `aria-label` that states the path
  in words. Draw it at its natural width; a diagram wider than about 480 units sits in a
  `.scroll` container so it scrolls on a phone instead of shrinking to unreadable text.
- **Export:** none.

## File comparison

- **Job:** show what differs between two files or two versions.
- **Skeleton:** a `.pair` of `.diff` blocks side by side, which stack on a phone; or one
  unified `.diff` with `.ln.add` and `.ln.del` lines; tabs (`role="tablist"`) when both
  views are offered.
- **Export:** none.

## Triage or kanban board

- **Job:** let the user re-sort work and hand the new order back.
- **Data:** tickets with id, title, area, and size, from the tracker or the request.
- **Skeleton:** sticky `.toolbar` with filter chips and the export buttons; a short hint on
  how to move cards; `.board` with one `.col` per column, each with a `[data-count]` pill.
- **Components:** cards are `li.ticket` with `draggable="true"`, `tabindex="0"`, and
  `data-item`. They move by drag, by Alt with an arrow key, and by `[data-move]` buttons
  where phones matter.
- **Export:** Copy as Markdown and Copy as prompt.

## Sidebar menu with drag ordering

- **Job:** let the user reorder a navigation list and return the order.
- **Skeleton:** one `ul.nav` with `data-list`; each row has a `.grip`, a `.title`, an
  optional `.n` count, and up and down `[data-move]` buttons; then the export buttons.
- **Export:** Copy as JSON.

## Feature-flag or toggle editor

- **Job:** let the user change flags, see what the change breaks, and copy the change.
- **Data:** the project's flag definitions, their current values, and their dependencies.
- **Skeleton:** `.editor` with a `form[data-flags]` holding one `fieldset` per group and one
  `label.flag` row per flag (checkbox, key, rollout pill, description), a dependency warning
  (`[data-flags-warning]` inside a `role="status"` wrapper), and a `.panel` aside listing
  pending changes.
- **Components:** a flag that needs another carries `data-requires="<other-key>"`. The
  initial state is each checkbox's `checked` attribute; rows that differ get `.is-changed`
  and rows with a broken dependency get `.has-conflict`.
- **Export:** Copy diff and Copy JSON.

## Design system and tokens

- **Job:** show a project's tokens and components as they render.
- **Data:** the project's real token files (CSS variables, a tokens JSON, a Tailwind
  config). Never the defaults in `skills/html-report/references/design-tokens.md`.
- **Skeleton:** color `.swatches` grouped as neutrals, accent, and status, each with its
  token name and value as written in the source file; type scale as `.kv` (token, then a
  specimen at that size); spacing `.ruler`; radius and elevation `.shapes`; components in
  each state (default, hover, focus, disabled) side by side.
- **Export:** Copy as JSON of the tokens when the user is tuning them.

## Change explainer

- **Job:** help a person who did not write the change understand it well enough to own it.
- **Data:** the diff, the ledger's deviation rows, and the spec it implemented.
- **Skeleton:** `.tldr`; one SVG `.diagram` of the parts that moved; three or four annotated
  snippets as `.steps`; deviations from the plan as `.rows`; gotchas `.callout`; optionally
  a short quiz at the end as `.steps` whose answers sit in `details`.
- **Export:** none.

## Script hooks

The `<script>` in `skills/html-report/assets/base.html` is generic. Every behavior attaches
through these attributes; a page without them runs no code.

| Behavior | Attributes |
|---|---|
| Copy an element's text | button `data-copy-from="#id"`; a `textarea` source doubles as the fallback |
| Export editor state | button `data-export="markdown"`, `"json"`, `"prompt"`, or `"diff"` plus `data-target="#id"`; the target names itself with `data-export-label` |
| Filter | container `data-filter-scope`; chip groups `data-filter-group="<key>"` holding `button.chip` with `aria-pressed` and `data-filter-value`; items `data-filter-item data-<key>="<value>"`; a reset button `data-filter-reset` |
| Reorder | container `data-reorder`; lists `data-list="<name>"`; items `data-item`; optional `[data-count]` in a list's parent and `[data-move="up|down|prev|next"]` buttons |
| Flags | `form[data-flags]` with `data-pending="#id"`; rows `data-flag`; `data-requires` on a checkbox; `[data-flags-warning]` |
| Tabs | `role="tablist"` of `role="tab"` buttons with `aria-controls`; panels `role="tabpanel"`, all but one `hidden` |

Confirmations go to one visually hidden `aria-live` region the script creates. Filter groups
use dataset names, so a group key is one lowercase word.
