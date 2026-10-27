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

Do not write comments by default. The allowed cases (import grouping labels, the reason a
`catch` handles an external failure, external API response models, JSDoc on every utility
function, and hidden invariants or business rules no name can carry) are listed with their
exact shape in `skills/pruning-comments/SKILL.md`, The policy, which is the rule's home.
Comments outside those cases are removed; utility-function docblocks remain.

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
