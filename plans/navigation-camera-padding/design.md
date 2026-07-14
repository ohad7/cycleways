# Navigation follow-padding transition design

Date: 2026-07-14
Status: implemented; manual SIM visual acceptance pending

## Problem

On the July 13 ride, the map jumped when the first voice instruction began.
The first cue simultaneously changes the camera stage from `ride` to
`pre-turn` and mounts the top cue card. The card reports a larger measured top
occlusion, while the follow camera applies the resulting padding immediately
with a zero-duration native camera stop.

Pitch and zoom already move through the camera timeline. Padding was the only
camera property that jumped directly to the new layout.

## Decision

Keep the follow loop as the single interpolation owner. Native follow camera
stops remain zero-duration so repeated render/GPS frames do not restart a
Mapbox animation. The mobile camera adapter instead interpolates its applied
padding for 500 ms whenever the normalized target padding changes while follow
ownership continues.

- The first frame after a layout change reuses the currently applied padding,
  so mounting a cue card cannot move the map in one frame.
- Subsequent follow frames use a smoothstep interpolation to the new padding.
- A new target arriving mid-transition starts from the current interpolated
  value, without a discontinuity.
- A follow-stage key change such as `ride` to `pre-turn` does not reset the
  padding transition.
- Entering follow from idle, overview, or free mode adopts the current padding
  immediately; stale padding from an earlier owner is never replayed.
- Pitch, zoom, heading, center, overview fitting, and overlay layout remain
  otherwise unchanged.

Screen-placement validation waits until padding settles. Validating against the
new target viewport while the camera is intentionally between the old and new
anchors would produce a false diagnostic and consume the validation key before
the settled frame can be checked.

## Scope

- Mobile navigation camera only; routing, cue timing, voice timing, and web
  behavior do not change.
- The cue card still appears when it becomes relevant. This change removes the
  map-anchor snap rather than reserving permanent empty card space.
- No native animated camera owner is introduced.

## Validation

Automated adapter coverage changes the follow stage and top overlay inset in
the same frame and proves that padding is unchanged on that frame, is between
the endpoints halfway through the transition, and equals the target after 500
ms. Existing camera, journey, navigation, and repository suites must remain
green.

Automated validation completed on 2026-07-14. The clock-controlled regression,
the 21-test navigation-camera suite, all shared journey scenarios, and the full
`npm test` chain pass. The original ride's first-cue transition remains the
manual visual acceptance surface when local simulator/device access is
available.
