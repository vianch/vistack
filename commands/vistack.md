---
description: "Route a unit of engineering work — issue, task, bug, feature, refactor, design implementation — through viStack"
argument-hint: "<what you observed or want>. Done means <checkable condition>. Keep <behaviour that must not change>."
---

# /vistack

Invoke the `vistack` skill and follow it as executable instructions, starting at Step 0.

The request is `$ARGUMENTS`. If it is empty, ask for one sentence describing what was
observed or wanted, and a finish condition — then continue. Do not enumerate the skills
available; the router matches the playbook.

Once this command has run, the session is in viStack mode. Subsequent turns stay in the
mode without re-invoking the command. `new task` forces a fresh playbook match.
