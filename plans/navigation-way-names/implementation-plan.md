# Navigation Way Names Implementation Plan

**Date:** 2026-07-16
**Last reviewed:** 2026-07-23
**Status:** Forward-navigation foundation implemented; remaining work
re-sequenced after the 2026-07-23 second review and ready for implementation
**Design:** `plans/navigation-way-names/design.md`

## 2026-07-23 re-review outcome

The product model remains valid, but the implementation plan needed a material
correction. The repository already implements the forward-navigation core and
resolves names into `segments.json`; it should not add the previously proposed
second public `navigation-ways.json` runtime asset.

Current measured state:

| Area | Current state |
| --- | --- |
| Canonical data | Registry schema 1 exists with eight pilot ways; 11 of 291 active segments are classified |
| Build | Resolves registry plus source membership into self-contained segment `guidance`; validation is still minimal and there is no coverage/connectivity report |
| Audible names | Way and standalone `spokenName` already flow through the resolver/navigation model; display/audible validation, segment-level legacy support, suggestions, and iOS acceptance are incomplete |
| Exact routing | Complete direction-scoped segment/junction membership sets are retained |
| Guidance routing | Forward routes derive `guidanceSpans`; any unreviewed on-network member makes the route legacy |
| Route state | `guidanceSpans` and `guidanceMode` survive snapshots, reducer updates, and app route state |
| Effective routes | Forward clip and loop rotation preserve guidance; reverse intentionally drops to legacy |
| Navigation | Progress, topology-cue decoration, reviewed-crossing composition, start/join naming, 300 m confirmation, current/next presentation, and voice dedupe are implemented |
| Featured routes | Public snapshot schema 1 and route-catalog projection drop span data and must be upgraded |
| Demo studio | Private route snapshots preserve route state and add junction/crossing evidence; useful for acceptance, not a public snapshot replacement |
| Planner/editor | No route-run itinerary, way labels, whole-way inspection, or guidance authoring UI |
| Release | Current promoted `segments.json` does not contain the pilot guidance; Promote already atomically binds segments, catalog, and snapshots |

The remaining work extends:

- accepted Overlay V2 alignments compiled into policy-bound V3 routing data
  with direction-scoped `cwAlignments` and `cwJunctions` memberships;
- reviewed crossing and network-junction maneuver authority;
- the shared logical-overview, physical-alignment, and junction-footprint map;
- V6 exact restore and historical-anchor current-policy replanning;
- the editor's current render-domain/persistent-matcher architecture; and
- manifest-last atomic Promote.

## 2026-07-23 second review: plan corrections

A second review checked the plan's invariants and sequencing against the real
network and the implemented code. The design records the product-level
corrections; the plan changes are:

| Change | Reason |
| --- | --- |
| Component/degree checks become fingerprint-acknowledged warnings; a material parallel-facility risk requires resolution or exact approval | Five of 46 proposed multi-member ways fail a one-component degree-two rule, two of them on legitimate branching. A geometry-only prohibition would then over-correct by rejecting dual carriageways and two-sided cycleways |
| Unreviewed spans take the class fallback; the route-level legacy demotion is removed | Legacy restores internal editorial speech for a whole route because of one connector, and makes every review batch worthless until the last one lands |
| Reverse guidance moves to slice 1 and is resolved in both directions while the route manager has the guidance index | `reverseRouteAttestation` swaps `cwMembership`/`oppositeCwMembership`, but the later pure reverse transform cannot resolve asymmetric memberships from IDs alone |
| Minimum authoring plus a reference corpus precedes web presentation; full classification continues after the web pilot | Per-span degradation exists specifically so partial data is useful. Requiring all 291 classifications before the itinerary would recreate an avoidable coverage cliff |
| Route-only map labels leave the first release | Highest cost and lowest certainty in the planner work, on top of a base map that already labels major roads |
| Featured snapshots store derived visual itinerary runs, not both span families | Featured pages intentionally avoid planner assets; navigation already starts from the catalog V6 token |
| The long-run confirmation is preview-only | Several seconds of extra speech must not arrive as the rider executes the maneuver; no post-maneuver event contract exists today |
| Fold and material-parallel detector thresholds become shared constants | Web/native row parity and JavaScript/Python validator parity require deterministic thresholds |

Measured facts behind those changes:

- promoted `public-data/segments.json` has 0 of 347 entries with a `guidance`
  record, so the implemented navigation slice is currently dark in production;
- `packages/core/route-manager.js` demotes a whole route to legacy on one
  unreviewed member, and `packages/core/src/navigation/navigationCues.js` then
  emits `enter-segment` cues carrying internal editorial names;
- `packages/core/src/navigation/effectiveNavigationRoute.js` hard-codes reverse
  routes to legacy, while `packages/core/src/routing/routeAttestation.js`
  already carries reversed per-slice CycleWays membership; the resolved
  opposite projection must be produced before the route reaches that pure
  transform;
- `packages/core/src/navigation/navigationVoice.js` appends the long-run
  confirmation regardless of cue phase; and
- the conflict branch in `route-manager.js` nulls `kind`, leaving a conflicting
  span with no facility class to fall back to.

## Goal

Introduce rider-facing way and facility names without changing the identity,
geometry, ownership, or share encoding of existing CycleWays segments.

The implementation is complete when:

- every active segment is explicitly classified as a named-way member, a
  standalone named feature, or intentionally unnamed;
- the build publishes resolved guidance in the versioned segments asset and
  blocks invalid data;
- computed routes retain all exact direction-scoped segment/junction evidence
  and also expose guidance spans and contiguous route runs;
- web and native planning surfaces render the same rider-facing itinerary while
  retaining exact section inspection;
- navigation uses guidance identity for wording but topology for maneuvers;
- internal boundaries within one way are silent;
- `גשר עינות ירדן` behaves as a standalone bridge landmark;
- display names remain clean while optional way/segment audible names preserve
  the Hebrew punctuation needed by iOS TTS;
- the editor begins with digest-bound classification and pronunciation
  suggestions that can be reviewed in groups;
- named network junctions remain road-name-less route spans and never become
  fake itinerary segments;
- old route links, featured-route snapshots, and persisted navigation records
  fail safely or regenerate; and
- the new behavior can be disabled without rolling back map data.

This is an additive data and presentation change. It must not change route
search costs, route geometry, traversal legality, CycleWays membership, or the
stable identities used by shared routes.

## Delivery order

### Implemented foundation

The approved first slice is implemented without activating the broader planner
itinerary or whole-network naming rollout:

- the canonical migration-mode registry exists and the reported-ride members
  are explicitly classified in source data;
- Build resolves those memberships into self-contained runtime segment
  guidance metadata;
- exact route spans retain complete direction-scoped membership sets and routes
  derive guidance spans conservatively (an unreviewed on-network member keeps
  the route on legacy naming behavior);
- navigation suppresses same-way internal boundaries, decorates real topology
  cues with the destination identity, names start/join/reacquisition context,
  and appends long-run distance confirmations at the shared 300 m threshold;
- current/next navigation presentation and voice dedupe prefer guidance
  identity while legacy routes remain compatible; and
- reverse effective routes deliberately fall back to legacy naming until their
  opposite-direction memberships can be freshly resolved.

The remaining tasks below govern full validation, editor authoring, 100%
classification, planner/map itinerary presentation, featured snapshot
compatibility, standalone bridge semantics, reverse-guidance completion, and
promotion.

Land the work in independently testable layers:

```text
per-span degradation + reverse-ready guidance
    -> validators + minimum suggestion-review path
        -> reference-corpus classification
            -> route runs + partial-coverage web pilot
                -> navigation completion + remaining classification batches
                    -> snapshot itinerary schema + native presentation
                        -> required-mode promotion
```

Two ordering rules drive that shape:

- **Representative data before presentation; full coverage before
  enforcement.** Road 99, its separate cycleway, `דרך הפטרולים`, the bridge,
  and representative unnamed spans are enough to evaluate the itinerary. The
  web pilot then helps review later batches.
- **Per-span degradation before anything else.** With it, each review batch
  improves real routes on the next build, so the classification work can be
  paced and verified incrementally instead of landing as one switch.

Do not assemble a route-level naming decision. Every computed route resolves
guidance per span; unreviewed spans present their facility class exactly like
intentionally unnamed spans, and no mode ever falls back to an internal segment
name.

### Recommended implementation slices

Implement the remaining work in these reviewable pull requests:

1. **Runtime degradation and reverse guidance** — the runtime half of Task 5
   plus the reverse work pulled forward from Task 9. Replace the route-level
   legacy demotion with per-span class fallback, give conflict spans a usable
   kind, add the shared class-fallback copy table, pass explicit manifest-bound
   schema context into route construction, and resolve paired forward/opposite
   exact and guidance projections while the route manager has the guidance
   index and direction-scoped junction evidence. Pure model work, no UI, and it
   makes every later data batch immediately visible.
2. **Validator and publication contract** — Tasks 1–2. Extract strict shared
   validation, add fingerprint-bound structure review and the material
   parallel-facility detector, add coverage reporting and
   `manifest.guidance`, and add the in-memory segment/way indexes.
3. **Minimum authoring and reference corpus** — the build-now portion of Task 3
   plus Task 4's reference corpus. Re-score the suggestion artifact through the
   validator, reconsider IDs split only for topology, and classify the named,
   standalone, and unnamed examples needed to judge the feature.
4. **Shared itinerary and web pilot** — Tasks 6–7 without map labels. Land the
   pure route-run model, the web renderer, and the exact-section hover fallback
   against partial coverage. Continue reviewed classification batches after
   this slice rather than hiding them until 100%.
5. **Navigation semantics completion** — remaining Task 10 work. Add standalone
   bridge copy, junction landmark decoration, the preview-only confirmation
   fix, persistence provenance, reverse crossing preservation, and demo-studio
   crossing/name proofs without changing maneuver authority. Complete the
   remaining classification batches in parallel with product validation.
6. **Snapshots and native planning** — Task 9's snapshot half plus Task 8. Ship
   the featured snapshot itinerary schema with a schema-1 legacy loader, fix the
   route-catalog projection, and land the native Build sheet against identical
   fixtures.
7. **Enforcement and release** — Task 11. Switch to `required`, strictly
   regenerate catalog/snapshots, run the release matrix, and Promote.

Slices 1 and 2 are independent and can land in either order. Slice 4 requires
the reference corpus, not full coverage. Full coverage gates slice 7 only.

Each slice must leave old manifests, partially classified routes, and schema-1
snapshots safe. Do not postpone compatibility until the final PR.

## Rollout gates

| Gate | Required state | Production behavior |
| --- | --- | --- |
| A — runtime safety | Per-span class fallback, reverse-ready exact/guidance, and safe class-only rollback pass against injected schema context | No production activation required; pure route/navigation behavior is ready |
| B — pilot publication | Shared validators, fingerprint-bound structure review, material parallel-risk detector, coverage report, `manifest.guidance`, and a migration-mode pilot bundle pass | Classified spans are named; other spans read as their facility class |
| C — reference corpus | Road 99/parallel cycleway, `דרך הפטרולים`, the bridge, and representative unnamed spans pass review | Navigation naming is evaluable on real routes |
| D — web pilot | Route runs, exact hover fallback, web itinerary, and old-data fallback pass | Partial-coverage web itinerary behind the shared kill switch |
| E — release | All active segments are classified; snapshot/native/navigation work and one promoted bundle pass; every structure issue is resolved or exactly acknowledged | Registry changes to `required`; itinerary enabled by default |
| F — cleanup | New behavior is stable in production | Optional ID-first compatibility cleanup |

The registry carries a version-controlled enforcement mode:

- `migration`: missing guidance on an active segment is reported but does not
  block Build or Promote;
- `required`: missing or invalid guidance on an active segment blocks Build and
  Promote.

The build computes coverage; the enforcement field never asserts that coverage
is complete. Enforcement flips to `required` at Gate E after the report reaches
100%. Enforcement is a regression guard, not the switch that turns naming on:
naming is on from Gate B and improves as data lands.

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
- Named-way members should form one connected non-branching logical chain or
  ring using reviewed alignment terminals and published junction attachments,
  but neither connectivity nor degree is a blocking requirement. Multiple
  components and degree above two are warnings acknowledged by exact validator
  issue fingerprint. Membership does not imply bidirectional legality.
- Materially parallel members raise `parallel-facility-risk` even when they
  connect at one end. The issue blocks until the different facility is removed
  or the exact fingerprint is approved as one facility; there is no broad
  geometry-based `allowParallel` switch.
- Authoritative source/routing evidence maps to broad facility classes.
  `facility-class-conflict` is a non-waivable blocker when a member is
  incompatible with the way kind; surface alone is not a class, and a bridge
  may carry its enclosing road/cycleway/trail.
- One real facility is one way ID. Never split a way to satisfy a structural
  check: two IDs sharing a display name produce two itinerary rows, a spoken
  destination name at the seam, and no voice suppression between them.
- The road and a parallel cycleway are distinct guidance identities even when
  they share a corridor or road number.
- Maneuver existence continues to come from route geometry, junction evidence,
  roundabouts, and reviewed crossings. Guidance identity only decorates those
  maneuvers with rider-facing wording.
- A route always retains exact segment spans. Grouped route runs never replace
  section-level warning, POI, quality, or surface ownership.
- A direction-scoped `cwJunctions` membership is on-network but has no way
  identity. Its public `junctionName` is landmark context only.
- Multiple applicable segment or junction memberships are resolved as sets;
  array position zero is never an authority.
- Logical and physical map features resolve through stable segment ID.
  `alignmentKey` is not a rider-facing identity, and public junction footprints
  do not create segment selection.
- Runtime naming degrades per span, never per route. An unreviewed span is
  presented exactly like an intentionally unnamed one; a conflicting span keeps
  a usable facility class. No mode emits an internal segment name.
- `guidanceMode` is still frozen into the route/navigation plan so an asset
  refresh cannot change naming semantics mid-session. It records which guidance
  schema resolved the route, not whether naming was enabled for it. Schema
  support comes from manifest-bound route-manager context, not from whether one
  route encountered a classified record.
- The feature flag freezes a separate named-versus-class-only presentation
  policy. Disabling it never restores internal segment speech.
- Live routes resolve paired forward/opposite exact and guidance projections
  while the route manager has the guidance index and direction-scoped junction
  evidence. Reverse swaps/remaps the pairs and never falls back to legacy
  naming.
- Guidance metadata never enters V6/legacy route URLs, traversal attestation,
  or route-search weights. Exact and recovered routes derive it from the
  resulting current traversal.
- Resolved `segments.json`, the route catalog, and featured snapshots are bound
  into one release index and promoted with the public manifest switched last.
- The first release does not add OSM `name` or `ref` to base-routing shards.

## Task 0 — lock the baseline and reference corpus

**Status:** Partially complete. Existing focused tests cover same-way overlap,
unreviewed-route fallback, forward clip/loop behavior, cue decoration,
progress, session events, presentation, and voice. The broader compatibility
and real-data corpus below is still required.

**Primary files**

- `tests/fixtures/navigation-way-names/`
- `packages/core/src/navigation/scenarios/routes/`
- `tests/test-segment-spans.mjs`
- `tests/test-navigation-cues.mjs`
- `tests/test-planner-surface-parity.mjs`
- `scripts/lib/navigation-route-snapshot.mjs`
- `scripts/demo-studio/`

**Steps**

- [ ] Record a baseline route and navigation output for the real Road 99
      corridor before guidance behavior changes.
- [ ] Preserve one old compact route URL, one legacy segment-ID URL, one
      current `hybrid_route_v6` URL that replays exactly, one V6 URL that uses
      historical-anchor current-policy replanning, one featured-route snapshot,
      and one persisted navigation record as compatibility fixtures.
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
  - [ ] two nearby way IDs with the same visible name;
  - [ ] a same-way transition through a published network junction;
  - [ ] a different-way transition through a named network junction;
  - [ ] a junction in the middle of one logical segment; and
  - [ ] ambiguous multiple junction memberships.
- [ ] Add a real-data reference list by stable segment ID for Road 99,
      `דרך הפטרולים`, the Road 99 cycleway, and `גשר עינות ירדן`. The list is
      curated from the current source; do not infer it from names.
- [ ] Capture current route distance and content fingerprints so later tests can
      prove that naming changes do not affect the route itself.
- [ ] Capture the current manifest/release-index shape and a featured snapshot
      projection so release integration tests detect omitted asset hashes or
      dropped span fields.
- [ ] Add one navigation demo-studio project whose proof window contains a
      reviewed crossing followed by a named-way transition. Assert that the
      compiled private route snapshot contains `guidanceSpans`, `junctions`,
      and `crossings`, and that the recorded cue copy comes from production cue
      generation rather than a studio-only text override.

**Exit criteria**

- The corpus identifies every design edge case without depending on mutable
  array position or internal display-name similarity.
- The baseline fails only in rider-facing naming expectations, not geometry or
  route identity, once later behavior is enabled.

## Task 1 — implement the canonical schema and resolver contracts

**Status:** Partially complete. The registry, three source roles, build-side
resolution, stable identities, controlled kinds, and unknown-way rejection
exist in `processing/build_map.py`. Shared JavaScript/Python validation,
role-field strictness, coverage, connectivity, and issue parity do not.

**Primary files**

- `data/navigation-ways.json` — canonical source registry
- `packages/core/src/data/navigationWays.js` — shared JavaScript constants,
  normalization, validation, and presentation fallbacks
- `processing/navigation_ways.py` — build-side validation and publication
- `tests/fixtures/navigation-way-names/schema-cases.json`
- `tests/test-navigation-ways.mjs`
- `tests/test_navigation_ways.py`

**Registry contract**

- [x] Add `schemaVersion: 1`, `enforcement: "migration"`, and the `ways` object.
- [ ] Validate opaque, non-empty way IDs without deriving behavior from their
      text.
- [ ] Validate each way's `name`, controlled `kind`, optional `ref`, aliases,
      and optional `spokenName`.
- [ ] Validate optional `structureReview.acknowledgedIssueFingerprints` as
      exact shared-validator outputs. Reject broad `allowBranching` or
      `allowParallel` booleans.
- [ ] Treat `name` as clean display text: reject pronunciation-only Hebrew
      punctuation/niqqud and control characters.
- [ ] Validate `spokenName` as optional audible Unicode text, preserving
      combining marks and punctuation exactly. Do not normalize it into the
      display form.
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
- [ ] Allow optional segment-level `spokenName` for legacy/exact-section voice,
      and optional standalone `guidance.spokenName`. A named-way member's
      segment-level value never overrides its way's audible form.
- [ ] Define Hebrew class fallbacks and icons in one platform-neutral table.
      `spokenName` is separate from the visual name. This table is a slice-1
      dependency: unnamed, unreviewed, and conflicting spans all read from it,
      so nothing may reach generic `המשך במסלול` merely because the table was
      not populated for a kind or a route class.
- [x] Resolve a segment by numeric ID into a neutral record containing role,
      stable guidance identity, visual name, spoken name, kind, way ID, section
      label, and resolution status.
- [x] Use `way:<wayId>` for named ways, `standalone:<segmentId>` for standalone
      features, and `null` for unnamed/junction/off-network/conflict cases.
- [ ] Represent overlap ambiguity with `resolutionStatus: "conflict"`; do not
      invent a fourth source role or mislabel a conflict as reviewed unnamed.
      A conflicting resolution still carries a usable `kind`: the shared kind
      when the conflicting memberships agree on one, otherwise a kind derived
      from route class.
- [ ] Represent an absent record with `resolutionStatus: "unreviewed"` and give
      it the same presentation treatment as `unnamed`. The distinction exists
      for validation and coverage reporting, never for rider-facing copy.
- [ ] Model junction context separately from segment guidance resolution. A
      public `junctionName` never resolves to a way or `standalone` identity.

**Structure contract**

- [ ] Build the logical member-adjacency graph from accepted direction-scoped
      alignment terminals and published network-junction arm attachments/legal
      movements. Ignore detected, excluded, and stale junctions and never infer
      connectivity from a junction display footprint.
- [ ] Project reviewed directional connections to an undirected identity graph
      for structure validation, while reporting expected-direction gaps
      separately. Way membership must not grant or imply reverse traversal.
- [ ] Use source endpoint equality only as a structured migration fallback for
      a legacy/unmatched member. Never order members by centroid, proximity, or
      visible name.
- [ ] Report component count and maximum member degree per way. More than one
      component, or degree above two, is a **warning**, not an error.
- [ ] Fingerprint each structure issue from its code, way ID, affected stable
      member IDs, and relevant geometry/alignment/junction evidence digests.
      Store exact acknowledgements in the registry; any material evidence
      change produces a new fingerprint and re-raises review.
- [ ] Add the material parallel-corridor detector. Use shared corridor-distance,
      minimum-overlap, and heading-tolerance constants so brief proximity or a
      crossing does not fire it. Evaluate parallel members even if they connect
      at one end.
- [ ] Define and fixture-test the conservative mapping from authoritative
      source/routing evidence to broad facility classes. Emit non-waivable
      `facility-class-conflict` for an incompatible member/way pairing; do not
      confuse surface with facility class, and allow a bridge to carry the
      enclosing facility.
- [ ] Emit `parallel-facility-risk` as blocking in both enforcement modes until
      the member is removed/reassigned or that exact issue fingerprint is
      approved as one compatible facility. A facility-class conflict cannot be
      approved. Geometry raises the review question; it does not make a road's
      two carriageways invalid by definition.
- [ ] Do not implement any rule whose remedy is splitting one facility into
      several way IDs.
- [ ] Treat a published junction between two members as adjacency without
      adding the junction to membership. A junction in the middle of one
      segment does not split or branch that member.
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
- [ ] Assert that pronunciation punctuation survives JSON load/build/runtime
      projection, never appears in visual fields, and falls back to `name` when
      absent.
- [ ] Assert direct-terminal, through-junction, mid-segment-junction, stale-
      junction, and direction-gap outcomes in both implementations.
- [ ] Assert that a two-component way and a degree-four branching way both warn,
      both pass once acknowledged, and both keep one guidance identity.
- [ ] Assert that Road 99 plus its parallel cycleway raises a blocking
      `parallel-facility-risk` plus a non-waivable facility-class conflict,
      including when they connect at one end.
- [ ] Assert that a dual-carriageway road can be approved as one facility by
      exact fingerprint and remains one guidance identity.
- [ ] Assert that an acknowledgement does not survive a member, geometry,
      alignment, junction, component, branch, or suspicious-pair change covered
      by its evidence.

## Task 2 — finish build validation, reporting, and publication

**Status:** Partially complete. `--navigation-ways` exists and Build resolves
source guidance into the generated name-keyed `segments.json`. Do not create a
second runtime guidance asset.

**Primary files**

- `processing/build_map.py`
- `processing/navigation_ways.py` — new shared build validator if extraction
  keeps `build_map.py` focused
- `editor/server.mjs`
- `packages/core/src/data/mapAssets.js`
- `tests/test_navigation_ways.py`
- `tests/test_navigation_way_build.py`
- `tests/test-map-assets.mjs`
- `tests/test-editor-promote-targets.mjs`

**Build input and resolver**

- [x] Add `--navigation-ways` with `data/navigation-ways.json` as the
      source-build default.
- [x] Load registry and source GeoJSON together and resolve known named-way,
      standalone, and unnamed records into `segments.json`.
- [ ] Move strict normalization/validation into a focused module shared by the
      build report and editor server; retain the existing resolver API until
      callers migrate.
- [ ] Validate references and report issues by stable segment ID, not by the
      outer name-keyed `segments.json` key.
- [ ] Feed connectivity validation accepted Overlay V2 alignment terminals,
      compiled direction-scoped V3 memberships, and published network-junction
      attachments/legal movements. Do not reconstruct adjacency from display
      geometry.

**Coverage and issue report**

- [ ] Add `report.navigationWays` with schema/enforcement, active/reviewed/
      unreviewed counts, counts by role/kind, way/member counts,
      `coverageComplete`, per-way component count and maximum degree with their
      issue fingerprints/acknowledgement state, parallel-risk findings, and
      bounded stable-ID examples.
- [ ] Make the per-batch coverage delta easy to read during Task 4: report the
      reviewed count, the change since the previous build, and the remaining
      unreviewed stable IDs.
- [ ] Report unacknowledged-multi-component, unacknowledged-branching,
      parallel-facility-risk, facility-class-conflict, empty, unknown-way,
      invalid-role, invalid-field, overlap-conflict, ambiguous-junction,
      legacy-endpoint-only, and expected-direction-gap issues with stable codes.
- [ ] Treat missing active classifications as warnings in `migration` and
      blockers in `required`. Invalid present records, unresolved
      parallel-facility risks, and conflicting overlap errors block in both
      modes. Multi-component and branching findings remain warnings, but
      required-mode promotion requires their exact acknowledgement.
- [ ] Exclude draft/deprecated/legacy segments from active coverage and
      connectivity while retaining diagnostic metadata.
- [ ] Append guidance blockers to the existing Build/Promote blocker model.
      Do not weaken traversal-policy, alignment, junction, crossing,
      route-compatibility, offered-route, reported-ride, or anchor-archive
      audits.

**Generated/runtime contract**

- [x] Keep resolved guidance self-contained in each generated segment record
      without changing the name-keyed outer object.
- [ ] Add a pure core helper that derives `bySegmentId` and `membersByWayId`
      indexes from loaded `segmentsData`; validate duplicate/missing numeric IDs.
- [ ] Keep processed logical/physical GeoJSON guidance-free. Resolve map hits
      by their existing stable segment ID through the derived index, and never
      copy `spokenName` or repeated navigation text onto alignment features.
- [ ] Add `manifest.guidance` as non-path diagnostics containing schema
      version, enforcement, counts, `coverageComplete`, and conflict count.
      `hashes.segments` remains the resolved-guidance integrity hash.
- [ ] Pass the manifest-bound supported guidance schema into every route-manager
      construction path. Do not infer `guidance-v1` by checking whether the
      current route or loaded map happened to contain at least one resolved
      guidance record.
- [ ] Include the manifest summary in map-asset/build diagnostics and native
      bundled manifest projection. It requires no new offline file mapping.
- [ ] Verify that changing only registry naming changes generated
      `segments.json`, `hashes.segments`, and the map version.
- [ ] Verify that `spokenName` combining marks and punctuation survive the
      source build exactly, while processed GeoJSON and map labels contain only
      clean display names.
- [ ] Keep `stablePromotionManifest` and `releaseIndex.mapAssetHashes`
      unchanged structurally: the existing segments hash already binds naming
      data. Promote still prepares catalog/snapshots and switches the manifest
      last.

**Compatibility**

- [ ] An old manifest without `manifest.guidance` loads normally.
- [ ] An old manifest/segments pair with no supported guidance schema yields
      legacy planner behavior without an extra fetch. Newly generated
      navigation cues still suppress internal `enter-segment` speech.
- [ ] A migration build with 11/291 classified segments reports those exact
      counts, publishes usable metadata without asserting completion, and
      produces routes that name the 11 classified segments while presenting the
      rest as facility classes.
- [ ] A required build with one active unclassified segment fails before
      Promote.

**Exit criteria**

- Build and editor validation produce the same structured issue set.
- The generated segments hash is the only runtime guidance-data hash.
- No `public-data/navigation-ways.json`, manifest path, offline asset mapping,
  or extra release target is introduced.
- Promote remains atomic across the resolved segments asset, catalog, and
  featured snapshots.

## Task 3 — add editor authoring for guidance classification

**Status:** Not implemented. Integrate with the current monolithic editor,
render-domain invalidation, versioned map-source adapter, persistent matcher,
and background authoring coordinator. The general server-owned authoring
operation from `editor-performance-ux` remains future work.

**Scope for the first release**

This task exists to make Task 4 possible and to support ongoing authoring
afterwards. Most of its original scope optimizes a one-time pass over 291
segments in a single-curator system, which is not where the effort belongs.

Build now:

- load/save and reconciliation, including the combined registry+source
  transaction;
- per-segment role editing in the selected-segment inspector;
- named-way create/edit with member list, total length, and map preview;
- structure findings surfaced per way with the acknowledgement control; and
- an import view for the suggestion artifact with per-group accept, edit, or
  reject.

Defer until repeat need is demonstrated, and mark each below as deferred:

- the ordered review queue with confidence bands, split, and defer states;
- batch acceptance across groups;
- contiguous bulk assignment by selecting chain endpoints; and
- the connectivity/branch visualizer beyond a plain findings list.

The deferred items are not deleted from this plan. If the suggestion import plus
per-segment editing turns out to be too slow in practice during Task 4, stop and
build the next one that removes the actual bottleneck rather than all of them.

**Writing canonical data**

`CLAUDE.md` requires every change to `data/map-source.geojson` to go through the
editor. Classifying 291 segments by accepting reviewed suggestion groups is
still an editor operation under that rule as long as the editor is what writes
the file. A one-off script that writes source or the registry directly needs
explicit permission for that specific change; do not assume it.

**Primary files**

- `editor/editor.js`
- `editor/index.html`
- editor stylesheet files
- `editor/server.mjs`
- `editor/lib/navigation-ways.mjs` — new pure editor helpers
- `editor/lib/network-authoring-coordinator.mjs`
- `scripts/build-navigation-way-suggestion-context.mjs` — new deterministic
  evidence exporter
- `data/navigation-way-suggestions.json` — temporary, source-digest-bound
  review artifact; never a runtime asset
- `tests/test-navigation-way-editor.mjs`
- `tests/test-navigation-way-editor-wiring.mjs`
- `tests/test-navigation-way-suggestions.mjs`
- `tests/test-editor-poi-validation.mjs` — preserve existing source-validation
  coverage

**Load/save and reconciliation model**

- [ ] Load the registry alongside `/api/source`, retain both in editor state,
      and track canonical content digests for source and registry.
- [ ] Integrate with the existing revision-aware source autosave coordinator;
      do not add a second manual Save Source workflow.
- [ ] Add a combined mutation endpoint for operations that change a registry
      way and source assignments together. It validates both complete documents
      and requires the expected source and registry content digests before
      writing either canonical file. Do not rely on `/api/source` having a
      server revision contract; it currently does not.
- [ ] Stage both JSON payloads to temporary files, then replace the canonical
      files with rollback on a partial failure. A failed save leaves both editor
      documents dirty.
- [ ] Treat locally superseded responses like existing authoring conflicts: an
      obsolete response cannot clear a newer dirty edit, and safe retry uses the
      latest pair of documents.
- [ ] Keep geometry/base-edge source-only callers compatible. A guidance-only
      metadata edit updates validation/report state without needlessly
      rebuilding base topology or directional alignment evidence.
- [ ] Route guidance-only edits through the cheap metadata authoring path.
      They must not invoke the persistent matcher worker or invalidate stable
      Base/CW map sources.
- [ ] Display migration coverage and blocking/warning issue counts in the
      editor and Build report.

**Suggestion bootstrap**

- [ ] Export one compact suggestion context for all active unreviewed segments:
      stable ID, internal name, road type, geometry endpoints/length, accepted
      directional alignment terminals, logical neighbors, junction-mediated
      movements, nearby parallel segments, POI/section context, and existing
      way membership.
- [ ] Include source, registry, alignment, and junction digests so suggestion
      output can be rejected as stale.
- [ ] Use a bounded Codex/language-model review of that context to produce
      proposals for every unreviewed segment. This is an implementation/data
      preparation step, not an app runtime dependency.
- [ ] Each proposal contains exact segment IDs, proposed role, existing/new way
      ID, clean display name, optional section label, an optional audible
      candidate, confidence, concise evidence, and alternatives when ambiguous.
      The proposed canonical `spokenName` remains `null` until device evidence
      is recorded.
- [ ] Suggest audible punctuation only when it plausibly changes
      pronunciation. Present it as a listening candidate, not a pre-approved
      field value.
- [ ] Run every proposal member set through the shared structure validator
      **before** a curator sees it, and show each group's verdict — components,
      maximum degree, and any parallel-facility risk — next to the proposal.
      Suggestion confidence and validator verdict are separate columns.
- [ ] Never let a structure warning cause a proposed group to be split into
      several ways. Present the warning and the acknowledgement control.
- [ ] A parallel-facility risk requires reassignment or explicit review of its
      exact fingerprint; do not offer a broad or silent acceptance.
- [ ] Never infer acceptance from confidence. No suggestion mutates
      `map-source.geojson` or the registry until the editor transaction is
      explicitly approved.
- [ ] Show the proposals grouped by proposed way with accept, edit-and-accept,
      and reject.
- [ ] *(deferred)* Ordered review queue with confidence bands, split, and defer
      states.
- [ ] *(deferred)* Batch acceptance across groups, allowed only for
      structure-valid, non-conflicting proposals and showing the exact
      source/registry diff first.
- [ ] A stale artifact is read-only until regenerated; previously accepted
      canonical classifications are never overwritten by regeneration.

**Per-segment editing**

- [ ] Add the guidance section to the selected logical segment inspector in the
      existing Network workspace's **CW network** focus, with explicit Hebrew
      choices for named way, standalone named feature, and unnamed. Do not add a
      new top-level workspace.
- [ ] For named-way members, provide searchable way selection, create-way
      action, optional section label, and remove/reassign actions.
- [ ] For standalone features, require public name and kind.
- [ ] For unnamed features, require the best fallback kind.
- [ ] Show both the internal editor name and resolved rider-facing preview so
      editors can see that they serve different purposes.
- [ ] Show clean display and audible fields side by side for ways and named
      segments. Preview platform speech when available, while marking iOS
      simulator/device playback as the acceptance authority.
- [ ] Visually flag pronunciation-only punctuation leaking into display text.
- [ ] Preserve camera and selected-segment context when switching CW/Base focus;
      Base focus may expose the alignment/junction evidence used by validation
      but does not own the name fields.

**Named-way management**

- [ ] Add create/edit controls for clean display name, kind, ref, aliases, and
      optional audible (`spokenName`) form.
- [ ] Show member count, total length, ordered members, section labels, and a
      whole-way map preview.
- [ ] List structure findings per way — component count, branch nodes, nearby
      duplicate names, overlapping conflicting memberships, junction-mediated
      adjacency, legacy-endpoint-only links — with an acknowledgement control
      for exact multi-component/branching issue fingerprints, and explicit
      resolve-or-approve handling for a parallel-facility risk.
- [ ] *(deferred)* Graphical visualization of components and branch nodes beyond
      that list.
- [ ] *(deferred)* Contiguous bulk assignment as a proposal:
  - [ ] choose or create a way;
  - [ ] select start and end segments on the map;
  - [ ] traverse the validated logical segment-adjacency graph built from
        accepted alignments and published junction arms;
  - [ ] auto-propose only when there is one unambiguous contiguous path;
  - [ ] preview every proposed member and assignment removal;
  - [ ] require confirmation before mutating source data.
- [ ] *(deferred)* When more than one path exists, require explicit intermediate
      selections or individual assignment. Never choose the geographically
      nearest branch automatically.

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

- An editor can classify the whole network without hand-editing JSON.
- A fresh source-digest-matched suggestion artifact gives every unreviewed
  active segment a proposal or an explicit ambiguous result, and every group
  carries a validator verdict computed before review.
- Every accepted change remains human-approved, and no accepted change
  leaves an unresolved parallel-facility risk.
- A curator can acknowledge a multi-component or branching way in one action and
  see the warning clear without splitting the way.
- Display/audible previews are distinct and pronunciation punctuation never
  leaks into visible UI.
- A parallel cycleway is visibly separate and cannot be absorbed by proximity.
- Save, reload, Build, and Promote show the same issue set.
- Background authoring reconciliation remains race-safe, and guidance-only
  edits do not churn unrelated base/alignment evidence.

## Task 4 — classify and review the data

**Status:** Pilot only. The source currently classifies 11 of 291 active
segments: 10 named-way members and one standalone feature. The registry has
eight ways. `דרך הפטרולים`, intentionally unnamed examples, and the real
`גשר עינות ירדן` standalone bridge are not yet covered.

**Primary files**

- `data/navigation-ways.json`
- `data/map-source.geojson`
- generated Build report for review only

**Reference corpus first**

- [ ] Re-score `plans/navigation-way-names/model-suggestions.md` through the
      shared structure validator before reviewing any group. The existing
      artifact was grouped on endpoint proximity, which disagrees with reviewed
      topology in both directions: it splits `road-99-upper` into two components
      that a published junction almost certainly joins, and it marks that split
      group high confidence. Reviewing 176 groups twice is the expensive failure
      mode here.
- [ ] Use the prior 25 m endpoint audit only as a regression clue: it found five
      of 46 multi-member proposals with component/degree findings, including
      `שבילי אגמון החולה` at member degree four and the Banias trail group at
      degree three. The reviewed-topology validator is authoritative and may
      produce a different count. Review each finding as a facility decision;
      do not pre-acknowledge or split it merely to clear the check.
- [ ] Re-examine every provisional ID that exists only because connectivity was
      unproved — `road-99-upper`/`road-99-east`, the three Road 918 components,
      both Road 959 and Road 90 components, both `cycleway-99` components, and
      the Jordan east/west pairs. Merge each set into one way unless the pieces
      are genuinely different facilities.
- [x] Create distinct named ways for the pilot Road 99 roadway and its
      parallel cycleway.
- [ ] Assign every Road 99 member by stable segment ID and inspect the entire
      member chain across logical overview and accepted physical alignment
      geometry.
- [ ] Assign all `דרך הפטרולים` members and review chain continuity.
- [ ] Classify `גשר עינות ירדן` as `standalone` with `kind: "bridge"`.
- [ ] Curate clean display names for Road 99, `דרך הפטרולים`, the Road 99
      cycleway, and `גשר עינות ירדן`.
- [ ] Listen to the clean display form on a device **before** adding any
      `spokenName`, and keep `null` unless the recording is wrong. The suggested
      number expansions in particular — `כביש 9974` becoming a seven-word string
      — replace whatever the speech engine does today with a fixed form that
      cannot improve later and may not match how riders say the number. Record
      which forms were tested and what was heard.
- [ ] Confirm the bridge is a traversable standalone segment, not a network
      junction landmark. Keep the two schemas and presentation behaviors
      distinct.
- [ ] Classify representative unnamed road, dirt-road, trail/path, bridge, and
      connector cases.
- [ ] Perform one real split within a named-way fixture or an isolated test copy
      and confirm inheritance/review behavior.
- [ ] Resolve the reference overlapping-membership case, or record a reviewed
      same-identity/precedence decision that remains deterministic at runtime,
      only after inspecting direction-scoped accepted traversal evidence. A
      generic issue suppression must not authorize a guessed spoken name.
- [ ] Review one same-way and one different-way connection through a published
      junction, plus a junction lying in the middle of one segment.
- [ ] Add section labels where they help distinguish warnings or route
      sections; do not manufacture labels solely to eliminate warnings.

When this reference corpus and its fixtures pass, Task 6/7 web itinerary work
may begin. The remaining classification batches continue against that visible
review surface and must finish before Gate E.

**Full coverage**

- [ ] Work through suggestion groups and then the build's remaining stable-ID
      unreviewed queue until every active segment has a role.
- [ ] Rebuild after each batch and confirm the coverage delta and the resulting
      route naming. Because unclassified spans now degrade to facility class,
      each batch is independently verifiable on a real route instead of being
      invisible until coverage completes.
- [ ] Review each named way as a whole facility, not as independent name fields.
      Inspect direct alignment-terminal and junction-mediated links, and treat a
      structure warning as a question about the data rather than a reason to
      create a second way ID.
- [ ] Check nearby same-name IDs and every road/cycleway parallel corridor.
- [ ] Review every standalone feature and unusually short/long unnamed run.
- [ ] Require a second visual review for safety-sensitive road versus cycleway
      classifications.
- [ ] Rebuild after each batch and record coverage deltas.
- [ ] Record suggestion acceptance/edit/reject counts by confidence so the
      bootstrap's usefulness is measurable without treating confidence as
      truth.
- [ ] Change registry enforcement from `migration` to `required` at Gate E, only
      after the full build report has held at zero active unreviewed segments,
      zero invalid ways, zero unresolved parallel-facility risks, zero
      unacknowledged structure warnings, and zero unresolved guidance conflicts.

**Exit criteria**

- Coverage is 100% for active CycleWays segments.
- The reference corpus has explicit expected identities in automated fixtures.
- No classification was derived by parsing an internal segment name.
- No way ID exists solely because a structural check would otherwise fail.
- Every `spokenName` in the registry has a recorded device listening result.
- A required-mode Build succeeds from a clean checkout.

## Task 5 — retain exact segment spans and derive guidance spans

**Status:** Core forward path implemented. Exact membership sets,
`guidanceSpans`, route-state storage, and focused tests exist. The route-level
legacy fallback implemented here is replaced by per-span degradation as the
first slice of the remaining work; the rest is strict conflict/validation
integration, mixed segment+junction context coverage, provenance, and reverse
resolution.

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

- [x] Evolve each exact span to carry `networkRole`, the complete
      `segmentMemberships[]` set (`segmentId`, `alignmentKey`, `mappingDigest`),
      complete `junctionMemberships[]`, derived `segmentIds[]`, and canonical
      `onCycleways`.
- [x] Emit singular `segmentId`/`internalName` or `junctionId`/`junctionName`
      only when exactly one value is authoritative. Do not pick the first
      accepted membership.
- [x] Retain `cwSegmentId`, `name`, and `onNetwork` aliases during the additive
      release so existing callers and old fixtures keep working; set singular
      aliases to null when they would discard a conflict/set.
- [x] Resolve direction-scoped membership over every traversal slice rather
      than treating the first CycleWays membership as authoritative. Preserve
      accepted Overlay V2 alignment keys/digests and compiled direction-scoped
      `cwJunctions`.
- [ ] Merge exact traversal pieces only when network role, complete membership
      sets, junction context, route class/surface semantics, and resolution
      state agree.
- [ ] Preserve exact boundaries needed by warnings, POIs, quality, and editor
      diagnostics even when adjacent spans share a guidance identity.
- [ ] Build `oppositeSegmentSpans` from the same edges using the opposite
      direction's CycleWays segment and junction memberships. The current route
      attestation carries opposite segment membership but not opposite
      `cwJunctions`, so a later pure reverse cannot reconstruct this exact
      projection safely.

**Guidance spans**

- [x] Resolve guidance through the `segmentGuidanceById` index built from the
      same `segmentsData` already loaded by each route manager. Do not add a
      separate registry/runtime asset dependency.
- [x] Build guidance spans directly from ordered traversals and all accepted
      direction-scoped CycleWays memberships; do not derive them from the
      unclipped `selectedSegments` list.
- [x] Merge adjacent traversal pieces only when guidance identity, resolution
      state, network role, junction context, and current facility semantics
      agree.
- [x] When all covering memberships resolve to one identity, retain all exact
      segment IDs on the span.
- [ ] Replace the route-level legacy demotion in `buildRouteSpans` with per-span
      degradation. An unreviewed span keeps `resolutionStatus: "unreviewed"`,
      carries a facility class derived from route class, and presents exactly
      like an `unnamed` span. `guidanceMode` stops encoding whether the route
      opted in to naming; it comes from explicit manifest-bound schema context,
      including when this route traverses zero classified segments.
- [ ] Verify that no span type can reach navigation or the planner carrying an
      internal segment name. The legacy `enter-segment` path is the only
      producer of that copy and is retired with this change.
- [ ] When memberships conflict, emit a null-name conservative span with
      `resolutionStatus: "conflict"`, add a structured routing-validation issue,
      and use facility-class fallback presentation. Retain a usable `kind` on the
      span — the shared kind when conflicting memberships agree, otherwise one
      derived from route class — so the fallback has something to say.
- [x] Keep `onCycleways` independent of whether a guidance name exists.
- [x] Convert a direction-scoped junction-only traversal to
      `networkRole: "junction"`, `onCycleways: true`, null guidance identity,
      and optional landmark context. Report conflicting simultaneous junction
      memberships rather than choosing one.
- [ ] When a traversal legitimately carries both a segment membership and
      junction context (the mid-segment case), keep `networkRole: "segment"`
      and the segment guidance identity while retaining the junction evidence.
- [ ] Apply the same segment-first rule to a staged junction-connector
      migration. Do not hide the active connector's classified segment span
      until its deprecation has passed existing route/share/navigation parity
      gates.
- [ ] Attach map version and `hashes.segments` provenance where a persisted or
      promoted route snapshot must detect stale rider-facing guidance.
- [x] Store `guidanceSpans` and `guidanceMode` in live route state and preserve
      them through snapshot,
      undo/redo, clear, proposal, and route restore paths.
- [ ] Resolve and store `oppositeGuidanceSpans` alongside
      `oppositeSegmentSpans` while the route manager still has
      `segmentGuidanceById` and direction-scoped edge memberships. Preserve
      these reverse-ready projections through the same live route-state
      transforms; they are not part of public featured snapshots.

**Tests**

- [ ] Consecutive Road 99 segments produce multiple exact spans but compatible
      guidance spans.
- [ ] Same visible name with different IDs does not merge.
- [ ] Parallel road/cycleway conflicts never choose the first membership.
- [ ] Standalone bridge and unnamed connector spans retain their roles.
- [ ] Same-way travel through a junction retains an exact junction span;
      different-way travel does likewise; neither invents a segment name.
- [ ] A junction in the middle of one segment preserves that segment's guidance
      continuity, and ambiguous junction memberships fail conservatively.
- [ ] A not-yet-deprecated connector segment remains classified/present even if
      the same edges also carry junction context.
- [ ] Forward and reverse traversals use only the memberships for their actual
      direction, including after a sharded-manager rebuild.
- [ ] A route containing one unreviewed member still names every resolved way it
      traverses, and the unreviewed span reads as its facility class.
- [ ] A conflicting span exposes a non-null kind and never a null name with a
      null class.
- [ ] No fixture in the suite produces a cue or a planner row containing an
      internal segment name.
- [ ] Old manifest/segments pairs with no supported schema produce no guidance
      spans and preserve legacy planner behavior, while newly generated
      navigation cues still suppress internal `enter-segment` speech.
- [ ] Route geometry, distance, elevation, attestation, and share encoding are
      byte-for-byte or tolerance-equivalent to the Task 0 baseline.

## Task 6 — build the shared route-run and map-presentation model

**Status:** Not implemented. This follows validation plus the reference corpus;
featured snapshot compatibility consumes its derived runs later.

**Primary files**

- `packages/core/src/ui/routeItinerary.js` — new
- `packages/core/src/ui/routeGuidanceMap.js` — new
- `packages/core/src/ui/routePlannerPresentation.js`
- `packages/core/src/domain/routeNetwork.js`
- `packages/core/src/routing/routeActions.js`
- `tests/test-route-itinerary.mjs`
- `tests/test-route-guidance-map.mjs`
- `tests/test-planner-build-model.mjs`
- `tests/test-planner-surface-parity.mjs`

**Itinerary derivation**

- [ ] Group adjacent guidance spans with the same non-null identity into one
      route-occurrence run even when surface/class semantics change.
- [ ] Give every occurrence a deterministic route-local ID containing its
      occurrence ordinal/range; leaving and re-entering the same way yields two
      IDs.
- [ ] Always keep standalone features as rows.
- [ ] Never create a junction row. Retain junction spans as contextual children;
      bridge a same-identity run across them, and attach a different-identity
      junction to the following run's entry context and associated maneuver.
- [ ] Handle routes that start or end inside a junction with neutral contextual
      presentation rather than inventing a way occurrence.
- [ ] Fold a short unnamed or unreviewed connector only when it has no warning,
      POI, material surface/condition change, or standalone landmark value.
      “Short” is `ITINERARY_FOLD_MAX_M`, one shared constant used by web and
      native and asserted by the parity fixtures — parity tests compare row
      lists, so a per-surface judgement makes them untestable.
- [ ] Give material unnamed and unreviewed runs localized kind fallback names
      from the shared class table. Unreviewed runs are indistinguishable from
      unnamed runs in the rendered itinerary.
- [ ] Aggregate distance, kinds/surfaces, exact segment IDs, section labels,
      junction contexts, warning count, POI count, and mixed-surface state
      without losing child spans.
- [ ] Assign warnings/POIs to a route occurrence using `routeProgressMeters`
      first and exact segment ID as a fallback. Enrich active data points with
      segment ID while retaining `segmentName` compatibility.
- [ ] Keep archived parents and raw internal names out of normal itinerary copy.

**Map helpers**

Route-only guidance labels are deferred out of the first release. They are the
costliest and least certain part of the planner work, the base map already
labels significant roads, and the itinerary is the authoritative readable list.
Deferring is structurally free because the label model consumes route runs,
which this task produces regardless. Revisit once the itinerary has shipped and
there is evidence riders miss labels.

- [ ] Add a pure distance-range geometry slicer for highlighting one run or
      child section on the computed route.
- [ ] *(deferred)* Generate sparse route-only label features from run
      occurrences.
- [ ] *(deferred)* Prioritize standalone landmarks, suppress labels below
      platform-specific length/spacing thresholds, and prevent repeated labels
      from crowding a short area.
- [ ] *(deferred)* Do not emit junction landmark names as way-label candidates.
      Junction naming belongs to landmark/maneuver context.
- [ ] *(deferred)* Keep density policy configurable so native can be stricter
      than web while consuming the same candidate model.
- [ ] Generate a whole-way context filter from the in-memory
      `membersByWayId` index derived from `segmentsData`. Match both logical
      overview features and physical alignment
      features by stable segment ID, exclude junction footprints, and keep this
      separate from exact selection and route-run highlight.

**Planner model changes**

- [ ] Expose itinerary rows and selected-run state from the shared build model.
- [ ] Remove rider-facing `מקטעי CW` count from normal route statistics while
      retaining the count in diagnostics.
- [ ] Group warning headings by guidance run/section rather than raw internal
      name.

## Task 7 — implement web planning presentation

**Status:** Not implemented. The current planner still presents raw segment
counts/names and groups warnings by `segmentName`.

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

- [ ] Promote the stable segment ID already returned by map hit-testing to the
      hover/focus/selection authority. Keep internal name only as a compatibility
      payload.
- [ ] Replace name-equality hover/focus layer filters with segment-ID filters
      for this feature. Hovering a logical overview or either physical
      alignment resolves the same logical segment; `alignmentKey` remains
      diagnostic/snap context.
- [ ] Keep junction footprints non-segment-interactive and ensure they cannot
      fabricate a segment card or way selection.
- [ ] Keep hover/focus on one exact logical segment even when many members share
      the same `navigationName`.
- [ ] Change the card eyebrow from the internal concept of “segment” to a
      rider-facing facility/section label.
- [ ] Use resolved guidance name as the title. Show optional section label,
      exact distance/elevation/quality, and warnings for the selected segment.
- [ ] Keep the card at least as informative as today's. `כביש 99 שאר ישוב`
      currently distinguishes one hovered section from its neighbour; a title of
      `כביש 99` with no subtitle does not. When a named-way member has no
      curated `sectionLabel`, use an unambiguous named endpoint/junction/POI;
      otherwise show facility class/surface, exact length, and warning count.
      Never invent “position along the way” for a branched/multi-component way,
      and never derive text by subtracting the way name from the internal name.
- [ ] If guidance naming is disabled or the selected segment has no resolved
      proper name, render the class-only title and the same rider-safe exact
      subtitle. Do not restore the internal name as primary planner copy.
- [ ] Add `הצגת כל הדרך` only for named-way members. It draws a lighter context
      highlight for logical and physical features of all active member IDs,
      excludes junction footprints, and does not change exact focus.
- [ ] Do not label the entire unselected network with CycleWays way names.

**Built route**

- [ ] Add an ordered, collapsible itinerary to the Build panel.
- [ ] Collapsed rows show rider-facing name/fallback, distance, surface summary,
      and warning/POI indicators.
- [ ] Expanded rows show exact curated sections, conditions, and warnings
      plus retained junction context without exposing technical IDs or archived
      parent names. Junction context never becomes an extra row.
- [ ] Selecting a row highlights only that route occurrence using its distance
      range. Selecting a child highlights only that exact section range.
- [ ] *(deferred)* Render sparse route-only label features above the built route
      and below critical POI/navigation overlays.
- [ ] Update route summary, download modal, warning labels, and data-marker
      context to use guidance names with optional section labels.
- [ ] Preserve keyboard focus, RTL order, hover behavior, and mobile-web sheet
      behavior.

**Web acceptance**

- [ ] Hovering two Road 99 segments shows the same title but distinct section
      detail and exact highlight, including when neither has a curated section
      label.
- [ ] Hovering a segment's logical overview and physical alignment opens the
      same ID-backed card; hovering a junction footprint opens none.
- [ ] Whole-way context never changes the route or selects every member.
- [ ] A route that leaves and re-enters Road 99 shows two selectable Road 99
      rows.
- [ ] `גשר עינות ירדן` remains visible as its own short row and label.
- [ ] A named network junction can appear as maneuver/context detail but never
      as a bridge/road itinerary row.
- [ ] Unnamed and unreviewed sections never display their internal editor name.
- [ ] An unreviewed section is indistinguishable from an intentionally unnamed
      one in rider-facing copy.

## Task 8 — implement native planning presentation

**Status:** Not implemented. Active navigation already consumes guidance
presentation, but the native Build experience does not yet render shared route
runs.

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
- [ ] Keep consuming the shared logical/physical/junction public network source.
      Guidance labels are a separate route-only layer and must not alter
      physical direction arrows, junction hit testing, or preferred-segment
      route-point snapping.
- [ ] *(deferred)* Render sparse route-only native `SymbolLayer` labels from the
      shared candidate model with stricter density than web.
- [ ] *(deferred)* Prioritize standalone landmarks and suppress internal section
      labels.
- [ ] Render selected run/section geometry as a distinct route overlay without
      replacing the main route.

**Build sheet and summary**

- [ ] Render the same ordered runs, copy, counts, and expansion semantics as
      web.
- [ ] Render retained junction landmark context inside the relevant run or
      maneuver detail, never as a fake standalone itinerary row.
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
      from the same fixture, including identical folding at
      `ITINERARY_FOLD_MAX_M`.
- [ ] Same-way and different-way junction fixtures match web semantics, and a
      junction footprint remains non-segment-interactive.
- [ ] Starting a ride carries the exact `guidanceMode`, map version, segments
      hash, and spans shown in Build.

## Task 9 — make route transformations and snapshots guidance-aware

**Status:** Partially complete. Forward reconciliation, clipping, and loop
rotation preserve guidance. Reverse deliberately returns legacy. Public
featured snapshot schema 1 and `catalogDecodedRouteFromState` drop guidance
spans; the private demo snapshot keeps the route-state object and adds current
junction/crossing evidence.

**This task is split across two slices.** The reverse work moves to slice 1
because the evidence already exists and out-and-back rides are the common case;
the snapshot work stays late, after route runs exist, because snapshots now
store the derived itinerary rather than the span model.

**Primary files**

- `packages/core/src/navigation/navigationRoute.js`
- `packages/core/src/navigation/effectiveNavigationRoute.js`
- `packages/core/src/navigation/approachLeg.js`
- `packages/core/src/navigation/ridePlan.js`
- `packages/core/src/data/featuredRouteSnapshots.js`
- `scripts/build-featured-route-snapshots.mjs`
- `scripts/lib/featuredRouteSnapshotBuilder.mjs`
- `packages/core/src/navigation/navigationSession.js`
- `packages/core/src/navigation/persistencePolicy.js`
- `apps/mobile/src/navigation/activeNavigationStore.js`
- `apps/mobile/src/navigation/navigationResume.js`
- `apps/mobile/src/navigation/navigationRuntime.js`
- related navigation/snapshot tests

**Transforms**

- [x] Reconcile guidance spans to the navigation route's cumulative-distance
      frame alongside exact segment spans.
- [x] Apply the same clip and loop-rotation distance remapping to both span
      families, including split spans at a loop seam.
- [ ] **(slice 1)** For reverse navigation, resolve exact/guidance membership
      from the reversed attestation's actual opposite-direction evidence. Do not
      merely reverse the source route's names or forward-direction membership
      arrays, and do not fall back to legacy: a ride whose outbound leg says
      `כביש 99` and whose return leg says `כביש 99 שאר ישוב` is worse than
      either behavior applied consistently.
- [ ] **(slice 1)** Build `oppositeSegmentSpans` and
      `oppositeGuidanceSpans` in `packages/core/route-manager.js` from the same
      per-edge reverse memberships used during route construction, while
      `segmentGuidanceById` and opposite `cwJunctions` are available. A stable
      segment-ID symmetry check may reuse forward guidance resolutions as an
      optimization; asymmetric evidence must be resolved there, not deferred to
      the pure effective-route transform.
- [ ] **(slice 1)** Make reverse swap/remap the forward/opposite exact and
      guidance pairs; clip/loop operations transform all four lists, and double
      reverse restores the originals. Unresolved opposite guidance remains
      class fallback.
- [ ] **(slice 1)** Remove the hard-coded `guidanceMode: "legacy"` for reverse
      routes in `packages/core/src/navigation/effectiveNavigationRoute.js`.
- [ ] Do not silently set `crossings: null` on reverse. Recompute or safely
      transform direction-sensitive reviewed crossing evidence; if required
      evidence cannot be made valid, make that reverse navigation plan
      unavailable rather than dropping a safety instruction.
- [ ] Keep approach and rejoin connectors as separately attested route legs;
      give them off-network/class fallback context unless their own traversals
      carry current segment/junction membership.
- [ ] Preserve guidance identity and exact member IDs through transforms; never
      rebuild identity from visible text.
- [ ] Add transform tests for boundaries at zero/end, wrapped loop spans, reverse
      direction with different physical memberships, clipped standalone bridge,
      junction spans, and re-entry into the same way.
- [ ] Add an out-and-back test asserting that the outbound and return legs name
      the same ways, and that neither leg is legacy.

**Snapshots and compatibility**

- [ ] Add `guidanceMode`, map version, segments hash, and guidance spans to the
      effective navigation plan/cue fingerprint where rider-facing content
      depends on them. Keep this presentation fingerprint separate from V6
      route identity and traversal attestation.
- [ ] Bump the navigation maneuver-generator version when cue semantics change.
- [ ] Version persisted session/voice memory as needed so a segment-name cue is
      not replayed after restoring into guidance-name behavior.
- [ ] On a digest/version mismatch, rebuild the navigation route and cues from
      the current attested traversal or the existing current-policy restore
      path plus current guidance data. Preserve `requiresReview` for historical-
      anchor replans. If rebuilding is impossible, discard the stale active
      session safely and keep the planned route available.
- [ ] Bump featured snapshot schema to 2 and store the derived **itinerary
      runs** plus `guidanceMode` — not both span families. A featured snapshot is
      a presentation projection: featured pages need the ordered rider-facing
      list without loading planner assets. Navigation started from a featured
      route passes the catalog V6 token into Build and derives current guidance,
      attestation, and crossings there.
- [ ] Keep public featured snapshots presentation-only. Do not add a
      conditional direct-navigation payload or crossings list to schema 2; an
      offline navigable snapshot would require a separate full-attestation
      design.
- [ ] Extend both snapshot projections and `snapshotToRouteState` accordingly;
      schema 1 stores no run or span data at all.
- [ ] Preserve backward loading of schema 1 as a legacy route state.
- [ ] Keep `source.mapVersion` and existing `source.assetHashes.segments` as
      guidance provenance. Do not add `assetHashes.navigationWays`, and do not
      put the final `releaseBundleDigest` inside the snapshot because snapshot
      hashes are inputs to that digest.
- [ ] Update `catalogDecodedRouteFromState` to retain `guidanceMode` and the
      fields the projected itinerary needs; it currently returns only
      `segmentSpans`.
- [ ] Keep the crossing-preservation regression in the private demo-studio/full
      route-state snapshot tests. Public featured snapshot tests instead assert
      that navigation launches with the catalog V6 token and never treats
      itinerary runs as navigation evidence.
- [ ] Make strict snapshot generation/checking fail missing or stale guidance
      evidence. Promotion already rebuilds the catalog and all snapshots; keep
      that work inside the same Promote preparation rather than a separate
      post-promotion step.
- [ ] Preserve schema compatibility for already released clients while the
      feature flag is off, or coordinate a supported snapshot-schema bump
      before promotion.
- [ ] Keep compact, legacy, and V6 shared route encodings unchanged. Prove exact
      current replay and historical-anchor current-policy replanning both
      compute new guidance presentation without weakening restore gates.

## Task 10 — replace segment-name navigation semantics

**Status:** Mostly implemented for resolved named ways in the forward
direction. Do not rewrite the current cue pipeline. Remaining work is
standalone-bridge semantics, richer junction landmark decoration, reverse
resolution, persistence provenance, and full scenario/demo coverage.

**Already implemented**

- [x] Progress resolves current/next guidance identity and bridges a same-way
      junction span.
- [x] Guidance decorates topology-generated turns, roundabouts, and reviewed
      crossings; it does not create a maneuver at an internal segment boundary.
- [x] Same-way topology decisions can carry stay-on guidance.
- [x] Start/join/reacquisition presentation can name the current way.
- [x] A real maneuver entering a named way can append the quiet-run distance
      using the shared 300 m horizon.
- [x] Voice duplicate suppression keys on guidance identity rather than visible
      name.
- [x] The implemented foundation keeps old/unreviewed routes on legacy
      behavior through `guidanceMode`; slice 1 deliberately supersedes this
      route-wide fallback.

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

- [x] Resolve current facility from guidance spans and expose identity, visual
      name/fallback, spoken name, kind, surface/class, and `onCycleways`.
- [x] Resolve “next” as the next different guidance identity, not the next
      internal segment boundary.
- [ ] Define junction progress explicitly: a junction-only span keeps same-way
      continuity when the before/after identity matches; otherwise it exposes
      neutral location context and the next destination identity. A
      mid-segment junction keeps the segment identity.
- [ ] Retain legacy `currentSegmentName` fields only as temporary aliases for
      disabled/old-data behavior.
- [ ] Change the native current chip from current segment to current
      way/facility, avoiding redundant copies such as `כביש 99 · כביש`.

**Cue decoration**

- [x] Generate turns/keeps/roundabouts/crossings from existing topology and
      reviewed evidence first, then decorate each maneuver with its before/after
      guidance context.
- [x] Preserve current roundabout and reviewed-crossing cue authority and
      suppression windows. Guidance must decorate the existing cue rather than
      create a competing cue at the same movement.
- [ ] Replace `ontoSegmentName` with guidance-aware visual and spoken fields,
      keeping compatibility aliases only during migration.
- [x] Suppress all cue creation at an internal segment boundary when guidance
      identity is unchanged.
- [ ] For a real decision that stays on one identity, allow “stay on” wording
      without inventing a name-change maneuver.
- [ ] For a straight identity change without a decision, update current context
      silently.
- [ ] Remove generic `enter-segment` production cues. With per-span degradation
      there is no remaining mode that should emit them, so this retires with
      slice 1 rather than waiting for full coverage. The internal segment name is
      never a fallback.
- [ ] Pick the *nearest* maneuver when decorating a guidance transition.
      `applyGuidanceSemantics` in
      `packages/core/src/navigation/navigationCues.js` currently uses `.find`
      over a list that is not sorted by distance until later, so a crossing and a
      turn within tolerance of the same span start resolve by generation order.
- [x] Add the guidance-aware `continue-on-way` confirmation defined by the
      design. Generate it only for route start/join or as wording attached to a
      real maneuver entering a different identity; never generate it from an
      internal segment boundary.
- [x] Measure confirmation distance to the next route-choice cue or arrival,
      not to an exact segment boundary. Treat turn/keep, roundabout, reviewed
      crossing, and arrival as horizon owners while allowing informational
      warnings to interleave.
- [x] Use one shared 300 m minimum confirmation horizon and navigation-specific
      distance rounding (50 m below 1 km, 0.1 km at or above 1 km).
- [x] Append a long-run confirmation to a maneuver that already names the
      destination way instead of scheduling a competing second utterance.
- [ ] Move that appended confirmation off the final-phase call.
      `continueOnWayText` in
      `packages/core/src/navigation/navigationVoice.js` is currently appended
      regardless of `event.phase`, so the imminent instruction becomes
      `פנה ימינה אל שביל תל חי, והמשיכו עליו 1.5 קילומטר` — several extra
      seconds of speech arriving while the rider is executing the turn, roughly
      30 m of travel at 25 km/h. Allow it only in the preview utterance for the
      first release. When no preview was emitted, omit the distance; do not add
      a post-maneuver event without a separate one-shot/dedupe contract. Keep
      the final call to the maneuver plus destination way.
- [ ] Apply the same rule to reviewed crossings and roundabouts, whose
      final-phase copy is already the longest in the system.
- [ ] Assert phase placement in the voice fixtures rather than only asserting
      that the text appears somewhere.
- [ ] Name the resolved current way on route start and mid-route join when the
      next choice is not imminent. Reacquisition may name the way but does not
      repeat distance unless the effective route/horizon changed.

**Network-junction behavior**

- [ ] Never create an `enter-segment`, `cross-feature`, or fake way cue solely
      at a junction boundary.
- [ ] Decorate a real maneuver through a published junction with
      `junctionId`/`junctionName` as optional landmark context and with the
      after-movement guidance identity as the destination way.
- [ ] When the same way enters and exits the junction, keep current-way
      continuity; use “stay on” only when topology already produced a real
      decision.
- [ ] When the way changes, name the destination way even though the intervening
      exact span is road-name-less.
- [ ] A junction landmark name is never fed to current-road fallback, voice
      duplicate suppression, or standalone-bridge copy as a way identity.

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
- [ ] Unnamed, unreviewed, and conflicting spans all resolve at the facility
      class step, using the shared class table. No span reaches generic continue
      merely because a controlled kind or route class was omitted from that
      table.
- [ ] In this release, unaligned base edges start at facility class because OSM
      road names are deferred.
- [ ] Use visual `name` in UI and optional `spokenName` only in TTS.
- [ ] Preserve pronunciation punctuation/niqqud when passing `spokenName` to
      iOS TTS; never sanitize it through the display-name formatter.
- [ ] For named-way members, always use the way-level audible form. Use a
      segment-level audible form only in legacy/exact-section speech, and use
      standalone `guidance.spokenName` for standalone features.
- [ ] Update voice duplicate suppression to compare guidance identity rather
      than visible name so two same-named ways remain distinct.
- [ ] Include the effective route-choice horizon/reason in confirmation dedupe,
      so restoration cannot replay the same long-run confirmation while a new
      occurrence of the same way remains eligible.
- [ ] Decide haptics explicitly: merged maneuvers keep their normal haptic;
      standalone bridge context alone has no maneuver haptic.

**Required scenarios**

- [ ] Road 99 internal boundary: no cue, same current way.
- [ ] `דרך הפטרולים` internal boundary: no cue.
- [ ] True turn onto Road 99: name Road 99 once.
- [ ] Decision while staying on Road 99: keep/stay wording as appropriate.
- [ ] Start or join on a resolved way with at least 300 m to the next route
      choice: name the way and speak the rounded distance once.
- [ ] Turn onto `שביל תל חי` with a 1.5 km quiet horizon: name it in the turn,
      carry the distance in the preview rather than the final call, and do not
      emit a second boundary cue.
- [ ] The same start/join with a route choice under 300 m omits the long-run
      confirmation.
- [ ] Reacquisition on the same route occurrence names the way without
      replaying the distance confirmation.
- [ ] The long-run confirmation appears in the preview utterance only, never in
      the final-phase call, for turns, roundabouts, and reviewed crossings; a
      no-preview maneuver omits it.
- [ ] A partially classified route: resolved ways are named, unreviewed spans
      read as their facility class, and no cue carries an internal segment name.
- [ ] Road 99 roadway versus parallel cycleway: correct distinct name.
- [ ] A two-component or branching acknowledged way keeps one identity end to
      end and produces no transition cue at a component boundary the rider
      traverses continuously.
- [ ] Same-way travel through a named junction: one continuous current way and
      no boundary cue.
- [ ] Different-way travel through a named junction: one topology cue naming
      the destination way, with optional junction landmark context.
- [ ] Roundabout/crossing inside a named junction: existing single cue remains
      single; no duplicate junction or name-transition cue.
- [ ] Junction in the middle of one segment: current way does not change.
- [ ] `גשר עינות ירדן`: one useful cross-feature instruction; quiet exit.
- [ ] Named bridge coincident with a turn: one compound instruction.
- [ ] Unnamed connector: class fallback, never internal name.
- [ ] Surface/safety change inside one way: condition cue survives without a
      name transition.
- [ ] Guidance conflict: conservative fallback and no unsafe guessed name.
- [ ] Reverse route with different direction-scoped memberships: visual and
      spoken way come from reversed evidence, not reversed forward text.
- [ ] Out-and-back ride: both legs name the same ways, and neither is legacy.
- [ ] A reverse route preserves or recomputes its reviewed crossing evidence;
      it never becomes navigable after silently replacing that evidence with
      `null`.
- [ ] Exact V6 restore and historical-anchor replan: both use current guidance;
      the latter remains review-required.
- [ ] Old persisted session: regenerate or discard safely.
- [ ] Audible/display split: visual cards show the clean form while captured
      iOS speech uses the punctuated form; both retain the same
      `guidanceIdentity`.
- [ ] Demo-studio proof: a reviewed crossing whose continuation enters a named
      way remains one crossing-led instruction, carries the destination
      guidance on its follow-up maneuver, and matches visual/voice capture.
- [ ] Demo-studio proof: a long same-way run crosses an internal segment
      boundary without a cue or current-way chip change.

## Task 11 — activation guard, observability, and release

**Status:** Not implemented for the broader planner rollout. Atomic Promote
already exists and already binds the segments hash, catalog, and featured
snapshots.

**Primary files**

- `packages/core/src/config/featureFlags.js`
- `packages/core/src/data/mapAssets.js`
- `packages/core/src/app/useCyclewaysApp.js`
- relevant web/native startup diagnostics and analytics helpers
- `data/navigation-ways.json`
- `plans/navigation-way-names/design.md`
- this implementation plan

**Activation guard**

- [ ] Add one shared boolean feature flag, `guidanceWayNames`, defaulting true.
      Keep core route/cue tests independent of browser storage flags.
- [ ] Enable the planner itinerary when the flag is true,
      `manifest.guidance.schemaVersion` is supported, and the loaded segments
      asset belongs to that manifest. Do not gate it on complete coverage:
      partial coverage now produces honest class-fallback rows, and gating would
      hide the itinerary during exactly the period when coverage feedback is
      most useful.
- [ ] Resolve guidance per span, never per route. There is no route-level
      naming decision to make.
- [ ] Freeze the guard result, `guidanceMode`, map version, and segments hash
      into a planned/effective route so a storage flag or asset refresh cannot
      switch naming semantics midway through one navigation session.
- [ ] Keep the flag as a rollback kill switch after default activation. Its
      disabled policy is class-only v1 presentation, not legacy
      `enter-segment` speech; freeze that presentation policy separately from
      `guidanceMode`.

**Diagnostics**

- [ ] Include guidance schema version, segments hash, coverage state, role counts,
      and conflict count in map-asset/build summaries.
- [ ] Log one bounded startup diagnostic when planner activation is requested
      but the manifest summary is absent or unsupported.
- [ ] Count class-fallback spans by reason (unnamed, unreviewed, conflict,
      off-network) per computed route, so coverage progress and conflict
      regressions are visible without emitting rider names as analytics keys.
- [ ] Include segments hash and fallback/conflict counters in route and
      navigation diagnostics without emitting rider names as analytics keys.
- [ ] Include manifest map version, `releaseBundleDigest`, segments hash,
      and snapshot compatibility status in bounded startup/release diagnostics.
- [ ] Add an editor coverage view sorted by stable ID and way issue code.

**Automated release validation**

- [ ] Run focused schema/build/editor tests.
- [ ] Run focused route-model and planner tests.
- [ ] Run focused navigation tests and the navigation scenario suite.
- [ ] Run `npm run test:network-junctions` plus the focused policy/V6 restore
      suites so guidance changes cannot weaken junction or restore behavior.
- [ ] Run `npm run featured:snapshots:check` against the prepared/promoted
      bundle; strict Promote snapshot generation must also pass.
- [ ] Run `npm run mobile:assets` and verify no uncommitted generated-asset
      drift remains beyond expected bundle changes.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:smoke` with the implementation's new itinerary E2E
      included in the configured smoke scope, or run that spec explicitly.
- [ ] Run `git diff --check`.

**Manual editor validation**

- [ ] Generate suggestions from the current source, review a validator-scored
      group, edit an audible form, reject an ambiguous group, and confirm stale
      digests prevent acceptance.
- [ ] Create, rename, and delete a test way; undo any test data before release.
- [ ] Acknowledge a multi-component way and a branching way, then change their
      membership and confirm the warning re-raises.
- [ ] Confirm that assigning a materially parallel member raises an exact
      `parallel-facility-risk`; resolve the Road 99 cycleway by separation and
      approve a dual-carriageway fixture without splitting it.
- [ ] Split named-way, standalone, and unnamed test cases and inspect outcomes.
- [ ] Build and Promote in required mode from a clean source state; verify the
      segments hash changes with resolved guidance and is present in the map
      version, release index, and final release-bundle digest.
- [ ] Confirm all pre-existing traversal, junction, offered-route, reported-
      ride, route-anchor compatibility, catalog, and snapshot gates still run
      and report normally.

**Manual web validation**

- [ ] Inspect exact Road 99 sections and whole-way context across the logical-to-
      physical zoom handoff; confirm junction footprints remain non-segment
      interactive.
- [ ] Build forward, reverse, loop, leave/re-enter, bridge, and unnamed routes.
- [ ] Verify run and section highlight behavior, warnings/POIs, keyboard
      navigation, and RTL copy.
- [ ] Open legacy, exact-current V6, historical-anchor V6, and promoted featured
      routes; confirm review-required restore states remain intact.

**Manual native/navigation validation**

- [ ] Repeat the planner routes on iPhone simulator and one physical device.
- [ ] Verify sheet/highlight behavior, VoiceOver, and Dynamic Type.
- [ ] Simulate the required navigation scenarios in both directions, and confirm
      an out-and-back ride names its ways identically on both legs.
- [ ] Listen to the standalone bridge cue and compound maneuver timing, and
      confirm the long-run confirmation never lands on the final-phase call.
- [ ] Listen to every clean display name that a suggestion wanted to override,
      on an iOS simulator and one physical device. Add `spokenName` only where
      the recording is wrong, and record what was heard either way.
- [ ] Test foreground, background, crash-resume, stale-session, and flag-off
      rollback behavior.

**Activation sequence**

1. Land the per-span/reverse-ready runtime and the validator/publication
   contract in either code order.
2. Build and Promote a migration-mode bundle containing the existing pilot
   classifications and `manifest.guidance`. Naming improves where data exists
   and reads as facility class everywhere else.
3. Land the minimum editor suggestion-import path, re-score the digest-bound
   artifact, and classify the reference corpus.
4. Release the shared/web itinerary pilot in migration mode. Continue reviewed
   classification batches using its visible output as feedback.
5. Release navigation completion, schema-2 presentation snapshots, and native
   itinerary support while old manifests and schema-1 snapshots remain safe.
6. After coverage reaches 100%, build a required-mode staged map and let Promote
   strictly prepare the route catalog and every featured snapshot against it.
7. Promote once: resolved segments and all other map assets, catalog, and
   snapshots are copied as one target set; verify the release index/digest and
   switch the manifest last.
8. Verify web and native load the promoted map/segments hash and that flag-off
   uses class-only presentation while V6 restore/navigation geometry remain
   unchanged.
9. Monitor startup guard failures, class-fallback counters by reason,
   release-bundle mismatches, navigation session failures, and user-reported
   wording issues.
10. Roll back by disabling the flag if necessary; do not revert classifications
   or route data.

## Task 12 — post-activation compatibility cleanup

This task is deliberately separate from the first release.

- [ ] Remove remaining internal-name hover/focus compatibility callbacks after
      every caller uses the numeric segment-ID path introduced in Task 7.
- [ ] Migrate segment metadata joins, warning/POI association, and diagnostics
      to ID-first APIs while retaining old-name adapters at storage boundaries.
- [ ] Rename internal fields such as `name`, `cwSegmentId`, `onNetwork`, and
      `selectedSegments` only after all consumers have explicit replacements.
- [ ] Decide whether internal/editor labels may eventually repeat; do not relax
      current uniqueness in this project.
- [ ] Remove legacy segment-name navigation aliases only after supported old
      snapshots and app versions no longer require them.
- [ ] Measure whether riders miss route-only map labels once the itinerary has
      shipped, before building them. Measure full-network labels only after
      that.

## Explicitly deferred work

- Route-only guidance map labels on web and native. The candidate model is
  designed and consumes route runs, so building it later costs nothing
  structurally.
- Rich review-queue ordering, batch acceptance, contiguous bulk assignment, and
  the graphical structure visualizer. The first release still includes the
  minimal per-group suggestion import/review list. Build whichever richer tool
  removes a real bottleneck observed during Task 4.
- OSM `name`/`ref` publication for unaligned base-routing edges.
- A new base-routing shard schema for off-CycleWays named-road continuity.
- Multilingual visual naming beyond the initial Hebrew canonical name.
- Grouped multi-segment standalone facilities.
- Automatic acceptance of facility inference from internal names, Mapbox
  labels, proximity, or model output. Reviewable bootstrap suggestions are in
  scope; unreviewed canonical writes are not.
- Route-search cost changes based on way identity.
- Making named-way IDs part of route sharing or replay identity.

Any later OSM naming work must feed the same guidance-span and itinerary
contracts. It must use connected topology and curated overrides, not global
grouping by equal OSM text.

## Definition of done

- [ ] Registry enforcement is `required` and the clean build reports 100%
      active classification, no unresolved blockers, and no unacknowledged
      structure warnings.
- [ ] No way ID exists solely to satisfy a structural check.
- [ ] Paired forward/opposite direction-scoped segment/junction and guidance
      projections coexist throughout live route state and transforms.
- [ ] No code path emits an internal segment name as rider-facing copy, and the
      generic `enter-segment` cue is gone.
- [ ] Forward and reverse routes name their ways identically on an out-and-back.
- [ ] Reverse navigation never silently drops reviewed crossing evidence.
- [ ] Shared itinerary fixtures are semantically identical on web and native,
      including folding at `ITINERARY_FOLD_MAX_M`.
- [ ] Rider-facing planner surfaces no longer use internal segment names as
      primary copy when guidance mode is active.
- [ ] Clean display names and optional audible names are validated separately;
      iOS uses pronunciation punctuation without leaking it into visual UI, and
      every `spokenName` that shipped has a recorded listening result behind it.
- [ ] Every active segment received a digest-bound model proposal or explicit
      ambiguity result, and all canonical classifications were human-approved.
- [ ] Internal named-way boundaries produce no navigation cue.
- [ ] Standalone bridge, unnamed connector, parallel cycleway, network junction,
      conflict, reverse, loop, and re-entry cases pass automated and manual
      validation.
- [ ] Legacy links, exact V6 links, historical-anchor replans, and old snapshots
      recompute or fall back safely without weakening review requirements.
- [ ] The final manifest's release index binds the resolved segments, route
      catalog, and promoted snapshot hashes, and web/native use the same
      segments hash.
- [ ] Featured snapshot schema 2 round-trips visual itinerary runs only;
      starting navigation restores the catalog V6 token rather than treating
      those runs as routing evidence.
- [ ] Full tests, production build, offline asset sync, snapshot check, and smoke
      tests pass.
- [ ] Rollback has been exercised with `guidanceWayNames` disabled and produces
      class-only guidance without restoring internal segment speech.
- [ ] The implementation plan is updated with completion state, actual commands,
      deviations, and any remaining manual gates.
