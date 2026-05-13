# Waypoint Routing Design

## Goal

Make route creation feel like common map applications: users place points they
want to pass through, and the app builds a route that follows those points.

The current segment-selection model exposes an implementation detail. It works
for people who already understand the CycleWays network, but it is not a normal
mental model for visitors or casual users.

## Product Model

Use two route-creation modes over time:

1. Freeform route builder: click points on the map, route follows them.
2. Guided route builder: answer simple questions and receive suggested routes.

This plan covers the freeform builder only.

## Phase 1 Decision

Convert the public UI from "select segments" to "place route points", while
keeping routing constrained to the existing CycleWays graph.

The user interaction becomes:

- click map to add a waypoint
- drag waypoint to adjust route
- remove waypoint
- the first waypoint is only a start marker
- route geometry is generated only after the second waypoint
- route recalculates through the CycleWays network after every later waypoint
- selected segments become an internal result, not the primary interaction

`RouteManager` already supports most of this internally:

- `addPoint(point)`
- `removePoint(index)`
- `recalculateRoute(points)`
- `restoreFromPoints(points)`
- selected segment output from the current graph

So Phase 1 should focus on UX language, marker behavior, route sharing, and
making segment selection an internal metadata layer.

## Phase 1 Geometry Contract

The visible route is not the selected segment list. It is a separate ordered
route geometry derived from the user's waypoints.

Rules:

- With one waypoint, show only the marker. Do not generate route geometry.
- With two or more waypoints, generate one network leg between each consecutive
  waypoint pair.
- The geometry starts at the first snapped waypoint and ends at the last snapped
  waypoint.
- The first and last segment of each leg are clipped to the waypoint locations.
- If both waypoints are on the same segment, render only the slice between them.
- Full-segment highlighting is not the route visualization; selected segments
  are internal metadata for warnings, data points, summaries, and future routing
  decisions.
- GPX export and elevation/distance summaries use the clipped route geometry.

## Route Sharing

Use a single `route=` URL parameter with a compact Base58 binary payload. The
payload owns its version byte, so the URL parameter name does not need to change
for each encoding revision.

The existing production `route=` payload is segment-ID based and should keep
decoding for backwards compatibility. The temporary `w=` waypoint format did not
ship and has been removed from the branch.

New shares should use route payload version 3:

```text
?route=<base58-v3-payload>
```

Encoding goals:

- Keep shared URLs short enough for easy copy/paste and messaging apps.
- Preserve the user's visible route intent, including partial first/last
  segments.
- Avoid `segmentId + offset` because offsets are fragile when source segments
  are split or geometry is edited.
- Avoid decimal coordinate text because it is wasteful.
- Do not encode the full generated route geometry unless backend snapshots are
  added later.

Version 3 payload model:

```text
version: 1 byte = 3
anchor count: varint
hint count: varint

tokens:
  route anchor:
    type: 1
    lng: signed quantized integer
    lat: signed quantized integer

  full CycleWays segment:
    type: 0
    segment id: varint

  external route point, future Phase 2:
    type: 2
    lng: signed quantized integer
    lat: signed quantized integer
```

Coordinate quantization:

- Store coordinates as integers, not decimal strings.
- Use `[lng, lat]` order for consistency with GeoJSON and existing sharing.
- Quantize to 1e-6 degrees unless tests show 1e-5 is visually sufficient.
  1e-6 is roughly 0.1 meters and is more precise than the snap tolerance.
- Delta-encode consecutive coordinates where it materially reduces payload size.
- Encode signed integers with zig-zag varints.

Route tokenization:

- Quantized coordinate anchors are the durable source of truth. They represent
  the user-visible route points: clipped starts, clipped ends, and any
  intentional mid-route waypoint.
- Full segment tokens are compact hints for the CycleWays path chosen between
  anchors. They help restore the exact route when IDs still exist.
- Decode by reconstructing route points from coordinate anchors, then applying
  segment IDs as constraints/hints where possible.
- If segment IDs fail to resolve after a future map edit or segment split, the
  coordinate anchors still give the decoder enough information to reroute
  through the current graph.
- Do not use `segmentId + offset` for anchors. Offsets are compact, but become
  ambiguous when segments are split or their geometry changes.

On load:

- Decode `route=` by inspecting the payload version byte.
- Version 1/2 payloads remain legacy segment-ID routes.
- Version 3 payloads restore the compact hybrid route.
- Do not support `w=` unless evidence appears that it escaped into production.

Phase 1 snap behavior:

- Snap threshold is 100 meters.
- Points outside the threshold are rejected with a clear message.
- The app stores and displays the snapped coordinate, so dragged points stay on
  the route network.
- In Phase 1, "exact point" means the snapped point on the CycleWays line. Raw
  off-network click connectors belong to Phase 2.

## Phase 2 Decision

When a waypoint is outside the CycleWays network threshold, route that leg with
an external OSM-based routing engine.

CycleWays remains preferred:

- if waypoint is near a CycleWays segment, snap to CycleWays
- if not near CycleWays, create an external routed connector
- when possible, rejoin CycleWays at the nearest useful network point

External legs should be visually distinct because they do not carry CycleWays
metadata:

- dashed gray line
- separate route summary row
- no segment data markers, no quality score, no CycleWays warnings
- GPX export includes their coordinates

## Routing Engine Candidates

Reasonable candidates:

- GraphHopper: used by gpx.studio, OSM-based, supports bike routing and
  snapping/map matching.
- OSRM: very fast OSM routing, good HTTP API, but bike profile setup may be less
  convenient depending on hosting.
- BRouter: strong bicycle routing culture, useful for self-hosting or local
  experiments.

For this project, GraphHopper is probably the easiest reference point because
gpx.studio uses it and its product model is close to what we want.

## Mixed Route Model

Internally, a route should become a list of legs:

```json
[
  {
    "type": "cycleways",
    "waypointStart": 0,
    "waypointEnd": 1,
    "segments": [15, 65, 2]
  },
  {
    "type": "external",
    "waypointStart": 1,
    "waypointEnd": 2,
    "provider": "graphhopper",
    "profile": "bike",
    "coordinates": []
  }
]
```

For Phase 1 this structure can be implicit because every leg is `cycleways`.
Phase 2 should make it explicit.

## UX Implications

The app should avoid making users think in segment names:

- Change primary instructions from "select segments" to "add route points".
- Keep segment names/details as hover or route details, not primary controls.
- Rename "selected segments" UI copy to "route".
- Show warnings/data points as route annotations.
- Keep a power-user affordance for focusing/removing specific segments if needed,
  but avoid exposing it as the main workflow.

## Route-Scoped Data Warnings

Route warnings and data points should follow the actual clipped route geometry,
not the full set of selected internal segments.

Rules:

- Data points with a GPS `location` trigger only when the visible route geometry
  passes within 50 meters of that point.
- Segment hover and segment focus still show all data attached to that segment,
  because those views are for inspection rather than route alerts.
- Data points without a GPS location remain segment-wide fallbacks.
- Legacy `segment.warning` values remain segment-wide fallbacks when a segment
  has no structured `data` entries.
- The route warning chip, individual warning chips, download modal, and route
  marker emphasis all use the route-scoped data set.

This avoids warning users about a gate, mud patch, payment point, or other local
condition when their route only clips a different part of the same segment.

## Resolved Phase 1 Questions

- Snap threshold for "near CycleWays": 100 meters.
- Phase 1 rejects points that cannot snap to the network.

## Open Questions

- Which external routing provider can be used within hosting/token/cost limits?
- Should mixed external routes be shareable before backend route snapshots exist?
- How much should segment quality influence Phase 1 pathfinding?
- Is 1e-6 coordinate quantization worth the extra bytes compared with 1e-5 for
  public share URLs?
