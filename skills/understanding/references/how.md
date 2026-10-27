# how: trace the mechanism

The question is about behavior, so the answer is a path through code that a reader can walk
and check.

## Method

1. **Pin an observable.** Restate the question as an input and an effect: a command, an
   endpoint, a UI action, an event, and what changes because of it. A question with no
   observable ("how does auth work") gets one picked and named ("signing in with a password").
2. **Anchor on a string the user can see.** An error message, a route path, a CLI flag, a UI
   label, or an event name finds the entry point faster than guessing at names:
   `rg -n "<string>"`. Dynamic dispatch (dependency injection, event buses, string keys) is
   traced by searching the key, not the function name.
3. **Walk forward to the effect.** Follow calls until the state change: a write, a request, a
   render, a file. Record each hop as `file:line` plus one clause on what it does, read from
   the body, not the name. Use LSP go-to-definition where the host has it. Generated code is
   traced to its generator and input; a path that leaves the repository stops at the
   contract (API schema, published type) and names the repository that owns the other side.
4. **Note the shape at each boundary.** The type or schema crossing a module, process, or
   network edge, and where it is validated or transformed. Skip boundaries the question does
   not touch.
5. **Name what changes the outcome.** Feature flags, configuration, environment, permissions,
   and the error paths. A happy-path-only answer is half an answer; say which half you gave.
6. **Find the tests that pin it.** A test is documentation that runs. Name it, or name the
   path no test covers.
7. **Stop when it is answered.** List what you did not trace.

## Answer shape

```
<one paragraph that answers the question>

Path
1. path/to/entry.ts:42: <what happens>
2. path/to/service.ts:118: <what happens>
…
Boundaries: <shapes, only where relevant>
Branches: <flags, config, error paths>
Tests: <test names, or "no test covers X">
Not traced: <what is left>
Read next: <two or three files>
```

Draw a diagram, ASCII or Mermaid, only when four or more components interact.

