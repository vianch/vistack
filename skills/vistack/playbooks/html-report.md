# Playbook: html-report

**Match when the deliverable is a page:** a report, summary, status or progress page, chart,
diagram, flow, path or architecture view, timeline, incident write-up, triage board, agent
state view, flag editor, design-system page, code review, PR write-up, or file comparison,
or the user asks to make an HTML file or an artifact. A run that finishes another playbook
uses `skills/html-report/SKILL.md` directly for its run report and does not route here.

## Steps

1. State the page's one job, its reader, and the decision it lets them make, in one sentence
   each. A request with two jobs becomes two pages.
2. Pick the type from `skills/html-report/references/page-types.md`. When none fits, the
   closest type's skeleton applies and the gap goes in the report.
3. Gather the data the type names and keep each source path: the state file and ledger for
   a run report; the diff for a review, write-up, or comparison; an `analyst` impact map
   with `file:line` for a code, flow, path, or architecture page; the project's real token
   files for a design-system page.
4. Render. A run report comes from `skills/html-report/scripts/run-report.mjs`; its path
   resolves from the plugin root, and it runs from the consuming repository so relative
   paths stay in the project. Any other type is written by `report-writer` from
   `skills/html-report/assets/base.html`.
5. Check the page against `skills/html-report/SKILL.md`: self-contained with no external
   loads, readable in both themes, no horizontal scroll at phone width, every number traced
   to a source named in the footer, every in-page anchor resolving, and export buttons on any
   page whose controls change state.
6. Deliver per host as the skill's Delivery section says: the local file always, and on
   Claude Code with the Artifact tool, the published artifact form unless the page holds
   a secret. The main session records `report-rendered` with the path and `report-published`
   with the URL; `report-writer` only returns the path.
7. Report the path, or the link, in one line.
