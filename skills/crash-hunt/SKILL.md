---
name: crash-hunt
description: "'fuzz the app', 'send it malformed requests', 'random requests until it crashes', 'crash hunt', 'nightly crash hunt'. Boots the consuming repository's real app on loopback against a disposable local database, sends it random and malformed HTTP requests until it crashes, fixes the root cause of one new crash, proves the fix by replay, and opens one draft PR. A request to fix one named crash is bug-fix."
---

# crash-hunt

`skills/vistack/playbooks/crash-hunt.md` is the executable contract; this skill is a direct
entry point for it and holds the hard limits, the config, the gate, and the driver.
`skills/crash-hunt/references/crash.md` defines crash kinds, signatures, the known list, and
validity. `agents/crash-hunter.md` boots the app, runs the driver, and replays proofs; it never
edits product code.

## Hard limits

These are absolute. The consuming repository's `CLAUDE.md` and rules win over every other part
of this contract, and never over these.

- **Loopback only.** Requests go only to 127.0.0.0/8, ::1, or ::ffff:127.0.0.0/104, and the
  driver enforces it. Before it opens a socket it refuses userinfo in the URL, any scheme but
  http and https, and any resolved address outside those ranges. It then connects to the
  address it checked without resolving again.
- **Never a staging, QA, production, or third-party host**, including through the app's own
  outbound integrations. The pre-boot gate proves every outbound host of the active profile
  passes `check-target`, and an app that would reach anything else is never booted. A stub on a
  container network is reached only through a port published on loopback.
- **Never fake a crash or a fix.** A crash counts only when the real app on a real database
  produces it and a replay reproduces it on a fresh boot; a fix counts only when the replay on a
  fresh boot of the fix commit stops crashing (`skills/crash-hunt/references/crash.md`,
  Validity). No mock of the code under test, in the hunt or in the regression test.
- **The only data a run may delete is a disposable database that a crash-hunt run created and
  recorded in a boot record under `<state-root>/crash-hunt/`.** That database serves nothing but
  crash hunts. Any other deletion is FENCE 3 (`skills/autonomy-has-fences/SKILL.md`).
- **Redact** `Authorization`, `Cookie`, `Set-Cookie`, and token-shaped values in every file,
  ledger row, report, and PR text. The driver redacts what it writes; anything copied from an
  app log is redacted before it is written anywhere.
- **A run that cannot boot the real app reports it and stops.** A gate or boot failure goes to
  the report step with its evidence and is never worked around with a mock or a stub.

## Config

The consuming repository owns `.claude/vistack/crash-hunt.json`; start from
`skills/crash-hunt/assets/crash-hunt.example.json`. A missing file or required field ends the run
at the report step, which names it.

| Field | Required | Holds |
|---|---|---|
| `baseUrl` | yes | The app's loopback URL, with any path prefix every route shares |
| `healthPath` | yes | A path from the host root that answers 2xx while the app is up |
| `boot.command` | yes | Starts the app in the foreground against the disposable database |
| `boot.cwd` | no | Where `boot.command` runs, relative to the hunt worktree's root; default `.` |
| `boot.env` | no | Extra environment, such as the local profile name; never a secret value |
| `boot.readySeconds` | yes | How long `healthPath` may take to answer before the boot counts as failed |
| `database.up` | yes | Creates, migrates, and seeds the disposable local database |
| `database.reset` | no | Returns it to the seeded state; without it a fresh boot runs `down`, then `up` |
| `database.down` | yes | Drops the disposable database |
| `database.datasource` | yes | Prints the datasource the active profile resolves |
| `egress.hostsCommand` | yes | Prints every outbound host the active profile resolves, one per line; each must pass `check-target` |
| `appLog` | yes | The file the app logs to, relative to the hunt worktree's root |
| `routes.source` | yes | `config`, `openapi`, or `code` |
| `routes.list` | with `config` | The routes, in the routes-file shape below |
| `routes.path` | with `openapi` or `code` | A local OpenAPI document, or the files that declare route mappings |
| `auth.headerCommand` | no | Prints one `Name: value` header for a seeded local user; when set, `run` gets `--auth-required` |
| `rules` | yes | Rule files read before every edit, such as entries under `.claude/rules/`; may be empty |
| `budget.requests` | yes | Fuzz requests per run, controls not counted |
| `budget.minutes` | yes | Wall-clock limit for one driver run |
| `budget.seed` | no | `null` draws a new seed each run and the summary prints it; set it only to repeat a run |
| `errorContract` | yes | Where the repository documents its 4xx error shape |

## Pre-boot gate

`crash-hunter` runs every check before every boot, and boots only when all pass. A failure is
reported with the offending value.

- `check-target --base <baseUrl>` exits 0.
- The host in the output of `database.datasource` passes `check-target`, or the datasource is
  a local socket path.
- Every host `egress.hostsCommand` prints passes `check-target`. There is no exception for a
  stub; one on a container network passes only through a port published on loopback.
- `check-target` takes only an http or https URL, so a bare host is checked as
  `check-target --base http://<host>/`, with an IPv6 address in brackets and any port dropped.
- Nothing listens on the `baseUrl` port. A listener whose PID and command line both match a
  boot record under `<state-root>/crash-hunt/`, from this run or an earlier crash-hunt run such
  as one its watchdog killed, is stopped first. Any other listener fails the gate.
- A database that an earlier run's boot record names is a leftover. Once that record's
  listener is stopped, or when no listener is left, the gate drops it with `database.down`. A
  recorded identifier that differs from the one `database.down` acts on fails the gate instead,
  because the configured command cannot reach it.

## Routes

`crash-hunter` writes the routes file to `<state-root>/crash-hunt/<run-id>/routes.json`.
`config` copies `routes.list`, `openapi` takes each operation of the local document, and `code`
reads the route mappings under `routes.path`. A document is never fetched over the network.

```json
[
  { "method": "GET", "path": "/items/{id}", "params": { "id": "1" }, "query": { "limit": 10 } },
  { "method": "POST", "path": "/orders/{orderId}/lines", "params": { "orderId": "1" }, "body": { "sku": "A-1", "quantity": 2 } }
]
```

`params` needs a value for every `{name}` in `path`, and `query` and `headers` are optional
name-to-value maps. `body` is any JSON value, sent as `application/json` unless `headers` names
another type. Take example values from the seeded data, because the control request is built
from them and a control that only reaches a 404 leaves the handler untested. Put no secret in
this file, because replay restores only headers.

## The driver

`skills/crash-hunt/scripts/crash-hunt.mjs` is dependency-free Node. On Claude Code run
`node "${CLAUDE_PLUGIN_ROOT}/skills/crash-hunt/scripts/crash-hunt.mjs" <command> ...`, and on
another host use the installed plugin path; the script path resolves from the plugin root while
the working directory stays in the consuming repository.

| Command | Job | Exit |
|---|---|---|
| `check-target --base <url>` | The loopback guard alone; prints the resolved addresses and opens no connection | 0 loopback, 2 refused |
| `run --base <url> --routes <file> --out <dir> [--seed n] [--requests n] [--minutes n] [--timeout-ms n] [--health <path>] [--header "K: V"]... [--stop-on-crash] [--auth-required] [--start n]` | Checks health, sends one control per route, then fuzzes | 0 no crash, 1 crash found, 2 guard, usage, or setup error |
| `replay --base <url> --request <file> [--header "K: V"]...` | Regenerates one crash's request and sends it once | 0 no crash, 1 crash reproduced, 2 guard, usage, or setup error |

`crash-hunter` passes `baseUrl` as `--base` and `healthPath` as `--health`, and passes
`budget.requests`, `budget.minutes`, and a non-null `budget.seed` as `--requests`, `--minutes`,
and `--seed`. When `auth.headerCommand` is set, the line it prints goes to `--header` on `run`
together with `--auth-required`, and to `--header` again on every `replay`, because the replay
file holds it redacted.

What `run` does:

- **Generator.** A case is seeded by the seed, its route, and that route's own index, so a run
  of one route with the same seed sends that route's exact sequence. Index `i` goes to route
  `i mod <route count>`, and a skipped route loses its slots. The strategies are a closed list,
  `path`, `query`, `body`, `headers`, `method`, and `raw` (protocol malformations sent as
  bytes, about 5 percent of cases), and `variants` in `skills/crash-hunt/scripts/generate.mjs` lists
  each one's variants. No generated value names a host or looks like a token.
- **Sending.** One request per connection, never following a redirect. Every request ends its
  own framing and carries `Connection: close`, so a timeout can only mean the app hung. Raw
  cases carry no `--header` value.
- **Outcomes.** `ok` (below 400), `client-error`, `server-error`, `hang` (no status line within
  `--timeout-ms`), or `reset` (closed without a response). After a `server-error`, `hang`, or
  `reset` the driver probes health, a 2xx from `--health` or a TCP connect without it, and a
  failed probe makes the crash a `process-exit`. A refused connection makes the previous
  request a `process-exit`.
- **Controls.** A route whose control is not `ok` or `client-error` is skipped and listed in
  the summary. When every route is skipped, or the app stops answering during the controls,
  the run exits 2. With `--auth-required`, a run whose every control answered 401 or 403 stops
  before any fuzz request with `stopped` set to `auth-rejected` and exit 2. The local auth setup
  is broken, so `crash-hunter` tears down and the run goes to the report step with that finding.
- **Files in `--out`.** `requests.jsonl` holds every request, controls included, with outcome,
  status, and send time `at`. `crashes.jsonl` holds one line per crash with its kind, `detected`
  (`status`, `timeout`, `health`, or `next-connect`), index, and replay file. There is one
  `replay-<index>.json` per crash. Credential-named headers, token-shaped values, and every
  secret `--header` value are redacted.
- **Summary.** stdout carries the seed, `nextIndex`, `sent`, outcome and crash counts, each
  route's control result, and `stopped`, which is one of `requests`, `minutes`,
  `stop-on-crash`, `process-exit`, `no-routes`, `control-exit`, or `auth-rejected`.
- **After a `process-exit`**, fresh-boot the app and continue the same seed into the same
  `--out` with `--start <nextIndex>`. A reused `--out` without `--start` is refused.

`replay` refuses a file that this generator would not produce for the file's seed, route, and
index, which means a different plugin version wrote it. It refuses until every redacted header is
supplied again with `--header`, and exits 2, not 1, when the app does not answer before the
send. It probes health after a short grace even when the response looked normal, so an exit that
follows a response still counts. Its JSON carries the status, content type, and a redacted body
excerpt.

**Proving a fix.** On a fresh boot of the fix commit, `replay` exits 0 and the excerpt follows
`errorContract`. Then `run` with a routes file holding only the crash's route, the crash's
`--seed`, and `--requests` above the crash's `routeIndex` resends that route's sequence through
the crash and must find no new crash.

## Run layout

- Run id: the UTC start time as `YYYYMMDDTHHMMZ`; ledger slug `crash-hunt-<run-id>`.
- Hunt worktree: before the gate, the coordinator creates a detached worktree at the base
  branch head, `<worktree-root>/crash-hunt-<run-id>`, so a dirty or switched operator checkout
  never boots. It counts as the hunt's slice under the worktree count rule
  (`skills/coordinate/SKILL.md`, Dispatch rules). `crash-hunter` builds and boots the base app
  there and runs every config command from it. The fix proof boots from the fix slice's
  worktree, and the report step removes the hunt worktree.
- Boot record: `<state-root>/crash-hunt/<run-id>/boot.json`. It is written as soon as the
  disposable database exists, with the run id and the database's identifier, the one
  `database.down` acts on as `database.datasource` prints it. Every boot then adds the PID and
  command line of the process listening on the port, as `ps -o command= -p <pid>` prints it,
  the port, the commit, and the boot time. The gate matches listeners and leftover databases
  against these records.
- Evidence: `<state-root>/crash-hunt/<run-id>/` holds the routes file, each driver `--out`,
  app log excerpts, and dossiers. The known list is `<state-root>/crash-hunt/known.jsonl`.
- In a headless `claude -p` run, such as a nightly schedule, every lane finishes before the
  final message. The process ends with that message, and a lane still running then loses its
  results and never tears down its app or database.
- **Schedule.** Nightly, through `skills/routine-healthcheck/SKILL.md` (Install, Nightly
  repository routines) and `scripts/run-routine.sh`. `/loop` dies with its session, so it
  cannot hold a nightly routine. A Claude Code cloud routine cannot reach the local app and
  database, and whether it loads this plugin is unverified.
