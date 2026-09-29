# Code-quality lens

Audit the structure of the change, not only its behavior. Look for the restructuring that
keeps behavior identical and makes the code meaningfully simpler. Be ambitious: when a clear
path to a cleaner shape exists, name it.

## What to look for

1. **Structural simplification.** The reframing that makes a whole branch, helper, mode,
   conditional, or layer disappear. Deleting complexity beats rearranging it.
2. **The 1,000-line line.** A change that pushes a file from under 1,000 lines to over it
   needs a strong reason. Extract a module, helper, or subcomponent instead.
3. **Spaghetti growth.** A new ad-hoc conditional, special case, or one-off branch inside an
   unrelated flow is a design problem, not a style issue. Move the logic into a dedicated
   helper, module, or state machine (`model-the-domain`).
4. **Design over working code.** When behavior can stay the same while the structure gets
   cleaner, push for the cleaner version. Prefer removing moving pieces over spreading the
   same complexity across more files.
5. **Direct code.** Brittle, magical, or ad-hoc behavior is a finding. So is a generic
   mechanism hiding a simple data-shape assumption, and a thin wrapper, identity function, or
   pass-through helper that adds indirection without meaning.
6. **Types and boundaries.** Question unnecessary optionality, `unknown`, `any`, and casts.
   Prefer an explicit typed model over a loose object. A silent fallback that papers over an
   unclear invariant is a finding.
7. **Canonical layer.** Feature logic leaking into shared paths, implementation detail
   leaking through an API, or a bespoke one-off beside an existing utility. Name the module
   the code belongs in.
8. **Orchestration and atomicity.** Needless sequential steps where independent work could
   run in parallel, and updates that can leave half-written state. Do not chase
   micro-optimizations.

## Order

Report structural regressions and missed simplifications first, then spaghetti and branching,
then types, boundaries, and file size, then smaller legibility points.

## Presumptive blockers

- Incidental complexity that a clear restructuring would remove.
- A file pushed over 1,000 lines.
- Ad-hoc branching tangled into an existing flow, or feature checks scattered through shared
  code.
- A needless abstraction, wrapper, cast-heavy contract, or duplicated helper.
- Logic in the wrong layer when its right home is clear.

## Tone

Direct and serious about maintainability, never rude. Say plainly when the change makes the
codebase messier. Do not settle for a naming fix when the problem is structural.
