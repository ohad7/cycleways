# Reviewed road-crossing maneuvers — implementation plan

**Date:** 2026-07-14
**Status:** coordinate-authored crossing workflow implemented; manual release Build remains curator validation
**Design:** `plans/road-crossing-maneuvers/design.md`

## Goal

Implement an offline-reviewed road-crossing system modeled after the existing
roundabout workflow:

1. generate graph-wide `side-change` crossing candidates locally;
2. inspect, accept, reject, repair or manually add them in the editor;
3. publish only valid confirmed directed mappings in a versioned artifact;
4. match those mappings against attested routes for main, approach and rejoin
   navigation; and
5. replace false opposite-turn pairs with one first-class crossing cue.

## Coordinate-authored crossing implementation — 2026-07-22

This supersedes junction-first creation as the ordinary authoring path. The
junction review implementation remains useful context and compatibility code,
but new crossings begin with a coordinate guideline.

### Task 26 — support compact edge-path crossings

- [x] Add backward-compatible `edge-path` validation in JavaScript, Python and
      the mobile/web route matcher.
- [x] Require a non-empty directed action path and empty before/after arrays.
- [x] Preserve existing `action-path` and `junction-transition` behavior.
- [x] Validate share identity, fractions, continuity and bicycle traversal in
      Build.

### Task 27 — map a guideline to fractional base-edge slices

- [x] Reuse the persistent CW segment matcher for crossing guidelines.
- [x] Project the guideline endpoints onto the first and last matched edges.
- [x] Store partial first/last slices and complete intermediate slices without
      mutating the base graph.
- [x] Offer the reverse traversal only when every edge permits it.
- [x] Fingerprint guideline coordinates, edge geometry, fractions and policy.

### Task 28 — replace primary Crossing editor workflow

- [x] Show Base Network and CW Network in Crossings by default, with direct
      independent toggles.
- [x] Keep junction highlighting and one-way direction arrows off by default
      and expose each as an independent layer toggle.
- [x] Add New crossing, map-coordinate drawing, undo, cancel and match preview.
- [x] Ask only for the crossed-road name, guidance policy and whether to include
      a legal reverse traversal.
- [x] Preview the mapped base path and fractions before explicit confirmation.
- [x] List curated crossings only, ordered with CW crossings first; keep
      graph-wide candidate counts and states out of the primary workspace.
- [x] Remove aggregate detector statistics, the coverage explainer and the
      multi-purpose detector filter from the primary workflow.
- [x] Permit redrawing an authored crossing from its saved guideline.
- [x] Permit renaming a curated crossing without rematching its geometry or
      requiring generated-candidate freshness.
- [x] Complete curated crossing CRUD with a guarded delete action, predictable
      post-delete selection, and explicit reminder that Build publishes removal.
- [x] Reset new-crossing details instead of reusing a prior redraw, and make the
      Advanced JSON action reveal the editor it populates.
- [x] Represent every curated crossing as an independent list and map item;
      never merge it with generated candidates through junction review sites.
- [x] Remove candidate evidence, warnings, raw slices, mapping overrides,
      review notes and Accept/Reject controls from the primary detail.
- [x] Render selected mappings with dark-cased orange/yellow lanes, separated
      offsets and larger arrows; label one-way/bidirectional explicitly in the
      list and detail so direction is never color-only.
- [x] Keep the new-crossing name editable through path preview and apply its
      current value on Save without rematching geometry.
- [x] Keep every curated crossing visible as a muted clickable map path while
      reserving the warm high-contrast highlight for the selected crossing.
- [x] Support compound turn/roundabout/crossing → crossing speech so the
      follow-up suppression rule never hides an unspoken crossing.
- [x] Replay the reported ride with one persistent voice session and either the
      published crossing artifact or an explicit current-review fallback.
- [x] Compose reviewed crossings wholly contained by a roundabout into one
      crossing-and-exit announcement, retain missed-announcement fallbacks, and
      carry the named CW exit into speech.
- [x] Carry a named CW segment entered directly after a crossing into the
      crossing announcement.

### Task 29 — validation

- [x] Unit-test single-edge fractional, multi-edge, reverse and prohibited
      reverse proposals.
- [x] Test editor/server wiring, schema parity and manual record validation.
- [x] Run crossing regressions, the real-graph matcher endpoint and the full
      repository suite.
- [ ] Perform a curator-created crossing, Build and navigation replay as the
      final manual release check.

This plan changes navigation semantics but not route search costs or route
geometry.

## Implementation status — 2026-07-14

Implemented and automated:

- schema/review parity modules and source-controlled empty review data;
- local graph-wide candidate generation with stable-share completeness,
  traversal-policy and known grade-separation gates;
- a Crossings editor workspace showing all candidates/mappings, corridor and
  direction overlays, independent mapping acceptance, advanced validated
  mapping repair, and manual multi-mapping records;
- Build validation, optional confirmed-only `crossings.json`, immutable
  manifest/Promote cleanup, shared asset loading, and native offline sync;
- pure directed attestation matching with partial-slice progress, graph/policy
  compatibility, reviewed-anchor sanity checks, repeated visits, and
  null-versus-empty evidence;
- effective main-route preparation and shared connector attestation/matching
  for both approach and rejoin;
- `navigation-cues-v3`, corner suppression, crossing cue/compound behavior,
  Hebrew and English speech, dedicated presentation/icon, normal maneuver
  haptics, camera eligibility, and navigation-plan fingerprinting; and
- focused crossing suites, existing roundabout/directionality regressions,
  the complete `npm test` suite, and the production web build.

Implementation refinements still open:

- replace the editor's advanced JSON mapping repair/manual editor with the
  guided click-by-click ordered edge trace described in Task 6;
- add server-level manual update/delete convenience endpoints and browser smoke
  coverage (Build remains the authoritative graph/policy validator meanwhile);
- expand the detector control corpus and candidate audit reports beyond the
  initial synthetic and Road 99 diagnostics; and
- add the final committed Road 99 route/cue regression after its stable shares,
  direction policy, and crossing mapping can be reviewed rather than guessed.

Historical first-data blockers were the 475 missing stable shares and the Road
99 manual-edge direction review. Both are resolved on the 2026-07-22 graph;
candidate generation and confirmed-only publication now complete normally.
Current first-data gates are:

- replace the raw candidate queue with the prioritized site workflow below;
- accept/repair the two reported-ride mappings in the Crossings editor;
- build and replay a real artifact without injected test evidence; and
- complete editor plus simulator/device/audio validation before Promote.

The graph-wide diagnostic run using a temporary complete registry produced
1,656 logical candidates and found Road 99 as
`crossing:1092567462:33.2351-35.5800:48308`, with action share 48308. That run
was not promoted or copied into source-controlled review data.

## Experimental intersection guidance amendment — 2026-07-15

Implement a manually reviewed `junction-transition` representation for the
three-segment Margaliot intersection and a persistent, default-on rider
preference. This amendment is deliberately narrower than automatic junction
detection: only an explicit directed mapping can produce the extra guidance.

The implementation must preserve two outcomes from the same route:

- preference on: `cross carefully, then turn left onto <segment>`;
- preference off: the existing ordinary named left-turn cue.

Existing action-path crossings remain unconditional and are unaffected by the
new setting. Route search, route geometry and bicycle directionality do not
change.

Implementation completed on 2026-07-15. Automated validation includes the
reviewed Margaliot graph transition, both preference states, the 9977 right-turn
negative control, durable preference defaults, crash-resume restoration, the
focused crossing/navigation suites, production build and full repository test
suite. Manual editor and device/audio checks remain deferred. The previous
stable-share publication gate is resolved; the current gate is the reviewed
first crossing data slice described below.

## Headless Road 99 impact validation — 2026-07-15

The corrected coordinate replay was run without the editor or simulator, first
with current publishable evidence and then with the discovered Road 99 mapping
injected as explicitly confirmed test evidence. Both passes used the same
route geometry and attestation.

| Evidence | Current baseline | Confirmed-mapping simulation |
|---|---:|---:|
| Route distance | 10,111.568 m | 10,111.568 m |
| Route content fingerprint | `sha256-e38b982c…` | identical |
| Ordinary turns | 19 | 17 |
| Crossings | 0 | 1 |
| Roundabouts | 6 | 6 |
| Action interval | right at 3,822.35 m, left at 3,838.58 m | crossing from 3,822.25–3,838.25 m |
| Following maneuver | straight roundabout at 3,893.57 m | preserved and compounded |
| Final Hebrew speech | `פנה ימינה ומיד שמאלה` | `חצו בזהירות לצד השני של הכביש, ואז בכיכר המשיכו ישר` |

This replay exposed and fixed a matcher edge case: the route attestation splits
departure share 48320 at a waypoint boundary, while the reviewed mapping
correctly represents the same continuous edge as one slice. Matching now joins
adjacent, directionally contiguous slices of the same stable edge without
allowing unrelated intervening edges. The focused matcher test and a named Road
99 impact regression lock this behavior into `npm run test:crossings`.

This historical replay validated the expected instruction and proved the route
itself was unchanged. It was not editor acceptance at the time. The stable
share and direction-review blockers have since been resolved; what remains is
to curate the current mappings and replay them from a real built artifact.

## Junction-first curation rollout — 2026-07-22

The previous stable-share blocker is resolved on the current graph. A fresh
local generator run completes with full graph/share coverage:

- 1,611 logical candidates;
- 10,113 directed mappings;
- 0 accepted generated candidates;
- 1 existing manual `junction-transition`; and
- no Build blocker when the fresh candidate artifact is present.

A clean temporary Build publishes the existing manual crossing and reports
1,611 pending generated reviews. The obstacle is now curator scale and product
prioritization, not generation or runtime publication. These tasks amend Tasks
3–6 and the first-data rollout; existing matching/publication/cue tasks remain
authoritative.

The current reference ride is approximately 10,082.9 m after later CW network
curation. That replay, not the historical 10,111.6 m table, is the release
baseline for Tasks 24–25.

### Junction-centered curation implementation record — 2026-07-22

The first junction slice is implemented. The editor now joins generated and
manual crossings to junction movements by exact stable-share/base-edge overlap
inside the junction boundary, groups them into one deterministic review site
per physical junction, and shows the selected junction geometry, ports and
legal movement in Crossings. Selecting a row fits the complete junction;
selecting a proposal within it isolates that proposal and its exact movement
evidence while leaving the other site markers visible.
The current primary workspace goes one step further: it exposes curated
crossings only and keeps the complete generated-candidate queue as build
diagnostic data rather than an ordinary editor list.

A selected legal movement in a published, non-roundabout bicycle junction now
offers **Add crossing guidance**. The server converts its current directed
edge path into an unsaved proposal: a two-edge movement becomes an optional
`junction-transition`, while a longer movement retains its internal action
slices as an unconditional `action-path`. The curator chooses left/right,
reviews the highlighted trace in Crossings, and must explicitly confirm or
cancel. Nothing is written by proposal creation.

Confirmed junction crossings carry the junction and movement identity plus the
current junction fingerprint. Build rejects a missing junction, changed
fingerprint or unavailable movement, in addition to the existing edge,
continuity and traversal-policy gates. Roundabout movements are intentionally
refused by this action until the separate approach/departure authoring flow is
implemented.

### Task 18 — produce topology and route-impact associations

- [x] Add deterministic optional context for exact junction movements and
      roundabout identity using stable-share/base-edge overlap plus the
      junction boundary.
- [ ] Add roundabout phase, accepted CW alignment and route-corpus context.
- [ ] Add an offline route-impact audit over reference, featured and catalog
      route attestations without treating matches as accepted crossings.
- [x] Bind confirmed junction context to its junction fingerprint and movement;
      Build rejects changed or missing evidence.
- [ ] Validate that action-path intervals do not overlap a roundabout ring.
- [ ] Record deterministic per-scope counts in the candidate payload.
- [ ] Keep context advisory; exact directed mappings remain runtime authority.

**Tests**

- [ ] exact junction movement associated; nearby unrelated movement omitted;
- [ ] before/after-roundabout association and overlap rejection;
- [ ] CW-alignment and route-corpus association;
- [ ] harmless input ordering leaves associations unchanged; and
- [ ] junction topology changes stale only linked accepted evidence.

### Task 19 — generate reviewed-only junction-transition proposals

- [ ] Examine relevant entry-to-exit movements against nearby motor-road
      corridors and signed side-of-corridor evidence.
- [ ] Propose `junction-transition` only when the movement changes sides and no
      physical action-path proposal represents the same event.
- [ ] Carry entry/exit port ids, movement id, exact before/after directed slices
      and suggested continuation direction.
- [ ] Never auto-accept, infer reverse movement or classify every junction
      movement as a crossing.
- [ ] Deduplicate junction and action-path proposals for one movement.
- [ ] Cover Margaliot, the reported Tel Hai site and ordinary-turn negatives.

### Task 20 — add generated crossing review sites

- [x] Add non-authoritative `reviewSites` to the editor response.
- [x] Prefer exact junction/roundabout context and retain deterministic
      standalone sites otherwise.
- [x] Keep site grouping display-only; exact mappings remain review and runtime
      authority.
- [x] Derive site state: needs review, partially reviewed, confirmed, no
      guidance, stale or conflict.
- [x] Preserve accepted crossing identity independently of site organization.
- [ ] Add a separate expert diagnostic surface only if candidate inspection is
      needed again; the primary workspace intentionally has no detector presets.

### Task 21 — replace the raw list with a map-first site workflow

- [x] Default to curated crossing sites on the map, not raw mapping rows.
- [x] Keep generated candidates in the response and build diagnostics without
      exposing them in the primary authoring list.
- [x] Show corridor, base directions, junction ports/movements and mapping
      traces together; affected-route and CW-arm overlays remain pending.
- [x] Present review sites and their visible directed movements before expert
      share IDs and hashes.
- [ ] Add **No guidance**, **Cross road**, **Cross then turn** and
      **Repair movement** actions.
- [ ] Preview exact Hebrew wording and unconditional/optional policy.
- [ ] Keep expert slices/fingerprints in collapsed diagnostics.
- [ ] Save reviews immediately; require Build only for publication.

### Task 22 — guided creation from junctions, roundabouts and base network

- [x] Add **Add crossing guidance** to a selected legal Junctions movement.
- [x] Pre-fill a current directed mapping, let the curator choose continuation,
      preview it in Crossings and explicitly confirm or cancel.
- [ ] Add roundabout-adjacent creation from an approach/departure while keeping
      its action outside the ring.
- [ ] Replace manual JSON as the primary path with ordered map selection of
      approach, action and departure; retain JSON for diagnostics/import.
- [ ] Support multiple explicit directions/variants under one logical crossing.
- [ ] Add edit/delete, stale-evidence explanation and pre-save undo.

### Task 23 — support reviewed entry-maneuver wording

- [ ] Add optional mapping `entryManeuver` with controlled `left`/`right` and
      JavaScript/Python validation parity.
- [ ] Suggest it from stable approach-to-action bearings but require review.
- [ ] Preserve generic crossing wording when absent.
- [ ] Carry it through publication, matching, cue, presentation, voice,
      persistence and fingerprinting.
- [ ] Combine entry, crossing, continuation and destination into one cue
      without resurrecting suppressed geometry corners.
- [ ] Add the Tel Hai geometry regression: left to cross, right onto the trail.

### Task 24 — coverage dashboard and release gates

- [ ] Report reviewed/pending/confirmed/stale counts separately for reference
      routes, route catalog, CW alignments, published junction movements,
      OSM-tagged candidates, major roads and the full graph.
- [ ] Never present unreviewed as safe or “no guidance.”
- [ ] Require all selected reference-route matches decided for first release;
      keep unrelated pending candidates non-blocking.
- [ ] Show affected-route and before/after cue previews before acceptance.
- [ ] Keep stale accepted/invalid mappings blocking.

### Task 25 — curate and validate the first data slice

- [ ] Review the Tel Hai crossing movement from the reported route.
- [ ] Review the crossing around 3.82 km and preserve its following roundabout.
- [ ] Build a real artifact without synthetic evidence injection.
- [ ] Assert unchanged route traversal fingerprint and distance tolerance.
- [ ] Assert one semantic cue per crossing with correct entry, continuation and
      destination guidance.
- [ ] Assert roundabout cues remain independently available and compound safely.
- [ ] Assert negative-control branches do not match.
- [ ] Validate one crossing outside CW on an approach/rejoin route.
- [ ] Complete editor and simulator/device/audio review before Promote.

## Delivery order

The work should land in five independently testable layers:

```text
candidate extraction
    → review/editor
        → build/publication/assets
            → route matching
                → cue and rider experience
```

Do not begin cue suppression until the confirmed artifact and matcher are
testable. Do not publish a runtime artifact until the editor can repair
multi-edge and direction-specific mappings.

## Global invariants

- Generated files under `build/` and `public-data/` are never hand-edited.
- Human decisions live only in `data/crossing-review.json` and are written
  atomically.
- Candidate generation performs no network access and never invokes OSM fetch.
- Candidate confidence never means automatic acceptance.
- Runtime uses only confirmed mappings; it never runs the candidate heuristic.
- Edge identity uses stable `edgeShareId`, never ephemeral array index or shard
  position.
- Mapping directions are explicit and must agree with the reviewed bicycle
  traversal policy.
- A logical crossing may contain several action slices and several mapping
  variants.
- `null` crossing evidence means unavailable; `[]` means evaluated with no
  match.
- Route content, route legality and route search cost remain unchanged.
- Missing crossing data preserves existing turn guidance.
- Stale accepted data cannot be promoted or resurrected from an older file.
- Main, approach and rejoin use the same pure matcher.
- The first release publishes only `kind: "side-change"`.
- `junction-transition` is a representation of `side-change`, not a new route
  edge or logical CW segment.
- Empty action arrays are valid only for reviewed junction transitions with
  contiguous before/after context, coincident anchors and a continuation turn.
- The user preference filters only `guidancePolicy: "user-option"`; reviewed
  action-path crossings stay active.

## Task 17 — optional intersection crossing experiment

**Design target**

- Keep logical segment and direction models unchanged.
- Add backward-compatible crossing fields:
  `representation`, `guidancePolicy` and mapping `continuation`.
- Persist `intersectionCrossingGuidanceEnabled`, defaulting true.

**Schema, review and publication**

- [x] Update Python and JavaScript crossing validators in parity.
- [x] Keep `action-path` mappings unchanged and require their action slices.
- [x] Allow action-less `junction-transition` mappings only with non-empty
      directed before/after context, coincident anchors and a reviewed left or
      right continuation.
- [x] Preserve representation/guidance fields in confirmed runtime artifacts.
- [x] Validate topology continuity and policy for before→after without treating
      every empty action signature as the same crossing.
- [x] Show representation, optional policy and continuation in the Crossings
      editor; draw a visible context arrow even when entry equals exit.

**Runtime matching and cue semantics**

- [x] Match the before→after signature without skipping route slices.
- [x] Place the route-relative entry and exit at their shared attested boundary
      and retain anchor sanity checks.
- [x] Carry representation, guidance policy and continuation through route
      matching, navigation-route cloning, approach and rejoin legs.
- [x] Add `intersectionCrossingGuidanceEnabled` to cue-building options and use
      the same immutable option for main, approach and rejoin cue lists.
- [x] With the option on, suppress the colocated ordinary turn and speak/show
      crossing → turn, including the destination CW segment name.
- [x] With the option off, omit only the optional crossing before suppression
      and preserve the ordinary named turn.
- [x] Ensure an existing `always` crossing still replaces its noisy geometry
      when the option is off.

**Native preference**

- [x] Add a durable, schema-versioned ride-guidance preference store with
      fail-safe default `true`.
- [x] Add a Hebrew toggle in Ride Settings explaining that it adds
      “cross, then turn” at reviewed intersections.
- [x] Save immediately, include the value in navigation telemetry and active
      session settings, and use it in background/crash-resume processing.

**Margaliot reviewed example and validation**

- [x] Add only the directed dirt-road→north-sideline mapping using stable
      shares `17233 reverse → 42656 reverse` at
      `33.2205053, 35.548282`.
- [x] Keep dirt-road→9977 (`42652 forward`) as an ordinary right turn.
- [x] Do not infer the reverse crossing.
- [x] Add one real-data regression loading the reviewed record and current base
      graph: matcher on/off cue delta, Hebrew phrase and right-turn negative
      control.
- [x] Extend schema/review/publication, matcher, cue, voice, presentation,
      persistence and navigation-session tests.
- [x] Run `npm run test:crossings`, focused navigation tests, `npm run build`,
      full `npm test` and `git diff --check`.

**Manual gates**

- [ ] Inspect the transition in the Crossings editor, including the visible
      approach/departure arrow and one-way layer.
- [ ] Listen to both preference states on simulator/device when local access is
      available.

## Task 0 — preserve and measure the corrected baseline

**Files/tests**

- Existing Road 99 coordinate replay and cue inspection scripts.
- Add a focused route fixture only if the current replay is not already
  stable enough for exact assertions.

**Steps**

- [ ] Re-run the corrected strict Road 99 route from the recorded coordinates.
- [ ] Record route distance, route-content fingerprint, graph version, policy
      digest, ordered traversal shares around all original feedback sites and
      current cue list.
- [ ] Lock these current facts:
  - [ ] route distance approximately 10,111.6 m within existing tolerance;
  - [ ] valid directional route attestation;
  - [ ] 19 ordinary turn cues;
  - [ ] remaining right/left pair around 3,822–3,838 m;
  - [ ] following straight-roundabout record and cue;
  - [ ] old Tel Hai 154° cue absent;
  - [ ] via-point spur and repaired geometry gaps remain absent.
- [ ] Record the current action-edge evidence at the remaining crossing,
      including share 48308 and the relevant partial traversal of share 48320;
      derive approach/departure shares from the replay rather than hard-coding
      assumptions from the design example.
- [ ] Preserve the original 87°/87° pure sidestep as a synthetic detector
      fixture even though the corrected route no longer takes that path.
- [ ] Run current focused navigation/camera/roundabout suites and full
      `npm test` before production changes.

**Acceptance**

- Baseline evidence is reproducible from committed inputs.
- Later crossing tests compare route facts separately from cue facts, so cue
  improvements cannot hide a route regression.

## Task 1 — define candidate, review and runtime schemas

**Files**

- Create `processing/crossing_review.py`.
- Create `editor/lib/crossingReview.mjs`.
- Create `tests/fixtures/crossing-review-cases.json`.
- Create Python and Node parity tests.

**Steps**

- [ ] Define schema version 1 for:
  - [ ] generated candidate payload;
  - [ ] logical crossing candidate;
  - [ ] directed traversal mapping;
  - [ ] source-controlled review entry;
  - [ ] curator-authored manual crossing;
  - [ ] promoted runtime payload.
- [ ] Reuse route-attestation fraction quantization: integers 0–1,000,000.
- [ ] Validate `before`, `action` and `after` slice arrays independently.
- [ ] Require at least one slice in each section for a complete v1 mapping.
- [ ] Require finite entry/exit coordinates, non-empty logical/mapping IDs,
      unique IDs, valid bounds and `kind: "side-change"`.
- [ ] Model review states:
  - [ ] `pending` — no decision;
  - [ ] `accepted` — matching fingerprint and at least one selected mapping;
  - [ ] `rejected` — matching fingerprint and no published mapping;
  - [ ] `stale-accepted` — changed candidate previously accepted;
  - [ ] `stale-rejected` — changed candidate previously rejected;
  - [ ] `orphaned` — review ID absent from candidates;
  - [ ] `invalid` — malformed review or mapping.
- [ ] Treat `stale-accepted` and invalid accepted/manual records as blocking.
- [ ] Treat pending, stale-rejected and orphaned records as visible warnings but
      not general Build blockers.
- [ ] Validate accepted mapping IDs exist in the current candidate unless a
      valid override replaces them.
- [ ] Validate mapping overrides against the same contract and require a
      `replacesMappingId` plus source-edge fingerprint.
- [ ] Validate manual crossings and their audit/source fingerprints.
- [ ] Implement identical normalization, ordering, summary counts, warning and
      blocking-issue codes in Python and JavaScript.

**Tests**

- [ ] accepted/rejected/pending/stale states;
- [ ] accepted forward mapping with reverse omitted;
- [ ] multiple accepted mappings;
- [ ] repaired mapping override;
- [ ] manual logical crossing;
- [ ] missing or repeated share IDs/slices;
- [ ] invalid/reversed fractions and zero-length action;
- [ ] duplicate logical/mapping IDs;
- [ ] orphaned reviews;
- [ ] deterministic ordering and Python/JS parity.

**Acceptance**

- The same fixture produces byte-equivalent normalized promoted records and
  issue codes in processing and editor code.

## Task 2 — implement the local graph-wide candidate generator

**Files**

- Create `processing/build_crossing_candidates.py`.
- Create `processing/test_build_crossing_candidates.py`.
- Add `crossings:candidates` and a focused test script to `package.json`.
- Document the command in `processing/README.md`.

**Inputs/defaults**

```text
build/osm/osm-base-graph-elevated.json
data/base-edge-share-ids.json
current reviewed bicycle traversal-policy source/digest
optional CW overlay for diagnostics
→ build/crossings/candidates.json
```

**Steps**

- [ ] Fail clearly when graph, share registry or traversal policy is missing.
- [ ] Prove the command has no network path and never invokes OSM fetch.
- [ ] Compute canonical input digests and coverage fields.
- [ ] Join every graph edge to its stable share ID; report missing and duplicate
      joins as blocking generator errors.
- [ ] Normalize edge geometry, direction policy, road class, source tags,
      bridge/tunnel/layer values and source identity.
- [ ] Build a local spatial index for motor-road corridor segments; do not scan
      every road against every edge quadratically.
- [ ] Build a node/edge adjacency index respecting allowed bicycle direction.
- [ ] Enumerate bounded local action paths, initially 4–60 m and at most a
      documented small edge count.
- [ ] For each path:
  - [ ] project entry/exit anchors onto a candidate road corridor;
  - [ ] compute signed side-of-corridor and lateral separation;
  - [ ] measure approach, action, departure and net headings over stable arms;
  - [ ] verify approach/departure context is not the same action path;
  - [ ] collect positive OSM/path/crossing/CW evidence;
  - [ ] reject known grade-separated paths;
  - [ ] warn when grade-separation evidence is incomplete;
  - [ ] create explicit directed `before/action/after` slices;
  - [ ] derive the reverse mapping only when every reversed slice is allowed.
- [ ] Group mappings into logical crossings using crossed-road identity,
      anchors and overlapping action signatures; never proximity alone.
- [ ] Deduplicate exact directed mapping signatures.
- [ ] Compute stable logical IDs, mapping IDs and fingerprints.
- [ ] Emit deterministic sorted JSON; `generatedAt` must be the only
      intentionally variable field.
- [ ] Emit audit counters for considered paths, each rejection reason,
      confidence/evidence buckets, warnings and resulting logical/mapping
      counts.

**Candidate-generation tests**

- [ ] one-edge crossing connector;
- [ ] multi-edge crossing action;
- [ ] partial first/last edge slices;
- [ ] forward-only and bidirectional mappings;
- [ ] opposite sides of the same corridor;
- [ ] parallel side paths and dual carriageways;
- [ ] manual edge mixed with OSM edge;
- [ ] OSM `footway=crossing` positive evidence;
- [ ] bridge, tunnel and incompatible layer rejection;
- [ ] same-side connector rejection;
- [ ] road-following edge rejection;
- [ ] U-turn/switchback rejection;
- [ ] perpendicular ordinary intersection omitted from `side-change` output;
- [ ] nearby distinct crossings do not merge;
- [ ] stable IDs with harmless source ordering changes;
- [ ] changed geometry/policy changes fingerprint;
- [ ] no network access and deterministic output.

**Acceptance**

- The command completes on the complete current base graph with bounded memory
  and a useful audit summary.
- It produces candidates outside CW membership as well as within it.

## Task 3 — calibrate candidates against real and control locations

**Files**

- Add small named base-network fixtures under `tests/fixtures/`.
- Add a deterministic candidate-report script if Python output alone is not
  sufficient for inspection.

**Steps**

- [ ] Verify the remaining Road 99 crossing appears as one logical candidate
      with the correct action and direction mapping(s).
- [ ] Verify the original 87°/87° crossing shape produces a candidate in its
      synthetic network fixture.
- [ ] Check the old Tel Hai location and explain whether no candidate exists or
      why it remains pending/rejected; do not force it into a positive fixture.
- [ ] Add controls for ordinary chicanes, adjacent junction turns, roundabout
      entry/exit, dual carriageway ramps, bridges, tunnels and path-to-road
      joins that are not side changes.
- [ ] Run the generator across the current graph and stratify candidates by:
  - [ ] inside/outside CW membership;
  - [ ] evidence/confidence bucket;
  - [ ] motor-road class;
  - [ ] forward-only/bidirectional;
  - [ ] one-edge/multi-edge;
  - [ ] warning type.
- [ ] Tune only broad candidate thresholds. Do not optimize for a low count by
      hiding uncertain candidates from review.
- [ ] Record known limitations and candidate counts in the plan implementation
      status when code lands.

**Acceptance**

- Road 99 is discoverable without embedding its coordinates as a production
  special case.
- Negative fixtures remain candidates only when deliberately warning-worthy,
  never silently promoted.

## Task 4 — implement review joining and editor API

**Files**

- Continue `editor/lib/crossingReview.mjs`.
- Modify `editor/server.mjs`.
- Add server/lib tests.
- Initialize `data/crossing-review.json` only through a reviewed patch or the
  editor’s empty schema, not generated output.

**Endpoints**

```text
GET  /api/crossings/review
POST /api/crossings/review
POST /api/crossings/manual
PUT  /api/crossings/manual/:id
DELETE /api/crossings/manual/:id
```

**Steps**

- [ ] Read candidates and review data with clear 409 errors for missing/stale
      candidate generation.
- [ ] Recompute graph/share/policy digests and expose `sourceFresh`.
- [ ] Join generated candidates, reviews and manual crossings.
- [ ] Return summary, coverage, warnings, blocking issues, items, orphaned
      reviews and map GeoJSON.
- [ ] Generate separate GeoJSON collections for:
  - [ ] crossed-road corridors;
  - [ ] approach paths;
  - [ ] action paths;
  - [ ] departure paths;
  - [ ] entry/exit arrows/points;
  - [ ] warning/invalid markers.
- [ ] On review writes, require current candidate ID and fingerprint.
- [ ] Accept only current mapping IDs or validated mapping overrides.
- [ ] Enforce note length and status contract.
- [ ] For manual create/update, validate every referenced share ID against the
      current base graph and policy before writing.
- [ ] Use stable manual IDs generated by the server and preserve `createdAt`;
      update `updatedAt` on change.
- [ ] Write the entire review file atomically and return freshly joined state.
- [ ] Reject lost-update writes using candidate/source fingerprints.
- [ ] Do not mutate candidate, graph, overlay or OSM files.

**Tests**

- [ ] GET empty, populated, missing-candidate and stale-source states;
- [ ] accept/reject and selected mapping IDs;
- [ ] stale client fingerprint rejection;
- [ ] valid/invalid mapping override;
- [ ] manual create/update/delete;
- [ ] direction-policy violation;
- [ ] atomic-write failure leaves prior file intact;
- [ ] GeoJSON carries state and mapping identifiers.

**Acceptance**

- API behavior is deterministic and the only writable file is
  `data/crossing-review.json`.

## Task 5 — build the Crossings review workspace

**Files**

- Modify `editor/index.html`.
- Modify `editor/editor.js`.
- Modify `editor/styles.css`.
- Extend browser/editor smoke tests where available.

**Steps**

- [ ] Add a **Crossings** workspace button next to Roundabouts and directional
      review tools.
- [ ] Load review state only when the workspace opens; show loading, stale and
      error states honestly.
- [ ] Add filters: All, Pending, Accepted, Rejected, Stale, Manual, Warnings.
- [ ] Show summary counts and graph/share/policy freshness.
- [ ] Draw every candidate at once with stable state colors.
- [ ] Draw selected mapping with distinct styles for before/action/after.
- [ ] Draw entry-to-exit arrowheads large enough to understand direction at
      normal editor zoom.
- [ ] Highlight the crossed road independently from the route mapping.
- [ ] Keep base one-way edge arrows visible and legible underneath/alongside
      the crossing overlay.
- [ ] Selecting a row or map feature fits to its bbox and opens details.
- [ ] Detail panel shows:
  - [ ] logical kind and crossed road;
  - [ ] source IDs/links and graph edge/share IDs;
  - [ ] evidence, warnings and candidate metrics;
  - [ ] mapping direction and slice fractions;
  - [ ] bicycle policy state/reason for each direction;
  - [ ] candidate/review/source fingerprints;
  - [ ] review note.
- [ ] Add Accept, Reject, Previous and Next keyboard-friendly actions.
- [ ] Require at least one selected mapping before Accept.
- [ ] Allow selecting forward/reverse/alternate mappings independently.
- [ ] Make pending/stale/invalid states impossible to confuse with accepted.
- [ ] Preserve selected item/filter across successful writes where possible.

**Visual acceptance**

- [ ] At the Road 99 candidate, the map clearly shows the starting side, action
      edge set, destination side, crossed road and supported direction.
- [ ] A curator can distinguish two nearby crossings without toggling the base
      graph off.
- [ ] No browser errors or invisible click targets at desktop editor sizes.

## Task 6 — implement mapping repair and manual crossing creation

**Files**

- Continue editor UI/server/lib modules.
- Reuse existing base-edge selection and one-way layer helpers where possible.
- Add focused pure tests for trace construction.

**Mapping-edit steps**

- [ ] Add **Edit mapping** mode for generated and manual records.
- [ ] Guide the curator through crossed road, approach, action and departure
      selection in that order.
- [ ] Restrict action selection to a contiguous directed path; show why a
      proposed next edge is invalid.
- [ ] Allow entry/exit anchors to snap to an interior fraction of first/last
      action edges.
- [ ] Display ordered slice numbers and direction arrows.
- [ ] Validate every selected traversal under current bicycle policy.
- [ ] Allow replacing one generated mapping without changing other accepted
      variants.
- [ ] Show a diff between generated and override mappings before save.
- [ ] Provide Cancel/Undo during an edit without changing review data.

**Manual-add steps**

- [ ] Add **Add crossing** from the Crossings workspace.
- [ ] Create one logical record, then add one or more directed mappings.
- [ ] Support “derive reverse” only when the policy validator proves it legal;
      still require the curator to confirm the derived mapping visually.
- [ ] Require crossed-road selection or an explicit “unnamed road” value with
      map anchor.
- [ ] Require a note for manual crossings and mapping overrides.
- [ ] Save source-edge fingerprints and audit timestamps.
- [ ] Allow later edit/delete with confirmation.

**Tests**

- [ ] valid one-edge and multi-edge trace;
- [ ] discontinuity and wrong direction rejection;
- [ ] partial edge anchors;
- [ ] legal/illegal reverse derivation;
- [ ] alternate mapping for same logical crossing;
- [ ] cancel/undo leaves state unchanged;
- [ ] source edge change makes override/manual record stale.

**Acceptance**

- A curator can correctly represent a crossing the detector missed or split
  across several edges without hand-editing JSON.

## Task 7 — join reviews during Build and publish confirmed data

**Files**

- Modify `processing/build_map.py`.
- Continue `processing/crossing_review.py`.
- Add `tests/test_crossing_build.py`.
- Extend build-validation reports.

**Steps**

- [ ] Add candidate/review CLI paths with repository defaults.
- [ ] Recompute and validate source graph, share registry and policy digests.
- [ ] Join candidate reviews and manual crossings.
- [ ] Validate every accepted mapping against the graph actually used for the
      routing build, not only candidate-time metadata.
- [ ] Resolve mapping overrides and selected mapping IDs.
- [ ] Detect duplicate signatures and overlapping logical crossings.
- [ ] Emit pending/stale-rejected/orphaned counts as warnings.
- [ ] Block on stale accepted, invalid accepted/manual records, source mismatch,
      missing shares, prohibited directions and mapping conflicts.
- [ ] Write compact `build/public-data/crossings.json` containing only runtime
      fields and accepted mappings.
- [ ] Include graph version, source/share/policy digests and review summary.
- [ ] If there are zero accepted/manual crossings, intentionally omit the
      runtime artifact and manifest entry rather than publishing an ambiguous
      empty stale file.
- [ ] Keep rejected/pending evidence and notes out of runtime data.

**Tests**

- [ ] accepted subset publishes while unrelated pending candidates warn;
- [ ] stale rejected warns, stale accepted blocks;
- [ ] manual record publishes;
- [ ] forward-only selection omits reverse;
- [ ] source/policy/share mismatch blocks;
- [ ] duplicate/conflicting mapping blocks;
- [ ] zero confirmed records omits artifact;
- [ ] deterministic compact output and digest.

**Acceptance**

- Build cannot publish a mapping that the current graph or direction policy no
  longer supports.

## Task 8 — manifest, Promote and mobile offline assets

**Files**

- Build manifest/promotion helpers and tests.
- `packages/core/src/data/mapAssets.js`.
- Mobile offline sync script and generated asset map only after Promote.
- `tests/test-map-assets.mjs`, `tests/test-editor-promote-targets.mjs` and a new
  `tests/test-mobile-crossing-assets.mjs`.

**Steps**

- [ ] Register runtime artifact as `manifest.crossings`.
- [ ] Add `hashes.crossings` and include it in manifest version/release digest.
- [ ] Promote the immutable/versioned crossing artifact like roundabouts.
- [ ] Remove an older promoted crossing file when current manifest omits it.
- [ ] Extend `loadMapAssets` with `includeCrossings`, defaulting false for
      surfaces that do not navigate.
- [ ] Return `crossingsData` and include counts in asset diagnostics.
- [ ] Extend optional manifest JSON asset discovery for mobile sync.
- [ ] Generate a native literal `require()` only when the promoted manifest
      references the artifact.
- [ ] Ensure missing optional crossing data does not break web or native boot.

**Tests**

- [ ] manifest present/absent/version hash behavior;
- [ ] Promote copies current artifact and removes stale old artifact;
- [ ] web loader includes only when requested;
- [ ] native offline sync present/absent behavior;
- [ ] no undefined Metro asset references.

**Acceptance**

- Manifest—not file existence—is the only runtime availability authority.

## Task 9 — implement the pure attested-route matcher

**Files**

- Create `packages/core/src/routing/crossingsOnRoute.js`.
- Export through the package map as needed.
- Create `tests/test-crossings-on-route.mjs`.

**Steps**

- [ ] Normalize/validate runtime artifact and route attestation.
- [ ] Return `null`/an explicit unavailable result for artifact graph or policy
      incompatibility; do not misreport it as zero matches.
- [ ] Build a route-slice index with cumulative attested distances.
- [ ] Match directed before/action/after signatures by share ID, direction and
      required fraction coverage.
- [ ] Permit route slices to start/end outside required candidate fractions
      while requiring the complete action interval.
- [ ] Interpolate entry/exit progress inside partial first/last action slices.
- [ ] Reconcile attested traversal distance to navigation geometry total using
      one documented deterministic scale.
- [ ] Verify computed entry/exit anchors are geographically near the reviewed
      anchors; treat large mismatch as incompatible data, not a match.
- [ ] Emit complete route-relative crossing records in route order.
- [ ] Represent start-inside/end-inside as incomplete diagnostics and omit them
      from cue-ready output.
- [ ] Emit every repeated complete traversal.
- [ ] Deduplicate exact repeats and reject overlapping conflicting records.

**Tests**

- [ ] exact one-edge action;
- [ ] multi-edge action;
- [ ] partial edge entry/exit;
- [ ] forward and reverse mappings;
- [ ] route uses same action edge with different approach/departure — no match;
- [ ] missing before/after context — incomplete/no cue;
- [ ] repeated visit;
- [ ] route starts/ends inside;
- [ ] graph/policy mismatch;
- [ ] geometry/attestation distance reconciliation;
- [ ] anchor mismatch;
- [ ] malformed artifact preserves navigation fallback.

**Acceptance**

- Matching outcome depends only on confirmed mapping plus attested route
  evidence, never on live geometric classification.

## Task 10 — prepare crossings for the effective main route

**Files**

- `packages/core/src/app/useCyclewaysApp.js`.
- `apps/mobile/src/screens/BuildScreen.jsx`.
- `packages/core/src/navigation/navigationRoute.js`.
- `packages/core/src/routing/routeAttestation.js`.
- Navigation-route/effective-route/ride-plan/session tests.

**Steps**

- [ ] Load crossing data for native navigation surfaces.
- [ ] Add an app callback that matches crossings from
      `(crossingsData, routingValidation, geometry)`.
- [ ] Prepare crossings only after direction/start/loop effective-route
      selection, alongside existing junction/roundabout preparation.
- [ ] Add `navigationRoute.crossings` with null-vs-empty semantics.
- [ ] Clone and validate crossing records when constructing/restoring a
      navigation route.
- [ ] Do not carry source-route crossing distances through reverse/clip/rotate;
      recompute against the transformed attestation instead.
- [ ] Include crossings and artifact compatibility/version in
      `navigationPlanFingerprint`.
- [ ] Update ride-plan confirmation and current-route dev scenario paths so
      they cannot bypass crossing preparation.
- [ ] Persist prepared crossings in active ride state with the effective route.
- [ ] Bump maneuver generator to `navigation-cues-v3` and update default/fallback
      version tests.

**Tests**

- [ ] forward, exact reverse, alternate linear start and rotated loop;
- [ ] missing artifact vs evaluated-empty distinction;
- [ ] navigation-plan fingerprint changes with mapping/artifact/crossing list;
- [ ] v2 active plan rebuild/rejection behavior;
- [ ] no stale crossing distances after effective-route change;
- [ ] current-route SIM preparation cannot skip crossings.

**Acceptance**

- The route entering navigation already contains crossing intervals matching
  its exact effective geometry and attestation.

## Task 11 — attest and annotate approach/rejoin connectors

**Files**

- `packages/core/route-manager.js`.
- `packages/core/src/routing/shardedRouteSession.js` if propagation is needed.
- `packages/core/src/app/useCyclewaysApp.js`.
- `packages/core/src/navigation/approachLeg.js`.
- Connector, approach and navigation-session tests/scenarios.

**Steps**

- [ ] Extend successful `previewBaseRoute` results with a route attestation
      built from the preview candidate; failure results remain explicit and
      carry no false attestation.
- [ ] Ensure preview attestation does not mutate the active planner route.
- [ ] Preserve connector cost profile and strict directional-policy evidence.
- [ ] In the app’s shared `computeConnector` wrapper, match confirmed crossings
      using preview attestation and geometry.
- [ ] Attach `crossings: null|[]|records` to the connector result.
- [ ] Have `buildApproachLeg` copy routing validation and crossings into its
      route model.
- [ ] Ensure both initial approach and off-route rejoin pass through that same
      builder.
- [ ] Do not put crossing records into `junctions`; keep existing turn-gating
      fallback semantics unchanged.
- [ ] Include connector crossing evidence in replay/scenario snapshots where
      deterministic responses are serialized.

**Tests**

- [ ] connector attestation validates against returned geometry;
- [ ] ordinary and connector cost profiles both remain directionally legal;
- [ ] approach matching and cue generation;
- [ ] rejoin matching and cue generation;
- [ ] connector without artifact/context keeps legacy cues;
- [ ] failed/no-coverage connector cannot fabricate crossing evidence;
- [ ] preview remains non-mutating.

**Acceptance**

- A rider navigated outside the CW network to the route start or back to the
  route receives the same confirmed crossing instruction as on the main route.

## Task 12 — add first-class crossing cue semantics

**Files**

- `packages/core/src/navigation/navigationCues.js`.
- `tests/test-navigation-cues.mjs` and focused crossing fixtures.

**Steps**

- [ ] Read complete crossing records separately from junctions/roundabouts.
- [ ] Suppress turn/bend corners inside `[entryMeters - pad,
      exitMeters + pad]`.
- [ ] Emit one cue at entry with completion at exit, logical ID, kind and
      optional crossed-road name.
- [ ] Emit a crossing even when confirmed traversal has no sharp corner pair.
- [ ] Never emit from incomplete records.
- [ ] Add crossing to maneuver selection priority.
- [ ] Make crossing compound-capable; calculate gap from completion.
- [ ] Support crossing → turn and crossing → roundabout.
- [ ] Keep the following cue in the list and preserve guarded voice
      suppression.
- [ ] Ensure enter-segment merge/suppression does not attach a fake turn
      direction to a crossing.
- [ ] Keep raw edge/mapping IDs out of rider presentation objects where they are
      not needed; logical ID may remain for diagnostics/dedupe.

**Tests**

- [ ] interval suppresses both reported corners and nothing outside it;
- [ ] confirmed smooth crossing still emits;
- [ ] incomplete and unavailable data emit nothing;
- [ ] crossing followed by roundabout at 60 m compounds; epsilon beyond does
      not;
- [ ] following cue remains independently selectable;
- [ ] overlapping roundabout/crossing evidence fails a validation test rather
      than silently deleting one cue;
- [ ] ordinary geometry is byte-for-byte compatible when crossings are null.

**Acceptance**

- Cue generation consumes reviewed semantic evidence and no longer tries to
  decide whether geometry is a road crossing.

## Task 13 — voice, card, icon, haptic and camera behavior

**Files**

- `packages/core/src/navigation/navigationVoice.js`.
- `packages/core/src/navigation/navigationPresentation.js`.
- `packages/core/src/navigation/cueHaptics.js`.
- Camera director/adapter tests as applicable.
- `apps/mobile/src/planner/ManeuverIcon.jsx`.
- Voice/presentation/haptic/camera tests.

**Steps**

- [ ] Add Hebrew and English crossing phrases.
- [ ] Add crossing as source in compound text generation.
- [ ] Support crossing → turn and crossing → roundabout text.
- [ ] Keep follow-up suppression contingent on the source compound utterance
      actually being accepted.
- [ ] Add primary/secondary crossing presentation descriptors.
- [ ] Keep crossed-road name as optional secondary context, not required voice
      content.
- [ ] Draw a dedicated crossing glyph with two road sides and transverse arrow.
- [ ] Keep SVG decorative and card text accessible.
- [ ] Lock light preview/medium final haptics with explicit crossing tests.
- [ ] Add crossing to near-maneuver camera eligibility and focus at entry.
- [ ] Reuse existing camera stages and C1 padding interpolation.

**Tests**

- [ ] Hebrew/English preview and final copy;
- [ ] compound roundabout/left/right copy;
- [ ] cue utterance ID and phase dedupe;
- [ ] unsaid compound does not silence next maneuver;
- [ ] presentation descriptor and fallback;
- [ ] haptic intensity/cooldown;
- [ ] camera pre-maneuver stage and no first-cue snap regression.

**Acceptance**

- The rider sees and hears a crossing action, never a left/right icon or phrase
  for the confirmed action interval.

## Task 14 — Road 99, corpus and scenario validation

**Files**

- Road 99 replay test/script.
- `packages/core/src/navigation/scenarios/` and route fixtures.
- Candidate/matcher audit tooling.

**Steps**

- [ ] Review the generated Road 99 candidate in the editor; repair mapping if
      required and accept only supported direction(s).
- [ ] Build the confirmed runtime artifact from that review.
- [ ] Recreate the strict route from recorded coordinates.
- [ ] Assert route distance and route-content fingerprint remain at baseline.
- [ ] Assert around 3,822–3,838 m:
  - [ ] exactly one confirmed crossing match;
  - [ ] no literal right/left cue pair;
  - [ ] one crossing cue with correct interval;
  - [ ] following straight-roundabout cue preserved;
  - [ ] compound phrase when completion-to-entry gap is about 56 m.
- [ ] Assert ordinary turns change from 19 to 17 and one crossing is added.
- [ ] Assert no crossing is reintroduced at the corrected Tel Hai site without
      a confirmed mapping.
- [ ] Assert field-navigation portion has no unexpected crossing matches.
- [ ] Add main, approach and rejoin scenarios using the same logical crossing.
- [ ] Add forward-only scenario proving reverse route does not match.
- [ ] Add repeated crossing and start-inside scenarios.
- [ ] Produce two audit reports:
  - [ ] offline candidates by status/evidence/warning/coverage;
  - [ ] confirmed runtime matches across current catalog/scenario routes.
- [ ] Require every high-confidence candidate within Road 99 and current
      catalog/scenario coverage to be accepted or rejected before first
      release.
- [ ] Add every discovered false candidate/match as a permanent fixture.

**Acceptance**

- The original remaining symptom is fixed without route, roundabout,
  directionality, camera or field-navigation regression.

## Task 15 — focused, full and operational validation

**Automated commands**

- [ ] Add `npm run test:crossings` covering Python and Node crossing suites.
- [ ] Run candidate/review/build/manifest/promote/mobile-asset tests.
- [ ] Run matcher/cue/voice/presentation/haptic/camera tests.
- [ ] Run connector, effective-route, navigation-session and scenario suites.
- [ ] Run existing roundabout and bicycle-traversal-policy suites.
- [ ] Run `node tests/test-mobile-undefined-references.mjs`.
- [ ] Run `npm run build` if Build/manifest code changed.
- [ ] Run full `npm test`.
- [ ] Run `git diff --check`.

**Editor manual gate**

- [ ] Start the editor and open Crossings.
- [ ] Confirm coverage/freshness and summary counts.
- [ ] Inspect all high-confidence/warning candidates in Road 99/catalog scope.
- [ ] Validate accepted action arrows against one-way base-edge arrows.
- [ ] Exercise accept, reject, direction selection, mapping repair and manual
      add/edit/delete.
- [ ] Verify stale accepted mappings are unmistakable and Build-blocking.
- [ ] Verify no browser console errors.

**Simulator/device gate — explicitly pending while remote**

- [ ] Replay the Road 99 approach to the crossing at normal and accelerated
      speed.
- [ ] Verify preview timing, card hierarchy, glyph and camera framing.
- [ ] Listen with screen active and lock-screen/background voice.
- [ ] Verify the roundabout still announces if crossing speech is skipped,
      interrupted or begins inside the final window.
- [ ] Exercise an approach/rejoin crossing scenario.
- [ ] Record device/simulator version, graph/artifact/navigation-plan
      fingerprints and result.

Manual editor and simulator/device gates may remain pending until local access
is available. Automated success must not be reported as manual acceptance.

## Task 16 — documentation and rollout record

**Files**

- Update this plan’s implementation status and checked tasks.
- Update `plans/road-crossing-maneuvers/design.md` only for approved design
  changes discovered during implementation.
- Update `plans/navigation-ride-feedback-3/discussion.md` with exact outcome.
- Update `processing/README.md` and editor help text.

**Steps**

- [ ] Record candidate counts and review coverage.
- [ ] Record accepted Road 99 logical/mapping IDs and why each direction was
      accepted or omitted.
- [ ] Record source graph/share/policy/artifact digests.
- [ ] Record route/cue before-and-after facts.
- [ ] Record automated commands and results.
- [ ] Keep manual gates visibly pending until performed.
- [ ] Document regeneration workflow:
  1. rebuild base graph/policy inputs;
  2. run `crossings:candidates`;
  3. review pending/stale items;
  4. Build and inspect validation;
  5. Promote;
  6. sync mobile offline assets;
  7. rerun route/scenario gates.

## First-release gate summary

The first runtime publication is allowed only when all are true:

- [ ] Road 99 crossing mapping is editor-confirmed.
- [ ] Every accepted mapping is current, valid and directionally allowed.
- [ ] No stale accepted or invalid manual record exists.
- [ ] All high-confidence candidates in Road 99/catalog/scenario coverage have
      decisions.
- [ ] Pending candidates outside that scope are counted and omitted.
- [ ] Main, approach and rejoin matcher tests pass.
- [ ] Route length/content fingerprint remain unchanged.
- [ ] Crossing cue replaces the pair and preserves the roundabout.
- [ ] Manifest/Promote/offline sync cannot resurrect stale data.
- [ ] Focused and full automated suites pass.
- [ ] Manual gates are completed or explicitly marked pending.

## Deferred follow-up — route cost and snapping

Do not add route cost in the tasks above. After confirmed crossing coverage and
runtime matching are stable, prepare a separate design amendment covering:

- a versioned `crossingAvoidanceClass` or equivalent policy;
- equivalent-distance cost and its rationale;
- consistent planner/approach/rejoin application;
- attestation binding to crossing artifact and cost-policy digests;
- route-delta, new no-path and two-crossing far-side-infrastructure reports;
- editor visualization of cost effect;
- click-snap behavior across parallel road sides;
- staged rollout and rollback.

Confirmation makes a crossing eligible for that future policy; it does not
enable the policy automatically.
