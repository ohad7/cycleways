# Ride feedback round 3 — discussion

**Date:** 2026-07-13
**Status:** directionality/ride fixes and crossing code implemented; crossing data rollout/manual validation and S3/S4 remain open
**Ride:** ~10.0 km, Kiryat Shmona → גן הצפון (via כביש 99, שביל תל חי, כביש 90 כפר גלעדי,
כבישון עגל, כביש 9974 כפר יובל, שדות כפר יובל, שביל אופניים 99, גן הצפון).
Ridden on the iOS app; every reported issue reproduces in the simulator SIM
scenario over the shared route token.

## Implementation status — 2026-07-14

- Directional bicycle-policy code, editor review tooling, and staged assets are
  implemented, but curation, Road 99 visual acceptance, and the atomic Gate D
  production promotion remain open.
- M2 via-point spur avoidance is implemented; its automated Road 99 replay
  passes and the repaired closed-way joins remain in the shared manual visual
  gate.
- M3 split-turn merging and M4 cue-geometry cleanup are implemented. The ride
  has 19 ordinary turn cues, no false 154° cue, and one merged 105° left.
- C1 follow-camera padding now transitions for 500 ms inside the existing
  camera owner; automated camera and journey suites pass, with original-ride
  SIM visual acceptance pending.
- M1/S2 first-class crossing code is implemented: one logical crossing can own
  multiple directed base-edge mappings, and runtime uses confirmed mappings
  only. Stable-share/direction curation and manual acceptance remain open. S3
  segment-distance confirmation and S4 car-road entry warnings remain open.

Focused design and validation records live in
[`bicycle-traversal-policy`](../bicycle-traversal-policy/design.md),
[`via-point-spur`](../via-point-spur/design.md),
[`navigation-geometry-cleanup`](../navigation-geometry-cleanup/design.md),
[`navigation-camera-padding`](../navigation-camera-padding/design.md), and
[`road-crossing-maneuvers`](../road-crossing-maneuvers/design.md).

### 2026-07-14 crossing implementation update

The reviewed-crossing pipeline and navigation behavior are now implemented.
Only editor-confirmed directed mappings can produce a crossing cue, and the
same attestation matcher is used on the effective main route, approach route,
and rejoin route. The cue replaces corners inside the reviewed action interval
while preserving and optionally compounding the following roundabout.

No Road 99 crossing has been silently accepted. Candidate generation currently
stops because the released stable-share registry is 475 edges behind the
48,856-edge elevated graph, and publication would also reject the relevant
`manual-unreviewed` Road 99 direction evidence. Those are intentional rollout
gates. With a temporary complete registry the detector found the target as
`crossing:1092567462:33.2351-35.5800:48308`, confirming graph-wide discovery
without a coordinate special case. The complete automated suite and production
web build pass; remote editor/simulator/audio validation remains pending.

On 2026-07-15 a headless before/after replay validated the rider-visible
effect without requiring the simulator. The 10,111.568 m route and content
fingerprint remained identical; turns changed from 19 to 17, one crossing was
added, all six roundabouts remained, and the instruction at 3,822 m changed
from `פנה ימינה ומיד שמאלה` to
`חצו בזהירות לצד השני של הכביש, ואז בכיכר המשיכו ישר`. The replay also found
and fixed matching across two adjacent attestation slices of departure edge
48320. This is now covered by the focused crossing suite, but the mapping is
still injected test evidence rather than accepted production data.

## How the diagnostic was made

- The route token decodes with `decodeRoutePayload` (hybrid v6, graph
  `hf03acd80`, shards `g711_664`/`g712_664`, 11 route points, 10 spans).
- `node scripts/inspect-route-cues.mjs <token>` regenerates the exact cue list
  the app used (283 geometry points, 31 junction-gated cues). Every distance
  in the rider's feedback ("9.5 km before the end", "7.7 km", "1.5 km"…)
  matched a cue at `total − reported` meters, so the whole ride was replayed
  offline against real code and real data.
- Raw geometry was dumped around each complaint site with per-vertex turn
  angles, plus the **net** bearing change measured over robust ~18 m arms —
  the single most informative measurement in the whole analysis.
- Base-graph edges along the route were dumped from the compact shards
  (attributes: `highway`, `routeClass`, `roadType`, `accessStatus`,
  `cwSegmentIds`).

## The ten feedback items, classified

| # | Reported | Where | Classification |
|---|----------|-------|----------------|
| 1 | UI jump as the first voice command begins | ~9.8 km to end (first cue preview) | Bug — camera padding snap (C1) |
| 2 | "turn right and then left" while riding the right side | 482 m (9.5 km to end) | Crossing jog narrated literally (M1) + side-of-road routing (R1/R2) |
| 3 | "turn right and then right", small out-and-back visible on the route | 945 m (9.0 km to end) | Route-construction bug — via-point spur (M2) |
| 4 | Roundabout-left not remembered; wanted a "cross the street" instruction | 996 m | UX gap — crossing as a maneuver (M1/S2) |
| 5 | "פנה ימינה אל שביל תל חי ואחר כך שמאלה" — no left turn exists | 2,226 m (7.7 km to end) | M1 + joint-vertex noise (M4) |
| 6 | Long silent stretch; wanted "continue on שביל תל חי for 1.5 km" | 2,238–3,778 m | UX gap — data already exists (S3) |
| 7 | "turn left then left" announced; truth is cross to the other side and continue | 3,778 m (6.3 km to end) | M1 + M4 |
| 8 | Wanted a "car road, ride carefully" warning | 4,878 m onward (כביש 9974) | UX gap — data exists but not promoted (S4) |
| 9 | Field navigation in שדות כפר יובל was perfect | 6,266–7,595 m | Baseline that works — protect it |
| 10 | "turn left … and right away turn left" — second left is redundant | 8,579 m (1.5 km to end) | Split-turn bug (M3) |

The most important classification outcome: **items 2, 4, 5 and 7 are one
phenomenon** (the route crossing the road, narrated as fake turn pairs), and
items 3 and 10 are two *different* bugs that merely sound similar to it.

## Root-cause mechanisms (instruction/geometry layer)

### M1 — Road-crossing jogs narrated as turn pairs

Where the route crosses from one side of a road to the other, the geometry
contains a 12–20 m sideways jog between two roughly parallel ways. The cue
builder (`packages/core/src/navigation/navigationCues.js`) emits both sharp
corners and the compound linker (60 m window) chains them into
"turn X ומיד Y". Measured net bearing change across the jogs:

| Site | Announced | Net maneuver over 18 m arms |
|------|-----------|------------------------------|
| 482 m | turn right 87° then left 87° | **0°** — pure sidestep; the jog is base edge 26114, a 12 m cross-link between the two parallel roadways |
| 2,226 m | turn right *154°* onto שביל תל חי then left 62° | **43° right** — a gentle right with an embedded crossing; the "left" does not exist |
| 3,778 m | turn left 110° then left 74° | **8°** — essentially straight, crossing the road at the roundabout before כביש 90 |

These jogs are *real route geometry* — the route genuinely crosses — so this
is not a narration bug to suppress but a missing maneuver vocabulary:
the honest instruction is **"חצו את הכביש לצד השני"**. In base-graph spans the
crossing is a distinct short edge (detectable structurally); inside CW segment
polylines it is drawn geometry (detectable geometrically: short jog, two large
opposite corners, near-zero net). No OSM crossing tags are needed to detect it,
though `highway` values can boost confidence.

### M2 — Via-point out-and-back spur (item 3)

The clicked via point snapped to base edge e579386193_2 (shareId 29897, a
service road) at fraction 0.944 — 5.6 m inside the edge. The encoded route
contains that edge traversed **reverse then forward** across the point: the
route walks 5.6 m into the edge, U-turns, and walks back. Net maneuver 0°.
The 180° corner in the middle falls under the 10 m turn-spacing filter, so the
rider hears the two flanking ~90° corners as "turn right and then right" — for
a maneuver that should not exist. This is a route-construction defect: when
adjacent legs share an edge in opposite directions, the overlap should be
trimmed (or a tiny spur's via point snapped to the junction node). No
instruction-layer change should paper over it.

### M3 — One physical turn split into two cues (item 10)

The turn onto שביל אופניים 99 כפר יובל is a single ~105° left drawn as two
52°/53° corners 20 m apart. Both clear the 40° turn threshold at a junction, so
both become cues, and the compound linker announces "turn left ומיד שמאלה" for
what the rider experiences as one left turn. Same-direction corner pairs within
~25–30 m should be merged into a single cue with the summed angle *before*
compound linking.

### M4 — Duplicate vertices at span/run joints

Stitched geometry has near-duplicate vertex pairs 0.1–0.2 m apart at span/run
boundaries — this is coordinate-quantization scale (1e-6°), so bearings across
them are pure noise. They are mostly masked by the 10 m spacing filter but they
corrupt adjacent real cue *angles and directions* (the absurd "154°" at
2,226 m; a hidden −140° corner at 3,778 m). A dedupe pass (< ~1 m) at geometry
assembly is cheap, safe, and makes every downstream angle trustworthy — worth
doing before M1/M3 logic, which becomes much easier on clean geometry.

## C1 — The UI jump at the first voice command (item 1)

Two changes fire at the same moment, by design, when the first cue enters its
120 m preview window (which is also what triggers the voice):

1. `NavPanel` swaps modes: until then the HUD shows only the bottom road pill;
   at the first active cue the top cue card mounts and the road pill unmounts.
   Both report layout via `onCameraLayout`, and
   `navigationCameraAdapter.applyFollow` recomputes camera **padding** from the
   overlay insets with `animationDuration: 0`. Pitch and zoom are eased
   (`cameraTimeline.js`, zoom velocity-limited), but padding is not — the map
   snaps vertically.
2. Nearly simultaneously the camera stage flips `ride` → `pre-turn`
   (`cameraDirector.js`, 140 m gate): pitch 55°→38° plus zoom-in. This part is
   eased over 900 ms but stacks on the padding snap into one perceived lurch.

It is most visible at the *first* cue because that is the only time the top
card mounts from nothing. Fix direction: ease padding/anchor-inset changes in
the follow loop, and/or keep the top card container mounted at stable height
from ride start.

## The routing discussion: cost models, side-of-road, directionality

### Which cost model actually plans routes (validated)

An early assumption in the discussion — that `connectorCostModel.js` drives
route planning — was **wrong**, and checking it mattered:

- **Planner model** (painting points on the map):
  `route-manager.js:1125` `_baseRoutingCostMultiplier`, default profile —
  CW-network edge **1**, `cycle` 1.35, `path_track`/`manual` 1.6,
  `local_road` 2.2, `road` **4**, other 2.5, uphill ×8.
- **Connector model** (`connectorCostModel.js`, cw_network 0.8 / road 1 /
  local_road 4): reachable only via
  `previewBaseRoute({ costProfile: "connector" })`; the single app call site is
  `shardedRouteSession.computeConnector` — the navigation approach-to-start /
  rejoin leg. The editor's connector preview is the only other consumer.
- Both costs are pre-baked per **directed** adjacency entry at network load
  (`_addBaseRoutingAdjacency`, route-manager.js:1053) as `cost` /
  `connectorCost`.

Two consequences: the planner's pull onto CW segments is strong (4× vs 1× on
roads), and there is a **third mechanism** acting before any search — the
click-snap CW preference (`route-manager.js:11–28`, applied in
`_snapToBaseRoutingNetwork`) moves a clicked point onto a CW edge up to
~20 m / 12 px from the geometrically closest edge. A start/via point can land
on the far-side path at snap time, before routing runs at all.

### The oneway data-loss bug (highest-severity finding of the discussion)

Roads like Road 99 are dual carriageways: **two separate base edges, one per
travel direction**. Riding against the carriageway direction is illegal in
Israel and dangerous — this is a hard constraint, not a preference.

The verified chain, end to end:

1. **OSM has the data.** Both Road 99 carriageway ways (1006452932, 1024904326,
   both `highway=trunk`) are tagged `oneway=yes`. It is not a niche case:
   **3,883 of 48,368 edges** in `build/osm/osm-base-edges.geojson` carry
   `oneway=yes`.
2. **The pipeline preserves it — until the last step.** `fetch_osm_network.py`
   spreads all OSM tags into feature properties; `build_osm_base_graph.py`'s
   `clean_properties` keeps them; `build/osm/osm-base-edges.geojson` still has
   `oneway: "yes"`. Then `pack_compact_base_routing_shard`
   (`processing/build_map.py:273`) serializes exactly five attributes —
   `source`, `routeClass`, `highway`, `accessStatus`, `roadType` — and
   **drops `oneway`**. The app never sees it.
3. **The router treats every edge as two-way.** `_addBaseRoutingAdjacency`
   unconditionally adds forward and reverse entries.
4. **CW membership rewards the illegal traversal.** In the shards,
   `e1024904326_1` (shareId 370, one carriageway) carries `cw=[174]`
   (כביש 99 קריית שמונה); the parallel `e1006452932_1` (shareId 19) carries
   `cw=[]`. Traveling in the direction served by shareId 19, the router
   compares multiplier 4 (trunk, no CW) against multiplier 1 (CW) and routes
   onto the oncoming carriageway. **The ride token contains it**: span 2→3 ends
   with edge 370 traversed `reverse` — 547 m against traffic on a trunk
   carriageway.

So the correct classification of the "algorithm put me on the left side"
feeling: **the graph is missing oneway, and one-sided CW membership on dual
carriageways then makes the illegal traversal the cheapest option.** A
crossing penalty would not fix this — no legal route exists on that edge in
that direction at any price.

### Directionality taxonomy (from the discussion)

The existing per-segment `roadType` already separates the cases, and they need
different treatment:

- **`roadType: "road"` (shared car roads — e.g. 174 כביש 99, 159 כביש 90).**
  Geometry is a centerline; the rider is on the right by law in either travel
  direction. No side/direction choice exists *within* the segment. Where the CW
  recommendation is genuinely one-directional (safe shoulder on one side only,
  descent direction), that is an **editorial attribute** for the editor to own,
  not something derivable from geometry. On dual carriageways the segment maps
  to oneway base edges — see the bug above.
- **`roadType: "paved"` separated side-paths (164 שביל תל חי, 97/326
  שביל אופניים 99).** Geometry is the path itself, on one side of a road,
  typically legally two-way. Direction tags are mostly the wrong knob here; the
  real cost of using a far-side path is the **two crossings** to reach and
  leave it.
- **On-road lanes/shoulders** (not in the current data vocabulary): genuinely
  one-way if ever mapped.

No `direction`/`oneWay` property exists on CW segments today (map-source
properties: id, name, status, roadType, quality, …).

### Turn costs vs crossing costs vs direction tags (architecture fit)

- **Turn costs in general: rejected.** The search is node-state Dijkstra with
  per-directed-edge baked costs; real turn costs need edge-pair state — a
  structural change nothing in this ride demands.
- **Crossing costs are not turn costs, but the original per-edge proposal is
  superseded.** A logical crossing can span multiple directed edge slices, so
  offline candidates and editor-confirmed mappings now provide the topology.
  The first implementation uses that data only for narration. Any later fixed
  equivalent-distance cost must be a separately versioned policy with route-
  delta and no-path validation across planning, approach, and rejoin.
- **Direction tags fit natively where needed**: adjacency entries are already
  directional, so a per-segment `direction` attribute promoted through the
  pipeline becomes a reverse-traversal multiplier (soft penalty, ×2–3) with a
  small change. Soft rather than hard for CW editorial direction — the CW graph
  is sparse and a hard ban can leave a travel direction with no sane route.
  (OSM `oneway` on motor roads is the opposite: hard exclusion, no debate.)

## UX opportunities (data already exists)

- **S2 — "Cross the road" as a first-class maneuver.** A graph-wide offline
  detector proposes logical `side-change` crossings; editor-confirmed directed
  mappings feed the voice/card instruction ("חצו את הכביש לצד השני"). Runtime
  geometry does not classify crossings, and route cost is a separate future
  rollout. Bike navigation that says this instead of a nonsense turn pair is a
  real differentiator — arguably the category gap the rider sensed ("I don't
  think even Google Maps realizes this").
- **S3 — "Continue on X for N km."** `segmentSpans` already carry name +
  start/end meters; an `enter-segment` cue type already exists (currently
  final-phase-only, suppressed near turns). Adding remaining-length to the turn
  phrase ("פנה ימינה אל שביל תל חי, והמשיכו עליו 1.5 קילומטר") and to the
  enter-segment cue is small and contained. It is confirmation, not spam — it
  matters most in the long quiet stretches where the rider starts doubting.
  A verbosity setting is easy plumbing later (the voice planner already takes a
  settings object) but should wait for evidence that default-on is too chatty.
- **S4 — Car-road entry warnings.** `data/map-source.geojson` has
  `roadType: "road" | "paved" | "dirt"` per segment and segments carry
  `quality.safety`, but the Build → Promote pipeline does not promote
  `roadType` into `segments.json`. Promote it, and navigation can announce on
  entering a `road` span: "ממשיכים על כביש 9974, שימו לב לרכבים". Base-graph
  spans can use the edge `highway` class (trunk/tertiary → caution). Narrow-
  place-specific warnings need data that does not exist; the honest version is
  a per-span caution flag in the editor, which fits the existing
  hazard/caution cue type already wired to voice.

## Proposed solutions, in priority order

1. **Oneway enforcement (safety/legality — first).**
   Thread `oneway` through the compact shard format (writer
   `processing/build_map.py`, reader `compactBaseRoutingShard.js` — already
   versioned, schema bump per the `shareId` v2 pattern), then skip the reverse
   adjacency entry for oneway edges. Hard exclusion. Honor the standard OSM
   cases while there (tags are already in the fetched data): `oneway=-1`,
   `oneway:bicycle=no` / `cycleway=opposite*` (legal contraflow), and
   `junction=roundabout` implied oneway (worth checking roundabouts are not
   routable backwards today for the same reason). Existing shared tokens stay
   safe: `restoreBaseRouteFromPayload` replays stored edges without
   re-searching; only new searches change.
   **Follow-up decision it forces:** for each corridor where CW blesses one
   carriageway, what serves the opposite direction — paint CW on the other
   carriageway, a parallel path, or nothing. Make it tractable with a report of
   every CW segment whose matched base edges include a oneway edge
   (`match_cycleways_to_osm_graph.py` holds the matching knowledge).
2. **Mechanical instruction bugs, independent and testable:**
   M4 vertex dedupe → M3 same-direction merge → M2 via-point spur trim →
   C1 camera padding easing.
3. **Crossing as a first-class concept:** graph-wide offline candidate
   generation plus editor-reviewed logical crossings with multiple directed
   base-edge mappings, feeding the "חצו את הכביש" instruction (S2) only.
   Crossing-aware route cost and click-snap behavior are deferred until the
   confirmed topology has separate policy and route-delta validation.
4. **Quick data-backed wins:** continue-on-segment distance phrase (S3);
   promote `roadType` and speak car-road entry warnings (S4).
5. **Later / as needed:** editorial `direction` attribute on CW segments (soft
   reverse penalty, corridor-by-corridor starting with Road 99); verbosity
   setting; narrow-place cautions (needs new data).

## Principles that emerged

- **Fix the route vs narrate the route are separate layers.** Item 3 was a
  wrong route, not a hard-to-narrate one; no instruction layer should narrate a
  defect well. Keeping each layer correct on its own is what keeps the system
  debuggable.
- **Legality is a graph constraint, not a cost.** Preferences (CW pull,
  crossing avoidance, editorial direction) are multipliers; illegal moves must
  not exist in the search space.
- **Net-maneuver measurement over robust arms** (vs raw per-vertex angles) is
  the right lens for instruction generation, and the diagnostic tool of choice
  for future ride feedback.
- Even with perfect routing, crossings remain in legitimate routes — the
  crossing instruction is needed regardless of the routing fixes. They are
  complements, not alternatives.
