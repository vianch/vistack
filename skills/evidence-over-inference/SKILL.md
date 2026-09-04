---
name: evidence-over-inference
description: "Cite file:line, command output, or a captured artifact for every claim; treat should/presumably/likely as unfinished work. Use when reporting a finding, writing an impact map, or accepting a claim from another agent."
---

# evidence-over-inference

Every claim carries its source, or it is not a claim yet.

## The rule

- Findings cite `path/to/file.ts:42`, a command with its output, a PR link, or a screenshot
  path.
- "Should", "presumably", "likely", "I believe", "it appears" mark a hypothesis. Either go
  check it, or label it a hypothesis and say what would settle it.
- Another agent's report is evidence of what that agent concluded, not of what is true.
  Spot-check the load-bearing claim.
- A ticket is a claim about code that was true when someone wrote it. Verify before
  building on it.

## What it changes

It changes what an impact map is: a list of `file:line` references someone else can open,
not a prose summary of where the code "generally lives". It changes the health check from
an opinion into a traceability test — every acceptance criterion maps to a diff hunk, or
the criterion is unmet.

It changes how a defect list is written. "This looks fragile" routes nowhere. "`Modal.tsx:88`
renders fullscreen below `md`, and AC 2 requires the sheet variant" routes to one slice.

## The failure it prevents

A confident, wrong report. It is worse than no report, because it stops anyone else from
looking.
