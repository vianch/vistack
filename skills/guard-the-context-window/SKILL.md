---
name: guard-the-context-window
description: "Treat context as the scarce resource. Delegate bulk reading, keep conclusions, and let role agents hold their own detail. Use for large file sets, long runs, or state versus transcript decisions."
---

# guard-the-context-window

Context is the budget. Everything else is cheap by comparison.

## The rule

- Delegate the reading. A role that must read twelve files reads them in its own session
  and returns the conclusion. The coordinator holds conclusions, not file dumps.
- Write state to disk, not to the transcript. The resolved state root contains the JSON state
  and ledger. The transcript is a cache that will be summarized.
- Do not re-derive. A fact established once, in the ledger, is not re-established.
- No progress narration. Every "now I'll look at…" is spend with no return.
- A run that needs the whole repo in context is mis-sliced. Go back to `slice-plan` and split
  the read into evidence-bearing units.

## Keep the prefix stable

The host reuses a cached prompt prefix up to the first byte that differs, and cached input
costs about a tenth of fresh input. Anything that changes near the top re-bills everything
after it.

- Static content first, volatile content last.
- No per-run text (dates, slugs, counts) in a skill or agent body. Run state arrives as tool
  results and messages; it is never edited into a skill body.
- No tool, MCP server, plugin, or advisor toggle inside a run. Each one changes the tool list
  or system prompt at the head of the prompt.
- A model change is a subagent handoff with a standalone brief, not a mid-session switch.
  The cache belongs to one model, so a switch rebuilds the whole prefix.
- Append; do not rewrite history. Editing an earlier message invalidates the cache from that
  message on.

This is why a brief puts the role's static header before the slice fields
(`skills/coordinate/SKILL.md`): every dispatch of that role shares the cached header and pays
full price only for the slice. A brief points at `file:line` rather than pasting the file,
because a pasted body is a stale copy the agent pays for on every dispatch, and the agent
reads the current lines it needs.

## What it changes

It changes who reads. `analyst` reads the call sites and returns an impact map of
`file:line` refs; the coordinator never opens those files. It changes what a phase
boundary reports: the decision and its evidence, not the path taken to it.

It changes the state file's job. The state file exists so that a session can die without
taking the run with it — which is only true if it is written on every transition rather
than at the end.

## The failure it prevents

The run that gets dumber as it goes. Early context is summarized away, the invariants go
with it, and by phase four an agent re-litigates a decision made in phase one and reaches
the other answer.
