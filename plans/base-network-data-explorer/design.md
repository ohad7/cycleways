# Base Network Data Explorer — Design

Date: 2026-07-18

Status: Approved; first map-exploration milestone implemented

## Summary

Turn the editor's current **Base Graph** workspace into a map-first **Base
Network** workspace for understanding, filtering, inspecting, and—only when the
curator chooses—reviewing routing data.

The default experience is exploration, not a review queue. Every matching edge
is drawn on the map, filters and coloring update immediately, and selecting an
edge explains both its source data and the routing verdict derived from that
data. Looking at data never creates a review obligation, never writes a source
file, and never makes the graph stale.

The workspace has three explicit modes:

1. **Explore** — visualize and inspect without writing anything;
2. **Edit** — create or change manual base-edge geometry using the existing
   tools; and
3. **Review filtered results** — optionally freeze the current result set into
   a next/previous review session.

Roundabouts and crossings become derived overlays and specialized review
lenses within the Base Network workspace after their existing workflows have
feature parity. They share the map, filtering shell, selection behavior, and
review navigation, but retain their own candidate and decision models. The CW
Direction Review remains in **CW Overlay**, because it reviews logical segment
alignments rather than the base network itself.

## Why this is needed

The current editor already contains several useful but separate views:

- Base Graph can select one edge, search by edge ID, show all one-way arrows,
  edit manual geometry, and create a reviewed OSM traversal override.
- CW Overlay contains Direction Review queues and segment-to-edge mappings.
- Roundabouts shows all derived candidates and supports filtering and review.
- Crossings shows all derived crossing candidates and supports filtering and
  review.

The missing capability is simple, broad inspection of the base network. A
curator cannot currently ask questions such as:

- Where are all edges tagged `bicycle=no`?
- Which normalized prohibitions overlap the CW network?
- Which restrictions came from raw OSM access tags versus one-way rules?
- Where are conditional or unknown traversal decisions concentrated?
- Which manual edges are not reviewed?
- Which OSM ways have reviewed overrides, and which reviews became stale?
- How do roundabouts, crossings, CW segments, and direction arrows relate on
  the same map?

The absence became visible while investigating CW segment #19. Its geometry
and mapping are correct, but OSM way 57116180 is tagged `bicycle=no`; the
normalized policy therefore prohibits both directions. Finding and
understanding that contradiction should be a visual query, not a sequence of
edge-ID searches.

## Current data scale

The local graph inspected on 2026-07-18 contained:

| Measure | Count |
| --- | ---: |
| Base edges | 48,845 |
| OSM base edges | 48,762 |
| Manual base edges | 83 |
| Edges with raw `bicycle=no` | 120 |
| Distinct OSM ways with raw `bicycle=no` | 73 |
| `bicycle=no` ways that are path, footway, or track | 69 |
| Edges with at least one prohibited direction | 6,372 |
| Edges with a conditional direction | 196 |
| Edges with an unknown direction | 33 |

These numbers are observations, not fixed acceptance values. They establish
that the whole graph is small enough for client-side exploration, while also
showing why access review should normally group split edges by source OSM way.
The 120 `bicycle=no` edges represent only 73 reviewable source subjects.

## Goals

- Draw all base-network data and arbitrary filtered subsets on one map.
- Make raw source facts and normalized routing decisions separately visible.
- Provide useful built-in presets while allowing filters to be composed.
- Keep map exploration fast and non-destructive.
- Explain exactly why an edge is allowed, prohibited, conditional, or unknown.
- Show relationships to CW segments, manual edges, overrides, roundabouts, and
  crossings.
- Group access review by OSM way when the source tag and override are way-wide.
- Reuse the current reviewed OSM override and manual traversal-policy actions.
- Allow optional, lightweight “source confirmed” and “follow up” annotations
  without changing routing.
- Preserve evidence freshness and make changed source data visibly stale.
- Prevent map overlays from intercepting the edge the curator intends to
  inspect or edit.
- Work offline after the existing base-network/Direction Review bundle has been
  prepared; contextual map tiles and OSM links remain optional aids.

## Non-goals

- No public web or mobile data-explorer UI.
- No automatic change to routing permissions because an edge belongs to the CW
  network.
- No global weakening of `bicycle=no`, `access=no`, one-way, conditional, or
  unknown policy.
- No requirement to review every displayed or filtered item.
- No new promotion gate for unreviewed explorer results or optional review
  annotations.
- No live editing of OSM or automatic OSM upload.
- No generic SQL/GIS query language in the first version.
- No replacement of CW Direction Review or its directional-alignment model.
- No forced unification of roundabout, crossing, traversal-override, and CW
  alignment decision files.
- No route-cost tuning; the separate Connector Navigation Lens owns that work.
- No automatic claim that a route is safe beyond the active normalized access
  and direction policy.

## Product decisions

### D1 — Exploration is the default

Opening Base Network enters **Explore**. Filters, themes, presets, layer
toggles, searches, selection, and camera movement are read-only. There is no
pending count implying that all matching edges must be processed.

The UI may report “73 matching OSM ways / 120 base edges,” but it must not say
“73 issues” unless the chosen preset actually represents a defined
inconsistency, such as a CW segment using a prohibited traversal.

### D2 — Editing is an explicit mode

The current Base Graph geometry actions move under **Edit**:

- New Edge
- Copy Selected
- Insert/delete/move vertices
- Split
- Delete
- Recalculate graph and matches

Explore keeps manual and OSM edges selectable, but hides destructive or
geometry-changing controls. Entering Edit does not change the active filter or
map extent. Leaving Edit cancels or explicitly finishes any incomplete drawing
operation before returning to Explore.

### D3 — One primary theme, several overlays

One primary theme controls base-edge color and line style. This prevents a map
whose colors have several contradictory meanings. Initial themes are:

- **Neutral**
- **Bicycle traversal**
- **Raw bicycle/access tags**
- **Directionality**
- **Road/highway class**
- **Surface/track quality**
- **Source and review state**

Independent overlays can then add:

- repeated direction arrows;
- CycleWays segments;
- manual base edges;
- roundabouts;
- crossings; and
- selection/related-feature highlights.

Every theme and overlay has a visible legend. Color is never the only signal:
direction uses arrows, unknown/conditional states use distinct dash/pattern
treatment, and selection uses a halo.

### D4 — Raw data and normalized policy are different facets

The editor must not present `bicycle=no` and “prohibited” as synonyms.

- A **raw tag** filter answers what the source says.
- A **normalized verdict** filter answers what routing enforces.
- A **reason** filter answers which rule produced the verdict.
- A **review/override** filter answers whether a curator has superseded or
  confirmed source evidence.

For example, an edge may have no `bicycle=no` tag but still be reverse-blocked
by `oneway=yes`, or may have `access=no` overridden by `bicycle=yes`. The detail
panel always shows the raw tags, both directional normalized states, reason
codes, policy ID/digest, and override provenance together.

### D5 — Filters compose and presets are ordinary saved filter definitions

The first filter facets are:

- source: OSM or manual;
- raw tags: bicycle, access, vehicle, foot, oneway, junction;
- normalized forward/reverse state;
- normalized reason code;
- highway/route class;
- surface, tracktype, and smoothness when present;
- CW relationship: referenced by published alignment, staged/draft only, or
  not referenced;
- override state: none, current, or stale;
- optional review annotation: unreviewed, confirmed source, follow-up, stale;
- derived membership: roundabout/crossing-related when loaded; and
- text/ID search across edge ID, share ID, OSM way ID, name, and CW segment ID
  or name.

Built-in presets seed these facets and theme without creating separate code
paths:

- Bicycle prohibited by raw tag
- Any normalized bicycle restriction
- CW access conflicts
- All direction-limited edges
- Conditional traversal (unknown remains fail-closed but is not a current
  review preset)
- Unreviewed manual edges
- Current OSM overrides
- Stale evidence
- Roundabout context
- Crossing context

“Reset” returns to all edges with the default Bicycle traversal theme. The
last explorer view is stored locally in the browser; it is never committed to
repository data.

### D6 — Counts distinguish edges from review subjects

The result summary shows:

- matching base edges;
- matching source OSM ways/manual features;
- matching results in the current viewport; and
- affected CW segments when applicable.

Filtering always applies to edges for map rendering. Review grouping depends
on the active lens:

- access and OSM overrides group by source OSM way;
- manual direction review groups by manual edge;
- base topology investigation may group by atomic base edge;
- roundabouts group by logical roundabout candidate;
- crossings group by logical crossing candidate.

Selecting OSM way 57116180 therefore highlights all of its split base edges,
shows the individual edge IDs, and offers one whole-way override action.

### D7 — The map is primary; the list is optional

The side panel contains compact theme, preset, filter, count, and overlay
controls. It does not open with a 48,000-row queue. A collapsible **Results**
section lists the current grouped subjects when useful.

Clicking the map opens the inspector and keeps the current zoom. A separate
“Fit subject” action is available; selection itself does not unexpectedly zoom
out. Search may fit because the user explicitly requested a specific result.

### D8 — Inspection target is explicit

Visible overlays must not hide or steal base-edge interaction. The workspace
has an **Inspect** target:

- Base edges (default)
- Roundabouts
- Crossings
- CW segments

Only the active target's hit layers own an ordinary click. Other overlays stay
visible but non-interactive. This addresses the existing class of problems
where clicking a highlighted CW line reselects the segment instead of the base
edge beneath it. Edit mode always gives manual/base-edge editing hit layers
priority.

### D9 — The inspector explains impact and authority

For a selected base edge or grouped OSM way, the inspector shows:

- identity: edge ID, share ID, OSM way ID/slice, manual ID;
- A/B stored orientation and repeated arrows;
- geometry length and all split members of the selected source way;
- raw review-relevant tags, including missing values;
- normalized forward/reverse traversal, reason, policy ID, and digest;
- whether the display is source-derived, manually reviewed, or overridden;
- override rationale, evidence, reviewer, date, and freshness;
- optional non-authoritative review annotation and freshness;
- referenced published/staged CW segments with links to CW Overlay;
- derived roundabout/crossing membership when loaded;
- OSM link and a copyable identity summary; and
- a plain-language explanation such as “Blocked both directions because
  `bicycle=no` is the winning bicycle-specific access tag.”

The inspector reuses the existing base-edge direction policy editor. Creating
or removing an OSM override remains an intentional reviewed action requiring
both states, rationale, evidence, reviewer, and date.

### D10 — Review is optional and starts from the current view

The button is **Review filtered results**, not “Review all.” It snapshots the
current grouped subject IDs so changing the map extent does not reorder the
session. Review mode adds Previous/Next and progress within that snapshot.

Available access-review outcomes are:

- **Confirm source** — remember that the current source and normalized policy
  were inspected and appear correct; no routing change;
- **Needs follow-up** — persist a note/bookmark; no routing change; and
- **Create/update override** — use the existing authoritative traversal
  override workflow; routing changes only after rebuild.

Skipping an item records nothing. Ending a review session leaves every skipped
item unreviewed and has no build or promotion consequence.

The editor defaults reviewer to `ohad` and the local current date, consistent
with the recent direction-review workflow, while keeping both editable.

### D11 — Optional annotations are not routing authority

Add source-controlled `data/base-network-reviews.json` for lightweight explorer
annotations. V1 supports access reviews of an OSM way:

```json
{
  "schemaVersion": 1,
  "reviews": {
    "access:osm-way:57116180": {
      "lens": "access",
      "subject": {
        "kind": "osm_way",
        "id": "57116180",
        "sourceDigest": "66a3b789..."
      },
      "status": "confirmed_source",
      "note": "",
      "reviewer": "ohad",
      "reviewedAt": "2026-07-18",
      "updatedAt": "2026-07-18T...Z"
    }
  }
}
```

Allowed V1 statuses are `confirmed_source` and `needs_follow_up`. A changed or
missing source digest makes the annotation stale in the explorer. It does not
block build or promotion. The record cannot contain traversal states and
cannot change routing.

Authoritative decisions remain where they are today:

- OSM corrections: `data/bicycle-traversal-overrides.json`
- manual-edge traversal policy: `data/manual-base-edges.geojson`
- roundabouts: `data/roundabout-review.json`
- crossings: their existing crossing review artifact
- CW directional alignments: Overlay V2 and Direction Review workspace

This shares the experience without conflating decision semantics.

### D12 — Source changes invalidate evidence predictably

An OSM source-way review and traversal override bind to the unsplit source-way
geometry digest. The explorer derives:

- `current` when the identity and digest still match;
- `stale` when the way exists but the digest changed; and
- `orphaned` when the way disappeared.

Stale annotations are warnings only. Stale authoritative traversal overrides
retain their existing fail-closed build behavior. The inspector clearly says
which kind of stale record it is and which action is required.

### D13 — Roundabouts and crossings share the shell, not the schema

The final Base Network workspace can draw roundabout and crossing layers at the
same time as access/direction data. Selecting the relevant Inspect target opens
their current specialized details and actions.

Migration is incremental:

1. keep current top-level Roundabouts and Crossings workspaces;
2. make them loadable as read-only Base Network overlays;
3. move their panels into specialized Base Network lenses with full parity;
4. remove the old top-level buttons only after automated and manual parity
   checks pass.

Their generated candidate artifacts, fingerprints, review files, publication
gates, and runtime artifacts do not change as part of this work.

### D14 — Routing never reads explorer state

Themes, filters, presets, local view state, results, review sessions, and
non-authoritative annotations are editor-only. They never enter routing assets.

Only an existing authoritative action can affect routing:

- saving/removing an OSM traversal override;
- changing reviewed manual-edge traversal states; or
- editing manual edge geometry.

Those actions continue to mark graph, policy audit, and Direction Review
evidence stale until rebuilt. Merely confirming source data does not.

## Base traversal theme

The default theme emphasizes exceptions without drowning the map:

| Aggregate state | Meaning | Presentation |
| --- | --- | --- |
| allowed / allowed | bidirectional | muted blue-green line |
| one allowed, one prohibited | direction-limited | stronger blue line plus repeated permitted-direction arrows |
| prohibited / prohibited | unavailable for riding | red line with cross-hatch/dash treatment |
| any conditional | condition not evaluated in V1 | amber line plus dotted treatment |
| any unknown | insufficient/conflicting evidence | purple line plus long dash |

The raw-access theme instead colors the winning/raw tag categories. The legend
must explicitly label which theme is active so the user never mistakes raw OSM
data for the normalized routing outcome.

Reverse-only arrows reuse the established direction-layer helper and reverse
display geometry so arrowheads point in the actually permitted direction.

## Explorer state and derived projection

The editor already loads the complete graph in
`state.baseOverlay.graphEdges`. The explorer adds ephemeral client state:

```js
{
  mode: "explore", // explore | edit | review
  theme: "traversal",
  preset: null,
  inspectTarget: "base_edges",
  filters: {
    source: [],
    rawBicycle: [],
    rawAccess: [],
    forward: [],
    reverse: [],
    reasons: [],
    highway: [],
    routeClass: [],
    cwRelation: [],
    overrideState: [],
    reviewState: [],
    search: ""
  },
  overlays: {
    arrows: true,
    cycleways: true,
    manualEdges: true,
    roundabouts: false,
    crossings: false
  },
  selectedSubject: null,
  reviewSession: null
}
```

A pure projection builds small ephemeral explorer properties once per graph or
relationship-data refresh. It may enrich feature properties in the in-memory
map source, but those properties are never sent to a save API. Filter changes
use Mapbox filter/paint/layout expressions and one-pass facet calculation; they
must not clone or resend the 48,000-edge GeoJSON on every interaction.

Derived indexes include:

- edge ID → feature;
- OSM way ID → ordered split features;
- edge ID → published/staged CW references;
- way/manual identity → review annotation;
- way ID → current traversal override; and
- edge ID → derived feature memberships when those datasets are loaded.

## Search contract

One search control accepts:

- base edge ID (`e57116180_1`);
- base edge share ID;
- manual edge ID;
- OSM way ID (`57116180`);
- CW segment ID (`#19` or `19` when the CW facet is explicit); and
- names from base-edge or related CW properties.

Exact identities rank before fuzzy names. When several matches exist, the
results section shows them without choosing arbitrarily. Search-selected
subjects are allowed to fit the map because the user explicitly requested
location.

## API behavior

The existing graph, overlay, traversal-override, roundabout, and crossing APIs
remain authoritative.

Add:

- `GET /api/base-network-reviews`
- `POST /api/base-network-reviews`

The server validates schema, allowed lens/status/subject combinations, review
metadata, unique keys, and the current OSM source digest. Writes are atomic.
The endpoint rejects traversal states or other fields that could be mistaken
for routing authority.

The client computes filtering and facet counts locally; there is no query API
for ordinary exploration.

## Offline and performance contract

- Exploration uses the already prepared full graph and local review artifacts.
- A missing graph produces the existing clear prepare/rebuild instruction, not
  an empty authoritative-looking map.
- Remote basemap tiles, satellite imagery, and OSM links are optional context.
- The local blank/base style remains sufficient to inspect geometry, arrows,
  raw tags, policy reasons, CW relationships, and review state.
- Filter/theme changes update existing layers rather than replacing the graph
  source.
- Text filtering is debounced; facet calculations are linear in the current
  48,000-edge graph and run only when filter state changes.
- Lazy-load roundabout and crossing candidate data only when their overlay or
  inspect target is enabled.
- The Results list is virtualized or capped with progressive rendering; it
  never creates tens of thousands of DOM nodes.

## Accessibility and usability

- Every map category has a textual legend and non-color distinction.
- All controls have labels and keyboard focus states.
- Results, inspector, and review navigation are usable without map clicks.
- Previous/Next retain map zoom unless explicit Fit is used.
- Counts announce both edge and grouped-subject units.
- Empty results explain which filters are active and provide Reset.
- Explore/Edit/Review state is always visible; destructive controls never
  appear in Explore.
- Hebrew source names render correctly; editor control copy remains English to
  match the current editor.

## Example: investigating #19

1. Open Base Network in Explore mode.
2. Choose preset **Bicycle prohibited by raw tag**.
3. Keep the CW overlay enabled.
4. The map draws all 120 matching edges, grouped in the summary as 73 OSM
   ways; the way overlapping #19 is visibly highlighted as a CW conflict.
5. Select way 57116180. The inspector highlights its base edge
   `e57116180_1`, shows `bicycle=no`, `foot=yes`, both normalized states as
   prohibited, and the `explicit-access-prohibited` reasons.
6. If the curator only wants to understand the data, stop. Nothing is written.
7. If the curator wants to record that the restriction is correct, choose
   Confirm source.
8. If the source is known to be outdated, create a reviewed allowed/allowed
   OSM override using the existing evidence form, rebuild, refresh Direction
   Review evidence, and accept #19's two alignments.

## Common uses and future lenses

The first implementation concentrates on access, direction, source, road
classification, and relationships already present in the loaded editor data.
The shell is deliberately reusable for later questions:

- **Access quality** — `bicycle=no`, `access=no/private`, conditional access,
  bicycle-specific exceptions, foot-only paths, and conflicting tag
  combinations.
- **Direction quality** — all one-way/reverse-only edges, contraflow conflicts,
  roundabout-implied direction, conditional direction, and one-way dead ends.
- **Manual-data health** — unreviewed manual policy, manual geometry duplicated
  by newer OSM data, stale copied-source identity, and unused manual edges.
- **CW mapping health** — published/staged alignments using prohibited, unknown,
  missing, discontinuous, endpoint-drifted, or conflicting base evidence.
- **Topology** — isolated components, dangling endpoints, near-miss gaps,
  duplicate/parallel edges, extremely short connectors, missing splits, and
  suspicious self-intersections. These require generated diagnostics beyond
  the initial property filters.
- **Ride suitability** — surface, smoothness, track grade, steps, incline,
  barriers, gates, fords, bridge/tunnel state, and high-speed road classes.
  Displaying these facts does not silently turn them into routing permissions
  or costs.
- **Derived junction features** — roundabouts, crossings, and future reviewed
  junction/turn-restriction features over the same underlying edges.
- **Routing explanation** — select an edge or route and explain why the common
  policy allowed, rejected, or penalized it. Cost/frequency simulation remains
  owned by the Connector Navigation Lens and can later appear as another
  specialized lens.
- **Freshness and provenance** — OSM changes since a review, stale overrides,
  source/manual replacements, orphaned decisions, and build evidence age.
- **Impact prioritization** — edges used by published CW alignments, route
  catalog entries, test scenarios, approach-to-start paths, or rejoin paths.
  Route-usage indexing is deferred, but the filter model leaves room for it.

New lenses may add generated diagnostic properties or lazy-loaded feature
datasets. They must still obey the same rules: exploration is read-only,
authority is explicit, raw evidence is distinct from interpretation, and a
domain-specific decision remains in its domain artifact.

## Acceptance criteria

- Opening Base Network shows the full graph without requiring a queue decision.
- The `bicycle=no` preset draws all matching edges and reports both edge and
  distinct-way counts.
- Raw tag and normalized-policy filters produce demonstrably different results.
- Selecting one split edge can inspect and highlight its complete source way.
- #19/way 57116180 is discoverable visually without knowing its base edge ID.
- A CW-conflict preset links directly to the affected CW segment and its two
  directional alignments.
- Explore mode cannot mutate geometry, traversal policy, or review files.
- Confirm source writes only a digest-bound non-authoritative annotation and
  does not mark the graph stale.
- Creating/removing an OSM override continues to require evidence and marks the
  graph/policy/Direction Review stale.
- Base-edge clicks remain reliable when CW, roundabout, or crossing overlays are
  visible.
- Roundabout and crossing specialized review behavior is unchanged until its
  incremental migration reaches parity.
- Existing direction, roundabout, crossing, build, and routing tests remain
  green.

## Decisions deliberately deferred

- User-created named presets committed to the repository.
- Sharing explorer views by URL.
- Route-catalog and real-usage frequency heatmaps.
- Automatic ranking from OSM history, Mapillary, or external imagery.
- Bulk creation of access overrides.
- Automatic upstream OSM edits.
- New routing preferences based on surface/comfort/safety scoring.
- A generic review schema that replaces the domain-specific review artifacts.
