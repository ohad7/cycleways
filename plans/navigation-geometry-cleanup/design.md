# Navigation geometry cleanup design

Date: 2026-07-14
Status: implemented

## Problem

Two independent geometry artifacts corrupted instructions on the July 13 ride:

1. Consecutive route vertices only 0.1–0.2 m apart created unstable bearings.
   At the entry to שביל תל חי this produced an apparent 154° right followed by
   a left that the rider did not experience. A similar duplicate hid a large
   opposite corner near the כביש 90 crossing.
2. One physical left turn onto שביל אופניים 99 was drawn as two approximately
   52° corners 20.3 m apart. Both passed the turn threshold and were announced
   as “left, then immediately left.”

## Decisions

### Preserve authoritative route geometry

Routing geometry, traversal metrics, route progress, and attestation remain
unchanged. `buildRouteCues` derives a private cue-analysis geometry by removing
points less than 1 m from the last retained cue-analysis vertex. The retained
vertex is a fixed anchor: dense legitimate sampling cannot form one unbounded
duplicate cluster.

This keeps existing shared-route fingerprints valid and protects already
persisted routes as well as newly planned routes. The sub-metre discrepancy is
far below map rendering and navigation-position tolerances, but it is large
enough to make a one-segment bearing meaningless.

Distance values on retained points remain in the authoritative route distance
frame. Arrival distance, segment spans, roundabout records, and route metrics
are therefore not recomputed by cue cleanup.

### Merge only a guarded same-junction turn

After corner extraction and before compound-turn linking, two turn cues merge
only when all of these are true:

- both cues are ordinary `turn` cues, not bends or roundabouts;
- they have the same direction;
- the gap from the first corner to the second is no more than 30 m;
- both corners have the same nearest junction inside the existing 30 m
  junction gate; and
- their combined angle is no more than 135°.

The merged cue starts at the first corner, completes at the second corner, and
uses the sum of the two angles. It records `mergedCornerCount` for diagnostics.
Compound linking measures from the merged completion point, and a segment
boundary anywhere along the merged maneuver can attach its name to that cue.

The nearest-junction requirement preserves two real decisions at adjacent
intersections. The 135° cap preserves tight same-direction pairs such as two
separate 90° turns and avoids turning them into an invented 180° maneuver.
Without junction data, same-direction cues are not merged.

## Reported-ride effect

- The duplicate-vertex cleanup removes the false 154° instruction near the
  entry to שביל תל חי.
- At the later כביש 90 crossing it exposes a right/left jog instead of the
  corrupted left/left pair. That pair remains literal until the separate
  first-class crossing design replaces it with “cross the road.”
- The two 52° left corners near 8.66 km merge into one approximately 105° left,
  removing the redundant “immediately left.”

## Scope

- Shared core only; web and iOS consume the same cue plan.
- No routing-cost, snapping, directionality, voice-scheduling, or route-progress
  change.
- No crossing inference in this slice.
- No merging of opposite-direction corner pairs.
- The maneuver generator version advances to `navigation-cues-v2`, invalidating
  persisted active-navigation plans generated with the old cue rules.

## Validation

Automated tests cover sub-metre bearing noise, the reported split-turn shape,
dense legitimate geometry, two nearby turns at distinct junctions, and a
same-junction pair whose combined angle is too large to merge. The July 13
route is replayed to confirm the cue count and exact affected maneuvers before
the full suite runs.

The implemented replay preserves the 10,111.6 m route and its existing route
fingerprint. Cue analysis removes ten sub-metre vertices, eliminates the false
154° instruction, and merges the reported 52° + 53° pair into one 105° left.
The ride now has 19 ordinary turn cues instead of 22.
