# Writing contracts for Claude 5 models

Read this before you edit a skill, a playbook, or an agent. The contract is the product: a
model follows the words as written, and a contract that fails its frontmatter or path rules
loads as nothing, with no error.

## Write judgment with its reason

State the goal, the constraint, and why, then let the model decide. "Write code that reads
like the surrounding code" covers cases that "default to writing no comments" never
foresaw, because the model can apply the reason to a case the rule did not name. A bare
command is followed literally, including where it no longer fits.

Keep absolute rules for four things, where a single exception is irreversible or leaks a
secret: the four fences (`skills/autonomy-has-fences/SKILL.md`), the merge boundary
(`skills/vistack/SKILL.md`), the realm rule (`skills/keep-origins-in-realm/SKILL.md`), and
credentials. Everything else is judgment with a reason attached.

## One home per invariant

Write each rule in one file and point at it from every other file in one line. Two copies
drift, and the model follows whichever it read last. When you change a rule, change its
home and check that the pointers still describe it.

| Topic | Home |
|---|---|
| The four fences | `skills/autonomy-has-fences/SKILL.md` |
| Merge boundary, run report, script path resolution, Codex role adoption | `skills/vistack/SKILL.md` (Merge boundary, Final report, Host adapter) |
| Hierarchy (owner → coordinator → workers), what crosses levels, job owners | `skills/vistack/SKILL.md` (Agent tree) |
| Delegation (the main session runs no work an owning role owns), the tier rule, and QA lanes | `skills/coordinate/SKILL.md` (Dispatch rules, QA lanes) |
| Enhancing a request, brief, or dossier, and what the original is kept for | `skills/prompt-enhancer/SKILL.md` |
| Reviewing another author's PR, the COMMENT-only boundary, and the findings shape | `skills/review-pr/SKILL.md` (Permissions), `skills/review-pr/references/findings.md` |
| The review watch's standing grant, its state file, and replying to mentions | `skills/review-watch/SKILL.md` (Permissions), `skills/review-watch/references/data.md` |
| External naming | `skills/vistack/principles/index.md` |
| Monitor wake and loop exit, pilot lanes, flattened lanes and re-cuts, brief order, state file schema | `skills/coordinate/SKILL.md` |
| Prompt-prefix stability and the reason for brief order | `skills/guard-the-context-window/SKILL.md` |
| Test run order and failure classes | `skills/prove-it-works/SKILL.md` |
| Where a failure the slice did not cause goes | `agents/devops.md` (What you do) |
| Perf measurement, and the metric ratchet | `skills/vistack/playbooks/perf-issue.md`, `skills/build-the-lever/SKILL.md` |
| Advisor checkpoints and what each asks | `skills/advisor/SKILL.md` |
| Ledger columns and decision vocabulary | `docs/guide/ledger-format.md` |
| Rendering a report page | `skills/html-report/SKILL.md` |
| Recording QA video, its evidence files, and media edits | `skills/qa-video/SKILL.md` |

## Enumerate closed sets

When a field has a closed set of values, list every value: `phase` in
`skills/coordinate/SKILL.md`, the ledger `result` column, the `watch-pr.py` exit codes. An
example narrows the model's search to the example's shape and reads as the whole set. Keep
an example only when the set is open, and delete repeated ones.

## Descriptions are triggers

The `description` decides whether a skill loads at all, so write it as a trigger, not a
summary. Put the words a user types first ("going to bed", "run until done"), then what the
skill does. Claude Code truncates `description` plus `when_to_use` at 1,536 characters, and
when the skill listing outgrows its share of context it drops the least-used descriptions
first. A description edit is a routing change; measure it before keeping it (see Verify).

## Gotchas come from recorded failures

A Gotchas section carries the most signal per line in a skill. Build each entry from a
failure on record: `docs/guide/common-mistakes.md`, a run ledger under the state root, or a
review finding. Name the concrete instance and what to check instead. Do not invent a
plausible gotcha, and do not repeat a rule the file already states.
`skills/unblock/SKILL.md` and `skills/qa-verify/SKILL.md` show the shape.

## Skills are folders

`SKILL.md` holds the contract. `references/` holds detail the skill reads on demand, such as
the design red flags under `skills/architect/references/`. `assets/` holds templates the
skill copies rather than regenerates. `scripts/` holds repeatable work, so the model spends
its turns on composition instead of retyping a procedure. Scripts resolve from the plugin
root, as the router's Host adapter describes.

## Size and the compaction window

Every line of `SKILL.md` is paid on every load. Keep it under 500 lines and move detail into
`references/`. After compaction Claude Code keeps only the first 5,000 tokens of each
invoked skill, 25,000 in total. The router's sticky mode and Steps 0 to 5 must sit inside
its first 5,000 tokens, or a long run loses them exactly when it needs them.

## Static first

Skill and agent bodies are part of the cached prompt prefix. The rules for keeping that
prefix stable are in `skills/guard-the-context-window/SKILL.md`.

## Do not restate defaults

A capable model already reads a file before editing it, matches the surrounding code, and
writes in plain sentences. A line telling it to costs context on every load and buries the line
that changes a decision. Test each sentence by deleting it: if no decision changes, leave it
deleted.

## The verbatim playbook rule is a deliberate exception

The router copies a playbook's numbered steps into the task list verbatim, with no
paraphrase, reorder, or merge. That runs against judgment-over-rules on purpose: across a
long unattended run the playbook is the executable contract, and a paraphrase tends to drop
the clause about evidence. So write each step as the exact text you want executed, ending in
something checkable, and point at the skill that holds the reason instead of carrying it in
the step.

## Verify a change

1. Run `node scripts/check-playbooks.mjs`. It checks frontmatter, name and directory
   agreement, route coverage, contiguous step numbers, long dashes and curly quotes in
   playbooks, and that every backticked `skills/`, `docs/`, or `agents/` path exists.
2. Run `python3 -m unittest discover -t .` when Python changed.
3. When the change edits a skill description or a route row, measure trigger or route
   accuracy before and after, as step 8 of `skills/vistack/playbooks/authoring-skill.md`
   describes.
4. Run `unslop` over the prose and read the final diff as a fresh agent.

Drawn from the posts "The new rules of context engineering for Claude 5 generation models"
and "Lessons from building Claude Code: How we use skills".
