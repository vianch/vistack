# Playbook: improve

**Match when the operator asks to stop a repeated agent mistake.** The skill
`skills/improve/SKILL.md` holds the method; this playbook holds the order of a sweep. A
mid-run correction runs the skill's per-correction pass from router Step 0, not this playbook.

## Steps

1. Read `skills/improve/SKILL.md` and the rule table in the repository's agent instruction
   file. State the evidence window, the sources, and the class when the operator named one.
   When the operator forbids git, use the file sources the skill lists.
2. Dispatch `analyst` to audit the verify command, the CI configuration, the hooks, and the
   enforcer of every rule-table row first, by the skill's Audit the guardrails section. Each
   row ends marked live, unwired, broken, missing, or unverified with the reason.
3. When the CI configuration cannot be read, record that as a `step-skipped` row.
4. Dispatch `analyst` to collect the evidence and group it into classes by the skill's Find
   the classes section. Keep a class only when it happened at least twice, and cite every
   occurrence. List single occurrences separately.
5. For each class, in severity order, try architecture, then types, then a check whose error
   names the fix, then a test, then docs. Write down why each higher level did not reach.
6. Dispatch the fix for the most severe classes to the tier owner now, one commit per class,
   or one patch per class when commits are off-limits. A fix to host permissions or the
   operator's settings is proposed with its exact entry and left unapplied.
7. Prove each new check fails on a recorded past bad state and passes on the fixed tree.
   Record the command and both outputs as a `rule-enforced` ledger row.
8. Run the check with the same command locally and in CI. When CI cannot run it, record why
   as a `step-skipped` row.
9. Update the rule table so each rule sits beside what enforces it and the bad state it was
   proved against. Drop a row whose mistake can no longer happen or whose deletion changes
   no behavior.
10. Run the advisor `done` checkpoint on the classes, levels, and proofs
    (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
11. Reply in the skill's Reply shape, ending with the went-well list. When commits are
    allowed, open a draft PR per class through `pr-stack`.
