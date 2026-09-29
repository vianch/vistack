# Review rubric

Review through the lenses that apply. A small bug fix does not need an essay on architecture.

## Correctness

Does the code do what the intent says?

- Edge cases: empty input, null or undefined, boundary values, concurrent access.
- Errors: caught, propagated, or silently swallowed?
- Off-by-one, type coercion, overflow, encoding.
- State: races, stale closures, dangling references.
- The happy path and the sad path both work.
- A second run, or a rerun after a crash halfway, converges to one state
  (`make-operations-idempotent`). "It depends on what was left behind" is a missing
  reconciliation step.
- Shared mutable state (files, branches, records) is serialized by structure — ownership,
  sequencing, a lock — not by a convention someone has to remember
  (`separate-before-serializing-shared-state`).

Trace a suspected bug to its call chain. "This could be null" is not a finding until a caller
can make it null.

## Root cause or symptom

Is the change fixing the problem or covering it (`fix-root-causes`)? Read the callers,
callees, types, and sibling modules before judging the layer.

- A guard clause that hides a broken invariant.
- A retry that hides a broken contract.
- A cast that silences a modeling error.
- A fix in module A that belongs in module B's contract.
- A comment saying "do not do X" where a type, lint rule, or runtime check could make X
  impossible.

## Structural integrity

Does the code fit the system it lives in?

- Validation happens once at the boundary; the inside trusts its types.
- Orchestration and low-level detail are not mixed in one function.
- New coupling does not make the next change harder.
- The data structure matches the dominant access pattern.
- The change reads as if the design always knew about it, not as a patch bolted on.
- No new API beside a live old one. Without external consumers, callers migrate and the old
  path is deleted in the same wave (`migrate-callers-then-delete-legacy-apis`).

Simple code is not a defect. Premature abstraction is worse than duplication.

## Verification

Can you tell from the diff that it works (`prove-it-works`)?

- Tests exist and assert behavior, not implementation detail.
- A bug fix has a test that fails without the fix.
- An integration boundary is tested across the whole path.
- The check reads the real value, not a proxy such as a file time or a cached flag.
- Delegated or asynchronous work is checked against its output artifact, not its own report.

## Complexity budget

Does the result earn its complexity (`subtract-before-you-add`)?

- Code that could be simpler without losing correctness.
- An abstraction with one call site; parameters for cases that do not exist.
- Dead code, unused imports, vestigial parameters, finished migrations still carrying their
  scaffolding.
- A feature, option, or control that does not earn its place. A half-finished feature is
  worse than a missing one.

## Security

Trace the input path for every security finding.

- User input reaching a dangerous sink — SQL, shell, `eval`, raw HTML — without handling.
- A new endpoint without authentication or authorization.
- A secret in code, a log, an error message, or a tracked file.
- A check-then-use gap on a security-critical path.
