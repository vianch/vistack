---
name: pruning-comments
description: "'prune comments', 'clean up the comments', 'remove comments', 'too many comments'. The comment policy and the review-time pass that applies it to a diff: removes added comments outside the allowed cases (utility JSDoc, import labels, external-failure catches, API models, invariants no name can carry, directives), moving their meaning into names, tests, or the PR description."
---

# pruning-comments

Code documents itself through names. A comment is a name that failed: the function, constant,
or test that should have carried the meaning did not. This pass finds every comment a diff
added and removes it unless it is one of the few kinds that earn their place, after moving
anything real it said into the code.

It is a separate pass because comment judgment fails in writing mode: a comment feels
valuable right after you wrote the thought it captures. Run it with fresh eyes once the code
works. Code written under viStack starts comment-free; this pass catches what slipped through
and what someone else wrote.

## The policy

This file is the home of the comment rule. Write no comments by default: prefer a rename or a
named intermediate over explanatory comments, section banners, step narration, restated
signatures, `TODO`, `FIXME`, `NOTE`, `HACK`, commented-out code, or process prose that
belongs in the PR description. Only these survive on an added line:

1. **Import grouping or ordering labels.**
2. **The reason an error is caught, rethrown, or swallowed** inside `try`/`catch`, when an
   external contract, a provider bug, or a retry semantic explains it.
3. **External API response models** whose undocumented shape, inconsistent nullability, or
   legacy alias cannot be expressed in the type.
4. **JSDoc on every utility function.** A function in `*.utils.ts`, `*.util.ts`, their
   JavaScript equivalents, or a `utils/` folder carries one `/** */` block: one concise
   sentence, one `@param` line per parameter, one `@returns` line. No examples, remarks,
   authors, or `{Type}` braces duplicated by TypeScript. A utility function without one gets
   one. Other languages use their own doc-comment form in the same shape: a Python
   docstring, a Go doc comment, Swift `///`, KDoc.
5. **Hidden invariants, non-obvious gotchas, and business rules**: a fact about the world or
   a contract that the code silently depends on and cannot be named in the code. A fact about
   implementation history belongs in the PR description, not a comment.
6. **Machine-read lines.** A shebang, a license or `SPDX` header, `@generated`, a compiler or
   bundler pragma (`//go:build`, `/// <reference>`, `webpackChunkName`, `@__PURE__`,
   `-*- coding`), or a tool directive (`# noqa`, `# type: ignore`, `eslint-…`, `@ts-…`,
   `prettier-ignore`). Deleting one changes the build. Whether a lint silencer belongs at all
   is a different rule: `skills/frontend-code-style/SKILL.md`, Lint and type safety.
7. **A comment a repository rule or linter requires.** The consuming repository's
   `CLAUDE.md`, `AGENTS.md`, style guide, or a lint rule such as Go's exported-symbol doc rule
   wins for exactly what it requires and nothing more. Name the rule when you keep one.

A comment that survives still says it in the fewest words. Everything else goes, including
doc comments outside utilities and any text that talks to a reviewer or describes how the
code used to be.

## Move the meaning, then delete

A comment that restates the code is deleted. A comment that carries a fact the code depends
on is deleted only after the fact lives where the next reader will find it:

| The comment says | Move it to |
|---|---|
| What a block does | an extracted function named for it: `buildRefundWindow()` |
| What a value means | a named constant, with the unit in the name: `ONE_DAY_IN_SECONDS`, `timeoutMs` |
| What a condition tests | a named predicate: `const isAdult = user.age >= ADULT_AGE` |
| A hidden invariant or an external quirk | first a name that states it and a test that fails when it breaks: `assertSortedByCreatedAt(orders)`, `it("keeps the token while the keychain is locked")`; only what no name can carry stays, as case 5 |
| Why the change was made, or the road not taken | the PR description |
| Work left to do | a ticket linked from the PR description |

A moved fact passes when a reader who never saw the diff finds it, by its name or by a test
that fails.

## Scope

Judge only lines the diff added or changed. A comment in untouched code stays unless the user
asks for the whole file or path, or this change makes it false; churning untouched lines
spends reviewer attention and blame history on nothing.

## How to run

1. List the comments the diff added, from the consuming repository:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/pruning-comments/scripts/comments.mjs"`. The path
   resolves from the plugin root (on Codex, Grok, and OpenCode, the installed plugin path).
   It diffs the working tree and untracked files against the merge base with the base
   branch. Pass `--base <ref>` when the base is not `origin/HEAD`, or `--diff <file>` for a
   saved PR diff. Each item is `prune`, `jsdoc`, or `directive`. Exit codes: `0` nothing to
   prune, `1` candidates listed, `2` a usage or git error.
2. Apply Move the meaning, then delete, to each `prune` item. Check each `jsdoc` item sits on
   a utility function and has the shape in The policy, and fix its listed `issues`. Leave
   `directive` items.
3. Rerun it. Every `prune` item still listed must be a comment kept under cases 1, 2, 3, 5,
   or 7; exit `1` is expected while one is. Then run the affected tests and lint: an
   extracted name can break a caller.
4. Report counts: deleted, moved into a name, moved into a test, moved into the PR
   description, and kept, each kept one with its case number (and the rule's path for
   case 7).

The script lists; it does not judge. It misses a line added inside an unchanged block
comment, a Python docstring, a comment glued to code with no space (`foo();// x`), and any
unlisted language, and it exempts any comment containing a directive marker. Read the diff
once after it exits `0`. Without Node, read the diff and apply the same policy.

## Gotchas

- An empty `git diff` after a commit does not mean nothing to prune. The pass covers the
  whole branch against its base, which the script's merge-base diff already does; a
  hand-run check uses `git diff <base>...HEAD` plus the working tree.
- `ttg-engineering:pruning-comments` may also be installed and keeps why-comments this policy
  removes. Inside viStack, bind by path, `skills/pruning-comments/SKILL.md`, never the bare
  name.
