# State file

`<state-root>/<slug>.json` is the run's resume point, keyed by slice, and the coordinator
updates it on every transition.

```json
{
  "slug": "21510-progressbar",
  "issue": "https://github.com/ORG/REPO/issues/123",
  "playbook": "autopilot-stack",
  "mode": "unattended",
  "objective": "Replace the two Loader call sites with ProgressBar",
  "request": "use one progressbar for both loader spots. done = 0/50/100 work, tests pass. keep loader looks",
  "request_enhanced": "Want: one ProgressBar used by both Loader call sites. Done means: it renders at 0%, 50%, 100%; suite green. Keep: Loader consumers' visual output.",
  "finish_condition": "ProgressBar renders at 0/50/100%; two call sites use it; suite green",
  "unchanged": "Existing Loader consumers keep their current visual output",
  "permissions": "Commit and push slice branches. Leave PRs as drafts. Do not merge.",
  "escape_hatch": "Stop with a blocker dossier after the bounded unblock loop",
  "base_branch": "main",
  "host": "claude-code",
  "coordinator_session_id": "session_011xyz",
  "monitor": {
    "interval": "self-paced",
    "mechanism": "/loop /vistack babysit <slug>",
    "owner": "session_011xyz",
    "status": "active",
    "last_pass_at": null,
    "last_progress_at": null
  },
  "slices": {
    "primitive": {
      "agent": "implementer",
      "model": "sonnet",
      "session_id": "session_011abc",
      "worktree": ".claude/worktrees/21510-progressbar-primitive",
      "branch": "user/issue-progressbar-primitive",
      "pr": null,
      "phase": "planned",
      "blockers": [],
      "retries": 0,
      "qa": {
        "agent": "qa-verifier",
        "session_id": "session_011ghi",
        "background": true,
        "head": "abc1234",
        "evidence_dir": ".claude/state/qa/21510-progressbar/primitive/abc1234/",
        "status": "running"
      }
    }
  }
}
```

The fields are additive to the existing schema, so pickup reads older runs, and an update
preserves every key it does not know.

## Slice fields

`phase` is one of `planned`, `dispatched`, `implementing`, `pr-open`, `qa`, `audit`,
`merge-ready`, `blocked`, or `paused`.

`blockers[]` holds one `{ "summary", "attempts", "last_evidence" }` object per open blocker.

`qa` is the slice's current QA lane. Its `status` is one of `waiting-preview`, `running`,
`waiting-otp`, `passed`, `failed`, or `superseded`. `waiting-otp` means the lane's login is
waiting on the one-time code the user receives, or timed out waiting and the lane awaits
re-dispatch once the user answers (`skills/qa-verify/SKILL.md`, OTP handshake). A run with
no slices, such as `qa-verification`, keys the lane by PR number under a run-level `qa`
object.

## Monitor fields

| Field | Meaning |
|---|---|
| `interval` | The wake cadence: `self-paced`, or the fixed interval such as `10m` when self-pacing is unavailable. |
| `mechanism` | What runs the monitor: the `/loop` command, the host's recurring task, or the `watch-pr.py` command on a host with no recurring monitor. |
| `owner` | The session id of the coordinator holding the monitor. Pickup reclaims it by writing its own. |
| `status` | `active` while the monitor runs, `stopped` after the terminal pass or a pause. A persisted `active` is a claim that Startup invariant in `skills/coordinate/SKILL.md` verifies. |
| `last_pass_at` | ISO-8601 UTC time of the last monitor pass, clean passes included. |
| `last_progress_at` | ISO-8601 UTC time of the last pass that saw a `progress` event (`docs/guide/ledger-format.md`), or `null` before the first. |
