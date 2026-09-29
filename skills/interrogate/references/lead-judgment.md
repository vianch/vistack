# Lead judgment

The reviewers are aggressive by design, and aggression without context is noise. They saw a
diff and one paragraph of intent. The lead has the whole run: what was tried and rejected,
the constraints outside the code, which code is scaffolding, and what the next PR in the
stack will address. Filter, contextualize, and decide. Do not aggregate.

## Filters

- **Nitpick gravity.** A reviewer with no real issue inflates nits to fill the page. When
  every finding is a nit or a preference, the code is probably fine. Say so.
- **Hypothetical or actual.** "What if this is null?" is a finding only when a caller can
  pass null. Trace the call site. Dismiss what upstream validation or the types already
  prevent.
- **Premature abstraction.** An extraction or interface is warranted only when the code must
  change in a second way. Otherwise the simple inline version wins.
- **"I would have done it differently."** The most common false positive. A preference is
  not a defect unless the reviewer shows a concrete problem with the current approach.
- **Missing context.** A finding about code the change did not touch, a pattern that matches
  the rest of the codebase, or advice that conflicts with a known constraint. Dismiss it
  gracefully; the reviewer lacked the context, not the skill.

## When the reviewers are right

The point of an adversarial pass is to catch what the author missed. Take a finding seriously
when:

- two or more independent reviewers raise it;
- it names a concrete execution path, not a hypothetical;
- it exposes a gap in your own model of the code;
- reading it produces "...yeah, actually."

Security and correctness findings get extra scrutiny even from a single reviewer.

## Same-family reviewers

viStack reviewers run on the current host's model: opus on Claude Code, Luna on Codex. Their
independence comes from fresh context, not from different model families, so they share blind
spots. Weigh agreement accordingly: consensus among same-family reviewers is strong evidence
that a finding is real, but silence is weak evidence that nothing is wrong. Never read an
empty review as proof — that is what `prove-it-works` and the health check are for.

## Calibration

A useful verdict beats a comprehensive one. The user should be able to fix the `Act on` list
and ship. More than five `Act on` items means the filter is too loose.

`Dismissed` is not busywork. Showing what was rejected and why lets the user overrule the lead
where they disagree.
