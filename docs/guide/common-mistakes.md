# Common mistakes

The five that cost the most, then the rest. Each one is a real failure mode, not a style
preference.

## Do not enumerate skills instead of stating a goal

❌ "Run `slice-plan`, then `coordinate`, then `qa-verify`."
✅ "The Loader spinner is inconsistent across Portal. Done means one `Spinner` primitive with
the two Loader call sites using it, suite green. Keep every existing Loader consumer's
visual output."

Naming skills is how you get the wrong playbook. The router matches on the *work*: a goal
plus a finish condition plus what must not change. A list of skills tells it nothing about
any of the three, so it matches on whichever word it recognizes.

The same mistake in the middle of a run looks like "now use `stack-split`". If the diff is
over 500 lines, `pr-author` is already going there.

## Do not start an autonomous run without a checkable finish condition

❌ "Done means the ProgressBar works."
✅ "Done means `ProgressBar` renders at 0%, 50% and 100% in Storybook with the correct
`aria-valuenow`, both `Loader` call sites use it, and the suite is green."

"Works", "is fixed", "looks right", "is better" are not finish conditions. They cannot be
checked, which means the run cannot end and the health check has nothing to measure the
diff against — so it audits against the PR description, which is the thing being audited.

viStack refuses to start an autonomous run without one. That refusal is the feature.

## Do not let parallel writers share a directory

❌ Two agents, one checkout, "they're editing different files".
✅ One worktree per slice at `.claude/worktrees/<slug>-<slice>`, and the conflict matrix
serializing anything that shares a file.

Agent A writes a file. Agent B's editor writes the version it read before A's write. A's
change is gone — no conflict marker, no failing test, no line in any diff to point at. The
run finishes green having shipped less than it says it shipped.

"Different files" is not the check. The conflict matrix is the check, and it is produced
before any worktree exists. No matrix, no dispatch.

## Do not accept a green build as behavioural evidence

❌ "CI is green, so the feature works."
✅ A screenshot at the assertion point, on that PR's own preview, in the results table.

A green build proves the code compiles and the tests that exist pass. Those tests were
written by the same agent that wrote the code, against the same misunderstanding if there
was one. The build cannot prove the behaviour the ticket asked for — that is a different
claim and it needs a different artifact.

Concretely: a pass in the QA table without a screenshot path is a fail. Not a pass with a
missing attachment.

## Do not treat a large-sounding task as a multi-day program

❌ "This is a big refactor — phase one is a design document, phase two is a spike…"
✅ Slice it, check the slices are ≤500 lines and independently mergeable, dispatch the first
wave.

A ticket that sounds large is usually four slices, two of which run concurrently and one of
which turns out to be a deletion. The planning ceremony costs more than the work and
produces documents nobody reads while the code moves underneath them.

The inverse is also a mistake: viStack is the wrong tool for a one-line copy change or a
config tweak. The machinery costs tokens. Just make the change.

---

## Also, in descending order of cost

**Paraphrasing a playbook step.** The steps are the executable contract. Paraphrasing drops
the clause that mattered — usually the one about evidence. A step that will not be run stays
in the task list, marked skipped, reason in the ledger.

**Batching finished slices.** A finished slice waiting for its siblings is a slice whose
review has not started and whose conflicts are growing. Raise its PR the moment it is done.

**Writing the state file at the end.** The state file exists so a session can die without
taking the run with it. Written at the end, it is absent exactly when it is needed. Write it
on every transition, before the ledger row and before the session comment.

**Appending a second session comment.** Two comments split the truth and the older one starts
lying immediately. Upsert by matching the title line.

**Escalating a blocker as a question.** FENCE 1 arrives as a dossier: every hypothesis, the
one variable each changed, and — the part with actual value — **what the evidence rules
out**. "It's failing, what should I do?" makes the human start from zero.

**Re-running the same blocker attempt with a different value.** That is the same hypothesis.
Three consecutive attempts with identical evidence means the cause is upstream of everything
being changed: abort and escalate, because attempts 4 through 20 produce the same row.

**Loosening a type or skipping a test to get unblocked.** Void attempt. Revert it; the
budget does not move.

**Asking for confirmation mid-phase.** A fence violation in the other direction. It converts
an unattended run into a supervised one and wastes the reason for starting it.

**Citing a principle without naming what it changed.** "Following `subtract-before-you-add`,
I'll keep things clean" is a citation with no content. Name the decision or delete the
sentence.

**Running QA against staging, or another branch's preview.** The env is the preview generated
for *that PR*. Anything else verifies code that is not under review.

**Bypassing a preview that has not finished building.** It lands on the protection wall and
looks exactly like a bad password. Check the build first — this is the most common false
credential failure.

**Merging.** viStack stops at merge-ready. Merging is FENCE 3 and it belongs to a human.
