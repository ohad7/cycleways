# Route Sharing V4/V5 Design

## Status

Implemented in this branch. The first delivery includes stable edge share IDs,
compact V4 route encoding, shard-hinted exact replay, fallback recalculation,
and share URL length status. A follow-up V5 hybrid format now prefers compact
CycleWays segment spans and uses exact base-edge spans only where the route is
outside a known CycleWays segment.

## Goal

Allow users to share any route the browser can create, including:

- routes fully on the CycleWays network
- routes that mix CycleWays and non-CycleWays base roads
- routes that are entirely outside the CycleWays network but still on the
  routable base graph
- routes with arbitrary user-selected waypoints snapped to road/path edges

The shared link should prefer exact visual replay when the current promoted
graph still contains the same base edges. If exact replay is no longer possible,
the app should fall back to recalculating from the user's anchored waypoints.

## Current Limitation

The current compact route format stores waypoint coordinates and optional
CycleWays segment hints. It does not store the hidden base edges that the route
actually traversed.

That makes the current format good at preserving route intent, but weak at
preserving the exact route line:

- a restored coordinate may snap to a different nearby edge
- intermediate shaping points may be compacted away
- routes outside CycleWays can have no useful segment identity
- graph edits can change the recomputed route even when the user expected the
  visible line to reopen

V4 should keep the compact intent behavior, but add enough base-graph identity
to replay the actual route when possible.

## Product Contract

The public map still shows CycleWays display data. The hidden base graph remains
an implementation layer.

Sharing a route means sharing a compact URL token. There is no routing API and
no external provider. Restore work happens in the browser by loading static
routing shards.

When opening a V4 route:

1. The app loads only the route-relevant shards listed in the URL.
2. The app tries to replay the exact stored base-edge sequence.
3. If replay succeeds, the visible route should match the shared route.
4. If replay fails because edges are missing or incompatible, the app
   recalculates from the stored waypoint anchors.
5. If recalculation succeeds but differs, the UI may show a concise "route
   updated from current map" message.
6. If the route URL is too long to share reliably, the share UI should warn or
   block copying instead of producing a fragile link.

When opening a V5 route:

1. The app loads the route-listed shards.
2. The app expands CycleWays spans from the public `cw-base-index.json` mapping.
3. Non-CycleWays spans are already stored as exact base-edge sequences.
4. The expanded route is replayed through the same V4 exact-replay path.
5. If expansion or replay fails, the app falls back to waypoint recalculation.

## Share Payload Model

V4 should store route-specific data only. It should not require the browser to
download a global edge-id dictionary.

The logical payload is:

```js
{
  version: 4,
  graphVersion: "...",
  points: [
    {
      lng,
      lat,
      edgeShareId,
      edgeFraction
    }
  ],
  shards: [
    { x: 710, y: 661 },
    { x: 710, y: 662 }
  ],
  legs: [
    {
      fromPoint: 0,
      toPoint: 1,
      edges: [1234, 1235, 1236],
      directions: [0, 0, 1]
    }
  ]
}
```

The URL should not contain this JSON. The implementation should encode the
payload as compact binary and then URL-safe text.

## V5 Hybrid Payload Model

V5 keeps the same point anchors and shard hints as V4, but replaces many
per-leg edge lists with compact spans:

```js
{
  version: 5,
  graphVersion: "...",
  points: [{ lng, lat, edgeShareId, edgeFraction }],
  shards: [{ x: 710, y: 661 }],
  spans: [
    { type: "cw", segmentId: 27, reversed: false },
    { type: "base", edges: [1234, 1235], directions: [0, 1] }
  ]
}
```

The `cw` span means "use the accepted CycleWays-to-base mapping for this
segment between the two adjacent point anchors." The `base` span is the V4-style
exact edge sequence used for roads, connectors, and any leg that cannot be
proven to be a contiguous CycleWays segment span.

The public app loads `public-data/cw-base-index.json`, a compact generated
index from CycleWays segment id to ordered base-edge share ids and directions.
This index is deliberately small: it contains no geometry and no editor review
metadata.

## Edge Share IDs

Runtime base edges currently have string IDs, for example:

- `e34354099_11` for an OSM way slice
- `manual-osm-164761007-mpd7wlqi` for an editor-created manual edge

V4 should introduce a stable integer `edgeShareId` for each promoted runtime
base edge.

The stable mapping from string edge id to integer share id is an authoring/build
artifact only. It should not be promoted as a public global lookup table.

Recommended source artifact:

```text
data/base-edge-share-ids.json
```

That file may grow with the base graph, but it is not loaded by normal users.
It exists so builds can keep existing integer IDs stable and append IDs for new
edges.

Rules:

- existing edge IDs keep their existing share ID
- new edge IDs receive new monotonically assigned share IDs
- removed or overridden edge IDs keep their reserved share ID and are not reused
- promoted shard edge records include `shareId`
- the public app resolves `shareId -> edge` only from shards it has loaded

This avoids a large public dictionary while keeping route URLs compact.

## Shard Hints

The decoder cannot know which shards contain a route from edge share IDs alone.
Therefore the route token should store all shard IDs needed by the route.

Shard IDs should be encoded as integers, not strings. The existing shard name
`g710_661` becomes:

```text
x = 710
y = 661
```

The compact binary encoder should sort shard cells and delta-encode them. That
keeps route-specific shard hints small while making restore deterministic.

Restore should load these listed shards first. It may also load shards around
waypoint coordinates as fallback coverage for old links, stale edges, or failed
exact replay.

## Route Points

Each user waypoint should store:

- longitude and latitude, delta-encoded like the current compact route format
- `edgeShareId` for the snapped base edge when available
- `edgeFraction` as a compact integer, for example `0..65535`

The coordinate remains useful even if the base edge disappears. The edge anchor
makes restore deterministic when the edge still exists.

The route should store user-created waypoints, not every coordinate along the
polyline. The full route line comes from the per-leg edge sequence.

## Leg Edge Sequence

Each leg should store the ordered traversed base edges and direction bits.

The sequence should include non-CycleWays edges as well as CycleWays edges. That
is what makes arbitrary routes outside the CycleWays network shareable.

Directions should be bit-packed:

- `0` = forward
- `1` = reverse

The first and last edge may be partial. The waypoint edge fractions describe
where the leg enters and leaves those edges.

## Exact Replay

Exact replay should be attempted before route recalculation.

Replay validation should check:

- every stored `edgeShareId` resolves from the loaded route shards
- the directed edge sequence is connected
- the first and last edges are compatible with the stored waypoint anchors
- the restored route uses the current edge geometry and elevation metadata

If replay succeeds, the app can assemble the route geometry and metrics from the
stored edges without running Dijkstra.

If replay fails, it should not make the link unusable. The app should fall back
to recalculating between anchored waypoints.

## Graph Version

The payload should carry a graph/build version or digest from the promoted map
manifest.

Version mismatch should not automatically block exact replay. The stricter
condition is whether the stored edges still exist and connect. The version is
mainly useful for diagnostics and for deciding whether to show a "route updated"
message after fallback.

## URL Length Budget

V4 should explicitly measure the final share URL length.

Initial thresholds:

```js
const ROUTE_SHARE_WARN_URL_LENGTH = 1800;
const ROUTE_SHARE_MAX_URL_LENGTH = 3500;
```

Behavior:

- below warning threshold: normal share
- between warning and max: allow copy with a warning that the link is long
- above max: disable or block link copying and show that the route is too long
  to share as a URL

The max should be conservative because browsers tolerate long URLs better than
some messaging apps, QR-code workflows, mobile share sheets, and crawlers.

Longer route sharing can be solved later with a route-file or saved-route
artifact. V4 should not add a server just to shorten URLs.

## Compatibility

The app should keep reading current route links.

Decoder behavior:

- V4: exact replay from route shards, then fallback recalculation from anchors
- V3 compact route: existing coordinate waypoint restore
- legacy segment route: existing segment-id restore path
- invalid token: fail safely with a user-visible route restore error

The V4 encoder should be used only when the active route has base-routing
diagnostics sufficient to write anchors and edge sequences. Otherwise it can
fall back to the current compact route format.

## Non-Goals

- Do not serve a global public `edgeId -> shareId` table.
- Do not introduce a routing API.
- Do not expose the hidden base graph as the normal public map.
- Do not guarantee exact replay after arbitrary destructive source edits.
- Do not solve very long route sharing beyond clear URL-length warnings.

## Open Questions

- Should the share-id registry be updated automatically by Build, or by an
  explicit editor action before Build?
- Should V4 exact replay be allowed when the graph version differs but all
  edges still resolve?
- Should the route panel distinguish "exact restored" from "recalculated from
  shared waypoints"?
- Should a future route export format store a larger immutable route artifact
  outside the URL?
