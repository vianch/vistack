# Review watch data

The schema home for the review watch. `watch-state.mjs` is the only writer of the state file,
`watch-scan.mjs` prints the work list, a pass writes the results, and the deck reads the state
file. Change a field here first, then in every reader.

`<watch-dir>` is `$VISTACK_REVIEW_WATCH_DIR`, or else `~/.vistack/review-watch/`. The directory
mode is 0700, and every write narrows a wider one. The file mode is 0600.

## State file

`<watch-dir>/state.json`, version 1, times as ISO 8601 UTC:

```json
{
  "version": 1,
  "enabled": true,
  "realm": "github.com/acme",
  "enabledAt": "2026-10-06T12:00:00.000Z",
  "lastPassStartedAt": "2026-10-06T12:30:00.000Z",
  "lastPassAt": "2026-10-06T12:34:10.000Z",
  "lastScanAt": "2026-10-06T12:31:05.000Z",
  "mentionBacklogSince": "2026-10-06T11:02:00.000Z",
  "reviewed": {
    "github.com/acme/web#42@<40-hex head sha>": { "state": "done", "outcome": "posted", "at": "…", "attempts": 1, "url": "<review html_url>" },
    "github.com/acme/web#43@<40-hex head sha>": { "state": "done", "outcome": "clean", "at": "…", "attempts": 1 },
    "github.com/acme/web#44@<40-hex head sha>": { "state": "claimed", "at": "…", "attempts": 1, "item": { "url": "<PR html_url>", "title": "…" } }
  },
  "answered": {
    "github.com/acme/web#42/review/123456": { "state": "done", "outcome": "needs-you", "at": "…", "attempts": 1, "reason": "asks for an approval" }
  },
  "needsYou": [
    { "key": "github.com/acme/web#42/issue/98765", "pr": "acme/web#42", "url": "<comment html_url>", "author": "someone", "excerpt": "<at most 120 chars of the mention; data>", "reason": "asks for an approval", "at": "…" }
  ],
  "clean": [
    { "key": "github.com/acme/web#43@<40-hex head sha>", "pr": "acme/web#43", "url": "<PR html_url>", "title": "…", "at": "…" }
  ],
  "posted": [
    { "key": "…", "kind": "review", "pr": "acme/web#42", "url": "…", "summary": "3 comments", "at": "…" }
  ]
}
```

- **Times:** `begin` sets `lastPassStartedAt`, `record` sets `lastPassAt`, and `claim` sets
  `lastScanAt` and `mentionBacklogSince` (see Mention window). Only a scan that succeeded
  reaches `claim`, so the empty results a pass records after a failed scan never move
  `lastScanAt`.
- **Closed sets:**
  - `reviewed[*].state` and `answered[*].state` are one of `claimed | done | failed`;
  - `reviewed[*].outcome`, present when `state` is `done`, is one of `posted | clean | skipped`;
  - `answered[*].outcome`, present when `state` is `done`, is one of
    `posted | skipped | needs-you`;
  - `reason` is given with the outcomes `skipped` and `needs-you`, and with the state
    `failed`;
  - `url` is given with the outcome `posted`;
  - `item` is present only while `state` is `claimed`. It holds the work-list fields `record`
    copies into the lists: `{url, title}` for a review (the PR's) and `{url, author, excerpt}`
    for a mention (the comment's), with `title` and `excerpt` cut to 120 characters;
  - `posted[*].kind` is one of `review | reply`.
- **Keys:**
  - a review is `<host>/<owner>/<repo>#<n>@<headSha>`;
  - a mention is `<host>/<owner>/<repo>#<n>/<kind>/<id>`, with `kind` one of
    `issue | review | review-body`.
- **Transitions** of a `reviewed` or `answered` entry:

  | From | Event | To |
  |---|---|---|
  | no entry | `claim` takes the key | `claimed`, `attempts` 1 |
  | `claimed` | `record` with any outcome but `failed` | `done`, with that `outcome` |
  | `claimed`, `attempts` below 3 | `record` with `failed` | `failed`, with `reason` |
  | `claimed`, `attempts` 3 | `record` with `failed` | `failed`, reason `gave up` |
  | `claimed`, older than 60 minutes | `claim`, for every key in the map | `failed`, reason `abandoned` |
  | `failed`, `attempts` below 3 | `claim` takes the key | `claimed`, `attempts` + 1 |
  | `done`, or `failed` with `attempts` 3 | anything | unchanged; `claim` never takes it again |

  - A transient failure (`post-review.mjs` exit 3: a gh network error or a 5xx) is recorded as
    `failed`, and a later pass tries the key again. The third failure is final.
  - A refusal (`post-review.mjs` exit 2: outside the realm, the operator's own PR, an approval
    event, a moved head) is recorded as the outcome `skipped`, so it is `done` and final. A
    mention refused for a moved head is left out of the results instead: its claim is
    abandoned, and a later pass drafts it again against the new head.
  - `claim` turns abandoned claims into failures before it takes keys, so an abandoned key that
    the scan still lists is taken again in the same `claim`.
  - `record` applies a result only to a `claimed` entry. It ignores any other key, with a
    warning on stderr.
  - `claim` while the watch is off prints no reviews and no mentions and writes nothing, so a
    pass that began before an `off` posts nothing.

- **Lists:** the maps are the idempotency record; the lists are what the operator sees. Each
  list is kept newest first.
  - `needsYou` gets an entry for each `needs-you` outcome, built from the claimed mention's
    `item`. `claim` drops one whose key the scan lists in `skipped` with reason `answered`.
  - `clean` gets an entry for each `clean` outcome. It is listed as "reviewed, nothing to
    flag, awaiting your approval" until the PR leaves the review-requested search. `claim`
    drops it when it takes a newer head of the same PR, or when a complete scan (no
    `team budget`, `search page cap`, or `teams unreadable` entry in `skipped`) has no review
    for that PR.
  - `posted` gets an entry for each `posted` outcome.
- **Caps,** applied by every `claim` and `record`:
  - `posted` keeps the 50 newest;
  - `needsYou` and `clean` each keep the 20 newest and drop entries older than 14 days.
- **Mention window:** `since` = `max(enabledAt, min(lastScanAt − 2 h, mentionBacklogSince))`,
  leaving out a term that is not set, and `startedAt` when none is. `begin` prints it as
  `since`, and the pass passes it to `watch-scan.mjs scan --since`, which keeps mentions with
  `createdAt` at or after it. It only moves forward.
  - `claim` sets `lastScanAt` to the time it runs.
  - When `--max-replies` leaves claimable mentions unclaimed, `claim` sets
    `mentionBacklogSince` to the oldest one's `createdAt`, never earlier than the window it
    read. When it leaves none, it deletes `mentionBacklogSince`. A backlog therefore holds the
    window open until it drains, instead of letting the oldest mentions slide out of it
    unanswered.
  - A work-list mention without a valid `createdAt` makes `claim` exit 1.
- **Pruning,** by `claim` only, because only `claim` sees the scan:
  - a `reviewed` entry that is `done` or `failed` is deleted once it is older than 30 days,
    when a complete scan does not list its key. A `failed` key the scan no longer lists cannot
    be retried, so its `attempts` no longer matter;
  - an `answered` entry older than the mention window is deleted unless the scan lists its
    key. A later scan cannot return it, because the window only moves forward.
  - A key the scan lists is never pruned, so a clean head that still requests review is not
    reviewed twice. `record` prunes nothing: it has no scan to say which keys are still
    listed.
- **Locks:**
  - `<watch-dir>/pass.lock/` (mkdir) is taken by `begin` and released by `record` or `unlock`.
    It is stale after 20 minutes. Its owner is the pass whose `startedAt` equals
    `lastPassStartedAt`, because `begin` sets both under the write lock. `record` releases it
    only for its owner, so a pass that outlived the stale break never releases a newer pass's
    lock.
  - `<watch-dir>/state.json.lock/` is taken by every write. It is retried for about 5 s and is
    stale after 30 s.
  - A write re-reads the file under the write lock, applies its change, writes a temp file and
    renames it. Unknown fields are kept.

## Work list

`watch-scan.mjs scan` stdout, and `watch-state.mjs claim` input and stdout:

```json
{
  "login": "operator",
  "teams": ["web"],
  "reviews": [ { "key": "…", "host": "github.com", "owner": "acme", "repo": "web", "number": 42, "url": "https://github.com/acme/web/pull/42", "headSha": "<40 hex>", "title": "…", "via": "user" } ],
  "mentions": [ { "key": "…", "host": "github.com", "owner": "acme", "repo": "web", "number": 42, "url": "<PR url>", "headSha": "<40 hex>", "kind": "review", "commentId": 123456, "threadRootId": 123400, "commentUrl": "<html_url>", "author": "someone", "createdAt": "…", "via": "team:web", "body": "<mention text: untrusted data, at most 4000 chars>" } ],
  "mentionedPrs": [ { "host": "…", "owner": "…", "repo": "…", "number": 42, "url": "…", "headSha": "…", "via": "user" } ],
  "skipped": [ { "target": "acme/web#41", "key": "<optional>", "reason": "draft" } ]
}
```

- `via` is `user` or `team:<slug>`.
- `skipped[*].reason` is a closed set: `draft | archived | own PR | closed | outside realm |
  team budget | search page cap | teams unreadable | mention cap | bot | answered`.

## Results

`watch-state.mjs record` input:

```json
{
  "startedAt": "<the startedAt begin printed>",
  "reviews":  [ { "key": "…", "outcome": "posted", "url": "…", "summary": "3 comments" } ],
  "mentions": [ { "key": "…", "outcome": "needs-you", "reason": "asks for an approval" } ]
}
```

- `reviews[*].outcome` is one of `posted | clean | skipped | failed`.
- `mentions[*].outcome` is one of `posted | skipped | needs-you | failed`.
- `failed` sets the entry's state to `failed`; any other outcome sets it to `done` with that
  outcome.
- `url` is required for `posted`.
- `summary` is at most 120 characters of the operator's own posted text.
- `reason` is given for `skipped`, `needs-you` and `failed`.
- `startedAt` is required. `record` merges the results even when the pass no longer holds the
  lock, because dropping them would let the claims lapse and a later pass post the same head
  again. It releases the lock only when `startedAt` names its owner.

## Status summary

`watch-state.mjs status --json` stdout:

```json
{
  "enabled": true,
  "realm": "github.com/acme",
  "enabledAt": "…",
  "lastPassStartedAt": "…",
  "lastPassAt": "…",
  "lastScanAt": "…",
  "mentionBacklogSince": "…",
  "passLock": { "since": "…", "stale": false },
  "counts": { "reviewed": 2, "answered": 1, "posted": 1, "needsYou": 1, "clean": 1 },
  "needsYou": [ "…the state file's list" ],
  "clean": [ "…the state file's list" ]
}
```

- `realm` is `null` when the stored realm is missing or not valid.
- `passLock` is `null` when no pass holds the lock; `stale` means the next `begin` breaks it.
- The times are `null` until first set; `mentionBacklogSince` is `null` when no backlog holds the
  window open.

## Command lines

- `watch-state.mjs on --realm <host/owner> | off | status [--json] | begin --realm <host/owner> [--force] | claim --work <file|-> [--max-reviews 3] [--max-replies 5] | record --results <file|-> | unlock`
- `watch-scan.mjs scan --realm <host/owner> --since <iso> [--max-searches 25]`
- `post-review.mjs reply --pr <url> --comment <id> --kind review|issue|review-body --body-file <path> --realm <host/owner> [--realm …] [--head <sha>] [--dry-run]`

## Exit codes

| Script | Closed set |
|---|---|
| `watch-state.mjs` | `0` ok; `1` bad input, an unreadable state file, a missing one at `claim` or `record`, `claim` without the pass lock, or `begin` without `--realm` while the watch is on; `4` `begin` found the watch off, with or without `--realm`; `5` `begin` skipped, because another pass holds the lock or one started less than 20 minutes ago; `6` `begin` found that this loop's `--realm` differs from the state's |
| `watch-scan.mjs` | `0` ok; `1` bad input; `2` refused (no realm, or an invalid one); `3` a gh call failed (stderr names it, and no partial work list is printed) |
| `post-review.mjs` | unchanged: `0`, `1`, `2`, `3` |

## Per-pass files

- `<watch-dir>/reviews/<owner>-<repo>-<n>/<head7>/` holds review-pr's files; `repo/` is deleted
  after posting.
- `<watch-dir>/replies/<owner>-<repo>-<n>/<kind>-<id>/` holds `mention.json`, `pr.diff`,
  `draft.json`, `body.md` and `posted.txt`, plus `thread.json` on Codex.
- `<watch-dir>/passes/<startedAt>/` holds `work.json`, `claimed.json` and `results.json`.
