# React Native Elevation Profile Chart — Design

**Date:** 2026-05-31. **Phase:** 2.9 (post-parity feature slice).
**Topic dir:** `plans/rn-mobile-elevation-profile/`.

## Goal

Give the iPhone app a native **elevation profile chart** with full parity to the
mobile web planner: a grade-colored elevation curve, a touch-scrub tooltip
(distance / elevation / grade%), and a synced marker on the native map that
tracks the scrubbed position. This replaces the compact stats-only elevation
treatment that Phase 2.8 intentionally shipped as a placeholder.

This is a feature slice on top of completed Phase 2.8 parity. It keeps the shared
controller (`useCyclewaysApp`) untouched and follows the project's established
pattern: move pure presentation/computation into `@cycleways/core`, render it
separately per platform.

## Context

The web planner already has a complete elevation profile in
`src/components/ElevationProfile.jsx`:

- A pure `buildElevationProfile(geometry)` that resamples the route to a fixed
  width, smooths elevations, computes per-point grade, clusters by grade, and
  returns `{ elevationData, clusterPaths, outlinePath }`. `clusterPaths` are
  area-under-curve SVG `d` strings (one per grade cluster, with a color);
  `outlinePath` is the full curve outline. All paths use a `viewBox="0 0 100 100"`
  coordinate space, so they are renderer-agnostic.
- Web-only grade/cluster helpers in `src/utils/grade.js`
  (`GRADE_CLASSES`, `GRADE_COLORS`, `GRADE_LABELS_HE`, `pointSmoothedGrades`,
  `classifyGrade`) and `src/utils/slopeClustering.js` (`clusterByGrade`).
- DOM/SVG rendering, an `animator`-driven moving marker, and mouse/touch
  scrubbing that emits an `onElevationHover` payload (coord, distance, elevation,
  grade) which the web map uses to highlight a position.

Confirmed facts:

- **Native route geometry already carries per-point elevation** — the engine
  builds geometry points as `{ lat, lng, elevation }` (`coord[2]` in
  `route-manager.js`); elevation gain/loss already render in the native sheet.
- `apps/mobile` has **no SVG or chart library** yet.
- The native bottom sheet (`apps/mobile/src/MapScreen.jsx`) currently shows
  compact stats (distance / climb / descent) from
  `routePlannerPresentation.getRoutePlannerPresentation(...).stats`.

## Scope (this slice)

In scope:

- Grade-colored elevation area chart + outline, rendered natively.
- Touch-scrub tooltip with distance / elevation / grade%, matching web copy.
- A synced scrub marker on the native map.
- A grade legend.
- An **expandable** bottom route sheet (compact by default; expands to reveal
  the chart). The map stays visible above the expanded sheet so the scrub marker
  is on screen.

Out of scope (non-goals):

- The web's `animator`-driven auto-moving marker during route animation (native
  has no such animator; the marker is scrub-driven only).
- Changing `useCyclewaysApp` or any route/elevation computation.
- Route-following/navigation mode.
- A draggable physics bottom sheet library — a simple two-state expand/collapse
  is enough for the first pass.

## Sharing Strategy (chosen: Approach A)

Extract the pure logic into `@cycleways/core`; both platforms consume it.

- New `packages/core/src/ui/elevationProfile.js` exporting the pure
  `buildElevationProfile(geometry)` → `{ elevationData, clusterPaths, outlinePath }`.
- Move `grade.js` and `slopeClustering.js` from `src/utils/` into
  `packages/core/src/utils/`. They are already pure. Update web imports to the
  `@cycleways/core/utils/...` paths.
- Refactor web `src/components/ElevationProfile.jsx` to import the builder and
  grade constants from core, keeping all its existing DOM/SVG/animator/hover
  code byte-for-byte otherwise. **Zero behavior change**, verified by the guard.

Rejected alternatives: leaving the builder in web and duplicating it natively
(divergence risk; violates the shared-core model the project is built on).

## Components & Data Flow

### Shared (core)

- `buildElevationProfile(geometry)` — pure, platform-agnostic, as above.
- `grade.js` / `slopeClustering.js` — pure grade math + clustering.

### Native chart (`apps/mobile/src/ElevationProfileChart.jsx`)

- Add `react-native-svg` via `expo install react-native-svg`.
- Render with `<Svg viewBox="0 0 100 100" preserveAspectRatio="none">`:
  - one `<Path d={cluster.d} fill={cluster.color} fillOpacity={0.45}/>` per
    `clusterPaths` entry (grade-colored area fills),
  - one stroked `<Path d={outlinePath}/>` for the curve outline,
  - a vertical scrub marker `<Line>` whose `x` follows the active scrub point.
- A grade legend row built from core `GRADE_CLASSES`/`GRADE_COLORS`/`GRADE_LABELS_HE`.
- A scrub overlay (`PanResponder`) maps touch-x → closest `elevationData` point
  → sets local tooltip state and calls an `onScrub(point | null)` prop. The
  `findClosestElevationPoint(elevationData, xPercent)` helper is extracted into
  core (`elevationProfile.js`) alongside the builder, and web `ElevationProfile`
  imports it too (replacing its private copy, zero behavior change).
- Tooltip copy mirrors web: `📍 מרחק: {km} km • גובה: {m} m` plus a grade chip
  `{GRADE_LABELS_HE[gradeClass]} · {grade}%`.

### MapScreen integration

- MapScreen owns `scrubPoint` state. `ElevationProfileChart` receives `onScrub`
  and updates it; release clears it.
- MapScreen renders an **elevation-scrub marker** as a new `ShapeSource` +
  `CircleLayer` at `scrubPoint.coord` (same pattern as the existing
  `search-highlight` layer). Hidden when `scrubPoint` is null.
- The chart is rendered inside the bottom sheet's expanded state, fed
  `geometry = routeState.geometry` and `distance = routeState.distance`.

### Expandable bottom sheet

- The existing bottom sheet gains a `sheetExpanded` boolean and a tap handle.
- Compact (default): today's description + stats.
- Expanded: description + stats + `ElevationProfileChart`.
- Animate height/opacity with `Animated`/`LayoutAnimation`; no gesture-physics
  library. The expanded sheet height is capped so the map (and scrub marker)
  stay visible above it.
- The chart only renders when a route is ready and has ≥2 elevation points
  (`buildElevationProfile` returns null otherwise → no chart, sheet shows stats
  only).

## Error / Edge Handling

- No route / <2 points / missing elevation → `buildElevationProfile` returns
  null; the expanded sheet shows stats only, no chart, no crash.
- Scrub beyond chart bounds is clamped to [0,100]% (as web does).
- Clearing the route clears `scrubPoint` and collapses to stats.

## Testing / Verification

- **Web guard (extraction is zero-behavior-change):** `npm test`,
  `npm run build`, dev-probe on the known route, `npm run test:smoke` at the
  40/12/2 baseline.
- **New core unit test:** `buildElevationProfile` produces stable
  `clusterPaths`/`outlinePath`/`elevationData` for a known geometry fixture
  (guards the extraction and future changes).
- **Native:** `npx expo export --platform ios`; a Maestro flow that builds a
  route (reusing the warning-corridor taps), expands the sheet, asserts the
  chart and legend render, scrubs across the chart, and screenshots the synced
  map marker + tooltip.

## Acceptance Criteria

- With a route ready, expanding the native bottom sheet shows a grade-colored
  elevation chart with the same grade colors/labels as mobile web.
- Dragging across the chart shows a tooltip (distance / elevation / grade%) and
  moves a marker on the native map to the corresponding point.
- Collapsing the sheet or clearing the route hides the chart and marker.
- Web elevation profile behavior is unchanged (guard green).
- `useCyclewaysApp` and route/elevation computation are untouched.
