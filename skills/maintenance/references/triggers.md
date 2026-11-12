# Triggers

This file is the one home for the phrases that separate `refactor`, `feature`, `bug-fix`,
`maintenance`, and `crash-hunt`.

A verb alone (refactor, change, update, rename, extract, move) names an operation, not a
route. What decides is whether the request names the change, meaning a target and what
happens to it. An area named only as the place to look, such as "harden the payments
module" or "tech debt in billing", is the scope of a `maintenance` run, not a named change.

| The request | Phrases | Route |
|---|---|---|
| Names its target, and behavior stays the same | refactor X; rename a constant or variable; extract a function; move a file; restructure an object | `refactor` |
| Names its target, and its value or behavior changes | change a constant's value; add a field to an object | `feature`, or `bug-fix` when the current value is wrong |
| Names a crash or wrong behavior that happened | fix this crash | `bug-fix` |
| Names no change, so the agent picks one by risk | a maintenance change, pass, or PR; one high-value change; tech debt; a hardening pass; the riskiest or highest-risk fix; pick something to fix; find something worth fixing; a scheduled maintenance routine firing | `maintenance` |
| Asks to find crashes by sending input | fuzz; malformed requests; random requests until it crashes; crash hunt | `crash-hunt` |

The deterministic route signals in `laya/policy.py` (`CLASS_SIGNALS`) mirror the
`refactor`, `bug-fix`, `maintenance`, and `crash-hunt` rows. A named value change has no
signal there and reaches `intake` when it carries no acceptance criteria; the router table
still decides. A change to a mirrored row changes both.
