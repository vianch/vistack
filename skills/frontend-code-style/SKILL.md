---
name: frontend-code-style
description: "Conditional code-style contract for TypeScript, JavaScript, JSX, and TSX in React frontend projects. Use after project-shape detection before writing or editing frontend code."
---

# Frontend code style

This contract applies only when the consuming project is a React frontend using TypeScript
or JavaScript. It governs code written or edited in the session. Pre-existing comments stay
unless their removal was requested, except when this edit makes one false.

## Project-shape detection

Before implementation, inspect the consuming repository's `package.json`, lockfile,
`tsconfig.json` or JavaScript configuration, and source file extensions. Classify the project
as a React frontend when the evidence includes React (`react` dependency or an established
React app entry), a frontend runtime or build surface, and `.tsx`/`.jsx` or equivalent React
source. Record the evidence as `file:line` references in the impact map or run ledger.

If the project is not a React frontend, do not apply this contract. Use the project's own
language and framework rules.

## Comments

Do not write comments by default. Prefer a rename or named intermediate over explanatory
comments, section banners, step narration, restated signatures, TODO/FIXME/NOTE/HACK,
commented-out code, or process prose that belongs in the PR description.

The only allowed comments are:

1. Import grouping or ordering labels.
2. An error inside `try`/`catch` when an external contract, provider bug, or retry semantic
   explains why it is caught, rethrown, or swallowed.
3. External API response models whose undocumented shape, inconsistent nullability, or
   legacy alias cannot be expressed in the type.
4. Every function in `*.utils.ts`, `*.util.ts`, their JavaScript equivalents, or a `utils/`
   folder: one concise JSDoc sentence, one line per parameter, and one return line. Do not
   add examples, remarks, authors, or types duplicated by TypeScript.
5. Hidden invariants, non-obvious gotchas, and business rules: a fact about the world or
   contract that the code silently depends on and cannot be named in the code. A fact about
   implementation history belongs in the PR description, not a comment.

`pruning-comments` is the review-time pass, but this contract is stricter for frontend
TypeScript and JavaScript: comments outside these five cases are removed, while utility
function docblocks remain.

## Names and conditionals

- Booleans read as predicates: `isExpired`, `hasSeatInventory`, `canRefund`. Boolean props
  may use platform conventions such as `disabled`, `loading`, `required`, `fullWidth`, or
  `dismissible`; apply predicate naming when a prop is copied into a conditional local.
- Functions are verb phrases stating effect and return. Collections are plural; maps name
  both sides, such as `ordersByCustomerId`.
- Avoid unclear abbreviations and names such as `data`, `info`, `temp`, `res`, `obj`, `val`,
  `helper`, `utils`, `handleStuff`, and `flag`. Established `Id`, `Url`, ISO codes, and unit
  suffixes are allowed.
- Put units and currency in names: `timeoutMs`, `priceInCents`, `maxRetries`.
- Extract named constants or predicates instead of bare literals, magic numbers, or raw
  string comparisons inside conditions. Prefer an enum over an inline string union when
  the values represent a domain set.

## Lint and type safety

Never silence a linter at the call site. Do not use `eslint-disable`, `@ts-ignore`,
`@ts-expect-error`, `tslint:disable`, `stylelint-disable`, `prettier-ignore`,
`deno-lint-ignore`, or `NOSONAR` in production code. The only exception is
`@ts-expect-error` in a test whose assertion is that an invalid call is rejected.

Fix the code or change the lint configuration when the rule is genuinely wrong, and record
that configuration decision in the PR.
