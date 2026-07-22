# Editor Responsiveness and Performance — Implementation Plan

Date: 2026-07-22

Status: Slices 1 and 3 delivered; high-cost portion of Slice 2 delivered;
Slices 4–6 and the remaining render scheduler work remain staged

## Outcome

Make ordinary editor interaction immediate while retaining strict, revisioned
background reconciliation and full release validation.

## Delivery boundaries

- Preserve concurrent user/agent changes outside the files touched by a slice.
- Keep `data/map-source.geojson` and authored routing/review data unchanged by
  tests and benchmarks.
- Retain the current matcher CLI as an equivalence oracle and fallback.
- Keep Build and Promote fail-closed.
- Introduce no remote analytics dependency; telemetry is local and bounded.
- Land narrow, independently testable slices instead of rewriting the editor.

## Slice 1 — Persistent single-segment matcher

- [x] Extract a prepared matcher that filters the graph and builds projection,
  spatial, and connectivity indexes once.
- [x] Add an NDJSON Python worker with ready/result/error messages.
- [x] Add a server-side digest-keyed worker controller with request correlation,
  abort-safe result discard, restart, and subprocess fallback.
- [x] Preserve current response schemas and add non-semantic runtime/cache timing.
- [x] Add prepared-vs-one-shot equivalence tests and a worker benchmark.

Validation:

- focused Python matcher tests;
- editor workflow/static wiring tests;
- subprocess benchmark retained as baseline;
- persistent-worker benchmark demonstrates cache reuse.

## Slice 2 — Scoped client and Mapbox invalidation

- [ ] Introduce a general render scheduler with named presentation domains.
- [x] Replace broad renders on the measured high-frequency segment selection,
  draw-pointer and direction-edge-hover paths with domain-specific updates.
- [x] Give the high-cost Mapbox sources semantic revision keys and route the
  changed source writes through one tested adapter.
- [x] Keep hover and selection in their existing dedicated sources so the full
  source set is not revisited.
- [x] Defer hidden Base graph/direction sources until the active workspace or
  edit context needs them.
- [x] Add source/render timing and unit/static tests for the delivered paths.
- [ ] Continue replacing broad renders only where local timing identifies a
  material p95 cost; do not convert every call speculatively.

Validation:

- existing network/editor wiring tests;
- browser smoke for selection, drag, and direction-edge hover;
- development metrics show source writes by ID and render-domain duration.

## Slice 3 — Local activity/performance telemetry

- [x] Add a small allow-listed schema for semantic operations and performance
  spans.
- [x] Generate a local browser session ID and capture workspace/segment-safe
  context for the delivered actions.
- [x] Capture full/selection render, map-source, authoring-stage and matcher
  durations, including success/error/abort outcomes where applicable.
- [x] Persist bounded rotating NDJSON locally under ignored editor state.
- [x] Add local enable/disable, summary and delete endpoints; do not collect authored content,
  coordinates, raw input, pointer trails, route tokens, or images.
- [ ] Add operation IDs spanning browser and server when Slice 4 consolidates
  authoring into one server-owned operation.
- [ ] Add durable-save, payload-size, supersession and blocked-time events after
  those lifecycle boundaries are authoritative on the server.

Validation:

- schema/redaction/rotation unit tests;
- endpoint tests with temporary telemetry storage;
- one editor session produces correlated browser/server records.

## Slice 4 — Server-owned authoring operation and delta persistence

- Consolidate match, match-result persistence, and V2 validation behind one
  revisioned server operation while preserving the early durable-source ACK.
- Store per-segment derived editor results and compact aggregate compatibility
  files at controlled checkpoints/release boundaries.
- Return narrow client patches and progress stages.
- Add a job registry/resource keys so duplicate or conflicting shared work is
  coalesced or serialized and can be observed after browser reload.

Validation:

- operation revision/conflict/cancellation tests;
- aggregate output equivalence after compaction;
- multi-tab/reload job-attachment test.

## Slice 5 — Compact graph presentation and incremental base deltas

- Separate compact Base map presentation from selected-edge detail.
- Cache parsed/enriched graph artifacts by digest and load detailed properties
  on demand.
- Compose immutable OSM topology with mutable manual-edge and traversal-override
  deltas.
- Maintain edge/way-to-segment dependency indexes and revalidate affected
  alignments only.
- Retain full topology as a visible fallback and release verification oracle.

Validation:

- compact/full presentation identity tests;
- incremental-vs-clean topology comparison on fixtures and current data;
- base edit browser test confirms unrelated editing remains available.

## Slice 6 — Snapshot release jobs and secondary workflows

- Run Build as an immutable, reconnectable job with streamed stage progress.
- Reuse content-addressed outputs where input digests match.
- Mark a completed build stale rather than interrupting current editing.
- Cache Route Catalog route runtime and recompute only changed-token entries.
- Keep Video Sync isolated and explicit-save.

Validation:

- cold/warm Build stage report and stale-snapshot behavior;
- Promote accepts only the exact current successful build digest;
- Route Catalog changed-entry equivalence.

## Performance gates

- Selection-to-visible-update p95 below 100 ms.
- Drag feedback contains no interaction-caused task above 100 ms.
- Warm CW segment reconciliation p95 below 750 ms after the idle boundary.
- Metadata/POI/view changes never run the matcher or full topology.
- Stable Base/CW presentation sources are not resent for hover/theme/selection.
- Routine manual-edge delta work targets p95 below two seconds; full topology
  remains a non-blocking fallback.

Each completed slice records before/after measurements in this document rather
than relying on perceived improvement alone.

## Delivered measurements

Measured on 2026-07-22 against the current 48,895-edge Base graph and 291
active CW segments:

| Workflow | Before | After | Result |
| --- | ---: | ---: | --- |
| Single-segment matcher, reusable setup | about 2.47 s/request | 1.3 ms warm median, 3.3 ms warm p95 | Persistent digest-keyed worker; 8/8 measured requests were cache hits |
| Full initial editor render | 9,097.7 ms | 216.4 ms | 97.6% reduction after caching the graph-edge ID index and deferring hidden Base sources |
| Segment selection presentation | 44.8 ms | 16.4 ms | 63.4% reduction with a selection-only render domain |
| Drawing pointer movement | broad `updateMapSources()` | three draw sources only | Stable Base/CW/segment sources are no longer revisited per pointer event |
| Direction-edge hover | broad `updateMapSources()` | two highlight sources only | Stable sources are no longer revisited per hover event |

Slices 1 and 3 are delivered. Slice 2 is delivered for the measured high-cost
paths and now has source/render timing to guide further narrowing. Slices 4–6
remain separate follow-up architecture work: they change persistence and release
ownership, so they should proceed only after the concurrently moving authoring
contracts settle.

Focused review validation on 2026-07-22 passed JavaScript syntax checks, worker
controller tests, prepared-matcher equivalence tests, map-source adapter tests,
activity redaction/storage tests and Direction Review wiring tests. The worker
benchmark loaded the graph once in about 2.27 s and then served all eight warm
requests from the prepared cache.

The local activity log is enabled by default but can be disabled in the editor
toolbar. It stores only allow-listed action/timing fields under ignored
`editor/.drafts/activity/`, rotates at 5 MB, and exposes a local p50/p95 summary
and delete endpoint. It rejects geometry, authored text, notes, raw input,
images, and unrecognized context fields.
