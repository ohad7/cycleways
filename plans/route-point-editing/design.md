# Route Point Editing Design

## Goal

Make route editing feel like direct manipulation of the route, without exposing
the user to internal routing mechanics.

Users should be able to:

- move an existing route point;
- pull the route from any visible routed segment to add a shaping point;
- see clear temporary feedback while editing;
- keep the current route stable until they release the pointer;
- recover from failed/outside-network edits without losing points.

## Product Model

The route is still defined by ordered waypoints. The user can edit those
waypoints in two ways:

1. Drag an existing waypoint.
2. Drag a place on the rendered route, which inserts a new waypoint into the
   correct leg and immediately drags it.

The second behavior is not freeform geometry editing. It is shorthand for:

```text
insert waypoint between point N and point N+1, then drag that waypoint
```

This keeps route sharing, summaries, undo, and routing logic aligned around the
same ordered route-point model.

## Interaction Principles

### Keep The Route Frozen While Dragging

Dragging should not recalculate the actual route on every pointer move. The
existing route remains visible as a stable reference, and the user sees a
temporary edit guide instead.

Route calculation happens once, on pointer release.

### Use A Temporary Edit Guide

During drag, show dashed straight guide lines:

- previous point to cursor;
- cursor to next point;
- first point: cursor to next point only;
- last point: previous point to cursor only.

The guide is not the final routed path. It shows which route legs are being
edited.

### Preserve Points

If the edited point lands outside the routable network, keep the point. The
route can become broken or incomplete, but the waypoint must remain visible and
editable.

## Existing Point Drag

When the user drags a route point:

1. Capture the current route state.
2. Freeze the visible route.
3. Show the edit guide between neighboring route points and the cursor.
4. Update only drag preview state during pointer movement.
5. On release, replace the point coordinates and recalculate once.
6. Create one undo entry for the whole drag.

## Route-Line Drag To Insert Point

When the user drags a visible route line:

1. Hit-test the route line through a larger invisible route hit layer.
2. Identify the nearest rendered route geometry segment.
3. Map that segment back to the waypoint leg it belongs to.
4. Insert a temporary waypoint between the leg's start and end route points.
5. Start the same drag preview used for existing points:
   `point N -> cursor -> point N+1`.
6. On release, commit the inserted point and recalculate once.

If the user clicks the route without dragging past a movement threshold, do not
insert a point.

## Leg Mapping

Route-line drag needs to know which waypoint leg owns a geometry segment.

Preferred data model:

- keep route geometry in user-travel order;
- annotate route geometry, or a parallel lookup table, with the leg index
  between route points;
- route-line hit testing returns a geometry index;
- geometry index maps to insertion index `legIndex + 1`.

Fallback for the first implementation:

- snap route points to geometry indices;
- find the route-point index interval that contains the hit geometry index;
- insert after the lower route-point index.

The fallback is acceptable if tests cover loops/out-and-back routes.

## Desktop And Touch

Desktop:

- pointer down on existing point starts point drag;
- pointer down on route line starts route-line drag only after a small movement
  threshold;
- plain click on route line can remain inert initially.

Touch:

- existing point drag should continue to work;
- route-line drag should be considered carefully because it can conflict with
  map panning;
- if touch conflicts are high, route-line insertion can start desktop-only or
  behind an explicit edit mode.

## Visual Language

Idle:

- route points stay small;
- start/end are solid green/red;
- middle points are subtle white rings.

Editing:

- dragged point gets a temporary halo;
- dashed guide lines show affected legs;
- no final-route recalculation until release;
- the actual route line remains visible and unchanged behind the guide.

## Phasing

Phase 1:

- existing point drag preview;
- commit on release;
- preserve outside-network points.

Phase 2:

- route-line drag inserts a new waypoint;
- reuse the Phase 1 preview and commit machinery.

Phase 3:

- improve selected-point actions with a map popover or mobile bottom sheet.
