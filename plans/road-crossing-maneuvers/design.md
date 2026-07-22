# Reviewed road-crossing maneuvers

**Date:** 2026-07-14
**Revision:** 2026-07-22 — replaced junction-first authoring with coordinate-authored, CW-first crossings
**Status:** runtime core implemented; coordinate-guideline authoring is the current editor model
**Origin:** M1/S2 in `plans/navigation-ride-feedback-3/discussion.md`

## Outcome

Navigation will tell the rider when the route requires moving to the other side
of a road:

> חצו בזהירות לצד השני של הכביש

The instruction will come from a confirmed, editor-reviewed crossing record,
not from a live guess based only on route geometry. A confirmed crossing may
map to one directed base-edge slice, several edge slices, or multiple valid
traversal variants while remaining one logical user-facing event.

For the Road 99 replay, a reviewed side-change replaces the corresponding
opposite-turn geometry while preserving the following real maneuver. Crossing
guidance changes narration, not route choice or route length. The exact replay
distance is deliberately recorded by the scenario test because subsequent CW
network curation has superseded the historical 10,111.6 m baseline.

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
| Intersection experiment | A reviewed `junction-transition` may have no physical action edge and may request `cross-and-turn` guidance. | The default-on user preference replaces the ordinary turn with “cross, then turn”; disabling it restores the ordinary turn. |
| Preference boundary | Only records marked `guidancePolicy: "user-option"` obey the experiment switch. | Disabling the experiment never resurrects the false Road 99 turn pair or suppresses other reviewed crossing safety cues. |
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

The first production data release was deliberately not part of this code
commit. At that time two data gates remained:

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
could not reach runtime until the editor and Build gates passed. The stable
share/direction gates were resolved before the 2026-07-22 re-review; current
rollout status is recorded in the curation amendment below.

The initial editor release supports independent mapping selection and validated
advanced JSON repair/manual records while displaying all mappings, action
arrows, corridor context, and base one-way arrows on the map. The guided
click-by-click trace authoring UX described below remains a curator-workflow
enhancement; it does not weaken publication validation or runtime safety.

## Experimental intersection implementation record — 2026-07-15

The optional intersection amendment is implemented across review validation,
publication, editor visualization, attested route matching, cue generation,
voice/presentation, native ride settings, durable preference storage and
foreground/background/crash-resume navigation. The reviewed Margaliot record
contains only the directed dirt-road-to-north-sideline transition; the right
turn onto 9977 and the reverse movement remain ordinary, unclassified turns.

The real-data regression confirms both preference states on the current graph:
enabled produces one crossing with a reviewed left continuation and the
destination segment name, while disabled restores the ordinary named left
turn. It also confirms that the right branch does not match the crossing.

At the time, the record could not reach a bundled mobile artifact because of
the stable-share/candidate gates above. Those gates are now resolved: a clean
2026-07-22 Build publishes the manual record. The remaining gate is scalable
curation and explicit first-slice review, not runtime or publication code.

## Coordinate-authored crossing amendment — 2026-07-22

### Decision

The curator authors a crossing with the same mental model as a CW segment: a
short coordinate guideline expresses real-world intent and the editor maps it
onto the current directed base network. The guideline is the editable source;
stable fractional base-edge slices are the derived routing authority.

A crossing is therefore one directed base-edge slice or a short contiguous
sequence of slices that physically carries the rider across a road. A junction
or roundabout may contain that path, but does not own it. Junction, roundabout,
CW-segment and route relationships are derived from edge overlap.

The ordinary curator model is deliberately narrow:

1. Crossings mode always shows the base network, with the CW network as
   context.
2. The curator draws two or more guideline coordinates.
3. The existing network matcher proposes the directed base-edge path.
4. The first and last guideline coordinates are projected onto the matched
   edges and stored as millionth-resolution fractional boundaries.
5. The editor previews the mapped trace and its legal direction(s).
6. Explicit confirmation writes the crossing; Build remains publication
   authority.

The editor never physically splits a base edge merely to time crossing
guidance. It edits topology only when routing connectivity itself is wrong.

### New authored representation

New guideline-authored records use `representation: "edge-path"`. Each mapping
contains a non-empty ordered `action` slice sequence and empty `before` and
`after` arrays. Entry, exit and display geometry are derived from that same
path. Navigation matches the action path directly and derives neighboring
maneuvers from the actual route.

```json
{
  "id": "manual-crossing-*",
  "kind": "side-change",
  "representation": "edge-path",
  "guideline": {
    "type": "LineString",
    "coordinates": [[35.0, 33.0], [35.0002, 33.0001]]
  },
  "mappings": [{
    "id": "mapping-*",
    "direction": "forward",
    "match": {
      "before": [],
      "action": [{
        "edgeShareId": 123,
        "fromFractionQ": 380000,
        "toFractionQ": 610000
      }],
      "after": []
    }
  }]
}
```

If every action edge legally supports the opposite traversal, the editor may
offer a reverse mapping from the same guideline. It never invents a reverse
path across prohibited or unknown direction policy.

### Scope and prioritization

The primary list contains curated crossings only, with crossings affecting
accepted CW alignments ordered first. Other curated crossings remain visible
because approach, rejoin and ordinary base-network routes use the same
matcher. Graph-wide detected candidates remain build diagnostics rather than
items in the ordinary authoring workspace.

Each curated crossing is its own editor item, even when legacy topology data
associates it with a junction containing other candidates or movements. The
primary detail never displays generated pending proposals, evidence tags, raw
fractional mappings, mapping overrides or Accept/Reject controls. Those belong
to offline diagnostics. Junction relationships may remain stored for backward
compatibility and may drive the optional map context layer, but do not group or
own crossings in the editor.

The Crossings map shows both the CW network and base-edge network by default.
Each has a direct toggle so the curator can hide the CW overlay when it covers
the exact base path, or hide base edges when reviewing the public network
context. Junction context and one-way direction arrows are separate toggles
and default off, keeping the ordinary crossing view visually quiet. Aggregate
detector counts and detector-state filters are not part of this focused
curation surface.

The selected crossing uses a warm high-contrast treatment independent of the
blue/green network layers. A one-direction crossing is one orange lane. A
bidirectional crossing is separated into parallel orange and yellow lanes with
dark casing and large direction-oriented arrows. The list and detail card also
say one-way or bidirectional explicitly; color reinforces direction but is not
the only cue.

All curated crossings remain visible in the Crossings workspace. Unselected
crossings use thin muted stone paths and small arrows; only the selected
crossing receives the dark-cased orange/yellow lanes and prominent arrows.
Generated detector candidates are excluded from both tiers.

Existing `action-path` and `junction-transition` records remain valid for
backward compatibility. The editor does not require their expert
`before/action/after` mapping UI for new work.

## Curation rollout amendment — 2026-07-22

### Re-review outcome

The existing authority split remains correct:

- network junctions own legal connectivity between ports;
- roundabout reviews own roundabout classification and roundabout maneuver
  semantics; and
- crossing records own the safety statement that the rider must move to the
  other side of a motor-road corridor.

Crossings therefore remain a separate reviewed artifact. They gain explicit
junction/roundabout context and share the map-first editor shell, but they do
not become a boolean property of every junction or roundabout. A junction can
contain both ordinary movements and one movement that requires a crossing,
while a mid-block side change can require guidance with no junction nearby.

The fresh 2026-07-22 graph-wide run proves that raw candidate count cannot be
the curator experience:

| Current diagnostic cut | Count |
| --- | ---: |
| Logical action-path candidates | 1,611 |
| Directed mappings | 10,113 |
| Explicit OSM crossing evidence | 107 |
| Major-road corridor | 265 |
| Touches an accepted CW alignment | 156 |
| Within the diagnostic buffer of a relevant junction or roundabout | 171 |
| Two or more of the signals above | approximately 164 |

These are reproducible audit measurements, not acceptance thresholds. The
junction/roundabout association currently uses a coarse spatial buffer and
must become deterministic and topology-aware before it is authoritative
editor metadata.

The current reference replay is approximately 10,082.9 m. Its first curated
data slice includes both the Tel Hai side-change and the later reported
Road 99-area side-change; the older distance and cue-count table below is kept
as an implementation record rather than a current acceptance baseline.

### Curate review sites; publish exact mappings

The editor's primary unit becomes a generated **crossing review site**. A site
collects topologically related proposals so the curator can answer one
real-world question on one map view. It is not runtime authority and is never
matched by proximity during navigation.

A site is associated in this order:

1. an exact reviewed junction movement or junction boundary;
2. an exact roundabout plus an entry/exit-side relationship;
3. overlapping action signatures against one motor-road corridor; or
4. a deterministic standalone corridor/anchor grouping.

Proximity alone may group records for display but may not merge mappings or
accept a logical crossing. Publication still requires the existing explicit
directed `before/action/after` signature. Candidate and manual records gain
optional editor/build context:

```json
{
  "reviewSiteId": "junction:junction-osm-...:movement-group-...",
  "context": {
    "junctionId": "junction-osm-...",
    "movementId": "entry-port->exit-port",
    "roundaboutId": null,
    "roundaboutPhase": null
  }
}
```

`context` strengthens visualization, route-impact reporting and staleness
checks. The directed edge signature remains runtime authority. A crossing
linked to a junction movement becomes stale when that movement's topology
fingerprint changes. A roundabout-adjacent crossing may be `before-entry` or
`after-exit`; its action interval must not overlap the reviewed roundabout.

### Junction-first coverage, not junction-only discovery

The default review queue is ordered by product impact:

1. sites matched by a reference, featured or catalog route;
2. sites used by accepted CW alignments or published junction movements;
3. junction- and roundabout-associated sites;
4. explicit OSM crossing tags and major-road sites;
5. remaining base-network candidates relevant to ordinary, approach or rejoin
   routing; and
6. the full graph-wide audit layer.

Pending low-priority sites remain visible and non-blocking. The editor never
claims that an undecided location is safe or needs no guidance. This enables a
useful release after the routed/CW queues are reviewed without forcing 1,611
decisions or hiding possible crossings outside the CW network.

The current action-path detector remains graph-wide. A second proposal source
derives **junction-transition candidates** from relevant network-junction
movements. It uses exact entry/exit ports, motor-road corridor and movement
realization to propose cases where a cyclist changes sides even when a
centerline graph has no lateral action edge. Proposals are never automatically
accepted.

Roundabout context contributes prioritization and safe compounding, not blanket
classification. Most roundabout traversals are already described correctly by
the roundabout cue. A crossing record is added only when a particular approach,
departure or adjacent path genuinely moves the rider to the other road side.

### Map-first curator workflow

The Crossings lens becomes a specialized Base Network/Junctions overlay rather
than a 1,611-row mapping-ID queue. The default map shows review sites, with raw
candidate mappings appearing after a site is selected.

For the selected site the editor draws simultaneously:

- the crossed motor-road corridor and direction arrows;
- junction boundary, ports and selected legal movement when applicable;
- roundabout ring and entry/exit relationship when applicable;
- CW arms and accepted alignment paths;
- proposed `before`, `action` and `after` traces with large arrows; and
- reference/catalog routes that actually traverse the proposal.

The primary curator question is:

> Does this supported rider movement require moving to the other side of the
> motor road?

The primary outcomes are:

1. **No crossing guidance** — reject the selected proposal/movements;
2. **Cross the road** — accept an unconditional action-path crossing;
3. **Cross, then turn** — accept a directed continuation, optionally governed
   by the intersection experiment; or
4. **Repair movement** — use guided edge-trace authoring when the proposal is
   conceptually right but its signature is wrong.

The curator selects visible movement arrows, not opaque mapping hashes.
Mappings describing the same directed movement are variants under one choice.
Direction remains explicit: confirming one movement never infers its reverse.

Creation begins from the relevant object:

- **Junctions:** select a legal entry-to-exit movement and choose **Add crossing
  guidance**; the editor proposes a `junction-transition` from its attested
  before/after slices.
- **Roundabouts:** select the adjacent approach/departure and create a crossing
  outside the ring; the editor preserves the roundabout cue.
- **Base Network:** select approach, action and departure for a standalone or
  detector-missed action-path crossing.

Review writes are lightweight and immediate. They do not rebuild the graph.
The panel previews the resulting instruction and affected routes; Build remains
the authoritative publication and validation step.

The first delivered slice groups exact junction-associated candidates into one
review site per physical junction (standalone crossings remain separate) and
adds **Add crossing guidance** to published non-roundabout
junction movements. It creates an unsaved, map-visible proposal and requires
explicit confirmation in Crossings. Confirmed records retain junction and
movement fingerprints, which Build validates. Automatic side-change proposals,
route-impact overlays and roundabout approach/departure creation remain later
parts of this design.

Selecting a junction review site fits the complete junction boundary, retains
the other site markers for orientation, and displays only the currently
selected crossing proposal and its exact legal movements. The normal review
loop is therefore junction-by-junction and proposal-by-proposal rather than a
raw candidate queue drawn across the map.

### Instruction detail at an accepted crossing

The crossing remains one semantic maneuver even when its physical trace has a
sharp entry turn and a smaller departure turn. A mapping may carry an optional
reviewed entry maneuver in addition to its existing continuation:

```json
{
  "entryManeuver": { "type": "turn", "direction": "left" },
  "continuation": { "type": "turn", "direction": "right" }
}
```

When entry direction is absent, voice retains the generic
`חצו בזהירות לצד השני של הכביש`. When confirmed, the reference wording is:

> פנו שמאלה כדי לחצות בזהירות לצד השני של הכביש, ואז פנו ימינה אל שביל תל חי

`slight right/left` is not a new schema direction in this rollout; ordinary
`right/left` remains sufficient. Geometry may suggest entry direction, but the
published value is bound to reviewed mapping evidence.

### Coverage and release gates

Review completeness is reported by scope, not as one misleading percentage:

- reference/featured routes;
- accepted CW network;
- published junction movements;
- OSM-tagged candidates;
- major roads; and
- all base-network candidates.

The first release requires:

1. both crossing sites in the reported ride reviewed and matched;
2. every site traversed by the selected reference/featured-route corpus
   decided;
3. no stale or invalid accepted mapping;
4. route geometry and traversal fingerprints unchanged;
5. expected crossing/roundabout compound instructions verified; and
6. manual editor plus device/audio validation recorded.

Unrelated pending base-network sites remain non-blocking and unpublished. A
future audit can expand coverage without changing the runtime contract or
silently enabling geometry heuristics.

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

### Experimental intersection side changes

Some real side changes have no separate crossing edge. At the junction of
`שביל אדום הרי נפתלי`, `כביש 9977 מרגליות` and
`דרך נוף מצפה עדי - מטולה דרום`, the base graph has one centerline node:

- arriving from the dirt road and turning right onto 9977 is an ordinary turn;
- arriving from the dirt road and continuing north requires crossing the road
  and then turning left onto the sideline; and
- the crossing itself has no lateral base edge because the road is represented
  by a centerline.

This case stays one logical `side-change`, but uses
`representation: "junction-transition"`. Its directed mapping contains
non-empty `before` and `after` context, an empty `action` array, a single
entry/exit anchor at their common node and a reviewed continuation maneuver.
It is manually curated in the experiment; the ordinary short-action detector
does not auto-classify centerline junctions.

The rider setting is **intersection crossing guidance**, enabled by default
while the app is pre-production. It controls only crossings explicitly marked
`guidancePolicy: "user-option"`:

- enabled: “חצו בזהירות לצד השני של הכביש, ואז פנו שמאלה אל …”;
- disabled: the same route produces its normal “פנה שמאלה אל …” cue; and
- `guidancePolicy: "always"` (including the Road 99 corner-pair replacement)
  remains active regardless of the setting.

This is a narration preference, not a route-search preference. It does not
change route geometry, bicycle legality, crossing cost or the selected path.

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

The schema is backward compatible. Existing records default to
`representation: "action-path"` and `guidancePolicy: "always"`. An experimental
intersection record uses:

```json
{
  "kind": "side-change",
  "representation": "junction-transition",
  "guidancePolicy": "user-option",
  "mappings": [{
    "match": {
      "before": [{ "edgeShareId": 17233, "fromFractionQ": 1000000, "toFractionQ": 0 }],
      "action": [],
      "after": [{ "edgeShareId": 42656, "fromFractionQ": 1000000, "toFractionQ": 0 }]
    },
    "entry": { "lat": 33.2205053, "lng": 35.548282 },
    "exit": { "lat": 33.2205053, "lng": 35.548282 },
    "continuation": { "type": "turn", "direction": "left" }
  }]
}
```

Validation rules are representation-specific:

- `action-path` retains the v1 requirement for non-empty `before`, `action`
  and `after` sections;
- `junction-transition` requires non-empty `before` and `after`, requires an
  empty `action`, requires coincident reviewed anchors and requires a left or
  right `continuation` turn;
- every listed slice remains explicit, directed, contiguous, stable-share
  identified and allowed by the bicycle policy; and
- forward and reverse movements are never inferred from one another.

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

Coordinate-authored manual crossings do not depend on the generated candidate
queue. If `build/crossings/candidates.json` is absent, Build still validates
and publishes every current manual crossing against the staged base graph and
direction policy. Missing detector output remains an advisory coverage warning;
it cannot silently remove curated crossings from web or mobile artifacts.

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

For `junction-transition`, step 2 is intentionally empty. The matcher requires
the reviewed `before` immediately followed by the reviewed `after`, and places
the zero-length crossing interval at their attested boundary. Anchor sanity
checking still applies at that boundary. The route matcher does not infer a
crossing from an arbitrary left turn.

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

Cue generation receives the immutable ride preference used by main-route,
approach and rejoin sessions. For a matched `junction-transition`:

- when enabled, the crossing interval suppresses the colocated geometry turn,
  emits one crossing cue and carries the reviewed continuation direction and
  destination segment name into voice and card copy;
- when disabled, the optional crossing is removed before suppression, so the
  normal turn and segment-name merge run unchanged; and
- a crossing with `guidancePolicy: "always"` is never filtered.

The setting is stored as an app preference and copied into active-navigation
state so foreground, lock-screen/background processing and crash resume build
the same cue list.

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
- when that compound maneuver enters a named way, keep the name in the same
  utterance, for example `חצו בזהירות לצד השני של הכביש, ואז בכיכר פנו שמאלה
  אל כביש תשעים`; the suppressed follow-up cue must not be the only owner of
  the destination name;
- crossing then turn: `חצו בזהירות לצד השני של הכביש, ואז פנו ימינה`
- crossing then crossing: `חצו בזהירות לצד השני של הכביש, ואז חצו בזהירות גם את הכביש הבא`
- turn or roundabout then crossing: append `ואז חצו בזהירות גם את הכביש הבא`
- reviewed crossings fully contained by one roundabout traversal form a single
  junction movement: `בכיכר, חצו בזהירות את הכביש, ולאחר מכן פנו שמאלה אל
  שביל אופניים יובלים`;
- a crossing that exits directly onto a named CW segment identifies the entry:
  `חצו בזהירות לצד השני של הכביש, והיכנסו אל שביל תל חי`.

The road name may appear as secondary card context but is not inserted into
voice in version 1; awkward or missing road names must not affect the safety
instruction.

English fallback: `Cross carefully to the other side of the road`.

The usual 120 m preview and 35 m final windows apply. Every maneuver type that
can cover a following crossing must include that crossing in its spoken text.
A following compound cue is suppressed only after the source utterance was
actually accepted, preserving the existing safety rule and preventing an
unspoken crossing from being hidden.

Roundabout-crossing composition is based on route intervals, not general
proximity: every absorbed crossing interval must be wholly contained between
the roundabout entry and exit. The individual crossing cues remain in the cue
list and are marked as covered by the roundabout announcement. If that
announcement is missed, the crossing cues remain speakable. The named
destination is the CW segment that begins inside the junction and continues
beyond the roundabout exit.

### Card, icon, haptics and camera

- Primary card text: `חצו לצד השני של הכביש`.
- Native cards mirror compound voice semantics. A roundabout that owns a
  reviewed crossing presents crossing as the primary action and its named exit
  as the secondary action; crossing → crossing and crossing → named CW entry
  likewise remain visible rather than existing only in speech.
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
| Route choice and length | Historical strict directed replay, about 10,111.6 m. | Unchanged by crossing narration. |

Expected cue delta at the remaining site: ordinary turn cues decrease from 19
to 17 and one crossing cue is added. Roundabout count and route-content
fingerprint remain unchanged. The navigation-plan fingerprint changes because
the confirmed crossing evidence and maneuver version change.

## Non-goals

- Live or cue-time road-crossing classification.
- Automatic acceptance based on confidence.
- Announcing every perpendicular intersection crossing or auto-accepting
  centerline junction transitions.
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
7. Each confirmed reference-ride crossing produces one crossing cue, preserves
   its following real maneuver, and leaves the current route geometry and
   distance unchanged.
8. Reverse-only/forward-only mapping behavior is covered and never inferred
   against bicycle policy.
9. Voice, card, icon, haptic, camera, persistence and v3 fingerprint contracts
   cover crossing cues.
10. Candidate, review, build, manifest, promote, offline-asset, matcher,
    navigation and scenario suites pass.
11. Manual editor review and later simulator/audio acceptance are recorded;
    while the user is remote, these remain explicit pending gates rather than
    being silently claimed complete.
