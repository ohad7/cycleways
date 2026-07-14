# Via-point spur avoidance implementation plan

Date: 2026-07-14
Status: implemented; one manual validation item remains deferred

## Task 1 — Freeze the routing regression

- [x] Add a small graph fixture where the exact interior snap creates a 5 m
  reverse/forward spur while a continuous edge is about 5.5 m away.
- [x] Run the fixture before the fix and confirm that the exact spur candidate
  wins.
- [x] Add controls for an only-candidate short spur and a long out-and-back.

## Task 2 — Make joint selection boundary-aware

- [x] Detect overlapping opposite traversals at adjacent-leg boundaries.
- [x] Penalize only overlaps no longer than 12 m, using a bounded 100-unit
  planning penalty.
- [x] Retain candidate states by arrival traversal signature so the dynamic
  program remains globally correct with a boundary-dependent score.
- [x] Keep physical route metrics and attestation free of planning penalties.

## Task 3 — Validate shared-core behavior

- [x] Run the focused via-spur regression.
- [x] Run multi-candidate, traversal-policy, restore, attestation, and base-route
  tests.
- [x] Add the focused regression to the default test command and run the full
  `npm test` chain.

## Task 4 — Recreate the reported ride

- [x] Rebuild the July 13 coordinate candidate with the strict directional
  assets.
- [x] Confirm edge share ID 29897 is no longer traversed reverse then forward
  across the via point.
- [x] Record the new distance, traversal count, geometry count, fingerprint,
  and cue counts in the candidate fixture.
- [x] Confirm the false “right, then right” cue at about 945 m is absent.
- [ ] Keep the repaired Road 99 closed-way joins pending manual editor review
  until the curator has local map access.

Automated replay result: 10,111.6 m, 105 traversal slices, 322 geometry points,
and 22 turn cues. The selected via anchor is edge share ID 26101 at 5.58 m
displacement; edge share ID 29897 is absent at that boundary.
