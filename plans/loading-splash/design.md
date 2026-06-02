# Instant inline loading splash

Date: 2026-06-03

## Problem

On a slow network the app shows a "dead gap" between the first paint and when
React mounts. Today the sequence is:

1. `index.html` loads (~8KB).
2. The `<body>` shows `background_grass.png` (216KB) — but there is **no logo,
   no text, and no spinner** until React mounts.
3. The heavy resources download: Mapbox GL JS (CDN), `main.js` (~430KB),
   `main.css` (~75KB), ionicons (CDN).
4. Only once React mounts does the in-app `LoadingState` spinner appear (it
   covers the subsequent map-data load).

During step 2–3 the user has no signal that anything is happening, so the app
feels broken. The in-app spinner cannot help here because it lives **inside**
the 430KB bundle — it cannot render until exactly the slow part has finished
downloading.

## Goal

Eliminate the "is it broken?" feeling by painting an instant, branded loading
splash in the first frame, with a progress bar driven by **real** load
milestones. This is a perceived-performance fix, not a download-size fix.

## Non-goals

- Reducing bundle/resource size (separate effort).
- Changing the in-app `LoadingState` spinner that covers map-data loading.
- A skeleton-UI placeholder (explicitly not chosen).

## Design

### 1. Markup & paint

A `<div id="splash">` placed first inside `<body>`, with its styles in an
**inline `<style>` in `<head>`** so there is no flash of unstyled content and no
dependency on `styles.css` or `main.css`.

Splash contents:

- The existing inline SVG bike/mountain mark (already a `data:` URI used as the
  favicon in `index.html`) — zero network cost, paints immediately.
- The Hebrew site title: `מפת שבילי אופניים - גליל עליון וגולן`.
- A progress bar track + fill.

The splash background is an **instant-paint CSS gradient** (sky → grass, matching
the favicon palette) — deliberately **not** the 216KB `background_grass.png`, so
the splash never waits on an image download. The splash is `position: fixed`,
full-screen, RTL, with a high `z-index` above everything.

### 2. Real progress milestones

A small inline `<script>` (in `<head>`, before the resource `<link>`/`<script>`
tags) defines:

```js
window.__splash = {
  set(pct) { /* set --splash-progress CSS var; bar width transitions via CSS */ },
  done()  { /* add .splash--hidden, remove node after fade */ }
};
```

The bar fill width is driven by a `--splash-progress` CSS variable with a CSS
`transition` so steps ease smoothly rather than snapping.

Milestones (in load order):

| Milestone                                   | Target | Hook                                   |
|---------------------------------------------|--------|----------------------------------------|
| HTML parsed / first paint                   | ~15%   | inline call at end of the splash script |
| Mapbox GL JS downloaded (the big CDN chunk) | ~50%   | `onload` on the `mapbox-gl.js` `<script>` |
| `main.jsx` module begins executing          | ~75%   | first line of the app entry module      |
| React mounted                               | 100%   | top-level effect in the React app       |

### 3. Handoff

At React mount the splash fades out (CSS `opacity` transition, ~300ms) and the
existing in-app `LoadingState` spinner takes over for the remaining map-data
load.

- Splash covers the dead gap: **HTML → React mount**.
- In-app spinner covers: **map-data load**.

No overlap and no double-tracking of map readiness. (Fade-at-mount was chosen
over keeping the splash until the map itself is ready.)

### 4. Removal

The React app calls `window.__splash?.done()` from a top-level effect (in
`main.jsx` or `App`). `done()` adds a `.splash--hidden` class (opacity 0) and
removes the node after the transition completes. The progress milestone hook at
React-mount and `done()` may be the same call (set 100% + fade).

### 5. Failure safety

A JS timeout (e.g. 15s) in the inline script force-runs `done()` even if a
milestone never fires, so a stalled CDN cannot trap the user behind the splash
indefinitely.

## Files touched (expected)

- `index.html` — inline `<style>`, the `<div id="splash">`, the inline progress
  script, the `onload` hook on the Mapbox script tag.
- `src/main.jsx` (or `src/App.jsx`) — the `~75%` "module executing" bump and the
  React-mount `done()`/100% call.

The added inline HTML/CSS/JS is expected to be on the order of ~2KB and adds no
extra network round-trips.

## Open questions

None outstanding. Handoff point confirmed as fade-at-React-mount.
