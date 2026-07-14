# Navigation follow-padding transition implementation plan

Date: 2026-07-14
Status: implemented; manual SIM visual acceptance pending

## Task 1 — Freeze the first-cue failure

- [x] Add a clock-controlled adapter regression that starts in `ride` with the
  compact status layout, then changes to `pre-turn` with a taller cue card.
- [x] Prove the current adapter jumps directly to the new padding.

## Task 2 — Interpolate padding in the follow owner

- [x] Retain the currently applied padding across follow-stage key changes.
- [x] Smoothly interpolate changed padding for 500 ms without native camera
  animation.
- [x] Restart a changed target from the current interpolated value.
- [x] Reset retained padding when a different camera owner takes control.
- [x] Delay projection validation until the target padding has settled.

## Task 3 — Validate the regression surface

- [x] Run the focused camera-adapter test.
- [x] Run the navigation-camera suite and shared journey scenarios.
- [x] Run the full repository test suite.
- [ ] Keep the original SIM ride as the manual visual acceptance surface for a
  future local device/simulator check.

Automated result: the first changed-layout frame retains the previous padding,
the midpoint lies strictly between old and new anchors, the target is exact at
500 ms, and screen-placement validation is scheduled only after settlement.
