---
name: qa-video
description: "Record a screen video, screen recording, walkthrough, or GIF of a QA scenario as evidence: Playwright records one chapter per assertion step, then ffmpeg and ImageMagick make the MP4, captions, GIF, slideshow, or contact sheet. Use when a QA pass, bug reproduction, or PR needs video beside its screenshots."
---

# qa-video

The screenshot at each assertion point stays the pass or fail gate
(`skills/qa-verify/SKILL.md`). A video never turns a fail into a pass and never stands in for
a missing screenshot. Every browser scenario attempts a video. When one cannot be produced,
the reason is written down. A missing video is never silent.

## When it runs

| Moment | What gets recorded |
|---|---|
| A QA pass on a PR's target | every browser scenario, one video each |
| A bug reproduction on a browser surface | the failing behavior before the fix, then the same scenario on the PR head |
| A design or interaction check | the transition between the states the screenshots capture |

API-only scenarios and unit tests get no video. When a non-browser control skill can record
(a simulator or device recorder), use it. Otherwise the results row says
`none: <reason>`.

## Tools and the script

`skills/qa-video/scripts/qa-video.mjs` is a dependency-free Node CLI with five commands:

| Command | Job |
|---|---|
| `doctor` | reports which recorder, encoders, and outputs work on this machine |
| `login` | runs only the scenario's `login`, takes its OTP through `otp.txt`, and saves the session to `auth.json` |
| `record` | records the scenario: a `.webm`, one PNG per step, and the manifest |
| `finish` | writes captions and the requested MP4, GIF, slideshow, or contact sheet |
| `check` | verifies a manifest against the files on disk |

Run it from the consuming repository so that
Playwright resolves from that project's `node_modules`; a lane that runs elsewhere, such as a
Codex QA lane under `-C <lane dir>`, passes `--playwright <absolute path>` instead. Run
`--help` on any command for its flags.

| Host | How to run it |
|---|---|
| Claude Code | `node "${CLAUDE_PLUGIN_ROOT}/skills/qa-video/scripts/qa-video.mjs" <command> ...` |
| Codex | the same command with the installed plugin path in place of `${CLAUDE_PLUGIN_ROOT}`, in a `codex exec -C <lane dir>` QA lane with absolute `--playwright` and credential paths (`skills/coordinate/SKILL.md`, QA lanes) |
| Grok Build | the same command with the installed plugin path; `.grok-plugin/plugin.json` loads this skill |
| OpenCode | the `vistack_qa_video` tool from `integrations/opencode/vistack.js`, with `command` and `args_json` |

Only the browser recording is guaranteed.
Playwright writes a `.webm` without any system tool. MP4, GIF, slideshow, and contact sheet
each need a tool that `doctor` must find first.

## Evidence directory

Everything lives under the run's state root, which is git-ignored (Host adapter in
`skills/vistack/SKILL.md`), in the QA lane's own directory:
`<state-root>/qa/<slug>/<slice-or-pr>/<head7>/`. One directory per PR head keeps parallel
lanes and re-runs on a newer head from touching each other's evidence; `record` refuses an
`--out` whose manifest for the same scenario names a different head. Per scenario:

| File | Made by | Notes |
|---|---|---|
| `<scenario>.mjs` | the verifier | the scenario module, copied from `skills/qa-video/assets/scenario.example.mjs` |
| `<scenario>.webm` | `record` | the guaranteed video |
| `<scenario>-<step>.png` | `record` | the assertion screenshot, captured at the end of each step |
| `<scenario>.manifest.json` | `record`, `finish` | steps with start and end seconds, results, outputs |
| `<scenario>.vtt`, `<scenario>.srt` | `finish` | one caption per step, always produced |
| `<scenario>.mp4` | `finish --mp4` | H.264, even dimensions, faststart, fitted to `--max-mb` |
| `<scenario>.gif` | `finish --gif` | short inline preview with a palette drawn from the whole clip |
| `<scenario>-slideshow.mp4` | `finish --slideshow` | the assertion screenshots, each held `--hold` seconds |
| `<scenario>-sheet.png` | `finish --sheet` | contact sheet of every assertion screenshot, labeled |
| `otp-request.json` | `login`, `record` | the latest OTP request with its target, hint, and `answeredAt` or `timedOutAt`; no secret inside |
| `auth.json` | `login` | the saved session, mode 0600, and a session credential; never attached, never posted, never copied outside the state root, and deleted by the coordinator at run exit |

## Login and OTP

Every login on the QA targets asks for a one-time password (OTP) after the password. The QA
lane runs in the background and cannot ask the user, so the code passes through two files in
the lane's `--out` directory:

- The script writes `otp-request.json` when the scenario's `login` calls `otp({ hint })`.
  It holds `{ "target", "hint", "requestedAt", "timeoutSeconds" }`, with `target` the origin
  of `--url`. The script prints one line to stderr,
  `OTP needed for <target>: write the code to <dir>/otp.txt (waiting up to <n> s)`.
- The asker, which can reach the user, writes only the code to `<dir>/otp.txt`. Trailing
  whitespace is ignored.
- The script polls every second, reads `otp.txt`, deletes it at once, adds `answeredAt` to the
  request, and returns the code to `login`.

When no code arrives within `--otp-timeout` seconds (default 300), the script adds
`timedOutAt` to the request, leaves no `otp.txt`, and exits 3. The exit codes are 0 ok,
1 evidence or step failure, 2 usage or setup error (a `login` that throws is one), and 3 no
OTP before `--otp-timeout`.

Run `login` once per run per target.
`login --scenario <dir>/<scenario>.mjs --out <dir> --url <target>` saves the session to
`<dir>/auth.json`, or to `--save-storage-state <path>`. Every `record` after it passes
`--storage-state <dir>/auth.json` and skips the scenario's `login`, so one code covers every
scenario. When that file is missing, `record` runs `login` itself, which asks for a new code,
and writes a warning to the manifest.

## Steps

1. Run `doctor` once per run, in the pilot QA lane, and keep its JSON; a lane whose brief
   names that JSON skips this step. When Playwright is present but its browser is not,
   install the browser with the project's own Playwright (`npx playwright install
   chromium`). When the Playwright package itself is missing, do not add a dependency from
   the QA lane. Record `none: playwright not installed` and continue with screenshots from
   the approved control skill.
2. Write one scenario module per scenario from `skills/qa-video/assets/scenario.example.mjs`.
   - Put the deployment-protection wall and the app login in `login`. It runs in a context
     that is not recorded.
   - Put the scenario in the default export, with one `step()` per assertion point. Give
     each step the same name as its results-table assertion point, so the screenshot is
     `<scenario>-<step>.png`.
   - A step ends when its check holds. End it with a wait on the asserted state, not with a
     fixed sleep.
3. Record against the resolved target and the PR head, after the once-per-run `login` from
   Login and OTP:
   `record --scenario <dir>/<scenario>.mjs --out <dir> --url <target> --head <sha> --title-card --storage-state <dir>/auth.json`.
   Without `--storage-state`, `record` runs the scenario's login and asks for a new code.
   Add `--actions` when the reviewer needs to see where each click landed. Exit 1 means a
   step failed. The video, screenshot, and manifest are still written, and the row is a fail.
4. Finish: `finish --manifest <dir>/<scenario>.manifest.json --mp4 --sheet`. Add `--gif` for
   a clip short enough to preview inline, and `--slideshow` when the screenshots tell the
   story better than the live recording. An output skipped for a missing tool stays
   `skipped`, and the `.webm` remains the evidence.
5. Run `check --manifest <dir>/<scenario>.manifest.json`. A row cites the video only after
   `check` returns `ok: true`.
6. Cite the video in its results row as `<file> @ <start>-<end>` from the manifest's step
   times. Attach the `.mp4` when it was produced, otherwise the `.webm`, following
   [GitHub attachments](../../docs/guide/github-attachments.md). The scenario's
   `qa-scenario` ledger row carries the video path, or `no video: <reason>`.

## Secrets

- Credentials are never typed on camera. Protection walls and logins go in `login`, whose
  storage state passes to the recorded context. `record` keeps it in memory. `login` writes it
  to `auth.json` with mode 0600, a session credential that is never attached, never posted,
  never copied outside the state root, and deleted by the coordinator at run exit.
- The OTP comes from `otp.txt`, never from a flag or an environment variable. It never
  appears in argv, captions, step names, screenshots, logs, the ledger, or a tracked file.
  Once read, the script adds it to the values it redacts, and the login context is still not
  recorded.
- Credentials never appear in argv, which ends up in shell history, process lists, and
  ledger evidence. The scenario module reads them from environment variables that the
  verifier sets from the approved credential file, inside the same shell call, without
  echoing them.
- `step(name, fn, { sensitive: true })` hides the action callouts for that step. The page
  itself is still recorded. A video that shows a secret value is a secret-bearing artifact.
  It is a fail, and it is never attached.
- The script redacts the values of environment variables whose names look like
  credentials from errors and stdout. That is a backstop. It does not make a recording safe
  to publish.

## Upload budget

`--max-mb` defaults to 10. `finish` re-encodes an over-budget MP4 once at a bitrate computed
from the duration, then marks it `over-budget`. Split a long scenario into shorter ones
instead of attaching a file the forge may reject. Raise the budget only when the
repository's forge is known to accept larger files. The assumption that GitHub attachments
accept `.mp4` and `.webm` has not been verified from this plugin. When an upload is
rejected, attach the slideshow or the contact sheet and record the rejection.

## Other recording surfaces

- **Playwright MCP.** When the project's MCP server runs with `--caps=devtools`, it offers
  `browser_start_video`, `browser_video_chapter`, and `browser_stop_video`. Use them when the
  session drives the browser only through MCP. Add one chapter per assertion point and take
  each assertion screenshot with the MCP screenshot tool. That recording has no manifest,
  so cite the file without timestamps and edit it with the reference commands.
- **The repository's own Playwright Test suite.** When its config already records video
  (`use: { video: "on" }`), cite the `.webm` it writes under `test-results/`. Do not edit
  the project's config from the QA lane.

## Editing by hand

Hand edits (convert, fit a size budget, trim, GIF, slideshow, side-by-side, labels, contact
sheet): `skills/qa-video/references/ffmpeg-imagemagick.md`.

Write edited output next to the original. Never overwrite the recorded evidence.

## Gotchas

- The frame-capture sample this skill was built from waited `Math.round(1/30)` seconds
  between screenshots, which is `0`. Its loop count was `DURATION / 0`, which is
  `Infinity`. It also held every frame in memory before writing any, and it passed
  `encoding` and `format`, which are not Playwright screenshot options (Playwright uses
  `type`). Screenshot latency caps a loop like that near a few frames per second anyway.
  Record with `page.screencast` or `recordVideo` instead.
- Playwright's bundled ffmpeg (`ms-playwright/ffmpeg-*`) is VP8-only on the machine that
  built this skill. It has no libx264, no GIF encoder, no PNG decoder, and no concat
  demuxer. It cannot make MP4 or GIF, so `doctor` ignores it.
- A VP8 `.webm` cannot be stream-copied into an `.mp4`, and `-c copy` fails. Re-encode to
  H.264, which is what `finish --mp4` does.
- `recordVideo` starts at page creation, and the recorder shows about a second of blank
  frames before the first paint. The first step's `start` in the manifest marks where the
  content begins. Trim there when the blank lead matters.
- A GIF palette built from one frame gave every later frame the first frame's colors. In a
  recorded case, a black-and-white cover turned the whole clip black and white. `finish
  --gif` builds the palette from the whole clip. For screenshots that differ a lot, the
  reference uses one palette per frame.
