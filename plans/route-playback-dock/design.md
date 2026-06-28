# Usable route-playback panel (three-up: map + player + elevation) + web-parity animation

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

- **Layout:** during preview/play the bottom panel docks at a **partial
  (medium) height** containing the player + the **full interactive elevation
  graph**, with the map (and its route animation) staying visible above it.
  POIs/actions live in a further-expanded snap. The map shrinks but is never
  fully covered. (This supersedes an earlier "thin dock with a mini-sparkline"
  idea — the requirement is to see all three views at once with a *usable*,
  scrubbable elevation graph.)
- **Three views at once:** map (with route animation) + player + interactive
  elevation graph are all visible simultaneously during playback, on both
  surfaces.
- **Bidirectional sync (both surfaces, like web):** scrubbing the elevation
  graph seeks the player and moves the route cursor; playing moves the elevation
  cursor. One playback-engine cursor is the single source for the map pulse, the
  player readout, and the elevation graph cursor.
- **iOS animation:** *play-driven web pulse only* — remove the auto-firing
  direction-chevron on iOS; the only animation is play, using the same
  `progress-head-pulse` traveling marker as web.
- **iOS direction animator:** disabled entirely on the native app; everything is
  driven from the single playback-engine cursor — the way web already works.
- **Scope:** mobile web + iOS only. Desktop web is unchanged (its side panel
  already shows the map and elevation together).

## Design

### A. Partial-height playback panel (mobile web + iOS)

During preview/play the bottom panel docks at a partial (medium) height whose
top section is the **playback area**: the player controls + the full interactive
elevation graph. The map (with the route animation) stays visible above. The
POIs/actions are below, reachable only by expanding the panel further.

```
┌─────────────────────────────────────┐
│         (map + route pulse)          │   ← stays visible (shrinks)
│                                      │
│  ════════ panel handle ════════      │
│  ▶  0:42 / 1:35      2.1 / 5.0 km     │   ← player row
│   ╱╲      ╱╲___                       │
│  ╱  ╲___╱      ╲___●___               │   ← full interactive elevation graph
│ ───────────────────────────────      │     (scrub seeks player + route)
│  (POIs / actions below — expand)      │
└─────────────────────────────────────┘
```

- The panel auto-snaps to the **partial** height when a route becomes playable /
  on entering preview, so the playback area shows without covering the map.
- **Player row:** play/pause + scrub track + `current / total` readout, pinned at
  the top of the panel.
- **Elevation graph:** the full, scrubbable graph (not a sparkline), directly
  under the player row, sharing the playback cursor.
- **POIs / actions:** remain in the panel below the playback area; visible only at
  the larger (expanded) snap, so they never push the playback area out of view at
  the partial height.
- **iOS:** reorder the bottom-sheet content so the player + elevation graph are at
  the **top** of the sheet body (above POIs), and auto-snap the sheet to its
  middle snap point on play. `PlaybackControls` moves to the top of the sheet
  (out from below the POIs).
- **Web:** position the player + elevation at the top of the build panel and snap
  the front-shell sheet to its partial state on play, so the same three-up view
  appears. The redundant second control instance is consolidated (one player in
  the playback area).

### A2. Bidirectional elevation ⇄ player ⇄ route sync (both surfaces)

- Scrubbing/dragging along the elevation graph calls `seekToFraction` on the
  shared playback engine, which moves the route cursor (map pulse) and updates the
  readout — matching web's `handlePlannerElevationHover` →
  `plannerPlayback.seekToFraction`.
- Playing (or scrubbing the player track) moves the elevation graph cursor via the
  engine cursor fraction — matching web's `PanelElevationGraph`
  `cursorFraction={plannerPlayback.cursor?.fraction}`.
- **iOS change:** the elevation chart's scrub currently calls `setScrubPoint`
  (moves a dot only) and its cursor is driven by the direction animator. Re-wire
  scrub → `playback.seekToFraction`, and drive its cursor from
  `playback.cursor?.fraction`. After this, the elevation graph, the map pulse, and
  the player are one synchronized system on iOS, as on web.

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
  web's `PanelElevationGraph` consumes `plannerPlayback.cursor?.fraction` (see
  A2). After this, one cursor source (the playback engine) drives the map pulse,
  the player readout, and the elevation graph.

### C. Shared vs per-surface

- **Shared (core):** the playback engine + cursor (already shared); the elevation
  profile sample builder (already shared, `packages/core/src/ui/elevationProfile.js`);
  the cursor variant constants (already shared). Add a small shared **playback
  panel view-model** (`hasRoute`, `cursorFraction`, formatted `current / total`
  readout, the partial-snap target) so both surfaces render the playback area from
  one source and cannot drift.
- **Per-surface view:** web = DOM (player + elevation positioned at the top of the
  build panel; snap the front-shell sheet); iOS = the bottom-sheet content
  reordered (player + elevation at top) + auto-snap, plus the new RN pulse layer.
  View layers stay separate (consistent with the map-style-parity work).

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
- new shared playback-panel view-model (e.g. `src/ui/playbackPanel.js`).

Web (`src`):
- `App.jsx` — position player + elevation at the top of the build panel; snap the
  front-shell sheet to its partial state on play; consolidate the duplicate
  control instance.
- `components/frontPanel/BuildPanel.jsx` — playback area (player + elevation) at
  the top; `react-app.css` partial-snap styles.

Mobile (`apps/mobile/src`):
- `MapScreen.jsx` — disable direction animator, add the RN `progress-head-pulse`
  cursor layer, reorder the bottom-sheet so player + elevation are at the top and
  auto-snap to the middle snap on play, wire elevation scrub →
  `playback.seekToFraction` and its cursor from `playback.cursor`.
- `planner/PlannerSheet.jsx` — snap-point / content-order changes for the
  playback area; `planner/PlaybackControls.jsx` relocated to the top of the sheet.
- new RN `MapCursorPulse` layer for the progress-head-pulse marker.

Tests:
- shared playback-panel view-model unit test; cursor-source / seek-wiring test as
  feasible.
