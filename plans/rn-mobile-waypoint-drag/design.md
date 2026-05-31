# Native Route Waypoint Drag — Design

**Date:** 2026-05-31. **Phase:** 2.11 (mobile-web parity slice).

## Goal

Let the iPhone planner reshape a route by **dragging a waypoint** on the map,
matching the web planner. The shared `useCyclewaysApp` controller already exposes
the full drag lifecycle; native only lacks the gesture wiring.

## Context

- Shared controller `packages/core/src/app/useCyclewaysApp.js` exposes:
  - `handleRoutePointDragStart(index)` — snapshots route state for undo.
  - `handleRoutePointDrag(index, point)` — `point = { lng, lat }`; updates a live
    drag preview.
  - `handleRoutePointDragEnd()` — async; commits the drag (recomputes the route
    from the preview points) or no-ops if nothing changed.
- Native `apps/mobile/src/MapScreen.jsx` currently renders route points as a
  `ShapeSource` + `CircleLayer` (`route-points`) with `onPress` → tap-to-select
  (`handleRoutePointSelect`). It does NOT use any drag handler.
- Web wires the same three handlers to its draggable map markers.

## Approach (chosen: A)

Render each route point as a draggable `@rnmapbox/maps` **`PointAnnotation`**,
whose native `draggable` + `onDragStart`/`onDrag`/`onDragEnd` map 1:1 to the
three controller handlers and coexist with tap-to-select. Rejected: custom
pan-gesture dragging (B, much more screen-math) and a selected-only drag handle
(C, less discoverable).

## Components & Data Flow

`apps/mobile/src/MapScreen.jsx` only:

- Render `routeState.points.map((point, index) => <PointAnnotation .../>)` with
  `id={`route-point-${index}`}`, `coordinate={[point.lng, point.lat]}`,
  `draggable`. Inside, a small circular `View` styled like the current route
  point circles (selected styling for `index === selectedRoutePointIndex`).
- `onSelected={() => handleRoutePointSelect(index)}` (preserves tap-to-select).
- `onDragStart={() => handleRoutePointDragStart(index)}`.
- `onDrag={(e) => handleRoutePointDrag(index, coordFromAnnotationEvent(e))}` where
  the event payload carries the geometry coordinate `[lng, lat]`.
- `onDragEnd={() => { handleRoutePointDragEnd(); }}`.

The controller does the rest: snapshot (so **undo** works for free), preview, and
route recompute on release — which automatically refreshes the route line, point
chips, stats, warnings, and elevation profile through existing bindings.

The existing `route-points` `ShapeSource`/`CircleLayer` is replaced by the
annotations (so points aren't drawn twice). The `ShapeSource.onPress` tap path
(`handleRoutePointPress`) is removed for route points since `PointAnnotation`
`onSelected` covers selection. Pending/preview point rendering is unchanged.

## Scope / Non-Goals

- Route **points only**; no `handleRouteLineDrag` (drag the line to insert a
  point) in this slice.
- No live preview line while dragging (the annotation itself moves with the
  finger; the recomputed line appears on release). The controller's preview
  state can be wired later if desired.
- No shared/web/core changes — `useCyclewaysApp` is untouched. Web behavior
  unchanged.

## Edge / Error Handling

- Drag that ends where it started, or off the routable network → controller
  `handleRoutePointDragEnd`/recompute no-ops or reports the existing broken-route
  state; no native-specific handling needed.
- Clearing/undo already reset points via existing bindings.

## Testing / Verification

- `npm test` + `npm run build` (web/shared untouched → zero behavior change).
- `npx expo export --platform ios` succeeds.
- Simulator: build a 2-point route, drag the middle/end waypoint to a nearby
  network location, confirm the route reshapes and stats update, then `ביטול`
  (undo) restores the prior route. Screenshot before/after.
- The drag handlers themselves are already exercised by existing controller
  tests; this slice adds only native gesture wiring (no new shared logic to
  unit-test). Maestro dragging of a specific annotation is coordinate-fiddly, so
  primary native verification is a scripted/manual simulator drag.

## Acceptance Criteria

- Dragging a route waypoint on the iPhone map reshapes the route (line, chips,
  stats, elevation all update) via the shared handlers.
- Tap-to-select and remove still work.
- Undo restores the pre-drag route.
- Web behavior and `useCyclewaysApp` are unchanged.
