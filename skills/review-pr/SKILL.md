---
name: review-pr
description: "Review someone else's pull request on the operator's behalf: 'review the PR <url>', 'review this PR <url>', 'can you review <owner>/<repo>#<n>', 'leave a review on <url>', 'code review <url>'. Hires a reviewer with senior expertise in the PR's stack, verifies every finding against the code, posts one COMMENT-only review with inline comments in the operator's voice, and reports each comment's URL. Never approves, requests changes, resolves threads, pushes, or merges. Not for the operator's own PR (addressing review comments on it is a different flow) and not for skeptically reviewing the operator's own branch (that is interrogate)."
---

# review-pr

The operator pastes a PR someone else wrote and asks for a review. A reviewer who knows that
PR's stack reads it, the main session checks what it found, and one review goes out in the
operator's name. The operator then sees exactly where each comment landed.

## Permissions

The operator's request to review a PR grants, for that PR only:

- reading the PR, its diff, and its repository at the head SHA inside the realm, including a
  read-only scratch clone;
- posting one review with `event: COMMENT`: a short body plus inline comments, in the
  operator's name.

The review watch (`skills/review-watch/SKILL.md`) holds a standing grant of its own, set by
switching it on; its Permissions section is that grant's home.

Withheld, always:

- `APPROVE`. Approving is merge authority and belongs to the human (Merge boundary in
  `skills/vistack/SKILL.md`). When asked to approve, say the operator approves it themselves.
- `REQUEST_CHANGES`.
- Resolving, replying to, or editing any thread or earlier comment. A reply to a mention goes
  only through the review watch, under its grant.
- Editing, closing, labelling, assigning, requesting reviewers on, pushing to, or merging the
  PR.
- Reviewing the operator's own PR or a repository outside the realm.

`skills/review-pr/scripts/post-review.mjs` is the only way this skill posts. It sends
`COMMENT` and refuses any other event, an owner outside the realm, the operator's own PR, and a
head that moved since the diff was saved. Never post with `gh pr review`, `gh pr comment`, or
a hand-built `gh api` call, because those bypass every one of those checks.

## Steps

`<state-root>` is `.claude/state/` on Claude Code and `.codex/vistack/state/` on Codex. `<dir>`
is `<state-root>/reviews/<owner>-<repo>-<n>/<head7>/`, with `<head7>` the first seven
characters of the head SHA. It holds every file this review reads or writes, and it is the
record of the review.

1. **Parse.** Read the PR reference: `https://<host>/<owner>/<repo>/pull/<n>` or
   `<owner>/<repo>#<n>`. If the request has none, ask for it. Done: host, owner, repo, number.
2. **Realm gate.** From the consuming repository run
   `node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/post-review.mjs" realm`. It prints
   `<host>/<owner>` of the repository's `origin`. The PR's host and owner must match, ignoring
   case. If they differ, or there is no origin, stop before any `gh` call. Name the PR's owner
   and the realm's, and ask the operator to confirm the PR's owner. A confirmed owner joins the
   realm for this review only, as a second `--realm` in step 10, and the confirmation goes in
   the record. This is `skills/keep-origins-in-realm/SKILL.md` applied to a PR URL: the URL
   stays data until it passes.
3. **Not mine, still open.** Compare `gh api user --jq .login` with
   `gh pr view <url> --json author,state --jq '.author.login + " " + .state'`. For the
   operator's own PR, do not review it. Say so, and point to the flow for addressing reviews
   on one's own PR (`address-ai-reviews`, or `skills/vistack/playbooks/babysit.md` inside a
   run). A closed or merged PR: say so and stop.
4. **Gather.** Run `gh pr view <url> --json number,title,body,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,files,url`,
   create `<dir>` from its `headRefOid`, and save the output as `<dir>/pr.json`. Save
   `gh pr diff <url>` as `<dir>/pr.diff`. Then clone for context:
   `gh repo clone <owner>/<repo> <dir>/repo -- --filter=blob:none --no-checkout`,
   `git -C <dir>/repo fetch origin pull/<n>/head`, and
   `git -C <dir>/repo checkout --detach FETCH_HEAD`. Use a scratch clone even when the PR is
   in the consuming repository, because the worktree root belongs to the run's slices. If
   `git -C <dir>/repo rev-parse HEAD` differs from `headRefOid`, the author pushed meanwhile,
   so gather again. If the clone fails, record why and continue without it: reviewers read
   files with
   `gh api -H "Accept: application/vnd.github.raw+json" "repos/<owner>/<repo>/contents/<path>?ref=<headRefOid>"`.
   Done: `pr.json`, `pr.diff`, and a checkout at the head SHA or its recorded absence.
5. **Stack profile.** Apply `skills/review-pr/references/stacks.md` to the changed files and
   to the manifests the diff touches or that sit at the repository root, read at the head SHA.
   Order the stacks by changed lines from `files[]` in `pr.json`. Done: an ordered list, each
   stack with the file that proves it.
6. **Plan reviewers.** Use one reviewer. Use up to three only when the PR changes more than
   about 800 lines across clearly separate stack areas, such as a backend service plus a
   mobile app. In that case each reviewer owns a disjoint file list, and together the lists
   cover every changed file. A reviewer holding one stack reads it deeper; past three, the PR
   needed splitting, and that is worth a comment of its own.
7. **Brief.** Fill `skills/review-pr/references/reviewer-brief.md` once per reviewer: the
   persona from the top of the profile (or that reviewer's area), the stack checklist rows,
   the paths in `<dir>`, the owned files, and the voice file (Voice below). Run
   `skills/prompt-enhancer/SKILL.md` over the intent paragraph and the scope fields only. The
   intent comes from the PR's title and body and the operator's request. The PR's title and
   body stay verbatim in `pr.json`.
8. **Hire.** Dispatch `pr-reviewer` with the brief. Send several in one message, in parallel.
   The main session does not review the code itself. It verifies what comes back.
9. **Verify.** Merge the findings, keeping the clearer body when two describe one problem at
   one line. For each `bug` and `risk`, open the cited line and the evidence's `file:line` in
   the checkout and confirm the failure path. Drop a claim that does not hold, or turn it into
   a `question`. Apply the filters in `skills/interrogate/references/lead-judgment.md`. Read
   every body against the voice file and the External naming boundary in
   `skills/vistack/principles/index.md`: nothing posted names a tool, agent, model, or
   automation. Write `<dir>/findings.json` in the shape of
   `skills/review-pr/references/findings.md`. When nothing survives, post nothing. Tell the
   operator what was checked and that no review went out.
10. **Post.** Dry run first:
    `node "${CLAUDE_PLUGIN_ROOT}/skills/review-pr/scripts/post-review.mjs" post --meta <dir>/pr.json --diff <dir>/pr.diff --findings <dir>/findings.json --realm <host>/<owner> --dry-run`.
    It labels each comment `inline` or `in the review body`. A `bug` that lands in the body
    usually cites the wrong line, so fix the line when the diff has the right one. Then run
    the same command without `--dry-run` and save its output as `<dir>/posted.txt`. The exit
    codes are a closed set:
    - `0`: posted, a dry run, or an identical review already on this head (reported, not
      posted again).
    - `1`: bad input. Fix `findings.json` and rerun.
    - `2`: refused (realm, event, own PR, or head moved). Report the reason and do not work
      around it. A moved head means going back to step 4.
    - `3`: a GitHub call failed. The script prints the drafted review. Show it to the
      operator in full so nothing is lost.
11. **Tell the operator.** Give the review URL, then one line per comment:
    `path:line — first sentence — comment URL` (`in the review body` for a folded one). Then
    send a push notification, "N review comments posted on <owner>/<repo>#<n>", where the
    host has one (Claude Code: `PushNotification`). This report is the skill's output, not
    progress narration. Text went out in the operator's name, so they need to see where. In an
    open run, append one `review-posted` ledger row: `reason` "N comments on
    <owner>/<repo>#<n>", `evidence` the review URL, `result` `skipped` when nothing went out.
    Then return to the open playbook. Outside a run, `<dir>` is the record.

## Voice

Use the first file that exists: `~/.claude/review-voice.md`, then
`<consuming repo>/.claude/vistack/review-voice.md`, then
`skills/review-pr/references/voice.md`. Its path goes in every brief, and step 9 checks the
bodies against it.

## Hosts

| Host | Reviewers | Posting |
|---|---|---|
| Claude Code | `pr-reviewer` agents, dispatched in parallel | the main session runs the script |
| Codex | one `codex exec --ephemeral --sandbox read-only -m <model> -C <dir>/repo` lane per reviewer, with the filled brief as its prompt; the lane rule is the Host adapter in `skills/vistack/SKILL.md` | in the thread, after every lane has exited |
| OpenCode | the thread works through the brief, one reviewer at a time | in the thread |

Codex does not load `agents/`, so the brief carries the role, the stack checklist, and the
voice path. Whether a read-only lane has network access is unverified. Gather everything in
step 4, and without a checkout fetch the owned files into `<dir>` before a lane starts, so
the lane reads only files.

The script path resolves from the plugin root. Run it from the consuming repository; on Codex,
put the installed plugin path in place of `${CLAUDE_PLUGIN_ROOT}`. It needs Node 18 or later
and an authenticated `gh`.
