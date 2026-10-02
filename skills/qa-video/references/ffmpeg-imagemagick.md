# ffmpeg and ImageMagick for QA evidence

Commands for edits that `qa-video.mjs finish` does not do. Each one writes a new file next
to its input. Run `qa-video.mjs doctor` first: it lists which encoders, filters, and
ImageMagick binaries this machine has.

Two rules apply to every command:

- Pass arguments as a list (`execFile`, `spawn`, or a quoted shell line). Never build a shell
  string from a step caption, a file name, or a URL.
- ImageMagick 7 is `magick`, and ImageMagick 6 is `montage`, `mogrify`, and `identify`. Do
  not call `convert`. It is deprecated in 7, and on Windows it is a disk tool.

## Inspect

```bash
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of json in.webm
ffmpeg -hide_banner -encoders | grep -E 'libx264|gif'
ffmpeg -hide_banner -filters  | grep -E 'palettegen|drawtext|subtitles|hstack'
```

## Convert a recording to MP4

```bash
ffmpeg -y -i in.webm -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart -an out.mp4
```

- `yuv420p` is what browsers and forge players decode.
- H.264 in 4:2:0 needs even width and height, so the scale rounds both down.
- `+faststart` moves the index to the front, so the clip plays before it finishes
  downloading.
- VP8 cannot be stream-copied into MP4. `-c copy` here fails, so re-encode.

## Fit a size budget

Bitrate in kbit/s = budget bytes × 8 × 0.92 ÷ duration seconds ÷ 1000. The 0.92 leaves
room for the container. For 10 MB and 40 s:

```bash
ffmpeg -y -i in.webm -c:v libx264 -b:v 1929k -maxrate 1929k -bufsize 3858k \
  -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart -an out.mp4
```

Still too big? Halve the frame size with `scale=iw/2:-2`, or split the scenario.

## Trim

```bash
ffmpeg -y -i in.mp4 -ss 00:00:04 -to 00:00:09 -c:v libx264 -crf 23 -pix_fmt yuv420p -an cut.mp4
ffmpeg -y -ss 00:00:04 -i in.mp4 -t 5 -c copy cut-fast.mp4
```

- `-ss` after `-i` cuts on the exact frame and re-encodes.
- `-ss` before `-i` with `-c copy` is instant, but it cuts on the nearest keyframe, so the
  clip can start early.
- `-to` is an end time and `-t` is a duration.
- Use the manifest's step `start` and `end` to cut one assertion point out of a long
  scenario. Captions from the uncut manifest do not match a trimmed clip.

## Speed up idle time

```bash
ffmpeg -y -i in.mp4 -an -filter:v "setpts=0.5*PTS" fast.mp4
```

`0.5` plays at twice the speed. It changes the timestamps, so recompute any `@ start-end`
reference against the new file. Never speed up the seconds around a timing assertion.

## GIF preview

One palette for the whole clip (what `finish --gif` does):

```bash
ffmpeg -y -i in.webm -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 out.gif
```

One palette per frame, for screenshots that share no colors:

```bash
ffmpeg -y -framerate 1/2 -i shot-%02d.png \
  -filter_complex "[0:v]split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1" -loop 0 steps.gif
```

A palette generated from the first frame alone tints every later frame. In the notes this
reference adapts, a black-and-white cover turned a colored catalog black and white.

From ImageMagick, with a 1.5 s delay per frame:

```bash
magick -delay 150 -loop 0 step-*.png -resize 800x steps.gif
```

## Slideshow from screenshots

The concat demuxer holds each image for its own duration. Repeat the last file without a
duration, because the demuxer ignores the final `duration` line.

```text
file '/abs/checkout-cart-empty.png'
duration 2
file '/abs/checkout-item-added.png'
duration 2
file '/abs/checkout-item-added.png'
```

```bash
ffmpeg -y -f concat -safe 0 -i list.txt \
  -vf "fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libx264 -movflags +faststart slideshow.mp4
```

For images with sequential names, `-framerate 1/2 -i shot-%02d.png` works without a list.
`-pattern_type glob -i '*.png'` is not available on Windows builds.

## Before and after, side by side

```bash
ffmpeg -y -i before.mp4 -i after.mp4 \
  -filter_complex "[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=inputs=2" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an before-after.mp4
```

`hstack` needs equal heights, so both inputs are scaled to 720 first. Use `vstack` for phone
widths. This is the bug-fix pair: the reproduction on the base, and the same scenario on the
PR head.

## Join clips

```text
file 'login-done.mp4'
file 'checkout.mp4'
```

```bash
ffmpeg -y -f concat -safe 0 -i clips.txt -c copy joined.mp4
```

`-c copy` works only when every clip has the same codec, size, and frame rate. Otherwise
convert each one with the MP4 command first.

## Pull frames out

```bash
ffmpeg -y -ss 3.2 -i in.webm -frames:v 1 at-3.2s.png
ffmpeg -y -i in.webm -vf "fps=2,scale=-1:540" frames/f_%03d.png
```

The first command grabs the frame at one assertion point to look at it. The second samples
the clip to review it without playing it.

## Burn labels into the video

`record --title-card` and `--actions` draw a title card and click callouts while recording.
To show the step name on every frame, burn in the captions that `finish` wrote:

```bash
ffmpeg -y -i in.mp4 -vf "subtitles=in.srt:force_style='Fontsize=22,Outline=2'" -c:v libx264 -pix_fmt yuv420p -an labeled.mp4
```

`subtitles` needs ffmpeg built with libass, and `drawtext` needs libfreetype. Check
`ffmpeg -filters` first. Without either filter, attach the `.vtt` beside the video.

## Still images

Contact sheet, labeled, three per row (what `finish --sheet` does):

```bash
magick montage -label '1. cart-empty (PASS)' cart-empty.png -label '2. item-added (PASS)' item-added.png \
  -tile 3x -geometry 480x270+12+12 -background '#1f2328' -fill '#ffffff' -pointsize 18 sheet.png
```

- `-label` applies to the images that follow it.
- `%` in label text is a format escape, so write `%%`.
- A label that starts with `@` reads a file. Never pass a raw caption that starts with `@`.

Caption bar on one screenshot:

```bash
magick in.png -gravity north -background '#1f2328' -splice 0x44 \
  -fill '#ffffff' -pointsize 22 -annotate +0+10 'item-added: PASS' in-captioned.png
```

Fit to 16:9 without cropping:

```bash
magick in.png -resize 1920x1080 -background white -gravity center -extent 1920x1080 in-169.png
```

`-resize 1920x1080^` fills the frame and lets `-extent` crop the overflow. Without `^`, the
image fits inside and `-extent` pads. `-crop 1280x720+0+0 +repage` cuts a region and resets
the canvas.

Batch convert into another directory (never in place on evidence):

```bash
mogrify -path out/ -format jpg -quality 90 shots/*.png
```

Find and set aside corrupt frames before encoding. A truncated JPEG ("EOI missing") flickers
or stops the encoder:

```bash
for f in frames/*.jpg; do magick identify -regard-warnings "$f" >/dev/null 2>&1 || mv "$f" frames/bad/; done
```

`-verbose` makes `identify` decode the whole file. It finds more damage and is much slower.

## Sources

Adapted, not copied, from:

- Playwright's video and screencast documentation (playwright.dev/docs/videos,
  playwright.dev/docs/api/class-screencast);
- the dev.to write-up "I was tired of re-recording product demos every sprint"
  (playwright-recast) on stream copy, blank lead frames, and idle speed-up;
- the ffmpeg and ImageMagick notes shared with the originating request, including the
  timelapse and corrupt-JPEG notes credited there to Jose Luis García del Castillo y López;
- zarino.co.uk "ImageMagick and FFmpeg", bit-101.com "Animation cookbook for ffmpeg and
  ImageMagick", jacklail.com "Create video slideshows with ImageMagick and FFmpeg", and
  Stack Overflow question 49113826.
