---
name: user-performance
description: "'what did I ship this week', 'my activity', 'my PR stats', 'how productive was I', 'my performance report', 'activity report', '/user-performance'. Reports the operator's own activity for a period in one repository, a folder of checkouts, or an organization, covering commits and changed lines, pull requests opened, merged, and reviewed, comments, issues created and solved, and tasks and sub-issues created. Delivers one page with tiles, pie, bar, and line charts and states the trend against the periods before. A report on an open run is html-report; a team-metrics question that needs a recommendation is the investigation playbook."
argument-hint: "[period] [repo|folder|org <owner>] [--realm <host>/<owner>]"
---

# user-performance

## Steps

1. **Period.** Use the one the request names. With none, ask once. On Claude Code that is a
   single AskUserQuestion call with Last 7 days (recommended), Current week (so far), Last
   full week, and Last 30 days, a custom range being the free answer; on other hosts it is
   one plain question. No answer, or nobody to answer
   (`skills/never-block-on-the-human/SKILL.md`, Nobody to answer), means last 7 days.
   Check: `--period` is `last-7-days`, `current-week`, `last-week`, `last-30-days`, or
   `YYYY-MM-DD..YYYY-MM-DD` with both days included. Weeks start Monday in the local time
   zone, the collector's default; `--time-zone <IANA>` overrides it.
2. **Scope.** `repo` when the working directory is a git checkout (the default); `folder`
   when it is not but holds checkouts directly under it; `org` with `--org <owner>` only when
   the request names the owner. Check: the `--scope` value.
3. **Realm.** `--realm <host>/<owner>` when given (repeatable), else the output of
   `node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/post-review.mjs" realm` in the
   consuming repository. That command fails without an origin, as in `folder` scope; do not
   borrow a child checkout's origin. With neither, refuse and ask for
   `--realm <host>/<owner>` (`skills/keep-origins-in-realm/SKILL.md`). Check: at least one
   realm in hand.
4. **Ignored.** The activity JSON must never be committable, so before anything is written
   run `git check-ignore -q <state-root>/reports/user-performance-<period>.json` in the
   working directory. Exit 0 means ignored, and exit 128 with `not a git repository` means
   nothing can commit the file. On exit 1, add `<state-root>/` to the file
   `git rev-parse --git-path info/exclude` names, as `skills/coordinate/SKILL.md` Setup
   step 2 ensures for a run, and check again. Any other result, or a line that cannot be
   added, stops the skill with a note to the user.
5. **Collect.** `node "${CLAUDE_PLUGIN_ROOT}/skills/user-performance/scripts/collect.mjs" --realm <realm> --period <period> --scope <scope> [--org <owner>] --out <state-root>/reports/user-performance-<period>.json`.
   Exit 0 wrote the file, even when a source inside it failed. Exit 1 is a bad argument or an
   unwritable `--out`; fix it and rerun. Exit 2 is a refusal (no realm, or an org outside
   it); report it and stop.
6. **Render.** `node "${CLAUDE_PLUGIN_ROOT}/skills/user-performance/scripts/render.mjs" --data <json> --out <state-root>/reports/user-performance-<period>.html`.
   When Delivery calls for the artifact form, also run it with
   `--artifact --out <state-root>/reports/user-performance-<period>.artifact.html`. Never write
   or edit the page by hand. Check: `wrote <path>` on stdout for each run.
7. **Deliver** per `skills/html-report/SKILL.md`, Delivery, with the `.artifact.html` file as
   the artifact form. Check: a link or a path to give.
8. **Answer** in the thread with at most three trend sentences, copied from the page's trend
   list rather than recomputed; then every source that `sources[]` in the JSON marks
   `"ok": false` or `"truncated": true`, with its detail; then the link or path.

Inside an open run, `report-writer` runs steps 4 to 6 (`skills/coordinate/SKILL.md`,
Dispatch rules).

## Rules

- **The operator only.** The subject is the operator's own login and git identity, never
  another person. The counts are activity, not a measure of value, and the page ranks no
  one.
- **Data.** A number comes from the collector, or the page shows it as not recorded
  (`skills/html-report/SKILL.md`, The data rule).
- **Read-only.** The only writes are the report files under `<state-root>/reports/`, which is
  git-ignored, and at most one line in the local exclude file (step 4). No git or gh call
  reaches outside the realm; the collector skips each repository outside it and lists it as
  skipped.
- **Naming.** The page carries the project's words only, so it can be shared as-is.

## Hosts

Claude Code runs `/vistack:user-performance`, Codex `$vistack:user-performance`, and Grok
Build and OpenCode load it as `docs/guide/grok-opencode.md` describes. The script paths
resolve from the plugin root (router, Host adapter) while the working directory stays in the
consuming repository, where the realm and `repo` scope are read. GitHub numbers need an
authenticated `gh`; without it they show as not recorded.
