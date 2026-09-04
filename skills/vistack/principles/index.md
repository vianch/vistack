# Principles index

Read this first, every run, before matching a playbook. One screen. Each line is the whole
principle; the linked skill is the argument and the failure it prevents.

| Principle | In one line |
|---|---|
| `separate-before-serializing-shared-state` | Give every parallel writer its own directory. Where they must share a file, run them in sequence — never lock, never merge-by-hope. |
| `sequence-work-into-verifiable-units` | Order work so each step ends in something you can check. A step you cannot check is a step you cannot land. |
| `prove-it-works` | Behaviour is proved by running it, against a captured artifact. Nothing else counts. |
| `fix-root-causes` | Treat the cause, not the symptom. A workaround is a decision, and it gets recorded as one. |
| `one-concern-per-pr` | One PR answers one question a reviewer can hold in their head. ≤500 changed lines. |
| `guard-the-context-window` | Context is the scarce resource. Delegate reading, keep conclusions. |
| `evidence-over-inference` | Cite `file:line`, a command's output, a screenshot. "Should" and "presumably" are not findings. |
| `subtract-before-you-add` | Look for the delete first. Less code beats more code that is well written. |
| `keep-origins-in-realm` | Every remote is `the project organization and its approved repositories`. Nothing is cloned, vendored, or fetched from outside it. |
| `autonomy-has-fences` | Run unattended everywhere except four named cases. Inside those four, stop. |

## Invoking a principle

A reply that invokes a principle must name **the decision the principle changed**.

> ✅ "`subtract-before-you-add`: dropping `DetailRow` removes the slice that would have
> ported it — 3 slices, not 4."
>
> ❌ "Following `subtract-before-you-add`, I'll keep the code clean."

The second one is a citation with no content. Restating a principle's name is not invoking
it. If you cannot name what changed, the principle was not applied and the sentence should
be deleted.

Each principle is a skill of its own at `skills/<name>/`, invocable by name. They sit at the
top level of `skills/` because both Claude Code and Codex discover skills at that depth;
nested under `skills/principles/` they load as nothing at all.
