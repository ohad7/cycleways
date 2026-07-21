# OSM Base Network For Navigation Implementation Plan

## Status

Preparation checkpoint implemented on `codex/osm-network-integration`.

The branch establishes a static OSM/manual base graph and a reviewed CycleWays
overlay. It does not yet route public waypoints through that graph.

## Implemented Work

### Area And OSM Acquisition

- [x] Add `data/osm-target-area.geojson` for the bounded northern routing study
  area.
- [x] Expand the study polygon through the Golan Heights, Mount Hermon, and the
  eastern target boundary near Syria.
- [x] Add an Overpass fetcher for OSM highway ways in the target area.
- [x] Keep cycleways, paths, tracks, local roads, and major car roads in the
  downloaded base-network candidate set.
- [x] Write raw OSM ways, summaries, generated Overpass query text, and raw
  response artifacts under `build/osm/`.

### OSM Graph Preparation

- [x] Add naive OSM intersection detection for visual validation.
- [x] Render detected intersections for inspection in OSM debug mode.
- [x] Build graph nodes and atomic graph edges from raw OSM ways.
- [x] Split OSM ways at endpoints, shared vertices, detected intersections, and
  calculated crossings.
- [x] Emit graph JSON plus edge, node, and graph summary GeoJSON/JSON outputs.
- [x] Fold editor-authored manual base edges into graph generation.
- [x] Treat a copied manual base edge as an override of its original generated
  OSM edge.

### CycleWays Matching

- [x] Add first-pass matcher from active CycleWays source geometry to generated
  OSM/manual base graph edges.
- [x] Match using sampled CycleWays points, nearby edge geometry, and direction
  scoring.
- [x] Collapse sample matches into edge sequences.
- [x] Insert short graph connector paths when sampled matches leave a small
  graph-continuity gap that can be bridged.
- [x] Emit match preview geometry, per-segment summaries, and aggregate match
  summary artifacts.
- [x] Classify review cases including accepted, missing base edge, partial gap,
  overmatched edge sequence, disconnected edges, matcher failure, and manual
  review.
- [x] Emit diagnostics for gaps, sample mismatches, edge support, long boundary
  overmatches, and continuity gaps.

### Public Debug View

- [x] Add `?osm=1` debug loading to the React app.
- [x] Show raw OSM ways separately from the normal CycleWays network.
- [x] Add hover and detail inspection for raw OSM ways.
- [x] Add intersection dots and intersection detail inspection.
- [x] Add a generated graph view with edge and node layers.
- [x] Add `osmLayer=graph` switching between raw OSM ways and generated graph
  edges.
- [x] Add CycleWays match preview/review layers for visual inspection.

### Editor Workspaces

- [x] Split authoring into Segments, Base Graph, and CW Overlay workspaces.
- [x] Keep canonical CycleWays source geometry edits in Segments mode.
- [x] Add Base Graph mode for manual graph corrections.
- [x] Keep generated OSM graph edges read-only in Base Graph mode.
- [x] Support new manual edges, editable copies of OSM edges, manual edge vertex
  editing, insertion, deletion, splitting, and graph recalculation.
- [x] Store manual graph corrections in `data/manual-base-edges.geojson`.
- [x] Add CW Overlay mode for choosing and reviewing base graph edges per
  CycleWays segment.
- [x] Store reviewed mappings in `data/cw-base-overlay.json`.
- [x] Support per-segment recalculate, clear, accept, edge removal, and edge
  hover inspection.
- [x] Support bulk accept for full high-confidence auto matches.
- [x] Add boundary snap as an explicit reviewed action when CycleWays geometry
  should align to existing base edges.
- [x] Show accepted mapped CW overlay edge refs as a whole clickable network in
  CW Overlay mode.

### Review Flow And Productivity

- [x] Add review counts and a scrollable unresolved segment list.
- [x] Surface missing, gap, overmatch, continuity, duplicate, stale, pending,
  and review states.
- [x] Add red unresolved highlighting in Segments mode.
- [x] Show the base graph read-only under unresolved Segment review.
- [x] Queue changed CycleWays segments after source geometry edits.
- [x] Add queue actions to clear, recalculate, and auto-accept changed segments
  when the new match qualifies.
- [x] Refresh unresolved highlighting after queue processing.
- [x] Add geometry editing shortcuts and interaction improvements used during
  review, including fast vertex deletion and fast vertex snapping.
- [x] Disable automatic editor server and browser reload loops by default so
  long map editing sessions are stable.

### Validation And Regressions

- [x] Require saved overlay edge refs to point at current base graph edges.
- [x] Detect saved overlay continuity gaps.
- [x] Detect duplicate accepted base edge ownership across active CycleWays
  mappings.
- [x] Avoid treating inactive or deprecated CycleWays segments as ownership
  conflicts.
- [x] Detect overmatched terminal or low-support boundary edges before automatic
  acceptance.
- [x] Prevent graph-wide unresolved churn after a localized base edge edit by
  reporting stale state per affected mapping and through validation status.
- [x] Add matcher regression tests for continuity holes, overmatched terminal
  edges, deprecated segment ownership, and copied manual edge override behavior.

## Data And Artifact Inventory

### Source-Controlled Authoring Inputs

- `data/osm-target-area.geojson`
  - bounded OSM fetch polygon
- `data/manual-base-edges.geojson`
  - manual and edited base graph edge corrections
- `data/cw-base-overlay.json`
  - reviewed CycleWays segment to base edge mappings
- `data/map-source.geojson`
  - canonical CycleWays source geometry still used during the preparation phase

### Generated OSM Artifacts

Run the full exploration and matching pipeline with:

```bash
npm run osm:fetch
```

That command runs fetch, intersections, graph generation, and CycleWays
matching. It writes:

- `build/osm/osm-raw-ways.geojson`
- `build/osm/osm-summary.json`
- `build/osm/osm-intersections.geojson`
- `build/osm/osm-intersections-summary.json`
- `build/osm/osm-base-graph.json`
- `build/osm/osm-base-nodes.geojson`
- `build/osm/osm-base-edges.geojson`
- `build/osm/osm-base-graph-summary.json`
- `build/osm/cw-osm-match-preview.geojson`
- `build/osm/cw-osm-match-summary.json`
- `build/osm/cw-osm-matches.json`
- `build/osm/overpass-query.ql`
- `build/osm/overpass-response.json`

Useful partial rebuild commands:

```bash
npm run osm:intersections
npm run osm:topology
npm run osm:graph
npm run osm:match
```

`npm run osm:topology` rebuilds only graph artifacts from existing OSM,
intersection, manual-edge, and traversal-override data. The local editor uses
this faster path after manual base-edge edits. `npm run osm:graph` additionally
rebuilds all CW match artifacts for explicit diagnostics.

## Implemented Data Contract

### Base Graph Edges

Generated base edge features carry enough topology and provenance for matching
and later routing:

- `edgeId`
- `fromNodeId`
- `toNodeId`
- `distanceMeters`
- `source` as `osm` or `manual`
- OSM way provenance or manual edge provenance

### Overlay Mappings

Saved overlay mappings currently use:

- status `accepted_auto_match` for accepted edge sets
- status `needs_edit` for a reviewed edge draft that is not accepted yet
- status `manual_base_edge_needed` for older unresolved manual-edge markers
- ordered `edgeRefs` with `sequenceIndex`, direction, edge id, source, and
  fraction fields

The authoring workflow now treats accepted reviewed edge sets as the intended
state. The old generic manual marker is retained in the data contract, but the
productive flow is to edit the base graph and then save concrete edge refs.

## Current Review Workflow

1. Rebuild or load the OSM/manual base graph.
2. Open Segments mode and use unresolved highlighting to find source geometry
   that still does not map cleanly.
3. If the base graph is wrong or missing a route, use Base Graph mode to create
   or edit manual base edges, then recalculate graph and matches.
4. If CycleWays source geometry should align to an existing base edge, edit or
   snap it in Segments or CW Overlay review.
5. In CW Overlay mode, recalculate the selected segment, review the matched edge
   sequence, remove wrong edge refs if needed, and accept the saved edge set.
6. Keep accepted mappings continuous and exclusive by resolving validation
   warnings before treating them as navigation-ready.

## Verification In The Branch

Automated coverage added for matcher regressions is in
`tests/test_osm_matcher.py`.

The OSM tests are available through:

```bash
npm run test:osm
```

The general project test script now includes those OSM matcher tests before the
existing JavaScript routing tests.

## Next Slice: Hidden Base Graph Routing

### Objective

Replace CW-only route calculation with routing over a promoted OSM/manual base
graph while keeping the public map visually centered on the CycleWays network.

The next slice includes build and promote work because the public router must
consume published runtime assets, not editor/debug files under `build/osm/`.

### User-Facing Scope

- [ ] Keep the visible CycleWays network as the route-building network on the
  public map.
- [ ] Keep the current waypoint click flow as the public interaction shape.
- [ ] Accept clicks only when they are within a configurable snap threshold of
  an eligible hidden base graph edge.
- [ ] Reject far-from-graph clicks with a clear route message.
- [ ] Render base-graph route geometry through the existing route line without
  rendering the full base graph to ordinary users.

### Runtime Routing Asset

- [ ] Define the runtime base-routing asset contract.
- [ ] Include base graph topology, edge geometry, edge lengths, edge
  classification/cost inputs, and accepted CycleWays overlay membership.
- [ ] Exclude raw Overpass payloads, match-preview diagnostics, unresolved
  review lists, and editor-only state from the public routing asset.
- [ ] Decide whether the asset stores adjacency directly or stores edge/node
  records that the app indexes on load.
- [ ] Add a content-versioned routing artifact to generated build output.

### Build Integration

- [ ] Extend the build pipeline to derive the runtime routing artifact from the
  current OSM/manual base graph and accepted CW overlay mappings.
- [ ] Add build report entries for routing asset generation and routing data
  validation.
- [ ] Fail routing asset generation when required base graph artifacts are
  missing or stale for the inputs used to build the public asset.
- [ ] Fail on accepted overlay edge refs that no longer resolve to current base
  graph edges.
- [ ] Fail on accepted overlay continuity gaps and duplicate accepted edge
  ownership.
- [ ] Report unresolved CycleWays overlay segments separately from build-blocking
  accepted-overlay invalidity.

### Promote Integration

- [ ] Extend `map-manifest.json` with the versioned base-routing asset path.
- [ ] Promote the versioned routing artifact with the current public map assets.
- [ ] Refuse Promote when the routing asset is missing or stale relative to the
  build inputs.
- [ ] Clean older promoted routing artifact versions using the same pattern as
  older promoted `bike_roads`, `segments`, and KML versions.
- [ ] Keep local fallback behavior explicit if the manifest or routing asset is
  absent during development.

### Public Asset Loading

- [ ] Load the routing artifact through the promoted manifest with the rest of
  the public map assets.
- [ ] Keep editor graph/review endpoints out of the normal public route path.
- [ ] Build runtime indexes for edge lookup, edge geometry, graph adjacency,
  and CycleWays edge membership.

### Snapping And Endpoints

- [ ] Add nearest-base-edge snapping for waypoint clicks.
- [ ] Store raw click coordinate, snapped coordinate, base edge id, and
  position along the snapped edge.
- [ ] Reject clicks outside the snap threshold instead of drawing off-road
  connectors.
- [ ] Support virtual route endpoints for snaps that land midway along edges.
- [ ] Clip first and last route geometry to those snapped edge positions.

### Base Graph Search

- [ ] Add first-pass route search over the hidden base graph.
- [ ] Start with a simple inspectable shortest-path cost model.
- [ ] Prefer accepted CycleWays-owned edges.
- [ ] Allow non-CycleWays path, track, cycle, and local-road edges with a
  penalty.
- [ ] Allow larger road edges with a stronger penalty until the later safety
  policy decides whether any classes should be excluded.
- [ ] Return ordered edge traversal, direction, assembled geometry, distance,
  weighted cost, CycleWays distance, non-CycleWays distance, and no-route
  diagnostics.

### Waypoint Integration

- [ ] Route consecutive waypoints through the base graph router.
- [ ] Preserve the one-waypoint marker-only behavior.
- [ ] Preserve draggable/editable route point behavior where the new snapping
  contract supports it.
- [ ] Keep existing route-facing UI stable while deferring richer public
  off-CycleWays explanation.

### Overlay-Derived Public CycleWays Geometry

- [x] Assemble accepted active CycleWays segment geometry from each mapping's
  ordered, directed base edge refs during Build.
- [x] Keep the public map rendering the CycleWays GeoJSON output instead of
  exposing the full base graph as a visible user layer.
- [x] Preserve existing public CycleWays feature properties while replacing only
  accepted segment geometry.
- [x] Drape processed source elevation onto accepted base-edge display
  coordinates so current segment detail metrics keep an elevation path.
- [x] Keep processed source geometry as a Build fallback for unresolved active
  segments during migration.
- [x] Record accepted-derived and source-fallback display counts in build
  validation/report output.
- [x] Keep source-derived KML and source-derived metadata/elevation metrics for
  this slice; move those only with an explicit graph-elevation design.
- [x] Add build tests for edge direction, coordinate stitching, source fallback,
  and report counts for public display geometry derivation.

### Base Graph Elevation Sampling Lab

- [x] Add a standalone processor that reports graph-wide candidate sample
  counts without changing promoted map artifacts.
- [x] Sample selected preview base edges at configurable spacings while
  preserving original edge vertices.
- [x] Add optional batched preview-edge elevation lookup with a dedicated
  persistent cache.
- [x] Simplify sampled elevation profiles with vertical-error tolerance and
  retained-gap anchors.
- [x] Emit JSON report and GeoJSON preview artifacts for comparing candidate
  spacings.
- [x] Run representative preview edges from flat valley, Golan climb, and
  Hermon terrain through the lab before choosing the elevated graph contract.
- [x] Decide whether the elevated graph stores densified 3D coordinates,
  compact offset/elevation profiles, or both.

### Elevated Base Graph Artifact

- [x] Add a graph-side elevated artifact processor that reads the current
  generated OSM/manual graph without changing public routing assets.
- [x] Sample every candidate edge at the current `10m` working spacing and
  reuse the elevation lab cache/fetch client.
- [x] Preserve 2D edge geometry and attach compact
  `[offsetMeters,elevationMeters]` profiles plus edge gain/loss/net metrics.
- [x] Record the source 2D graph digest and profile policy in elevated graph
  metadata.
- [x] Emit a build report with profile coverage, cache/fetch stats, missing
  edge examples, profile retention size, and metric distributions.
- [x] Add diagnostics-only adjacent-sample and fixed-window sustained-grade
  comparisons to the elevated graph report before routing consumes grade.
- [x] Compare aggregate edge grade candidates with fixed-window grade stitched
  across unambiguous degree-2 graph chains.
- [x] Inspect a full elevated build before routing or public elevation views
  consume the artifact.
- [ ] Define smoothing and sustained-grade metrics before routing costs depend
  on local grade.

### Directional Elevation Routing

- [x] Make Build consume the elevated base graph by default and reject source
  digest drift against the current generated 2D graph.
- [x] Keep the runtime routing asset compact by publishing endpoint elevation
  and net edge change instead of graph elevation profiles.
- [x] Add an uphill-only directional net-climb cost term for full and clipped
  base-edge traversals.
- [x] Interpolate runtime edge endpoint elevation onto routed base-edge geometry
  so the existing route elevation chart can render graph-derived routes.
- [x] Expose base-route cost decomposition, directional gain/loss totals, and a
  manifest-backed route inspector for elevation cost tuning.
- [x] Cover a flatter detour winning over a short climb in runtime route tests.

### Tests

- [ ] Add build tests for routing asset generation and manifest entries.
- [ ] Add promote tests for routing artifact copy, stale checks, and cleanup.
- [ ] Add snap tests for near-edge acceptance and far-from-graph rejection.
- [ ] Add same-edge mid-edge route clipping tests.
- [ ] Add route-search tests for disconnected graph failures.
- [ ] Add route-search tests where a non-CycleWays connector is required for
  reachability.
- [ ] Add route-search tests where CycleWays preference wins over a comparable
  non-CycleWays alternative.
- [ ] Add asset-loading tests so public routing does not depend on editor/debug
  graph files.

### Acceptance Criteria

- [ ] Build emits a runtime base-routing asset for the current promoted map data
  path.
- [ ] Promote publishes a versioned routing asset and adds it to the manifest.
- [ ] The public app loads that promoted routing asset for routing.
- [ ] The visible public network remains the CycleWays network.
- [ ] Two accepted clicks near base graph edges can produce a route through the
  hidden graph.
- [ ] Clicks far from every eligible base graph edge are rejected clearly.
- [ ] Route search prefers CycleWays overlay edges and can leave them when the
  hidden base graph is needed for reachability.
- [ ] Mid-edge route endpoints render clipped geometry from the snapped
  positions.
- [ ] Accepted-overlay graph integrity failures block routing asset promotion.
- [x] Accepted CycleWays lines in promoted public GeoJSON use the same directed
  base edge geometry that the overlay selects for routing preference.

## Deferred After The Next Slice

- [ ] Tune the final road safety, access, and preference policy beyond the first
  inspectable cost model.
- [ ] Design richer public explanation for off-CycleWays route portions if the
  first integration shows that users need it.
- [ ] Decide how route sharing, GPX/export, and elevation summaries change when
  route geometry is assembled from base graph edges.
- [ ] Define refresh behavior when the OSM fetch polygon or upstream OSM data
  changes.
