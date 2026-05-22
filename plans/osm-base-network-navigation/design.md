# OSM Base Network For Navigation Design

## Status

This plan documents the preparation phase implemented on
`codex/osm-network-integration`.

It changes the Phase 2 direction of waypoint routing. The current direction is
to build an internal static base graph from OSM and author the CycleWays network
as a reviewed overlay on top of that graph. It does not start by routing
off-network legs through an external provider.

## Goal

Prepare a graph that can become the navigation substrate for later waypoint
routing:

1. Acquire the relevant road and path network from OSM for the target area.
2. Turn the OSM ways into inspectable routing nodes and edges.
3. Allow the base graph to be corrected with manual edges where OSM is missing
   or unsuitable.
4. Represent each CycleWays segment as reviewed base graph edge references.
5. Validate that the reviewed overlay is continuous and has exclusive base edge
   ownership before using it for navigation.

## Product Decision

The route network has two layers.

The base layer is the general navigable map:

- statically fetched from OSM for the target area
- includes paths, tracks, local streets, and major car roads
- can be extended with editor-authored manual base edges
- owns graph topology for later pathfinding

The CycleWays layer is editorial metadata on top of that base layer:

- a base edge may be part of the CycleWays network or not
- CycleWays membership is represented by overlay mappings from CycleWays
  segments to base graph edges
- CycleWays quality, preference, warnings, names, and road type remain overlay
  concerns
- a missing OSM route is added to the base graph first, then selected into the
  CycleWays overlay

Including car roads in the base graph is intentional. A road may be unsafe or
undesirable for cycling, but it still has to exist in the map if routing needs
to reason about reachability, fallback paths, or penalties later.

## Public CycleWays Display Geometry

The public map should continue to show the CycleWays network, not the full base
graph. Once a CycleWays segment has an accepted overlay mapping, however, the
line that represents that segment should be assembled from the mapped base
edges instead of continuing to draw the older source geometry.

That keeps three public surfaces aligned:

- the CycleWays line the rider sees
- the hidden base edge used when a waypoint snaps near that line
- the base edge sequence preferred by graph routing

The source CycleWays geometry remains valuable. It is still the editable
authoring shape in Segments mode, a matching input when the overlay needs to be
recalculated, and a fallback while segments are still unresolved. It is no
longer the preferred promoted display shape for an accepted overlay segment.

The display shape is derived during Build, not in the browser. Build already
has the reviewed overlay and current base graph required to validate edge
references, edge direction, continuity, and exclusive ownership. The browser
should keep loading a simple CycleWays GeoJSON feature collection whose segment
properties match the existing public UI.

During migration:

- accepted active overlay mappings produce public feature geometry from ordered
  base edges
- unresolved active segments retain their processed source feature geometry so
  editor review can continue without making public Build impossible
- accepted display geometry uses base-edge longitude/latitude and drapes
  processed source elevation onto that path so current segment detail surfaces
  do not lose elevation immediately
- source-derived segment metadata and elevation metrics stay source-based until
  route elevation is deliberately moved onto graph-derived geometry
- KML export stays source-derived for this slice; the first consumer of derived
  display geometry is the public `bike_roads` GeoJSON

The long-term data model remains stricter: a promoted CycleWays segment should
eventually be a metadata record over accepted base edges, and public output
should not need a geometry fallback once the overlay review process covers all
active segments.

## Base Graph Elevation Study

Elevation should move onto the base graph before route elevation, public
elevation profiles, or later climb-aware routing treat the graph as
authoritative. Existing OSM/manual edge coordinates describe line shape, not a
sampling guarantee. The current graph therefore needs a measured sampling
policy before an elevated graph artifact is promoted.

The first elevation step is a lab stage, not a public build migration:

- report graph-wide sample occurrence counts for candidate spacings
- preview selected edges at those spacings
- optionally query preview samples from the local elevation service in batches
  with a dedicated cache
- simplify distance-along-edge versus elevation profiles with configurable
  vertical error and retained-gap bounds
- compare profile retention and gain/loss behavior before choosing the final
  graph elevation contract

This stage keeps two inputs separate:

- base edge longitude/latitude shape from OSM/manual graph generation
- elevation samples collected along that shape at a chosen spacing policy

The likely elevated graph artifact will preserve base graph node and edge ids,
add elevation to the authoritative graph coordinates/profile, and record the
source graph digest. The lab exists to decide whether existing geometry,
densified coordinates, or a compact sampled profile should carry that elevation
data.

The first buildable elevation artifact uses the compact profile option:

- the 2D OSM/manual graph topology and edge coordinates stay unchanged
- every edge is sampled along that geometry at the current `10m` working policy
- each complete edge stores an offset/elevation profile as
  `[offsetMeters, elevationMeters]` pairs after vertical-error simplification
- gain, loss, and net change metrics are derived from the unsimplified sampled
  profile, so inspection can compare compact storage with acquisition quality
- build metadata records the source 2D graph digest and profile policy
- a separate report exposes coverage, cache/fetch counters, retained profile
  size, missing edge examples, graph-wide metric distributions, and sustained
  grade diagnostics over fixed distance windows

This artifact is still a validation input, not the public routing asset. Grade
penalties and public elevation profile migration remain blocked on a deliberate
smoothing and routing-grade policy. The first report diagnostics keep adjacent
sample grade spikes visible, but compare them with fixed `25m`, `50m`, and
`100m` grade windows so the routing metric can be chosen from real data.

The first full current-graph build covered all `48,352` OSM/manual edges. At
`10m` acquisition spacing it sampled `1,249,789` edge-coordinate occurrences
and retained `639,136` compact profile points. The grade diagnostics confirmed
that adjacent sampled-point grade is not suitable for routing as-is: its p95
edge maximum is `3.849` grade ratio and the worst edge spike is `446.8085`.
Fixed distance windows reduce those spikes materially, which is why the next
policy decision should choose a sustained-grade or smoothed profile basis before
grade affects path cost.

The next diagnostics compare three routing-policy candidates without choosing a
path cost yet:

- average absolute edge net grade, which is stable and cheap but can hide a
  short steep part inside a long edge
- sampled gain/loss per edge distance, which can express climb work but still
  needs a noise policy
- fixed `25m`, `50m`, and `100m` sustained windows stitched across base graph
  chains only where a degree-2 node makes the continuation unambiguous

Stitching is intentionally conservative. At junctions the useful sustained
window depends on the eventual routed path, so diagnostics should not invent a
preferred continuation before the router exists.

On the current graph, conservative degree-2 stitching does not materially
change the fixed-window distributions. It forms `45,511` chains from `48,352`
edges, with one edge at the median and two edges at p95. That means a
precomputed sustained-grade penalty cannot rely on degree-2 stitching to solve
short graph edges. A path-aware sustained-grade metric should be computed after
route assembly, while the routing cost starts from directional edge metrics that
remain meaningful at junctions.

The first runtime elevation cost uses that narrower contract:

- Build reads the elevated base graph and validates its recorded 2D source
  digest against the current generated base graph
- the public base-routing asset carries only edge endpoint elevation and net
  edge elevation change, not the compact graph elevation profile
- each traversal uses directional net climb, so reversing an edge reverses the
  uphill cost input
- partial start/end edge traversals scale the edge net change by traversed edge
  fraction
- the cost model adds an uphill-only `8` weighted meters per meter of net climb
  on top of the existing CycleWays and road-class distance weighting

This deliberately does not reward descent or apply local grade spikes. It is a
first inspectable routing preference from stable directional edge data while
route elevation profiles and path-aware sustained grade stay separate.

## Scope Of This Phase

This branch prepares authoring data and graph artifacts. It does not yet replace
the public route manager with a router over the new base graph.

In scope:

- target-area OSM fetch
- OSM way inspection and intersection diagnostics
- OSM/manual graph generation
- CycleWays-to-base-graph matching diagnostics
- editor tools for manual base graph correction and overlay review
- overlay validation for ownership, stale references, edge support, and
  continuity
- reviewed overlay data for the current CycleWays network

Out of scope:

- runtime shortest-path or weighted bicycle routing over the new graph
- production graph packaging and versioning for the public app
- final bike preference/cost model
- migration of public route state from source CycleWays geometries to overlay
  edge sequences
- automatic reconciliation when upstream OSM changes

## Target Area

The fetch uses `data/osm-target-area.geojson` as the explicit study polygon.
The polygon was expanded during the exploration to cover the existing northern
CycleWays area plus the Golan Heights, Mount Hermon, and the eastern target
boundary near the Syrian border.

The explicit polygon matters for two reasons:

- it keeps the OSM graph bounded to the navigation area being evaluated
- it can be extended deliberately as the map grows instead of changing graph
  coverage as a side effect of current CycleWays segment bounds

If the polygon is absent, the fetch script can fall back to CycleWays source
bounds with a small buffer. That fallback is for exploration, not the preferred
authoring contract.

## Pipeline Design

### 1. Fetch OSM Ways

`processing/fetch_osm_network.py` queries Overpass for OSM `highway` ways in
the target area and writes the raw downloaded network as debug artifacts.

The fetch keeps OSM way geometry and useful tags intact enough for inspection.
Ways are classified for display into cycle, path/track, local road, road, and
other buckets. Access hints are preserved for later policy work, but this phase
does not remove a way merely because it is a car road.

Primary outputs:

- `build/osm/osm-raw-ways.geojson`
- `build/osm/osm-summary.json`
- `build/osm/overpass-query.ql`
- `build/osm/overpass-response.json`

### 2. Detect Intersections

`processing/detect_osm_intersections.py` produces a naive intersection debug
layer from the raw ways.

This stage was added to test whether static OSM geometry exposes enough split
locations for a usable graph. The debug layer makes calculated crossings and
OSM way intersections visible on the map before relying on them for graph
construction.

Primary outputs:

- `build/osm/osm-intersections.geojson`
- `build/osm/osm-intersections-summary.json`

### 3. Build The Base Graph

`processing/build_osm_base_graph.py` converts raw OSM ways into nodes and
atomic graph edges.

The graph builder:

- splits OSM ways at endpoints
- splits at shared OSM vertices
- splits at detected intersections and calculated crossings
- merges nearby graph nodes within a small tolerance
- skips degenerate short edges
- appends active manual base edges from `data/manual-base-edges.geojson`
- suppresses an original OSM edge when an edited manual copy declares that it
  replaces the copied edge

The last point is important. Copying an OSM edge into the editor is an override
workflow, not a duplicate-edge workflow. The edited manual edge must be the edge
the matcher and future router see.

Primary outputs:

- `build/osm/osm-base-graph.json`
- `build/osm/osm-base-nodes.geojson`
- `build/osm/osm-base-edges.geojson`
- `build/osm/osm-base-graph-summary.json`

### 4. Match CycleWays Segments To Base Edges

`processing/match_cycleways_to_osm_graph.py` computes a preview match from each
active CycleWays source segment to nearby base graph edges.

The matcher samples the CycleWays geometry, searches nearby base edge geometry,
uses direction as a scoring signal, collapses sample matches into an ordered
edge sequence, and can bridge a short connector path through the graph when two
sample-supported edges are close but not directly consecutive in the sampled
sequence.

The matcher is diagnostic. Its output is reviewed and saved into overlay data
through the editor. It does not mutate the canonical CycleWays source.

The matcher records:

- coverage ratio and distance diagnostics
- matched edge sequence and direction
- unmatched gaps and unmatched or distant sample points
- continuity gaps between chosen edges
- suspicious boundary or long-edge overmatches
- a review classification such as accepted, partial gap, missing base edge,
  disconnected edges, or overmatched edge

Primary outputs:

- `build/osm/cw-osm-match-preview.geojson`
- `build/osm/cw-osm-match-summary.json`
- `build/osm/cw-osm-matches.json`

## Authoring Data Contract

### Manual Base Edges

`data/manual-base-edges.geojson` stores graph corrections separately from the
canonical CycleWays segment geometry.

A manual edge is a GeoJSON LineString with a stable `manualEdgeId`. It may be:

- a new graph edge for a route missing in OSM
- an editable copy of a generated OSM edge
- a split or reshaped manual edge

Copied manual edges retain provenance such as `copiedFromEdgeId` and
`copiedFromOsmWayId`. New manual edges may retain a linked CycleWays segment id
and name for authoring context, but they remain base graph edges.

### CycleWays Base Overlay

`data/cw-base-overlay.json` stores reviewed mappings from current CycleWays
segments to base graph edges.

Each mapping is keyed by CycleWays segment id and stores:

- `segmentId` and segment name snapshot
- review status and match diagnostics
- ordered `edgeRefs`
- the edge source and provenance fields needed to identify OSM or manual edges

An edge ref currently identifies a whole generated base edge:

```json
{
  "edgeId": "e34354099_2",
  "source": "osm",
  "direction": "reverse",
  "sequenceIndex": 0,
  "fromFraction": 0,
  "toFraction": 1,
  "osmWayId": 34354099
}
```

`fromFraction` and `toFraction` are present in the schema, but the reviewed
workflow in this phase aims to end with full base-edge membership. When a
CycleWays boundary cuts through a long graph edge, the preferred authoring
answer is to correct geometry, split or override the base graph edge when
needed, then map whole edges.

## Editor Model

The editor now has three workspaces.

### Segments

This is the canonical CycleWays geometry workspace. It keeps the previous
segment editing flow and adds overlay-aware review support:

- unresolved CycleWays segments can be highlighted in red
- the base graph can be shown read-only under unresolved CycleWays segments
- changed CycleWays segment ids are queued after geometry edits
- the queue can clear, recalculate, and auto-accept changed segments when the
  new match is eligible

### Base Graph

This workspace edits the underlying graph correction layer.

- generated OSM edges are visible and read-only
- a generated edge can be copied into an editable manual base edge
- new manual edges can be drawn
- manual edge vertices can be dragged, inserted, deleted, extended, and split
- graph and match artifacts are recalculated after staged manual edits

### CW Overlay

This workspace reviews which base edges represent each CycleWays segment.

- automatic match diagnostics are visible per selected segment
- full high-confidence matches can be bulk accepted
- selected segments can be recalculated individually
- base edges can be picked or removed from a reviewed edge set
- boundary snapping is available when the source segment should move onto an
  existing base-edge boundary
- unresolved review rows group missing, gap, continuity, duplicate, overmatch,
  stale, and pending cases
- accepted mappings are locked until cleared so review state is explicit
- the accepted overlay can be viewed as a whole mapped CW network and clicked
  back into per-segment review

## Validation Model

The overlay is being prepared as navigation data, so matching percentage alone
is insufficient.

The editor and matcher validate:

- full high-confidence auto-match eligibility
- missing OSM or manual base edges
- unmatched CycleWays gaps
- suspicious overmatched first or last edges
- stale saved edge refs after base graph edits
- continuity gaps in calculated and saved edge sequences
- duplicate base edge ownership across accepted CycleWays segments

The last two are deliberate network invariants for this phase:

- a CycleWays segment mapping must be continuous
- a base edge should not be owned by more than one active CycleWays segment

These checks make the overlay useful as a routing annotation layer instead of a
loose visual match report.

## Debug And Review Surfaces

The public React app has a temporary OSM debug mode:

- `?osm=1` loads the OSM debug artifacts
- raw OSM way view and generated graph edge view can be toggled with
  `osmLayer=ways` and `osmLayer=graph`
- hover and click inspection exposes OSM way, intersection, graph edge, and
  CycleWays match details
- the normal CycleWays network is hidden when the raw OSM debug network is
  being inspected so the downloaded network can be judged directly

The local editor is the authoring surface. The public debug mode is for visual
inspection of generated artifacts.

## Result Of This Phase

The branch now contains:

- a bounded OSM fetch and graph-building pipeline for the target area
- manual base graph corrections in source-controlled GeoJSON
- reviewed CycleWays-to-base-edge overlay mappings in source-controlled JSON
- editor workflows to keep graph corrections and overlay mapping review
  separate
- matcher and editor validation aimed at navigation-ready overlay data

That is enough to start the next design step: choose the runtime graph and cost
model for waypoint routing over the OSM/manual base graph while using the
CycleWays overlay as preference and metadata.

## Next Objective

The next slice should move the public waypoint router onto the prepared base
graph without changing the user-facing network model.

The user should still see the CycleWays network. The OSM/manual base graph
should be a hidden routing substrate:

- clicks near routable base graph edges can become route points
- clicks far from the base graph are rejected with a clear message
- routes prefer accepted CycleWays overlay edges
- routes may use non-CycleWays base edges when needed for reachability
- the visible map does not expose base graph edges as the normal route-building
  affordance

This keeps the product transition small. The interaction remains waypoint
routing over the visible CycleWays map, while the routing engine starts using
the larger base graph underneath.

### Click Acceptance

This slice should not route to arbitrary off-road coordinates.

A clicked location is valid only when it is within a configurable snap threshold
of an eligible base graph edge. Accepted clicks store:

- raw click coordinate
- snapped base-edge coordinate
- snapped base edge id
- position along that edge

The route starts and ends at the snapped base-edge coordinates. It does not draw
an implied straight-line connector from the raw click through open space.

### Base Graph Routing

The search graph for the next slice is:

- generated OSM base edges
- editor-authored manual base edges folded into the generated graph
- accepted CycleWays overlay ownership applied to those base edges

CycleWays ownership becomes a routing preference, not the only reachable graph.
The first cost model should be intentionally inspectable:

- accepted CycleWays edge: lowest cost
- other path, track, cycle, or local-road edge: allowed with a penalty
- larger car road edge: allowed with a stronger penalty

The exact multipliers should be tunable after routes can be inspected. This
slice should prove graph routing and CW preference before it tries to encode the
final safety policy.

Clicked points may land midway along base edges. Routing should support those
positions with virtual route endpoints for the current calculation, then clip
the first and last edge geometry to the snapped positions when assembling the
visible route.

### Runtime Asset Boundary

Public routing should not load editor/debug artifacts from `build/osm/`.

The normal build and promote flow must emit and publish a routing asset derived
from the authoring inputs. The runtime artifact should include only what the
public app needs:

- base graph topology
- edge geometry and lengths
- edge classification and cost inputs
- accepted CycleWays overlay membership
- compact diagnostics metadata where it is useful for routing failures

It should exclude raw Overpass responses, match-preview samples, unresolved
review lists, and other editor-only exploration data.

The promoted map manifest should reference the versioned routing artifact so a
deployed app loads routing data from the same published asset set as current map
data.

### Build And Promote Contract

The next slice changes build and promote behavior.

Build should:

- generate the runtime routing asset from current base graph and overlay inputs
- validate that accepted overlay edge refs resolve against the current base graph
- validate continuity and exclusive ownership for accepted CycleWays mappings
- report unresolved CycleWays overlay cases even when they do not prevent
  base-graph routing

Promote should:

- refuse to publish a missing or stale routing asset
- copy the versioned routing artifact with the other public map assets
- update the manifest to point at that artifact
- remove older promoted routing versions with the existing promoted-asset
  cleanup pattern

This boundary is part of the routing slice. Routing that works only against
local debug artifacts is not enough to validate the architecture.

### Route Output

The first base-graph route result should provide:

- ordered traversed base edge refs and traversal direction
- assembled route geometry with clipped first and last edge portions
- distance and weighted cost
- distance on CycleWays-owned edges and distance off CycleWays
- a clear failure reason for rejected clicks or disconnected graph searches

The existing route UI can render that geometry first. Richer public explanation
of off-CycleWays route portions can be designed after this route substrate is
working.

## Next Slice Acceptance Criteria

The next slice is done when:

1. Build emits a runtime base-routing asset.
2. Promote publishes a versioned routing asset and records it in the manifest.
3. The public app loads the promoted routing asset instead of editor/debug graph
   files.
4. The visible route-building map still presents the CycleWays network, not the
   full base graph.
5. Two valid clicks near base graph edges can produce a route through the hidden
   base graph.
6. Clicks too far from the base graph are rejected clearly.
7. The router prefers accepted CycleWays overlay edges but can use non-CycleWays
   base edges for reachable routes.
8. Mid-edge start and end snaps produce clipped visible route geometry.
9. Invalid accepted overlay refs, continuity gaps, or duplicate ownership block
   the runtime routing asset from being promoted.

## Follow-Up Decisions

The next routing phase should decide:

- the exact routing asset format and whether adjacency should be precomputed or
  rebuilt on load
- the snap threshold for valid base-graph waypoint clicks
- the first cost multipliers for CycleWays edges, non-CycleWays paths, local
  roads, and larger roads
- how road safety, access tags, road type, and CycleWays quality refine edge
  cost after the first routing prototype
- how route output resolves base edge paths back to CycleWays metadata where it
  exists
- how OSM refreshes preserve or invalidate manual overrides and overlay edge
  references
