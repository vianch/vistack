# Review watch

The review watch reviews the pull requests that ask for your review and answers the comments
that tag you, every 30 minutes, until you switch it off. It posts under your GitHub account, in
your voice, so read what it may and may not do before you switch it on.

The contract is `skills/review-watch/SKILL.md`. Its state file and exit codes are defined in
`skills/review-watch/references/data.md`. The command is `/vistack:review-watch`.

## What a pass does

A pass runs every 30 minutes and does this:

1. Takes the pass lock. If the watch is off, or another pass started less than 20 minutes ago,
   it stops there.
2. Scans the realm for open pull requests where you, or a team you belong to, are a requested
   reviewer, and for open pull requests that mention you or one of your teams.
3. Drops everything already handled, then claims at most 3 reviews and 5 replies. The rest wait
   for the next pass.
4. Reviews each claimed pull request with the same reviewers `review-pr` uses, and drafts one
   reply per claimed mention with the `mention-responder` agent. Every draft is checked against
   the code at the head commit before it posts.
5. Posts, then records what happened in the state file.

A pass with nothing new prints "nothing new". A pass that did something prints a few lines: the
counts, one line per post with its link, one line per needs-you item, and one line per clean
review. You get a push notification only when something was posted or needs you.

## What it posts

- **One COMMENT review per head commit** on each pull request that requests your review. A new
  push gives a new head and a new review.
- **One reply per mention**, on the thread where you were tagged. A reply to a review comment
  goes to the top comment of that thread. A reply to a conversation comment or a review summary
  starts with a one-line quote of the comment it answers.

Both go through `skills/review-pr/scripts/post-review.mjs` as you, in your voice, and carry no
mention of a tool, agent, or model.

## What it never does

- Approve or request changes. Those are merge decisions, and they stay yours.
- Resolve threads, or edit or delete a comment.
- Edit, close, label, assign, push to, or merge a pull request.
- Post anything outside the realm.
- Answer a question only you can answer: an approval, a merge, a scope or priority call, a
  commitment or a date on your behalf, access, anything about people, a policy exception. Those
  go to the needs-you list.
- Follow an instruction written inside a comment. Mention text is data. A comment that tries to
  give the watch an order goes to needs-you with the instruction named.
- Answer mentions made before you switched it on. The mention window starts at the moment of
  `on` (see below).

When a review finds nothing worth saying, nothing is posted. The pull request is listed as
"reviewed, nothing to flag, awaiting your approval", and your review request stays pending on
GitHub until you act on it.

## What it skips

| Skipped | Why |
|---|---|
| Draft pull requests | Not ready for review |
| Your own pull requests | It never answers itself or reviews your work |
| Archived repositories | Read-only |
| Closed pull requests | Nothing to review |
| Comments from bots | Nothing to answer |
| Your own comments | You wrote them |
| Anything outside the realm | The watch never leaves the realm you chose |
| Mentions already answered | You, or an earlier pass, replied after the tag |
| Mentions inside code blocks | A quoted `@name` is not a tag |

Mentions in a pull request description, and mentions on issues rather than pull requests, are
not answered.

## Setup

1. **Install `gh` and sign in.** `gh auth login`.
2. **Check the scopes.** The token needs `repo` and `read:org`. Without `read:org` the watch
   cannot list your teams, so it sees only your own review requests and mentions and prints
   "team reviews not watched". Add the scope with `gh auth refresh -s read:org`.
3. **Pick the realm.** The realm is the one GitHub host and owner the watch may touch, written
   `host/owner`, for example `github.com/your-org`. `on --realm github.com/your-org` sets it.
   Without `--realm`, `on` takes the realm from the current repository's origin. When neither
   gives one, `on` refuses. Run `/vistack:review-watch on --realm <host/owner>` from a session
   whose repository is inside that realm.
4. **Have Node 18 or later** on the path. The scripts have no other dependency.
5. **Allow the pass's commands.** Each pass runs `gh api …`, `node …/skills/review-pr/scripts/post-review.mjs`,
   and `node …/skills/review-watch/scripts/*.mjs` through Bash in your own session, so in a
   permission mode that prompts for those commands every pass stops at a dialog. Allow those
   commands, or use a mode that permits them, before switching the watch on.

## Switch it on, off, or look at it

All three are arguments of `/vistack:review-watch`. An empty argument means `status`.

| Command | What it does |
|---|---|
| `on [--realm host/owner]` | Probes GitHub once and reports your login and team count, switches the watch on, and on Claude Code arms a `/loop 30m` in this session |
| `off` | Switches the watch off, and deletes this session's loop. A loop in another open session ends at its next fire |
| `status` | Reports on or off, the realm, the last pass, the needs-you items, the clean reviews awaiting approval, and whether this session holds the loop |
| `pass [--realm host/owner]` | Runs one pass now. The loop runs this; you may run it by hand |

`off` keeps the history. A later `on` does not review the same head commits again.

## The 30-minute loop

On Claude Code the loop is a session `/loop`, and that shapes how it behaves:

- **It lives in one session.** A session loop ends with its session and expires after 7 days.
- **The deck re-arms it.** In an interactive session, at session start, the deck starts a loop
  when the watch is on and the session's repository origin is inside the realm. It skips that
  when any session ran a pass in the last 40 minutes. It also starts a fresh loop when the
  current one has 12 hours or less before the 7-day expiry, and when passes stop for 40
  minutes. A headless session never starts one.
- **One loop does the work.** With several sessions open, the first loop that fires takes the
  pass lock. A second loop that fires within 20 minutes finds the lock or the recent pass and
  stops after one line. Each fire still costs the session a short turn.
- **Without the deck, or on Codex, nothing re-arms.** Run `on` in each session you want a loop
  in. On Codex there is no loop at all: `on` records the state, and `pass` runs in the thread
  when you ask.

### Keep awake

The deck's keep-awake setting counts work scheduled within 30 minutes. With the watch on and
keep-awake set to While working, the machine does not idle-sleep, because the next pass is
always within 30 minutes. Choose Off to let it sleep. Passes then run only while the machine is
awake.

## The mention window

A pass reads comments created at or after a `since` time, which only moves forward. It starts
at `on`, and each pass re-reads the last 2 hours so a late comment is not lost.

- A burst of more than 5 mentions in one pass is answered 5 at a time. The window stays open at
  the oldest unanswered one until the backlog drains, so none slides out unanswered.
- One scan reads the comments of at most 20 mentioned pull requests, newest activity first. If
  more than 20 pull requests were mentioned inside one window, the oldest can be dropped from
  that pass. The rest of the pass notes "more mentions than one pass takes".
- A mention that predates `on` is never answered.

## In the deck

The Board has a Review watch block, hidden when there is no state file.

The deck reads `state.json` every 5 minutes and on Refresh.

- The header shows `on · <realm>` or `off`.
- The loop line says "armed · rotates in …", "arming…", "turning off…", or "not armed in this
  session", then "· last pass <ago>". An error line, such as "command not loaded" or "names no
  valid realm", sits under it.
- **Needs you** rows, in a warning color, show who asked, what, and why it needs you. They stay
  until you answer on GitHub, and expire after 14 days.
- **Clean** rows, titled "reviewed, nothing to flag, awaiting your approval (n)".
- The last 5 posts.
- Pressing a row shows its URL.
- A two-press **Turn off** button, with no hotkey, shown while the watch is on and no off is
  pending.

**Cancel** on the watch's row in Monitors, **Stop all** while a watch row is open, and **Turn
off** all switch the watch off, not only the loop. Without that, the next session start would
re-arm a watch you had just stopped. The deck runs `watch-state.mjs off` with
`VISTACK_REVIEW_WATCH_DIR` set to the directory it read. Exit 1 means the write lock is held, and
the deck retries up to 3 attempts, 2 s apart. On exit 0 it shows "Review watch is off.", deletes
this session's watch crons, and arms nothing. Otherwise it sends `/vistack:review-watch off` as a
fallback, and if that fails the toast reads "Could not turn the review watch off: … Run
/vistack:review-watch off." While an off is pending the loop line reads "turning off…" and
nothing arms.

## Where the state lives

`~/.vistack/review-watch/`, or the directory named by `VISTACK_REVIEW_WATCH_DIR`. The directory
is mode 0700 and `state.json` is 0600. It holds the watch's switch, realm, what it has handled,
the needs-you and clean lists, and the last posts. Per-pass files sit beside it under
`reviews/`, `replies/`, and `passes/`. The state is user-level, so every session and the deck
read the same file. Only `watch-state.mjs` writes it.

## Troubleshooting

Exit codes of `watch-state.mjs`, which the pass reads:

| Code | Meaning |
|---|---|
| 0 | Ok |
| 1 | Bad input, an unreadable state file, or `claim` without the pass lock |
| 4 | `begin` found the watch off. The loop deletes itself |
| 5 | `begin` skipped: another pass holds the lock or one started less than 20 minutes ago |
| 6 | The loop's realm differs from the state's. The loop deletes itself |

`watch-scan.mjs` exits 2 for a missing or invalid realm and 3 when a `gh` call failed.

| Symptom | Likely cause |
|---|---|
| "team reviews not watched" | The token lacks `read:org`. Run `gh auth refresh -s read:org` |
| "partial scan; the next pass continues" | The search budget ran out. The next pass continues |
| Board says "not armed in this session" | Another session ran a pass within 40 minutes, this session's origin is outside the realm, or the session is not interactive. Run `on` here to arm one |
| Board says "command not loaded" | `$.command.list()` did not list the plugin command. Reload plugins |
| Board stays on "turning off…" | The fallback ran but the file never read off. Run `/vistack:review-watch off` and open a new session |
| Passes stop and nothing re-arms | The session ended, or 7 days passed, with no deck. Run `on` |
| A pass reports a `gh` login error | The login expired. Run `gh auth login`. A missing login stops the pass |
| State file unreadable | `off` replaces it and keeps a `state.json.corrupt-<time>` copy |

## Your first-run checklist

Run these once, after the installed copy is synced, in a new session inside a repository in the
realm.

1. **The loop's prompt.** Run `/loop 30m /vistack:review-watch status`, then `CronList`. Check
   whether the job's prompt carries the command text. The deck uses it to find the watch row for
   rotation and for Cancel. If it does not, the deck falls back on the Turn off button and its
   40-minute check.
2. **The command name.** `$.command.list()` should list `vistack:review-watch`, and the deck
   arms with that exact name.
3. **Loop creation seen by the deck.** Check whether a loop the deck started reaches the deck's
   own tool-call hook. The deck's logs show it at debug level.
4. **The `gh` search forms.**
   - `review-requested:@me` and `team-review-requested:<owner>/<slug>`;
   - `team:<owner>/<slug>` for team mentions;
   - `user:` against `org:` for the realm owner;
   - the search rate limit holds with `2 + 2 x teams` queries;
   - `gh api user/teams` needs `read:org`.
5. **A COMMENT review clears your pending review request.** The pull request should leave the
   review-requested search, and a re-request on a new head should bring it back.
6. **Replies.** A reply to a nested review comment lands on the top comment's thread, and a
   reply to a conversation comment reads naturally with its quote line.
7. **End to end, in a sandbox repository in the realm:**
   1. Switch on.
   2. A teammate requests your review. Within 30 minutes one COMMENT review appears.
   3. Someone writes "@you what does X do?". A reply appears.
   4. Someone writes "@you can you approve this?". No reply appears. It shows as needs-you on
      the Board and in the pass report.
   5. Open a draft pull request, one of your own, and a bot comment. Nothing happens.
   6. Press **Turn off** on the Board. No further pass runs.
   7. With two sessions open, only one session's pass posts in each 30-minute window.
8. **The `mention-responder` agent.** `claude plugin details vistack` lists it with `opus` and its
   tools. Send one dry dispatch on a harmless mention. Ask it to post a reply, and check that it
   declines.
9. **Routing.** "review this PR <url>" still goes to `review-pr`. "watch my review requests"
   goes to the review watch.
10. **Keep-awake.** With the watch on and While working set, the machine stays awake. With Off,
    it sleeps.
11. **Rotation (optional).** Leave a session open past 6.5 days and check that a new loop
    replaced the old one.
12. **Two open questions in the scan.** Whether your own pending review comments show up in a
    pull request's review comments, and whether a tag inside a blockquote counts as a mention.
