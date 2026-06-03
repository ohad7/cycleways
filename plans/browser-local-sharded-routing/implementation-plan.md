# Browser-Local Sharded Routing Implementation Plan

## Objective

Build an experimental browser-local routing shard path on
`codex/routing-shards` that proves the hidden OSM/manual base graph can scale
past one eager routing asset without introducing a routing provider or routing
API.

The experiment has moved to shard-backed routing as the public branch path. The
full graph is still built in memory to create shards, but it is no longer
promoted as a runtime artifact.

## Guardrails

- Keep the public map visually centered on CycleWays.
- Keep all snap and route search work local to the browser.
- Start with the current northern graph before attempting a country-scale OSM
  import.
- Build static public assets; do not add a server endpoint to select graph
  pieces.
- Keep the branch-local route path explicit and measurable.
- Treat an all-shards merged graph as the comparison baseline for bounded shard
  subset routing.

## Slice 1: Baseline And Contracts

- [ ] Record current shard asset size, load/index cost, graph size, and
  representative route fixture outputs in a repeatable report or inspector
  command.
- [ ] Define the routing shard manifest schema and shard schema version.
- [ ] Define the shard boundary rule for edges, nodes, and neighboring shard
  connectivity.
- [ ] Define the runtime loader boundary so route calculation consumes a graph
  provider instead of assuming one eager routing asset.
- [ ] Decide how comparison tooling selects bounded shard subsets versus an
  all-shards merged graph.

### Exit Criteria

- [ ] The current route path has fixture outputs that can be compared after
  partitioning.
- [ ] Build/runtime contracts describe what the first shard files contain.

## Slice 2: Shard Builder On Current Graph

- [ ] Add a build step that partitions the existing runtime base-routing graph
  into static spatial shards.
- [ ] Emit a routing-shard manifest with shard ids, bounds, URLs, version
  metadata, and byte/count hints.
- [ ] Store only runtime routing data in shards: topology, geometry, cost
  inputs, CycleWays preference flags, and compact elevation fields.
- [ ] Emit a shard report with source graph count parity, shard count, byte
  totals, boundary counts, and largest-shard diagnostics.
- [ ] Validate that each source graph edge is represented according to the
  chosen boundary rule.
- [ ] Validate that cross-shard graph connectivity is reconstructable.

### Tests

- [ ] Unit-test shard assignment and boundary handling with synthetic edges.
- [ ] Test schema validation and source graph count parity.
- [ ] Test that editor/debug fields are not published into shard output.

### Exit Criteria

- [ ] The current routing graph produces a deterministic manifest and shard set.
- [ ] A shard report shows whether the first partitioning policy is sane before
  public runtime work depends on it.

## Slice 3: Build And Promote Integration

- [ ] Add the shard manifest and shard files to normal generated build output.
- [ ] Extend promote to publish stable shard assets and manifest references,
  with cache busting driven by the map-manifest version and per-shard hashes.
- [ ] Reject missing, stale, or schema-incompatible shard output during promote.
- [ ] Remove the eager full routing asset from promoted public data once shard
  routing is the branch default.
- [ ] Add cleanup behavior for old promoted shard generations once their public
  layout is stable.

### Tests

- [ ] Build test for manifest and shard emission.
- [ ] Promote test for published shard references.
- [ ] Promote test for stale or incomplete shard output rejection.

### Exit Criteria

- [ ] A promoted manifest can bootstrap shard routing without reading editor or
  build-only graph files.

## Slice 4: Browser Loader And Cache

- [ ] Add a runtime routing-shard loader that reads the promoted shard manifest.
- [ ] Fetch shards by id or bounds and stitch their runtime graph fragments.
- [ ] Expose loaded nodes, edges, bytes, shard count, and cache-hit diagnostics.
- [ ] Add a bounded in-memory shard cache suitable for a route editing session.
- [ ] Keep graph indexes incremental enough that loading another local shard does
  not rebuild an unbounded national graph.

### Tests

- [ ] Loader test for manifest version rejection.
- [ ] Loader test for graph stitching across neighboring shards.
- [ ] Cache test for hit, retain, and eviction behavior.

### Exit Criteria

- [ ] The browser can load a shard subset and report exactly what graph data is
  live.

## Slice 5: Shard-Aware Snapping

- [ ] Resolve click snap coverage from the shard manifest.
- [ ] Fetch the local shard neighborhood needed for the snap threshold.
- [ ] Build or reuse a local edge spatial index for loaded snap candidates.
- [ ] Return the same snapped route-point semantics as the current hidden graph
  router.
- [ ] Search neighboring border coverage so partitioning does not change the
  nearest eligible edge winner.
- [ ] Reject clicks that remain outside the snap threshold.

### Tests

- [ ] Near-edge click acceptance.
- [ ] Far-from-graph click rejection.
- [ ] Click near a shard border finds the correct cross-border candidate.
- [ ] Same-edge snap inputs remain usable for clipped route output.

### Exit Criteria

- [ ] Waypoint input can start from local shard loading rather than the eager
  full routing graph.

## Slice 6: Bounded Leg Routing

- [ ] Seed a shard envelope for one leg between snapped endpoints.
- [ ] Route over the stitched loaded graph with the existing CycleWays-first
  cost inputs and directional elevation fields.
- [ ] Move graph search into a Web Worker if the measured main-thread route path
  affects map interaction.
- [ ] Detect when a failed search touched loaded search boundaries.
- [ ] Expand neighboring shard coverage within explicit leg budgets.
- [ ] Return a distinct budget-exhausted route failure when the leg should be
  split by another waypoint.
- [ ] Assemble route geometry, clipped endpoints, costs, CycleWays/off-CycleWays
  totals, and elevation summaries from loaded shard edges.

### Tests

- [ ] One-shard leg comparison against all-shards output.
- [ ] Multi-shard leg comparison against all-shards output.
- [ ] Route that requires a non-CycleWays connector.
- [ ] Disconnected route failure.
- [ ] Budget-exhausted route failure.
- [ ] Clipped first/last edge route output.

### Exit Criteria

- [ ] Representative bounded legs route locally without loading the full routing
  graph.
- [ ] A route miss is classed as graph failure, missing coverage expansion, or
  explicit budget exhaustion.

## Slice 7: Waypoint Route Integration

- [ ] Route consecutive waypoint legs through the shard path under the
  experiment switch.
- [ ] Preserve marker-only behavior for one waypoint.
- [ ] Preserve the visible CycleWays-first map and current route line behavior.
- [ ] Recalculate restored shared routes from waypoint intent by loading needed
  shards leg by leg.
- [ ] Keep route sharing based on waypoint coordinates and route options rather
  than shard-local ids.
- [ ] Surface a concise public message for snap rejection and leg budget
  exhaustion.

### Tests

- [ ] Route restore loads required shard coverage and recalculates locally.
- [ ] Existing route sharing remains readable when the experiment path is off.
- [ ] Route editing does not fetch unrelated graph coverage for a local edit.

### Exit Criteria

- [ ] The experiment can be exercised from the public waypoint flow without
  showing the hidden base graph.

## Slice 8: Diagnostics And Comparison

- [ ] Add route diagnostics that show loaded shard ids/count, loaded graph size,
  route search rounds, and bytes when known.
- [ ] Add fixture comparison tooling for all-shards versus bounded-shard route outputs.
- [ ] Measure short, medium, boundary-crossing, and budget-limit route cases.
- [ ] Record parse/index/search responsiveness during waypoint edits.
- [ ] Document differences caused by corridor policy, tie-breaking, or shard
  boundary handling.

### Exit Criteria

- [ ] The experiment can answer whether static shard routing saves enough client
  work while preserving route quality for bounded legs.

## Slice 9: Scale Decision

- [ ] Decide whether current shard size and format are sufficient for widening
  OSM acquisition.
- [ ] If current metrics pass, run a follow-up Israel-scale import experiment and
  produce the same shard/build/runtime metrics.
- [ ] If shard files become too numerous or too expensive to fetch, evaluate a
  packaged range-readable static archive while preserving the manifest and
  graph-provider boundary.
- [ ] Keep comparison tooling based on an all-shards merged graph instead of a
  promoted full routing artifact.

## Validation Matrix

| Case | Expected Result |
| --- | --- |
| Near click in local shard | Loads local coverage and snaps |
| Far click | Rejects without implied off-road connector |
| Route inside one shard | Matches baseline route behavior |
| Route across shard border | Maintains graph continuity |
| Snap near shard border | Considers neighboring coverage |
| Route needs non-CW connector | Uses it with existing penalty model |
| Route exceeds leg budget | Returns explicit waypoint-needed failure |
| Share restore | Recalculates from waypoint intent |
| Initial app browse only | Does not fetch the full hidden routing graph |

## Suggested First Delivery

The first implementation stop should be smaller than the whole plan:

1. Partition the current northern graph into static shards.
2. Publish a shard manifest and report from Build.
3. Add a loader that can fetch the shards around two test points.
4. Route one fixture leg through only those shards and compare it with the
   all-shards merged result.

That slice answers the main architectural question before public UI integration
and before a national OSM import make the work harder to interpret.

## Experiment Acceptance Criteria

- [ ] The normal asset flow can publish a stable shard manifest and shard set.
- [ ] The app can route a bounded public waypoint leg in the browser from shard
  subsets only.
- [ ] Full-graph comparison exists for correctness and route-quality review.
- [ ] Short and medium bounded legs load materially less routing data than the
  current eager graph asset.
- [ ] Boundary snap and boundary route fixtures pass.
- [ ] Budget exhaustion is explicit and recoverable by adding a waypoint.
- [ ] No routing provider or routing API is introduced.
