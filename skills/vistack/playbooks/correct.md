# Playbook: correct

**Match when the operator asks to stop a repeated agent mistake.** The skill
`skills/correct/SKILL.md` holds the method; this playbook holds the order.

## Steps

1. Read `skills/correct/SKILL.md` and the rule table in the repository's agent instruction
   file. State the evidence window and the sources. When the operator forbids git, use the
   file sources the skill lists.
2. Collect the corrections and group them into classes. Keep a class only when it happened
   at least twice, and cite every occurrence. List single occurrences separately.
3. For each class, in order of frequency, try architecture, then types, then a check whose
   error names the fix, then a test. Write down why each higher level did not reach.
4. Dispatch the fix for the most frequent classes to the tier owner now, one commit per
   class, or one patch per class when commits are off-limits.
5. Prove each new check fails on a recorded past bad state and passes on the fixed tree.
   Record the command and both outputs as a `rule-enforced` ledger row.
6. Run the check with the same command locally and in CI. When the CI configuration cannot
   be read, record that as a `step-skipped` row.
7. Update the rule table: each rule beside what enforces it. Drop a rule whose mistake can
   no longer happen.
8. Run the advisor `done` checkpoint on the classes, levels, and proofs
   (`skills/advisor/SKILL.md`). Apply or rebut each point with evidence.
9. Reply with each class, its evidence, the level picked, and why a higher level did not
   work. When commits are allowed, open a draft PR per class through `pr-stack`.
