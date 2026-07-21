# CycleWays Network Junctions — Implementation Plan

Date: 2026-07-21

Status: Derived-junction slice implemented on 2026-07-21; curated authoring and connector deprecation remain gated rollout work

## Implementation status

Implemented:

- deterministic relevant-junction generation, one-hop roundabout topology expansion,
  directional ports, legal movement coverage, preview GeoJSON, and source fingerprints;
- real-data regression coverage for Rager, #358, Kiryat Shmona, Horshat Tal,
  and Dafna;
- junction-bounded approach + ring + exit repair in migration and live network
  authoring, while retaining the existing roundabout repair contract;
- an exception-only review schema with stale-selection validation;
- the renamed Junctions editor workspace, relevant/movement filters, internal
  topology, entry/exit ports, one-way arrows, and selectable movement paths;
- Build refresh, validation, versioned runtime publication, Promote copying,
  and stale/invalid fail-closed behavior;
- direction-scoped `cwJunctions` compact-shard encoding and shared-core decode;
- connector eligibility, main-route cost, and unnamed
  `networkRole: "junction"` route spans; and
- web/mobile manifest loading and offline asset synchronization.

Rollout-gated follow-up:

- the editor flow for drawing a completely custom junction boundary and
  explicitly correcting proposed ports;
- authoritative custom movement selection during search (derived unique paths
  already use the same legal directed graph and require no override);
- Overlay V2 terminal attachments where paired carriageway ports cannot be
  inferred from current topology;
- deprecating connector segments #328/#329 after automated and manual parity;
  and
- route/share movement attestation beyond the full base-edge attestation that
  remains authoritative today.

Goal: Implement `plans/network-junctions/design.md` without weakening bicycle
traversal policy or changing unrelated base-network routing.

## Working rules

- Write source decisions only to `data/`; generated candidates remain under
  `build/`.
- Preserve all existing `data/roundabout-review.json` decisions.
- Every runtime movement is an attested ordered directed base-edge path.
- Do not make prohibited or unknown traversals routable through path cost.
- Use exception-based review; do not create 349 new mandatory decisions.
- Keep existing connector segments until parity and compatibility tests pass.
- Add real-data regression tests before mutating the corresponding records.

## Phase 1 — Contracts and real-data baselines

### Task 1.1 — Add network-junction fixtures

Create compact fixtures plus current-data regression helpers for:

- Rager 210/204/211 and OSM roundabout 842376170;
- Kiryat Shmona 263/143/361/144 and OSM roundabout 228885122;
- Horshat Tal 339/337/330/74/96 plus 328/329 and roundabout 1024609346;
- Dafna 330→334 and roundabout 1230594681; and
- segment 358 and roundabout 841155426.

Record current direction states, port candidates, internal topology, expected
movement coverage, and verified local replacement lengths. The tests must fail
if source geometry changes without an explicit fixture update.

Expected tests:

- a pure small-graph fixture suite;
- a current-data Rager movement suite;
- a current-data #358 local-repair suite; and
- snapshot diagnostics for the three later curated/migration cases.

### Task 1.2 — Define schema and validation vocabulary

Add language-neutral schema fixtures covering:

- derived and curated junctions;
- directional ports and segment attachments;
- unique, equivalent, ambiguous, and unavailable movements;
- selected movement realizations;
- stale/orphan review data; and
- invalid geometry, continuity, policy, or attachment evidence.

Create matching pure validation helpers for the editor/server and build
pipeline, following the existing roundabout/crossing review pattern. Add
cross-language fixture parity tests if validation exists in both JavaScript and
Python.

Deliverables include an initially empty:

```text
data/network-junction-review.json
```

with a versioned schema and no generated content.

## Phase 2 — Candidate generation and movement engine

### Task 2.1 — Generate relevant junction candidates

Add a deterministic local processor that reads:

- the graph selected by the active editor/build profile;
- `build/osm/roundabout-candidates.json`;
- `data/roundabout-review.json`;
- the Overlay V2 artifact selected by that profile (the staged overlay in the
  editor workflow);
- `data/map-source.geojson`; and
- current manual-edge and traversal-policy evidence.

Write:

```text
build/network-junctions/candidates.json
build/network-junctions/preview.geojson
build/network-junctions/report.json
```

Only accepted roundabouts relevant to CW topology, invalid alignments, explicit
manual junctions, or connector migration enter the movement candidate set.
Include source digests and coverage diagnostics.

### Task 2.2 — Expand roundabouts through approach lanes

Implement bounded topology expansion from a tagged ring through paired one-way
entry/exit connectors to stable external arm nodes.

Test:

- ordinary three-arm and four-arm rings;
- split entry/exit lanes;
- a service-road branch near the ring;
- neighboring roundabouts that must remain separate;
- an approach longer than the configured bound;
- disconnected or malformed rings; and
- no visual-proximity connection without graph continuity.

Diagnostics must explain every stop/ambiguity reason and list the internal edge
set and boundary nodes.

### Task 2.3 — Discover directional ports and segment attachments

For each relevant segment endpoint/direction:

- identify the continuous alignment terminal;
- propose the correct arrival or departure port;
- retain edge slice, coordinate, graph anchor, and source fingerprints;
- use existing endpoint zones unless a reviewed junction attachment exists;
  and
- report competing attachments rather than choosing by proximity alone.

Add tests for one logical endpoint with distinct incoming/outgoing carriageway
ports.

### Task 2.4 — Calculate movement coverage

Implement deterministic allowed-path search within the junction subgraph.

For every entry/exit pair:

- exclude same-arm U-turns by default;
- enforce per-direction normalized bicycle traversal policy;
- return full ordered edge refs and measured length;
- classify uniqueness/equivalence/ambiguity/unavailability;
- apply stable tie-breaking; and
- emit alternative summaries for review.

Add tests proving that a prohibited traversal never becomes an expensive
fallback.

### Task 2.5 — Generalize automatic local repair

Replace the ring-only eligibility assumption in the Direction Review authoring
path with junction-bounded local repair.

The implementation must:

- detect one contiguous blocked run inside one junction;
- preserve the external entry and exit anchors;
- allow replacement of approach + ring + exit edges;
- revalidate the complete repaired segment alignment;
- auto-apply only a unique/mechanically equivalent result; and
- attach audit data naming the junction and replaced/replacement refs.

Retain the old pure ring repair as a compatible special case until the new
suite proves parity.

Required regressions:

- existing #276 remains automatically repairable;
- #358 gains its legal approximately 63 m reverse replacement;
- Rager's three currently failing directions gain legal replacements; and
- a competing local path produces a review issue rather than auto-applying.

## Phase 3 — Review data and editor Junctions workspace

### Task 3.1 — Join candidates with curated decisions

Implement review joining with states:

- current derived;
- current curated;
- pending choice;
- stale topology;
- stale policy;
- stale segment attachment;
- invalid; and
- orphaned.

Unchanged movement selections survive unrelated graph rebuilds. A selected path
must become stale when any directed slice, policy state, port, or attached
segment mapping changes.

### Task 3.2 — Rename Roundabouts to Junctions without review loss

Change the top-level editor workspace label to **Junctions** and preserve the
existing classification review UI as a filter/facet.

Add filters for:

- relevant junctions;
- roundabouts;
- complex/custom bicycle junctions;
- movement issues; and
- classification issues.

No migration should rewrite the 349 existing roundabout reviews merely because
the workspace label changes.

### Task 3.3 — Render junction topology and ports

Add map sources/layers for:

- internal edges;
- direction arrows;
- boundary;
- entry ports;
- exit ports;
- external CW arms; and
- selected/alternative movement paths.

Preserve selected object and camera while changing CW/Base focus. Ensure the
focused network owns hit testing.

### Task 3.4 — Add the movement matrix

Show one matrix cell per meaningful arrival/departure pair. Selecting a cell
must highlight the exact path and display:

- segment/direction attachments;
- path length and edge count;
- policy evidence;
- automatic classification;
- competing alternatives; and
- stale/blocking cause.

Provide curator actions only when meaningful:

- choose this bicycle path;
- mark movement unavailable;
- restore automatic path; and
- edit internal base geometry.

### Task 3.5 — Add guided custom bicycle-junction authoring

From Base network focus:

1. select reviewed internal manual/OSM edges;
2. create a bicycle junction;
3. auto-detect nearby direction-specific segment ports;
4. show proposed coverage; and
5. save only explicit corrections/preferences.

Do not require JSON authoring or per-movement acceptance of unique valid paths.

### Task 3.6 — Group segment issues by junction

Direction Review and Build issue rows caused by one junction should link to one
junction-level issue. Segment inspectors retain a concise backlink describing
the affected movement.

## Phase 4 — Overlay terminal attachments and unnamed membership

### Task 4.1 — Extend Overlay V2 terminal validation

Add optional direction-specific terminal attachments to accepted/draft
realizations at junction endpoints.

Validation must prove:

- the declared port belongs to the junction;
- the segment alignment reaches the port continuously;
- arrival/departure usage matches traversal direction;
- the logical endpoint and reviewed attachment are compatible; and
- the port/mapping/junction digests are current.

Segments without junction attachments retain existing endpoint behavior.

### Task 4.2 — Compile direction-scoped `cw_junction` membership

Annotate runtime base edges participating in current allowed/selected movements
with directional junction membership. Do not collapse forward/reverse
membership.

Update compact routing shards, encoders/decoders, reports, and asset-size tests.
The compiler must not give membership to stale, unavailable, or prohibited
movement slices.

### Task 4.3 — Preserve segment and junction span roles

Extend route span construction so junction edges can be:

- on CycleWays network;
- intentionally unnamed; and
- identified with `networkRole: "junction"`.

Do not assign an arbitrary adjacent segment name to the junction. Keep segment
#358 named across its in-segment junction path.

## Phase 5 — Junction-aware routing

### Task 5.1 — Load compact junction runtime data

Publish a versioned optional junction artifact through the map manifest and
offline mobile asset generation. Load it through the shared asset layer with
backward-compatible absence behavior during rollout.

The runtime record contains only ports, movement policy, edge-share slices,
classification, and fingerprints required by routing/presentation.

### Task 5.2 — Enforce selected CW-to-CW movements

Extend base route search state while inside a junction so the planner knows the
entry port and can enforce the selected movement when leaving through another
attached CW port.

The returned result must still contain each underlying base-edge traversal.
Test routes beginning/ending inside the junction separately from full CW
transitions.

### Task 5.3 — Update connector eligibility and cost

Teach `connectorCostModel.js` and route-manager direction-scoped evaluation to
treat current allowed junction membership as CycleWays infrastructure.

Test:

- navigation to route start through a manual bicycle junction;
- rejoin through the junction;
- reverse traversal using only reverse-eligible membership;
- stale junction membership omitted; and
- unrelated manual edges remain excluded by the production connector profile.

### Task 5.4 — Validate every routing surface

Add shared-core tests for:

- planner route building;
- cue-point edits and snapping;
- reverse/return route;
- approach-to-start;
- off-route rejoin;
- route restore/share attestation; and
- web/native consumers using the same selected movements.

No surface may reverse a previously calculated junction geometry as a shortcut.

## Phase 6 — Navigation and presentation

### Task 6.1 — Emit junction-aware route spans and attestation

Add junction movement ids/fingerprints to route attestation and navigation-plan
fingerprints. Preserve full edge slices for deterministic crossing and
roundabout matching.

### Task 6.2 — Preserve roundabout and crossing cues

Run existing roundabout and crossing suites before changing cue derivation.

Initially:

- keep accepted roundabout shape matching as the cue authority;
- use junction paths only to improve route geometry and entry/exit evidence;
- ensure one roundabout cue remains one cue; and
- ensure reviewed crossing cues still replace/augment turns independently.

Only migrate cue matching to junction traversal records after parity fixtures
prove no regression.

### Task 6.3 — Present junctions as unnamed infrastructure

Verify itinerary, cards, map labels, voice, and segment spans:

- no fake “junction segment” name;
- destination CW segment name appears after the movement when available;
- existing #358 name continues across its roundabout; and
- migrated 328/329 names disappear only after their deprecation is released.

## Phase 7 — Real-data rollout

### Task 7.1 — Rager derived junction

Generate and inspect the 210/204/211 candidate. Assert all six intended
inter-segment movements are continuous and allowed. Rebuild affected segment
alignments and run route/reverse/approach/rejoin tests.

Manual editor validation:

- ports align with the actual entry/exit lanes;
- arrows match traffic direction;
- selecting each matrix cell shows the expected legal ring traversal; and
- web/mobile route geometry uses the same paths.

### Task 7.2 — Segment 358 automatic repair

Apply the unique local reverse repair and validate that both directions remain
one named segment. Test that no curator-created junction record is required for
the unique derived case.

### Task 7.3 — Kiryat Shmona custom bicycle junction

After the curator creates/reviews the physical sidewalk edges:

- create the custom junction;
- attach 263/143/361/144 directional ports;
- select the sidewalk realizations as authoritative CW movements;
- retain car-roundabout base legality unchanged; and
- test every offered movement in both planning and navigation.

### Task 7.4 — Horshat Tal connector migration

Build the junction while retaining 328/329. Compare:

- reachable segment pairs;
- complete geometry and distance;
- main/approach/rejoin routing;
- route names and instructions;
- current featured/recommended routes; and
- shared-route restore.

Only then mark 328/329 deprecated and add compatibility handling.

### Task 7.5 — Dafna entrance

Inspect/create the correct right-side physical base geometry, attach 330 and
334 ports, and validate the intended transition. Track the remaining #334
roundabout/direction issues separately so this task cannot hide them.

## Phase 8 — Build, promotion, and manual release gates

### Task 8.1 — Build validation and reporting

Add junction validation to `processing/build_map.py`, the editor Build report,
and promotion blockers. Report current/derived/curated/stale/invalid junctions,
movement coverage, compiled memberships, and deprecated-connector parity.

### Task 8.2 — Performance and background reconciliation

Instrument candidate expansion, movement path search, affected-alignment
refresh, shard compilation, and validation separately.

Use the network-editor background reconciliation queue so multiple quick base
or segment edits coalesce. Keep source editing responsive and refresh only
affected junctions/segments where dependency indexes permit it.

### Task 8.3 — Final automated suite

Run at minimum:

- schema/review fixture tests;
- candidate extraction and topology-expansion tests;
- current-data junction regressions;
- Direction Review migration/authoring tests;
- base-routing and shard encoding tests;
- connector strategy/surface tests;
- route sharing/restore tests;
- roundabout and crossing cue tests;
- navigation scenario tests; and
- full `npm test` plus relevant Python tests.

### Task 8.4 — Manual validation

Before promotion, validate in the editor and on both web and iOS:

- one derived ordinary roundabout junction;
- one curated bicycle-specific junction;
- one roundabout in the middle of a segment;
- reverse-route differences;
- navigation to start and rejoin through a junction;
- selected movement arrows and route geometry;
- destination segment names and roundabout/crossing instructions; and
- Build/Promote behavior after intentionally making one movement stale.

## Completion criteria

- Rager offers all intended legal transitions without manual segment-by-segment
  direction editing.
- #358 is valid both ways using different legal local paths while remaining one
  named segment.
- A curated bidirectional sidewalk junction can replace a car-roundabout path
  for CW transitions without falsifying car-ring directionality.
- Junction-internal manual edges work for main, approach, and rejoin routing.
- Web and mobile return-route creation never reverse illegal geometry.
- Existing roundabout reviews and crossing instructions remain intact.
- Connector segments 328/329 are not deprecated until automated and manual
  parity succeeds.
- The editor presents one junction movement problem instead of several opaque
  segment failures.
- Build fails closed on stale or invalid required movements and promotion
  publishes only current validated junction data.
