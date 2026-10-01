# Design tokens

The token system every page shares. The values live once, in the `:root` blocks at the top of
`skills/html-report/assets/base.html`; this file says what each name means and how to map a
project's own tokens onto it. Component rules read only these names, so a page changes look
by changing values, never selectors.

## Color

Semantic names only. A component asks for a role, never a hue.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | page ground; `body` sets it explicitly | `#f5f7f6` | `#111614` |
| `--surface` | cards, tiles, inputs | `#fff` | `#18201d` |
| `--surface-2` | board columns, code, TL;DR, table heads | `#e9eeeb` | `#222b28` |
| `--fg` | body text | `#17201d` | `#e3eae6` |
| `--fg-muted` | labels, captions, evidence lines | `#55615c` | `#9ba9a2` |
| `--line` | borders and rules | `#d2dad6` | `#303b37` |
| `--accent` | links, focus ring, selected chip, primary button, highlighted path | `#2747c7` | `#93a9ff` |
| `--accent-fg` | text on `--accent` | `#fff` | `#0d1430` |
| `--ok` | passed, merged, done | `#176a3c` | `#5cc68a` |
| `--warn` | needs attention, skipped, paused | `#874e00` | `#e3a646` |
| `--bad` | failed, blocked, escalated | `#a8231c` | `#f2817a` |
| `--info` | in progress | `#0a6379` | `#5cc3da` |
| `--neutral` | planned, not recorded, plain tags | `#545e5a` | `#a5afaa` |

The neutrals lean slightly green so the grey reads as chosen; the single accent is an ink
blue used sparingly. Every text color above, and every status color on its own 14% tint,
measures at least 4.5:1 against `--bg`, `--surface`, and `--surface-2` in both themes.

Do not swap in cream with terracotta, near-black with an acid green, or a purple-to-blue
gradient. Those are the defaults generated pages fall into, and the cream look belongs to
the example pages this skill adapted.

### Tints

Derive every tinted background from its token:
`color-mix(in srgb, var(--ok) 14%, transparent)` behind a pill,
`color-mix(in srgb, var(--bad) 9%, var(--surface))` behind a callout. A literal tint such
as `#fdecea` is correct in one theme only.

### Status is not the accent

`--ok`, `--warn`, `--bad`, `--info`, and `--neutral` mean state; `--accent` means "this is
interactive or selected". A status never borrows the accent, and the accent never signals
a status.

Color is never the only signal. Every status pill carries its word, and a shape in its
`::before`: ok a circle, warn a triangle, bad a square, info a diamond, neutral a ring.
Timeline dots repeat the status of a row whose pill already says it in words.

## Themes

Three blocks, in this order, so the page follows the viewer's system setting and an explicit
`data-theme` toggle in either direction:

```css
:root { /* every token, light values */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark values */ color-scheme: dark } }
:root[data-theme="dark"] { /* the same dark values */ color-scheme: dark }
```

Every token is first defined on bare `:root`. The dark blocks only redefine. No component
rule uses a literal color, and SVG shapes and text take their color from classes
(`fill: currentColor`, `fill: var(--accent)`), never from a `fill="#..."` attribute.

## Type

| Token | Value |
|---|---|
| `--font-sans` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `--font-mono` | `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` |
| `--font-display` | optional; defaults to `var(--font-sans)` and sets headings and tile values |

System stacks only, so no font file loads and the page renders the same offline.

| Step | Size | Use |
|---|---|---|
| `--fs-1` | 0.75rem | labels, pills, table heads |
| `--fs-2` | 0.8125rem | captions, evidence, meta lines |
| `--fs-3` | 0.9375rem | body |
| `--fs-4` | 1.0625rem | lede, TL;DR |
| `--fs-5` | 1.3125rem | section headings |
| `--fs-6` | 1.75rem | page title |
| `--fs-7` | 2.25rem | stat tile values |

Digits that line up (tables, tiles, times) use `font-variant-numeric: tabular-nums`. Running
text stays near 65 characters wide. Headings use `text-wrap: balance`.

## Spacing, radius, shadow, motion

| Token | Value |
|---|---|
| `--sp-1` to `--sp-8` | 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4 rem (4, 8, 12, 16, 24, 32, 48, 64 px) |
| `--r-1`, `--r-2`, `--r-3`, `--r-pill` | 4 px, 8 px, 12 px, 999 px |
| `--shadow` | the one elevation, for the rare element that floats |
| `--dur-1`, `--dur-2`, `--ease` | 120 ms, 220 ms, `cubic-bezier(.2, .7, .2, 1)` |

Siblings are spaced with `gap` on a flex or grid parent, not per-element margins. The page
wrapper sets the side gutter once, with `padding-inline` of at least `--sp-4`.
`prefers-reduced-motion: reduce` sets both durations to `0ms`, so every transition built on
them stops.

## Mapping a project's tokens

When the consuming project has its own tokens, copy their values into the `:root` blocks
under these names. Keep the names; a status the project does not define keeps its default.

| Project source | Maps onto |
|---|---|
| shadcn/ui CSS variables: `--background`, `--card`, `--muted`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--primary-foreground`, `--destructive` | `--bg`, `--surface`, `--surface-2`, `--fg`, `--fg-muted`, `--line`, `--accent`, `--accent-fg`, `--bad` |
| Tailwind `theme.colors` or `theme.extend.colors`: `background`, `foreground`, `primary`, `success`, `warning`, `danger` or `error`, `info` | `--bg`, `--fg`, `--accent`, `--ok`, `--warn`, `--bad`, `--info` |
| Material 3: `--md-sys-color-surface`, `-surface-container`, `-on-surface`, `-on-surface-variant`, `-outline-variant`, `-primary`, `-on-primary`, `-error` | `--bg`, `--surface`, `--fg`, `--fg-muted`, `--line`, `--accent`, `--accent-fg`, `--bad` |
| A tokens JSON or Style Dictionary build: `color.background.*`, `color.text.*`, `color.border.*`, `color.feedback.*` | the row whose role matches |
| The project's font families | `--font-sans`, `--font-mono`, `--font-display`, keeping a system stack as the fallback |

After mapping, check the dark values exist (a project with one theme gets the defaults for
the other), and recheck status text on its 14% tint for 4.5:1.
