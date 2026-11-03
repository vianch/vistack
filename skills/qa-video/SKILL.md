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
`no video: <reason>`. That token means the `.webm` itself is missing, empty, or failed. A
skipped MP4 or GIF never earns it.

## Tools and the script

`skills/qa-video/scripts/qa-video.mjs` is a dependency-free Node CLI with five commands:

| Command | Job |
|---|---|
| `doctor` | reports which recorder, encoders, and outputs work on this machine |
| `login` | runs only the scenario's `login`, takes its OTP through `otp.txt`, and saves the session to `auth.json` |
| `record` | records the scenario: a `.webm`, one PNG per step, and the manifest |
| `finish` | writes captions and the requested MP4, GIF, slideshow, or contact sheet |
| `check` | verifies a manifest against the files on disk |

Every QA lane passes `--playwright <absolute path>` to `doctor`, `login`, and `record`,
naming the consuming repository's `node_modules/playwright` or
`node_modules/@playwright/test`. The lane runs from its evidence directory, and a monorepo
can hoist a second Playwright whose browsers are not installed. Without the flag the script
looks in this order and stops at the first hit:

1. `QA_VIDEO_PLAYWRIGHT`. An explicit path that does not resolve is final, like
   `--playwright`.
2. The declared package (`project-root`). The nearest `package.json` at or above the
   working directory that declares `playwright`, `@playwright/test`, or `playwright-core`
   names the package, and it is looked up in each `node_modules` from that directory up. A
   nearer copy that no `package.json` declares, such as a transitive or hoisted one, is
   skipped and listed as `skipped` in `candidatesTried`. A declared package that is not
   installed stops the search with that reason. Install the project's dependencies.
3. Only when nothing declares Playwright: each `node_modules` from the working directory up,
   nearest first (`cwd`, or `repo-root` for the directory that holds `.claude` or
   `.codex`), then `NODE_PATH`, then the global module directories
   (`QA_VIDEO_GLOBAL_MODULES` replaces that list).

ffmpeg, ffprobe, and ImageMagick come from `PATH`, then `/opt/homebrew/bin`,
`/usr/local/bin`, and `/opt/local/bin` (`QA_VIDEO_TOOL_DIRS` replaces that list). Run
`--help` on any command for its flags.

| Host | How to run it |
|---|---|
| Claude Code | `node "${CLAUDE_PLUGIN_ROOT}/skills/qa-video/scripts/qa-video.mjs" <command> ...` |
| Codex | the same command with the installed plugin path in place of `${CLAUDE_PLUGIN_ROOT}`, in a `codex exec -C <lane dir>` QA lane with absolute `--playwright` and credential paths (`skills/coordinate/SKILL.md`, QA lanes) |
| Grok Build | the same command with the installed plugin path; `.grok-plugin/plugin.json` loads this skill |
| OpenCode | the `vistack_qa_video` tool from `integrations/opencode/vistack.js`, with `command` and `args_json` |

Only the browser recording is guaranteed.
Playwright writes a `.webm` without any system tool, using the `ffmpeg-<rev>` build in its
browsers cache. MP4, GIF, slideshow, and contact sheet each need a tool that `doctor` must
find first.

## Doctor

`doctor` exits 0 only when it recorded a real one-second `recordVideo` clip of
`about:blank`. Read its JSON in this order:

| Key | What it says |
|---|---|
| `ok`, `outputs.webm` | the recorder works on this machine; `record` will write a `.webm` |
| `recorder` | `{ ok, reason }`: the probe's own failure text, such as `Executable doesn't exist at …/ffmpeg-1011/…` |
| `playwright` | `path`, `version`, `source`, and `resolvedFrom` (`flag`, `env`, `cwd`, `repo-root`, `project-root`, `node-path`, `global`); `candidatesTried` lists every location with its outcome |
| `browsers` | `cache` and `cacheFrom`; `<browser>` and `ffmpeg` each give the `expected` revision from the loaded Playwright's `browsers.json`, whether it is `present`, and the `missing` directories |
| `encoders` | `mp4`, `gif`, `slideshow`, `sheet`, and `reasons`, which say not found, failed (with the exit code and first stderr line), or lacks a named encoder or filter |
| `ffmpeg`, `ffprobe`, `imagemagick` | the tools found, and `ffmpeg.error` from the probe |
| `hints` | one fix per problem: the Playwright to point at, or the exact `node <playwright>/cli.js install <browser>` |

A `browsers.<browser>.missing` entry means the Playwright that loaded is not the one whose
browsers are installed. Pass `--playwright` for the project's own package, or run the hinted
install with it.

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
`login --scenario <dir>/<scenario>.mjs --out <dir> --url <target> --playwright <path>` saves the session to
`<dir>/auth.json`, or to `--save-storage-state <path>`. Every `record` after it passes
`--storage-state <dir>/auth.json` and skips the scenario's `login`, so one code covers every
scenario. When that file is missing, `record` runs `login` itself, which asks for a new code,
and writes a warning to the manifest.

## Steps

1. Run `doctor --playwright <path>` once per run, from the pilot QA lane's evidence
   directory, and keep its JSON; a lane whose brief names that JSON skips this step. When
   `browsers.<browser>.missing` or `recorder.reason` names a missing build, run the install
   command from `hints`, which uses that same Playwright, then run `doctor` again. When the
   Playwright package itself is missing, do not add a dependency from the QA lane. Record
   `no video: playwright not installed` and continue with screenshots from the approved
   control skill.
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
   `record --scenario <dir>/<scenario>.mjs --out <dir> --url <target> --head <sha> --title-card --storage-state <dir>/auth.json --playwright <path>`.
   Without `--storage-state`, `record` runs the scenario's login and asks for a new code.
   Add `--actions` when the reviewer needs to see where each click landed. Exit 1 means a
   step failed. The video, screenshot, and manifest are still written, and the row is a fail.
4. Finish: `finish --manifest <dir>/<scenario>.manifest.json --mp4 --gif --sheet`. Add
   `--slideshow` when the screenshots tell the story better than the live recording. Each
   output in the manifest reads `produced`, `over-budget`, `skipped`, or `failed`, and every
   status but `produced` carries a `reason`. A skipped MP4 leaves the `.webm` as the
   evidence. `finish` also checks the `.webm` against `--max-mb`.
5. Run `check --manifest <dir>/<scenario>.manifest.json`. A row cites the video only after
   `check` returns `ok: true`. `check` reports each output again with its status and reason,
   as verified on disk.
6. Attach the file named by `attach.path` in the `finish` or `check` JSON: the `.mp4`, else
   the `.webm`, else the `.gif`, whichever is the first produced within budget. Cite it in
   the results row as `<file> @ <start>-<end>` from the manifest's step times, following
   [GitHub attachments](../../docs/guide/github-attachments.md). When `attach.path` is null
   and `attach.reason` does not start with `no video:`, every video is over budget. Cite the
   `.webm` without attaching it, and re-record shorter. The scenario's `qa-scenario` ledger
   row carries the video path, or `attach.reason` when it starts with `no video:`.

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

GitHub attaches `.mp4`, `.mov`, and `.webm` videos up to 10 MB on free plans and 100 MB on
paid plans, and a `.gif` up to 10 MB. `--max-mb` defaults to 10, the limit every plan
accepts. `finish` re-encodes an over-budget MP4 once at a bitrate computed from the duration,
then marks it `over-budget`. A `.webm` over the budget is marked `over-budget` with the
fix: re-record a shorter scenario, or attach the GIF. Split a long scenario instead of
attaching a file the forge may reject. Raise the budget only when the repository is on a
paid plan. When an upload is still rejected, attach the slideshow or the contact sheet and
record the rejection.

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
- Playwright's bundled ffmpeg (`ms-playwright/ffmpeg-<rev>`) is VP8-only on the machine
  that built this skill. It has no libx264, no GIF encoder, no PNG decoder, and no concat
  demuxer. The recorder needs it, so `doctor` reports the revision the loaded Playwright
  expects under `browsers.ffmpeg`, but `finish` never uses it.
- QA runs reported "video encoder unavailable", a phrase no script prints, and wrote no
  video even where a `.webm` existed. One cause reproduces: a monorepo held Playwright
  1.56.1, which expects `chromium-1194`, beside 1.62.1, whose `chromium-1234` was the build
  installed. The wrong one loaded and the browser never launched. `doctor` names that gap in
  `browsers.chromium.missing`. A non-empty `.webm` is always the evidence.
- A VP8 `.webm` cannot be stream-copied into an `.mp4`, and `-c copy` fails. Re-encode to
  H.264, which is what `finish --mp4` does.
- `recordVideo` starts at page creation, and the recorder shows about a second of blank
  frames before the first paint. The first step's `start` in the manifest marks where the
  content begins. Trim there when the blank lead matters.
- A GIF palette built from one frame gave every later frame the first frame's colors. In a
  recorded case, a black-and-white cover turned the whole clip black and white. `finish
  --gif` builds the palette from the whole clip. For screenshots that differ a lot, the
  reference uses one palette per frame.
