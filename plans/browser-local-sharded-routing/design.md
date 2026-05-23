# Browser-Local Sharded Routing Design

## Status

This plan defines an experiment for `codex/routing-shards`.

The current OSM base-network work has proven the core product model:

- the public map shows the CycleWays network
- a hidden OSM/manual base graph provides reachability
- CycleWays ownership changes routing preference on base edges
- route calculation, snapping, sharing, and elevation stay local to the app

The current runtime implementation loads one promoted base-routing asset for the
whole target area. That is a useful baseline for a northern-region graph, but it
is not the delivery shape to assume for an Israel-wide graph.

## Goal

Prove that the app can route over a hidden OSM/manual base graph that is too
large to load eagerly by fetching and routing only over static spatial graph
shards in the browser.

The experiment should preserve the existing product direction:

1. No external routing provider.
2. No app routing API.
3. The rider sees CycleWays display data, not the base graph.
4. The browser performs snap and route search locally.
5. Larger routes are made feasible by bounded legs and intermediate waypoints,
   not by keeping a country-scale graph in memory.

## Why This Experiment Exists

The current promoted routing asset contains graph topology, edge geometry, cost
inputs, CycleWays ownership, and compact elevation data for one bounded region.
It is already much larger than the visible CycleWays map data, and a
country-scale OSM import will multiply that gap.

The routing graph and the displayed network have different loading needs:

- visible CycleWays data is small enough to load for normal map browsing
- hidden base graph data is needed only near route points and plausible route
  corridors
- the base graph should not become an initial-load tax for users who only read
  the map

The experiment should determine whether static shard loading is enough before
the project commits to a national import format or a more specialized packaged
archive format.

## Scope

### In Scope

- build a static shard set from the existing promoted base-routing inputs
- publish a small shard manifest plus stable shard files with content hashes
- load routing shards on demand in the public app
- snap waypoint clicks using loaded routing shards near the click
- route one bounded leg in the browser across the loaded shard subgraph
- expand the loaded shard set within explicit budgets when the first search
  corridor is insufficient
- cache loaded shards while the route session benefits from them
- compare bounded shard routes with an all-shards merged graph
- record bytes, shard count, graph size, and route-search diagnostics

### Out Of Scope For The First Experiment

- a routing server, tile server, or external provider
- routing to arbitrary off-road points
- loading all Israel routing data eagerly
- final national OSM import and refresh policy
- final road-safety cost tuning
- replacing the visible CycleWays map with base-edge rendering
- an exact-route sharing format based on internal base edge ids
- optimizing immediately to a binary archive if compact static shard files are
  sufficient to learn from

## Product Contract

The public interaction stays waypoint-based.

- A click near a routable base edge may become a snapped route point.
- A click too far from routable graph data is rejected or warned.
- A leg routes from one snapped waypoint to the next.
- A route with distant waypoints may require the user to add intermediate
  waypoints when a bounded local search is not allowed to grow further.
- The route line and summaries come from the local graph result.

The CycleWays network remains the map the rider understands. The base graph is a
hidden implementation layer used for snap and route calculation.

## Operating Assumptions

The experiment is allowed to impose constraints that make browser-local routing
tractable:

1. Search one leg at a time between consecutive waypoints.
2. Enforce leg budgets by distance, loaded shards, loaded edges, bytes, or
   search expansion count.
3. Keep only the shard subset needed for current routing work and a bounded
   cache.
4. Refuse or defer a route leg when the needed search area exceeds the current
   budget.
5. Use waypoint coordinates and route options as the durable route intent when
   restoring a share.

These constraints are not workarounds around an API. They are the local-routing
product boundary for a country-scale hidden graph.

## Baseline And Experiment Strategy

The current full-asset router is the correctness baseline for the same source
graph.

The first shard experiment should run against the existing northern graph
before widening the OSM import:

- the graph is already edited and overlay-reviewed
- route fixtures and real map inspection already exist
- bounded shard output can be compared with an all-shards merged graph
- shard boundary behavior can be tested before import volume becomes the main
  variable

After the current graph proves the shard contract, a later experiment can widen
the OSM acquisition area toward an Israel-scale graph and measure the same
budgets.

## Asset Model

### Display Assets

The existing public display assets remain eager:

- CycleWays geometry and metadata
- route UI assets
- the normal map manifest entries needed by the visible app

They should not carry the hidden base graph just because routing is available.

### Routing Shard Manifest

The runtime should load a small routing-shard manifest before it loads routing
graph data. The manifest should provide:

- shard set version and source routing-asset version
- shard scheme and coverage bounds
- route data format version
- shard ids, bounds, URLs, and byte hints
- neighbor or grid lookup information needed to expand a shard envelope
- cost/profile metadata needed to reject incompatible shards

The manifest is an index, not a routing graph.

### Routing Shards

Each shard should contain compact routing records for its covered graph subset:

- nodes needed by local adjacency
- directed or direction-aware edge records
- edge length and routing cost inputs
- edge class and CycleWays preference/ownership flags
- compact elevation fields used by current routing cost and output
- edge geometry needed for clipping and route display
- edge and geometry bounds needed for local snapping
- boundary references needed to connect neighboring shards

Editor-only state stays out:

- raw OSM payloads
- overlay review lists
- match diagnostics
- editor selections
- source artifacts that are not required by runtime routing

The first implementation may use compact JSON shards if it keeps the routing
contract visible and testable. The shard schema should be isolated so a later
binary encoding or range-readable archive does not require rewriting the route
manager contract.

## Spatial Partitioning

Routing shards are graph partitions, not visual map tiles.

The partitioner must preserve connectivity across shard boundaries. The design
should choose one explicit boundary rule and test it:

1. Split graph edges at shard boundaries and give boundary nodes stable ids.
2. Or assign each edge to one owning shard while writing enough cross-shard
   references for the adjacent shard to connect to it.

The first option is easier to reason about for local routing and snapping if the
build pipeline can derive deterministic boundary splits. The second option may
reduce geometry duplication but makes loader stitching more delicate. The
experiment should record the choice before it widens to a national graph.

Shard lookup should support at least:

- shards covering a click search radius
- shards intersecting a leg seed envelope
- neighboring shards used for bounded expansion

## Runtime Flow

### App Load

Initial map load should not fetch all routing shards.

1. Load visible CycleWays assets.
2. Load the routing-shard manifest when routing is needed or as a small
   routing bootstrap asset.
3. Keep the routing loader idle until a click, route restore, or route edit
   requires graph data.

### Snap

Waypoint snapping becomes shard-aware:

1. Find shards intersecting the click snap radius.
2. Fetch missing shards for that local area.
3. Build or reuse a local edge spatial index for those shards.
4. Snap to the nearest eligible edge within the threshold.
5. Return the same route-point contract used by the current hidden graph router:
   raw coordinate, snapped coordinate, edge reference, and offset along edge.

Snap near a shard border must search enough neighboring coverage to avoid a
wrong local winner caused only by partitioning.

### Route One Leg

Routing a leg should be bounded and observable:

1. Seed a shard envelope around the two snapped endpoints and their corridor.
2. Load the missing shards in that envelope.
3. Route locally over the stitched shard subgraph in a Web Worker when search
   cost is high enough to affect map interaction.
4. If the search fails because it reaches the loaded boundary, expand the
   envelope within the allowed budget and retry or continue.
5. If the leg exceeds budget, return a clear route failure that asks for a
   closer waypoint rather than silently loading a country-scale graph.

The search should stay compatible with the current inspectable cost model:
CycleWays edges are preferred, other routable graph edges remain available, and
elevation cost fields remain directional.

### Route Output

The shard router should return the same route shape expected by the public UI:

- traversed edge sequence and directions for diagnostics
- clipped first and last edge geometry
- assembled line geometry for rendering and export
- distance, weighted cost, CycleWays distance, off-CycleWays distance, and
  elevation summaries available from the loaded edge data
- a failure reason that distinguishes snap rejection, disconnected loaded graph,
  and budget exhaustion

## Caching And Memory

The loader should have two independent caches:

- network cache through normal static asset caching, the map-manifest version,
  and per-shard content-hash query parameters
- in-memory shard cache bounded for the current route session

The in-memory cache should expose debug counters for:

- loaded shard count
- loaded routing bytes when known
- loaded node and edge counts
- cache hits and evictions
- route attempts and expansion rounds

The first experiment can use a simple least-recently-used or route-session
retention policy. The important contract is that country-scale routing does not
require an unbounded in-memory graph.

## Build And Promote

Shards are public routing assets, so the normal asset flow must know about them.

Build should:

- derive shards from the current base-routing inputs
- validate shard topology, cross-shard connectivity, and schema version
- emit a shard manifest and shard build report
- retain enough metadata to compare the shard graph with the full routing graph

Promote should:

- publish shard assets in a stable `public-data/base-routing-shards/` directory
- publish the routing-shard manifest in the promoted map asset set, using the
  map-manifest version and per-shard hashes for browser cache busting
- refuse stale or incomplete shard output
- preserve a clear branch boundary while shard-backed routing is validated as
  the public route path

## Sharing And Restore

The share contract should describe route intent, not graph cache state.

Shared route data should be based on:

- ordered waypoint coordinates
- route profile/options that affect cost
- share payload version
- optional asset-version diagnostics when useful for debugging

It should not require:

- loaded shard ids
- internal shard-local node indexes
- base edge ids as the only way to restore a public route

On restore, the browser loads the needed shards again and recalculates each
bounded leg against the current promoted graph. Exact route snapshots can remain
a separate future problem for GPX export or a deliberate route-snapshot feature.

## Validation Strategy

### Correctness

The experiment should compare bounded shard-graph and all-shards graph behavior
for fixtures:

- both endpoints in one shard
- route crossing one or more shard boundaries
- same-edge clipped route
- snap near a shard boundary
- route requiring an off-CycleWays connector
- disconnected route failure
- over-budget route failure

For a fixture that remains within the shard budget, the shard result should
match the all-shards result closely enough that any difference is explained by
an intentional tie-break or corridor policy.

### Performance

Measure:

- initial routing bootstrap bytes
- bytes fetched for representative short, medium, and long bounded legs
- shard count, edge count, and node count held during those legs
- time spent fetching, parsing, indexing, snapping, and searching
- worker/main-thread responsiveness during waypoint edits

### Build Integrity

Test:

- shard manifests reference existing promoted shards
- shard schema versions match loader expectations
- boundary connectivity survives partitioning
- every source graph edge is represented according to the chosen shard rule
- rejected stale graph or overlay inputs still fail before promote

## Risks

- A corridor that is too narrow may miss the best CycleWays-preferred route.
- A corridor that expands too easily may approach the same cost as loading every
  shard.
- Edge geometry ownership at shard borders can create duplicate snaps or broken
  adjacency if the rule is vague.
- A national OSM graph may stress build time, shard count, and browser cache
  behavior even when per-leg routing is bounded.
- Sharing remains recalculated intent, so graph refreshes can change a restored
  route unless route snapshots are added later.

## Decisions To Make During The Experiment

- shard scheme and first shard size
- edge boundary policy
- compact JSON versus a more binary first format
- whether a worker boundary is needed for the first local graph size or only
  before national import
- corridor seed shape and bounded expansion policy
- leg budgets and public message for budget exhaustion
- in-memory cache limit and eviction rule
- whether static individual shard files are enough or should be replaced later
  by a range-readable packaged archive

## Success Criteria

The experiment is successful when:

1. Public initial load does not eagerly fetch the full hidden routing graph.
2. A waypoint snap fetches only local routing coverage and behaves correctly at
   shard boundaries.
3. Representative bounded legs route locally across multiple shards while the
   visible map remains CycleWays-first.
4. Loaded routing bytes and in-memory graph size are materially below the full
   current routing asset for short and medium legs.
5. Full-graph comparison fixtures make route differences inspectable.
6. Build and promote can publish a stable static shard set without adding a
   routing API.
7. A leg that exceeds budget fails clearly enough that the user can add an
   intermediate waypoint.
