# Video-sync GPS bootstrap — implementation plan

Date: 2026-06-06

Goal: let the editor's video-sync mode generate ordinary editable keyframes from
a GPS sidecar file instead of placing every keyframe by hand.

Reference design: `plans/video-sync-gps-bootstrap/design.md`.

## Architecture

Add a pure GPS bootstrap module that parses the GPS CSV, rescales timestamps,
snaps fixes to the selected route, selects a continuity-aware snapped route
progress sequence, simplifies that sequence, and emits `{ t, lat, lon }`
keyframes with an optional `fraction` field for loop-seam-safe interpolation.
The editor only supplies file input and replaces the in-memory keyframe list; the
draft/promote endpoint path and validation path remain unchanged.

Route projection math moves into `src/components/featured/routeGeometry.js` and
is shared by:

- `src/components/featured/videoSync.js`
- editor manual click snapping in `editor/editor.js`
- `src/components/featured/gpsBootstrap.js`

## Task 1: Shared route geometry

Files:

- Create `src/components/featured/routeGeometry.js`
- Modify `src/components/featured/videoSync.js`
- Modify `editor/editor.js`
- Create `tests/test-route-geometry.mjs`
- Modify `package.json`

Steps:

- [ ] Extract the existing `videoSync.js` haversine, cumulative-distance,
  nearest-point, and point-at-fraction helpers into `routeGeometry.js`.
- [ ] Add `projectPointToRouteCandidates(point, polyline, cumulativeDistances,
  options)` that returns all segment projections sorted by distance, with
  `{ index, t, fraction, distanceMeters, lat, lng }`.
- [ ] Refactor `videoSync.js` to import the shared helpers without changing
  runtime behavior.
- [ ] Refactor the editor's `vsSnapToPolyline` to use the shared helpers too.
- [ ] Add focused tests for distance, nearest projection, candidate projection,
  and point-at-fraction.
- [ ] Register `tests/test-route-geometry.mjs` in `npm test`.

Validation:

- `node tests/test-video-sync.mjs`
- `node tests/test-route-geometry.mjs`

## Task 2: Continuity-aware GPS bootstrap module

Files:

- Create `src/components/featured/gpsBootstrap.js`
- Create `tests/test-gps-bootstrap.mjs`
- Modify `package.json`

Steps:

- [ ] Export `parseGpsCsv`, `simplifyFractionCurve`, and
  `bootstrapKeyframesFromGps`.
- [ ] Parse `time_s,latitude,longitude` rows while ignoring headers, blanks, and
  non-numeric rows.
- [ ] Project each fix to all route candidates within `maxOffRouteMeters`.
- [ ] Sort by video time and count dropped off-route, beyond-duration, and
  non-increasing timestamp fixes.
- [ ] Select candidate projections with continuity scoring:
  - first fix on closed loops prefers the lowest near-equivalent fraction;
  - later fixes drop backward progress by default;
  - later fixes penalize impossible forward jumps using elapsed video time;
  - callers can opt into limited backtracking only if a future clip needs it.
- [ ] Simplify the selected `fraction(time)` curve using vertical-error
  Douglas-Peucker, where `epsilon = maxErrorMeters / totalRouteLengthMeters`.
- [ ] Emit ordinary on-route keyframes `{ t, lat, lon, fraction }`; legacy
  keyframes without `fraction` remain supported.
- [ ] Return stats including counts, `ambiguousFixes`,
  `continuityCorrections`, `startFraction`, and `endFraction`.
- [ ] Add tests for parsing, time scaling, off-route drop, beyond-duration drop,
  non-increasing cleanup, constant-speed simplification, simplification error
  bound, and loop seam continuity.
- [ ] Register `tests/test-gps-bootstrap.mjs` in `npm test`.

Validation:

- `node tests/test-gps-bootstrap.mjs`
- A scratch real-data run with `data/videos/Dafna/dafna-output.gps.txt` should
  produce tens-to-low-hundreds of keyframes at `maxErrorMeters = 10`, with
  `startFraction` near 0 and `endFraction` near 1.

## Task 3: Editor overlay wiring

Files:

- Modify `editor/index.html`
- Modify `editor/editor.js`
- Optionally modify `editor/styles.css`

Steps:

- [ ] Add GPS file, max-error, and speed-factor controls near the YouTube URL
  field.
- [ ] Disable the GPS controls until a route polyline and video duration are
  both available.
- [ ] Import `bootstrapKeyframesFromGps`.
- [ ] On file selection, read the file, run bootstrap, confirm before replacing
  existing keyframes, update state, rebuild sync, and re-render chips/layers.
- [ ] Reset the file input after handling so the same file can be reselected.
- [ ] Show status with keyframe/fix counts, drop counts, and start/end
  fractions.

Manual validation:

1. Start the editor server and open Video Sync mode.
2. Pick `sovev-dafna`.
3. Paste the uploaded YouTube URL and wait for duration to load.
4. Select `data/videos/Dafna/dafna-output.gps.txt`.
5. Confirm the status reports a plausible keyframe count and fractions near
   `0 -> 1`.
6. Play/scrub and confirm the ghost follows the route without a late loop-seam
   jump.
7. Lower max error, reselect the file, and confirm more keyframes are produced.

## Task 4: Final verification

- [ ] Run focused tests:
  - `node tests/test-video-sync.mjs`
  - `node tests/test-route-geometry.mjs`
  - `node tests/test-gps-bootstrap.mjs`
- [ ] Run `npm test`.
- [ ] Review the diff for accidental generated data, ignored GPS/video assets,
  or unrelated changes.
