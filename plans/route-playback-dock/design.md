# Usable route-playback dock + web-parity animation

**Date:** 2026-06-28
**Topic:** `route-playback-dock`
**Status:** Design approved, pending implementation plan
**Builds on:** `plans/rn-mobile-map-style-parity/` (shared playback engine, `getPlannerBuildModel`, `paintToRNStyle`).

## Problem

The route-playback player added in the map-style-parity work is not usable on the
two drawer surfaces (mobile web and the iPhone app):

1. **iOS "auto-plays" when opening a route.** `packages/core/src/app/useCyclewaysApp.js:393`
   auto-fires a route-direction chevron animation (`animator.trigger(...)`) in an
   effect whenever `routeState.geometry`/`points` change. It is a pre-existing
   "direction hint" (shared with web, where it is subtle), but on iOS the
   `RouteDirectionPulseLayer` renders it prominently, so opening a route reads as
   auto-play.

2. **iOS play animation does not match web.** On play, **web** renders a
   `progress-head-pulse` *video-cursor* (a pulsing head marker traveling the
   route) via `videoCursor={plannerPlayback.cursor}` (`src/App.jsx:1028`). **iOS**
   moves a plain flat dot (`ELEVATION_SCRUB_STYLE`) via `setScrubPoint`. The pulse
   variant constants are shared in core, but there is no React-Native renderer for
   them, so iOS got a lesser visual.

3. **Play control and elevation graph can't be seen together (both surfaces).**
   The key requirement: while previewing a route the user must see the **play
   control + elevation graph together, with the map/animation still visible.**
   - **Web** renders the playback control twice — a map overlay
     (`planner-route-playback--map`, `src/App.jsx:1035`) and inside the drawer
     next to the elevation graph (`planner-route-playback--panel`,
     `src/App.jsx:1182`). Opening the drawer covers the map-overlay copy; the
     panel copy + elevation are only visible with the drawer open (covering the
     map).
   - **iOS** puts `PlaybackControls` inside the scrollable bottom-sheet body,
     below the POIs, with the elevation chart also in the sheet — so the user must
     open the sheet (covering the map) and scroll to reach the control.

## Decisions taken during brainstorming

- **Layout:** a combined **playback dock** pinned as a map overlay just above the
  collapsed drawer handle, on both mobile web and iOS.
- **iOS animation:** *play-driven web pulse only* — remove the auto-firing
  direction-chevron on iOS; the only animation is play, using the same
  `progress-head-pulse` traveling marker as web.
- **iOS direction animator:** disabled entirely on the native app; everything
  (map pulse, mini-elevation cursor, full elevation graph cursor) is driven from
  the single playback-engine cursor — the way web already works.
- **Scope:** mobile web + iOS only. Desktop web is unchanged (its side panel
  already shows the map and elevation together).

## Design

### A. Combined playback dock (mobile web + iOS)

A compact dock pinned as a map overlay just above the collapsed drawer handle,
visible whenever a route is ready — without opening the drawer:

```
┌─────────────────────────────────────┐
│            (map + moving             │
│             route pulse)             │
│  ┌────────────────────────────────┐ │
│  │ ▶  ▁▂▃▅▇▆▄▂▁  (cursor ●)  2.1/5km│ │  ← dock
│  └────────────────────────────────┘ │
│  ════════ drawer handle ════════     │
└─────────────────────────────────────┘
```

- Contents: play/pause button, a scrub track, a **mini elevation sparkline** with
  the playback cursor riding it, and a distance readout (`current / total`).
- Scrubbing the track seeks playback; the mini-elevation cursor and the map pulse
  track it.
- The full elevation graph still lives in the expanded drawer (unchanged) and
  shares the same playback cursor.
- **iOS:** move `PlaybackControls` out of the scrollable sheet body into a fixed
  overlay dock above the sheet handle, extended with the mini-elevation strip.
- **Web:** enhance the existing `planner-route-playback--map` overlay with the
  mini-elevation strip so control + elevation are visible together without opening
  the drawer. The `--panel` copy inside the drawer may remain (full graph context)
  or be dropped if redundant — decided in the plan; the dock is the always-visible
  surface.

### B. Web-parity animation on iOS

- Add a React-Native map layer that renders the `progress-head-pulse` marker (a
  pulsing head) at the playback cursor, matching web's video-cursor variant,
  replacing the flat `ELEVATION_SCRUB_STYLE` dot. Reuses the shared cursor
  position and the `VIDEO_CURSOR_VARIANTS` / pulse constants from
  `packages/core/src/map/mapStyles.js`.
- Disable `enableRouteDirectionAnimation` for the native app so the
  direction-chevron no longer auto-fires (and the `directionAnimatorRef` is not
  created — `useCyclewaysApp.js:130-189`).
- Re-point the iOS elevation chart cursor (currently synced to the direction
  animator's `elevation` channel) to the **playback cursor fraction**, exactly as
  web's `PanelElevationGraph` consumes `plannerPlayback.cursor?.fraction`. After
  this, one cursor source (the playback engine) drives the map pulse, the dock
  mini-strip, and the full elevation graph.

### C. Shared vs per-surface

- **Shared (core):** the playback engine + cursor (already shared); the elevation
  profile sample builder (already shared, `packages/core/src/ui/elevationProfile.js`);
  the cursor variant constants (already shared). Add a small shared **dock
  view-model** (`hasRoute`, `cursorFraction`, elevation samples, formatted
  `current / total` readout) so both docks render from one source and cannot
  drift.
- **Per-surface view:** web dock = DOM (extend `RoutePlaybackControls` + a compact
  sparkline component); iOS dock = a new RN overlay component + the new RN pulse
  layer. View layers stay separate (consistent with the map-style-parity work).

## Scope boundary (YAGNI)

- Desktop web untouched.
- No change to featured-route playback (`RouteMapPlayback`, `VideoEmbed`) or the
  web panel elevation graph's internals.
- No new playback features (no speed control, no loop). Placement + animation
  parity only.
- The deferred mobile POI-dwell cue slides (F1 in
  `plans/rn-mobile-map-style-parity/follow-ups.md`) stays deferred unless folded
  in explicitly.

## Affected areas (anticipated)

Shared (`packages/core`):
- new shared dock view-model (e.g. `src/ui/playbackDock.js`).

Web (`src`):
- `App.jsx` — dock placement (mini-elevation in the `--map` overlay).
- `components/featured/RoutePlaybackControls.jsx` and/or a new compact sparkline
  component; `react-app.css` dock styles.

Mobile (`apps/mobile/src`):
- `MapScreen.jsx` — disable direction animator, add RN pulse cursor layer, render
  the dock overlay (remove `PlaybackControls` from the sheet body), drive
  elevation chart from the playback cursor.
- new `planner/PlaybackDock.jsx` (dock) and a `MapCursorPulse` layer; possibly
  fold the existing `PlaybackControls.jsx` into the dock.

Tests:
- shared dock view-model unit test; cursor-source wiring test as feasible.
