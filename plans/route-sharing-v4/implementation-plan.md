# Route Sharing V4 Implementation Plan

## Objective

Implement compact, shard-aware route sharing that supports arbitrary base-graph
routes without serving a global edge-id dictionary to normal users.

The first implementation should preserve existing V3 and legacy share links and
should not change the public visual model: users see the CycleWays network while
the browser uses hidden routing shards.

## Implementation Status

Implemented in this branch as the first end-to-end V4 route sharing slice:

- Build assigns stable integer `shareId` values to runtime base edges from the
  authoring-only registry path `data/base-edge-share-ids.json`.
- Compact routing shards embed `shareId` values, and the browser indexes
  `shareId -> edge` only from loaded shards.
- The route manager exposes base traversal diagnostics and can restore a V4
  payload by exact edge replay.
- The sharded route session loads route-listed shards before replay and falls
  back to waypoint recalculation if exact replay fails.
- The share modal reports long links and blocks copying links above the maximum
  URL length threshold.

## Guardrails

- Keep route restore local to the browser.
- Keep the global edge-share registry out of promoted public assets.
- Keep public shard loading route-specific.
- Preserve V3 compact route decoding.
- Warn or block when the final share URL is too long.
- Prefer exact replay, but always keep anchored-waypoint recalculation as
  fallback.

## Slice 1: Current Route Diagnostics Contract

- [ ] Confirm the route manager can expose the base-route traversals for each
  leg after a route is calculated.
- [ ] Extend route snapshots with enough internal diagnostics for sharing:
  waypoint base-edge anchors, per-leg edge IDs, directions, and route shard ids.
- [ ] Keep the public route state small; diagnostics can be kept in the route
  manager/session layer if they are not needed for rendering.
- [ ] Disable point-compaction for base-routed routes until equivalent
  base-edge traversal comparison exists.

### Tests

- [ ] Base-only route exposes traversed base edges and waypoint anchors.
- [ ] Mixed CycleWays/base route exposes both CycleWays and non-CycleWays edges.
- [ ] Current V3 sharing still works when base diagnostics are unavailable.

### Exit Criteria

- [ ] A calculated route has all data needed to write a V4 share token without
  re-running route search.

## Slice 2: Stable Edge Share IDs

- [ ] Add an authoring-only registry file, likely
  `data/base-edge-share-ids.json`.
- [ ] Add a deterministic registry updater that:
  - preserves existing IDs
  - appends IDs for new runtime base edge IDs
  - never reuses removed IDs
  - writes stable sorted output for reviewable diffs
- [ ] Decide whether the updater runs automatically from Build or from an
  explicit editor/build preparation action.
- [ ] Add `shareId` to runtime base-routing edge records during Build.
- [ ] Add `shareId` to compact `.cwb` shard encoding and decoding.
- [ ] Keep the registry out of `public-data/` and out of the map manifest.

### Tests

- [ ] Existing edge ID keeps its share ID across registry updates.
- [ ] New edge ID receives a new share ID.
- [ ] Removed edge ID is not reused.
- [ ] Manual edge IDs receive share IDs.
- [ ] `.cwb` shard round-trips `shareId`.
- [ ] Promoted public data does not include the global registry file.

### Exit Criteria

- [ ] Loaded shard edges contain stable integer `shareId` values, and normal app
  load does not fetch a global share-id table.

## Slice 3: V4 Binary Route Codec

- [ ] Add a V4 route payload encoder/decoder beside the existing route
  encoding code.
- [ ] Encode waypoint coordinates with integer deltas.
- [ ] Encode waypoint `edgeShareId` as varints.
- [ ] Encode waypoint `edgeFraction` as a compact integer, initially `0..65535`.
- [ ] Encode shard hints as sorted grid cells with integer delta encoding.
- [ ] Encode per-leg edge share IDs as varints.
- [ ] Encode per-leg directions as packed bits.
- [ ] Include a compact graph/build version or digest field.
- [ ] Keep the URL text form compatible with the existing `route=` parameter.

### Tests

- [ ] Round-trip a one-leg route.
- [ ] Round-trip a multi-leg route.
- [ ] Round-trip route shards encoded as integer grid cells.
- [ ] Round-trip forward and reverse directions.
- [ ] Reject malformed V4 payloads safely.
- [ ] Existing V3 and legacy payload tests still pass.

### Exit Criteria

- [ ] The app can encode and decode the full logical V4 payload without touching
  the map or route manager.

## Slice 4: Share URL Status

- [ ] Add share URL length measurement after the final URL is built.
- [ ] Add route share status:
  - `ok`
  - `long`
  - `too_long`
- [ ] Use initial thresholds:
  - warning at `1800` characters
  - block at `3500` characters
- [ ] Show a concise warning in the share/download UI for long URLs.
- [ ] Disable or block copy for URLs above the max threshold.
- [ ] Keep copy behavior unchanged for normal-length routes.

### Tests

- [ ] Normal route share URL remains copyable.
- [ ] Long route exposes warning state.
- [ ] Too-long route disables or blocks copy.
- [ ] Threshold calculation uses final URL length, not raw token length.

### Exit Criteria

- [ ] Users do not receive route URLs that the app already knows are too long to
  share reliably.

## Slice 5: Exact Replay Restore

- [ ] Teach the sharded route session to recognize V4 payloads.
- [ ] Load all shard hints from the route before exact replay.
- [ ] Build a local `shareId -> edge` map from loaded shards only.
- [ ] Validate that each stored edge exists and the directed sequence connects.
- [ ] Restore route geometry, distance, elevation, and CycleWays segment
  summaries from the stored edge sequence.
- [ ] Reuse current edge geometry and elevation values from loaded shards.
- [ ] Preserve route markers at the stored waypoint anchors.

### Tests

- [ ] Exact replay of a route fully outside CycleWays.
- [ ] Exact replay of a mixed CycleWays/base route.
- [ ] Exact replay across multiple shards.
- [ ] Replay fails safely when an edge share ID is missing.
- [ ] Replay fails safely when stored edges are disconnected.

### Exit Criteria

- [ ] A valid V4 route can reopen to the same base-edge path without running a
  fresh shortest-path search.

## Slice 6: Fallback Recalculation

- [ ] If exact replay fails, load shards around waypoint coordinates as the
  current restore path does.
- [ ] Prefer waypoint `edgeShareId` + fraction for snapping when the edge is
  loaded.
- [ ] Fall back to coordinate snapping when the stored edge is missing.
- [ ] Recalculate the route with the current router.
- [ ] Surface a concise "route updated from current map" message when fallback
  succeeds after exact replay failure.
- [ ] Surface a restore failure only when both exact replay and recalculation
  fail.

### Tests

- [ ] Missing edge falls back to coordinate snapping.
- [ ] Stale graph version with existing edges still exact-replays.
- [ ] Stale graph version with missing edges recalculates.
- [ ] Recalculated fallback route remains shareable.

### Exit Criteria

- [ ] Old shared V4 routes remain useful when the graph evolves, even if exact
  replay cannot be preserved.

## Slice 7: Build And Promote Integration

- [ ] Ensure Build fails or clearly reports when route-share IDs are missing
  from runtime base edges.
- [ ] Ensure Promote copies only public shard files and manifest data, not the
  global registry.
- [ ] Add manifest metadata identifying the route share edge-id schema version.
- [ ] Update build reports with share-id counts:
  - runtime edges
  - edges with share IDs
  - new IDs assigned
  - retired IDs retained in registry
- [ ] Document the registry update step in the editor/build docs.

### Tests

- [ ] Build includes `shareId` in shard edges.
- [ ] Promote excludes `data/base-edge-share-ids.json`.
- [ ] Build report detects missing share IDs.
- [ ] Build output remains deterministic when no base edges changed.

### Exit Criteria

- [ ] A normal promoted site has everything needed for V4 route restore without
  serving the registry file.

## Slice 8: UI And Compatibility Polish

- [ ] Keep old shared route URLs working.
- [ ] Prefer V4 for routes with complete base diagnostics.
- [ ] Fall back to V3 for routes without base diagnostics.
- [ ] Show route share status in the existing share modal without adding a new
  large UI surface.
- [ ] Add console/debug diagnostics for V4 restore mode:
  - exact replay
  - fallback recalculation
  - failed restore
  - loaded shard count

### Tests

- [ ] Existing compact route links restore.
- [ ] Legacy segment route links restore.
- [ ] V4 share link restores after page refresh.
- [ ] Route outside CycleWays can be shared and restored.
- [ ] Too-long route cannot be copied as a normal share URL.

### Exit Criteria

- [ ] V4 is the default for normal base-routed shares, while all existing share
  paths remain readable.

## Suggested First Delivery

The first implementation slice should be intentionally narrow:

1. Add stable `shareId` to base-routing shard edges from an authoring-only
   registry.
2. Expose current route traversals and shard IDs from the route manager/session.
3. Add a V4 encoder/decoder test that round-trips a synthetic route with
   waypoints, shards, edge share IDs, and directions.
4. Add URL length status to share URL creation.

Exact replay restore can follow once the encoded payload and promoted shard
identity are stable.

## Validation Matrix

| Case | Expected Result |
| --- | --- |
| CycleWays-only route | V4 stores base edges and restores exact path |
| Mixed route | V4 includes CycleWays and non-CycleWays base edges |
| Route outside CycleWays | V4 shares and restores without segment IDs |
| Route crosses shards | URL lists needed shard cells and restore loads them |
| Edge still exists after edit | Exact replay uses current edge geometry |
| Edge missing after edit | Restore recalculates from waypoint anchors |
| Long route URL | Share UI warns |
| Too-long route URL | Share UI blocks copy |
| Old V3 URL | Existing restore behavior continues |
