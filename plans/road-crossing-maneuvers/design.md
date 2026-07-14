# Reviewed road-crossing maneuvers

**Date:** 2026-07-14
**Revision:** 2026-07-14 — replaced runtime geometric classification with offline candidate generation and editor-reviewed mappings
**Status:** implemented in code; first reviewed-data rollout pending
**Origin:** M1/S2 in `plans/navigation-ride-feedback-3/discussion.md`

## Outcome

Navigation will tell the rider when the route requires moving to the other side
of a road:

> חצו בזהירות לצד השני של הכביש

The instruction will come from a confirmed, editor-reviewed crossing record,
not from a live guess based only on route geometry. A confirmed crossing may
map to one directed base-edge slice, several edge slices, or multiple valid
traversal variants while remaining one logical user-facing event.

For the corrected Road 99 replay, the right/left pair at about
3,822–3,838 m becomes one crossing cue. The following straight-roundabout cue
remains present and independently announceable. The route itself remains the
current directionally legal route of about 10,111.6 m.

## Major decisions

| Decision | Chosen direction | Consequence |
|---|---|---|
| Classification authority | Generate candidates offline and require editor confirmation before runtime use. | Production never asserts “cross the road” from an unreviewed geometry heuristic. |
| Coverage | Scan the complete base graph, not only CycleWays segments. | Crossings can be recognized on ordinary routing, approach-to-start and rejoin paths outside the CW network. |
| Product concept | Version 1 classifies a `side-change`: the route moves from one side of a road corridor to the other. | We do not announce every ordinary intersection crossing. |
| Data model | One logical crossing owns one or more explicit directed traversal mappings. | A crossing spanning several base edges is still one event; forward and reverse can be reviewed independently. |
| Matching | Match confirmed mappings against the route’s attested ordered base-edge slices. | Runtime matching is deterministic and does not depend on visual proximity alone. |
| Editor workflow | Show every candidate and mapping on a dedicated layer; allow accept, reject, direction selection, mapping repair and manual creation. | Curators can correct detector output rather than editing generated files. |
| Review rollout | Pending candidates are omitted but do not block unrelated publication; stale or invalid previously accepted mappings do block. | Review can proceed incrementally while no unconfirmed crossing reaches users. |
| Cue semantics | Bake a route-relative interval and replace corner cues inside it with one `crossing` cue. | The following real maneuver is preserved and may be compounded. |
| Route choice | No crossing penalty in this implementation. | Confirmed topology becomes reusable evidence, but route-cost policy remains a separate decision and rollout. |
| Persistence | Add crossings to the navigation-plan fingerprint and bump to `navigation-cues-v3`. | Stored v2 plans cannot silently resume with different instructions. |

This supersedes the earlier proposal to infer crossings while building cues.
The geometry detector still has an important role, but only as an offline
candidate producer and audit tool.

## Implementation record — 2026-07-14

The version-1 architecture is implemented across processing, the editor,
publication, shared routing, and the native navigation presentation. The
implementation includes graph-wide local candidate extraction, confirmed-only
review joining, multi-mapping records, manifest/offline publication, pure
attestation matching for main/approach/rejoin routes, cue replacement, Hebrew
and English voice, a dedicated card/icon, haptics, and camera participation.

The first production data release is deliberately not part of this code commit.
Two existing data gates must be resolved through their normal review workflows:

- the elevated graph currently has 48,856 edges while the released stable
  edge-share registry contains 48,381, so candidate generation refuses to
  proceed until the 475 new identities are reviewed and promoted; and
- the relevant Road 99 manual traversal evidence is still `manual-unreviewed`,
  so Build will reject an accepted crossing mapping that uses it until its
  direction policy is reviewed.

With a temporary complete identity registry, the graph-wide detector produced
1,656 logical review candidates and found the Road 99 location without a
coordinate special case (`crossing:1092567462:33.2351-35.5800:48308`). This is
diagnostic evidence only: it is not committed as an accepted crossing and
cannot reach runtime until the editor and Build gates pass.

The initial editor release supports independent mapping selection and validated
advanced JSON repair/manual records while displaying all mappings, action
arrows, corridor context, and base one-way arrows on the map. The guided
click-by-click trace authoring UX described below remains a curator-workflow
enhancement; it does not weaken publication validation or runtime safety.

## Problem definition

The reported false instructions were not arbitrary noisy turns. The route
actually moved laterally between two roughly parallel sides of a road. Route
geometry represented that movement as two sharp corners, so generic cue logic
said “turn right, then left.” The useful bicycle instruction is the semantic
action: cross to the other side.

That statement is safety-relevant. A false positive can tell a rider to enter
traffic when the route only bends or turns onto a road. Geometry by itself also
cannot reliably distinguish:

- an at-grade crossing from a bridge or tunnel;
- a side change from an ordinary chicane;
- crossing a road from joining or leaving that road;
- a complete crossing from a route that starts or ends partway through it;
- one logical event from a representation split over multiple base edges.

The data therefore needs an offline, inspectable classification step.

## Terminology and version-1 boundary

### Logical crossing

A **logical crossing** is a real-world place where a supported route traversal
requires the rider to move from one side of a motor-road corridor to the other.
It is a user-facing event, not an edge.

### Traversal mapping

A **traversal mapping** is one directed ordered base-edge signature that proves
the logical crossing was traversed in a particular way. It contains:

- approach context before the crossing;
- the edge slices that constitute the crossing action;
- departure context after the crossing;
- exact entry and exit anchors;
- direction and bicycle-policy evidence.

One logical crossing may have forward and reverse mappings, or multiple paths
through the same physical place.

### `side-change`, not every road intersection

Version 1 publishes only `kind: "side-change"`. The approach and departure
remain broadly along the same corridor while the route moves laterally across
it. This is the pattern that creates false opposite-turn pairs and justifies
“to the other side.”

A straight path crossing a perpendicular street may later support a separate
`through-crossing` warning policy. It is not silently included now; announcing
every ordinary intersection would be noisy and is not needed to solve the
reported ride.

## Architecture

```text
elevated base graph + stable edge-share registry + reviewed traversal policy
                                |
                                v
                 offline crossing candidate generator
                                |
                       generated candidates
                                |
                                v
                   editor review and mapping repair
                                |
                 source-controlled review decisions
                                |
                                v
                  build validation and publication
                                |
                  confirmed crossings.json artifact
                                |
                                v
         route attestation matcher (main / approach / rejoin)
                                |
                  route-relative crossing intervals
                                |
                                v
               crossing cue, voice, card and camera
```

Generated candidates, human decisions and the runtime artifact are separate.
No layer edits another layer’s source file.

## D1 — Offline candidate generation

### Inputs

The local-only command `npm run crossings:candidates` reads:

- `build/osm/osm-base-graph-elevated.json`, including source tags and manual
  edges;
- `data/base-edge-share-ids.json`, the stable edge identity used in shared
  routes and route attestations;
- the current reviewed bicycle traversal-policy inputs/digest; and
- optionally the CW-to-base overlay for diagnostics and prioritization, never
  as a coverage boundary.

It writes only `build/crossings/candidates.json`. It does not fetch OSM, change
the graph, edit the overlay or promote assets.

The candidate payload records source digests and explicit coverage:

```json
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "sourceGraphDigest": "sha256:...",
  "edgeShareRegistryDigest": "sha256:...",
  "traversalPolicyDigest": "sha256:...",
  "coverage": {
    "baseGraph": "complete",
    "stableEdgeShareIds": "complete",
    "gradeSeparationTags": "source-dependent",
    "cyclewaysOverlay": "diagnostic-only"
  },
  "crossings": []
}
```

Absence of grade-separation tags is not interpreted as proof that a crossing
is at grade. It produces a review warning.

### Candidate search

The generator creates motor-road corridor indexes from road-class edges and
examines short local paths that may connect opposite sides. Initial search
limits are deliberately wider than runtime acceptance because every candidate
requires review:

- action path normally 4–60 m;
- one to several contiguous base-edge slices;
- entry and exit projected near the same road corridor;
- signed side-of-corridor values change sign with useful lateral separation;
- approach and departure courses remain broadly aligned with the road corridor
  and with one another;
- route net heading remains compatible with a side change rather than a
  U-turn;
- the action path is traversable under the current directional bicycle policy.

Evidence raises confidence but never auto-publishes:

- OSM `footway=crossing`, `crossing=*`, cycleway/path classifications;
- a short connector between parallel carriageway or side-path structures;
- opposite geometry corners with low net heading change;
- current CW alignment using the same edge set;
- a motor-road class/name shared by the crossed corridor edges.

Candidate generation rejects or warns on:

- known `bridge`, `tunnel` or incompatible `layer` separation;
- no supported directed traversal through the action path;
- path loops or repeated edge slices;
- endpoints on the same corridor side;
- action geometry that primarily follows the motor road;
- duplicate candidates for the same place and mapping;
- an action interval overlapping a reviewed roundabout shape;
- missing stable share IDs.

The detector groups forward/reverse and alternate-path signatures into one
logical crossing when they share the crossed corridor and physical anchors.
Ambiguous grouping is a warning, not a proximity-only merge.

### Stable identity and staleness

Candidate IDs use the crossed-road source identity when available plus a
coarse, deterministic anchor cell. They should survive harmless mapping-order
changes. A deterministic suffix resolves same-cell collisions.

The candidate fingerprint covers:

- logical kind and crossed-road identity;
- normalized action/approach/departure geometry;
- every mapping’s stable edge-share IDs, directions and fractions;
- relevant source tags and grade-separation evidence;
- the traversal-policy digest.

A changed fingerprint makes the prior review stale. Stable IDs preserve the
review history without treating changed topology as still accepted.

## D2 — Logical crossing and mapping schema

A generated logical candidate has the following shape. The coordinates and
non-action share IDs below are illustrative; implementation derives the exact
Road 99 signature from the current replay and graph.

```json
{
  "id": "crossing:osm-way-1092567462:g712-664-18",
  "fingerprint": "sha256:...",
  "kind": "side-change",
  "crossedRoad": {
    "source": "osm",
    "sourceIds": [1092567462],
    "name": "כביש 90",
    "highway": "trunk"
  },
  "center": { "lat": 33.221, "lng": 35.579 },
  "bbox": [35.5787, 33.2208, 35.5794, 33.2213],
  "mappings": [
    {
      "id": "mapping:forward:sha256-...",
      "direction": "forward",
      "match": {
        "before": [
          { "edgeShareId": 48123, "fromFractionQ": 0, "toFractionQ": 1000000 }
        ],
        "action": [
          { "edgeShareId": 48308, "fromFractionQ": 1000000, "toFractionQ": 0 },
          { "edgeShareId": 48320, "fromFractionQ": 1000000, "toFractionQ": 850000 }
        ],
        "after": [
          { "edgeShareId": 48124, "fromFractionQ": 1000000, "toFractionQ": 0 }
        ]
      },
      "entry": { "lat": 33.2210, "lng": 35.5788 },
      "exit": { "lat": 33.2212, "lng": 35.5792 },
      "metrics": {
        "actionLengthMeters": 16.0,
        "netHeadingChangeDeg": 38.0,
        "lateralDisplacementMeters": 13.0
      },
      "policy": {
        "state": "allowed",
        "policyDigest": "sha256:..."
      }
    }
  ],
  "evidence": ["opposite-corners", "short-connector", "motor-road-corridor"],
  "warnings": []
}
```

Fractions use the existing route-attestation scale of 0–1,000,000. Direction
is encoded by `fromFractionQ` and `toFractionQ`; the string field is a readable
summary.

`before` and `after` are matching context, not part of the crossing interval.
They prevent the same short edge from being labeled a crossing when the route
uses it to join or leave the road in a different way. `action` defines the
user-facing entry and completion interval.

A mapping is explicit per direction. The reverse mapping is never assumed from
geometry: it is generated only if every reversed action/context traversal is
allowed, and the curator may enable or disable it independently.

## D3 — Review and manual curation

### Source-controlled decisions

Human decisions live in `data/crossing-review.json`:

```json
{
  "schemaVersion": 1,
  "reviews": {
    "crossing:osm-way-1092567462:g712-664-18": {
      "candidateFingerprint": "sha256:...",
      "status": "accepted",
      "acceptedMappingIds": ["mapping:forward:sha256-..."],
      "mappingOverrides": [],
      "note": "Crosses to the eastern side before the roundabout",
      "reviewedAt": "..."
    }
  },
  "manualCrossings": []
}
```

Allowed candidate states are `accepted` and `rejected`; absent decisions are
`pending`, and fingerprint mismatches are `stale`. An accepted review must
select at least one valid mapping. Mappings not selected are omitted, which
allows forward-only acceptance.

`mappingOverrides` stores curator-repaired mappings when the logical candidate
is correct but an action boundary or edge sequence is not. An override records
the generated mapping it replaces and a fingerprint of all referenced source
edges. It becomes stale if those edges or the traversal policy change.

`manualCrossings` supports places the detector missed. Each record has a stable
`manual-crossing-*` ID, the same logical/mapping schema, creation/update audit
fields and a source-edge fingerprint. Manual records are reviewed data, not
generated candidates, but build validates them just as strictly.

### Editor workspace

The editor gains a **Crossings** workspace modeled after Roundabouts and the
direction-review tools:

- all candidates and manual crossings visible at once;
- accepted green, rejected red, pending/stale amber, invalid magenta;
- a transverse arrow from entry to exit for every selected mapping;
- the crossed motor-road corridor highlighted distinctly;
- approach/action/departure edges drawn with separate styles;
- existing base-edge one-way arrows visible simultaneously;
- filters for All, Pending, Accepted, Rejected, Stale, Manual and Warnings;
- summary counts and source-freshness/coverage banners;
- detail fields for crossed road, evidence, warnings, metrics, source IDs,
  mapping directions, edge IDs/fractions and fingerprints;
- Accept, Reject, note, Previous and Next actions;
- per-mapping direction toggles;
- **Edit mapping** to replace action boundaries or edge sequences; and
- **Add crossing** to create a manual logical crossing with multiple mappings.

The mapping editor is an ordered trace workflow:

1. Select or confirm the crossed road corridor.
2. Select the approach edge and direction.
3. Select one or more action edge slices in order.
4. Select the departure edge and direction.
5. Set entry/exit fractions by snapping anchors to the selected edges.
6. Optionally add the reverse or another alternate mapping.
7. Validate and save atomically.

The editor must show a route-like arrow through the entire signature so the
curator can answer the product question: “If a rider traverses these edges in
this order, do they need to cross to the other side?”

It does not edit generated candidates, the base graph or OSM tags. It writes
only `data/crossing-review.json` atomically.

### Incremental review policy

Crossing inference is broader and less authoritative than OSM-tagged
roundabouts. Requiring every graph-wide candidate to be decided before any
build would prevent incremental rollout without improving safety.

Therefore:

- pending candidates are warnings and are omitted from runtime data;
- rejected candidates are omitted;
- stale rejected decisions return to pending but do not block publication;
- stale accepted decisions block publication until re-reviewed or explicitly
  rejected;
- invalid accepted mappings or invalid manual crossings block publication;
- orphaned reviews warn and remain visible.

The first feature rollout has its own release gate: every high-confidence
candidate within the Road 99 replay and the current catalog/scenario coverage
must be decided, even though unrelated low-confidence pending candidates do
not block the build mechanically.

## D4 — Build and runtime artifact

Build joins generated candidates with review decisions and publishes only
confirmed mappings to `build/public-data/crossings.json`:

```json
{
  "schemaVersion": 1,
  "graphVersion": "...",
  "sourceGraphDigest": "sha256:...",
  "edgeShareRegistryDigest": "sha256:...",
  "traversalPolicyDigest": "sha256:...",
  "reviewSummary": {
    "accepted": 3,
    "pending": 20,
    "rejected": 5,
    "manual": 1
  },
  "crossings": []
}
```

Runtime records retain logical identity, kind, crossed-road display metadata,
bounds and confirmed mappings. Candidate evidence, review notes, rejected and
pending records are excluded.

Build blocks on:

- source graph/share-registry/policy digest mismatch;
- duplicate logical or mapping IDs;
- missing referenced edge-share IDs;
- a forbidden or unknown directed traversal in an accepted mapping;
- non-contiguous or repeated action slices;
- invalid fractions or entry/exit anchors;
- empty action, before or after context;
- overlapping confirmed mappings that would emit duplicate cues;
- stale accepted reviews, invalid overrides or invalid manual records.

The artifact is optional during rollout. It is registered as `crossings` in
`map-manifest.json`; `hashes.crossings` participates in the manifest version.
Build/Promote removes stale previously published files when the current
manifest intentionally omits the artifact. Mobile offline sync adds a literal
Metro `require()` only when the promoted manifest includes it.

The website route builder need not display or narrate the data, but it loads
through the shared asset contract when a navigation-capable surface requests
it. The editor remains the web review surface.

## D5 — Deterministic runtime matching

A pure shared-core module `crossingsOnRoute.js` receives:

- the confirmed runtime crossing artifact;
- a valid route attestation with ordered `traversalSlices`; and
- the navigation route geometry for total-distance reconciliation.

It first verifies artifact compatibility with the route’s graph/policy
context. A mismatched artifact is unavailable, not an empty confirmed set.

For each confirmed mapping, it scans the ordered route slices for:

1. the directed `before` signature;
2. all directed `action` slices with the required fraction coverage; and
3. the directed `after` signature.

It calculates route-progress entry and exit from cumulative attested traversal
distance, interpolating within partial first/last action slices, then reconciles
that distance frame to navigation geometry. Geometry is used for progress and
sanity checking, not classification.

Every complete match produces:

```json
{
  "kind": "crossing",
  "crossingId": "crossing:osm-way-1092567462:g712-664-18",
  "mappingId": "mapping:forward:sha256-...",
  "crossingKind": "side-change",
  "crossedRoadName": "כביש 90",
  "entryMeters": 3821.8,
  "exitMeters": 3837.8,
  "complete": true
}
```

A route that starts inside the action or ends before departure produces an
incomplete diagnostic interval but no crossing cue. Repeated visits produce
separate records. Overlapping matches for the same logical crossing are
deduplicated deterministically; overlaps between different confirmed records
are a build/test error, not a runtime choice.

Runtime never searches nearby road geometry or promotes an unconfirmed
candidate.

## D6 — Route model and every routed surface

Crossing records use a new `navigationRoute.crossings` field rather than being
inserted into `junctions`:

- `null` means crossing data was unavailable or incompatible;
- `[]` means compatible data was evaluated and no confirmed crossing matched;
- a list contains baked route-relative records.

This preserves the existing `junctions: null` fallback semantics used by turn
classification. Crossings participate in the navigation-plan fingerprint and
active-session persistence.

Matching happens after effective-route selection, so forward, reverse,
alternate-start and loop-rotation routes are matched against their own
transformed attestation and geometry. No stale source-route crossing distances
are remapped by hand.

The same matcher is used for all routes:

- **Main route:** prepare crossings alongside the existing junction and
  roundabout evidence before navigation starts.
- **Approach to starting point:** `previewBaseRoute` returns a route
  attestation; the app attaches matching crossings to the connector result;
  `buildApproachLeg` carries them into cue generation.
- **Rejoin:** uses the same connector and approach-leg machinery, so it receives
  identical matching behavior.
- **Ordinary route building:** route choice is unchanged; the reviewed data is
  available for preview/diagnostics but produces no web instruction unless a
  navigation surface asks for cues.

Connector attestation is required for this feature and also closes an existing
evidence gap: a geometry-only connector cannot safely prove which directed
base edges it used.

## D7 — Cue generation and rider experience

For each complete confirmed crossing interval, `navigationCues.js`:

1. suppresses turn/bend corners whose route distance lies inside the interval
   plus a small exported pad;
2. emits one cue at `entryMeters`;
3. keeps `completionDistanceMeters: exitMeters`;
4. preserves subsequent real maneuvers; and
5. links a following turn or roundabout when completion-to-next-entry is within
   the existing 60 m compound window.

The cue contract is:

```js
{
  type: "crossing",
  crossingKind: "side-change",
  distanceMeters: 3821.8,
  completionDistanceMeters: 3837.8,
  crossedRoadName: "כביש 90",
  crossingId: "crossing:...",
  thenManeuver: { type: "roundabout", direction: "straight" }
}
```

The card/voice do not expose base-edge or mapping IDs. Those remain in
diagnostics.

### Voice

Hebrew:

- preview: `בעוד 120 מטרים, חצו בזהירות לצד השני של הכביש`
- final: `חצו בזהירות לצד השני של הכביש`
- crossing then roundabout: `חצו בזהירות לצד השני של הכביש, ואז בכיכר המשיכו ישר`
- crossing then turn: `חצו בזהירות לצד השני של הכביש, ואז פנו ימינה`

The road name may appear as secondary card context but is not inserted into
voice in version 1; awkward or missing road names must not affect the safety
instruction.

English fallback: `Cross carefully to the other side of the road`.

The usual 120 m preview and 35 m final windows apply. A following compound cue
is suppressed only after the source utterance was actually accepted, preserving
the existing safety rule.

### Card, icon, haptics and camera

- Primary card text: `חצו לצד השני של הכביש`.
- A dedicated glyph shows two road edges and a transverse arrow; it does not
  reuse a turn arrow.
- Haptics use the normal maneuver pattern: light preview, medium final.
- Crossing participates in the existing pre-maneuver camera stage, focused at
  entry, with no additional camera owner or stage.
- The C1 500 ms padding interpolation remains the only padding transition.

## D8 — Missing, stale and conflicting data

Failure behavior is deliberately fail-open to existing navigation:

- no artifact or manifest entry: no crossing records; existing turn cues stay;
- graph/policy mismatch: report unavailable and retain existing cues;
- pending/rejected candidate: not published and not matched;
- incomplete route traversal: no crossing cue;
- confirmed crossing with no geometric corner pair: still emit the crossing
  because reviewed traversal evidence is authoritative;
- confirmed interval with corners: suppress only corners inside that interval;
- crossing near a following roundabout: preserve both and compound if eligible;
- duplicate/conflicting confirmed mappings: block build rather than choose at
  runtime.

Runtime diagnostics should expose artifact compatibility, matched crossing IDs
and reasons for incomplete matches without collecting rider location history.

## D9 — Route cost remains a separate rollout

Confirmed crossing topology is suitable future evidence for route preferences,
but publication does not automatically make it a cost.

A later design may add an explicit routing policy such as
`crossingAvoidanceClass` and a documented equivalent-distance cost. That work
must:

- apply consistently to route building, approach and rejoin;
- report route deltas and new no-path cases;
- handle two-crossing trips to valuable far-side infrastructure;
- decide whether direction-specific crossings have different costs;
- bind the cost policy and crossing artifact digest into route attestation;
- validate click-snap behavior across parallel carriageways.

Until that separate gate is approved, this feature changes narration only.

## Expected Road 99 effect

The integration gate uses the corrected strict coordinate replay, not the old
pre-directionality route.

| Site | Current state | Expected result |
|---|---|---|
| Original ~482 m crossing | Corrected route no longer reproduces the old path in the same form. | Retained as an offline detector and matcher fixture; no cue is invented on the current route. |
| Original ~2,226 m Tel Hai cue | M4 removed the corrupted false pair. | No regression; only a separately confirmed mapping can add a crossing. |
| Current ~3,822–3,838 m crossing | Right about 112°, left about 74°, then straight roundabout. | Confirm candidate in editor; runtime matches it; one crossing cue replaces the pair; straight-roundabout remains and compounds at about a 56 m gap. |
| Route choice and length | Strict directed route, about 10,111.6 m. | Unchanged. |

Expected cue delta at the remaining site: ordinary turn cues decrease from 19
to 17 and one crossing cue is added. Roundabout count and route-content
fingerprint remain unchanged. The navigation-plan fingerprint changes because
the confirmed crossing evidence and maneuver version change.

## Non-goals

- Live or cue-time road-crossing classification.
- Automatic acceptance based on confidence.
- Announcing every perpendicular intersection crossing.
- Claiming a zebra crossing, signal, right of way or legal safety not present in
  reviewed data.
- Editing OSM or the base graph from the crossing workspace.
- Changing bicycle directionality or access policy.
- Crossing penalties or turn-pair search costs.
- S4 motor-road entry warnings.

## Acceptance gates

Implementation is complete only when:

1. Candidate generation is deterministic, local-only and graph-wide.
2. The editor can review all candidates, inspect direction arrows and
   multi-edge mappings, repair mappings and create manual crossings.
3. Only accepted mappings appear in the versioned runtime artifact.
4. Pending candidates are visibly reported but never published; stale accepted
   mappings block promotion.
5. Runtime matches ordered directed edge slices, including partial and
   multi-edge action intervals, without geometry classification.
6. Main, approach and rejoin paths all carry valid route attestation and use
   the same matcher.
7. The confirmed Road 99 crossing produces one crossing cue and preserves its
   following roundabout on the unchanged 10,111.6 m route.
8. Reverse-only/forward-only mapping behavior is covered and never inferred
   against bicycle policy.
9. Voice, card, icon, haptic, camera, persistence and v3 fingerprint contracts
   cover crossing cues.
10. Candidate, review, build, manifest, promote, offline-asset, matcher,
    navigation and scenario suites pass.
11. Manual editor review and later simulator/audio acceptance are recorded;
    while the user is remote, these remain explicit pending gates rather than
    being silently claimed complete.
