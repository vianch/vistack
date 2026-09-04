---
name: swarm
description: "Run independent verification or exploration lanes in parallel and return one evidenced verdict. Use for coverage matrices, races, PR head verification, or competing read-only investigations."
---

# swarm

Fan out independent lanes, then aggregate them into one report. A swarm increases coverage.
It does not replace ownership or evidence.

## Steps

1. State the finish predicate and the artifact or verdict the swarm must return.
2. Choose the shape. Partition disjoint slices, run identical briefs as a comparison, or
   mix both. State the selection rule before dispatch.
3. Set the lane count from the work and the available host capacity. Use one worktree or
   scratch directory per lane when a lane writes.
4. Give each lane a standalone brief with goal, scope, context, exact check, forbidden
   actions, timebox, and report shape. Use a different model or role for verification when
   the lane checks work produced by another lane.
5. Drain all lanes. A dropout becomes an explicit gap. Do not call an absent result a pass.
6. Aggregate into a compact table with lane, status, evidence, and issue. Do not paste raw
   reports into the final answer.
7. Return `PASS`, `ISSUES`, or `BLOCKED` for each lane and one overall verdict. Route every
   issue to the owning slice with its evidence.
