# CycleWays Network Junctions — Design

Date: 2026-07-21

Status: Proposed for implementation

## Summary

Introduce a first-class **network junction**: a bounded, unnamed part of the
CycleWays network that connects named CW segments through directed base-edge
ports and legal movement paths.

A junction is not new physical geometry and is not a shortcut in the routing
graph. Its paths are always realized by ordinary directed OSM or manual base
edges. It adds the missing logical role between named corridors:

1. **Base edges** represent physical geometry, access, and directionality.
2. **CW segments** represent named rider-recognizable corridors.
3. **Network junctions** represent unnamed infrastructure used to move safely
   between corridors.

This model covers ordinary OSM roundabouts with paired one-way approach lanes,
curated bicycle-specific paths through car-oriented intersections, existing
short CW segments whose only purpose is to connect other segments, and a
roundabout lying in the middle of a single CW segment.

The editor's **Roundabouts** workspace becomes **Junctions**. Existing reviewed
roundabout classifications and roundabout navigation cues are preserved. Only
junctions that touch the CW network, affect a routeable alignment, contain a
curated bicycle path, or have an ambiguity require movement-level attention.

## Decision

The CycleWays model gains a separate `networkJunction` entity with:

- a bounded internal base-edge subgraph;
- directional entry and exit ports;
- associations from CW segment directions to those ports;
- calculated legal movements between ports;
- optional reviewed path selections or unavailable movements; and
- source and review fingerprints that become stale when relevant topology,
  policy, or segment attachments change.

The ordinary base graph remains the legality authority. A junction movement
can select among allowed paths but cannot make a prohibited, conditional, or
unknown traversal silently allowed.

For a curated CW-to-CW movement, its selected realization is authoritative for
that transition. Other physically legal base-network paths remain available to
unrelated off-network routing unless their own traversal evidence prohibits
them. This lets a curated sidewalk path replace a car roundabout for CycleWays
users without falsely declaring the car roundabout illegal everywhere.

## Relationship to existing plans

This design extends rather than replaces:

- `bicycle-traversal-policy/`: base-edge direction and access remain strict;
- `network-editor-workflow/`: junctions use the same CW/Base focus, background
  reconciliation, issue list, and explicit Build/Promote model;
- `roundabout-cues/`: accepted OSM roundabout classification and direction-only
  navigation cues remain valid and become one input to junction discovery;
- `road-crossing-maneuvers/`: crossings remain safety and narration records,
  not routing connectivity; and
- `navigation-way-names/`: junctions are intentionally unnamed network spans
  between rider-facing named ways.

It supersedes the narrow assumption that a roundabout direction repair only
needs to replace edges tagged `junction=roundabout`. A complete local repair
may also use the legal paired entrance and exit lanes surrounding the ring.

## Problem

The current model can technically place roundabout arcs inside each CW
segment's directional alignment, but this becomes incorrect or unmanageable at
multi-arm junctions:

- the same internal intersection geometry is duplicated across several CW
  segments;
- each segment independently owns an arbitrary part of a shared roundabout;
- a segment's forward and reverse directions may need different physical
  terminals, while the logical source has one endpoint coordinate;
- exact reversal illegally reverses one-way rings and their paired approach
  lanes;
- short logical segments are created solely to bridge other segments;
- standalone manual bicycle connectors do not automatically receive safe CW
  membership for approach and rejoin routing;
- the editor shows several segment failures instead of one intersection-level
  connectivity problem; and
- the curator cannot see whether every incoming corridor can reach every
  intended outgoing corridor.

The existing roundabout repair only succeeds when every prohibited edge in the
reversed run is itself tagged as a roundabout. That deliberately excludes the
one-way entrance and exit lanes that make these real cases fail.

## Goals

- Keep all route geometry and legality on the directed base graph.
- Connect multiple named CW segments without inventing fake named corridors.
- Represent separate incoming and outgoing physical ports for one logical
  segment endpoint.
- Infer complete legal movement coverage from reviewed topology.
- Apply a unique safe local roundabout/intersection repair automatically.
- Support curated bidirectional bicycle paths through car-oriented junctions.
- Give junction-internal edges safe, unnamed CycleWays membership for main,
  approach-to-start, and rejoin routing.
- Make route reversal recompute a legal movement rather than reverse geometry.
- Show movement coverage and failures as one junction-level editor problem.
- Preserve existing roundabout reviews and crossing decisions.
- Make only affected junction evidence stale after source changes.
- Provide deterministic real-data validation for the reported junctions.

## Non-goals

- Replacing or editing OSM geometry in place.
- Relaxing bicycle access or one-way policy.
- Treating proximity as graph connectivity.
- Automatically declaring every road intersection part of CycleWays.
- Requiring movement review for all 349 accepted roundabouts.
- Announcing every junction or intersection during navigation.
- Merging crossing safety semantics into routing topology.
- Immediately deleting connector segments before route and share compatibility
  is demonstrated.
- Building a general motor-vehicle turn-restriction engine in the first slice.

## Terminology

### Network junction

A logical CycleWays connection area whose internal geometry is a subset of the
directed base graph. The product/editor label is **Junction**. The data and code
name is `networkJunction` to distinguish it from the existing derived
`route.junctions` navigation records.

### Internal subgraph

The OSM and manual base edges considered inside a junction. The boundary is an
authoring and validation boundary; it does not create a routable polygon or
permit geometric shortcuts.

### Port

A stable directional attachment at the boundary between a CW corridor and the
junction. A divided road normally has distinct entry and exit ports even when
both correspond to the same logical segment endpoint.

A port references a directed base-edge slice, a coordinate, relevant source
fingerprints, and a topology anchor. Raw graph node ids may be included as
derived evidence but are not the only durable identity because graph rebuilds
can replace node ids.

### Segment attachment

The association between a port and a segment direction, for example:

```json
{
  "segmentId": 210,
  "alignmentKey": "aToB",
  "endpoint": "b",
  "usage": "arrive"
}
```

The reverse segment alignment can depart through a different physical port
while both attachments still correspond to logical endpoint B.

### Movement

A legal directed transition from one entry port to one exit port. A movement
has one or more fully attested ordered base-edge realizations. The common case
is calculated automatically. Review data stores only an exception, unavailable
decision, or deliberately selected bicycle path.

### Derived and curated junctions

- A **derived junction** is calculated from an accepted tagged roundabout and
  its local approach topology. A unique legal result requires no manual path
  authoring.
- A **curated junction** contains reviewed overrides such as manual sidewalk
  edges, explicit ports, a selected movement realization, or a movement marked
  unavailable.

## Authority and invariants

### Physical authority

- OSM plus reviewed manual base edges own geometry.
- Normalized bicycle traversal policy owns direction and access.
- Every movement realization is an ordered list of directed base-edge slices.
- Each consecutive pair must be topologically continuous.
- Every slice must be allowed or carry an explicit existing precedence decision
  permitted by the traversal-policy design.
- A junction cannot bridge an unconnected geometric gap.

### Logical authority

- CW segments own names, corridor metadata, and their direction-specific paths
  outside a junction.
- Network junctions own unnamed connectivity between segment ports.
- Crossing records own safety narration such as “cross to the other side”.
- Roundabout classification remains the authority for roundabout cue semantics.

### Routing invariants

- No zero-distance transition replaces physical junction geometry.
- A reverse route is searched and attested independently.
- A movement selected for a CW-to-CW transition is followed exactly.
- Generic routing outside that transition continues to use the ordinary base
  graph.
- Starting or ending inside a junction remains possible through ordinary base
  routing; it does not fabricate a complete CW movement.
- A movement becomes unavailable immediately when any required traversal is no
  longer allowed.

## Discovery and topology expansion

### Candidate scope

Accepted roundabouts continue to be extracted and reviewed exactly as today.
Network-junction candidates are produced only when at least one of these is
true:

- two or more CW segment endpoints attach to the local topology;
- a CW segment direction enters and exits the local topology;
- an invalid alignment contains the roundabout or an attached one-way approach;
- a reviewed manual junction explicitly references the area; or
- an existing logical connector segment is proposed for migration.

Roundabouts with no CycleWays relevance remain cue-classification data only.

### Local subgraph expansion

For an accepted OSM roundabout, discovery starts with the tagged ring and
expands along its attached approach edges to the first stable external arm
nodes. Expansion is bounded by topology, distance, and policy:

- include the ring's directed edges;
- include paired one-way entry and exit connectors attached to the ring;
- stop at the first node representing the external corridor arm;
- stop before an unrelated branch, another junction, or the configured local
  distance boundary;
- retain all legal parallel alternatives inside the boundary; and
- report rather than guess when expansion is ambiguous.

The initial bounds are implementation constants with diagnostic output, not
silent correctness assumptions. A curator can adjust the internal edge set or
ports for a curated junction.

### Port attachment

Candidate generation considers direction-specific CW alignment terminals and
logical endpoint zones. It does not attach a segment solely because its source
line is visually near the junction.

An automatic attachment requires:

- a continuous legal path from the segment alignment to the proposed port;
- terminal proximity within the existing endpoint zone or an explicit reviewed
  junction attachment;
- a unique best arm/direction; and
- no competing segment endpoint with indistinguishable evidence.

Ambiguous attachments become one junction issue. They do not generate several
independent segment acceptance tasks.

## Movement calculation

### Coverage matrix

The derived view calculates every meaningful entry-to-exit movement. A
three-arm junction normally exposes six movements; a same-arm U-turn is omitted
unless explicitly supported.

For each pair, calculate allowed paths within the internal subgraph using the
normalized bicycle policy. The result is:

- `unique`: one clear legal realization;
- `equivalent`: several mechanically equivalent realizations with one stable
  deterministic choice;
- `ambiguous`: materially different legal alternatives require review; or
- `unavailable`: no legal continuous realization exists.

Tie-breaking must be deterministic and bicycle-oriented. It considers path
length, reviewed CW-junction membership, explicit curated preference, and a
small complexity penalty. It never treats a prohibited traversal as a costly
alternative.

### Automatic local repair

The segment direction authoring flow can use a junction candidate to replace a
contiguous blocked local run. Unlike the existing ring-only repair, the run may
contain:

- a one-way approach lane;
- roundabout ring edges; and
- a one-way exit lane.

Repair is automatic only when:

- the blocked run lies wholly inside one recognized junction;
- its external entry and exit anchors are unchanged;
- the selected legal replacement is unique or mechanically equivalent;
- the repaired complete alignment is continuous and endpoint-valid; and
- no non-junction policy conflict remains.

Otherwise, the editor shows the movement alternatives in the junction rather
than presenting a disabled segment acceptance button.

### Authoritative curated movement

A curator may select a bicycle-specific realization for a CW movement. This is
stored as a path selection, not as a global prohibition on all competing base
edges.

When the planner enters the junction from the attached CW arrival direction
and leaves through the attached CW departure direction, it uses the selected
movement. Off-network routes that do not make that CW-to-CW transition can
still use other base-legal paths.

## Segment boundary behavior

### Junction at a segment endpoint

A segment alignment may terminate at a direction-specific junction port rather
than at one shared graph node. The source endpoint coordinate remains the
logical catalog endpoint.

Overlay V2 gains a terminal attachment alongside the explicit edge refs:

```json
{
  "terminalAttachment": {
    "junctionId": "junction-osm-842376170",
    "portId": "road99-west-arrive",
    "endpoint": "b",
    "usage": "arrive"
  }
}
```

The attachment is part of mapping validation and fingerprints. It does not
weaken ordinary endpoint validation for segments without a junction.

### Junction in the middle of one segment

A segment such as #358 remains one named logical segment. Its explicit
directional realization continues through the complete physical junction path
and retains the segment name across it. Junction topology is used to calculate
and audit the alternate direction, but no user-visible segment split is
required.

### Junction-only connector segments

An existing short connector segment can migrate to junction membership when it
has no independent rider-facing corridor meaning. Migration is staged:

1. build the equivalent junction while retaining the segment;
2. prove movement, geometry, naming, route, share, and navigation parity;
3. mark the connector segment deprecated; and
4. retain compatibility for stored/shared routes until the normal compatibility
   window expires.

The underlying base edges remain available and acquire unnamed `cw_junction`
membership.

## Routing integration

### Runtime representation

Build publishes compact junction records containing stable ids, ports, allowed
movements, selected directed edge-share slices, fingerprints, and minimal
classification metadata. Review notes and editor-only geometry are excluded.

Base-routing shards gain direction-scoped junction membership parallel to
direction-scoped CW segment membership. Conceptually:

```json
{
  "cwJunctions": {
    "forward": [{ "junctionId": "junction-osm-842376170" }],
    "reverse": []
  }
}
```

The compact encoding can differ, but membership must remain directional.

### Main route planning

The base graph remains the search substrate. While a route is inside a
network-junction transition, search state retains the entry port so that a
required CW movement can be enforced without globally removing alternative
base edges.

A returned route still contains the complete ordered base-edge traversal. A
junction movement is not an opaque macro that omits geometry or attestation.

### Approach-to-start and rejoin

An allowed junction edge participating in at least one current reviewed
movement is treated as CycleWays network infrastructure by the connector cost
model. This resolves the current gap where a standalone manual edge is excluded
unless it belongs to a CW segment.

Direction-specific membership is mandatory: an internal edge available only
in one direction cannot make the reverse connector route eligible.

### Return routes and route editing

- Reversing a route triggers a fresh directed search.
- The reverse movement may use different ports and different internal edges.
- A route-builder drag or added cue point cannot force an illegal reverse
  traversal.
- If no legal junction movement exists, the requested route fails or detours;
  it never reverses the accepted geometry.
- Web and mobile consume the same core junction-aware route manager.

### Sharing and restore

Shared routes continue to attest the ordered base-edge path. The junction
movement id and fingerprint are included in the navigation-plan/route
attestation fingerprint so a changed required movement cannot silently resume
as the previous route.

Restoration either reproduces the attested movement or reports stale routing
data and recalculates through the normal versioned route workflow.

## Naming and navigation presentation

Junction-internal route spans are:

- `onNetwork: true`;
- `networkRole: "junction"`; and
- intentionally unnamed.

The itinerary does not show a fake segment card for the junction. A maneuver
leaving the junction names the destination CW segment when available.

Accepted roundabout classification continues to produce one roundabout cue.
Junction traversal evidence may eventually replace geometric entry/exit
matching, but the first implementation must preserve existing cue output unless
the new evidence is demonstrably more precise.

A crossing cue remains independently matchable within a junction. For example,
a bicycle movement through an intersection may select the correct route path
while a reviewed crossing record supplies “cross, then turn”.

## Editor experience

### Workspace

Rename the top-level **Roundabouts** workspace to **Junctions**. Preserve all
existing roundabout review decisions and expose filters:

- All relevant junctions
- Roundabouts
- Complex intersections
- Custom bicycle junctions
- Movement issues
- Classification issues

The existing Roundabouts classification list becomes the classification facet
of this workspace; it is not discarded or reset.

### Map presentation

For the selected junction, draw:

- the bounded internal subgraph;
- one-way arrows on every direction-limited edge;
- incoming ports with arrows into the junction;
- outgoing ports with arrows out of the junction;
- attached CW segment ids/names as faint external arms;
- the selected movement as a prominent continuous path; and
- legal alternatives as faint paths when relevant.

Switching CW/Base network focus preserves the selected junction and camera.
The focused layer owns hit testing according to the network-editor workflow.

### Movement matrix

The main inspector presents one coverage matrix rather than several segment
errors:

```text
Arriving from      To 204   To 210   To 211
204                   —       legal    legal
210                 legal       —      legal
211                 legal     legal      —
```

Selecting a cell highlights its entry port, realization, and exit port. Status
and actions are expressed in plain language:

- Legal path selected automatically
- Two bicycle paths need a choice
- No legal path to this segment
- Path became stale after base-edge edit

### Curated bicycle junction workflow

The ordinary curator flow is:

1. Switch to Base network and create or correct the physical bicycle edges.
2. Review their base-edge directions once.
3. Select the internal edges and choose **Create bicycle junction**.
4. Let the editor detect nearby CW endpoint directions and proposed ports.
5. Inspect the movement matrix.
6. Correct only missing ports, unavailable movements, or a preferred path.

There is no requirement to paste JSON or accept every mechanically proved
movement one by one.

### Issues integration

Segment issues caused by one junction are grouped into one junction issue. The
CW segment inspector links to the affected junction and states the relevant
movement, for example:

```text
Reverse path needs a junction decision
Rager junction · 211 arrival → 210 departure
```

After a junction edit, background reconciliation refreshes affected segment
alignments, movement evidence, and issue counts. Build remains explicit.

## Data lifecycle and freshness

Generated candidates and curator-owned decisions remain separate:

- `build/network-junctions/candidates.json` is generated from the current graph,
  accepted roundabouts, and current CW directional alignments.
- `data/network-junction-review.json` contains only curated junctions, explicit
  port overrides, path choices, unavailable decisions, and audit data.

A junction fingerprint covers:

- internal edge identity, geometry, and topology;
- normalized per-direction traversal policy;
- accepted roundabout fingerprint when applicable;
- port anchors and segment attachments;
- referenced segment source and mapping digests; and
- selected movement realizations.

Changes invalidate only dependent evidence:

- editing an unrelated base edge changes nothing;
- editing an internal edge refreshes that junction's movements;
- changing one segment endpoint refreshes its attachments;
- adding a new nearby segment proposes new ports/movements without discarding
  unchanged decisions; and
- deleting a referenced edge or segment produces an explicit orphan/stale
  issue.

No reviewed decision is silently rebound to a different edge or movement.

## Build and promotion

Build validates:

- candidate and review source freshness;
- port anchors and attachments;
- internal edge continuity;
- direction and access for every movement slice;
- movement uniqueness or explicit selection;
- required movement coverage;
- direction-scoped junction membership in routing shards;
- compatibility for any connector segment being deprecated; and
- runtime asset and manifest digests.

Blocking conditions include:

- a previously published required movement becoming stale or invalid;
- a curated path using an unknown/prohibited traversal without valid evidence;
- a port no longer attached to its segment direction;
- an authoritative movement with no continuous realization; or
- a deprecated connector segment lacking proven replacement parity.

A newly discovered optional movement can remain pending and omitted without
blocking unrelated work. A movement required by an offered CW transition must
be current before promotion.

## Case decisions and acceptance fixtures

### Rager: segments 210, 204, and 211

- Accepted OSM roundabout: way 842376170.
- Existing geometry and bicycle policy are sufficient; no manual edge is
  required.
- Current failures include one-way approach/exit lanes, so ring-only reversal
  is insufficient.
- The derived junction must expose all six inter-segment movements and select a
  legal local realization for each.
- Real-data tests must preserve the verified legal replacements of roughly
  87 m, 80 m, and 61 m for the currently failing directions.

### Kiryat Shmona: segments 263, 143, 361, and 144

- Accepted car roundabout: way 228885122.
- The car ring remains one-way according to base policy.
- A curator creates a separate manual sidewalk loop and reviews it as
  bidirectional where physically correct.
- The sidewalk loop becomes the authoritative CW junction path between the four
  segment approaches.
- The car roundabout remains available to unrelated base routing if allowed by
  its own policy.

### Horshat Tal: segments 339, 337, 330, 74, and 96

- Accepted car roundabout: way 1024609346.
- Segments 328 (`צומת חורשת טל`, about 90 m) and 329 (`רחבת כניסה מטעי דפנה`,
  about 25 m) are migration candidates because they primarily provide junction
  connectivity.
- The first release retains them while the junction is built and compared.
- Deprecation occurs only after all intended movements and existing routes have
  parity.

### Dafna entrance: segments 330 and 334

- The logical source endpoints coincide, but physical entry and departure may
  use different sides of the road.
- The junction attaches 330's arrival direction to 334's correct outgoing
  bicycle port.
- Missing right-side geometry is added as manual base edges rather than by
  making a car centerline falsely bidirectional.
- Segment 334 has additional one-way/roundabout problems beyond the entrance;
  the entrance fixture does not claim to resolve all of 334.

### Segment 358

- Accepted roundabout: way 841155426.
- A→B is currently valid; B→A is invalid because the exact reverse includes two
  one-way approach legs and reversed roundabout edges.
- The legal local alternative is about 63 m and uses the correct paired entry,
  legal ring direction, and exit.
- The segment remains one logical named corridor and its repaired reverse is
  applied automatically when uniquely determined.

## Observability

Candidate generation and authoring reconciliation report timings and counts:

- relevant roundabouts scanned;
- derived/custom junction count;
- ports and movements calculated;
- unique, ambiguous, and unavailable movements;
- segment issues collapsed into junction issues;
- affected alignments refreshed;
- movement/path-search duration; and
- build validation/publication duration.

The editor shows the currently updating junction and stage without blocking
unrelated source editing.

## Rollout

1. Add the schema, candidate generation, movement engine, and diagnostic-only
   Junctions view.
2. Validate Rager and #358 against current data before changing runtime routes.
3. Add terminal port attachments and compile unnamed junction membership.
4. Enable junction-aware main, approach, rejoin, reverse, and restored routes.
5. Author the Kiryat Shmona bicycle sidewalk junction.
6. Build Horshat Tal in parallel with existing 328/329 connector segments and
   prove parity before deprecation.
7. Model the 330→334 Dafna entrance and separately continue repairing the rest
   of 334.
8. Promote only after web/mobile route building and navigation scenario tests
   pass for all fixtures.

## Accepted defaults for implementation

- Product label: **Junctions**; data/code entity: `networkJunction`.
- Junction spans are on-network and intentionally unnamed.
- Ports are directional and attach to segment alignment directions.
- Legal movements are calculated automatically; review is exception-based.
- A curated movement is authoritative for its CW-to-CW transition.
- Competing base-legal paths remain available outside that transition.
- Same-arm U-turns are not offered automatically.
- Existing accepted roundabout reviews remain accepted.
- Crossings remain separate safety/narration records.
- Directionality is never ignored, including for a roundabout inside one
  segment.
