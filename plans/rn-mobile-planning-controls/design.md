# React Native Planning Controls Design

## Goal

Phase 2.5 turns the simulator-verified tap-to-route slice into a more usable
mobile planner. A rider should be able to select an existing waypoint, remove
that waypoint, undo/redo route edits, and fit the camera back to the current
route without leaving the native map.

**Status:** Implemented and simulator-verified on 2026-05-30.

## Scope

- Keep `useCyclewaysApp` as the only owner of route state and edit actions.
- Add native waypoint hit handling via the route-point `ShapeSource`.
- Surface selected-waypoint state from `mapUi.selectedRoutePointIndex`.
- Wire route-point removal to `handleRoutePointRemove(index)`.
- Wire undo/redo controls to `handleUndo` and `handleRedo`.
- Fit the native `Camera` to route geometry, using controller restore requests
  and a user-visible `Fit` control.

## Non-Goals

- Dragging waypoints or inserting points by dragging the route line.
- Search, GPS location, GPX export/share sheets, or offline Mapbox tile packs.
- A final design system for the mobile planner chrome.

## Design Notes

The mobile screen remains a thin renderer over the controller. Local helpers are
limited to native Mapbox event decoding, GeoJSON feature construction, and camera
fit bounds.

Route-point taps can otherwise be mistaken for map taps, so the point-source
handler records a short guard timestamp before selecting a point. The map press
handler ignores events inside that guard window.
