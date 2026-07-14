# First-class road-crossing maneuvers

**Date:** 2026-07-14
**Status:** implementation-ready design; implementation not started
**Origin:** M1/S2 in `plans/navigation-ride-feedback-3/discussion.md`

## Outcome

When a bicycle route makes a short lateral jog to reach the other side of a
road, navigation will present one honest **cross the road** maneuver instead of
two literal turn instructions. The route geometry remains unchanged and the
following real decision remains visible and speakable.

For the corrected Road 99 replay, this means the remaining right/left pair at
about 3,822–3,838 m becomes one crossing instruction, followed by the existing
straight-through-roundabout instruction. This work does **not** change the
current 10,111.6 m route or its directional legality.

## Major decisions

| Decision | Chosen direction | Consequence |
|---|---|---|
| What is a crossing? | A route-local maneuver spanning a short interval, not a zero-length point and not two turns. | The cue has both start and completion distances. |
| Detection authority | Conservative geometry plus lightweight context from the actual routed base traversals. Very strong geometry may be accepted when context is unavailable. | We can recognize current base-edge crossings and crossings drawn inside a CW polyline without querying OSM while riding. |
| False-positive policy | Fail open to the existing turn/bend cues. Only high-confidence candidates become crossings. | A missed crossing retains usable literal guidance; a doubtful chicane is not mislabeled as a road crossing. |
| Effect on route choice | None in this implementation. | Inferred narration cannot silently introduce detours or make a route unavailable. |
| Future crossing cost | Only confirmed, curator-reviewable crossing records may influence routing. | Candidate inference and routing authority remain separate confidence gates. |
| Following maneuvers | Keep the following cue and allow a compound crossing-then-turn/roundabout instruction. | The reported roundabout is not forgotten or suppressed. |
| Surfaces | Cue semantics, text, scheduling, haptics and camera behavior live in shared core; the native app adds a dedicated crossing glyph. | Main-route, approach and rejoin guidance use the same behavior; another UI can render the same descriptor. |
| Persistence | Bump the maneuver generator to `navigation-cues-v3` and bind the new inputs into the navigation-plan fingerprint. | A stored v2 cue plan cannot silently resume as if it were a v3 plan. |

The most important correction to the original discussion is the fourth row:
one inferred detector will **not** directly feed both speech and route cost.
Narration and routing have different failure severity. A mistaken spoken
crossing can fall back to ordinary cues; a mistaken crossing penalty can cause
a long detour or no path. Routing cost therefore requires confirmed network
data and is a later, separately gated change.

## Scope

This plan includes:

- a first-class `crossing` cue type;
- conservative detection of short road-crossing jogs;
- route-context metadata needed by that detector;
- replacement of the matched corner pair by one cue;
- crossing voice, card, icon, haptic and camera behavior;
- crossing-to-turn and crossing-to-roundabout compounds;
- deterministic persistence/versioning;
- replay and negative-fixture validation.

This plan does not include:

- changing route geometry;
- relaxing or replacing bicycle directionality policy;
- charging a crossing penalty during path search;
- inventing turn-pair costs in Dijkstra;
- editor curation of confirmed crossings;
- traffic-light, zebra-crossing or legal right-of-way claims that the data does
  not support;
- generic warnings for entering a motor road (S4 is a separate item).

## Why the maneuver is an interval

The reported crossings are 12–20 m sideways movements. The rider starts the
action at the first corner and completes it at the second. Treating the action
as a point loses information needed for three behaviors:

1. the two corner cues must be suppressed across the full interval;
2. the gap to a following maneuver must be measured from crossing completion;
3. reverse, clipped and loop-rotated effective routes must preserve the same
   physical interval.

The cue contract is therefore:

```js
{
  type: "crossing",
  crossingKind: "road",
  distanceMeters: 3821.8,
  completionDistanceMeters: 3837.8,
  entryDirection: "right",
  evidence: {
    source: "geometry+route-context",
    confidence: "high",
    reasonCode: "short-opposite-corners-road-context"
  },
  thenManeuver: { type: "roundabout", direction: "straight" }
}
```

`entryDirection` is diagnostic only. It must not make the user-facing crossing
instruction sound like a turn. Raw base-edge identifiers do not belong in the
cue or presentation model.

## Route context

### Why `segmentSpans` are not enough

`segmentSpans` answer a product question: which named CW segment is the rider
on? Adjacent unnamed traversals are currently merged even when their road
classes differ. At the remaining reported crossing, the route changes from a
track to a 16 m manual paved connector and then to a trunk-road traversal.
That transition is useful crossing evidence but is intentionally invisible in
the current segment-name spans.

### New `routeContextSpans`

The route manager will derive a second, non-display span list from the ordered
base traversals:

```js
{
  startMeters,
  endMeters,
  routeClass,
  highway,
  roadType,
  source,
  onCyclewaysNetwork,
  edgeShareIds
}
```

Adjacent traversals may merge only when all classification fields match.
`edgeShareIds` are retained for diagnostics and future editor deep links, but
are not shown to riders. The spans are derived evidence, not a second routing
authority.

The spans must follow the same lifecycle as `segmentSpans`:

- route-manager snapshot and reducer state;
- built and restored navigation routes;
- reverse-route remapping;
- linear clipping and circular-route rotation;
- active-plan fingerprinting;
- approach and rejoin routes when their route manager supplies the evidence.

If a legacy or synthetic route has no context spans, cue generation remains
valid and may use only the stricter geometry-only rule.

## Detector

The detector will be a pure shared-core module. It receives cleaned cue
geometry, the pre-roundabout corner candidates, roundabout intervals and
`routeContextSpans`. It returns accepted candidates plus deterministic reason
codes so replay output can explain why a pair was or was not converted.

### Required geometry

A candidate starts with two consecutive sharp corners that:

- turn in opposite directions;
- are approximately 5–35 m apart;
- are each large enough to represent a real lateral movement (initial
  calibration floor: 60°);
- have a robust net heading change no greater than 45°;
- do not overlap an identified roundabout traversal;
- contain no other already-recognized maneuver;
- leave enough route on both sides to measure stable approach/departure arms.

Net heading is measured over robust 15–25 m arms, not from the noisy adjacent
vertices. The constants are starting calibration values, not hidden product
policy; they will be exported or grouped in the detector and locked by tests.

### Confidence gates

Two acceptance paths are allowed:

1. **Geometry plus road context.** The short interval overlaps or immediately
   borders a motor-road/road-class span, and the general 45° net-heading rule
   passes.
2. **Very strong geometry.** Context is absent or cannot see the crossed road,
   but the pair is an almost pure sidestep: both corners are at least 70°, the
   interval is at most 25 m and net heading is at most 20°.

Everything else remains the existing turn/bend sequence. Same-direction pairs,
U-shapes, ordinary switchbacks and two decisions at adjacent junctions are not
crossings.

The context rule may use classifications such as `road`, `local_road`,
`residential`, `tertiary`, `secondary`, `primary` and `trunk`. It must not claim
a road crossing merely because a span is paved.

### Ordering in cue generation

The pipeline becomes:

1. remove sub-metre duplicate cue vertices (existing M4 behavior);
2. extract turn/bend corner candidates and roundabouts;
3. recognize and replace accepted opposite-corner pairs with `crossing`;
4. merge same-direction corners (existing M3 behavior) among what remains;
5. link close maneuvers into compound instructions;
6. add hazards, segment-entry cues and arrival as today.

Crossing recognition must happen before ordinary compound linking; otherwise
the false right/left phrase has already been constructed.

## Cue behavior

### Voice

Hebrew copy:

- preview: `בעוד 120 מטרים, חצו בזהירות לצד השני של הכביש`
- final: `חצו בזהירות לצד השני של הכביש`
- followed by a roundabout: `חצו בזהירות לצד השני של הכביש, ואז בכיכר המשיכו ישר`
- followed by a turn: `חצו בזהירות לצד השני של הכביש, ואז פנו ימינה`

English fallback:

- `Cross carefully to the other side of the road`
- `Cross carefully to the other side of the road, then ...`

The wording deliberately says neither “zebra crossing” nor “safe crossing.” It
describes the required movement and asks for caution without asserting
infrastructure or legal priority that the graph does not know.

The normal 120 m preview and 35 m final scheduling windows apply. Voice dedupe
continues to use cue type, distance and phase. If the compound crossing was not
actually spoken, the following maneuver must retain its own announcement,
matching the existing guarded compound behavior.

### Card and icon

The main card text is `חצו לצד השני של הכביש`; supporting safety copy may use
`בזהירות`. A dedicated glyph shows two road edges with a transverse arrow. It
must not reuse a left/right turn arrow, because that would preserve the exact
misunderstanding this work fixes.

When a following maneuver is linked, the card retains both a primary crossing
descriptor and the existing secondary maneuver descriptor.

### Haptics and camera

- Haptics use the established maneuver pattern: light at preview, medium at
  final. No new “danger” vibration is introduced without a broader safety UX.
- `crossing` participates in pre-maneuver camera framing exactly like a turn or
  roundabout. It does not create another camera stage or owner.
- Camera focus uses the crossing start; maneuver completion is used only for
  compound distance and suppression logic.

## Main route, approach and rejoin consistency

All narrated paths already use `buildRouteCues`; the crossing behavior belongs
there rather than in a mobile-only wrapper. Therefore:

- the selected main route receives crossing cues;
- an app-owned approach to the selected start can receive them;
- a routed rejoin leg can receive them;
- synthetic and restored routes remain compatible when context is absent.

This does not change how those paths are found. Bicycle directionality and
legality remain enforced by the shared directed router and its attestation.

## Routing cost and future curation

A crossing may be perfectly valid but undesirable when a comparable route
avoids switching sides twice. That is a route-choice concern, but it is not
safe to derive from a voice heuristic.

A future routing phase may add a logical crossing registry with records that:

- have stable IDs and `candidate`, `confirmed` or `rejected` review status;
- map one logical crossing to one or more directed base-edge portions;
- retain detector/build provenance and a data-version digest;
- are visible as a review layer in the editor;
- charge a fixed, documented equivalent-distance cost only when confirmed;
- apply consistently to route building, approach and rejoin cost profiles.

That registry naturally handles crossings spanning more than one base edge,
which the current Road 99 case demonstrates. It also keeps user-facing logic
logical: one crossing remains one event even if its base representation is an
edge set.

Before any penalty ships, it needs a corpus report showing route deltas,
unreachable-path changes and the two-crossing “far-side infrastructure” cases.
Click-snap behavior across parallel roads can consume the same confirmed data
later. Neither is part of the first maneuver implementation.

## Expected effect on the reported ride

The implementation gate uses the corrected strict replay, not stale geometry
from before the directionality and via-point fixes.

| Reported site | State before this plan | Expected after this plan |
|---|---|---|
| Original ~482 m crossing | The corrected directed route no longer reproduces the old pair in the same form. | No route change; detector must not invent a cue where the current route does not cross. The original 87°/87° geometry remains a positive unit fixture. |
| Original ~2,226 m Tel Hai cue | M4 already removed the corrupted 154°/62° false pair. | No regression and no new crossing unless a real opposite-corner pair passes the conservative gate. |
| Current ~3,822–3,838 m crossing | Right about 112°, then left about 74°, followed by the roundabout. | One `crossing` cue, then the preserved straight-roundabout maneuver; compound when the completion-to-entry gap is within 60 m. |
| Route choice and length | Strict directed route, about 10,111.6 m. | Unchanged. |

Expected cue delta at the remaining positive site: ordinary turn cues decrease
from 19 to 17 and one crossing cue is added. Roundabout count and route
fingerprint stay unchanged; the navigation-plan fingerprint changes because
the maneuver generator version and cue plan change.

## Failure behavior

- Missing context: use only the stricter geometry gate.
- Ambiguous geometry: keep the original cues.
- Context/geometry distance mismatch: discard context for detection; never
  stretch a crossing interval to make it fit.
- Reversal or clipping that cuts through a candidate: recompute from the
  effective geometry rather than carrying a half-crossing cue.
- Compound voice not accepted or spoken: do not suppress the following cue.
- Unsupported renderer: shared presentation still supplies text and a generic
  caution fallback rather than failing navigation.

## Acceptance gates

Implementation is complete only when:

1. The current strict Road 99 replay remains 10,111.6 m and directionally
   attested.
2. Its remaining right/left crossing pair is one crossing cue.
3. The following straight roundabout remains present and is independently
   speakable.
4. Positive pure-sidestep and route-context fixtures pass in both directions.
5. Chicane, switchback, same-direction pair, adjacent-junction, roundabout and
   ordinary S-bend controls produce no crossing.
6. Reverse, clipped, loop-rotated, approach and rejoin routes do not retain
   stale crossing distances.
7. Voice, presentation, haptic, camera and icon contracts cover `crossing`.
8. Restored v2 navigation plans are rebuilt or rejected cleanly under v3.
9. The full automated suite passes.
10. A later physical/simulator visual and audio check is recorded; because the
    user is remote, this is an explicit pending manual gate and not silently
    claimed as complete.
