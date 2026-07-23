# Navigation Way Names Design

**Date:** 2026-07-15
**Last reviewed:** 2026-07-23
**Status:** Forward-navigation vertical slice implemented; second review
(2026-07-23) relaxed the named-way structure invariant, replaced route-level
legacy fallback with per-span degradation, required reverse-ready guidance,
moved the long-run confirmation off the final-phase call, and deferred
route-only map labels. Data, planner, editor, and snapshot rollout ready for
implementation
**Related designs:** `bicycle-traversal-policy`, `network-editor-workflow`,
`network-junctions`, `route-sharing-v4`, `waypoint-routing`,
`segment-name-display`, `front-page-overhaul`, `rn-mobile-native-ui`,
`turn-by-turn-improvements`, and `nav-ui-redesign`

## Summary

CycleWays currently uses one segment `name` as all of the following:

- a globally unique editor/build key;
- the label for an exact curated section of geometry;
- the map hover/focus identity;
- the route's ordered segment description;
- the current/next road name in navigation;
- the name spoken in turn and continue instructions.

Those roles no longer fit together. A CycleWays segment is an internal
editorial and routing unit: it owns geometry, quality, warnings, POIs, and a
stable numeric ID. A rider instead thinks in terms of a continuous named road,
trail, cycleway, promenade, or a recognizable standalone feature such as a
bridge.

This design introduces a separate **guidance identity** without removing or
renaming internal segments. Every active segment is explicitly classified as
one of:

1. a member of a continuous **named way**;
2. a **standalone named feature**;
3. an **intentionally unnamed** connector or section.

Missing classification means “not reviewed yet” during migration; it is not a
fourth production role. Named-way membership is therefore optional. An
unreviewed span degrades exactly like an intentionally unnamed one: facility
class fallback, and never the internal segment name. Guidance naming therefore
improves route by route as classification progresses instead of waiting for a
whole-network switch. After full rollout, required-mode validation makes
classification mandatory for every active segment.

The route keeps two parallel views of the same traversal:

- exact **segment spans** retain internal ownership, quality, POIs, warnings,
  and diagnostics;
- rider-facing **guidance spans/runs** provide names and continuity for map
  presentation, route summaries, turn cues, current-road UI, and voice.

Internal boundaries inside the same named way become invisible to navigation.
They remain available when the user inspects or expands a route section.

## 2026-07-23 implementation-readiness re-review

The central decision remains valid: segment identity and rider-facing way
identity need to be separate. The repository now contains a real
forward-navigation vertical slice, not only supporting infrastructure:

- `data/navigation-ways.json` contains eight pilot named ways;
- 11 of 291 active source segments are explicitly classified (10 named-way
  members and one standalone feature);
- Build resolves source membership plus registry naming into each generated
  `segments.json` record;
- the route manager retains complete direction-scoped exact memberships and
  derives route-distance `guidanceSpans`;
- route state, forward clipping, loop rotation, progress, cue decoration,
  current/next-way presentation, voice wording, and identity-based dedupe
  understand `guidance-v1`; and
- reviewed road-crossing maneuvers are decorated by the destination guidance
  identity instead of being replaced by a competing name-transition cue.

That slice is intentionally conservative. A route containing any unreviewed
CycleWays segment receives `guidanceMode: "legacy"` and no partial guidance
span list. Reverse effective routes also fall back to legacy because their
opposite-direction memberships have not yet been freshly resolved. The
2026-07-23 second review below replaces both of those fallbacks.

The current public `segments.json` has not been rebuilt/promoted with the pilot
classifications, featured-route snapshot schema 1 still drops exact and
guidance spans, and the route-catalog projection also drops guidance spans.
The planner has no route-run itinerary. The standalone pilot is not yet the
required `גשר עינות ירדן` bridge case. These are rollout gaps, not reasons to
replace the implemented model.

This revision incorporates the architectural facts that now exist:

- routing uses policy-bound, direction-scoped CycleWays alignment memberships;
- published network junctions are on-network but road-name-less spans with a
  separate landmark name;
- the public network map combines logical segment overview geometry, accepted
  physical alignment geometry, and non-segment-interactive junction geometry;
- current route sharing uses V6 graph anchors, with historical anchor recovery
  followed by current-policy replanning when exact replay is unavailable;
- Promote publishes the map, route catalog, and featured-route snapshots as
  one hash-bound release bundle and switches the public manifest last;
- reviewed crossing maneuvers have their own route-local evidence and remain
  the authority for crossing instructions; and
- the developer-only navigation demo studio can replay a real route state with
  junctions and crossings, so it is a useful acceptance harness for
  naming/crossing composition.

The guidance layer must be built on those contracts. It must not restore the
old assumptions that a segment has one undirected physical path, that every
on-network span is a segment, that map identity is a visible name, or that
featured snapshots can be promoted independently of the map release.

### Design correction: no second runtime naming asset

The earlier revision proposed a separately loaded public
`navigation-ways.json`. The implemented build makes that unnecessary and the
proposal is withdrawn.

`data/navigation-ways.json` remains the canonical authoring registry.
`data/map-source.geojson` remains the canonical membership owner. Build joins
them once and emits a self-contained resolved `guidance` record inside each
`segments.json` entry. Web, native, the editor's live route runtime, and
featured-route generation already load `segments.json`; adding another mutable
runtime lookup would introduce an avoidable mixed-version failure.

The `segments` hash in `map-manifest.json` is therefore the guidance-data hash.
Build additionally publishes a small guidance summary in the build report and
manifest—schema version, enforcement mode, coverage counts, and
`coverageComplete`—but no second naming file. Consumers derive in-memory
segment-ID and way-ID indexes from the loaded segment records.

### 2026-07-23 second review: corrections carried into this revision

A second review checked the design's invariants against the real network and
the implemented navigation code. Seven corrections follow; each is applied in
the relevant decision below.

1. **The named-way connectivity invariant was too strict.** Requiring one
   connected component with member degree at most two is a topological rule
   applied to a naming concept. Checked against the 46 multi-member way groups
   proposed for the real network, five fail it, and two of those fail on
   branching that no junction evidence can repair: `שבילי אגמון החולה`
   (member degree 4) and the Banias trail group (degree 3). Those are exactly
   the recognizable facilities the feature exists to name. Multiple components
   and branching become acknowledged warnings. A separate, review-required
   facility-separation check targets the real hazard: a way absorbing a
   different parallel facility in the same corridor. It is not an unconditional
   geometry ban, because dual carriageways and two-sided cycleways can
   legitimately be one rider-recognizable facility.
2. **Route-level all-or-nothing naming was the wrong fallback.** Falling back
   to legacy makes one unreviewed connector restore internal editorial speech
   for a whole route, which is the behavior this design exists to remove.
   Unreviewed spans now degrade to facility class exactly like intentionally
   unnamed spans.
3. **Reverse routes should not fall back to legacy.** The reversed route
   attestation already carries per-slice opposite-direction CycleWays
   membership, so reverse guidance is derivable at route construction time.
   The live route must retain a reverse-ready resolved projection; the current
   pure reverse transform does not have the segment-guidance index needed to
   resolve an asymmetric return leg later. Out-and-back is the most common ride
   shape, and a forward leg named by way with a return leg named by internal
   segment is worse than either alone.
4. **A long-run confirmation must not be appended to an imminent maneuver.**
   The initial release places the distance confirmation in the preview
   utterance only, never in the final-phase call.
5. **Route-only map labels are deferred out of the first release.** They are
   the costliest and least certain part of the planner work, the base map
   already labels major roads, and the itinerary is the authoritative readable
   list.
6. **Featured snapshots store the derived itinerary, not both span families.**
   Featured pages intentionally load without the heavy routing/segments assets,
   and navigation already starts by restoring the catalog's V6 route token.
   Their public snapshot is therefore a version-bound presentation cache, not
   an alternative navigation route model.
7. **Presentation and risk-detector constants must be shared and
   fixture-tested.** The confirmation horizon was already a named constant;
   connector folding and the material-parallel-corridor detector must also be
   deterministic because web/native parity and editor/build validator parity
   depend on them.

## Goals

- Speak and display the road or facility name a rider recognizes, rather than
  an internal section label.
- Prevent segment splits and editorial boundaries from creating false
  “continue” or “enter segment” guidance.
- Keep exact segment identity available for editing, quality, warnings, POIs,
  map inspection, and compatibility.
- Support roads and trails made of many sequential segments, including
  `כביש 99` and `דרך הפטרולים`.
- Keep the actual road, a parallel cycleway, and other facilities in the same
  geographic corridor as distinct guidance identities.
- Support named standalone connectors such as `גשר עינות ירדן` without
  pretending that they belong to either adjoining way.
- Support intentionally unnamed connectors with honest facility-class
  fallbacks.
- Keep clean visual names separate from optional iOS-oriented audible names
  that may contain Hebrew pronunciation punctuation.
- Bootstrap classification with reviewable, confidence-ranked suggestions
  rather than requiring every segment to be classified from a blank form.
- Give web and native planning surfaces one shared route-itinerary model while
  respecting their different interaction patterns.
- Allow an additive migration without breaking old route links or immediately
  replacing the current name-keyed site data model.

## Non-goals

- Renaming, deleting, or making current segment names non-unique.
- Changing segment geometry, routing topology, quality ownership, or POI
  ownership.
- Automatically accepting named ways inferred by stripping suffixes such as
  locality names or split numbers from current names. Name patterns may inform
  a review suggestion, but never become canonical without approval.
- Treating every feature that mentions road number 99 as the same facility.
- Making named ways route-sharing identities. Existing stable segment/base-edge
  identities remain authoritative for route replay.
- Rebuilding Mapbox's general-purpose road-label layer.
- Full multilingual naming in the first version. The schema leaves room for a
  future localization layer, but the initial canonical name is Hebrew.
- Solving OSM names/refs for every non-CycleWays base edge in the first release.
- Turning the public planner into a segment editor or exposing technical IDs as
  primary UI.

## Vocabulary

### Segment

A stable CycleWays editorial unit with a numeric ID, source geometry, quality,
warnings, POIs, and an existing globally unique `name`. The current name stays
available as the editor label and compatibility key.

### Named way

A rider-recognizable facility composed of one or more CycleWays segments, for
example:

- `כביש 99`;
- `דרך הפטרולים`;
- `שביל האופניים לאורך כביש 99`;
- `טיילת עמי`.

A named way has a stable identity independent of its display name. Its mapped
members commonly form a chain or ring, but may contain reviewed gaps, parallel
directional alignments, or branches when riders still recognize them as one
facility. A route may traverse only the directions allowed by current routing
policy; way membership does not imply connectivity or bidirectional access.

### Standalone named feature

A named traversable feature that connects ways but is not itself a member of
either one. `גשר עינות ירדן` is the reference example. Its guidance identity is
the exact stable segment ID rather than a reusable named-way ID.

### Intentionally unnamed section

A connector or section for which CycleWays has no rider-recognizable proper
name. It may still have a facility kind such as `bridge`, `connector`, `road`,
`dirt-road`, `trail`, or `path` and can use that kind as a presentation
fallback.

### Section label

Optional rider-friendly context for an exact segment inside a named way, such
as `שאר ישוב–בריכות הדגים` or `קיבוץ שמיר צפון`. A section label is useful in
planning and warning disambiguation but is not spoken as the road name.

It is explicitly curated. The build must not derive it by subtracting the way
name from the current internal name.

### Audible name

An optional pronunciation-oriented form stored as `spokenName`. The display
`name` remains clean and unpunctuated; `spokenName` may contain Hebrew niqqud,
maqaf, commas, or other punctuation needed for iOS speech synthesis. It is
never displayed.

Every rider-facing named entity uses the same pair:

- a named way stores `name` and optional `spokenName` in the registry;
- a standalone named segment stores `name` and optional `spokenName` in its
  `guidance` record; and
- an exact/internal segment may have an optional segment `spokenName` only for
  legacy or exact-section speech. It never overrides the enclosing named
  way's audible name.

If `spokenName` is absent, voice uses `name`. Audible text is presentation
metadata: it never affects identity, grouping, route search, map labels,
sharing, or analytics.

### Physical alignment

A reviewed, direction-scoped realization of one logical CycleWays segment on
the base graph. A segment may have one shared bidirectional trace or different
`aToB` and `bToA` traces. Alignment keys and mapping digests are routing and
diagnostic evidence; they do not create separate rider-facing way identities.

### Network junction

A published, bounded set of legal movements between CycleWays arms. Its
internal edges are CycleWays network infrastructure but are not a road or
corridor. A junction may have a public landmark name such as `צומת רגר`, yet
its internal route span remains road-name-less and carries the landmark only as
context. A network junction is not a `standalone` guidance feature.

### Guidance span

An ordered distance range on a computed route with one resolved guidance
identity and current facility semantics. It is derived from base-edge
traversals and CycleWays memberships, not from the route's unclipped list of
selected segments.

### Route run

One contiguous occurrence of a guidance identity in a particular route. A
route that leaves and later rejoins Road 99 has two Road 99 runs. Runs drive
route summaries, featured-snapshot itineraries, and — when they are eventually
built — route-only map labels. They are never globally grouped by visible name.

## Decision 1: Keep segment identity and guidance identity separate

The current segment `name` remains globally unique and continues to support the
existing editor, generated `segments.json`, name-keyed joins, and compatibility
paths. The stable numeric segment `id` remains the durable identity.

The new guidance layer is additive. Public and runtime consumers receive both:

| Field family | Answers | Typical consumers |
| --- | --- | --- |
| Segment identity | Which exact curated section is this? | editor, quality, POIs, warnings, map focus, diagnostics |
| Guidance identity | What does the rider call the facility being followed? | planning itinerary, map labels, navigation UI, voice |
| Facility semantics | What kind of surface/facility is under the rider now? | styling, fallback copy, condition cues |

The current shared map representation already puts stable segment IDs on both
logical overview and physical alignment features, and route-building hit tests
already return that ID. All new guidance lookup, exact focus, and whole-way
highlighting therefore use stable segment ID. Existing name-keyed hover/filter
adapters may remain temporarily for legacy callers, but repeated guidance text
must never enter those filters.

## Decision 2: Canonical named-way registry plus explicit segment roles

Keep the implemented canonical `data/navigation-ways.json` registry. IDs are stable opaque
strings: readable IDs such as `road-99` are acceptable, but no runtime behavior
derives identity from the string or from the display name.

Conceptual registry shape:

```json
{
  "schemaVersion": 1,
  "enforcement": "migration",
  "ways": {
    "road-99": {
      "name": "כביש 99",
      "kind": "road",
      "ref": "99",
      "aliases": [],
      "spokenName": null,
      "structureReview": {
        "acknowledgedIssueFingerprints": []
      }
    },
    "patrol-road": {
      "name": "דרך הפטרולים",
      "kind": "dirt-road",
      "aliases": [],
      "spokenName": null
    }
  }
}
```

The registry does not duplicate segment membership. Each active source
GeoJSON feature owns its classification in `properties.guidance`.

`structureReview` is optional. It never contains a broad `allowBranching` or
`allowParallel` switch. Each fingerprint is produced by the shared validator
from the issue code, affected stable member IDs, and the relevant
geometry/topology evidence digests. A changed member, alignment, junction, or
geometry therefore produces a new issue fingerprint and requires fresh review.

Named-way member:

```json
{
  "role": "named-way",
  "wayId": "road-99",
  "sectionLabel": "שאר ישוב–בריכות הדגים"
}
```

Standalone named feature:

```json
{
  "role": "standalone",
  "name": "גשר עינות ירדן",
  "spokenName": "גֶּשֶׁר עֵינוֹת יַרְדֵּן",
  "kind": "bridge"
}
```

Intentionally unnamed connector:

```json
{
  "role": "unnamed",
  "kind": "connector"
}
```

The production role enum is exactly `named-way`, `standalone`, or `unnamed`.
An absent `guidance` object means unreviewed during migration. Once migration
is complete, promotion rejects an active segment without a valid role.

The current pilot registry/source data proves the record shape but not
whole-network readiness. It contains eight ways and covers 11 of 291 active
segments. Its single standalone classification is a navigation pilot; the
bridge semantics are not accepted until the real `גשר עינות ירדן` case is
classified and exercised.

### Why the role must be explicit

A nullable `wayId` alone would conflate three different situations:

- a deliberately standalone named bridge;
- a deliberately unnamed connector;
- a segment nobody has reviewed yet.

Those cases need different UI, speech, and validation. An explicit role makes
the fallback deterministic and makes migration completeness measurable.

### Named-way invariants

- Every referenced way ID exists in the registry.
- Every active segment has at most one guidance role and one named-way
  membership.
- Active members of a named way should form one connected logical component,
  and that component should be a non-branching chain or ring. Neither is a
  blocking requirement. A real facility is often mapped as several disjoint
  pieces, and a named trail network, promenade, or perimeter road legitimately
  branches. Multiple components and member degree above two are reported as
  warnings that a curator acknowledges once per way; the acknowledgement is
  recorded by exact issue fingerprint so a later unintended change re-raises
  the warning.
- Materially parallel members of one way trigger a
  `parallel-facility-risk` review issue even when they meet at one end. The
  shared detector uses a corridor distance, minimum overlap, and heading
  tolerance; it does not fire merely because two lines cross or briefly run
  close. This directly catches the risk of `כביש 99` absorbing
  `שביל אופניים 99`.
- Independently, authoritative source/routing evidence is mapped to broad
  facility classes such as roadway, protected cycleway, and trail/path.
  `facility-class-conflict` is a non-waivable blocker when a member is
  incompatible with the way kind. Surface alone (`paved` versus `dirt`) is not
  a facility class, and a bridge may carry the enclosing facility.
- An unresolved `parallel-facility-risk` is a blocker in both migration and
  required modes. The curator resolves it by removing/reassigning the different
  facility, or by acknowledging the exact issue fingerprint with evidence that
  the compatible members are one rider-recognizable facility, such as two
  carriageways of the same road. A `facility-class-conflict` cannot be
  acknowledged. Geometry raises the review question but cannot decide facility
  identity.
- Directional legality is validated separately.
- Splitting one real facility into several way IDs solely to satisfy a
  structural check is a defect, not a workaround. Two way IDs with the same
  display name are two facilities to every downstream consumer: they produce
  two itinerary rows, a spoken destination name at the seam, and no voice
  duplicate suppression between them.
- Member adjacency comes from reviewed topology: accepted direction-scoped
  alignment terminals and, where applicable, published network-junction arm
  attachments and legal movements. Source endpoint equality is a migration
  fallback for a legacy or unmatched member, not the preferred authority.
- A junction can connect consecutive members of a way without becoming a
  member of that way. Proximity, centroid order, and equal visible text never
  create adjacency.
- Two different way IDs may share a visible name, but they are never merged by
  name alone.
- A way can contain one segment. A single-segment way is valid when the segment
  is conceptually a road/trail rather than a connector structure.
- `sectionLabel` is optional and need not be unique.
- `spokenName`, when present, changes TTS pronunciation only; visual UI keeps
  using `name`.
- `kind` describes the named facility and does not replace exact per-edge or
  per-segment surface/road-class data.

### Audible-name rules

- `name` is the canonical display form and contains no pronunciation-only
  punctuation or niqqud.
- `spokenName` is optional. It may contain Unicode combining marks and
  punctuation that improve iOS pronunciation; the build must preserve them
  exactly rather than normalize them away.
- Named-way navigation uses the way's `spokenName` consistently across all
  member segments. A member segment's legacy `spokenName` cannot override it.
- Standalone navigation uses the standalone guidance record's `spokenName`.
- Legacy/exact-segment speech may use a segment-level `spokenName`; this field
  does not create a guidance identity and is never shown in the planner.
- Voice falls back to `name` when the audible form is absent.
- `spokenName` is added only after the clean display form has been heard on a
  device and found wrong. Speech engines already read Hebrew digits, and a
  hand-written expansion such as
  `כביש תשעת אלפים תשע מאות שבעים וארבע` replaces engine behavior with a long
  fixed string that cannot improve later. Prefer `null`; the default assumption
  is that the display form is correct until a recording proves otherwise.
- Validators reject pronunciation-only marks in display names and reject an
  empty or control-character-containing audible form.
- Web/native visual tests assert that `spokenName` never leaks into labels,
  cards, exports, or share text. iOS speech-preview checks are the acceptance
  authority for pronunciation.

The initial controlled kind vocabulary is `road`, `cycleway`, `dirt-road`,
`trail`, `promenade`, `bridge`, `connector`, `path`, and `other`. Adding a kind
requires presentation fallback copy and an icon decision; source data does not
accept arbitrary new strings silently.

### Split and archive behavior

Splitting an active member segment copies its `named-way` membership to both
active children. The editor marks copied section labels for review because the
new children may need more specific labels. The deprecated parent preserves
its old guidance metadata for diagnostics but is excluded from active-way
connectivity validation.

A standalone named feature is one logical active segment in the initial
schema. Splitting it requires an explicit resolution before promotion: keep it
as one logical segment, or introduce a grouped named facility in a later schema.
The editor must not silently create multiple independently named standalone
features from one bridge or connector.

## Decision 3: Model bridge semantics, not bridge exceptions

Bridges have three valid interpretations:

1. **A bridge carrying an existing named way.** The bridge segment remains a
   member of that way. Its bridge name can be the member's `sectionLabel` or a
   POI/landmark. Navigation continuity does not break.
2. **A named bridge connecting two ways.** It uses `role: standalone`, as with
   `גשר עינות ירדן` between `טיילת עמי` and `ירדן מערב כפר בלום`.
3. **An unnamed bridge or connector.** It uses `role: unnamed` with
   `kind: bridge` or `kind: connector`.

The same model can later cover tunnels, ferries, gates, underpasses, and short
named passages without adding one-off boolean fields.

Reference classifications:

| Current segment | Guidance role | Rider-facing identity |
| --- | --- | --- |
| `כביש 99 שאר ישוב` | named-way → `road-99` | `כביש 99` |
| `כביש 99 בריכות דגים` | named-way → `road-99` | `כביש 99` |
| `דרך הפטרולים גבעת האם` | named-way → `patrol-road` | `דרך הפטרולים` |
| `שביל אופניים 99 דפנה` | named-way → separate cycleway ID | cycleway name, never `כביש 99` |
| `גשר עינות ירדן` | standalone / bridge | `גשר עינות ירדן` |
| unnamed farm connection | unnamed / connector | facility-class fallback only |

## Decision 4: Preserve exact segment spans and add guidance spans

`segmentSpans` remains the compatibility name for the exact route-distance
index, but the list now has to describe three cases: segment ownership,
network-junction membership, and off-network traversal. It must not collapse a
direction-scoped membership set to its first segment.

```text
exact route span
  startMeters / endMeters
  networkRole: segment | junction | null
  segmentMemberships[] { segmentId, alignmentKey, mappingDigest }
  junctionMemberships[] { junctionId, fingerprint, junctionName }
  segmentIds[]
  segmentId / internalName (only when exactly one segment is authoritative)
  junctionId / junctionName (only when one junction is authoritative)
  onCycleways
  routeClass / surface context
```

The existing `cwSegmentId`, `name`, and `onNetwork` fields can remain as
temporary aliases. A singular segment alias must be null when multiple accepted
memberships cannot be reduced without loss. Exact warning, POI, quality, and
diagnostic association uses stable IDs and distance ranges, not that alias.

A separate derived `guidanceSpans` list is added:

```text
guidance span
  startMeters / endMeters
  networkRole: segment | junction | null
  resolutionStatus: resolved | unnamed | unreviewed | junction | off-network | conflict
  role (named-way | standalone | unnamed, for segment spans only)
  guidanceIdentity
  wayId (named-way only)
  name (resolved visual name, nullable)
  spokenName (nullable override)
  kind
  segmentIds[] / sectionLabels[]
  junctionId / junctionName (context only)
  onCycleways
  routeClass / surface context
```

`guidanceIdentity` is stable and never equal to display text:

- `way:<wayId>` for a named way;
- `standalone:<segmentId>` for a standalone named feature; and
- `null` for intentionally unnamed, junction, off-network, unreviewed, or
  conflicting spans.

Adjacent traversal pieces merge into a guidance span only when guidance
identity, resolution status, network role, junction context, and current
facility semantics match. For planner summaries, compatible child spans with
the same non-null identity can form one higher-level route run even when exact
surface or class changes. The child spans remain attached so the UI can show
mixed surfaces, junction context, and warnings honestly.

### Direction-scoped and multiple memberships

The current base graph carries `cwAlignments.forward/reverse` membership
records with segment ID, alignment key, and mapping digest. Guidance resolution
must inspect every membership for the actual traversal direction:

- if all memberships resolve to the same guidance identity, the traversal is
  guidance-unambiguous and retains every exact segment ID;
- if they resolve to different identities, validation reports a structured
  conflict rather than choosing array position zero; and
- until corrected, runtime uses a conservative facility-class fallback and
  does not speak either conflicting name.

A conflicting span still carries a usable `kind`. When the conflicting
memberships agree on a facility kind, that kind is retained; otherwise the kind
is derived from the traversal's route class. A conflict span with a null name
and a null kind has nothing to fall back to, which turns a data problem into
silent navigation.

### Unreviewed spans degrade; routes do not

An unreviewed span is presented exactly like an intentionally unnamed one: no
proper name, facility-class fallback, no cue at its boundaries, and never the
internal segment name. It is distinguished from `unnamed` only by
`resolutionStatus`, which feeds validation and coverage reporting rather than
rider-facing copy.

A route is therefore never demoted as a whole because one member is unreviewed.
This replaces the earlier route-local atomicity rule. The concern that motivated
that rule — one route mixing two naming systems — is addressed more directly by
never emitting an internal segment name in any mode: a partially classified
route mixes named spans with class-fallback spans, which is the same mixture a
fully classified route already contains wherever it crosses an intentionally
unnamed connector.

The practical consequence is that classification pays off incrementally. Every
reviewed group improves the routes that traverse it on the next build, instead
of every route waiting for whole-network coverage.

`guidanceMode` remains frozen into a computed route and its navigation plan, so
an asset refresh mid-session cannot change naming semantics. It now records
which guidance schema the route was resolved against, not whether naming was
switched on for that route.

Schema support is explicit input to route construction, taken from the
manifest-bound guidance context. It is never inferred from whether this
particular route happened to contain a classified segment. Thus a route built
from a v1 migration asset is `guidance-v1` even when every traversed segment is
still unreviewed, while an old manifest/segments pair with no guidance schema is
`legacy`.

The feature switch is a separate, frozen presentation policy. Disabling named
ways on a new client produces class-only guidance from the same v1 spans; it
does not restore internal segment speech. `legacy` exists only as an
old-data/old-state compatibility marker. Newly generated navigation cues retire
generic `enter-segment` wording in every mode, and incompatible persisted cues
are regenerated or discarded.

Legacy undirected `cwSegmentIds` may be read only through the existing
compatibility path. New guidance logic must not turn that fallback into the
authority for a current V3 route.

### Network-junction spans

A direction-scoped `cwJunctions` membership makes a span part of CycleWays even
when it has no segment membership. Such a span has `networkRole: junction`,
`onCycleways: true`, no guidance identity, and optional `junctionId` and
`junctionName` landmark context.

If a valid traversal carries both segment membership and junction context, as
with a junction in the middle of one logical segment, `networkRole` remains
`segment` and the segment guidance identity remains current; junction evidence
is retained only as context.

The same precedence protects staged connector migration: while a connector
segment is still active, its explicit guidance role remains visible. It becomes
a junction-only, no-row span only after the segment is deprecated and route/
share/navigation parity has passed under the network-junction design.

The junction span is retained exactly but does not become an itinerary row or
a fake unnamed segment. If the route enters and exits on the same guidance
identity, the route run may bridge across the junction while retaining the
junction child span. If the identities differ, the junction remains contextual
space between the two runs; topology decides the maneuver and the destination
way supplies the “onto” wording. A junction name may decorate that maneuver as
a landmark but never becomes the current road name.

A published junction in the middle of one logical segment does not split that
segment's guidance continuity. Starting or ending inside a junction may show
location context such as the junction landmark, but still does not create a
way identity. Conflicting simultaneous junction memberships are validation
errors rather than first-membership wins.

### `onCycleways` is independent of naming

The new model separates CycleWays membership, guidance-name availability,
network role, and facility class. A CycleWays segment can be intentionally
unnamed; a network junction is on CycleWays but road-name-less; and an
off-network base road may eventually have a reviewed name without becoming a
CycleWays span.

### Route transformations and restoration

Clip-to-start and rotate-loop transforms apply the same distance remapping to
exact and guidance spans. Approach and rejoin legs derive their own context from
their own traversals. No transform rebuilds identity from visible names.

A reverse route reverses distance ranges but resolves their contents from the
opposite-direction memberships, never by reversing forward names or assuming
that the physical memberships are symmetric. Falling back to legacy naming for
the return leg is not acceptable: out-and-back is the most common ride shape,
and a ride whose outbound leg says `כביש 99` while its return leg says
`כביש 99 שאר ישוב` is worse than either behavior applied consistently.

Reverse attestation already carries opposite segment membership, but the
current pure effective-route transform does not carry the segment-guidance
index, and the attestation does not carry opposite direction-scoped
`cwJunctions`. Route construction therefore resolves and stores two paired live
projections while it still has the edge evidence:

- `segmentSpans` plus `guidanceSpans` for the traversed direction; and
- `oppositeSegmentSpans` plus `oppositeGuidanceSpans` from the reverse
  direction's segment and junction memberships.

When the per-slice stable segment-ID sets are symmetric, the implementation may
derive the second projection by remapping the first. When any slice is
asymmetric, it resolves the opposite pair while the route manager still has the
guidance index and direction-scoped junction data. Reversing swaps the pairs and
remaps their distance ranges, so reversing twice is lossless. Clip and loop
transforms apply the same operation to all four span lists.

An unresolved opposite membership becomes a class-fallback span, never an
internal name. Direction-sensitive reviewed crossings are a separate safety
projection: reverse navigation must recompute or safely transform them from
reviewed evidence, and must not silently erase them by assigning
`crossings: null`.

Guidance metadata is not added to V6 route URLs or traversal attestation.
Exact current-graph replay and historical-anchor recovery continue to use
stable base-edge/segment evidence; a current-policy replan then derives current
guidance from its new traversal. Effective navigation plans and persisted cue
state carry `guidanceMode`, the map version, and the manifest `segments` hash
when they need compatibility provenance. The segments hash already covers the
resolved guidance projection; a second guidance digest is unnecessary.
Incompatible old cue state is regenerated or discarded rather than replaying
stale segment-name speech.

## Decision 5: Guidance semantics depend on topology plus identity

Names do not decide whether a maneuver exists. Junction topology, route
geometry, and accepted traversal evidence continue to decide whether the rider
must turn, keep, cross, or continue. Guidance identity supplies the wording.

| Route event | Visible/spoken behavior |
| --- | --- |
| Internal segment boundary within the same named way | No cue; current way remains unchanged |
| Real decision while staying on the same named way | Maneuver may say “הישארו על כביש 99” or equivalent |
| Turn from one guidance identity to another | “פנו … אל <new name>” |
| Straight transition to a different named way with no decision | Current-way UI updates; no fake turn and normally no voice |
| Enter a named standalone bridge | “חצו את גשר עינות ירדן”; merge with a coincident turn when necessary |
| Exit a standalone bridge | Speak only if the exit contains a real decision |
| Pass through a junction and remain on the same way | Keep the same current way; use junction context only when a real decision needs it |
| Pass through a junction onto a different way | The maneuver names the destination way and may identify the junction as a landmark |
| Enter an intentionally unnamed or unreviewed span | Use a kind/class fallback only when useful; never speak the internal name. The two are indistinguishable to the rider |
| Surface/safety change inside one named way | Separate condition cue; never model it as a road-name transition |

The current generic `enter-segment` cue is replaced by guidance-aware events.
A named-way boundary alone does not require speech. Standalone named features
may produce semantic context cues such as `cross-feature`, with copy selected
by `kind`.

### Named-way confirmation and distance semantics

The removal of generic `enter-segment` cues does not remove useful reassurance
on long quiet sections. Navigation adds a distinct, guidance-aware
`continue-on-way` confirmation. It is based on a stable guidance identity and a
real route-instruction horizon, never on an internal segment boundary or the
remaining length of one editorial segment.

A confirmation may be emitted in exactly these situations:

- route start or mid-route acquisition on a resolved named way when no route
  choice is imminent;
- immediately as additional wording on a real maneuver that enters a different
  named way and is followed by a long quiet run; or
- after a straight identity transition only when a later product policy opts
  into that extra verbosity. The initial policy updates the current-way UI
  silently for this case.

Reacquisition may name the current way (`חזרנו למסלול, ממשיכים על …`) but does
not repeat a long-run distance unless the effective route or guidance horizon
changed. Internal segment boundaries, junction-only boundaries, surface
changes, and warning ownership boundaries never create confirmations.

The confirmation distance is measured from the confirmation point to the next
route-choice maneuver or arrival: turn/keep, roundabout, reviewed crossing, or
destination. Informational hazards may interrupt speech without shortening the
route-choice horizon. If the next choice is less than 300 m away, the initial
policy omits the distance confirmation and lets normal maneuver preview own the
guidance. This threshold is one shared, fixture-tested product constant.

Distance speech uses navigation rounding rather than measurement precision:
roughly 50 m increments below 1 km and 0.1 km increments at or above 1 km.
When a maneuver already names the destination way, the distance is appended to
that utterance (`פנו … אל שביל תל חי, והמשיכו עליו 1.5 קילומטר`) and no second
confirmation cue competes with it. At start/acquisition the independent wording
is `המשיכו על <name> במשך <distance>`.

The appended distance belongs to the **preview** utterance, not to the
final-phase call. A rider hearing the imminent instruction is executing the
maneuver; the final call must stay short. At a realistic 25 km/h, the appended
clause adds several seconds of speech that would still be playing well past the
turn. The initial implementation attaches it only to the preview announcement
(`בעוד 200 מטר, פנו … אל שביל תל חי, והמשיכו עליו 1.5 קילומטר`). If no preview
was emitted, omit the distance rather than inventing a post-maneuver event.

A future dedicated, one-shot post-maneuver confirmation may replace that
omission, but it requires its own event/dedupe contract. The final-phase call
always carries the maneuver and destination way only. This applies to every
maneuver type that can carry a destination way, including reviewed crossings
and roundabouts, whose final-phase copy is already the longest in the system.

The cue carries `guidanceIdentity`, visual `name`, optional `spokenName`,
`horizonMeters`, and a reason (`route-start`, `join-route`, or
`entered-by-maneuver`). Voice duplicate suppression keys by identity plus the
effective route-choice horizon. A different facility with the same visible name
is not suppressed, while two internal sections of one way cannot repeat the
instruction.

A standalone `bridge` produces one low-priority, final-phase `cross-feature`
cue at its entrance. A coincident turn/crossing absorbs the bridge wording so
the rider does not receive two competing instructions. The bridge context cue
must never mask a maneuver. Other standalone kinds remain itinerary/current-
facility context until that kind has explicit guidance copy.

Network-junction spans never produce a generic `enter-feature` event merely
because the route crossed the junction boundary. Existing roundabout and
reviewed crossing cues remain their own topology and safety authorities.
Guidance decorates those cues with the before/after way and optional
`junctionName`; it does not replace, duplicate, or suppress them.

### Name fallback order

1. Reviewed named-way or standalone visual/spoken name.
2. Future reviewed OSM road name or road reference.
3. Facility class such as `דרך עפר`, `שביל`, `כביש`, or `גשר`. Intentionally
   unnamed, unreviewed, and conflicting spans all land here; a conflicting span
   derives its class from route class when its memberships disagree on kind.
4. Generic `המשך במסלול`.

The class fallback copy and its icons are one platform-neutral table shared by
web, native, and voice. Nothing may reach step 4 because step 3 had no data.

The internal segment name is not a fallback in any mode.
A junction landmark name is optional maneuver/location context and is not
inserted into this current-road fallback chain.

### Current-road presentation

- Named way: show its name. Add a class/surface badge only when it adds useful
  information; avoid redundant copy such as `כביש 99 · כביש`.
- Standalone feature: show its name with an appropriate kind icon/label.
- Network junction: keep the preceding/following way when continuity is known;
  otherwise show a neutral facility/location state, optionally with the
  junction landmark as secondary context.
- Unnamed span: show the best facility-class fallback.
- Next-road context uses the next different guidance identity, not the next
  internal segment.

This design supersedes the “current segment” semantics in `nav-ui-redesign`.
The visual chip remains, but it becomes a current **way/facility** chip.

## Decision 6: One shared planner itinerary model

Core derives a platform-neutral route itinerary from guidance spans. Web and
React Native render the same ordered run model:

```text
route run
  id (route-occurrence identity, not way ID)
  startMeters / endMeters / distanceMeters
  role / guidanceIdentity / wayId
  name / kind
  surfaceClasses[]
  segmentIds[]
  sectionLabels[]
  junctionContexts[]
  entryJunctionContext (when a different-way transition precedes the run)
  warningCount / poiCount
  hasMixedSurface
```

The occurrence ID includes the route-distance occurrence, so leaving and later
re-entering a way creates two selectable rows even though both reference the
same way ID.

Itinerary rules:

- Consecutive segments in the same named way produce one collapsed row.
- Standalone named features always receive a row, even when short, because
  they are recognizable landmarks.
- Network-junction spans never receive a fake facility row. They remain exact
  contextual children: they can bridge one same-way occurrence, or attach as
  entry context to the following run and decorate the associated maneuver when
  the before/after identities differ.
- Short unnamed connectors without warnings or meaningful condition changes are
  visually folded between neighboring rows. “Short” is one shared,
  fixture-tested constant, `ITINERARY_FOLD_MAX_M`, not a per-surface judgement:
  web and native parity tests compare row lists, so an undefined threshold makes
  parity untestable. The same applies to unreviewed runs.
- A material unnamed or unreviewed run, or any such run with warnings/POIs,
  receives a fallback row such as `מקטע מקשר` or `דרך עפר`.
- Expanding a run shows exact sections, their distances, quality/conditions,
  and warnings.
- Expansion never exposes archived parents.
- Internal IDs/names are available only in an editor/debug detail, not normal
  planner copy.

Public stats stop presenting “number of CycleWays segments” as a meaningful
route metric. Segment count can remain in diagnostics; distance, elevation,
surface mix, warnings, and itinerary are rider-facing.

## Web planning presentation

### Network browsing before a route is built

The shared CycleWays network keeps its existing representation handoff:

- logical source segments provide overview geometry at lower zoom;
- accepted physical alignments provide directional detail at higher zoom; and
- published junction footprints remain visible but non-segment-interactive.

Logical and physical features for one segment resolve through the same stable
segment ID. An alignment key can remain in diagnostics and route-point snapping
but does not appear as a separate rider-facing section. The network does not
render every internal or guidance name as persistent map text.

Mapbox's base labels remain the general road-label source. CycleWays provides
the authoritative on-demand detail card when a user hovers or focuses an exact
network section.

### Segment hover/focus card

The existing editorial card keeps exact-segment metrics and POI chips but
changes its information hierarchy.

Named-way member:

```text
כביש
כביש 99
קטע: שאר ישוב–בריכות הדגים
<exact section distance / elevation / quality / POIs>
```

Standalone feature:

```text
גשר
גשר עינות ירדן
<exact feature metrics / warnings>
```

Intentionally unnamed section:

```text
מקטע מקשר
דרך עפר
<exact section metrics / warnings>
```

The card must not lose information relative to today. A curated internal name
such as `כביש 99 שאר ישוב` currently distinguishes one hovered section from its
neighbour; a card titled `כביש 99` with no subtitle does not. Whenever a
named-way member has no `sectionLabel`, the card derives a subtitle from exact
data rather than showing the way name alone:

1. an unambiguous named endpoint, junction, or section POI when available;
2. otherwise facility class/surface plus exact section length and warning
   count.

“Position along the way” is not a valid general fallback because branched and
multi-component ways have no canonical start. Deriving a subtitle by
subtracting the way name from the internal name remains forbidden; this is a
presentation fallback, not curated data. `sectionLabel` remains optional.
Validation may recommend it for a particular ambiguous or safety-relevant
section, but does not create a blanket chore for every member of a multi-member
way.

Hovering either the logical overview or one physical alignment opens the same
logical segment card. A published junction footprint does not fabricate a
segment card. The exact segment remains strongly highlighted in the currently
visible representation. Other members of the same named way are not
automatically highlighted on every hover because a long way can dominate the
map.

The card offers `הצגת כל הדרך`; activating it applies a lighter highlight to
the logical and physical features for every active member segment ID without
changing exact selection. It does not select junction footprints simply
because they connect member arms.

Exact focus/filter state for this feature moves to stable segment ID as part of
the implementation. The existing internal-name callback/filter can remain only
as a compatibility adapter; neither repeated guidance names nor junction names
may be used as exact Mapbox equality keys.

### Built-route labels on the map — deferred past the first release

This layer is designed but not built in the first release. It is the costliest
and least certain part of the planner work: line-following placement, collision
handling, and per-platform density policy, delivered on top of a base map that
already labels `כביש 99` and every other significant road. The itinerary is the
authoritative readable list, and the design already concedes that mobile web may
hide the layer entirely.

The discipline applied to full-network labels applies here too: measure whether
riders miss route labels once the itinerary ships, then build them. Deferring
costs nothing structurally, because the label model consumes route runs, which
the itinerary produces anyway.

The intended design, when it is built:

Once a route exists, the map renders sparse **route-only** guidance labels:

- labels are generated from route runs, not the full named-way geometry;
- named-way runs are eligible for line-following labels when there is enough
  visible length;
- standalone features use a midpoint label/icon;
- unnamed runs receive no proper-name label;
- junction landmark names are not emitted as way-label candidates; a separate
  landmark or maneuver treatment may show them when useful;
- collision handling and a large spacing keep labels subordinate to the route
  line and base map;
- internal section labels are never drawn repeatedly along the map.

This layer is planning context, not a replacement basemap. At small mobile-web
sizes it can be more conservative or hidden; the itinerary remains the
authoritative readable list.

### Build panel and route summary

Add a `הדרך במסלול` itinerary section driven by route runs. A collapsed row
shows:

- facility icon;
- guidance name or fallback;
- distance along this route occurrence;
- surface badge(s), including a mixed-surface indication;
- warning/POI count when present.

Selecting a row highlights only that route-distance run, not every occurrence
of the named way and not its full regional geometry. Expanding the row reveals
section labels, retained junction context, and exact local warnings. A
junction is contextual detail rather than an extra itinerary row. An explicit
whole-way action can show the full named way when desired.

The existing GPX/share summary that lists every `selectedSegments` name is
replaced by this itinerary. POI and warning cards use:

```text
<guidance name> · <optional section label>
```

rather than the raw internal name.

## Native app planning presentation

The app keeps its map-first planner and draggable Discover/Build sheet.

### Map interaction

In Build mode, tapping near the network remains the primary “add route point”
gesture. This design does not overload the same tap with a segment inspector or
introduce a long-press gesture that competes with map movement.

Exact route inspection starts from the Build-sheet itinerary:

- tapping a route-run row highlights that run on the map;
- the sheet moves to peek/half as needed so the highlighted geometry remains
  visible;
- expanding a row reveals exact section details and warnings;
- selecting a section highlights its exact segment-clipped route portion;
- a clear/dismiss action restores the full route presentation.

Discover/browse mode may later add a dedicated inspect interaction, but it is
not required for the naming migration.

### Build sheet and summary

The app renders the same `הדרך במסלול` run list as web, with a touch-oriented
collapsed presentation. The route-summary modal, share preview, warning cards,
and POI cards use guidance names and optional section labels.

The sheet peek remains compact; it does not enumerate all roads. When useful it
may show a short synopsis such as the first named way plus `+N דרכים`, but
distance/elevation remain the primary peek information.

Route-only map labels are deferred on native for the same reason as on web. When
they are built they follow the same run model but use a stricter density
threshold on the phone, and standalone landmarks such as a named bridge have
higher label priority than repeated long-road labels.

### Transition into active navigation

The exact same guidance metadata used in the planning itinerary is frozen into
the effective navigation route. Starting navigation must not reinterpret names
from current UI text or query the visible map layer.

The active navigation chip/cue card then shows the current way or standalone
feature, while exact segment ownership continues to drive warnings and
condition changes in the background.

## Editor experience

Ways are first-class editorial entities in a top-level **Ways** workspace.
That workspace owns the registry list, each way's display/audible name, kind,
reference, active members, validation findings, map highlight, and the
digest-bound suggestion queue. A way is shown exactly once even when its
members form several disconnected evidence components.

The existing Network workspace's **CW network** focus retains a compact
`הכוונה ושם דרך` section on the selected segment. Network owns only the
segment's role, named-way assignment, and optional `sectionLabel`; a link opens
the selected entity in Ways. It does not duplicate way-owned display,
pronunciation, kind, or reference fields.

Because an empty canonical way is invalid, manual way creation starts from a
selected Network segment and atomically creates the registry entity plus its
first membership. A suggestion may perform the same combined operation. The
Ways workspace does not save an empty placeholder entity.

The section has three explicit role choices:

- `חלק מדרך בעלת שם` — autocomplete/select a registry way, with create-new;
- `מאפיין עצמאי בעל שם` — enter public name and kind;
- `ללא שם` — select the best fallback kind.

For named-way members the editor also provides optional `sectionLabel`.

The Ways workspace provides:

- name, kind, ref, aliases, and optional spoken-name override;
- map preview of every active member;
- connectivity/branch validation;
- member count and total length;
- bulk assignment by selecting a contiguous start/end chain;
- an explicit remove/reassign operation;
- a list of section labels for quick consistency review.

The first-release CRUD workflow is explicit:

- **Create:** select an active segment in the Ways map or segment search, choose
  `דרך חדשה`, enter the stable ID and way-owned fields, then save. Registry
  creation and first-member assignment are one validated transaction.
- **Read:** search the registry, select a way, inspect every member and
  validation finding, and highlight the full facility on the map.
- **Update:** edit the selected way's display name, kind, reference, or audible
  override. A changed audible value requires the iOS verification checkbox.
- **Delete:** explicitly confirm deletion; the transaction removes the registry
  record and returns every member to unreviewed. Required enforcement may
  refuse this until members are reassigned.
- **Assign/reassign:** select any active segment on the Ways map or through
  segment search, choose a target way, and confirm replacement when it already
  has another role or way.
- **Unassign:** remove the selected segment's classification, or remove an
  individual member from the selected way. The last member cannot be removed
  independently because empty canonical ways are invalid; delete the way
  instead.

The Network inspector offers the same segment-to-way assignment boundary for
geometry-first work. Both surfaces call the same transaction and validator;
neither stores a second membership list.

Because the data is spatially sequential, the editor can propose the unique
contiguous chain between two selected members. It traverses the same reviewed
logical adjacency graph used by validation, including accepted alignment
terminals and published junction arm connections. The proposal is previewed
and confirmed; location is an authoring aid, not an implicit production naming
algorithm.

### Assisted classification bootstrap

The editor should start with useful proposals rather than 280 blank
classifications. A one-time, repeatable suggestion pass prepares a compact
review artifact from:

- stable segment IDs, current internal names, road type, geometry, and status;
- accepted direction-scoped alignments and logical adjacency;
- published junction attachments and legal movements;
- nearby parallel facilities, existing registry ways, and already reviewed
  classifications; and
- section/POI context when it helps distinguish two otherwise similar runs.

A language model reviews that evidence and proposes:

- role (`named-way`, `standalone`, or `unnamed`);
- a new or existing way ID;
- clean display name and optional section label;
- an optional **audible candidate**, including suggested Hebrew pronunciation
  punctuation, while the proposed canonical `spokenName` remains `null` until a
  device recording demonstrates a problem;
- the exact member IDs, which need not form one component;
- confidence (`high`, `medium`, or `low`), concise evidence, and alternatives
  when ambiguous.

The model is a bootstrap assistant, not a source of authority. Suggestions are
source-digest-bound, never write canonical data automatically, and cannot
override topology validation. Equal-looking names, proximity, or model
confidence cannot merge a road with a parallel cycleway. Stale suggestions are
regenerated or shown as stale. Every group is scored by the shared structural
validator before review; model confidence and validator findings are distinct.

The suggestion source may record several rows for disconnected evidence
components. Before presentation, deterministic conceptual-way consolidation
joins components that are unambiguously one public numbered road or named
cycleway and targets an existing registry ID when one exists. Thus all proposed
Road 90 roadway members appear on one `road-90` proposal. Nearby dirt segments
whose internal labels mention Road 90 remain independent unnamed proposals.
Informal corridors with equal visible text are not consolidated automatically;
they remain separate until the curator confirms they are one facility.

The Ways workspace presents a digest-checked per-group import/review list:

- filter/sort by confidence, role, validator status, and stable segment ID;
- map preview of every proposed member and neighboring alternatives;
- side-by-side display and audible text, plus platform speech preview when
  available; iOS simulator/device remains the pronunciation authority;
- accept, edit-and-accept, reject, split group, or defer;
- progress showing reviewed/remaining segments and estimated groups rather
  than forcing 291 independent form submissions.

Rich priority queueing, batch acceptance, endpoint-to-endpoint bulk assignment,
and a graphical structure visualizer are deferred until the initial review pass
shows which one removes a real bottleneck. If batch acceptance is added, it is
limited to proposals with no unresolved validator finding or conflicting
accepted membership and must preview the exact canonical diff.

Accepting a proposal uses the same atomic registry/source transaction as manual
editing. The accepted result becomes ordinary canonical data; the suggestion
and its confidence do not ship to the app.

The current editor is still a monolithic `editor/editor.js`, but its hot paths
now use render-domain invalidation, versioned map-source updates, a persistent
matcher worker, and revision-aware background authoring. A guidance-only
metadata edit must use the cheap metadata path: it must not run the matcher,
rebuild base topology, or invalidate unrelated map sources.

The generic server-owned authoring-operation/delta-persistence work described
by `editor-performance-ux` is not implemented yet. Navigation-way authoring
must not pretend that `/api/source` already provides a server revision
contract. A create/edit-way plus member-assignment action therefore uses one
narrow server transaction with expected content digests for both canonical
files. The server validates the proposed pair, writes both atomically with
rollback, and returns new digests. Source-only guidance role edits may use the
same endpoint with an unchanged registry. A superseded response cannot clear a
newer local edit. This endpoint can later become one operation type in the
general authoring service without changing the data model.

Build and Promote remain explicit release actions.

### Editor validation

Blocking after activation:

- active segment has no guidance role;
- unknown named-way ID;
- invalid role-specific fields;
- one segment assigned to multiple ways;
- non-waivable `facility-class-conflict`;
- unresolved `parallel-facility-risk`;
- conflicting guidance identities on overlapping accepted traversal
  memberships;
- ambiguous multiple junction memberships used as one route span;
- empty active named way.

Warnings:

- disconnected named-way membership;
- branching named-way membership;
- a particular member lacks enough rider-safe exact context for a useful hover
  subtitle;
- copied split-child section labels have not been reviewed;
- standalone name duplicates an adjacent named way and may be misclassified;
- visual and spoken names differ;
- display name contains pronunciation-only punctuation or niqqud;
- audible form is identical to display text and can be omitted;
- a suggestion is stale relative to its source/evidence digest;
- unusually short/long unnamed connector;
- same visible name is used by multiple nearby way IDs;
- a named-way adjacency that has only legacy source-endpoint evidence or lacks
  a legal direction expected by the curator.

Structure warnings and an approved `parallel-facility-risk` remain visible with
their exact evidence fingerprints. Required-mode promotion blocks an
unacknowledged structure warning or unresolved risk; acknowledgement confirms a
reviewed facility decision, not that the topology magically became connected.

## Generated and runtime data

The source build resolves guidance metadata by stable segment ID and publishes
the minimum fields needed by each consumer.

### `segments.json`

Keep the current name-keyed object for compatibility. Each classified value
gains the implemented resolved `guidance` object and retains its numeric ID;
an unreviewed migration value has no valid guidance record. The resolved object
contains role, stable guidance identity, way ID when relevant, visual/spoken
name, kind, section label, and resolution status. Consumers must not use the
repeated guidance name as an object key.

This is the only runtime naming projection. Core builds two in-memory indexes
from the loaded object:

- segment ID → resolved segment guidance; and
- way ID → active member segment IDs plus the shared resolved way fields.

The second index supports whole-way highlighting and editor/planner lookup
without another fetch or manifest slot.

### Processed CycleWays GeoJSON

Keep stable segment `id` as the join key on logical and physical map features.
Do not duplicate resolved navigation names into processed GeoJSON: the map
already has `segments.json`, and duplicated text can drift or inflate every
physical-alignment feature. A segment card or whole-way highlight resolves the
hit segment ID through the in-memory indexes.

The shared map composer may continue copying non-guidance logical properties
onto accepted physical alignments. `alignmentKey` remains physical/routing
context only. Published junction geometry retains `networkRole: junction`,
`junctionId`, and its landmark name, but never receives segment guidance
fields.

### Manifest guidance summary

Build adds a non-path `guidance` summary to `map-manifest.json`:

```json
{
  "schemaVersion": 1,
  "enforcement": "migration",
  "activeSegments": 291,
  "reviewedSegments": 11,
  "coverageComplete": false,
  "conflictCount": 0
}
```

This is release diagnostics and an activation assertion, not a second source
of names. `hashes.segments` remains the data-integrity authority. Old manifests
without the summary are supported and produce legacy planner behavior unless
the route itself already carries an explicitly supported `guidanceMode`.
Current route construction receives this manifest-bound schema context
explicitly; it must not guess schema support from the number of resolved records
encountered on one route.

### Route/catalog snapshots

Live route state retains exact spans and guidance spans plus `guidanceMode`.
Snapshot projection and loading must actually round-trip what each consumer
needs; retaining spans in an in-memory route manager is insufficient.

A featured-route snapshot is a presentation projection, not a copy of the route
model. It stores the derived **visual itinerary runs** plus `guidanceMode`, not
both span families. Featured pages need that ordered list while intentionally
avoiding the heavy routing and segments assets. Starting navigation already
passes the route-catalog V6 token into Build, which restores/replans against
current data and derives guidance and reviewed crossings there; it does not
navigate the presentation snapshot.

The snapshot is a version-bound cache. Strict generation rebuilds its runs when
the manifest's segments hash changes, and Promote publishes the matching
segments, catalog, and snapshots atomically. Schema 2 does not add a conditional
“directly navigable snapshot” mode. If offline navigation from a snapshot is
ever required, it needs a separate contract containing full routing attestation
and direction-sensitive crossing evidence, not just geometry plus a crossings
array.

Schema 1 stores no span or run data, so this is still a coordinated schema bump
with a backward-compatible loader — but a smaller one.
A snapshot already records its map version and `assetHashes.segments`; that
hash is the guidance provenance. The release manifest binds the route-catalog
digest and every featured-snapshot digest into the release bundle, so a
snapshot does not self-reference the final `releaseBundleDigest`.

The developer navigation-demo snapshot is a separate private fixture format.
It already preserves the route-state object and adds matched junctions and
reviewed crossings. It is an acceptance harness, not a substitute for fixing
the public featured-snapshot projection.

Shared route URLs remain based on route points, stable segment IDs, and/or
stable base-edge share IDs. Guidance names are presentation metadata and do not
become part of URL identity. Exact V6 replay, historical-anchor recovery, and
current-policy replanning all derive guidance from the resulting current
traversal rather than trusting names stored in a token.

### Base-routing shards

CycleWays-aligned base traversals resolve exact segment IDs through their
current direction-scoped `cwAlignments` records, then resolve guidance through
the already loaded `segments.json` index. Junction-internal traversals resolve
their on-network role through direction-scoped `cwJunctions` records. Display
text is not duplicated into every shard. Unaligned base edges continue to use
route-class fallback in the first release.

A later shard schema may carry normalized OSM `name`/`ref` and an edge guidance
identity. That extension must use connected topology and curated overrides; it
must not group every edge with the same OSM text globally. The runtime guidance
span contract is intentionally source-neutral so the later extension does not
require another UI redesign.

### Build and release bundle

Build stages content-versioned map artifacts and computes one map version from
all relevant inputs. Resolved guidance changes alter `segments.json`, its hash,
and therefore the map version; the manifest guidance summary records coverage.
Promote then prepares the route catalog and every featured snapshot against
that staged map, computes the release index and `releaseBundleDigest`, copies
the complete target set into the public publication slots, and switches
`map-manifest.json` last.

The public filenames may be stable aliases. Consistency comes from the manifest
version, per-asset hashes, release index, and manifest-last switch—not from
assuming that every public filename is immutable. A guidance change is
therefore not followed by a separate snapshot promotion; rebuilt segments,
catalog, and snapshots are one atomic release preparation and promotion.

## Migration and rollout strategy

### Schema and authoring period

Introduce the registry, per-segment role, validation report, and editor UI
without forcing whole-network planner activation. Missing classification is
reported as unreviewed but remains allowed during this period.

Every computed route uses `guidanceMode: "guidance-v1"`; unreviewed spans take
the class fallback described above. The migration mechanism is graceful
degradation per span, not a per-route switch. `Legacy` remains an old-data
compatibility marker, but newly generated navigation copy still suppresses
internal segment names. The rollback switch disables proper-name presentation
and uses class-only v1 guidance; it does not reactivate `enter-segment`.

The order of work follows from that. Validators and a minimum suggestion-review
path come first, followed by a representative classified corpus. The shared
itinerary and web planner then ship as a partial-coverage pilot and become a
second review surface while classification continues in batches. Full coverage
gates required-mode promotion, not the first useful presentation. This uses the
per-span migration benefit instead of recreating a 100% coverage cliff.

### Reference corpus

Classify and visually review at least:

- all actual Road 99 segments;
- the parallel Road 99 cycleway as a distinct way;
- all `דרך הפטרולים` segments;
- `גשר עינות ירדן` as a standalone feature;
- clean display and iOS-tested audible forms for those named examples;
- representative unnamed road, dirt, and path connectors;
- a segment split inside a named way;
- an overlapping direction-scoped CycleWays-membership case;
- one same-way and one different-way transition through a published junction;
- a published junction in the middle of one segment; and
- a current V6 route, an exact restore, and a historical-anchor current-policy
  replan.

This corpus becomes the navigation and planner fixture set.

Before manual classification, generate suggestions for every unreviewed active
segment. The reference corpus is used to calibrate grouping confidence and
audible punctuation; accepted canonical data still requires editor review.

Suggested groups are run through the structural validator **before** a curator
sees them, and each group carries its validator verdict. A suggestion pass built
on endpoint proximity disagrees with reviewed topology in both directions: it
splits ways that a published junction connects, and it joins members that no
reviewed adjacency joins. Reviewing the complete suggestion set twice because
the first pass was scored on the wrong evidence is the expensive failure mode
here.

### Activation gate

Guidance naming itself needs no activation gate: it degrades per span and is on
from the first build that resolves any guidance. The gate below governs
enforcement and the removal of migration caveats. Change enforcement to
`required` only when:

- every active CycleWays segment has an explicit valid role;
- named-way structural validation passes, with every multi-component or
  branching way explicitly acknowledged rather than merely unreported;
- no `facility-class-conflict` remains;
- every `parallel-facility-risk` is either resolved by reassignment or approved
  for the exact evidence fingerprint as one facility;
- accepted overlap conflicts are resolved or carry an explicit reviewed
  resolution that remains deterministic at runtime; a generic suppression does
  not authorize guessed speech;
- ambiguous junction membership and junction/way presentation cases pass;
- the promoted release bundle contains the resolved `segments.json`, matching
  route catalog, and schema-compatible featured snapshots;
- web/mobile planner fixtures and navigation scenarios pass.

After activation, promotion blocks new active unclassified segments. Drafts
may remain unreviewed.

Rollback does not require reverting registry/source classifications. Supported
old clients ignore the additive `guidance` records, and new clients retain a
single runtime/configuration kill switch for planner/navigation presentation.
It defaults on. Disabling the switch uses class-only v1 presentation for the
session; it never changes route search, geometry, share identity, or restores
internal segment voice. The planner itinerary follows the same switch and does
not need a coverage precondition, because partial coverage produces honest
class-fallback rows.

### Compatibility cleanup

Exact public-map focus for this feature migrates to numeric segment ID during
implementation because the logical and physical map features already expose
it. After guidance behavior is stable, remaining name-keyed metadata joins,
POI association, diagnostics, and storage adapters can migrate separately.
Only after those migrations should the repository consider renaming the old
`name` concept to an explicitly internal/editor label or allowing repeated
internal labels.

## Testing and validation expectations

### Data/model tests

- Registry IDs are unique and every reference resolves.
- A way whose active members form several components, or whose member degree
  exceeds two, validates with a warning and is blocked only until the curator
  acknowledges it; it is never a hard failure.
- A material parallel overlap raises `parallel-facility-risk` even when the
  members meet at one end; it blocks until the members are separated or its
  exact fingerprint is approved as one facility.
- A legitimate dual-carriageway fixture can be approved without splitting the
  road, while the Road 99 roadway/cycleway fixture cannot be approved as one
  facility.
- A branching named trail network and a two-component numbered road both survive
  validation once acknowledged, and both keep one guidance identity end to end.
- Missing, invalid, and multiply assigned roles fail validation.
- Split children inherit way membership and require section-label review.
- Same visible name on different IDs never causes grouping.
- Road 99 and its parallel cycleway remain distinct.
- Multiple accepted CycleWays memberships resolve deterministically or report a
  conflict.
- Direct alignment-terminal adjacency and adjacency through published junction
  arms produce the expected named-way chain; proximity alone does not.
- Display names reject pronunciation-only punctuation; audible forms preserve
  Hebrew combining marks and never change identity.
- Every suggestion is bound to source/evidence digests, includes exact segment
  IDs and confidence/evidence, and cannot be accepted when stale.
- Suggested road/cycleway groups that share a corridor remain distinct.

### Route-model tests

- Consecutive Road 99 segment spans yield one Road 99 route run.
- Leaving and re-entering Road 99 yields two runs.
- Exact segment spans and warnings survive run grouping.
- Reverse, clip, and loop transforms preserve guidance distance ranges.
- A reverse route with symmetric memberships names the same ways as its forward
  route; a reverse route with asymmetric memberships resolves from reversed
  evidence. Neither falls back to legacy naming.
- Paired forward/opposite exact and guidance projections survive clip, loop
  rotation, and double reverse; direction-sensitive reviewed crossings are
  transformed or recomputed rather than silently dropped.
- Standalone bridges remain separate runs.
- Unnamed and unreviewed spans never inherit an internal segment name, and both
  present the same class fallback.
- A route containing one unreviewed member still names every resolved way it
  traverses.
- A conflicting span exposes a usable facility class rather than a null name and
  a null kind.
- Surface/class changes update local context without changing way continuity.
- Same-way travel through a junction remains one route run with retained
  junction context; different-way travel produces two runs and no junction row.
- A junction in the middle of one segment does not split its guidance identity.
- Featured snapshot build and load round-trip the derived itinerary runs and
  `guidanceMode` under the snapshot's map version and segments hash. Starting
  navigation restores the catalog route token and does not consume those runs
  as a navigation route.
- Exact V6 restore and historical-anchor current-policy replan both derive
  guidance from the resulting direction-scoped traversal.

### Navigation tests

- Internal boundary on Road 99 emits no enter/continue cue.
- Internal boundary on `דרך הפטרולים` emits no name change.
- A true turn onto Road 99 says `כביש 99` only.
- A decision while remaining on Road 99 may use “stay on” copy.
- Entering `גשר עינות ירדן` produces one bridge-appropriate cue when useful;
  exiting it is silent without a decision.
- The Road 99 cycleway is spoken as the cycleway, never the road.
- Unnamed and unreviewed connector guidance uses class/generic fallback.
- A long-run distance confirmation appears in the preview utterance only,
  never in the final-phase call, for turns, roundabouts, and reviewed crossings
  alike. It is omitted when no preview was emitted.
- Safety/surface transitions remain available inside one named way.
- A roundabout/crossing through a named junction remains one topology cue,
  names the destination way when available, and may add the junction landmark
  without calling it the road.
- Old persisted navigation state regenerates rather than replaying stale
  segment-name cues.

### Web planning acceptance

- Hover/focus selects and highlights one exact segment even when many segments
  share a guidance name.
- Logical overview and physical alignment hits for that segment open the same
  ID-backed card; a junction footprint opens no segment card.
- The card title is the guidance name; section label and metrics describe the
  exact segment.
- Two adjacent members of one way never produce two identical cards: without a
  curated section label, the derived subtitle still distinguishes them.
- Whole-way context is opt-in.
- Whole-way context covers logical and physical member features but does not
  absorb connecting junction footprints.
- The Build itinerary groups contiguous runs and expands to exact sections.
- Selecting a run highlights only that route occurrence.
- Route summary, warnings, and POIs no longer expose raw internal names as
  primary copy.
- Short unnamed/unreviewed connectors fold at exactly `ITINERARY_FOLD_MAX_M`,
  identically on web and native.

### Native planning acceptance

- Route construction tap gestures remain unchanged.
- The Build-sheet itinerary matches web semantics and copy.
- Selecting a run/section highlights the correct route range and manages sheet
  visibility without hiding the selection.
- The mobile summary groups runs and preserves exact warnings.
- Published junction spans remain on-network context without becoming planner
  rows or segment interactions.
- Starting navigation preserves the itinerary's resolved guidance names.

## Risks and mitigations

### Incorrect grouping is more harmful than missing naming

Calling a parallel cycleway `כביש 99` can give unsafe instructions. Ambiguous
overlaps fall back to facility class and appear in validation rather than
guessing. The `parallel-facility-risk` detector targets this case directly
instead of relying on a member-degree limit, which both over-fires on legitimate
branching facilities and does not catch a parallel member attached at one end.
It raises a mandatory review question rather than declaring that all parallel
geometry must be separate; legitimate carriageways remain expressible through a
fingerprint-bound approval.

### Over-strict structure fragments real facilities

A structural rule that forces one facility into several way IDs manufactures the
false transitions this design exists to remove: two `כביש 99` itinerary rows, a
spoken destination name where the rider is simply continuing, and no voice
suppression between the two identities. Checked against the real network, a
strict one-component degree-two rule would fragment roughly one in nine proposed
multi-member ways, including a named trail network of four-way degree. Structure
warnings therefore inform the curator; they do not force ID splits.

### Internal detail can disappear behind a clean itinerary

Warnings, quality changes, and surface transitions remain on exact child spans.
Every collapsed run is expandable, and warnings promote the relevant section.

### Map labels can compete with the basemap

Route-only labels are deferred out of the first release for this reason among
others. When built, only the built route receives sparse CycleWays labels,
full-network names stay on demand, and mobile uses stricter density and landmark
priority.

### Name and identity drift

Stable way IDs, a versioned registry, and generated reverse indexes keep name
changes from altering continuity. Display-name equality is never identity.

### Partial migration can produce inconsistent guidance

Partial coverage produces named spans next to class-fallback spans, which is the
same mixture a fully classified route already contains wherever it crosses an
unnamed connector. What it never produces is an internal editorial name, in any
mode. The alternative — demoting a whole route because one connector is
unreviewed — restores exactly the speech this design removes, and makes every
review group worthless until the last one lands.

### TTS may pronounce road numbers or local names poorly

An optional `spokenName` is available for ways and named segments. The value is
used only by voice, preserved byte-for-byte by Build, and tested separately from
clean visual copy on iOS.

The mitigation is only applied where a recording shows a real problem. Adding an
audible form speculatively is itself a risk: a hand-written expansion such as
`כביש תשעת אלפים תשע מאות שבעים וארבע` permanently replaces whatever the speech
engine does with `כביש 9974`, including future improvements, and is wrong if
riders read the number differently. Suggestions may propose an audible form, but
the default outcome of review is `null`.

### Model suggestions may look more certain than they are

Every suggestion carries exact member IDs, evidence, alternatives, confidence,
and a source digest. The editor requires human acceptance and topology
validation; model output never becomes canonical or promotable by itself.

### Existing name-keyed joins remain fragile

All new guidance logic keys by stable IDs, and exact public-map focus moves to
ID as part of this work. Remaining legacy name-keyed joins stay behind explicit
adapters and are a later cleanup.

### Release-bundle drift can create internally inconsistent copy

The resolved segments asset, route catalog, and featured snapshots are prepared
in one promotion transaction. Their hashes are bound by the release index and
the manifest switches last. Snapshots store the derived itinerary rather than a
copy of the span model, so there is less promoted state that can disagree with
the segments asset it was built from.

## Final product principles

- Segments are internal ownership units, not the rider's primary mental model.
- Guidance names describe continuous navigable facilities.
- One real facility is one way ID. Structure checks inform that judgement; they
  never force it to be split.
- Named-way membership is optional; explicit guidance classification is not.
- Missing classification degrades one span to its facility class. It never
  demotes a route, and it never restores an internal name.
- A name is presentation, never identity.
- Display and audible names are separate presentation forms; neither is
  identity.
- Model suggestions reduce review effort but never replace editor approval.
- Direction-scoped traversal evidence determines which memberships apply.
- Junctions are named landmarks with road-name-less internal spans, not ways.
- Topology decides maneuvers; guidance identity decides wording.
- Planner summaries group contiguous route occurrences, never global name
  matches.
- Exact segment detail remains one expansion or inspection away.
- Resolved segment guidance and derived snapshots ship in one manifest-bound
  release.
- Web and native share semantics while using interaction patterns appropriate
  to hover/desktop and touch/mobile.
