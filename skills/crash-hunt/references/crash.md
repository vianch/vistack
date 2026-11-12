# Crash

What a crash hunt counts as a crash, how one is named, when it is new, and when it is valid.
`skills/crash-hunt/SKILL.md` runs the hunt and `agents/crash-hunter.md` applies this file.

## Kinds

A closed set. A proven crash has exactly one kind.

| Kind | Observed as |
|---|---|
| `process-exit` | After a request, the app process exits or its health path stops answering with a 2xx. |
| `server-error` | A 5xx response whose app log shows an unhandled exception for that request. |
| `hang` | No status line within the timeout while health still answers. |

The driver reports candidates from what it can see. A 5xx is a `server-error` candidate until
the app log, found by the request's `at` time in `crashes.jsonl`, shows an unhandled exception
for it; a 5xx the app returns on purpose with nothing unhandled logged is not a crash. A
`reset`, a connection closed without a response while health answers, is not a crash either,
because servers close on malformed framing by design.

When two kinds fit one request, the more severe wins, in the order `process-exit`,
`server-error`, `hang`.

## Signature

```text
<kind>|<root exception class>|<top in-repository frame>|<METHOD>|<route template>
```

- **root exception class**: the innermost cause in the logged chain, as the log prints it. For
  `process-exit`, the fatal error or signal the log tail names. `none` when the log shows none,
  as for most hangs.
- **top in-repository frame**: the first stack frame whose file is inside the consuming
  repository, as `<repository-relative path>:<function>`. No line number, so an unrelated edit
  above the frame does not turn a known crash into a new one. `none` without a stack.
- **METHOD** and **route template**: the `route` field of the crash record, the route as the
  routes file lists it, `{name}` placeholders kept.

The slug names the fix branch, `claude/crash-<slug>`. Lowercase
`<kind>-<METHOD>-<route template>-<root exception class without its namespace>`, turn every run
of characters outside `a-z0-9` into one `-`, cut it to 48 characters, trim a trailing `-`, and
append `-` and the first 7 hex characters of the signature's SHA-256 (`shasum -a 256` or
`sha256sum`). For the signature
`server-error|QuantityParseError|src/orders/lines:parseQuantity|POST|/orders/{orderId}/lines`
the slug is `server-error-post-orders-orderid-lines-quantityp-2440889`.

## Known list

`<state-root>/crash-hunt/known.jsonl` is the history of proven crashes, not an exclusion list.
It is append-only, one JSON object per line, and only `crash-hunter` appends to it.

```json
{"signature": "<signature>", "slug": "<slug>", "kind": "server-error", "route": "POST /orders/{orderId}/lines", "exception": "<class>", "frame": "<path>:<function>", "firstSeen": "<run-id>", "lastSeen": "<run-id>", "commit": "<sha7>", "picked": null}
```

The last row for a signature is its current state. Run ids are UTC times, so they sort by age.
Each run that proves a crash appends one row for it, with `lastSeen` set to this run's id and
`firstSeen` and `picked` copied from the signature's last row, or `firstSeen` set to this run's
id on a first sighting. The row appended after a fix is proved sets `picked` to
`{"fix": "<sha7>", "branch": "claude/crash-<slug>", "run": "<run-id>"}`.

## When a crash is new

A proven crash is new when it reproduces on the base head in this run and no
`claude/crash-<its slug>` branch is among the open PRs or the PRs closed unmerged in the last 30
days. The known list never excludes a crash. One seen before and never picked stays a candidate
every night. One whose last row has `picked` set and that reproduces on the base head again is a
regression, counts as new, and is reported as a regression. At an equal ranking score the older
`firstSeen` ranks first (`skills/vistack/playbooks/crash-hunt.md`, step 9).

## Validity

A finding counts only when every rule holds. Anything else is dropped, and the hunt's report
lists each dropped crash with the rule it failed.

- **The real app produced it.** The app booted from the commit under test against the
  disposable local database the run created, with no mock, stub, or fake of the code under
  test.
- **Its control passed.** The driver sends one well-formed request per route, built from the
  routes file's examples, before any mutation. A control that also fails means environment, not
  a finding, and the driver skips that route.
- **It is not harness-induced.** A 5xx whose root exception is a refused or blocked outbound
  call is dropped, because the gate kept that host unreachable on purpose. So is a crash from an
  exhausted local resource, such as disk, file handles, or the database's connection limit.
- **Replay reproduces it on a fresh boot.** `replay` exits 1 against a new process of the same
  commit. A crash that needs state left by earlier fuzz requests does not reproduce and is
  dropped.
- **A proof replays on a fresh boot from the fix commit**, built in the fix slice's worktree,
  with PID and commit recorded and no base-branch instance on the port. A proof that cannot
  show both values is not a proof.

A fresh boot stops the app, returns the database to its seeded state (`database.reset`, or
`down` then `up`), builds and starts the app in the worktree checked out at the named commit,
waits for the health path, and writes its boot record with the database identifier
(`skills/crash-hunt/SKILL.md`, Run layout). Recreating the database with `down` then `up` deletes
only that recorded database.
