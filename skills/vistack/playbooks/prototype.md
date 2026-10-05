# Playbook: prototype

**Match when a quick experiment can settle an empirical or design question.** The artifact
is throwaway. It is not production code and does not replace the feature or bug-fix route.

## Steps

1. State the decision the prototype must settle. If there is no decision, route to
   `feature` or `investigation` instead.
2. Gather relevant prior art when the design space is open. Skip this when the direction is
   already fixed.
3. Dispatch the tier owner to build the smallest isolated scratch artifact outside
   production source, with the lightest tool that can observe the behavior, timing, or
   layout.
4. The owner puts competing alternatives behind one switcher when comparison is useful.
   Label each alternative so the evidence can name it. For a visual or interaction choice,
   put the alternatives on one HTML page with a copy-out of the chosen settings
   (`skills/html-report/SKILL.md`).
5. Verify on the matching surface. Screenshots for visual choices come from a background
   `qa-verifier` lane; output and timing for behavioral choices come from the owner.
   Observation is the test for this playbook.
6. Record the alternatives, evidence, tradeoffs, and recommendation. State what remains
   unproven.
7. Hand the chosen direction to `feature`, `bug-fix`, or `refactor`. Do not carry throwaway
   code into production without a new scoped implementation step.
