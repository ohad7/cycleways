# Navigation geometry cleanup implementation plan

Date: 2026-07-14
Status: implemented

## Task 1 — Freeze failure shapes

- [x] Add a sub-metre duplicate fixture whose raw local bearing is about 50°
  although the physical turn is about 90°.
- [x] Add the reported split-turn shape: two approximately 52° left corners
  about 20 m apart at one junction.
- [x] Add controls for distinct nearest junctions and a combined angle above
  the merge limit.
- [x] Add a dense sub-metre-sampled control that must retain its physical turn.

## Task 2 — Normalize cue-analysis geometry

- [x] Remove consecutive cue-analysis vertices less than 1 m apart while
  keeping authoritative route geometry and distance values unchanged.
- [x] Run corner and junction classification on the normalized view.

## Task 3 — Merge one physical turn

- [x] Track the nearest gated junction for each ordinary turn candidate.
- [x] Merge guarded same-direction candidates before compound linking.
- [x] Preserve the first-corner start, second-corner completion, summed angle,
  and segment-name attachment across the full maneuver interval.

## Task 4 — Validate the ride and regression surface

- [x] Replay the July 13 coordinate route and inspect affected cues.
- [x] Update the observed candidate cue metrics.
- [x] Run navigation cue, voice, route, scenario, and full repository tests.

## Completed validation

- Route distance remains 10,111.6 m and the attested route fingerprint remains
  unchanged.
- Cue analysis uses 312 points instead of the authoritative geometry's 322,
  removing ten sub-metre duplicates without mutating the route.
- The false 154° instruction is absent.
- The split left completes 20.3 m after it starts and is represented as one
  approximately 105° left without an “immediately left” compound.
- Ordinary turn cues fall from 22 to 19.
- Focused navigation tests and the full `npm test` suite pass.
