# Route Point Editing Plan

## Goal

Make route point editing feel intentional and predictable while keeping the map
visually quiet:

- keep route points small and unobtrusive when idle;
- make drag interactions clear through temporary feedback;
- avoid expensive or surprising route recalculation while the pointer is moving;
- preserve dragged points even when the drop location is outside the routable
  network;
- commit the edited route only when the user releases the point;
- allow users to drag the rendered route itself to insert a new shaping point in
  the correct route leg.

## Current Behavior

- Route points are rendered by `syncRoutePointLayers` in
  `src/map/mapLayers.js`.
- Map interactions for point selection, dragging, and context-menu removal live
  in `src/map/MapView.jsx`.
- During drag, `handleRoutePointDrag` in `src/App.jsx` calls
  `shardedSession.dragPoint(...)` or `dragPoint(...)` on every pointer move.
- `dragPoint(...)` calls `manager.recalculateRoute(nextPoints)`.
- `RouteManager._snapRoutePoints(...)` currently drops points that cannot snap
  to the network, which makes an outside-network drag look like point deletion.

## UX Direction

### Idle State

Keep the current subtle point styling:

- middle points: small white rings;
- start/end: same small size, solid green/red;
- no route-animation point glow or number overlay.

### Drag Start

When the user starts dragging a point:

- freeze the currently rendered route geometry;
- mark the dragged point as the active edit target;
- show a temporary interaction halo at the dragged point location;
- disable map pan as today.

### During Drag

Do not recalculate the actual route while the pointer moves.

Instead, render a temporary "edit guide" overlay:

- dashed straight line from previous point to the dragged cursor;
- dashed straight line from dragged cursor to next point;
- for the first point, only cursor to next point;
- for the last point, only previous point to cursor;
- use a thin, subdued white/blue style so it reads as a guide, not the final
  route;
- keep the existing route visible and unchanged behind it.

This communicates which route legs will be affected without pretending to show
the final routed path.

### Dragging The Route Line

After existing point dragging is improved, let the user drag the rendered route
line itself:

- pointer down on the route line does not immediately edit;
- once the pointer moves beyond a small threshold, treat the interaction as
  insert-and-drag;
- identify the waypoint leg that owns the touched route geometry;
- insert a temporary waypoint between those two route points;
- reuse the same dashed edit guide:
  previous point -> cursor -> next point;
- on release, commit the inserted point and recalculate once.

This is still waypoint editing, not raw route-geometry editing. The inserted
point becomes a normal route point and is included in sharing, undo, and later
edits.

### Drag End

On pointer release:

- clear the temporary guide and halo;
- commit the new route point coordinates once;
- recalculate the actual route once;
- push one history entry for undo;
- restart the route direction animation after the final geometry updates.

### Outside-Network Drop

The dragged point must not disappear if the final location cannot be routed.

Expected behavior:

- keep the point at the dropped coordinates;
- show the route as broken/incomplete if routing cannot connect the affected
  leg;
- keep warnings/errors in existing route UI surfaces;
- allow the user to drag the point again or remove it explicitly.

## Implementation Tasks

### Phase 1: Existing Point Drag

### 1. Add Drag Preview State

Modify `src/App.jsx`:

- add state for the in-flight drag preview, e.g.
  `{ index, lng, lat, pointsBeforeDrag }`;
- on drag start, capture the route snapshot and initialize preview state;
- on drag move, update only preview state with the cursor coordinates;
- on drag end, call route recalculation once with the final coordinates.

Important: while preview state is active, do not call `dragPoint(...)` from
`handleRoutePointDrag`.

### 2. Add Map Drag Guide Layers

Modify `src/map/mapLayers.js`:

- add a GeoJSON source for route point drag preview;
- add a dashed line layer for the edit guide;
- add a subtle halo/circle layer for the dragged cursor point;
- expose `syncRoutePointDragPreviewLayer(map, preview)` and
  `clearRoutePointDragPreviewLayer(map)`.

Layer style:

- line color: soft white/blue;
- line width: about 2 px;
- opacity: about 0.65;
- dasharray: short dashes;
- halo: transparent fill with white/blue stroke.

### 3. Wire Preview Into MapView

Modify `src/map/MapView.jsx`:

- accept a `routePointDragPreview` prop from `App`;
- call `syncRoutePointDragPreviewLayer` while preview is active;
- clear the layer when preview ends or the map unmounts;
- keep existing pointer handlers for drag start/move/end.

### 4. Commit On Release Only

Modify `src/App.jsx`:

- make `handleRoutePointDrag` update preview state only;
- make `handleRoutePointDragEnd` compute the final point list and call routing
  once;
- keep history behavior as a single undo step per drag;
- ensure route URL clearing happens only on final commit.

### 5. Preserve Unsnapped Route Points

Modify route calculation behavior so invalid/unsnapped points are preserved in
`routeState.points`.

Candidate implementation:

- add a route-manager method or route-action helper for "candidate points" that
  keeps the input points and annotates snapped metadata when available;
- update route geometry/segments from only routable legs;
- do not filter unsnapped route points out of `routePoints`;
- set route failure/broken-route state when a leg cannot be routed.

Files to inspect/change:

- `route-manager.js`
- `src/routing/routeActions.js`
- `src/routing/shardedRouteSession.js`
- route reducer/tests that assume points disappear after failed snap.

### Phase 2: Route-Line Insert And Drag

### 6. Add Route Hit And Leg Lookup

Modify `src/map/mapLayers.js` and route geometry state:

- add or reuse an invisible route hit layer with a generous line width;
- expose route geometry hit events from `MapView`;
- determine which waypoint leg owns the hit route geometry.

Preferred implementation:

- annotate route geometry, or a parallel lookup table, with leg indexes;
- hit geometry index maps to insertion index `legIndex + 1`.

Acceptable first implementation:

- snap route points to geometry indices;
- find the route-point index interval that contains the hit geometry index;
- insert after the lower route-point index.

The fallback needs tests for out-and-back routes and loops because nearest route
point alone is not enough.

### 7. Start Insert Drag From Route Line

Modify `src/map/MapView.jsx` and `src/App.jsx`:

- on pointer down over the route line, record a pending route-line drag;
- do not insert a point for a simple click;
- once movement exceeds a threshold, create drag preview state with
  `{ mode: "insert", insertIndex, lng, lat, pointsBeforeDrag }`;
- show the same dashed guide between the surrounding route points and cursor;
- keep the real route frozen during movement.

### 8. Commit Inserted Point On Release

Modify `src/App.jsx`:

- on release, insert the point at `insertIndex`;
- recalculate once;
- push a single undo history entry;
- clear preview state and route URL;
- preserve the inserted point even if routing fails.

### Phase 3: Follow-Up Editing UI

### 9. Selected Point Actions

Later cleanup after drag behavior works:

- add a selected-point map popover or mobile bottom sheet;
- expose remove/possibly reorder actions there;
- keep right-click removal as a secondary desktop shortcut only.

## Tests

Add/update tests for:

- dragging updates preview state without recalculating route on each move;
- drag end recalculates route once;
- preview guide geometry includes previous/cursor/next lines as expected;
- dropping outside the network preserves the waypoint;
- route-line drag inserts a new waypoint between the correct neighboring route
  points;
- route-line click without drag does not insert a point;
- route-line drag on out-and-back geometry chooses the hit leg, not merely the
  nearest route point;
- undo after drag restores the original route;
- existing add/remove/route-sharing behavior still passes.

Likely test files:

- `tests/test-map-layers.mjs`
- `tests/test-react-route-actions.mjs`
- `tests/test-route-manager-snap.js`
- `tests/test-route-manager-geometry.js`

## Manual Checks

Use the local app with a shared `?route=...` URL:

- drag a middle point and verify the route stays frozen until release;
- verify dashed guide lines connect previous/cursor/next;
- drag first and last points and verify only one guide leg appears;
- release on-network and verify route updates once;
- release outside-network and verify the point remains visible;
- drag a visible route segment and verify a new shaping point is inserted
  between the correct neighboring route points;
- click a route segment without dragging and verify no point is inserted;
- undo restores the pre-drag route;
- mobile/touch drag still works.

## Open Questions

- Should an outside-network point show a distinct warning style, or should the
  existing broken-route warning be enough?
- Should the guide line use previous/next route points only, or the closest
  points on the current rendered geometry near those route points?
- Should route-line insert-and-drag be desktop-only at first to avoid touch pan
  conflicts?
- Should the first route-line click select the route/leg, or should route-line
  interactions stay drag-only?
- Should selected point actions move into a map popover in the same iteration,
  or stay as a later cleanup after drag behavior is fixed?
