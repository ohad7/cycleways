# Editor Responsiveness and Performance — Design Review

Date: 2026-07-22

Status: Proposed; design and review only

## Decision summary

The editor should feel immediate even when its routing and release models remain
strict. Today, two different problems combine into one frustrating experience:

1. ordinary browser interactions invalidate much more UI and map state than
   they changed; and
2. derived-data work repeatedly reconstructs large, reusable routing state.

The highest-value direction is therefore not a longer debounce, another manual
Recalculate button, or a complete UI rewrite. It is to:

- make client rendering dependency-scoped;
- keep the base graph and matcher indexes warm and patch them by revision;
- treat a user edit as one revisioned server operation rather than several
  client-orchestrated persistence stages;
- reserve complete graph/elevation/publication work for structural changes and
  explicit release verification; and
- measure semantic editor activity together with performance spans.

Yes, activity tracking makes sense. It should be local-first, privacy-conscious
operation telemetry, not raw click tracking or session replay. The important
questions are “what did the curator try to do?”, “when was local feedback
visible?”, “when was the edit durable?”, “when did derived state become
current?”, and “was the curator prevented from doing anything useful while it
ran?”.

## Relationship to existing designs

This design extends, rather than replaces,
`plans/network-editor-workflow/design.md`.

That design established the correct product model: separate immediate editing,
durable source persistence, background route reconciliation, and explicit
release Build/Promote. It also introduced latest-state-wins coordination,
request cancellation, incremental response patches, and stage timing. Those
are the right foundations.

This review asks why the implemented experience can still feel slow and what
architecture is needed to meet the earlier interaction contract consistently.
It also expands the earlier audit-oriented observability into performance and
workflow telemetry that can guide future optimization.

This design does not supersede strict traversal policy, Overlay V2 authority,
roundabout/crossing review, or fail-closed promotion.

## Review scope and evidence

The review covered the editor's primary workflows and their shared runtime:

- startup and workspace switching;
- CW segment selection, metadata, geometry, explicit edge mapping, and POIs;
- base-network inspection, manual edge geometry, and traversal-policy review;
- direction evidence, roundabout, junction, and crossing review;
- Build and Promote;
- Route Catalog and Video Sync as secondary authoring workflows;
- browser rendering and Mapbox source updates;
- editor-server request handling, persistence, subprocesses, and caching; and
- existing tests, timing logs, and benchmarks.

Primary reviewed files include `editor/editor.js`, `editor/server.mjs`,
`editor/README.md`, `editor/lib/network-authoring-coordinator.mjs`,
`processing/build_osm_base_graph.py`,
`processing/match_cycleways_to_osm_graph.py`, and the existing editor plans and
workflow tests.

This is a code-path review supported by a read-only matcher benchmark. It is not
a browser profile of a long real authoring session. The proposed telemetry is
needed to turn several strongly evidenced code findings into representative
p50/p95 user measurements.

### Current data scale

The checked-in working data on 2026-07-22 has the following approximate scale:

| Artifact | Size / count |
| --- | ---: |
| `data/map-source.geojson` | 2.06 MB; 367 records, 291 active, 18,975 coordinates, 76 data markers |
| `build/osm/osm-base-edges.geojson` | 49.16 MB; 48,895 edges |
| `build/osm/osm-base-graph.json` | 69.46 MB |
| `build/osm/cw-osm-match-summary.json` | 0.84 MB; 296 segment summaries |
| `build/osm/cw-osm-match-preview.geojson` | 2.12 MB; 1,623 preview features |
| `data/cw-base-overlay.v2.staged.json` | 1.64 MB |

The scale is not inherently too large for a local editor, but it makes broad
JSON parsing, cloning, DOM rebuilding, and GeoJSON `setData()` calls visible to
the user.

### Code-path evidence map

Line numbers are from the reviewed 2026-07-22 working tree and are included as
orientation, not as stable API identifiers.

| Area | Current code path | Performance relevance |
| --- | --- | --- |
| Full client render | `editor/editor.js:8140` `renderAll()` | Rebuilds all main panels and then all map sources |
| Map invalidation | `editor/editor.js:2565` `updateMapSources()` | Visits every editor GeoJSON source regardless of the initiating action |
| Map source cache | `editor/editor.js:2600` `setSourceData()` | Uses object identity; freshly allocated equivalent collections miss the cache |
| Segment list | `editor/editor.js:2862` `renderList()` | Clears/recreates/rebinds all matching rows |
| Direction edge hover | `editor/editor.js` `renderDirectionReviewEdges()` | Hover state can call the broad map-source updater |
| Background coordinator | `editor/editor.js:1168` `runAuthoringSync()` | Correct latest-state/abort base, but segment jobs are serial and client-orchestrated |
| Base workspace load | `editor/editor.js:10293` `loadBaseOverlayData()` | Loads six primary artifacts, then V2 queue and junction context |
| Source save | `editor/editor.js:11312` `saveSource()` | Clones/stringifies/sends the complete source snapshot |
| Single-segment subprocess | `editor/server.mjs:4640` `handleOsmSegmentRecalculate()` | Starts Python and rebuilds graph/index state per request |
| Aggregate match persistence | `editor/server.mjs:4795` `persistOsmSegmentMatch()` | Reads and rewrites complete summary, preview, and match aggregates |
| Full base evidence | `editor/server.mjs:3506` `refreshDirectionReviewEvidence()` | Topology, traversal audit, migration/rebase, validation, attachments |
| Graph response enrichment | `editor/server.mjs:6224` `GET /api/osm/graph-edges` | Parses and maps the full graph through several enrichment passes |
| Release build | `editor/server.mjs:4467` `handleBuild()` | Monolithic request around several broad dependency stages |
| Catalog runtime | `editor/server.mjs:1214` `buildLiveDecodeRoute()` and preview helpers | Reusable assets/runtime are rebuilt across related catalog operations |

### Repeated single-segment matcher benchmark

The existing production-path, read-only benchmark was rerun for representative
segments #62, #63, #276, and #319 with one measured run each:

| Measurement | Result |
| --- | ---: |
| Median wall time | 2,467.7 ms |
| Highest observed wall time | 2,573.7 ms |
| Median reusable graph setup | 2,272.3 ms (92.1%) |
| Median graph JSON parse | 496.2 ms |
| Median spatial index construction | 1,343.3 ms |
| Median connectivity index construction | 344.6 ms |
| Median actual segment match | 1.3 ms |
| Estimated cached median upper bound | 195.4 ms |

This closely reproduces the eight-run result already recorded in the Network
Editor design (2,455.5 ms median, 92.6% reusable setup). It is unusually clear
evidence: the matching algorithm is not the wait. Reconstructing the same graph
and indexes in a new Python process is the wait.

## Current workflow and latency boundaries

The editor currently has three correctness lanes, but their implementation
boundaries are inconsistent:

1. **Immediate browser draft** — mutable form/map state.
2. **Durable authored source** — GeoJSON, manual edges, overrides, reviews, and
   catalog drafts written atomically by the local server.
3. **Derived current state** — match results, topology, policy evidence,
   directional alignments, issue summaries, and release artifacts.

The user should never have to wait for lane 3 before continuing unrelated work.
The editor should clearly show when lanes 1 and 2 are safe while lane 3 is still
catching up.

### Workflow classification

| User action | Current derived work | Desired latency class |
| --- | --- | --- |
| Select a segment/edge or change a view/filter | Full or broad UI/map refresh | Immediate presentation only |
| Edit CW name/status/road type/notes | Whole source save plus metadata update | Immediate local update; cheap durable patch; no rematch |
| Edit a POI/data marker | Whole source save; broad UI refresh in several paths | Immediate local update; no routing reconciliation |
| Move/insert/delete a CW vertex | Whole source save, fresh Python match, aggregate match persistence, V2 validation | Immediate draft; warm single-segment reconciliation |
| Choose explicit base edges for a CW segment | Save plus validation; some broad rendering | Immediate local path; validate only selected refs; no matcher |
| Move/draw/split a manual base edge | Manual file save followed by topology, policy audit, V2 migration/rebase | Immediate draft; incremental graph/policy patch; affected segments only |
| Change an OSM traversal override | Full topology/evidence refresh | Patch split edges for that way; affected segments only |
| Review roundabout/crossing/junction semantics | Specialized state reloads | Targeted review write and affected projections |
| Build release | Topology/elevation/junction/full map/public assets | Explicit snapshot job with progress and cache reuse |
| Edit Route Catalog prose | Local form state | Immediate; no recompute |
| Recompute Route Catalog metadata | Decode/reclassify every entry | Changed-token entries only, with cached route runtime |
| Edit Video Sync keyframes | Local state; explicit draft save | Existing explicit-save model is acceptable |

## Findings

### F1 — Client invalidation is much broader than state changes

`renderAll()` in `editor/editor.js` rebuilds the workspace chrome, drawing
controls, complete segment list, selected form, routing inspector, data-marker
form, base panel, overlay panel, connector panel, junction panel, crossing
panel, compose status, authoring status, and every editor map source.

There are roughly 79 references to `renderAll()` in the current module. Many are
reasonable state transitions, but ordinary operations such as selection,
quality changes, context toggles, theme changes, policy changes, data-marker
completion, and hover-driven direction highlighting can enter this broad path.

The DOM renderers generally clear and recreate their contents. For example,
the segment list rebuilds and rebinds every row, the selected forms rebuild
their controls, and the direction queue/edge list is regenerated. This causes
layout, garbage creation, focus/caret risk, and repeated event binding even
when only a status label or selected row changed.

`updateMapSources()` then asks every Mapbox GeoJSON source to update. Its
referential cache avoids `setData()` only when a collection builder returns the
same object. Several high-frequency builders—active segments, selection,
vertices, data markers, draw state, direction alignments, and endpoints—create
new collection objects on every call even when their semantic data is
unchanged. Direct `map.getSource(...).setData(...)` calls elsewhere bypass the
cache altogether.

The base graph and CW overlay have some useful identity-based caching, but the
overall invalidation model is still global. A hover in a direction-review row
can call `updateMapSources()` to change one `hovered` property, causing unrelated
source builders to allocate new GeoJSON and Mapbox workers to reconsider it.

This explains sluggishness that is independent of server calculation time.

### F2 — Startup and full reload eagerly transfer and transform too much data

Opening the Network workspace loads the 49 MB graph-edge GeoJSON together with
match summary, match preview, compatibility overlay, manual edges, traversal
overrides, V2 overlay, pending review queue, and junction context.

The graph endpoint does more than read a file. It performs several full feature
passes to attach source digests, direction evidence, and CW membership, and it
rehashes input files for freshness comparison. The browser then parses the
large response, derives additional properties and indexes, and sends it to a
Mapbox GeoJSON source.

This cost is paid before many CW-only actions need the full inspectable base
graph. A compact CW physical-overlay presentation, selected-segment evidence,
and issue summary would be sufficient for the normal CW workspace. Full base
edge attributes are only needed in Base focus or when opening a specific edge.

Full evidence refresh paths can also mark the base overlay unloaded and repeat
the multi-endpoint load. Recent incremental manual-edge responses correctly
avoid this, demonstrating the preferred patch model, but the full-reload path
remains expensive.

### F3 — A CW geometry edit pays graph setup cost on every match

Each selected-segment match starts `python3`, reads and parses the 49 MB graph
edge file, filters it, computes bounds/projection, and rebuilds spatial and
connectivity indexes. Actual segment matching takes only a few milliseconds.

Cancellation prevents an obsolete result from being adopted, which is correct,
but it also discards the expensive setup. Rapid edits can therefore spend most
of their time repeatedly reconstructing and killing the same reusable state.

The repository's own benchmark exceeds the documented threshold for a
digest-keyed long-lived matcher by a wide margin.

### F4 — One logical CW edit is split into several server round trips and broad writes

The current geometry reconciliation is client-orchestrated:

1. call single-segment recalculation;
2. call match persistence;
3. call network-authoring validation/application; and
4. adopt several response objects into client state.

Match persistence reads and rewrites three aggregate artifacts: the complete
match summary, match preview collection, and match record collection. This is
safe but increasingly inefficient as the network grows. It also creates
partial intermediate states that one authoritative server operation could
avoid.

Source autosave similarly clones and serializes the complete ~2 MB source on
the browser main thread and sends it for every committed change, including
metadata and POI edits. This is smaller than the base graph but unnecessary
work for a one-object edit and another source of input jank.

### F5 — Routine base-edge edits still have a whole-topology cost

The recent topology-only improvement is substantial and correct: automatic
base authoring no longer performs elevation or all-CW matching, and incremental
responses patch generated manual edges rather than reloading the complete base
graph.

However, a routine manual edge or traversal override still invokes:

- a full 2D base-topology build;
- a full bicycle traversal policy audit;
- a full Overlay V2 migration proposal;
- rebase/automatic application;
- published-overlay validation; and
- junction attachment reconciliation.

The measured/design expectation is about 15 seconds. That is acceptable as a
fallback background job, but not as the normal consequence of moving one
manual vertex or reviewing one source way.

`changedOsmWayIds` currently helps select the compact response patch; it does
not make the topology, audit, or migration computation itself incremental.

### F6 — Release Build is correctly explicit but operationally opaque

Build intentionally performs broad work: freshness checks, possible topology
and elevation refresh, junction generation, the full map processor, routing
assets, validation, and reporting. It uses child processes and prints helpful
stage logs to the server terminal.

In the editor UI, though, Build is one long HTTP request with a general
“Building release artifacts” status. The user cannot see the active stage,
cache reuse, elapsed/estimated work, or whether editing can safely continue.
Any authored change invalidates the previous build report, even if a build
could safely finish against an immutable earlier snapshot and be labeled stale.

The problem is less that release work exists than that its snapshot, progress,
and reuse boundaries are not first-class.

### F7 — Shared artifact jobs are coordinated mainly in one browser tab

The client protects many operations with `busy`, revisions, and abort signals.
The server has per-request counters and per-segment latest revisions, but no
general persistent job registry or resource lock around graph, evidence, build,
and promotion artifacts.

Multiple tabs, a browser reload, or overlapping explicit and automatic jobs can
therefore create duplicate CPU work and compete over shared derived files. The
atomic writes prevent torn files, but they do not by themselves make two
multi-file pipelines one serialized transaction. The existing product design
also calls for reconnecting to in-progress work after reload; current jobs are
not exposed that way.

### F8 — Secondary workflows show both good patterns and avoidable recalculation

Roundabout and crossing review are loaded on demand, which is the right
direction. Junction context is more eagerly coupled to Network loading and can
read/derive large graph-backed state even when the user is not reviewing a
junction.

Route Catalog editing keeps prose changes local until explicit Save/Recompute,
which is good. Recompute builds a live route decoder and classifies the whole
catalog; route preview and image-candidate endpoints separately create route
manager instances. A cached runtime plus token-digest results would make these
operations scale with changed entries.

Video Sync uses local editing with explicit draft save/promote and narrowly
updates its own map sources. It is a useful interaction benchmark for the rest
of the editor.

### F9 — Existing timing is useful but does not describe the user's lost time

The editor already has several strong observability pieces:

- browser-side per-stage authoring timing in console logs;
- server request durations and subprocess phase logs;
- graph-builder phase timings;
- matcher phase metadata and a reproducible benchmark; and
- visible high-level authoring stages.

What is missing is a persistent correlation across the initiating user action,
browser work, network request(s), server stages, result adoption, and UI-ready
paint. Console logs cannot answer how often an expensive path happens, how its
p95 changes, or whether the user was blocked versus productively editing
another object during the wait.

## Design goals

- Segment/edge selection, form commits, view changes, and map gestures remain
  responsive independently of routing work.
- A committed edit becomes visibly local immediately and durably saved quickly.
- CW geometry reconciliation reuses a warm graph and affects one segment.
- Routine manual-edge and source-way policy edits patch graph/evidence state and
  revalidate only dependency-linked segments.
- Complete topology, elevation, global audits, and public assets run only when
  structurally necessary or explicitly building a release.
- Background work does not disable unrelated editing and survives UI reloads.
- The UI distinguishes Local, Saved, Derived current, and Release verified.
- Performance decisions use representative action-to-paint and
  action-to-current measurements.
- Strict traversal validation and fail-closed promotion remain unchanged.

## Non-goals

- Weakening validation to make a slow operation appear fast.
- Moving the entire routing engine into the browser.
- Rewriting the editor in React before fixing invalidation and data boundaries.
- Publishing user activity to a remote analytics service by default.
- Recording raw keystrokes, pointer trails, coordinates, descriptions, images,
  route tokens, videos, or session replay.
- Removing explicit release Build or Promote.

## Latency classes

Every operation should be assigned one of four product-visible latency classes:

### A — Immediate presentation

Selection, hover, drawing feedback, dragging, typing, filters, and inspector
switches. These must touch only local state and the exact DOM/map projection
that changed.

### B — Fast durable/incremental work

Source patches, metadata/POI persistence, warm single-segment matching,
explicit-path validation, and dependency-scoped evidence updates. These may run
asynchronously but should normally complete within a fraction of a second to a
small number of seconds.

### C — Heavy background derivation

Fallback full topology, broad semantic candidate generation, and unusual
repair/migration work. The editor remains usable, shows a stage and affected
scope, and adopts results only if their input digest is still current.

### D — Explicit release verification

Elevation, complete audits, routing shard/public artifact generation, snapshot
generation, and promotion. These operate on an immutable input snapshot and
never masquerade as ordinary autosave.

## Proposed architecture

### 1. Make one semantic operation the unit of coordination

Each committed action receives an `operationId`, object identity, object
revision, initiating action, and input digest. Examples include
`cw_vertex_drag_commit`, `segment_metadata_commit`,
`manual_edge_geometry_commit`, `traversal_override_commit`, and
`release_build_requested`.

The operation has separately observable milestones:

```text
local draft visible
  -> source durable
  -> incremental derived state current
  -> release verified (only for an explicit build)
```

The browser should not orchestrate the internal derived transaction as a chain
of independent APIs. After durable persistence, the server owns matching,
validation, evidence persistence, compatibility projection, and affected-state
patches for that operation. The UI subscribes to operation progress and adopts
only a matching revision.

Per-object latest-state-wins remains the rule. Unrelated objects may progress
independently. Shared graph writes use explicit resource coordination.

### 2. Replace global client renders with invalidation domains

The editor does not need a framework rewrite to gain deterministic updates.
Introduce explicit presentation domains with revision tokens, for example:

- workspace chrome;
- active segment index/list;
- selected object form;
- selected object's routing inspector;
- issue queue;
- authoring/release status;
- each map source independently; and
- each specialized workspace independently.

An action declares the domains it invalidates. Rendering is batched once per
animation frame, but only invalid domains run. Stable form/list DOM is patched
by key rather than cleared and rebuilt. Search results and long queues are
limited or virtualized.

The segment list should not rebuild when one authoring status label changes.
The selected form should not rebuild on map hover. The Base explorer should not
recompute 48,895-edge summaries when a CW vertex moves.

If this modularization leaves pure computations over the full graph above the
frame budget, those computations can move to a Web Worker. A worker is a
secondary tool, not a substitute for correct invalidation.

### 3. Treat Mapbox sources as versioned resources

Each map source should have an explicit semantic version/fingerprint. Call
`setData()` only when that source's version changes.

Specific rules:

- Use Mapbox `feature-state` for hover and transient selection whenever
  possible instead of rebuilding a GeoJSON collection.
- Use layer filter/paint/layout changes for explorer themes, visibility, and
  presets instead of resending geometry.
- Keep the full/compact base graph source stable across ordinary interactions.
- Update only the selected geometry and vertex sources during a drag.
- Batch pointer-driven visual updates through `requestAnimationFrame`.
- Route every update through the version-aware source adapter; remove direct
  untracked `setData()` calls.
- Cache collection builders by their actual dependencies, not merely by the
  identity of a newly created wrapper object.

This realizes the existing Base Network design requirement that filter and
inspection interactions must not clone or resend the complete graph.

### 4. Split presentation data from inspectable detail

The editor needs three different graph views, not one 49 MB all-purpose
response:

1. **CW workspace presentation** — compact physical CW overlay geometry, issue
  /status summary, and selected-segment path/evidence.
2. **Base map presentation** — compact edge geometry plus the small set of
   properties needed for paint, filtering, and hit testing.
3. **Selected-edge detail** — raw tags, normalized policy evidence, provenance,
   relationships, and review metadata fetched for the inspector.

The base presentation may be compact GeoJSON partitioned by stable spatial
chunks, local vector tiles, or another Mapbox-compatible indexed format. The
important contract is viewport/invalidation scope and stable edge identity,
not a premature commitment to one encoding.

Server caches should be keyed by artifact digest and hold parsed graph data,
edge ID lookup, OSM-way lookup, dependency indexes, and prepared compact
responses. Conditional requests or version manifests should avoid rereading
and rehashing unchanged large files.

CW focus should become usable without the complete Base inspector payload.
Base focus can progressively load its map presentation, while selected detail
arrives separately.

### 5. Keep a digest-keyed matcher worker warm

Use a long-lived Python matcher worker (or an equivalent persistent service)
that loads and indexes the base graph once per graph/configuration digest.
Requests contain a segment snapshot, operation/revision ID, and cancellation
token. Responses retain the exact existing match schema and phase metadata.

Required guardrails:

- invalidate and rebuild on graph or matcher-configuration digest change;
- health-check and restart the worker after failure;
- retain the current subprocess CLI as the equivalence oracle and fallback;
- compare representative worker results byte/semantically with CLI results;
- discard or cancel superseded work without discarding a still-valid graph
  cache; and
- warm the worker after graph availability, not on the user's first drag.

The measured upper-bound estimate is about 195 ms instead of 2.47 seconds.
Actual service overhead must be measured, but this is the most strongly
justified calculation optimization in the repository.

### 6. Persist per-segment derived deltas, compact for release

A one-segment match should not rewrite every segment's preview and summary.
Store or journal derived editor results by segment/revision and maintain an
in-memory indexed view. Compact aggregate compatibility artifacts when needed
for an explicit full refresh, release Build, or controlled checkpoint.

Likewise, client source commits should send an object patch with an expected
source revision rather than clone and upload the complete source. The server
validates the patch, applies it to its indexed canonical source, and performs an
atomic durable write. Consecutive operations may coalesce server-side while
preserving the editor's durability contract.

This is not permission to keep source only in memory. The source milestone is
complete only after recoverable persistence.

### 7. Separate immutable OSM topology from mutable editor deltas

Routine base editing should compose:

- an immutable generated OSM core graph;
- mutable manual-edge additions/replacements;
- mutable reviewed traversal overrides; and
- indexes derived from the composition.

For a manual edge change, update that edge's geometry, endpoints, spatial index,
connectivity neighborhood, policy state, and dependent relationships. For an
OSM source-way override, update the split edges belonging to that way. Then use
edge/way-to-CW dependency indexes to revalidate only affected alignments and
junction attachments.

Evidence identity should be component/edge scoped. A change to one manual edge
must not make every unaffected alignment appear globally stale merely because a
single monolithic graph digest changed.

A complete topology rebuild remains necessary for structural OSM/intersection
changes, schema/algorithm upgrades, corruption recovery, and release
verification. It becomes a visible class-C fallback, not the normal manual
vertex workflow.

The release build still materializes the canonical merged graph and runs full
audits. Incremental authoring is an optimization; full release verification is
the correctness backstop.

### 8. Introduce a server job registry and resource coordination

Long-running work should be a job with:

- job ID and type;
- immutable input digests/revisions;
- affected resource/object keys;
- queued/running/completed/failed/superseded status;
- current stage and stage timings;
- cancellation capability where safe;
- output digest and adoption status; and
- bounded retained logs.

Jobs that write the same graph/evidence/release resources are serialized or
deduplicated. An automatic update can attach to an identical in-flight job
instead of spawning another. A newer revision can supersede a queued job before
CPU work begins.

The browser receives progress through an event stream and can reconnect after
reload. Editing remains enabled unless the specific selected object is in a
conflicting gesture/action. A completed result is adopted only if its inputs
remain current; otherwise it is labeled stale and may still seed caches.

### 9. Make Build a content-addressed snapshot DAG

Build should capture an immutable authoring snapshot, return a job immediately,
and execute dependency stages with visible progress.

Each stage records input/output digests and reuses a valid prior result:

- source normalization and segment elevation;
- base topology and base elevation;
- traversal policy and Overlay V2 validation;
- junction/crossing/roundabout publication inputs;
- public CW geometry and segment data;
- routing shards and manifests;
- route/catalog/snapshot derivatives; and
- final release validation/report.

Full validation still runs for the release snapshot. Content-addressed reuse
means “full validation” does not require recomputing unchanged elevation or
geometry.

The user may continue editing while the snapshot builds. If the current source
advances, the finished build is shown as successful for its snapshot but stale
for Promote. Promote remains fail-closed and bound to one immutable build
digest.

No fixed Build-duration target should be set until stage telemetry shows cache
hit rates and dominant cold/warm stages. The immediate UX target is transparent
progress and non-blocking work.

### 10. Apply the same boundaries to secondary workflows

- Route Catalog recomputes entries whose route token or relevant classification
  inputs changed. Cache the route manager/assets by manifest digest and decoded
  result by token digest.
- Image candidates and map previews reuse the decoded route state.
- Roundabout, crossing, and junction data load when their lens, overlay, or
  selected dependency needs them; review writes return narrow patches.
- Video Sync keeps its current local-edit/explicit-save pattern and isolated
  map sources.

## User experience during background work

The UI should present milestones and scope, not pipeline jargon:

```text
Saved
Routing path updating for #319 · Matching
```

or:

```text
Base edge saved
Updating 3 affected segments · 2 current · 1 checking
```

The last valid route remains visible while a revised draft is evaluated. Draft
geometry is visually distinct but fully editable. Selecting another object does
not replace the operation's status; a compact activity center retains it.

Heavy work exposes:

- why a full calculation is required;
- affected scope;
- stage and elapsed time;
- whether editing can continue;
- cancel/retry when safe; and
- whether the result became stale before completion.

Buttons should be disabled only for a genuine conflicting action, with the
reason visible. A generic page-wide Updating state is not sufficient.

## Activity and performance telemetry

### Recommendation

Track semantic activity and performance spans locally by default. Do not track
raw low-level activity.

The purpose is product diagnosis:

- which workflows are actually used;
- which actions cause expensive work;
- action-to-feedback, action-to-save, and action-to-current latency;
- how often full recalculation occurs and why;
- whether a wait blocks the curator or overlaps productive editing;
- how often jobs are cancelled, superseded, retried, or abandoned;
- which browser work creates long tasks or delayed paint; and
- how payload size/cache state affects latency.

### Semantic events

Useful initiating events include:

- editor session ready/hidden/closed;
- workspace/focus change;
- object selected;
- gesture or form edit committed;
- explicit path completed;
- policy/review decision saved;
- recompute/build/promote requested;
- retry/cancel requested; and
- operation result viewed or issue opened.

Do not emit an event for every mousemove, drag frame, keypress, hover, map pan,
or textarea input. Those are measured through sampled performance spans and
commit boundaries, not recorded as a behavior stream.

### Correlated spans

One `operationId` flows through browser marks, request headers, server jobs,
subprocess/worker stages, response adoption, and the next painted frame.

A conceptual record is:

```json
{
  "schemaVersion": 1,
  "sessionId": "random-local-session",
  "operationId": "random-operation",
  "workflow": "cw-network",
  "action": "cw_vertex_drag_commit",
  "objectType": "segment",
  "objectId": "319",
  "revision": 42,
  "inputDigest": "short-digest",
  "outcome": "current",
  "timings": {
    "inputToPaintMs": 24,
    "durableSaveMs": 118,
    "reconciliationMs": 231,
    "actionToCurrentMs": 412,
    "interactionBlockedMs": 0
  },
  "work": {
    "matcherCache": "hit",
    "fullTopology": false,
    "superseded": false,
    "payloadBytes": 1840
  }
}
```

Object IDs are useful in a private local editor for correlating known hard
cases. Any exported/remote aggregate should remove or hash them unless a user
explicitly includes a diagnostic trace.

### Browser measurements

Use browser performance primitives around:

- event/gesture commit to next paint;
- each invalidation-domain render;
- each collection/index builder;
- Mapbox `setData()` calls and source-ready completion;
- long tasks and delayed event handling;
- JSON clone/serialization time;
- fetch queue/request/parse/adoption time; and
- editor-ready milestones.

Instrumentation must be sampled or disabled inside pointer frames if its own
cost becomes measurable.

### Measuring “time wasted” accurately

Wall-clock operation duration alone is misleading. Record:

- action-to-local-feedback;
- action-to-durable-save;
- action-to-derived-current;
- time a required control or selected object was actually blocked;
- time the editor was visible and focused;
- unrelated committed actions completed while the operation ran; and
- repeated/superseding actions before completion.

This distinguishes a 15-second background job during which the curator edits
three other objects from a 2-second match that freezes every interaction. The
latter can waste more user time despite the shorter wall clock.

Do not infer frustration from dwell time alone. Treat repeated retries,
blocked-action attempts, cancellation, and abandonment as signals that require
context, not as definitive emotional labels.

### Storage, privacy, and control

- Default storage is local, bounded, rotating NDJSON or an equivalent small
  event store under ignored editor state.
- Retention is short and configurable; old sessions are removed automatically.
- The editor exposes recording on/off, inspect/export summary, and delete-all
  controls.
- Remote upload is off by default and requires an explicit configured endpoint
  and user choice.
- Normal records exclude raw coordinates, camera paths, names, descriptions,
  notes, images, route tokens/URLs, video IDs, raw keystrokes, pointer trails,
  screenshots, and personal identity.
- Error details use stable codes and stage names. Stack traces or diagnostic
  bundles are a separate explicit export.
- Performance data must never become an input to routing or publication.

### Useful summaries

The primary local report should show:

- p50/p95 action-to-paint, save, and current by semantic action;
- longest browser render/source-update domains;
- number and total duration of long tasks;
- matcher cache hit rate and setup/match time;
- incremental versus full topology count and causes;
- user-blocked time per session/workflow;
- job cancellation/supersession/retry rate;
- payload bytes and parse time by endpoint;
- Build stage duration and cache hit/miss; and
- the top operations responsible for total blocked time.

## Performance targets

These are experience targets to validate with telemetry, not guarantees derived
from the current code:

| Experience | Target |
| --- | --- |
| Segment/edge selection to visible update | p95 under 100 ms |
| Pointer/drag visual update | p95 frame under 32 ms; no interaction-caused task over 100 ms |
| Metadata/POI commit to local feedback | under 50 ms |
| Ordinary local durable save | p95 under 500 ms |
| Warm CW geometry edit to current path | p95 under 750 ms after the idle boundary |
| Explicit edge path validation | p95 under 500 ms for ordinary paths |
| Routine manual-edge/way-policy derived update | p95 under 2 seconds for incremental cases |
| Full topology fallback | never blocks unrelated editing; stage visible within 250 ms |
| Base/CW presentation source | never resent for hover, selection-only, or theme-only changes |
| Automatic full calculation | zero for metadata-only, POI-only, selection, filter, and view changes |
| Release Build | progress visible; editing continues; duration reported by cold/warm stage |

If graph presentation cannot meet the first-load target after compact payloads
and caching, introduce viewport chunks/tiles before trying micro-optimizations
inside the current 49 MB response.

## Recommended investment order

This is prioritization of design value, not an implementation plan.

| Priority | Design investment | Expected effect | Evidence confidence |
| --- | --- | --- | --- |
| P0 | Persistent semantic/performance correlation | Establish real blocked-time and p95 baselines; prevent optimizing rare paths | High |
| P0 | Invalidation-domain rendering and versioned Mapbox sources | Remove interaction jank across nearly every workflow | High from code structure; needs browser profile |
| P0 | Digest-keyed persistent matcher | Reduce routine CW match from ~2.47 s toward the ~0.20 s measured upper bound | Very high |
| P0 | One server-owned authoring operation with per-segment delta persistence | Remove serial round trips, aggregate rewrites, and partial states | High |
| P1 | Compact/lazy graph presentation plus on-demand detail | Faster startup/base switching and lower parse/Mapbox worker cost | High |
| P1 | Immutable OSM core plus incremental manual/override graph deltas | Turn the normal ~15 s base edit into affected-edge work | High value; architectural effort is material |
| P1 | Persistent job registry, resource locks, and progress stream | Avoid duplicate work and make heavy operations non-blocking/recoverable | High |
| P2 | Content-addressed release DAG | Reduce repeat Build time and make stale snapshots understandable | Medium until stage telemetry |
| P2 | Cached incremental Route Catalog decode/classification | Improve secondary workflow at larger catalog scale | Medium |

The matcher worker and client invalidation work address different symptoms and
should both be treated as core. Fixing only the matcher will leave sluggish
selection/forms; fixing only rendering will leave a visible multi-second route
update after every geometry commit.

## Alternatives rejected

### Increase every debounce

This reduces how often work starts but increases how long the user waits after
finishing. It also does not reduce the cost of one operation. Debounce should
coalesce gestures, not conceal inefficient computation.

### Restore manual Save/Recalculate/Refresh stages

This moves scheduling burden back to the curator and recreates the workflow the
Network Editor consolidation intentionally removed. Heavy fallback work can be
explicitly explained without making routine consistency manual.

### Full React rewrite first

The editor's large imperative module should eventually be modularized, but a
framework does not automatically prevent global state invalidation or Mapbox
`setData()` churn. Introduce dependency boundaries and measurable presentation
contracts first; migrate individual panels later if it improves maintainability.

### Move all computation to browser Web Workers

Workers can protect the main thread, but duplicating the 49–69 MB routing graph
in browser memory and rebuilding indexes per page load does not solve reusable
server computation or release pipelines. Use workers for client projections
that remain expensive after invalidation is fixed.

### Track every click or add session replay

That creates privacy and analysis noise while missing server-stage causality.
Semantic operation traces answer the performance question more directly.

### Skip full validation after incremental updates

Incremental authoring needs local validation, and release still needs complete
verification. Performance must come from dependency reuse, not weaker safety.

## Risks and guardrails

- **Stale caches:** every cache is digest/version keyed; responses name their
  inputs; stale results never become current.
- **Worker divergence:** persistent matcher results are continuously compared
  with the current CLI oracle on representative fixtures.
- **Incremental graph bugs:** release materializes and fully validates the
  graph; debug mode can compare incremental state with a clean rebuild.
- **Patch conflicts:** source/object patches use expected revisions and return
  conflict details, never silent last-write-wins across tabs.
- **Multi-file consistency:** server jobs own transactional ordering and
  rollback/checkpoint behavior for related overlay/compatibility outputs.
- **Map tile/chunk complexity:** stable IDs and selected-detail lookup are part
  of the presentation contract before choosing an encoding.
- **Instrumentation overhead:** sample expensive observations, benchmark the
  telemetry itself, and make it easy to disable.
- **Telemetry sensitivity:** local-first storage, narrow schema, short
  retention, and explicit diagnostic export are non-negotiable.
- **Build while editing:** Build uses an immutable snapshot and Promote checks
  its digest against current authoring state.

## Validation approach for the eventual implementation

Performance validation should combine deterministic tests and real traces:

- unit-test invalidation declarations and guarantee that unrelated domains do
  not render;
- assert selection/hover/theme changes do not call `setData()` on stable graph
  or CW presentation sources;
- browser-test a vertex drag while matching, selection changes during matching,
  and editing another segment during topology fallback;
- keep the production-path matcher benchmark and add worker/CLI equivalence;
- compare incremental base updates with a clean full topology on fixtures and
  periodically on current data;
- simulate multiple tabs/reload and verify job attachment, conflict handling,
  and stale result rejection;
- measure cold/warm startup, payload parse, Mapbox source readiness, and
  action-to-paint on a representative machine; and
- require a before/after local telemetry summary for changes claimed to improve
  responsiveness.

## Open product/architecture questions

- Is the Base workspace required to paint all 48,895 edges at every zoom, or
  can viewport chunks/tiles satisfy exploration and editing?
- Should object IDs remain in local telemetry by default, or be enabled only in
  diagnostic mode?
- How long should locally retained activity sessions remain useful—seven days,
  a fixed number of sessions, or a size cap only?
- Which structural base changes truly require a full topology rebuild after an
  incremental manual/override graph exists?
- Should Route Catalog and Video Sync join the general operation/job registry
  immediately, or remain isolated until Network responsiveness is stable?

These questions do not block the core decisions: scope rendering, cache the
matcher, patch routine base changes, make heavy work a reconnectable snapshot
job, and correlate semantic activity with end-to-end performance.

## Settled recommendations

- Preserve the immediate/durable/derived/release separation.
- Make rendering and Mapbox updates dependency-scoped.
- Do not load or resend the all-purpose full graph for ordinary CW interaction.
- Implement the already-justified persistent matcher design.
- Make one server operation own a CW edit's derived transaction.
- Store editor-derived changes per object and compact aggregates deliberately.
- Compose routine base edits incrementally over an immutable OSM core.
- Keep full topology and full release validation as explicit/fallback work.
- Make long jobs visible, reconnectable, cancellable where safe, and bound to
  immutable inputs.
- Track local semantic activity plus performance spans; do not record raw user
  content or low-level behavior.
- Optimize against total user-blocked time and p95 action latency, not merely
  subprocess wall time.
