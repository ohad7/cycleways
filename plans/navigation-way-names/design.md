# Navigation Way Names Design

**Date:** 2026-07-15
**Status:** Proposed design
**Related designs:** `map-editor-workflow`, `editor-name-release`,
`waypoint-routing`, `segment-name-display`, `front-page-overhaul`,
`rn-mobile-native-ui`, `turn-by-turn-improvements`, and `nav-ui-redesign`

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
fourth production role. Named-way membership is therefore optional, while
guidance classification becomes mandatory before the new behavior is enabled.

The route keeps two parallel views of the same traversal:

- exact **segment spans** retain internal ownership, quality, POIs, warnings,
  and diagnostics;
- rider-facing **guidance spans/runs** provide names and continuity for map
  presentation, route summaries, turn cues, current-road UI, and voice.

Internal boundaries inside the same named way become invisible to navigation.
They remain available when the user inspects or expands a route section.

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
- Give web and native planning surfaces one shared route-itinerary model while
  respecting their different interaction patterns.
- Allow an additive migration without breaking old route links or immediately
  replacing the current name-keyed site data model.

## Non-goals

- Renaming, deleting, or making current segment names non-unique.
- Changing segment geometry, routing topology, quality ownership, or POI
  ownership.
- Inferring named ways by stripping suffixes such as locality names or split
  numbers from current names.
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

A continuous rider-recognizable facility composed of one or more CycleWays
segments, for example:

- `כביש 99`;
- `דרך הפטרולים`;
- `שביל האופניים לאורך כביש 99`;
- `טיילת עמי`.

A named way has a stable identity independent of its display name. Member
segments form one connected, non-branching geographic chain or ring. A route
may traverse that chain in either direction.

### Standalone named feature

A named traversable feature that connects ways but is not itself a member of
either one. `גשר עינות ירדן` is the reference example. Its guidance identity is
the exact stable segment ID rather than a reusable named-way ID.

### Intentionally unnamed section

A connector or section for which CycleWays has no rider-recognizable proper
name. It may still have a facility kind such as `bridge`, `connector`, `road`,
`track`, or `path` and can use that kind as a presentation fallback.

### Section label

Optional rider-friendly context for an exact segment inside a named way, such
as `שאר ישוב–בריכות הדגים` or `קיבוץ שמיר צפון`. A section label is useful in
planning and warning disambiguation but is not spoken as the road name.

It is explicitly curated. The build must not derive it by subtracting the way
name from the current internal name.

### Guidance span

An ordered distance range on a computed route with one resolved guidance
identity and current facility semantics. It is derived from base-edge
traversals and CycleWays memberships, not from the route's unclipped list of
selected segments.

### Route run

One contiguous occurrence of a guidance identity in a particular route. A
route that leaves and later rejoins Road 99 has two Road 99 runs. Runs drive
route summaries and route-only map labels; they are never globally grouped by
visible name.

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

The long-term map/planner direction is ID-based segment lookup and focus, but
that migration is not required before introducing guidance names. During the
additive stage, the current unique name can remain the exact lookup key while
the UI renders the resolved guidance name.

## Decision 2: Canonical named-way registry plus explicit segment roles

Add a canonical `data/navigation-ways.json` registry. IDs are stable opaque
strings: readable IDs such as `road-99` are acceptable, but no runtime behavior
derives identity from the string or from the display name.

Conceptual registry shape:

```json
{
  "schemaVersion": 1,
  "ways": {
    "road-99": {
      "name": "כביש 99",
      "kind": "road",
      "ref": "99",
      "aliases": [],
      "spokenName": null
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
- Active members of a named way form one connected component.
- That component is non-branching: endpoint degree is at most two, allowing a
  chain or a ring.
- Two different way IDs may share a visible name, but they are never merged by
  name alone.
- A way can contain one segment. A single-segment way is valid when the segment
  is conceptually a road/trail rather than a connector structure.
- `sectionLabel` is optional and need not be unique.
- `spokenName`, when present, changes TTS pronunciation only; visual UI keeps
  using `name`.
- `kind` describes the named facility and does not replace exact per-edge or
  per-segment surface/road-class data.

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

`segmentSpans` remain the exact route-distance index for CycleWays ownership.
They should evolve toward stable ID-first records while retaining the current
name for compatibility:

```text
segment span
  startMeters / endMeters
  segmentId
  internalName
  onCycleways
  routeClass / surface context
```

A separate derived `guidanceSpans` list is added:

```text
guidance span
  startMeters / endMeters
  role
  guidanceIdentity
  wayId (named-way only)
  name (resolved visual name, nullable)
  spokenName (nullable override)
  kind
  segmentIds[]
  sectionLabels[]
  onCycleways
  routeClass / surface context
```

`guidanceIdentity` is stable and never equal to display text:

- `way:<wayId>` for a named way;
- `standalone:<segmentId>` for a standalone named feature;
- `null` for intentionally unnamed spans.

Adjacent traversal pieces merge into a guidance span only when guidance
identity **and current facility semantics** match. This allows the current
surface/class badge to change without implying that the rider left the named
way.

For planner summaries, adjacent guidance spans with the same non-null guidance
identity are grouped into a higher-level route run even if their exact surface
or class changes. The child spans remain attached to that run, so the UI can
show mixed surfaces and warnings honestly.

### Multiple CycleWays memberships

The current route builder can take the first CycleWays membership on an edge.
Guidance identity must instead consider every accepted direction-scoped
membership covering the traversal:

- if all memberships resolve to the same guidance identity, the traversal is
  unambiguous;
- if they resolve to different identities, the build/report flags a guidance
  conflict rather than choosing the first name;
- until corrected, runtime uses a conservative facility-class fallback and
  does not speak either conflicting name.

### `onCycleways` is independent of naming

The current model often treats “has a segment name” as equivalent to “is on the
CycleWays network.” The new model separates:

- CycleWays ownership;
- guidance-name availability;
- facility class.

A named base road may be off the CycleWays overlay, and a CycleWays segment may
be intentionally unnamed.

### Route transformations

Reverse, clip-to-start, rotate-loop, approach, and rejoin route transforms must
apply the same distance remapping to segment spans and guidance spans. They may
not rebuild guidance membership from visible names after transformation.

Navigation route fingerprints/snapshots include the resolved guidance metadata
or a guidance-data version. Restoring an older snapshot without compatible
guidance data regenerates cues from the immutable route plus current metadata
rather than replaying stale segment-name cues.

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
| Enter an intentionally unnamed span | Use a kind/class fallback only when useful; never speak the internal name |
| Surface/safety change inside one named way | Separate condition cue; never model it as a road-name transition |

The current generic `enter-segment` cue is replaced by guidance-aware events.
A named-way boundary alone does not require speech. Standalone named features
may produce semantic context cues such as `cross-feature`, with copy selected
by `kind`.

A standalone `bridge` produces one low-priority, final-phase `cross-feature`
cue at its entrance. A coincident turn/crossing absorbs the bridge wording so
the rider does not receive two competing instructions. The bridge context cue
must never mask a maneuver. Other standalone kinds remain itinerary/current-
facility context until that kind has explicit guidance copy.

### Name fallback order

1. Reviewed named-way or standalone visual/spoken name.
2. Future reviewed OSM road name or road reference.
3. Facility class such as `דרך עפר`, `שביל`, `כביש`, or `גשר`.
4. Generic `המשך במסלול`.

The internal segment name is not a fallback once guidance naming is enabled.

### Current-road presentation

- Named way: show its name. Add a class/surface badge only when it adds useful
  information; avoid redundant copy such as `כביש 99 · כביש`.
- Standalone feature: show its name with an appropriate kind icon/label.
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
- Short unnamed connectors without warnings or meaningful condition changes
  may be visually folded between neighboring rows.
- A material unnamed run, or any unnamed run with warnings/POIs, receives a
  fallback row such as `מקטע מקשר` or `דרך עפר`.
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

The CycleWays network remains a clean line overlay. It does not render every
internal segment name as persistent map text.

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

The exact hovered/focused segment remains strongly highlighted. Other members
of the same named way are not automatically highlighted on every hover because
a long way can dominate the map. The card offers `הצגת כל הדרך`; activating it
applies a lighter whole-way context highlight without changing the exact
selected segment.

Map focus/filtering moves to stable segment ID when practical. Until then, the
existing unique internal name remains the hidden focus key; the repeated
guidance name must never be used as a Mapbox equality filter for exact focus.

### Built-route labels on the map

Once a route exists, the map renders sparse **route-only** guidance labels:

- labels are generated from route runs, not the full named-way geometry;
- named-way runs are eligible for line-following labels when there is enough
  visible length;
- standalone features use a midpoint label/icon;
- unnamed runs receive no proper-name label;
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
section labels and exact local warnings. An explicit whole-way action can show
the full named way when desired.

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

Route-only map labels follow the same run model as web but use a stricter
density threshold on the phone. Standalone landmarks such as a named bridge
have higher label priority than repeated long-road labels.

### Transition into active navigation

The exact same guidance metadata used in the planning itinerary is frozen into
the effective navigation route. Starting navigation must not reinterpret names
from current UI text or query the visible map layer.

The active navigation chip/cue card then shows the current way or standalone
feature, while exact segment ownership continues to drive warnings and
condition changes in the background.

## Editor experience

Add a `הכוונה ושם דרך` section to the segment editor with three explicit role
choices:

- `חלק מדרך בעלת שם` — autocomplete/select a registry way, with create-new;
- `מאפיין עצמאי בעל שם` — enter public name and kind;
- `ללא שם` — select the best fallback kind.

For named-way members the editor also provides optional `sectionLabel`.

Named-way management provides:

- name, kind, ref, aliases, and optional spoken-name override;
- map preview of every active member;
- connectivity/branch validation;
- member count and total length;
- bulk assignment by selecting a contiguous start/end chain;
- an explicit remove/reassign operation;
- a list of section labels for quick consistency review.

Because the data is spatially sequential, the editor can propose the unique
contiguous chain between two selected members. The proposal is previewed and
confirmed; location is an authoring aid, not an implicit production naming
algorithm.

### Editor validation

Blocking after activation:

- active segment has no guidance role;
- unknown named-way ID;
- invalid role-specific fields;
- disconnected or branching named-way membership;
- one segment assigned to multiple ways;
- conflicting guidance identities on overlapping accepted traversal
  memberships;
- empty active named way.

Warnings:

- named-way member lacks a section label;
- copied split-child section labels have not been reviewed;
- standalone name duplicates an adjacent named way and may be misclassified;
- visual and spoken names differ;
- unusually short/long unnamed connector;
- same visible name is used by multiple nearby way IDs.

## Generated and runtime data

The source build resolves guidance metadata by stable segment ID and publishes
the minimum fields needed by each consumer.

### `segments.json`

Keep the current name-keyed object for compatibility. Each active value gains
resolved guidance metadata and retains its numeric ID. Consumers must not use
the repeated guidance name as an object key.

### Processed CycleWays GeoJSON

Publish stable `id` plus compact resolved fields required for map cards and
focus context:

- `guidanceRole`;
- `navigationWayId` when applicable;
- `navigationName` when applicable;
- `navigationKind`;
- `sectionLabel` when present.

Exact map hit-testing and focus continue to use segment ID/internal key.

### Named-way asset

Publish a compact registry for web and native, bundled with the same asset
version as segment metadata. Generated membership indexes include:

- way ID → active segment IDs;
- segment ID → resolved guidance record.

The source registry remains the canonical editable form; indexes are generated.

### Route/catalog snapshots

Route state and catalog snapshots retain exact segment spans and add guidance
spans or enough versioned evidence to rebuild them deterministically. Snapshot
builders regenerate route itineraries when the guidance-data version changes.

Shared route URLs remain based on route points, stable segment IDs, and/or
stable base-edge share IDs. Guidance names are presentation metadata and do not
become part of URL identity.

### Base-routing shards

CycleWays-aligned base traversals resolve guidance through stable segment IDs.
Unaligned base edges continue to use route-class fallback in the first
release.

A later shard schema may carry normalized OSM `name`/`ref` and an edge guidance
identity. That extension must use connected topology and curated overrides; it
must not group every edge with the same OSM text globally. The runtime guidance
span contract is intentionally source-neutral so the later extension does not
require another UI redesign.

## Migration and rollout strategy

### Schema and authoring period

Introduce the registry, per-segment role, validation report, and editor UI
without changing production navigation copy. Missing classification is reported
as unreviewed but remains allowed during this period.

### Reference corpus

Classify and visually review at least:

- all actual Road 99 segments;
- the parallel Road 99 cycleway as a distinct way;
- all `דרך הפטרולים` segments;
- `גשר עינות ירדן` as a standalone feature;
- representative unnamed road, dirt, and path connectors;
- a segment split inside a named way;
- an overlapping CycleWays-membership case.

This corpus becomes the navigation and planner fixture set.

### Activation gate

Do not partially switch production cues from segment names to guidance names.
Enable the new behavior only when:

- every active CycleWays segment has an explicit valid role;
- named-way connectivity validation passes;
- accepted overlap conflicts are resolved or explicitly suppressed;
- web/mobile planner fixtures and navigation scenarios pass.

After activation, promotion blocks new active unclassified segments. Drafts
may remain unreviewed.

### Compatibility cleanup

After guidance behavior is stable, separately migrate map focus, segment
metadata joins, POI association, and route state toward numeric segment IDs.
Only after those migrations should the repository consider renaming the old
`name` concept to an explicitly internal/editor label or allowing repeated
internal labels.

## Testing and validation expectations

### Data/model tests

- Registry IDs are unique and every reference resolves.
- Active named-way members form one chain or ring.
- Missing, invalid, and multiply assigned roles fail validation.
- Split children inherit way membership and require section-label review.
- Same visible name on different IDs never causes grouping.
- Road 99 and its parallel cycleway remain distinct.
- Multiple accepted CycleWays memberships resolve deterministically or report a
  conflict.

### Route-model tests

- Consecutive Road 99 segment spans yield one Road 99 route run.
- Leaving and re-entering Road 99 yields two runs.
- Exact segment spans and warnings survive run grouping.
- Reverse, clip, and loop transforms preserve guidance distance ranges.
- Standalone bridges remain separate runs.
- Unnamed spans never inherit an internal segment name.
- Surface/class changes update local context without changing way continuity.

### Navigation tests

- Internal boundary on Road 99 emits no enter/continue cue.
- Internal boundary on `דרך הפטרולים` emits no name change.
- A true turn onto Road 99 says `כביש 99` only.
- A decision while remaining on Road 99 may use “stay on” copy.
- Entering `גשר עינות ירדן` produces one bridge-appropriate cue when useful;
  exiting it is silent without a decision.
- The Road 99 cycleway is spoken as the cycleway, never the road.
- Unnamed connector guidance uses class/generic fallback.
- Safety/surface transitions remain available inside one named way.
- Old persisted navigation state regenerates rather than replaying stale
  segment-name cues.

### Web planning acceptance

- Hover/focus selects and highlights one exact segment even when many segments
  share a guidance name.
- The card title is the guidance name; section label and metrics describe the
  exact segment.
- Whole-way context is opt-in.
- The Build itinerary groups contiguous runs and expands to exact sections.
- Selecting a run highlights only that route occurrence.
- Route summary, warnings, and POIs no longer expose raw internal names as
  primary copy.
- Sparse route-only labels never render every internal section name.

### Native planning acceptance

- Route construction tap gestures remain unchanged.
- The Build-sheet itinerary matches web semantics and copy.
- Selecting a run/section highlights the correct route range and manages sheet
  visibility without hiding the selection.
- The mobile summary groups runs and preserves exact warnings.
- Route-only labels remain sparse, with standalone landmarks prioritized.
- Starting navigation preserves the itinerary's resolved guidance names.

## Risks and mitigations

### Incorrect grouping is more harmful than missing naming

Calling a parallel cycleway `כביש 99` can give unsafe instructions. Ambiguous
overlaps fall back to facility class and appear in validation rather than
guessing.

### Internal detail can disappear behind a clean itinerary

Warnings, quality changes, and surface transitions remain on exact child spans.
Every collapsed run is expandable, and warnings promote the relevant section.

### Map labels can compete with the basemap

Only the built route receives sparse CycleWays labels. Full-network names stay
on demand. Mobile uses stricter density and landmark priority.

### Name and identity drift

Stable way IDs, a versioned registry, and generated reverse indexes keep name
changes from altering continuity. Display-name equality is never identity.

### Partial migration can produce inconsistent guidance

Schema/editor rollout is separated from behavior activation. Production does
not mix legacy segment-name cues with the new guidance model.

### TTS may pronounce road numbers or local names poorly

An optional spoken-name override is part of the registry. It is used only by
voice and tested separately from visual copy.

### Existing name-keyed joins remain fragile

The additive design avoids breaking them immediately, but all new guidance
logic keys by stable IDs. A later ID-first cleanup remains an explicit follow-up.

## Final product principles

- Segments are internal ownership units, not the rider's primary mental model.
- Guidance names describe continuous navigable facilities.
- Named-way membership is optional; explicit guidance classification is not.
- A name is presentation, never identity.
- Topology decides maneuvers; guidance identity decides wording.
- Planner summaries group contiguous route occurrences, never global name
  matches.
- Exact segment detail remains one expansion or inspection away.
- Web and native share semantics while using interaction patterns appropriate
  to hover/desktop and touch/mobile.
