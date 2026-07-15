# Navigation Way Names Implementation Plan

**Date:** 2026-07-16
**Status:** Proposed; no implementation started
**Design:** `plans/navigation-way-names/design.md`

## Goal

Introduce rider-facing way and facility names without changing the identity,
geometry, ownership, or share encoding of existing CycleWays segments.

The implementation is complete when:

- every active segment is explicitly classified as a named-way member, a
  standalone named feature, or intentionally unnamed;
- the build publishes one versioned guidance asset and blocks invalid data;
- computed routes retain exact segment spans and also expose guidance spans and
  contiguous route runs;
- web and native planning surfaces render the same rider-facing itinerary while
  retaining exact section inspection;
- navigation uses guidance identity for wording but topology for maneuvers;
- internal boundaries within one way are silent;
- `גשר עינות ירדן` behaves as a standalone bridge landmark;
- old route links, featured-route snapshots, and persisted navigation records
  fail safely or regenerate; and
- the new behavior can be disabled without rolling back map data.

This is an additive data and presentation change. It must not change route
search costs, route geometry, traversal legality, CycleWays membership, or the
stable identities used by shared routes.

## Delivery order

Land the work in independently testable layers:

```text
schema + validators
    -> build report + editor authoring
        -> generated/versioned assets
            -> exact spans + guidance spans + route runs
                -> web/native planning presentation
                    -> navigation semantics + activation
```

Do not enable rider-facing guidance names while the source is partially
classified. Core and UI work may be exercised with fixtures and an explicit
development flag before activation.

## Rollout gates

| Gate | Required state | Production behavior |
| --- | --- | --- |
| A — schema | Registry, validators, report, and editor are available | Legacy segment-name behavior |
| B — reference corpus | Road 99, its parallel cycleway, `דרך הפטרולים`, bridge, unnamed, split, and overlap cases pass | Legacy behavior; new UI may be tested locally |
| C — data complete | Every active segment has a valid role; connectivity and overlap checks pass | Legacy behavior until activation release |
| D — activation | Complete asset is promoted; web/native/navigation suites and manual checks pass | Guidance names and itinerary enabled |
| E — cleanup | New behavior is stable in production | Optional ID-first compatibility cleanup |

The registry carries a version-controlled enforcement mode:

- `migration`: missing guidance on an active segment is reported but does not
  block Build or Promote;
- `required`: missing or invalid guidance on an active segment blocks Build and
  Promote.

The build computes coverage; the enforcement field never asserts that coverage
is complete. Gate C changes the registry to `required` only after the computed
report is clean.

## Global invariants

- `data/map-source.geojson` remains the canonical owner of segment membership
  through `properties.guidance`.
- `data/navigation-ways.json` is the only canonical named-way registry.
- Generated files under `build/`, `public-data/`, and mobile bundled assets are
  never hand-edited.
- Stable numeric segment ID remains exact segment identity. Current unique
  segment `name` remains a compatibility/editor label.
- A visible name is never used as identity or as a grouping key.
- Source roles are exactly `named-way`, `standalone`, and `unnamed`. Unreviewed
  is represented only by an absent `guidance` object during migration.
- Named-way membership is explicit; no suffix stripping, fuzzy name matching,
  or OSM-text grouping is allowed.
- Named-way members must form one connected non-branching chain or ring.
- The road and a parallel cycleway are distinct guidance identities even when
  they share a corridor or road number.
- Maneuver existence continues to come from route geometry, junction evidence,
  roundabouts, and reviewed crossings. Guidance identity only decorates those
  maneuvers with rider-facing wording.
- A route always retains exact segment spans. Grouped route runs never replace
  section-level warning, POI, quality, or surface ownership.
- Runtime activation is all-or-nothing for a map asset version. It must not mix
  legacy segment names and new guidance names on one route.
- Guidance metadata never enters compact route URLs or route-search weights.
- The first release does not add OSM `name` or `ref` to base-routing shards.

## Task 0 — lock the baseline and reference corpus

**Primary files**

- `tests/fixtures/navigation-way-names/`
- `packages/core/src/navigation/scenarios/routes/`
- `tests/test-segment-spans.mjs`
- `tests/test-navigation-cues.mjs`
- `tests/test-planner-surface-parity.mjs`

**Steps**

- [ ] Record a baseline route and navigation output for the real Road 99
      corridor before guidance behavior changes.
- [ ] Preserve one old compact route URL, one legacy segment-ID URL, one
      featured-route snapshot, and one persisted navigation record as
      compatibility fixtures.
- [ ] Create a small synthetic fixture corpus that covers:
  - [ ] two consecutive internal segments on one named road;
  - [ ] leaving and later re-entering the same road;
  - [ ] a parallel road and cycleway with different way IDs;
  - [ ] a standalone named bridge between two ways;
  - [ ] intentionally unnamed road, dirt-road, and path connectors;
  - [ ] a split parent and two active children;
  - [ ] a chain, a ring, a disconnected way, and a branching way;
  - [ ] overlapping accepted memberships resolving to the same identity;
  - [ ] overlapping accepted memberships resolving to conflicting identities;
  - [ ] two nearby way IDs with the same visible name.
- [ ] Add a real-data reference list by stable segment ID for Road 99,
      `דרך הפטרולים`, the Road 99 cycleway, and `גשר עינות ירדן`. The list is
      curated from the current source; do not infer it from names.
- [ ] Capture current route distance and content fingerprints so later tests can
      prove that naming changes do not affect the route itself.

**Exit criteria**

- The corpus identifies every design edge case without depending on mutable
  array position or internal display-name similarity.
- The baseline fails only in rider-facing naming expectations, not geometry or
  route identity, once later behavior is enabled.

## Task 1 — implement the canonical schema and resolver contracts

**Primary files**

- `data/navigation-ways.json` — new canonical source registry
- `packages/core/src/data/navigationWays.js` — shared JavaScript constants,
  normalization, validation, and presentation fallbacks
- `processing/navigation_ways.py` — build-side validation and publication
- `tests/fixtures/navigation-way-names/schema-cases.json`
- `tests/test-navigation-ways.mjs`
- `tests/test_navigation_ways.py`

**Registry contract**

- [ ] Add `schemaVersion: 1`, `enforcement: "migration"`, and the `ways` object.
- [ ] Validate opaque, non-empty way IDs without deriving behavior from their
      text.
- [ ] Validate each way's `name`, controlled `kind`, optional `ref`, aliases,
      and optional `spokenName`.
- [ ] Reject duplicate aliases within a way and normalize whitespace without
      silently changing canonical names.
- [ ] Allow duplicate visible names across different way IDs; report nearby
      duplicates as a warning rather than merging them.

**Segment guidance contract**

- [ ] Validate role-specific source records:
  - [ ] `named-way` requires a known `wayId`, allows `sectionLabel`, and rejects
        standalone-only fields;
  - [ ] `standalone` requires `name` and `kind`, and rejects `wayId`;
  - [ ] `unnamed` requires `kind`, rejects `name` and `wayId`;
  - [ ] an absent record means unreviewed only while enforcement is
        `migration`.
- [ ] Use exactly the controlled kinds from the design: `road`, `cycleway`,
      `dirt-road`, `trail`, `promenade`, `bridge`, `connector`, `path`, and
      `other`.
- [ ] Define Hebrew class fallbacks and icons in one platform-neutral table.
      `spokenName` is separate from the visual name.
- [ ] Resolve a segment by numeric ID into a neutral record containing role,
      stable guidance identity, visual name, spoken name, kind, way ID, section
      label, and resolution status.
- [ ] Use `way:<wayId>` for named ways, `standalone:<segmentId>` for standalone
      features, and `null` for unnamed/off-network/conflict cases.
- [ ] Represent overlap ambiguity with `resolutionStatus: "conflict"`; do not
      invent a fourth source role or mislabel a conflict as reviewed unnamed.

**Connectivity contract**

- [ ] Implement one documented member-adjacency rule. Prefer reviewed CW/base
      topology where available; use source endpoints only as the validated
      fallback for legacy/unmatched members. Never order members by centroid or
      visible name.
- [ ] Validate one connected component and endpoint degree at most two, allowing
      a chain or a ring.
- [ ] Use the same fixture outcomes in JavaScript and Python so editor and build
      validation cannot drift.
- [ ] Return structured issues with stable codes, segment IDs, and way IDs.
      Human-readable names may accompany an issue but are not its identity.

**Tests**

- [ ] Run every valid and invalid schema fixture through both implementations.
- [ ] Assert parity for issue codes, severity, affected IDs, and coverage
      counts.
- [ ] Assert that display-name equality never creates continuity.
- [ ] Assert that a name edit or spoken-name edit does not change guidance
      identity.

## Task 2 — add build reporting, publication, and asset loading

**Primary files**

- `processing/build_map.py`
- `processing/navigation_ways.py`
- `editor/server.mjs`
- `packages/core/src/data/mapAssets.js`
- `apps/mobile/scripts/sync-offline-assets.mjs`
- `packages/core/src/platform/bundledAssets.native.js` — generated
- `tests/test_navigation_way_build.py`
- `tests/test-map-assets.mjs`
- `tests/test-mobile-roundabout-assets.mjs` or a renamed general manifest-assets
  test
- `tests/test-editor-promote-targets.mjs`

**Build input and report**

- [ ] Add a `--navigation-ways` input with
      `data/navigation-ways.json` as its source-build default.
- [ ] Load the registry and source GeoJSON together and validate references by
      stable segment ID.
- [ ] Add a `navigationWays` report section with:
  - [ ] active, reviewed, and unreviewed segment counts;
  - [ ] counts by role and kind;
  - [ ] way count and active member count;
  - [ ] disconnected, branching, empty, unknown-ID, invalid-role, and overlap
        conflict counts;
  - [ ] stable issue codes and bounded example ID lists;
  - [ ] a computed `coverageComplete` boolean.
- [ ] Treat missing active classifications as warnings in `migration` and
      blockers in `required`. All other schema, connectivity, and conflicting
      overlap errors block immediately in both modes.
- [ ] Keep draft, deprecated, and legacy segments out of active coverage and
      active-way connectivity, while preserving their metadata for diagnostics.

**Generated data**

- [ ] Publish normalized resolved guidance metadata into each active
      `segments.json` entry without changing the current name-keyed outer
      object.
- [ ] Publish `id`, `guidanceRole`, `navigationWayId`, `navigationName`,
      `navigationKind`, and optional `sectionLabel` in processed CycleWays
      GeoJSON. Do not expose `spokenName` in map-label properties.
- [ ] Generate `public-data/navigation-ways.json` with:
  - [ ] schema version and a canonical guidance-data digest;
  - [ ] normalized way records;
  - [ ] way ID to ordered active segment IDs;
  - [ ] segment ID to resolved guidance record;
  - [ ] computed coverage summary and readiness state.
- [ ] Order chain members deterministically by topology. For a ring, choose a
      deterministic stable-ID start and orientation; runtime continuity must
      not depend on that display order.
- [ ] Include the guidance asset in the combined map version digest, immutable
      versioned copies, manifest path, manifest hashes, build runtime output,
      Promote targets, cleanup protection, and editor Build/Promote summaries.

**Runtime loading**

- [ ] Load the manifest-referenced guidance asset in `loadMapAssets` and expose
      `navigationWaysData` plus coverage/version summary fields.
- [ ] If an old manifest has no guidance asset, return `null` and keep legacy
      behavior. Do not request an unversioned fallback asset silently.
- [ ] Add the manifest field to native offline asset discovery, hash checking,
      copying, and generated `require()` mappings.
- [ ] Extend editor promotion tests so the guidance asset is copied before the
      mutable public manifest and protected during cleanup.

**Exit criteria**

- A migration-mode build can publish a partial asset but marks it not ready.
- A required-mode build with one active unclassified segment fails before
  Promote.
- Web and native load the exact same guidance-data digest as the map bundle.
- Removing the manifest field reproduces current legacy behavior without a
  crash.

## Task 3 — add editor authoring and bulk sequential assignment

**Primary files**

- `editor/editor.js`
- `editor/index.html`
- editor stylesheet files
- `editor/server.mjs`
- `editor/lib/navigation-ways.mjs` — new pure editor helpers
- `tests/test-navigation-way-editor.mjs`
- `tests/test-navigation-way-editor-wiring.mjs`
- `tests/test-editor-poi-validation.mjs` — preserve existing source-validation
  coverage

**Load/save model**

- [ ] Load the registry alongside `/api/source` and retain both in editor state.
- [ ] Add a combined save endpoint that validates the registry and source
      together before writing either canonical file.
- [ ] Stage both JSON payloads to temporary files, then replace the canonical
      files with rollback on a partial failure. A failed save leaves both editor
      documents dirty.
- [ ] Keep existing source-only callers compatible, but route guidance edits
      through the combined save path.
- [ ] Display migration coverage and blocking/warning issue counts in the
      editor and Build report.

**Per-segment editing**

- [ ] Add an explicit guidance role control with Hebrew labels for named way,
      standalone named feature, and unnamed.
- [ ] For named-way members, provide searchable way selection, create-way
      action, optional section label, and remove/reassign actions.
- [ ] For standalone features, require public name and kind.
- [ ] For unnamed features, require the best fallback kind.
- [ ] Show both the internal editor name and resolved rider-facing preview so
      editors can see that they serve different purposes.
- [ ] Show visual and TTS previews when `spokenName` differs.

**Named-way management**

- [ ] Add create/edit controls for name, kind, ref, aliases, and spoken name.
- [ ] Show member count, total length, ordered members, section labels, and a
      whole-way map preview.
- [ ] Visualize disconnected components, branch nodes, nearby duplicate names,
      and overlapping conflicting memberships.
- [ ] Implement contiguous bulk assignment as a proposal:
  - [ ] choose or create a way;
  - [ ] select start and end segments on the map;
  - [ ] traverse the validated segment-adjacency graph;
  - [ ] auto-propose only when there is one unambiguous contiguous path;
  - [ ] preview every proposed member and assignment removal;
  - [ ] require confirmation before mutating source data.
- [ ] When more than one path exists, require explicit intermediate selections
      or individual assignment. Never choose the geographically nearest branch
      automatically.

**Split/archive behavior**

- [ ] Copy `named-way` membership to both active split children.
- [ ] Copy a section label only with a machine-readable
      `sectionLabelNeedsReview` marker and a visible editor warning.
- [ ] Preserve the deprecated parent's guidance metadata but exclude it from
      active membership indexes.
- [ ] Block splitting a standalone named feature until the editor resolves it
      as one logical feature or reclassifies the children.
- [ ] Copy `unnamed` kind to split children without inventing a name.

**Exit criteria**

- An editor can classify the reference corpus without hand-editing JSON.
- Selecting the ends of an unambiguous road chain proposes the expected stable
  segment IDs in sequence.
- A parallel cycleway is visibly separate and cannot be absorbed by proximity.
- Save, reload, Build, and Promote show the same issue set.

## Task 4 — classify and review the data

**Primary files**

- `data/navigation-ways.json`
- `data/map-source.geojson`
- generated Build report for review only

**Reference corpus first**

- [ ] Create distinct named ways for the actual Road 99 roadway and its
      parallel cycleway.
- [ ] Assign every Road 99 member by stable segment ID and inspect the entire
      member chain on the map.
- [ ] Assign all `דרך הפטרולים` members and review chain continuity.
- [ ] Classify `גשר עינות ירדן` as `standalone` with `kind: "bridge"`.
- [ ] Classify representative unnamed road, dirt-road, trail/path, bridge, and
      connector cases.
- [ ] Perform one real split within a named-way fixture or an isolated test copy
      and confirm inheritance/review behavior.
- [ ] Resolve or explicitly suppress the reference overlapping-membership case
      only after inspecting its accepted traversal evidence.
- [ ] Add section labels where they help distinguish warnings or route
      sections; do not manufacture labels solely to eliminate warnings.

**Full coverage**

- [ ] Work through the build's stable-ID unreviewed queue until every active
      segment has a role.
- [ ] Review each named way as a whole chain/ring, not as independent name
      fields.
- [ ] Check nearby same-name IDs and every road/cycleway parallel corridor.
- [ ] Review every standalone feature and unusually short/long unnamed run.
- [ ] Require a second visual review for safety-sensitive road versus cycleway
      classifications.
- [ ] Rebuild after each batch and record coverage deltas.
- [ ] Change registry enforcement from `migration` to `required` only after the
      full build report has zero active unreviewed segments, zero invalid ways,
      and zero unresolved guidance conflicts.

**Exit criteria**

- Coverage is 100% for active CycleWays segments.
- The reference corpus has explicit expected identities in automated fixtures.
- No classification was derived by parsing an internal segment name.
- A required-mode Build succeeds from a clean checkout.

## Task 5 — retain exact segment spans and derive guidance spans

**Primary files**

- `packages/core/route-manager.js`
- `packages/core/src/routing/routeActions.js`
- `packages/core/src/routing/shardedRouteSession.js`
- `packages/core/src/routing/routeReducer.js`
- `packages/core/src/routing/routeSnapshot.js`
- `tests/test-segment-spans.mjs`
- `tests/test-guidance-spans.mjs`
- `tests/test-route-reducer.mjs`
- `tests/test-react-route-actions.mjs`

**Exact spans**

- [ ] Evolve each exact span to carry canonical `segmentId`, `internalName`, and
      `onCycleways` fields.
- [ ] Retain `cwSegmentId`, `name`, and `onNetwork` aliases during the additive
      release so existing callers and old fixtures keep working.
- [ ] Resolve direction-scoped membership over every traversal slice rather
      than treating the first CycleWays membership as authoritative.
- [ ] Preserve exact boundaries needed by warnings, POIs, quality, and editor
      diagnostics even when adjacent spans share a guidance identity.

**Guidance spans**

- [ ] Pass `navigationWaysData` through route-manager creation and sharded
      session reloads.
- [ ] Build guidance spans directly from ordered traversals and all accepted
      direction-scoped CycleWays memberships; do not derive them from the
      unclipped `selectedSegments` list.
- [ ] Merge adjacent traversal pieces only when guidance identity and current
      facility semantics agree.
- [ ] When all covering memberships resolve to one identity, retain all exact
      segment IDs on the span.
- [ ] When memberships conflict, emit a null-name conservative span with
      `resolutionStatus: "conflict"`, add a structured routing-validation issue,
      and use facility-class fallback presentation.
- [ ] Keep `onCycleways` independent of whether a guidance name exists.
- [ ] Attach the guidance-data digest to each route snapshot.
- [ ] Store `guidanceSpans` in route state and preserve them through snapshot,
      undo/redo, clear, proposal, and route restore paths.

**Tests**

- [ ] Consecutive Road 99 segments produce multiple exact spans but compatible
      guidance spans.
- [ ] Same visible name with different IDs does not merge.
- [ ] Parallel road/cycleway conflicts never choose the first membership.
- [ ] Standalone bridge and unnamed connector spans retain their roles.
- [ ] Old managers/assets with no guidance data produce no guidance spans and
      preserve current behavior.
- [ ] Route geometry, distance, elevation, attestation, and share encoding are
      byte-for-byte or tolerance-equivalent to the Task 0 baseline.

## Task 6 — build the shared route-run and map-presentation model

**Primary files**

- `packages/core/src/ui/routeItinerary.js` — new
- `packages/core/src/ui/routeGuidanceMap.js` — new
- `packages/core/src/ui/routePlannerPresentation.js`
- `packages/core/src/routing/routeActions.js`
- `tests/test-route-itinerary.mjs`
- `tests/test-route-guidance-map.mjs`
- `tests/test-planner-build-model.mjs`
- `tests/test-planner-surface-parity.mjs`

**Itinerary derivation**

- [ ] Group adjacent guidance spans with the same non-null identity into one
      route-occurrence run even when surface/class semantics change.
- [ ] Give every occurrence a deterministic route-local ID containing its
      distance occurrence; leaving and re-entering the same way yields two IDs.
- [ ] Always keep standalone features as rows.
- [ ] Fold a short unnamed connector only when it has no warning, POI, material
      surface/condition change, or standalone landmark value.
- [ ] Give material unnamed runs localized kind fallback names.
- [ ] Aggregate distance, kinds/surfaces, exact segment IDs, section labels,
      warning count, POI count, and mixed-surface state without losing child
      spans.
- [ ] Assign warnings/POIs to a route occurrence using `routeProgressMeters`
      first and exact segment ID as a fallback. Enrich active data points with
      segment ID while retaining `segmentName` compatibility.
- [ ] Keep archived parents and raw internal names out of normal itinerary copy.

**Map helpers**

- [ ] Add a pure distance-range geometry slicer for highlighting one run or
      child section on the computed route.
- [ ] Generate sparse route-only label features from run occurrences.
- [ ] Prioritize standalone landmarks, suppress labels below platform-specific
      length/spacing thresholds, and prevent repeated labels from crowding a
      short area.
- [ ] Keep density policy configurable so native can be stricter than web while
      consuming the same candidate model.
- [ ] Generate a whole-way context filter from the published way-to-segment-ID
      index; this is separate from exact selection and route-run highlight.

**Planner model changes**

- [ ] Expose itinerary rows and selected-run state from the shared build model.
- [ ] Remove rider-facing `מקטעי CW` count from normal route statistics while
      retaining the count in diagnostics.
- [ ] Group warning headings by guidance run/section rather than raw internal
      name.

## Task 7 — implement web planning presentation

**Primary files**

- `packages/core/src/app/useCyclewaysApp.js`
- `src/App.jsx`
- `src/components/frontPanel/BuildPanel.jsx`
- `src/components/DownloadModal.jsx`
- `src/components/DataMarkerCard.jsx`
- `src/components/featured/Warnings.jsx`
- `src/map/MapSurface.jsx`
- `src/map/mapInteractions.js`
- `src/map/mapLayers.product.js`
- relevant web CSS files
- `tests/test-map-interactions.mjs`
- `tests/test-map-layers.mjs`
- `tests/e2e/navigation-way-itinerary.spec.mjs`

**Network inspection**

- [ ] Return stable segment ID and internal name from map hit-testing.
- [ ] Keep hover/focus on one exact feature even when many features share the
      same `navigationName`.
- [ ] Change the card eyebrow from the internal concept of “segment” to a
      rider-facing facility/section label.
- [ ] Use resolved guidance name as the title. Show optional section label,
      exact distance/elevation/quality, and warnings for the selected segment.
- [ ] If guidance naming is disabled or the asset is not ready, render the
      current card unchanged.
- [ ] Add `הצגת כל הדרך` only for named-way members. It draws a lighter context
      highlight for all active member IDs without changing exact focus.
- [ ] Do not label the entire unselected network with CycleWays way names.

**Built route**

- [ ] Add an ordered, collapsible itinerary to the Build panel.
- [ ] Collapsed rows show rider-facing name/fallback, distance, surface summary,
      and warning/POI indicators.
- [ ] Expanded rows show exact curated sections, conditions, and warnings
      without exposing technical IDs or archived parent names.
- [ ] Selecting a row highlights only that route occurrence using its distance
      range. Selecting a child highlights only that exact section range.
- [ ] Render sparse route-only label features above the built route and below
      critical POI/navigation overlays.
- [ ] Update route summary, download modal, warning labels, and data-marker
      context to use guidance names with optional section labels.
- [ ] Preserve keyboard focus, RTL order, hover behavior, and mobile-web sheet
      behavior.

**Web acceptance**

- [ ] Hovering two Road 99 segments shows the same title but distinct section
      detail and exact highlight.
- [ ] Whole-way context never changes the route or selects every member.
- [ ] A route that leaves and re-enters Road 99 shows two selectable Road 99
      rows.
- [ ] `גשר עינות ירדן` remains visible as its own short row and label.
- [ ] Unnamed sections never display their internal editor name.
- [ ] Labels remain sparse at representative desktop and mobile-web zooms.

## Task 8 — implement native planning presentation

**Primary files**

- `apps/mobile/src/screens/BuildScreen.jsx`
- `apps/mobile/src/planner/PlannerSheet.jsx`
- `apps/mobile/src/planner/NavPanel.jsx`
- the existing `BuildPanelContent`/`BuildPanelFooter` sections in
  `apps/mobile/src/screens/BuildScreen.jsx`
- new native itinerary row/section components under `apps/mobile/src/planner/`
  as needed
- `packages/core/src/ui/routeItinerary.js`
- `packages/core/src/ui/routeGuidanceMap.js`
- `tests/test-planner-surface-parity.mjs`
- native wiring/style tests following existing repository conventions

**Map interaction**

- [ ] Keep the existing route-construction tap gesture unchanged; do not turn a
      normal map tap into segment inspection.
- [ ] Render sparse route-only native `SymbolLayer` labels from the shared
      candidate model with stricter density than web.
- [ ] Prioritize standalone landmarks and suppress internal section labels.
- [ ] Render selected run/section geometry as a distinct route overlay without
      replacing the main route.

**Build sheet and summary**

- [ ] Render the same ordered runs, copy, counts, and expansion semantics as
      web.
- [ ] Tapping a run highlights it, temporarily lowers the sheet enough to show
      the map selection, and leaves a compact selected-row affordance visible.
- [ ] Tapping a child section highlights its exact range and surfaces its
      warning/condition detail.
- [ ] Replace the current raw `selectedSegments` list in the native route
      summary with the shared itinerary.
- [ ] Keep warnings and POIs associated with exact sections while using
      guidance names as primary copy.
- [ ] Verify RTL layout, Dynamic Type, VoiceOver labels, sheet dragging, and
      selection clearing.

**Native acceptance**

- [ ] Route building taps, point dragging/removal, undo/redo, sharing, and GPX
      export are unchanged.
- [ ] Web and native produce identical route-run IDs and semantic row content
      from the same fixture.
- [ ] Native may show fewer map labels, but never different names or grouping.
- [ ] Starting a ride carries the exact guidance-data digest and spans shown in
      Build.

## Task 9 — make route transformations and snapshots guidance-aware

**Primary files**

- `packages/core/src/navigation/navigationRoute.js`
- `packages/core/src/navigation/effectiveNavigationRoute.js`
- `packages/core/src/navigation/approachLeg.js`
- `packages/core/src/navigation/ridePlan.js`
- `packages/core/src/data/featuredRouteSnapshots.js`
- `scripts/build-featured-route-snapshots.mjs`
- `packages/core/src/navigation/navigationSession.js`
- `packages/core/src/navigation/persistencePolicy.js`
- `apps/mobile/src/navigation/activeNavigationStore.js`
- `apps/mobile/src/navigation/navigationResume.js`
- `apps/mobile/src/navigation/navigationRuntime.js`
- related navigation/snapshot tests

**Transforms**

- [ ] Reconcile guidance spans to the navigation route's cumulative-distance
      frame alongside exact segment spans.
- [ ] Apply the same reverse, clip, loop rotation, approach, and rejoin distance
      remapping to both span families.
- [ ] Preserve guidance identity and exact member IDs through transforms; never
      rebuild identity from visible text.
- [ ] Add transform tests for boundaries at zero/end, wrapped loop spans, reverse
      order, clipped standalone bridge, and re-entry into the same way.

**Snapshots and compatibility**

- [ ] Include the guidance-data digest and guidance spans in navigation route
      identity/fingerprints where rider-facing cue content depends on them.
- [ ] Bump the navigation maneuver-generator version when cue semantics change.
- [ ] Version persisted session/voice memory as needed so a segment-name cue is
      not replayed after restoring into guidance-name behavior.
- [ ] On a digest/version mismatch, rebuild the navigation route and cues from
      immutable route evidence plus current guidance data. If rebuilding is not
      possible, discard the stale active session safely and keep the planned
      route available.
- [ ] Add the guidance digest to generated featured-route snapshots.
- [ ] Make the snapshot checker fail stale guidance versions and regenerate all
      promoted snapshots at activation.
- [ ] Keep compact/shared route encodings unchanged and prove old URLs
      recompute into the new presentation.

## Task 10 — replace segment-name navigation semantics

**Primary files**

- `packages/core/src/navigation/routeProgress.js`
- `packages/core/src/navigation/navigationCues.js`
- `packages/core/src/navigation/navigationPresentation.js`
- `packages/core/src/navigation/navigationVoice.js`
- `packages/core/src/navigation/cueHaptics.js`
- `packages/core/src/navigation/navigationSession.js`
- `packages/core/src/navigation/scenarios/routes/`
- `tests/test-route-progress.mjs`
- `tests/test-navigation-cues.mjs`
- `tests/test-navigation-presentation.mjs`
- `tests/test-navigation-voice.mjs`
- `tests/test-navigation-session.mjs`
- `tests/test-effective-navigation-route.mjs`
- `tests/test-nav-scenarios.mjs`

**Progress context**

- [ ] Resolve current facility from guidance spans and expose identity, visual
      name/fallback, spoken name, kind, surface/class, and `onCycleways`.
- [ ] Resolve “next” as the next different guidance identity, not the next
      internal segment boundary.
- [ ] Retain legacy `currentSegmentName` fields only as temporary aliases for
      disabled/old-data behavior.
- [ ] Change the native current chip from current segment to current
      way/facility, avoiding redundant copies such as `כביש 99 · כביש`.

**Cue decoration**

- [ ] Generate turns/keeps/roundabouts/crossings from existing topology and
      reviewed evidence first, then decorate each maneuver with its before/after
      guidance context.
- [ ] Replace `ontoSegmentName` with guidance-aware visual and spoken fields,
      keeping compatibility aliases only during migration.
- [ ] Suppress all cue creation at an internal segment boundary when guidance
      identity is unchanged.
- [ ] For a real decision that stays on one identity, allow “stay on” wording
      without inventing a name-change maneuver.
- [ ] For a straight identity change without a decision, update current context
      silently.
- [ ] Remove generic `enter-segment` production cues once guidance mode is
      active. The internal segment name is never a fallback.

**Standalone bridge behavior**

- [ ] Add a final-phase, low-priority `cross-feature` cue for entry into a
      standalone `bridge`.
- [ ] Use `חצו את <name>` visually and in TTS, with `spokenName` when present.
- [ ] If a turn, reviewed crossing, or roundabout is coincident, merge bridge
      context into the maneuver instead of producing two cues.
- [ ] Do not let the bridge context suppress or delay a maneuver.
- [ ] Exit silently unless the exit itself contains a real decision.
- [ ] Keep other standalone kinds as current-facility/itinerary context until
      explicit copy is designed for them.

**Fallback and voice**

- [ ] Apply the design fallback order: reviewed name, future reviewed base-road
      name, facility class, then generic continue.
- [ ] In this release, unaligned base edges start at facility class because OSM
      road names are deferred.
- [ ] Use visual `name` in UI and optional `spokenName` only in TTS.
- [ ] Update voice duplicate suppression to compare guidance identity rather
      than visible name so two same-named ways remain distinct.
- [ ] Decide haptics explicitly: merged maneuvers keep their normal haptic;
      standalone bridge context alone has no maneuver haptic.

**Required scenarios**

- [ ] Road 99 internal boundary: no cue, same current way.
- [ ] `דרך הפטרולים` internal boundary: no cue.
- [ ] True turn onto Road 99: name Road 99 once.
- [ ] Decision while staying on Road 99: keep/stay wording as appropriate.
- [ ] Road 99 roadway versus parallel cycleway: correct distinct name.
- [ ] `גשר עינות ירדן`: one useful cross-feature instruction; quiet exit.
- [ ] Named bridge coincident with a turn: one compound instruction.
- [ ] Unnamed connector: class fallback, never internal name.
- [ ] Surface/safety change inside one way: condition cue survives without a
      name transition.
- [ ] Guidance conflict: conservative fallback and no unsafe guessed name.
- [ ] Old persisted session: regenerate or discard safely.

## Task 11 — activation guard, observability, and release

**Primary files**

- `packages/core/src/config/featureFlags.js`
- `packages/core/src/data/mapAssets.js`
- `packages/core/src/app/useCyclewaysApp.js`
- relevant web/native startup diagnostics and analytics helpers
- `data/navigation-ways.json`
- `plans/navigation-way-names/design.md`
- this implementation plan

**Activation guard**

- [ ] Add one shared boolean feature flag, `guidanceWayNames`, defaulting false
      during implementation.
- [ ] Enable new planner and navigation behavior only when the flag is true and
      the loaded asset has a supported schema plus computed complete coverage.
- [ ] If the guard fails, disable the feature for the entire asset/session and
      use legacy behavior; never choose per-span based on availability.
- [ ] Keep the flag as a rollback kill switch after default activation.

**Diagnostics**

- [ ] Include guidance schema version, data digest, coverage state, role counts,
      and conflict count in map-asset/build summaries.
- [ ] Log one bounded startup diagnostic when the feature is requested but the
      asset is absent, stale, incomplete, or unsupported.
- [ ] Include guidance-data digest and fallback/conflict counters in route and
      navigation diagnostics without emitting rider names as analytics keys.
- [ ] Add an editor coverage view sorted by stable ID and way issue code.

**Automated release validation**

- [ ] Run focused schema/build/editor tests.
- [ ] Run focused route-model and planner tests.
- [ ] Run focused navigation tests and the navigation scenario suite.
- [ ] Run `npm run featured:snapshots:check` after regenerating snapshots.
- [ ] Run `npm run mobile:assets` and verify no uncommitted generated-asset
      drift remains beyond expected bundle changes.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:smoke` with the implementation's new itinerary E2E
      included in the configured smoke scope, or run that spec explicitly.
- [ ] Run `git diff --check`.

**Manual editor validation**

- [ ] Create, rename, and delete a test way; undo any test data before release.
- [ ] Bulk-assign an unambiguous chain and inspect the preview.
- [ ] Confirm an ambiguous branch refuses automatic assignment.
- [ ] Split named-way, standalone, and unnamed test cases and inspect outcomes.
- [ ] Build and Promote in required mode from a clean source state.

**Manual web validation**

- [ ] Inspect exact Road 99 sections and whole-way context at several zooms.
- [ ] Build forward, reverse, loop, leave/re-enter, bridge, and unnamed routes.
- [ ] Verify run and section highlight behavior, sparse labels, warnings/POIs,
      keyboard navigation, and RTL copy.
- [ ] Open old route links and promoted featured routes.

**Manual native/navigation validation**

- [ ] Repeat the planner routes on iPhone simulator and one physical device.
- [ ] Verify sheet/highlight behavior, VoiceOver, Dynamic Type, and route-label
      density.
- [ ] Simulate the required navigation scenarios in both directions.
- [ ] Listen to visual name versus `spokenName`, road-number pronunciation, the
      standalone bridge cue, and compound maneuver timing.
- [ ] Test foreground, background, crash-resume, stale-session, and flag-off
      rollback behavior.

**Activation sequence**

1. Promote a required-mode, complete guidance asset while the feature default
   remains off.
2. Verify web and native read the promoted digest and all existing route flows
   remain unchanged.
3. Regenerate and promote featured-route snapshots against that digest.
4. Turn `guidanceWayNames` on by default and release web/native together as
   closely as practical.
5. Monitor startup guard failures, conflict/fallback counters, navigation
   session failures, and user-reported wording issues.
6. Roll back by disabling the flag if necessary; do not revert classifications
   or route data.

## Task 12 — post-activation compatibility cleanup

This task is deliberately separate from the first release.

- [ ] Migrate map hover/focus reducer state and filters fully from unique
      internal name to numeric segment ID.
- [ ] Migrate segment metadata joins, warning/POI association, and diagnostics
      to ID-first APIs while retaining old-name adapters at storage boundaries.
- [ ] Rename internal fields such as `name`, `cwSegmentId`, `onNetwork`, and
      `selectedSegments` only after all consumers have explicit replacements.
- [ ] Decide whether internal/editor labels may eventually repeat; do not relax
      current uniqueness in this project.
- [ ] Remove legacy segment-name navigation aliases only after supported old
      snapshots and app versions no longer require them.
- [ ] Measure whether full-network way labels are useful before designing them;
      route-only labels remain the default.

## Explicitly deferred work

- OSM `name`/`ref` publication for unaligned base-routing edges.
- A new base-routing shard schema for off-CycleWays named-road continuity.
- Multilingual visual naming beyond the initial Hebrew canonical name.
- Grouped multi-segment standalone facilities.
- Automatic facility inference from internal names, Mapbox labels, or proximity.
- Route-search cost changes based on way identity.
- Making named-way IDs part of route sharing or replay identity.

Any later OSM naming work must feed the same guidance-span and itinerary
contracts. It must use connected topology and curated overrides, not global
grouping by equal OSM text.

## Definition of done

- [ ] Registry enforcement is `required` and the clean build reports 100%
      active classification with no unresolved blockers.
- [ ] Exact segment spans and guidance spans coexist throughout route state and
      all transforms.
- [ ] Shared itinerary fixtures are semantically identical on web and native.
- [ ] Rider-facing planner surfaces no longer use internal segment names as
      primary copy when guidance mode is active.
- [ ] Internal named-way boundaries produce no navigation cue.
- [ ] Standalone bridge, unnamed connector, parallel cycleway, conflict, reverse,
      loop, and re-entry cases pass automated and manual validation.
- [ ] Old links and snapshots recompute or fall back safely.
- [ ] Full tests, production build, offline asset sync, snapshot check, and smoke
      tests pass.
- [ ] Rollback has been exercised with `guidanceWayNames` disabled.
- [ ] The implementation plan is updated with completion state, actual commands,
      deviations, and any remaining manual gates.
