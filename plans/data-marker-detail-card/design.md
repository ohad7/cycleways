# Data-marker detail card (tap a landmark)

Date: 2026-06-01
Status: approved, implementing

## Problem

Tapping a data marker (hazard: warning/mud/gate/slope/severe… or POI:
viewpoint/cafe/landmark…) only sets `mapUi.selectedDataMarker`, which is routed
through `getRouteWarningPresentation`. On mobile that is nearly a no-op: the
selected marker is suppressed whenever the route has its own warnings
(`normalizeWarnings`), and even when shown the legend renders only type label +
emoji — never the marker's `information` text. The web shows it in a side-panel
`DataSummary`, so mobile is below parity.

## Goal

Tapping any marker opens a **bottom-sheet detail card** showing the marker's
emoji, type label, segment name, and `information` text, with two actions:
**add to route** and **close**. Same card for hazards and POIs. Applies to the
**iPhone app** and the **mobile web** app (shared core + per-platform card UI).

## Shared core (`useCyclewaysApp`)

- `handleDataMarkerClick(marker)` — unchanged: sets `selectedDataMarker`.
- `handleMapClick(point)` — also clears `selectedDataMarker`, so adding a route
  point anywhere dismisses an open card.
- **New** `handleSelectedDataMarkerClear()` — sets `selectedDataMarker: null`
  (the card's close button).
- **New** `handleAddDataMarkerToRoute(marker)` — appends the marker's
  coordinate as a route point (delegates to `handleMapClick({lng, lat})`, which
  snaps + clears the selection). No-op if the marker lacks finite coords.

The selected marker is **decoupled** from `normalizeWarnings`; the card reads
`selectedDataMarker` directly, so inspecting a marker works regardless of route
state. The legend/warning channel keeps showing the route's `activeDataPoints`.

## "Add to route" semantics

Appends the marker's coordinate to the end of the route, exactly as tapping the
map at that spot would (same `handleMapClick` path, same snapping — which now
also benefits from the CW-edge snap preference). v1 = append only; no insert.

## iPhone UI (`apps/mobile/src/MapScreen.jsx`)

New `DataMarkerCard` bottom-sheet, shown when `selectedDataMarker` is set,
sitting above the route sheet. Content: emoji + type label (`POI_LABELS`),
segment name, information text. Buttons: "הוסף למסלול" (add to route) and a
close (×). Hazard types use their `POI_COLORS` accent; POIs share the same card.

## Mobile web UI (`src/`)

New `DataMarkerCard.jsx` rendered as a fixed bottom-center card (bottom sheet)
when `selectedDataMarker` is set, with the same content + add-to-route + close.
Remove the selected-marker block from `DataSummary.jsx` (lines ~20–32) so it is
not duplicated; `DataSummary` keeps showing route `activeDataPoints`.

## Out of scope (YAGNI)

Insert-at-nearest-leg, different layouts per marker family, clustering, POI-only
navigation actions.

## Testing

- The hook (`useCyclewaysApp`) has no headless test harness here; the underlying
  append path is already covered by the `routeActions` tests, and
  `handleAddDataMarkerToRoute` is a thin coord-validating wrapper over
  `handleMapClick`. Existing route/data-marker tests must stay green, and the web
  app must build.
- UI: manual — tap marker → card with info + buttons; add to route appends a
  point and closes; close (×) dismisses; tap map dismisses. Both apps.
