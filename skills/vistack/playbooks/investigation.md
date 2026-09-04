# Playbook: investigation

**Match when the user wants understanding or a recommendation, not a code change.** This
playbook is read-only and ends with a cited answer.

## Steps

1. State the question and the evidence a complete answer must contain.
2. Confirm the read-only contract. If the request includes a change, route to `feature`,
   `bug-fix`, or `refactor` instead.
3. Choose a simple direct pass or disjoint read-only exploration angles. Use the smallest
   number of agents that covers the question.
4. Find the entry point first. Trace callers, consumers, state, and outputs with `file:line`
   references.
5. Check history on load-bearing lines and inspect existing test coverage. Name uncovered
   paths.
6. Separate findings from hypotheses. Every hypothesis names the check that would settle it.
7. If the question is empirical and a small prototype can settle it, route to `prototype`.
   Ask the user only for a product or preference choice no experiment can settle.
8. Report the answer, evidence, blast radius, coverage, options, tradeoffs, and recommendation.
   Post it where the work lives when an issue exists. Do not create a branch or PR.
