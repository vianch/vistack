# Playbook: automate-me

**Match when the user wants working preferences captured in a reusable mode skill.** The
full authoring contract lives at `skills/automate-me/SKILL.md`.

## Steps

1. Confirm whether the request updates an existing mode skill or creates a new one. An
   explicit update request already answers this. Do not ask again.
2. Use only the active workspace's available transcript source. If no scoped history exists,
   use the current conversation and the user's explicit preferences.
3. Collect repeated evidence for response style, autonomy, delegation, verification,
   process, and skill-authoring habits. Require more than one occurrence before making a
   preference a rule.
4. Separate a user preference from a project invariant. Project invariants belong in
   viStack's principles or playbooks, not in a personal mode skill.
5. Draft the mode skill at the existing category path, or the host's normal personal-skill
   path for a new mode. Keep the description specific to the user's invocation.
6. Run the skill-authoring validation. Confirm frontmatter, links, path, and trigger
   behavior. Apply the prose rules in `skills/automate-me/SKILL.md`.
7. Present the draft, unresolved preference choices, and evidence. Do not open a PR unless
   the user asks to land a project-local mode skill.
