# Glossary check

Finds the repository's glossary and ADR directory once, so every role in a run uses the
project's own words. Coordinate Setup runs it and records the result; `understanding-with-docs`
runs it before it writes.

## Detect

From the repository root, stop at the first match:

1. `GLOSSARY-MAP.md`: layout `multi`; the files are the map and each glossary it links that
   exists.
2. `GLOSSARY.md`: layout `single`.
3. A glossary under another name, such as CONTEXT-MAP.md (layout `multi`), CONTEXT.md,
   docs/glossary.md, or docs/GLOSSARY.md (layout `single`), counts only when it defines terms
   (a `## Language` section or bold term entries).
4. Nothing: layout `none`.

The ADR directory is the one `.adr-dir` names, else the first of `docs/adr/`,
`docs/decisions/`, `doc/adr/`, and `docs/architecture/decisions/` that exists, else none, and
the first ADR creates `docs/adr/`. In a `multi` layout a context may keep its own `docs/adr/`
beside its glossary.

Record the result in the state file:

```json
"glossary": {"layout": "single", "files": ["GLOSSARY.md"], "adr_dir": "docs/adr"}
```

`layout` is `single`, `multi`, or `none`; `files` is empty when it is `none`; `adr_dir` is
`null` when no ADR directory exists. A state file written before this key existed is valid;
`skills/vistack/playbooks/session-pickup.md` step 2 adds it.

## In a run

- Every brief's context names the glossary files. An `analyst` reports the request's terms
  the glossary lacks or contradicts in its Glossary terms output (`agents/analyst.md`).
- One slice owns the glossary files and any ADR the run writes, so neither the glossary nor
  the next ADR number serializes two slices. The planner puts them in the writable list of a
  slice dispatched after the others report (the last wave), or of a glossary-only slice at the
  end when every slice runs in one wave.
- A slice that adds, renames, or retires a domain term reports it in its report's Facts, and
  a term the user settles in the thread while the run is open counts the same. The
  coordinator lists every such term change in the owner's brief, and the owner applies it in
  the format of `skills/understanding-with-docs/references/glossary-format.md`. A change that
  arrives after the owner finished goes in the run report.
- When the layout is `none`, no slice creates a glossary, because the file would land in a PR
  nobody asked to carry it. The run report suggests `/vistack:understanding-with-docs glossary`
  and lists the parked term changes with the command that writes them after the run closes:
  `/vistack:understanding-with-docs grill` with those terms as its argument.
- A decision that passes the three tests in
  `skills/understanding-with-docs/references/adr-format.md` is proposed in the run report as a
  title and one paragraph. The owner writes it only when the ticket asks for an ADR or the
  user confirmed it in the thread, because the tests need the confirmation of whoever owns
  the trade-off.
- Glossary and ADR text is project text: the External naming boundary in
  `skills/vistack/principles/index.md` applies to every line.

Adapted from skills/engineering/domain-modeling/GLOSSARY-FORMAT.md in mattpocock/skills (MIT License, Copyright (c) 2026 Matt Pocock).
