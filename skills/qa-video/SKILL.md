---
name: qa-video
description: "Record a screen video, screen recording, walkthrough, or GIF of a QA scenario as evidence: Playwright records the browser session with one chapter per assertion step, then ffmpeg and ImageMagick turn it into an MP4 under the attachment budget, captions, a GIF preview, a screenshot slideshow, or a contact sheet. Use when a QA pass, a bug reproduction, or a PR needs video evidence beside its screenshots, on Claude Code, Codex, Grok Build, or OpenCode."
---

# qa-video

A screenshot proves the state at one moment. A video shows how the page got there: the
transition, the order of events, the flash of wrong content, the timing. This skill records
that video and ties every second of it to an assertion point.

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

`skills/qa-video/scripts/qa-video.mjs` is a dependency-free Node CLI with four commands:
`doctor`, `record`, `finish`, and `check`. Run it from the consuming repository so that
Playwright resolves from that project's `node_modules`; a lane that runs elsewhere, such as a
Codex QA lane under `-C <lane dir>`, passes `--playwright <absolute path>` instead. Run
`--help` on any command for its flags.

| Host | How to run it |
|---|---|
| Claude Code | `node "${CLAUDE_PLUGIN_ROOT}/skills/qa-video/scripts/qa-video.mjs" <command> ...` |
| Codex | the same command with the installed plugin path in place of `${CLAUDE_PLUGIN_ROOT}`, in a `codex exec -C <lane dir>` QA lane with absolute `--playwright` and credential paths (`skills/coordinate/SKILL.md`, QA lanes) |
| Grok Build | the same command with the installed plugin path; `.grok-plugin/plugin.json` loads this skill |
| OpenCode | the `vistack_qa_video` tool from `integrations/opencode/vistack.js`, with `command` and `args_json` |

The tools have separate jobs. Playwright records the browser, ffmpeg changes video over
time, and ImageMagick composes still images. Only the browser recording is guaranteed.
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
3. Record against the resolved target and the PR head:
   `record --scenario <dir>/<scenario>.mjs --out <dir> --url <target> --head <sha> --title-card`.
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
  storage state passes to the recorded context in memory. Nothing writes it to disk.
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

`skills/qa-video/references/ffmpeg-imagemagick.md` has commands for:

- probing and converting;
- fitting a size budget, trimming, and speeding up idle time;
- palette GIFs and slideshows from screenshots;
- side-by-side before and after, frame extraction, and burned-in labels;
- contact sheets, caption bars, and corrupt-frame cleanup.

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

Approach adapted from Playwright's video and screencast documentation, the dev.to write-up
"I was tired of re-recording product demos every sprint" (playwright-recast), and the ffmpeg
and ImageMagick notes credited in `skills/qa-video/references/ffmpeg-imagemagick.md`.
