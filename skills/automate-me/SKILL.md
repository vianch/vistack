---
name: automate-me
description: "Capture or update the user's working preferences as a reusable mode skill. Use for automate me, update my mode, refresh my preferences, or make agents work in my style."
---

# automate-me

Turn repeated working preferences into one small mode skill. This is a preference-capture
flow, not a replacement for viStack's project invariants.

Any user-facing answer or project-local ticket, PR title, description, comment, or report
uses the consuming project's ordinary voice. Do not expose `viStack`, `vistack`, invocation
handles, or internal role, skill, model, or host names in that external text.

## Flow

### 1. Find the current mode

Look for a matching `*-mode/SKILL.md` in the active project skill directories and the user's
personal skill directory. Search only paths the current host exposes for this workspace. Do
not glob across every project or read unrelated transcripts.

If the user already said update, refresh, or automate me, update the existing mode when one
exists. Otherwise ask whether to update it or start fresh. Starting fresh is the exception.

For an update, inspect only history since the last edit when the host exposes file history.
Preserve sections the new evidence does not contradict.

### 2. Mine scoped evidence

Use the active workspace's transcript source when the host provides one. If it does not,
use the current conversation and explicit user preferences. Do not invent a transcript path.

Look for repeated signals in response style, autonomy, delegation, verification, code and
prose discipline, process conventions, and skill-authoring habits. A single preference is a
hypothesis. Require repeated evidence or direct confirmation before turning it into a rule.

### 3. Ask only for missing preference decisions

Use the host's structured question surface for a small set of choices. Ask what changed or
what is missing on an update. Ask broad categories first, then selected details. Keep the
rounds short and finish with one open prompt for anything the choices missed.

Do not ask permission for the normal editing, validation, or local file work. Do not turn a
project invariant into a personal preference question.

### 4. Cluster the rules

Keep only sections with evidence. Useful sections are response style, autonomy, understand
first, subagents, prose and code discipline, review and verification, process, and skills.

Project-wide safety rules belong in `skills/vistack/principles/index.md`, a specialist skill,
or a playbook. A personal mode skill should contain how this user wants work carried out.

### 5. Draft the mode skill

Use the host's skill-authoring capability when available. The file has a valid `name` and a
single YAML `description`. The description triggers on the user's chosen handle or mode
name, not on generic requests such as "write code".

Use `disable-model-invocation: true` unless the user explicitly wants the mode on every
turn. Keep instructions operational. Reference other skills by path. Do not paste their
contents into the mode.

### 6. Validate and present

Check frontmatter, path and name agreement, links, trigger wording, and contradictions with
the project rules. Apply `unslop` and the prose rules in
`skills/vistack/playbooks/authoring-skill.md`.

Present the draft, the evidence behind each non-obvious rule, what was preserved, and what
remains uncertain. A subjective mode does not need a benchmark. It needs the user's review.

### 7. Land project-local changes

For a project-local mode, use the authoring playbook and a draft PR. For a personal mode,
write it in the user's personal skill directory and do not create a project PR unless asked.

Never copy private transcripts or credentials into the skill. Never expose transcript paths
or sensitive contents in an external issue or PR.
