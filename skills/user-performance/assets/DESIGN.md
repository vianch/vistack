---
version: "alpha"
name: "Real-Time Monitoring"
description: "Real-time monitoring dashboard. Ideal for landing pages, modern websites. AI-ready template."
colors:
  primary: "#FF0000"
  secondary: "#FFA500"
  tertiary: "#22C55E"
typography:
  h1:
    fontFamily: System UI stack
    fontSize: 2.25rem
    fontWeight: 700
  body-md:
    fontFamily: System UI stack
    fontSize: 1rem
    fontWeight: 400
  label-caps:
    fontFamily: System UI stack
    fontSize: 0.75rem
    fontWeight: 500
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    padding: 12px
---

## Overview

Real-time monitoring dashboard. Ideal for landing pages, modern websites. AI-ready template. Real-time monitoring interfaces trace back to NASA's Mission Control in the 1960s — rows of engineers staring at phosphor screens, waiting for numbers to go wrong. The fundamental problem hasn't changed. What changed is scale. Where one flight director watched one spacecraft, a single SRE now watches thousands of containers. Datadog, Grafana, New Relic — they all inherited that same tension between awareness and overwhelm.

The psychology here is brutal. Live data creates a false sense of control. You're watching numbers tick, feeling productive, but you're really just anxious. Alert fatigue is the inevitable hangover: when everything screams, nothing does. The best monitoring dashboards learned this the hard way. They moved from "show everything always" to "surface what matters now." Status indicators replaced raw feeds. Thresholds replaced constant streams. The shift wasn't technical — it was philosophical.

Modern real-time UIs borrow from trading floors and air traffic control. Information density is high, but hierarchy is ruthless. Color means something specific. Animation is functional, never decorative. Every pixel earns its place or gets cut.

- Density: 8/10 — Dense
- Variance: 4/10 — Moderate
- Motion: 6/10 — Expressive

- **Style:** BI/Analytics
- **Keywords:** Live data updates, status indicators, alert notifications, streaming data visualization, active monitoring, streaming charts
- **Era:** 2020s Modern
- **Light/Dark:** ✓ Full / ✓ Full

## Colors

- **red** (#FF0000) — Error states, destructive actions
- **orange** (#FFA500) — Warm accent, call-to-action secondary
- **green** (#22C55E) — Supporting palette color


## Typography

- **Display / Hero:** System UI stack (-apple-system, sans-serif) — Weight 700, tight tracking, used for headline impact
- **Body:** System UI stack (-apple-system, sans-serif) — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** System UI stack (-apple-system, sans-serif) — 0.875rem, weight 500, slight letter-spacing
- **Monospace:** JetBrains Mono — Used for code, metadata, and technical values

Scale:
- Hero: clamp(2.5rem, 5vw, 4rem)
- H1: 2.25rem
- H2: 1.5rem
- Body: 1rem / 1.6
- Small: 0.875rem


## Layout

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.
- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).
- **Section vertical gaps:** clamp(4rem, 8vw, 8rem).
- **Hero layout:** Split-screen (text left, visual right).
- **Feature sections:** Zig-zag alternating text+image rows. No 3-equal-columns.
- **Mobile collapse:** All multi-column layouts collapse below 768px. No horizontal overflow.
- **z-index contract:** base (0) / sticky-nav (100) / overlay (200) / modal (300) / toast (500).


## Elevation & Depth

Real-time chart animations, alert pulse/glow, status indicator blink animation, smooth data stream updates, loading effect

- **Physics:** Spring — stiffness 120, damping 20. Confident, weighted transitions.
- **Entry animations:** Fade + translate-Y (16px → 0) over 480ms ease-out. Staggered cascades for lists: 100ms between items.
- **Hover states:** Scale(1.03) + shadow lift over 200ms.
- **Page transitions:** Fade + slide (300ms).
- **Performance:** Only transform and opacity animated. No layout-triggering properties.


## Shapes

Base corner radius: 8px. See rounded tokens in front matter for the full scale.


## Components

- **Primary Button:** Subtly rounded (0.5rem) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.
- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.
- **Cards:** Subtly rounded (0.5rem) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.
- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in semantic red. No floating labels.
- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active.
- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.
- **Empty States:** Icon-based composition with descriptive text and action button.


## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)
- No pure black (#000000) — use off-black or charcoal variants
- No oversaturated accent colors (saturation cap: 80%)
- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No broken external image links — use picsum.photos or inline SVG
- No generic lorem ipsum in demos

- Do Live updates working
- Do Alert sounds optional
- Do Connection status shown
- Do Auto-refresh indicated
- Do Critical alerts prominent
- Do Offline fallback


## Use Case

Landing pages, Modern websites
