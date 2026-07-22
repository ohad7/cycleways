# Bicycle Traversal Policy Design

**Date:** 2026-07-13  
**Status:** accepted design — implementation in progress

## 2026-07-22 amendment — logical overview and physical detail geometry

The public CW map has two legitimate geometric representations, but they must
not compete at the same visual weight:

- the logical source LineString represents one stable named editorial corridor;
- accepted directional alignments represent the physical base edges that a
  rider can actually traverse; and
- a published junction footprint represents the union of its reviewed internal
  base edges, not a freehand connector or every possible movement polyline.

The logical line is therefore an overview and authoring abstraction. It remains
the visible network below detail zoom, remains the fallback for an active
segment without published physical geometry, and remains the stable segment
identity for cards, selection, and content. Between zoom 10.5 and 12 it
cross-fades to the accepted physical representation. At zoom 12 and above the
source line is not visibly painted when physical geometry is available.

Physical alignment presentation is classified without a fuzzy distance rule.
When accepted A-to-B and B-to-A geometries are exact reversals of the same
physical trace, Build publishes one shared bidirectional feature and the map
does not paint permanent arrows. Different traces, or a single available
direction, remain separate directional features with repeated arrows. This
makes ordinary bidirectional dirt roads visually simple while preserving both
carriageways on divided corridors such as Road 99.

Physical features inherit the logical segment's name, road classification,
color, selection, and route-building behavior. They are part of the normal CW
network source rather than a teal diagnostic overlay. Clicking the visible
physical line must therefore select the same logical segment and place route
points on the physical corridor. The logical and physical interaction ranges
follow the same zoom transition as their paint, so an invisible source line
cannot capture a detailed-map click.

The selected logical segment id is also routing input. When a click is close to
several CW mappings, the snapper first uses nearby allowed base edges carrying
the clicked segment's direction-scoped membership. This prevents parallel
roads and roundabout approaches from silently moving the point onto a different
CW segment. If that identity has no nearby routable mapping, ordinary
base-network snapping remains the fallback so stale display data fails usable
rather than trapping the click.

Published junction footprints remain visible as ordinary CW network geometry
throughout the transition. Direction arrows are shown only for genuinely
direction-limited physical edges/alignments; the map does not draw every
entry-to-exit movement, which would create visual clutter. Route preview and
navigation continue to show the exact selected junction movement.

## 2026-07-22 amendment — historical V6 anchor recovery

The earlier conclusion that a V6 token becomes unrecoverable whenever one of
its referenced base edges disappears is superseded. Released V6 tokens are a
durable user contract: removing or splitting an edge may invalidate exact
replay, but it must not erase the route's waypoint intent.

Each released graph version used by a known shared route therefore has an
immutable, graph-hash-keyed anchor archive. The archive binds that graph hash
to the exact historical share-ID registry digest and stores the historical
polyline for each referenced anchor edge. It is generated from the Git commit
that published the token and verified against that commit's registry and
routing shards; coordinates are not inferred from the current graph.

The security and traversal boundary remains strict:

- current canonical identity is still required for exact replay;
- historical geometry is used only to interpolate the token's stored fraction
  into a waypoint coordinate, never as a traversable route;
- the recovered waypoints are snapped and replanned on the current V3 graph
  under the current bicycle traversal policy;
- this fallback is marked `replanned-current-policy` and `requiresReview`, so
  it cannot silently auto-start or resume navigation;
- an unknown graph hash, missing registry snapshot, digest disagreement,
  share-ID rebinding, or incomplete anchor geometry fails closed; and
- promotion validates and bundles the archive as a versioned runtime asset for
  both web and mobile.

Featured catalog routes are migrated to fresh current-graph tokens after
review. Their historical tokens remain recoverable through this path, but the
catalog itself must not depend indefinitely on fallback or bypass the offered
route fingerprint gate. Before a future release replaces public routing
pointers, its released-token anchors and registry snapshot must be captured in
the compatibility archive.

## 2026-07-20 amendment — local roundabout reverse repair

When an otherwise valid alignment has no exact reverse solely because a
contiguous roundabout arc would be traversed against circulation, Direction
Review may propose a repaired reverse. The correction is deliberately local:
it finds the permitted roundabout-only path between the same entry and exit
nodes, splices that arc into the exact reverse, and leaves every non-roundabout
edge unchanged.

The proposal is eligible only when every exact-reverse blocker is
`osm-roundabout-implied-oneway`, all blocked refs are roundabout edges, and the
complete repaired alignment passes endpoint, continuity, traversal, access,
and ownership validation. Mixed one-way-road failures remain manual. Multiple
independent roundabout runs may be repaired, but unrestricted road-network
routing is never used as an automatic correction.

The editor exposes this as a distinct `roundabout-repaired-reverse` proposal,
shows the removed and replacement counts, marks replacement edge rows, and
keeps acceptance manual. A persistent guide explains exact reverse,
roundabout repair, authoring revision, and manual-required proposal classes.

## 2026-07-20 amendment — accepted CW alignment is access evidence

The earlier rule that “CycleWays ownership never grants access” is superseded.
After reviewing segment #19 against the base network, a published, accepted V2
CycleWays alignment is now stronger local evidence of bicycle access than the
base-edge `explicit-access-prohibited` or `explicit-access-conditional`
classification. Directionality and manual-review reasons are not overridden.

This is deliberately narrower than an “ignore restrictions” switch:

- precedence exists only for the exact accepted V2 traversal direction;
- the alignment must cover the full base edge; a partial restricted edge must
  first be split at the CW boundary;
- legacy undirected membership and unaccepted drafts grant no access;
- `prohibited`/`conditional` caused by those explicit access reasons may become
  effectively `allowed`, retaining their base state/reason as provenance;
- `unknown` remains fail-closed and is omitted from the current map-review
  preset; and
- non-CW routing continues to enforce the base policy unchanged.

This makes `e57116180_1` eligible in both directions only after segment #19's
two directional alignments are accepted. It does not open `e55788838_2`, which
currently has no accepted CW alignment, and it does not let partial CW coverage
open the remainder of a restricted edge.

## Summary

CycleWays must treat bicycle traversal rules as a graph invariant, not as a
route preference. Every route used for planning or navigation must be composed
only of directed edge traversals permitted by one versioned policy. Route cost,
snapping preference, saved geometry, and a shared token may never widen that
permission. The only CW exception is the reviewed, full-edge,
direction-specific precedence defined above.

The first rollout will:

1. normalize OSM and reviewed editor data into per-direction bicycle traversal
   states at build time;
2. carry those states through a new routing-asset and compact-shard schema;
3. enforce one central runtime predicate in every traversal-producing path;
4. revalidate exact shared routes and fail over to current-policy planning when
   their anchors can be recovered;
5. prevent unvalidated geometry from starting or resuming navigation; and
6. replace the current one-path CycleWays overlay with one logical segment plus
   independently reviewed directional alignments;
7. make outbound, return-to-start, and opposite-direction route authoring plan
   real permitted traversals instead of reversing geometry; and
8. audit every affected CycleWays mapping, catalog route, and the ride that
   exposed the defect before promotion.

This design deliberately precedes the crossing/maneuver work from
[`navigation-ride-feedback-3`](../navigation-ride-feedback-3/discussion.md).
That work needs a route regenerated under the permitted-traversal policy;
otherwise we would design instructions around geometry the planner should never
produce.

## 2026-07-14 amendment — global routing and exception-based curation

Directionality is a property of the base routing graph, not of the CycleWays
overlay. The same hard traversal verdict applies when a route is wholly outside
the CycleWays network, while routing from the rider's location to a route's
starting point, and while navigation computes an initial approach or rejoin.
Those surfaces may use different costs, but they may not use different
permissions. In product wording, “safe” for these connectors means that the
result follows the app's modeled direction and access policy; it is not a wider
claim about real-world safety.

The runtime has one directed graph search for ordinary base routes and
connector-cost routes. The mobile ride-setup approach and navigation
approach/rejoin both call the same connector entry point. A regression fixture
must keep a prohibited direct edge shorter than an allowed detour and prove
that all three surfaces select the detour. Final route validation remains
mandatory even though disallowed adjacency is omitted during graph loading.

This guarantee becomes a production guarantee only after the policy-bound V3
graph and strict manifest are promoted. The currently released V1/V2 assets do
not contain sufficient policy evidence and must not be described as already
protected. The code and complete policy-bound asset set are still one atomic
Gate D cutover.

Review is exception-based:

- `symmetric_candidate` means the existing alignment and its exact reverse are
  both mechanically valid. The curator may approve these in one explicit batch
  that records reviewer, date, and batch ID; the action publishes the existing
  explicit alignment and a digest-bound `reverseOf` alignment.
- `direction_evidence_needed` means the only blocker is an unreviewed manual
  base edge. The curator reviews that base edge once, rebuilds, and every
  dependent segment is revalidated. These are not presented as structurally
  invalid CycleWays mappings.
- `invalid_existing`, `single_direction_candidate`, and `unresolved` remain
  individual review queues. Distinct opposite paths, divided carriageways, and
  unavailable directions are never bulk-inferred.

The editor's Base Graph workspace is also the direction-policy inspection and
correction surface for every base edge, including edges with no CycleWays
membership. A toggle overlays every direction-limited edge at once: repeated
arrowheads point in the actually permitted travel direction, including
reverse-only edges whose display geometry must be reversed, while separate
styles distinguish confirmed one-way evidence from conditional/unknown review
cases. Selecting an edge draws A and B at the stored endpoints and shows
forward/reverse states, reason codes, and evidence. Manual-edge edits stay on
the manual feature. OSM-derived
geometry and tags remain read-only; a reviewed correction creates a
whole-source-way override keyed by OSM way ID and the unsplit oriented geometry
digest, with both states, rationale, evidence, reviewer, and date. It applies
to every split graph edge from that way. A missing way or changed geometry
makes the override stale and blocks the build until it is removed or reviewed
again. Saving or removing either kind of direction evidence marks graph and
Direction Review evidence stale until the curator rebuilds.

## 2026-07-16 amendment — author once, review exceptions

Creating a CycleWays segment by explicitly selecting its base-edge sequence is
already a curation decision. The editor must not ask for a second direction
decision when that authored sequence and its exact reverse are mechanically
proved safe and structurally valid.

A newly authored mapping is published in both directions automatically only
when all of the following hold:

- the source mapping is an explicit editor edge selection, not an automatic
  match;
- the authored alignment passes endpoint and continuity validation;
- every directed traversal in the authored alignment is `allowed`;
- the exact reverse also passes with every traversal `allowed`; and
- neither alignment conflicts with another segment's directed ownership.

One-way, conditional, unknown, asymmetric, discontinuous, endpoint-mismatched,
and ownership-conflicting cases remain in Direction Review. This is automatic
publication of already-authored intent, not inference from road class or a
blanket assumption that dirt roads are bidirectional.

Review binding is scoped to the evidence used by an alignment. An acceptance
records a digest of its normalized edge references, referenced edge geometry,
and normalized directional policy. After a graph rebuild, an accepted
alignment remains published when its source geometry and this evidence digest
are unchanged and current validation still passes. A global graph digest
change caused by an unrelated new edge must not force reacceptance. Changed or
missing referenced evidence still moves the alignment back to review.
Existing accepted records created before evidence digests were introduced are
bootstrapped once by current full validation; subsequent refreshes use the
recorded digest and therefore detect referenced geometry or policy changes.

Proposal refresh also preserves migration provenance when the staged mapping
still equals the regenerated proposal. This keeps mechanically proved legacy
segments eligible for the one-time symmetric migration batch across repeated
refreshes.

## Why this is a separate foundation

The July 13 ride exposed an end-to-end data-loss defect:

- the source graph contains 48,368 edges, including 3,883 edges with
  `oneway=yes`, 28 with `oneway=-1`, and 1,779 roundabout edges;
- 1,503 of those roundabout edges rely on the standard implied one-way rule;
- the compact shard writer omits the raw direction tags;
- the runtime adds forward and reverse adjacency for every edge; and
- the shared ride replays edge `e1024904326_1` (share ID 370) in reverse for
  about 547 m on one carriageway of Road 99.

CycleWays preference makes the failure more likely: that carriageway belongs to
CycleWays segment 174 while the parallel carriageway serving the other direction
does not. The cost model therefore rewards the forbidden traversal rather than
merely tolerating it.

Segment 174 is one product object, but its current overlay is one flat ordered
path of 27 directed base-edge references. It has no second realization for the
parallel carriageway. This reveals a second modeling defect: a CycleWays
segment's logical identity is currently conflated with one physical routing
line. Correct traversal enforcement must therefore be accompanied by a
directional CycleWays mapping model; otherwise the safe fix can only remove the
bad route without representing the valid return direction.

The same inspection found a broader access defect. The source has 724
`restricted` and 9 `conditional` edges. Normal planner cost ignores
`accessStatus`, while connector routing checks CycleWays membership before its
access gate. At least one currently restricted edge is CycleWays-owned.

Adding only `oneway` to adjacency is insufficient. Traversals are also created
directly for partial start/end edges, same-edge routes, connector endpoints,
exact shared-route replay, and reversed navigation geometry. A persisted active
ride can also execute its stored `NavigationRoute` in the background without
loading the current graph.

## Product contract

### What CycleWays promises

CycleWays plans under a named, reviewable bicycle-traversal policy using the
current mapped data. It does **not** certify that a route is legally or
objectively safe in the real world. The map may be stale, local law may be more
specific, and this phase does not model every possible restriction.

User-facing copy will therefore say that a route “follows the mapped
edge-direction and access rules modeled by this app,” not that it is a
“guaranteed legal” or objectively “safe” route.

### What a shared route promises

A route token preserves route intent and attempts exact replay. It does not
preserve historical geometry when that geometry violates the current policy.

- A still-valid exact token reuses the same directed edge references against
  their current geometry.
- An invalid exact traversal is rejected and recalculated from recoverable
  anchors.
- A recalculated route is visibly marked as updated and never auto-starts.
- If anchors cannot be recovered, coverage is unavailable, or no permitted path
  exists, Start stays disabled. The historical line is not used as a fallback.

Existing V1–V6 tokens remain decodable. V1–V3 are intent-only inputs that are
replanned; they never contribute navigable historical geometry. V4–V6 may ask
for exact directed replay, but every stored direction is treated as an
untrusted request. A stored graph-version mismatch is diagnostic context, not
proof of invalidity by itself. Across that mismatch, however, every referenced
share ID must also have a provably unchanged canonical edge identity in the
released registry history. Current edge resolution, identity continuity, and
traversal validation jointly decide exact replay.

V4/V5 carry coordinate fallbacks when an edge disappears. V6 contains only
edge anchors, so its recovery is best-effort: a missing V6 edge produces a
clear unavailable result. A future token may add compact fallback coordinates,
but no token-format bump is required to stop forbidden replay.

### No end-user override

The public planner and navigation UI will not offer “ignore one-way” or “route
through restricted access.” A source correction may override OSM only through
reviewed repository data with evidence and provenance. A published accepted V2
alignment is such reviewed repository evidence; legacy membership, a draft, or
a route request is not.

### Phase 1 is riding-only

This policy plans routes that can be ridden. An edge tagged `dismount`, or any
other edge that requires walking the bicycle, is excluded until navigation has
an explicit walking maneuver and mode transition. Purpose-dependent access
(`destination`, `customers`, private permission, permits, and similar values)
is also excluded because the app does not know whether the rider satisfies the
condition.

These choices may reduce route availability. They are deliberate: the app will
not silently present walking or conditional private access as an ordinary
rideable route.

### What a CycleWays segment means

A CycleWays segment is a logical, user-facing corridor: one stable segment ID,
name, quality record, content, and detail page. It is not necessarily one
physical line. Underneath it, the routing model contains up to two canonical
directional alignments, `aToB` and `bToA`, each backed by a complete ordered
directed base-edge sequence.

A divided road such as Road 99 remains one logical segment when both
carriageways describe the same named experience. It receives two explicit
alignments. A normal two-way path may store one explicit alignment and derive
the other as `reverseOf: "aToB"`, but only after the build proves every reversed
traversal is allowed. The logical segment is split only when the two paths have
different product identity—for example different names, meaningful endpoints,
classification, quality, or independently described experience—not merely
because OSM uses separate carriageways.

The low-zoom public network overview renders one logical corridor to avoid
duplicate cards and visual clutter, but its card/selection state carries a
compact `both directions`, `toward B only`, or `toward A only` availability
indicator. At detail zoom, exact reverse alignments collapse to one physical
bidirectional line without permanent arrows, while different alignments render
as both physical lines with arrows and replace the logical source line.
Segment detail, direction selection, route preview, and navigation use the exact selected alignment. User-facing direction names
use endpoint/destination labels (and a compass fallback), never the
storage-relative words “forward” and “reverse.” If only one direction has a
reviewed realization, the other direction is explicitly unavailable rather
than implied by mirroring the line.

Distance, elevation gain/loss, surface, road exposure, and availability on a
direction selection come from that alignment or its attested route, never from
the old logical centerline metrics.

Bulk migration does not require writing 568 endpoint translations before
direction safety can ship. Missing legacy labels use a deterministic localized
compass/destination fallback. Road 99 and every manually edited or newly created
segment require meaningful Hebrew/English endpoint labels before acceptance;
raw keys such as `aToB` never reach users.

“Mapped in both directions” means that both endpoint-to-endpoint alignments are
accepted. It does not promise that the two physical lines meet at every point or
that a rider can make a U-turn anywhere along the segment. A return composition
must still find real permitted graph connections at its turnaround and return
endpoint.

### Rider outcomes

| Situation | Route surface | Start / guidance | Rider outcome |
|---|---|---|---|
| Existing token remains valid | Exact current line | Enabled | Opens normally. |
| Existing token replans | Validated replacement line plus update notice | Enabled only after the rider reviews it | Review the changed route, then Start. |
| Token intent cannot be recovered | Waypoints when available; any old line is hidden or clearly ghosted as unavailable | Disabled | Edit/recreate the route or retry with routing data. |
| Exact reverse is forbidden but opposite intent is recoverable | Original line remains while a separate draft is planned | Disabled until the new draft is reviewed | Use “Plan the opposite direction”; the replacement may use another carriageway or detour and is never presented as the same line reversed. |
| No exact reverse and no recoverable intent | Forward line remains; opposite-direction control is disabled | Forward only | Explanatory copy says this saved line cannot be safely rebuilt in the other direction. |
| User adds a return-to-start leg | Outbound line stays committed while a permitted return candidate is planned | Existing route remains usable; changed draft requires review | The return may use the opposite CW alignment or another corridor. If none exists, the failed leg is not appended. |
| Active ride fingerprint mismatches | No stale line presented as active guidance | Old session is interrupted | Background updates stop; next foreground preserves recoverable intent and explains that the route must be reviewed/restarted. |
| No modeled path is found | Waypoints and typed failure, not a navigable route line | Disabled | Change points or route intent; restrictions are never relaxed. |
| Offline/shard coverage is missing | Existing intent with a coverage error | Disabled | Retry when routing data is available; do not confuse this with a proven no-path result. |
| Connector or rejoin fails | A beeline may show orientation only and is visually distinct from a route | No turn guidance on the beeline | Continue with geographic context or stop safely and replan. |

Every new notice, error, disabled-control explanation, and one-time interruption
announcement ships in Hebrew and English. The wording follows the product
contract above and does not claim objective safety or legal certification.

## Goals

- No planned, restored, connector, rejoin, reversed, or resumed navigation
  route contains a traversal disallowed by the active policy.
- The app consumes normalized traversal states and does not reinterpret raw OSM
  tags at runtime.
- Hard traversal permission is independent of planner/connector cost profiles.
- Invalid historical routes fail closed while retaining as much editable route
  intent as the token contains.
- Schema and policy mismatches are explicit failures, not “assume two-way.”
- Build reports make source ambiguity and editorial conflicts reviewable before
  promotion.
- One logical CycleWays segment can safely represent different physical paths
  in its two travel directions without duplicating the user-facing segment.
- Route creation, return-to-start, and opposite-direction planning explain and
  visibly review asymmetric results instead of silently reversing geometry.
- Working field/path routing from the reported ride remains a protected
  regression baseline.

## Non-goals

- turn-restriction relations, `no_entry` relations, barriers, gates, live
  closures, or traffic conditions;
- evaluating time-dependent or user-dependent access conditions while riding;
- a complete statement of Israeli cycling law;
- crossing penalties, “cross the road” cues, lane/shoulder choice, or
  side-of-road narration;
- soft editorial preferred direction for a CycleWays segment;
- walking/dismount routing and mode-transition instructions;
- silently treating a newly planned opposite-direction corridor as the exact
  reverse of an existing route;
- generating multiple competing editorial alternatives for the same logical
  segment and direction; V1 has at most one canonical realization per
  direction;
- fixing the other cue, via-point, camera, and voice-scheduling issues from the
  ride-feedback discussion.

## Core model

### Direction is relative to the stored edge

For every edge, `forward` means its persisted `from -> to` orientation and
`reverse` means `to -> from`. Graph splitting must preserve the source way's
coordinate order so OSM direction tags retain their meaning.

### Logical segments and directional alignments

The authoring representation is conceptually:

```json
{
  "segmentId": 174,
  "sourceGeometryDigest": "…",
  "endpoints": {
    "a": { "coordinate": [35.0, 33.0], "zoneMeters": 20, "labels": { "he": "…", "en": "…" } },
    "b": { "coordinate": [35.1, 33.1], "zoneMeters": 20, "labels": { "he": "…", "en": "…" } }
  },
  "alignments": {
    "aToB": {
      "published": {
        "disposition": "accepted",
        "realization": { "type": "explicit", "edgeRefs": ["complete A-to-B directed sequence"] },
        "mappingDigest": "…",
        "review": {
          "reviewedAt": "…",
          "reviewer": "…",
          "graphDigest": "…",
          "policyDigest": "…",
          "sourceGeometryDigest": "…",
          "mappingDigest": "…"
        }
      },
      "draft": null
    },
    "bToA": {
      "published": null,
      "draft": {
        "realization": { "type": "reverseOf", "alignmentKey": "aToB" },
        "proposal": { "kind": "exact-reverse", "algorithmVersion": "…" },
        "validation": { "status": "valid", "referencedMappingDigest": "…" }
      }
    }
  }
}
```

Each direction slot stores its current published record separately from one
optional working draft. The effective disposition is one of three values:

- `accepted` — an explicit sequence, or a policy-proved `reverseOf` sequence;
- `unavailable` — a reviewed decision that this logical segment is not offered
  in that direction. It stores a stable public `unavailableReasonCode` plus an
  internal rationale/evidence/reviewer record; curator prose is never rendered
  directly; or
- `needs_review` — no current valid published record exists, so the slot is
  unresolved and blocking for an active navigable segment.

A valid published record can remain active while the curator experiments in its
draft. Accept atomically replaces `published` and clears or archives the draft;
dismiss clears only the draft. If graph, policy, source, mapping, endpoint, or
override evidence invalidates the published record, build excludes its runtime
membership and the effective disposition becomes `needs_review` even though the
old record remains as audit history. A `reverseOf` record binds the referenced
alignment's mapping digest; changing that alignment invalidates the dependent
record rather than changing it implicitly. Its target must be the opposite
slot's valid published explicit alignment; self-reference, chains, and cycles
are rejected.

The V1-to-V2 command writes a complete non-authoritative proposal artifact.
Only an explicit editor apply/review action writes the staged V2 authoring
overlay; the current production V1 input remains untouched during shadow work.
After the reviewed network is complete, cutover moves that V2 file to the
canonical overlay path. Drafts live in the V2 authoring overlay but are ignored
by public asset generation; runtime build reads only current valid `published`
records.

`unavailable` is not a routing prohibition and cannot override base-edge
permission; it is an editorial statement that CycleWays does not offer a
canonical alignment in that direction. Ordinary base routing may still find a
different allowed corridor, but it does not receive this segment's preference
or identity. The localization layer maps the public reason code to careful
Hebrew/English copy that never implies that no legal real-world road exists.
V1 codes are `no_canonical_alignment`, `outside_logical_corridor`, and
`editorially_not_offered`; source gaps and automatic no-result remain internal
review states rather than public unavailable codes until a curator decides.

CycleWays ownership is attached to an `(edgeShareId, traversalDirection)` pair.
An edge may be a preferred part of segment 174 forward without its reverse
traversal inheriting that preference. Exclusivity is checked per directed
traversal rather than per undirected edge, and only among active accepted
alignments. Deprecated split-archive mappings are compatibility history, not
competing ownership. V1 blocks two active logical segments from claiming the
same directed interval; if a future product model needs an intentional shared
trunk, it will require an explicit reviewed shared-ownership record rather than
being inferred from overlap. The V1 build asserts active membership multiplicity
at most one and a CycleWays cost bonus is applied once, never multiplied by
membership count. Route attestations always name the actual directed
base-edge traversals and optional `{segmentId, alignmentKey}` provenance; a
logical segment ID alone can never authorize navigation.

### Four traversal states

Each direction is normalized to one of:

- `allowed` — the active policy permits ordinary bicycle routing;
- `prohibited` — mapped data explicitly forbids the traversal;
- `conditional` — permission depends on a condition the app does not evaluate;
- `unknown` — tags conflict, use an unsupported value, or lack required
  reviewed metadata.

Consumer planning routes only through the effective `allowed` state. Base
`explicit-access-prohibited` or `explicit-access-conditional` becomes
effectively allowed only for a full-edge, direction-specific published V2
alignment. One-way, roundabout, manual-reviewed, and `unknown` evidence is never converted to
allowed. Missing tags are not automatically unknown: the versioned
default-policy predicates must explicitly cover the source tag combination. An
unmatched combination resolves to `unknown`.

The build representation is descriptive:

```json
{
  "bicycleTraversal": {
    "forward": "allowed",
    "reverse": "prohibited",
    "forwardReason": "default-access",
    "reverseReason": "osm-oneway"
  }
}
```

The promoted compact representation may bit-pack the states and reason enums;
it must decode to this semantic shape.

### One runtime verdict

All consumers use one pure function, conceptually:

```js
bicycleTraversalVerdict(edge, fromDistance, toDistance, policy)
// -> { allowed, state, direction, reason, policyId }
```

The direction is derived from the actual distances, never trusted from a
caller or token. A zero-length traversal is harmless and may be accepted for
endpoint bookkeeping. Every non-zero traversal must resolve to `allowed`.

Adjacency omission is an optimization. The verdict plus final route validation
is the safety boundary.

### Navigable geometry comes from validated traversals

The validated directed traversal list is the sole source of navigable
geometry. A route assembler regenerates geometry from those traversals, and the
attestation binds the canonical traversal signature to the canonical geometry.
Geometry-only artifacts are display-only.

This applies after every transformation. Linear clipping splits the affected
traversal fraction; reverse swaps traversal order and endpoints; loop rotation
splits and rotates the traversal list before rebuilding geometry. A visually
closed loop is not enough: alternate-start loop rotation is allowed only when
the graph traversal is closed or contains an explicit allowed seam traversal.
The current behavior that may append a straight 1–25 m closing chord cannot
produce navigation geometry; without graph-backed closure the route uses linear
start semantics or plans a real seam.

Connector, approach, and rejoin results likewise retain their traversal
signatures through `approachLeg` and session composition. A beeline or geometry
whose producing traversals were discarded cannot be voiced or followed as a
route. Featured-route snapshots and other precomputed geometry remain display
assets until their route token is restored and attested on current assets.

### Riding a selected CycleWays alignment

Choosing “toward B” or “toward A” on a logical segment is not generic waypoint
routing and is not geometry reversal. A shared-core
`routeFromAcceptedAlignment(segmentId, alignmentKey)` constructor expands that
exact accepted public-index sequence, validates identity/policy/continuity,
builds terminal waypoint occurrences and leg boundaries, and returns an
attested route with `derivation: curated-alignment`. If the alignment is stale,
unavailable, or cannot be validated, it remains display-only and Start is
disabled.

The constructor for `bToA` must read `bToA`; it may never reverse `aToB` as a
shortcut. Generic return/opposite planning may prefer an accepted alignment as
part of graph search, but it is still a newly planned route with its own
attestation. This preserves the difference between “ride this reviewed
CycleWays segment toward B” and “find me some permitted way back.”

## Curating directional CycleWays mappings

### Correcting the current network

The existing overlay is not grandfathered. Its accepted flat `edgeRefs` arrays
are evidence of prior review, but every actual direction is revalidated against
the new policy. Segment IDs, names, content, and canonical source features stay
stable; only their routing realizations migrate.

Migration is an editor-owned, reviewable process rather than a bulk JSON rewrite:

1. **Freeze a baseline.** Record the current overlay digest, logical source
   geometry, current edge sequence, route/catalog consumers, and before-change
   display geometry for every active segment.
2. **Establish logical endpoints.** Label source endpoints `a` and `b` and record
   endpoint zones that tolerate the small offset between divided carriageways.
   Endpoint zones do not permit a synthetic connector: each alignment still
   needs a continuous graph-backed path between its actual boundary nodes.
3. **Place the existing sequence.** Compare its oriented endpoints with the
   logical endpoints and wrap it as either `aToB` or `bToA`. Revalidate every
   directed traversal, continuity, length, source-corridor coverage, and
   direction-scoped ownership. `unknown` and partial restricted traversals
   downgrade the alignment to `needs_review`. A full-edge `prohibited` or
   `conditional` traversal is reviewable with explicit CW-precedence evidence;
   it becomes effective only when its reason is explicit access and the curator
   accepts that direction. One-way and manual-review restrictions remain
   blocking.
4. **Propose the other direction.** First test an exact `reverseOf` candidate.
   Accepting that candidate is possible only when every reversed traversal is
   base-allowed or is a full-edge explicit-access `prohibited`/`conditional` traversal the
   curator explicitly accepts under CW precedence. Otherwise a direction-aware corridor matcher may propose a complete
   alternate base-edge sequence between the endpoint zones. It must search the
   permitted graph; it may not copy CW ownership to a nearby carriageway or
   replace only the visibly problematic edge.
5. **Classify the result.** The migration report groups segments as
   `symmetric_candidate`, `alternate_candidate`,
   `direction_evidence_needed`, `invalid_existing`,
   `single_direction_candidate`, or `unresolved`. Manual-only unknown evidence
   uses `direction_evidence_needed`; `invalid_existing` is reserved for a hard
   policy, topology, endpoint, or mapping failure. It reports affected offered
   routes and the exact reasons for every non-ready alignment.
6. **Review in the editor.** The curator views direction arrows and both
   physical lines, previews each direction, then accepts the sequence, edits
   it, or explicitly marks that direction unavailable with a rationale and
   evidence. Unambiguous symmetric candidates can be bulk-accepted only through
   an explicit editor action that records the migration batch and reviewer;
   asymmetric, invalid, manual, CW-precedence, and unknown cases are reviewed
   individually.
7. **Close consumer impact.** Every catalog route and saved fixture using a
   changed alignment is regenerated and accepted, withdrawn, or made
   display-only. An active logical segment is migration-complete only when both
   slots are `accepted` or explicitly `unavailable`, at least one is accepted,
   and every offered consumer has a disposition.

For Road 99 segment 174, the existing 27-edge sequence becomes one reviewed
direction. The other direction is a separately authored complete sequence on
the parallel carriageway, expected to include share ID 19 in its allowed
direction. It is not produced by appending edge 19 beside edge 370. Both full
sequences, their endpoint transitions, and their effect on the July ride are
reviewed before promotion.

The migration is deliberately resumable. Draft and accepted alignment states
are stored independently, review queues survive editor restarts, and reports
use stable segment/alignment keys. Promotion reads only accepted/unavailable
dispositions; a half-migrated editor session cannot leak into runtime assets.

### Adding or changing a segment

Creating a segment starts in an unpublished editor workspace record containing
its reserved ID, logical feature/metadata, endpoints, and both alignment slots.
It is not yet an active `map-source` feature, public card, build blocker, or
routing member. Existing-segment endpoint, logical-geometry, or identity edits
are staged in the same kind of workspace record while the current published
feature/alignment remains live. Cancel removes the workspace change without
touching public data.

The curator chooses or confirms endpoint labels and then authors each direction
independently:

1. Pick the base edges for the first direction in travel order. The editor
   renders arrowheads, rejects a non-allowed pick immediately, and continuously
   checks topology, endpoint zones, directed ownership, and source-corridor
   coverage.
2. For the second direction choose exactly one action:
   - **Use this path in reverse** — enabled only when policy validation proves
     the complete reverse; it stores `reverseOf`, not duplicated refs.
   - **Map another path** — select a complete explicit sequence, typically the
     other carriageway or a direction-specific side path. An automatic
     direction-aware suggestion is a draft until accepted.
   - **Not offered in this direction** — record an unavailable reason,
     evidence, and user-facing explanation.
3. Preview `aToB` and `bToA` separately with exact geometry, distance,
   elevation, surface/road exposure, and any difference between the logical
   overview line and the rideable line. The editor also previews an outbound
   plus return composition so discontinuities at the endpoints are visible.
4. Accept each alignment independently. Acceptance records reviewer, time,
   policy ID/digest, source and geometry digests, and whether the realization is
   explicit or derived. Changing edge order, geometry, endpoints, policy, or a
   referenced override invalidates the affected acceptance.
5. Save through the editor API, rebuild, inspect the route-impact report, and
   promote only after all gates pass. Activation is one recoverable server
   transaction that verifies the workspace's base digests, writes the logical
   source feature and published alignment records together, then removes the
   workspace draft. It is allowed only when both direction slots have reviewed
   dispositions and at least one is accepted. Canonical map data and generated
   public assets are never hand-edited.

The editor's segment-level status is derived: `ready_both_directions`,
`ready_one_direction`, or `needs_review`. The curator may keep a segment active
with one reviewed unavailable direction, but web and mobile must present that
limitation. Two unavailable directions cannot remain an active navigable
segment; it is display-only or transitioned out of active status. A segment is
split only through the existing explicit split
workflow when its product identity changes; choosing two carriageways is not a
split.

`map-source.properties.status` remains the logical lifecycle authority with the
existing stored values `active`, `deprecated`, and `legacy`. Overlay V2 adds a
separate routing disposition for an active feature: `navigable` or
`display_only`. “Withdraw” means an explicit transition out of `active`
(normally to `deprecated`); it is an editor action, not a fourth hidden status.
Only `active + navigable` segments require/publish runtime alignments.

### Direction Review workspace

The editor is the primary human-review surface, but the build artifact remains
the semantic authority. A Direction Review workspace consumes the exact
normalized policy artifact and provides:

- allowed/prohibited/conditional/unknown colors and directional arrows;
- raw tags, normalized per-direction verdict, reason, provenance, policy
  digest, and override evidence for the selected edge;
- Base Graph selection for any manual or OSM edge, including A/B orientation,
  arrows, and reviewed direction-policy editing independent of CW membership;
- separate `aToB` and `bToA` alignment tabs whose published and draft badges,
  metrics, and edge lists can be visible at the same time;
- queues for invalid existing alignments, missing second directions,
  one-way/roundabout CW ownership, manual unknowns, and affected offered routes;
- a persisted fast-review queue for manual bidirectional evidence: reviewing a
  segment saves its edge evidence immediately without changing runtime
  membership, while one explicit batch finalization rebuilds graph/policy
  evidence once, revalidates every queued segment, accepts only passing
  alignments, and retains failures with actionable reasons;
- token exact-replay and coordinate-replan previews with before/after lines and
  a zero-non-allowed traversal result; and
- explicit accept, edit, unavailable, fix-source, withdraw, and display-only
  dispositions.

The normalizer and audits work without network access. The current editor can
show the local graph but uses remote Mapbox styles; a local blank/base style is
provided for fully disconnected direction review. Because the generated full
graph is not retained in a clean checkout, the curator first runs a prepare
command or imports a retained Direction Review bundle containing normalized
graph geometry, policy/evidence, overlay/workspace, reports, and the local style.
After that prerequisite, validation is fully offline; missing preparation is a
clear error, not an empty/partially authoritative workspace. Satellite or street
context still requires cached/packaged tiles or connectivity and is evidence
assistance, not part of traversal validation.

## Build-time normalization

Normalization lives in one testable processing module and produces both the
promoted state and a detailed audit trace. Runtime code receives the result;
it does not receive the responsibility to understand OSM precedence.

### Direction rules

The normalizer applies these rules in order:

1. A bicycle-specific one-way value (`oneway:bicycle`) controls bicycle
   direction when present.
2. Otherwise an explicit generic `oneway` controls vehicle direction.
3. Otherwise `junction=roundabout` implies forward-only traversal.
4. Other features use the ruleset default. `junction=circular` does not imply
   one-way without an explicit tag.

Recognized values include the standard values plus common legacy spellings:

- forward-only: `yes`, `1`, `true`;
- two-way: `no`, `0`, `false`;
- reverse-only: `-1` and the documented legacy reverse spelling.

`oneway:conditional` and `oneway:bicycle:conditional` participate at the same
specificity as their unconditional counterpart. The unconditional value is the
fallback outside the stated condition; it does not erase the conditional
clause. Because phase 1 does not evaluate time, vehicle, or other conditional
expressions, any applicable conditional that can change bicycle permission
makes the affected direction `conditional`. A malformed or unsupported clause
makes it `unknown`. In particular, `oneway=yes` plus
`oneway:conditional=no @ (...)` is not normalized as unconditionally one-way,
and a bicycle-specific conditional takes precedence over a generic one-way
while its condition holds.

`reversible`, `alternating`, conflicts, and unknown values likewise become
`conditional` or `unknown` and are not routed in this phase. Explicit
`oneway=no` overrides an implied roundabout/highway default only when no
applicable conditional at that specificity can change it.

Legacy `cycleway=opposite*` and directional permission such as
`bicycle:backward=yes` can carry contraflow intent in real OSM data. This first
policy deliberately does not infer an ordinary allowed reverse traversal from
either form alone when generic `oneway` disagrees. It records an `unknown`
conflict for review and requires an unambiguous `oneway:bicycle` value or a
reviewed repository override. That is a fail-closed CycleWays policy, not a
claim that the legacy tags have no OSM meaning.

### Access rules

Access is resolved separately for forward and reverse, then intersected with
the direction result. For each direction, the first matching level in this
specificity lattice wins:

1. `bicycle:{forward|backward}` and its conditional form;
2. `bicycle` and `bicycle:conditional`;
3. `vehicle:{forward|backward}` and its conditional form;
4. `vehicle` and `vehicle:conditional`;
5. `access:{forward|backward}` and its conditional form;
6. `access` and `access:conditional`; and
7. the first matching versioned default-policy predicate.

At each level, the unconditional and conditional tags are composed; they are
not two candidates from which the unconditional tag can win. A conditional
clause at the winning specificity that could narrow or widen the unconditional
result makes the affected direction `conditional`. A malformed or unsupported
clause makes it `unknown`. Lower-specificity tags are considered only when the
higher-specificity level supplies neither an unconditional nor a conditional
value. Thus `bicycle=yes` plus `bicycle:conditional=no @ (...)` is conditional,
not allowed, while a bicycle-specific result can still supersede a generic
`access` result. The evidence trace retains the unconditional fallback, every
conditional clause, and the specificity decision.

`motor_vehicle=*` alone does not restrict bicycles. A more specific explicit
value can override a generic access value, but access and one-way direction are
still separate dimensions. A directional permission that contradicts the
resolved one-way rule becomes `unknown` with both sources in its conflict trace;
it never silently widens or silently hides the contradiction.

- At the applicable level, `yes` and `permissive` resolve to allowed access;
  bicycle-specific `designated` and `official` do as well.
- `optional_sidepath` and `discouraged` remain allowed hard access; they may
  affect preference cost in a separate model.
- `no`, `use_sidepath`, and ride-incompatible `dismount` resolve to prohibited
  for ride navigation unless a more specific reviewed rule applies.
- `private`, `destination`, `customers`, `delivery`, `agricultural`,
  `forestry`, `military`, `permit`, and conditional expressions resolve to
  conditional unless the policy gains enough context to evaluate them.
- Generic `permissive` is allowed unless a more specific bicycle/vehicle value
  says otherwise.
- Unsupported or conflicting values resolve to unknown and appear in the
  report.

The current coarse `accessStatus` remains temporarily for editor display and
migration diagnostics. It stops being routing authority once
`bicycleTraversal` is present.

### The default policy is an explicit ordered ruleset

The initial ruleset is named and versioned (for example
`il-bicycle-v1`). It is an ordered list of tag predicates, not a highway-only
lookup. Each rule records its output, OSM semantics source, and any applicable
Israeli legal/policy evidence. A source edge that matches no rule becomes
`unknown`; the enforced build never falls through to an implicit
`unspecified -> allowed` branch.

This is a release-validation task, not an owner product question. Until the
table and its source review are complete, normalization runs in audit mode and
hard enforcement is not promoted. We do not hide a legal assumption inside a
catch-all `unspecified -> allowed` branch.

### Manual edges and reviewed overrides

Every source feature in `data/manual-base-edges.geojson` must explicitly state
its forward and reverse bicycle traversal state. The current 80 manual source
features receive a one-time audit and migration. Until reviewed, a missing value
normalizes to `unknown` and the edge is excluded. It blocks promotion of any
route that depends on it, but does not delay the global Road 99 correctness
cutover if the affected route is withdrawn/display-only.

OSM corrections or exceptions live in a separate reviewed override registry.
V1 supports whole-source-way overrides only, keyed by `{osmWayId,
sourceGeometryDigest}` and interpreted relative to source-way orientation.
Every registry entry must match exactly one current source way; zero or multiple
matches block promotion. A partial-way exception must be represented by a
source correction or explicit manual edge rather than a fragile atomic slice
ID.

Manual features are keyed by stable `manualEdgeId` plus a geometry digest, so a
changed shape forces re-review. An allowing override requires:

- the two directional states;
- a human-readable rationale;
- evidence/source reference;
- review date; and
- the exact source identity/digest above.

The build trace records whether each result came from OSM, the default ruleset,
manual authoring, or an override. No runtime UI can create an override.

## Routing asset contract

This is a semantic schema change, not merely an extra optional field.

- CycleWays base-overlay schema: `1 -> 2`;
- public `cw-base-index` schema: `1 -> 2`;
- base-routing source schema: `2 -> 3`;
- routing-shard schema: `1 -> 2`;
- compact shard format: `2 -> 3`;
- shard-manifest schema: `1 -> 2`; and
- independent traversal-policy ID and digest.

Overlay V2 stores the logical endpoints and two alignment dispositions. Public
CW index V2 expands every accepted realization to canonical directed share-ID
references and retains `{segmentId, alignmentKey}`. Runtime base edges carry
separate forward and reverse CycleWays segment memberships; the old undirected
`cwSegmentIds` field is migration-only and never drives V3 cost.

Compact V3 stores each direction's traversal state, small reason code, and
direction-scoped CW membership. The manifest and every shard carry the same
policy ID/digest. The decoder exposes its compact format and semantic policy
metadata.

Build emits a directional-alignment display artifact with one `LineString` per
accepted alignment, a unique render ID, and the shared logical segment ID. The
existing logical `bike_roads` feature remains one object per segment for browse,
content, and compatibility; it is not navigation geometry. Web and mobile use
the alignment artifact for selected-detail arrows and use route traversal
geometry for route preview/navigation. This avoids changing existing
LineString-only logical-segment consumers into accidental routing authorities.

Build also emits a tiny routing-contract identity that foreground and headless
navigation can load without loading routing shards. Its
`routingContextDigest` binds only the semantic routing substrate:

- graph, source, shard, compact, and policy versions/digests;
- CycleWays overlay, public index, directional-display content, and the
  immutable legacy V1 CW expansion table used for old tokens;
- the append-only/non-reused edge-share-ID registry schema and content digest.

Route attestations embed this `routingContextDigest`. A separate
`releaseBundleDigest` binds the routing context plus catalog route sources,
featured/precomputed snapshots, a canonical immutable release-index payload,
and their raw artifact hashes. Its canonical preimage excludes the digest field
itself, `generatedAt`, and the mutable current-pointer manifest. The bundle
digest verifies an atomic release but is not embedded inside the snapshots it
hashes, avoiding a self-reference and avoiding navigation interruption when
only unrelated content changes. Promotion writes immutable assets/release index
first and replaces the current pointer last.

Every semantic digest is computed from canonical content with volatile fields
such as `generatedAt`, filesystem paths, and packaging offsets excluded. Raw
artifact hashes may include those bytes for download/integrity checks. Review
evidence, token identity comparison, and route attestation use semantic digests;
cache URLs and bundle integrity may use artifact hashes. A policy-valid shard
may not be combined with a stale CycleWays expansion or registry even when its
file downloaded successfully.

Promotion builds featured/precomputed snapshots strictly from the staged
manifest/catalog/assets, with no fallback to old public snapshots. Snapshot or
integrity failure aborts before public pointers change. Immutable artifacts and
the release index are copied first; the mutable current manifest pointer is the
last atomic write.

### Immutable share-ID meaning

An edge share ID is a durable semantic reference, not an alias for the current
`e{osmWayId}_{sliceIndex}` string. The released registry binds every numeric ID
to a canonical identity descriptor containing:

- source kind and stable source ID (`osmWayId` or `manualEdgeId`);
- source-geometry digest;
- ordered source-range start and end anchors;
- ordered graph endpoints and coordinate orientation; and
- the fraction basis used by route tokens.

The range anchors use source node IDs where available and canonical quantized
coordinates otherwise. Adding an intersection, changing a split boundary,
reversing source orientation, or changing source geometry therefore changes
the descriptor. It must allocate a new monotonically increasing share ID. The
old ID is tombstoned and is never rebound or reused; optional successor links
are recovery hints only and cannot authorize exact replay.

Every promoted build compares its proposed registry with the previous released
registry. Rebinding an existing ID, omitting a required tombstone, allocating
without the previous high-water mark, or publishing without that prior-registry
comparison blocks promotion. Registry snapshots and their digests are retained
per released graph version so an old token's identity can be compared with the
current descriptor.

An ordinary build reads the released registry and writes a staged proposal; it
does not mutate released identity history as a side effect. Promotion advances
the registry only after comparison/review. Legacy V6's 32-bit graph-version hash
maps through a collision-checked release registry to exactly one historical
registry digest; a missing or ambiguous mapping cannot prove identity. Runtime
`graphVersion` becomes the canonical semantic routing/graph digest, never
`generatedAt`.

Promotion persists the proposed registry history/high-water mark before the
current manifest pointer changes, and the routing contract names that exact
digest. A later promotion failure never rolls the registry back or reuses its
allocations; unused IDs remain reserved/tombstoned. This small amount of wasted
ID space is preferable to making a historical token ambiguous.

The first release of this contract bootstraps descriptors from the previous
shipped graph and records that graph as the historical baseline. For a legacy
V6 token from a different graph version, exact replay is allowed only when both
historical and current registries exist and prove every referenced descriptor
identical. Missing history, a tombstone, or any ambiguity rejects exact replay.
V4/V5 may then use their coordinate recovery; V6 has no coordinate fallback and
returns unavailable for that anchor. A matching share number alone is never
identity proof.

V1/V2 compact shards may remain decodable for fixtures and explicit developer
compatibility, but their missing traversal policy decodes as unknown. All
production planning, restore, sharing, connector/rejoin, and navigation paths
refuse policy-less assets; none interprets missing data as two-way.

The overlay V1 reader exists only to generate the editor migration proposal.
It wraps the old flat sequence into the orientation whose endpoints match, and
marks the other direction `needs_review`; it never invents a reverse mapping.
An enforced build requires overlay V2 and public index V2. Legacy public-index
decoding may preserve token diagnostics, but a V1 segment expansion is not
navigable until its directed references are validated and attested under the
current policy.

Existing V6 route tokens encode a CycleWays span as a logical segment ID plus a
`reversed` bit, so they cannot name a distinct second alignment. One separate,
immutable V1 expansion table—frozen with its graph/source/index digests—is the
sole authority for decoding those spans. Public index V2 never substitutes one
of its alignments for that historical sequence. The manifest names the legacy
table, its digest participates in `routingContextDigest`, and web and mobile bundle /
load it with the rest of the routing contract. Missing or mismatched legacy data
fails exact expansion closed; recovery may proceed only from independently
recoverable anchors.

Historical anchor recovery preserves authored route intent, not merely the
first and last coordinate of each old token. The compatibility archive stores
the historical coordinates of the token's original route points plus
conditional shaping points for spans whose released traversal was a deliberate
detour. Recovery first replans the original points on the current policy graph.
It activates a detour only when a still-current CycleWays segment named by that
span is missing from the resulting traversal; retired segment IDs do not force
obsolete geometry. This keeps ordinary routes editable and compact while
preserving deliberate visits such as Sovev Dafna's #335 → #246 → #247 spur.
All recovered geometry remains review-required until encoded and accepted as a
current-graph route.

An old V6 span expands against the frozen sequence (or its requested exact
reverse) and then passes normal identity, direction, and policy validation; the
compatibility mapping never makes a forbidden reverse valid. New V6 sharing may
use the compact CycleWays span only when the current traversal is byte-for-byte
the frozen legacy sequence or its policy-proved exact reverse. A distinct or
changed alignment is encoded as ordinary directed base-edge spans, and sharing
preserves semantic waypoint and turnaround boundaries. A future V7 may add an
alignment key for better compression, but a token bump is not a correctness
dependency.

Shard merging rejects:

- mixed source, shard, compact, or policy versions;
- a shard whose policy digest differs from the manifest; and
- duplicated boundary edges whose canonical routing record differs. Equality
  covers edge/share IDs, the immutable identity descriptor, endpoint order,
  coordinate order, length/fraction basis, every cost-critical field, traversal
  states/reasons, and policy metadata. This protects the meaning of
  forward/reverse as well as permission.

During web transition, immutable paths publish
`shards-v2/<digest>/...` and `shards-v3/<digest>/...`. The manifest exposes
separate `compactV2` and `compactV3` entries. An enforced client requests
`compactV3` through a strict loader mode: missing V3 is an asset failure and
never downgrades to V2, JSON, MessagePack, or the manifest default.

The correctness cutover points the versioned current routing manifest at V3
and replaces the legacy mutable manifest with an unsupported/V3 contract so an
online stale reader fails closed instead of continuing to fetch V2. Cache and
manifest versioning plus immutable URLs prevent reuse of old web assets; this
repository has no service worker. Mobile code and bundled assets ship together;
an already installed old binary necessarily retains its old offline behavior
until updated, a deployment limitation the release cannot misrepresent as
remotely fixed.

## Runtime enforcement points

The central verdict is applied defensively at every boundary below.

1. **Network merge / adjacency:** project base policy plus accepted V2
   direction ownership into one effective traversal state, then add only
   effective-allowed forward and reverse entries.
2. **Traversal cost:** reject an effectively prohibited, conditional, or
   unknown traversal before planner cost, connector cost, uphill cost, or
   endpoint exceptions.
3. **CycleWays preference and attribution:** read CycleWays membership for the
   actual traversal direction. A segment's accepted alignment in the other
   direction cannot reduce cost, increase CycleWays distance, create a segment
   span, or satisfy a CycleWays-only route constraint.
4. **Partial endpoints:** filter non-allowed start-to-node and node-to-target
   options independently.
5. **Same-edge route:** validate the actual anchor-fraction direction.
6. **Dijkstra reconstruction:** revalidate materialized traversals even though
   adjacency was already filtered.
7. **Exact V4 replay and V5/V6 expansion:** validate every full and partial
   stored traversal, connectivity, direction count, endpoint edge, and finite
   cost before committing manager state.
8. **Connector and rejoin:** evaluate the same effective traversal permission
   before connector eligibility. Accepted directed V2 membership may provide
   CW precedence; `snapAnyEndpoint` may alter preference but never permission.
9. **Effective-route transformations:** clipping, reverse, alternate starts,
   loop rotation, approach composition, and rejoin preserve/split the attested
   traversal signature; no synthetic geometry-only seam is accepted.
10. **Final route assembly:** validate the complete directed traversal list
   before producing navigable geometry, sharing it, or enabling Start.

Every failure has a stable diagnostic shape:

```js
{
  code,
  stage,       // asset-load | snap | search | exact-replay | replan |
               // final-validation | reverse | opposite-direction |
               // return-leg | resume | connector | rejoin
  policyId,
  policyDigest,
  edgeShareId, // optional
  direction,   // optional
  recoverable,
  details      // diagnostic only; never rendered directly
}
```

At minimum codes distinguish:

- `traversal-prohibited`;
- `traversal-conditional`;
- `traversal-unknown`;
- `routing-policy-mismatch`;
- `routing-context-mismatch`;
- `routing-bundle-mismatch`;
- `routing-attestation-mismatch`;
- `routing-coverage-unavailable`;
- `route-intent-unrecoverable`;
- `route-proposal-stale`;
- `no-permitted-path`;
- `reverse-not-allowed`;
- `opposite-direction-unavailable`; and
- `return-path-unavailable`.

User-facing Hebrew/English copy is owned by the app's localization layer and
selected from `code + stage`; raw edge/tag details remain diagnostics.
`no-permitted-path` means no path in the modeled and fully available graph, not
proof that no real-world route exists.

The existing fallback that restores previous segment names after failed
recalculation must not preserve a stale route as navigable state.

## Snapping and coverage

Hard enforcement makes the current single preferred snap more visible: a point
may snap to the CycleWays-owned but wrong-direction carriageway while a nearby
allowed edge exists. The frozen ride coordinates include an anchor directly on
Road 99 edge 370 while the permitted parallel carriageway is roughly 9 m away.
Rejecting edge 370 without considering that nearby candidate would be safe but
would fail to recover the rider's clear intent.

The correctness planner therefore includes a minimum bounded candidate-state
search; this is not deferred to optional quality tuning. It will:

- retain up to four candidates per waypoint (hard implementation maximum six);
- preserve the input's existing snap threshold for a new user click;
- limit V4/V5 coordinate recovery and V6 resolved-anchor alternatives to 30 m;
- score geometric displacement explicitly; and
- use dynamic programming over adjacent-leg candidate pairs so one chosen
  candidate serves both legs at a via point.

Edges with no allowed direction are excluded from candidates. A one-direction
edge remains a candidate because a route may leave or approach it in its allowed
direction, but candidate feasibility is evaluated for the direction of each
adjacent leg. At a via point, the selected candidate must satisfy both adjacent
legs. Repeated coordinates are independent waypoint occurrences: when the user
adds the start as a new endpoint, the return occurrence may legitimately snap
to the opposite carriageway rather than reuse the outbound anchor. Route
failure never relaxes the traversal policy.

CycleWays preference remains a soft component of candidate cost and cannot make
displacement free. The route result records whether each chosen candidate came
from a user-click coordinate, a V4/V5 fallback coordinate, or an extant V6 edge
anchor. No recovery silently widens the source-specific displacement limit.

Likewise, failed recalculation cannot assume the initially loaded shard envelope
contains the permitted detour. Shard build marks every boundary node whose full
incident edge set is not present and lists the missing neighboring shard IDs.
Dijkstra returns the visited unloaded frontier, not only `null`. Each retry
loads the missing frontier shards with the lowest target-distance lower bound,
then continues/restarts under explicit round, shard, edge, and byte budgets.

Search may return `no-permitted-path` only when it exhausts a connected
component without reaching an unloaded frontier. Reaching the budget with an
unloaded frontier returns `routing-coverage-unavailable`; it never returns the
forbidden route.

The initial four-candidate bound and joint via-point feasibility are part of the
correctness release. Later recovery-quality work may tune candidate count and
distance weights within the hard bound and improve frontier expansion budgets;
those settings are not new permission semantics.

## Shared-route restore

Exact replay remains first because valid directed references should not be
unnecessarily replanned. Restore uses a non-mutating `plan -> validate ->
commit` transaction and returns:

```js
{
  status: "exact" | "replanned" | "unavailable",
  snapshot,                // RouteSnapshot for exact/replanned; otherwise null
  failure,                 // typed failure for unavailable; otherwise null
  provenance: { tokenVersion, graphVersionMismatch, anchorSources },
  requiresReview           // true only for replanned
}
```

`requiresReview` is true for a replacement. A route URL first enters a pending
restore state that disables Start and suppresses any unrelated existing route.
On success, commit replaces it. On failure, the requested token remains the
active unavailable intent; the previous planner route is accessible only
through an explicit “Return to previous route” action and never silently
reappears as if it were the opened link.

Restore then proceeds atomically:

1. load policy-compatible shards;
2. resolve the token's edge references and actual partial directions;
3. validate the entire exact route;
4. commit it only if every traversal is allowed;
5. otherwise resolve available anchors to coordinates and recalculate with
   current multi-candidate snapping and bounded shard expansion; and
6. commit the replacement only after final validation.

Exact replay and recalculation are evaluated into temporary results. Manager/UI
state changes only at the final commit, so a failed replacement cannot leave a
partially restored line behind. The transaction is a non-mutating candidate API
or a temporary manager; `restoreFromPoints()` may not clear/mutate the live
manager during planning. The sharded session and full-network restore paths use
the same recovery contract.

Recovery resolves each anchor independently:

1. use its current edge/fraction when that edge still resolves and its canonical
   identity is current or proven unchanged from the token's graph version;
2. otherwise use its embedded V4/V5 coordinate within the recovery displacement
   limit; and
3. fail that anchor when neither exists.

An extant edge anchor and embedded coordinate are compared for drift and the
drift is reported; a large drift forces coordinate recovery/review rather than
silent exact replay. The full-network path must try current-edge resolution for
V6 instead of requiring coordinates the token does not contain.

For V6, an edge with proven identity continuity can supply an anchor coordinate
even if its stored traversal direction is now prohibited. If identity continuity
cannot be proved or the edge is missing, the token has no coordinate fallback
and recovery ends with `route-intent-unrecoverable`.

A historical token's graph version is never the sole rejection condition.
Proven-stable current edge identities plus actual current-policy validation
decide exact replay; the mismatch is returned in provenance and telemetry.

A successful replacement shows a persistent planner notice: “This route was
updated to follow current mapped riding directions. Review it before starting.”
The Start action is the rider's acknowledgement; an opened link never begins
guidance automatically.

## Route attestation and effective transformations

Every navigable source and effective route carries one deterministic
attestation:

```json
{
  "schemaVersion": 1,
  "validationContext": {
    "graphVersion": "...",
    "policyId": "il-bicycle-v1",
    "policyDigest": "...",
    "routingContextDigest": "..."
  },
  "traversals": [[370, 0, 65535]],
  "transform": {
    "direction": "forward",
    "startMode": "official",
    "startFraction": 0,
    "loopMode": "linear"
  },
  "intent": {
    "derivation": "curated-alignment",
    "waypointOccurrences": ["canonical requested/selected anchor records"],
    "legBoundaries": ["traversal end index plus ordinary/return purpose"]
  },
  "source": {
    "type": "curated-alignment",
    "segmentId": 174,
    "alignmentKey": "aToB",
    "mappingDigest": "..."
  },
  "reverseCapability": {
    "policyAllowed": false,
    "productAllowed": false,
    "productReason": "opposite-alignment-differs"
  },
  "geometryDigest": "...",
  "contentFingerprint": "...",
  "exactReverseAllowed": false,
  "forwardAllowed": true
}
```

Each traversal tuple is `[edgeShareId, fromFractionQ, toFractionQ]` with
fractions quantized to `0..65535`. Geometry longitude/latitude is quantized to
integer microdegrees. Canonical serialization uses fixed field order, array
order as route order, UTF-8, and SHA-256. `geometryDigest` hashes the normalized
coordinate list; `contentFingerprint` hashes the traversal tuples, transform,
canonical waypoint occurrences and leg boundaries, source provenance, reverse
capability, and geometry digest.
Generated occurrence IDs are not hashed; canonical requested coordinates,
selected anchors, boundary indices, and leg purposes are. This keeps
`A -> B -> A` distinct from an unstructured line with the same geometry and
prevents sharing/restoration from erasing a turnaround. `derivation` is one of
`planned`, `curated-alignment`, `exact-reverse`, `opposite-replan`,
`return-extension`, or `restore-replan`. Global graph/policy identity stays in
`validationContext`, not in the content fingerprint.

A navigation snapshot additionally stores `navigationPlanFingerprint`. It
hashes the route content fingerprint, maneuver-generator version, and the full
canonical generated cue plan: stable cue IDs, order, kinds, route offsets,
trigger parameters, road-name/text arguments, and every other input that can
affect cue selection or speech. It is deliberately separate from route content:
identical geometry does not imply identical junctions or guidance. The snapshot
also records the source generator version for diagnostics, but that stored value
is never treated as the current version.

Clipping or loop rotation splits the tuple containing the start point. Reverse
reverses tuple order and swaps every tuple's fractions. Geometry is rebuilt
from the transformed tuples and then hashed. This makes alternate start,
reverse, and loop behavior auditable without retaining opaque internal edge
objects.

Headless resume requires the stored validation context to equal the bundled
routing-contract identity and recomputes both deterministic fingerprints from
the persisted attestation, geometry, cue plan, and **current bundled**
maneuver-generator version. It never recomputes against only the persisted
source version. It does not speak or restore guidance when either fingerprint
is missing or mismatched. Foreground resume rebuilds the cue plan after any
validation-context or maneuver-generator change. If route content is unchanged,
tracker progress may be preserved. `mainCueKey`, `voiceMemory.spokenIds`, and
other cue state may be preserved only when the rebuilt navigation-plan
fingerprint also matches.

## Exact reverse, opposite-direction planning, and return legs

These are three different operations and neither product wording nor internal
APIs may conflate them:

1. **Exact reverse** reverses the current traversal list without searching.
   `exactReverseAllowed` is true only if reversing traversal order and every
   full/partial direction remains allowed. Editorial one-way metadata may
   further restrict it but may not widen it.
2. **Plan the opposite direction** reverses the ordered waypoint occurrences
   and runs a new directed search. It produces a separate draft, a new
   attestation, and `requiresReview: true`; it is not the same saved route
   reversed. A curated standalone segment may seed this intent from its
   accepted opposite alignment, but arbitrary routes still use graph search.
3. **Return to start** preserves the committed outbound route, appends a new
   occurrence of the first requested waypoint, and plans a fresh directed final
   leg. It may use the other CycleWays alignment, a permitted non-CW detour, or
   fail without changing the existing route.

The Return action is shown only when the first occurrence is recoverable and
the last requested occurrence is not already that same return target. Internal
zero-length traversal bookkeeping remains valid, but the UI does not append a
redundant zero-length return.

For `derivation: curated-alignment`, graph permission alone does not manufacture
the missing CycleWays direction. Exact reverse is product-allowed only when the
reversed traversal sequence is also the currently accepted opposite alignment
(including a proved `reverseOf`). If the opposite slot is unavailable or uses a
different explicit sequence, Reverse is disabled and the UI offers that accepted
opposite direction or a separately reviewed generic opposite plan. Generic
user-built routes use traversal permission alone; catalog/editorial metadata may
still restrict them. Internally, attestation records both the policy proof and
the product-source restriction that produced the final
`exactReverseAllowed`.

“Close as a loop” follows the same rule as a return leg: plan a real graph path
from the current endpoint to the start. It never appends a geometric chord.
Only call a route “out-and-back” when the return actually reverses its outbound
traversals; a parallel carriageway or different corridor is a return route or
round trip.

Each requested point is a waypoint occurrence with its own stable occurrence
ID, requested coordinate, selected edge/fraction anchor, displacement, and
provenance. Consecutive occurrences define directed legs with a purpose such as
`ordinary` or `return`. Repeating coordinate A in `A -> B -> A` creates a new A
occurrence that may snap to a different nearby carriageway. The interior B
occurrence has one selected anchor shared by its incoming and outgoing legs;
switching carriageways there requires a real permitted graph connection and
cannot teleport across the median.

The commands use `plan -> validate -> commit`. While a return or opposite route
is being planned, the existing route remains committed, shareable, and
navigable. A successful materially different candidate is previewed before it
replaces or extends the route. `return-path-unavailable` leaves the old route
and fingerprint unchanged; coverage exhaustion remains distinguishable from a
proven no-path result.

Every asynchronous candidate binds the committed content fingerprint on which
it was based plus a monotonically increasing request generation. Dragging or
removing a point, resetting, or starting another command cancels/supersedes the
older request. Accept commits only when both bindings still match; a late result
returns `route-proposal-stale` and cannot overwrite newer state. Cancel/dismiss
leaves the original route unchanged. Start is never available on the
noncommitted candidate.

Ride setup, `createRidePlan`, effective-route construction, and restored
selection state enforce the exact-reverse value. A forged or stale reverse
selection returns `reverse-not-allowed`; it is not silently changed to forward
or replanned. The existing pure geometry reversal remains usable for
synthetic/display purposes, not consumer navigation without an attestation.

Web and mobile expose the same shared-core operations. Route arrows and labels
identify outbound and return legs; a changed return explains that a different
road is used because the outbound line cannot be ridden in reverse. When no
permitted return is found, copy says the existing route was not changed. The
ambiguous Reverse control is enabled only for exact reversal; user-built routes
with recoverable coordinates may separately offer “Plan the opposite
direction” or “Return to start.” A catalog route replanned through a different
corridor becomes an editable draft and does not inherit its editorial identity
automatically.

## Navigation start, persistence, and resume

A validated route snapshot carries the attestation above.
`NavigationRoute.canNavigate` requires it for every consumer-navigation route.
Catalog, manual, CycleWays-only, restored, and legacy geometry must resolve to
directed traversal evidence under the current policy or remain display-only.

The active-navigation store moves from schema V1 to V2 and persists that
attestation plus the navigation-plan fingerprint. The current resume window is
short, so the migration favors a simple fail-closed rule over projecting stale
progress onto a changed route:

- V1 active records never resume their old session or speak further cues. A
  migration strips the tracker/voice snapshot, stops background updates, and
  retains a small interrupted-route descriptor when its route parameter,
  waypoints, or destination can be recovered.
- Headless processing refuses a missing or mismatched validation context,
  content fingerprint, or navigation-plan fingerprint before creating a
  navigation session or speaking. It records one interruption reason for the
  next foreground rather than letting guidance disappear silently.
- Foreground resume rebuilds and revalidates the route on current assets, then
  compares the content fingerprint rather than only the token-derived route ID.
- Matching route content may restore tracker progress even if an unrelated
  graph rebuild changed validation context. It restores `mainCueKey`,
  `voiceMemory.spokenIds`, and the rest of cue memory only when the rebuilt
  navigation-plan fingerprint also matches.
- When route content matches but the navigation-plan fingerprint differs or is
  absent, the foreground rebuild preserves projected tracker progress but
  discards old cue/voice memory. It initializes the new cue state at that
  progress, expires already-passed cues without speaking them, and permits only
  the current or next newly generated cue to fire.
- A content mismatch after revalidation discards the old session snapshot,
  returns the route to the planner, and asks the rider to review/start again;
  old cues cannot fire.

Matching-context records still use the existing hot/warm resume policy. A
missing attestation or validation-context mismatch overrides hot auto-resume
until foreground revalidation completes. If content remains identical, the
normal resume policy may continue with the cue-state fingerprint rule above;
otherwise the next foreground shows a persistent “navigation was interrupted
because this route requires review” notice and the recoverable route intent.
Orphaned background updates and audio are stopped in the migration and mismatch
paths.

This rare update boundary may interrupt a ride, but continuing directions on
unvalidated geometry is worse. Automatic mid-ride projection onto a changed
route can be designed later with explicit remaining-waypoint state.

## Build audit and promotion gates

The audit report records:

- per-direction counts by state, reason, raw tag value, highway class, and
  source;
- all unsupported, conditional, and conflicting values;
- all explicit and implied one-way edges;
- all manual features lacking reviewed direction/access;
- every CycleWays-owned one-way edge and every CycleWays access conflict;
- the frozen V1 mapping and consumer baseline for every logical CycleWays
  segment;
- counts and IDs by migration class, alignment disposition, candidate origin,
  and invalidation reason;
- every segment with ambiguous endpoints, a missing direction disposition, an
  invalid accepted alignment, or a direction-scoped ownership conflict;
- directional capability, endpoint drift, continuity, length ratio, lateral
  offset, road-class exposure, and source/mapping digest of each alignment;
- equality between each accepted public alignment sequence, its directional
  edge memberships, and its directional-display geometry;
- every featured/catalog/shared fixture that exact replay rejects;
- replan outcome, distance change, road-class exposure change, and shard
  expansion for the route corpus.

Current-data checks must include the 75 CycleWays-owned explicit one-way edges,
34 CycleWays-owned roundabout-implied edges, and the currently restricted
CycleWays-owned edge. These are review queues, not automatic instructions to
copy CycleWays membership onto a parallel carriageway.

The V1 overlay contains 309 accepted flat mappings while the released public
index exposes 284. `map-source.properties.status` is the lifecycle authority:
284 mappings belong to active segments and 25 belong to deprecated split
archives. The 25 remain only in the frozen V1 overlay/audit snapshot; because
they were not in the released public index, they are not added to the legacy
token expansion table. They receive no V2 direction slots or runtime
membership. The same archives account for the current duplicated directed edge
keys; there are no active-to-active overlaps in this baseline. The migration
audit asserts those facts as `archived_overlap` versus
`active_ownership_conflict` rather than silently filtering them. It then tracks
every active logical segment from its frozen source through one of: two
accepted directions, one accepted plus one reviewed-unavailable direction, or
an explicit withdrawal/display-only decision. Automatic candidate failure
never creates an `unavailable` disposition; only curator review does.

Promotion is blocked when:

- an active routing build consumes overlay V1, public index V1, or undirected
  `cwSegmentIds` preference;
- an `active + navigable` logical segment has `needs_review`, a missing direction
  disposition, or an accepted alignment whose evidence no longer matches the
  graph, policy, source geometry, or mapping digest;
- an `active + navigable` segment has no accepted alignment, including
  `unavailable/unavailable`;
- the public index, directional edge membership, and alignment-display asset
  disagree;
- an unsupported/conflicting edge participates in a promoted route or accepted
  CycleWays direction;
- a catalog/featured route still offered for navigation cannot restore or
  replan under the policy (it may instead be explicitly withdrawn/display-only);
- a migrated historical route omits any of its referenced CycleWays segments
  that still exists in the current directed index;
- shard/policy versions are mixed;
- a route fixture contains a non-allowed traversal; or
- the correctness review queue contains any unresolved item.

The queue includes every newly unavailable corpus route, every shard-budget
exhaustion, every increase above configured distance/road-exposure thresholds,
and every promoted route whose CycleWays share drops above its configured
threshold. Each item records the before/after metrics, map inspection, and an
explicit accept/fix/withdraw rationale. Curation priority is Road 99 and the
supplied ride, currently offered navigation routes, invalid current mappings,
one-way/access/manual queues, asymmetric opposite candidates, and then the
remaining network. Before correctness cutover, all currently offered
navigation routes and Road 99 need a disposition; promotion may proceed with
other logical segments only when both of their slots have a reviewed
disposition and they do not leave an unresolved runtime consumer. Threshold
values are tuning configuration recorded with the report, not hidden test
constants.

## Validation

### Normalization fixtures

- `oneway=yes|1|true`, `no|0|false`, and `-1`;
- roundabout-implied forward and explicit override;
- `junction=circular` without an invented implication;
- `oneway:bicycle=yes|no|-1` precedence;
- `cycleway=opposite*` conflict reporting without an invented exception;
- general, bicycle-specific, and directional access precedence;
- prohibited, conditional, and unsupported values;
- manual authoring and reviewed override provenance; and
- source-way orientation preserved across graph splits.

### Runtime fixtures

- deterministic and idempotent overlay V1-to-V2 migration without inventing an
  unavailable disposition;
- ambiguous logical endpoints and source/mapping digest invalidation;
- an ordinary symmetric segment whose second alignment is a proved
  `reverseOf`, an asymmetric divided-road segment with two explicit sequences,
  and a reviewed one-direction-only segment;
- direction-scoped ownership conflicts and public-index / runtime-membership /
  display-artifact equality;
- exact accepted-alignment construction in both directions, proving `bToA`
  expands its own sequence and never reverses `aToB`;
- a policy or edge change invalidating only the affected alignment;
- forward and reverse full-edge traversal;
- all four partial start/target directions;
- allowed, prohibited, conditional, and unknown traversal states at every
  traversal-producing boundary;
- same-edge routes whose token direction disagrees with anchor fractions;
- zero-length endpoint traversal;
- default, connector, rejoin, and connector `snapAnyEndpoint` paths;
- connector/approach/rejoin attestation retention and geometry-only beeline
  rejection;
- exact V4 and expanded V5/V6 replay;
- V1–V3 intent-only replan, V4/V5 missing-edge coordinate recovery, and
  sharded/full-network V6 anchor recovery;
- transactional restore rollback while an unrelated planner route exists;
- final validation catching a deliberately injected invalid traversal;
- compact V3 round trip, strict V3-unavailable failure without downgrade,
  V1/V2 unknown semantics, mixed-version rejection, and conflicting duplicate
  boundary records including reversed orientation;
- deterministic content fingerprints after clipping, reverse, and loop
  rotation;
- graph-unbacked 1–25 m loop seam rejection;
- bounded candidate selection across parallel carriageways, including a
  repeated start coordinate selecting a different return anchor while an
  interior via point cannot jump between carriageways;
- unloaded-frontier exhaustion versus a proven no-path component;
- geometry-only featured/legacy routes remaining display-only;
- valid and invalid exact reverse selection, opposite-direction replanning with
  a new attestation, and transactional return-to-start success/failure;
- return via a permitted detour, and no-return failure leaving the committed
  route fingerprint unchanged;
- legacy V6 CycleWays expansion rejecting a forbidden reverse, new asymmetric
  V6 sharing as directed base spans, and preservation of waypoint/turnaround
  boundaries;
- matching logical-segment selection, arrows, availability copy, and exact
  route geometry on web and mobile;
- current routing-contract mismatch in headless processing; and
- headless and foreground resume with missing, matching, and mismatched
  attestations.

### Real-route acceptance

The July 13 ride token is a permanent regression fixture.

- Exact replay must reject its reverse traversal of Road 99 edge 370.
- Its 11 recovered waypoint coordinates are frozen separately. Coordinate
  replanning must contain zero non-`allowed` traversals, consider the permitted
  parallel carriageway even for the anchor that lies exactly on edge 370, and
  reproduce the rider's intent without inheriting the invalid token geometry.
  The replacement receives an explicit visual accept/fix decision; otherwise
  it returns a typed failure and never retains edge 370 in reverse.
- Both isolated travel directions through the Road 99 corridor are reviewed on
  the map as segment 174 alignments. A third coordinate fixture plans an
  outbound plus return route through the corridor, uses real graph connections
  between carriageways, and contains zero non-`allowed` traversals.
- Segment 174 renders as one logical segment on overview surfaces and two
  physical directional lines on detail surfaces; either line opens the same
  segment identity.
- Any change to the previously successful field section enters the review queue
  with a recorded accept/fix decision.
- After visual acceptance, freeze the replacement traversal fingerprint and a
  simulator-accepted token. Its cue geometry then becomes the baseline for the
  separate crossing/maneuver design.

The broader corpus compares before/after availability, detour ratio, CycleWays
distance, car-road exposure, and coverage expansion. Large changes require map
review; they are not automatically accepted merely because every traversal is
permitted.

## Rollout sequence

1. Add the normalizer, versioned policy artifact, manual/override schema, and
   audit report without changing production routing.
2. Freeze the V1 overlay/index and route corpus, add overlay/index V2 plus the
   idempotent migration report, and build the editor's offline Direction Review
   workspace. Do not overwrite or publish the V1 data during proposal work.
3. Make the matcher direction- and policy-aware. Migrate each existing mapping,
   generate only draft opposite candidates, and curate Road 99 first. Resolve
   currently offered route conflicts or explicitly withdraw/display-only the
   affected route; other active navigable segments still require two reviewed
   dispositions before they can publish membership.
4. Emit the complete policy-bound asset set: public CW index V2, directional
   alignment geometry, base-routing V3, compact V3 / shard V2, strict manifest,
   immutable share registry, and direction-scoped CycleWays membership.
5. Build the runtime correctness boundary: the central verdict at every path,
   traversal-backed geometry, minimum four-candidate snapping, strict shard /
   asset consistency, atomic restore, deterministic attestation, exact-reverse
   gating, return/opposite planning, and active-store V2 migration.
6. Add shared web/mobile alignment presentation, endpoint-oriented direction
   labels, transactional “Return to start,” and separate exact-reverse versus
   opposite-direction controls.
7. Rebuild and review the historical token, frozen coordinate route, both Road
   99 directions, the Road 99 return composition, and every offered navigation
   route. Complete the prioritized network curation queue and close all
   correctness promotion gates.
8. Promote enforced code and the complete policy-bound assets together. Invalid
   routes may fail closed or be withdrawn; no old undirected membership reader
   participates in navigation.
9. Tune candidate weights/counts within the hard limit and improve the initial
   frontier-selection and expansion budgets, then close the broader
   recovery-quality corpus queue.
10. Regenerate the accepted ride route and write the road-crossing maneuver
    design against that policy-valid line.

Only crossing semantics is serialized behind the regenerated route. Camera
padding easing, duplicate-vertex cleanup, guarded same-turn merging, and
via-point spur handling from the ride discussion may be designed and tested in
parallel because their correctness does not depend on choosing a carriageway.

## Decisions settled by this design

- Hard traversal permission precedes every route preference.
- Build time, not the app, interprets source tags.
- Per-direction state is four-valued; consumer routing uses only `allowed`.
- Shared tokens preserve intent, not forbidden historical geometry.
- Consumer navigation has no restriction override.
- Phase 1 routes riding only; walking-required and unevaluated conditional
  access are excluded.
- A full-edge, direction-specific published V2 alignment grants reviewed CW
  precedence over base explicit-access `prohibited` or `conditional`; drafts, legacy
  membership, partial coverage, and `unknown` do not.
- One logical CycleWays segment has two independently reviewed directional
  alignment slots; divided carriageways do not create duplicate product
  segments by themselves.
- CycleWays membership, preference, attribution, and sharing are scoped to the
  actual directed alignment traversal.
- Current CycleWays mappings are revalidated and curated through a resumable
  editor migration; an automatic candidate is never silently published.
- When a legacy segment's current authoring mapping differs from the frozen V1
  compatibility mapping, Direction Review proposes the current mapping as an
  `authoring-v1-revision`. Refresh adopts that proposal only over untouched
  automatic drafts; accepted, unavailable, and manually edited V2 decisions
  remain protected.
- Missing legacy shard policy is unknown, not two-way.
- Exact reverse is permitted only when derived from current traversals.
- Opposite-direction and return-to-start actions are new directed planning
  transactions; failure preserves the committed route.
- Minimum multi-candidate snapping is part of correctness wherever parallel
  carriageways make the nearest single snap directionally wrong.
- Old/mismatched active navigation does not resume stale guidance.
- The ordered default ruleset and current-data audits are release gates, not
  unresolved product questions for the owner.

## Source semantics references

- [OSM `oneway` key](https://wiki.openstreetmap.org/wiki/Oneway)
- [OSM `oneway:bicycle` key](https://wiki.openstreetmap.org/wiki/Key%3Aoneway%3Abicycle)
- [OSM `junction=roundabout`](https://wiki.openstreetmap.org/wiki/Tag%3Ajunction%3Droundabout)
- [OSM bicycle/access overview](https://wiki.openstreetmap.org/wiki/Bicycle)
