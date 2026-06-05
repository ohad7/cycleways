# Video-sync GPS bootstrap — design

Date: 2026-06-06

## Problem

The editor's video-sync mode produces keyframes `{ t, lat, lon }` that map a
published YouTube video's playback time to a position along a route. Bootstrapped
keyframes may also carry an optional `fraction` field to preserve loop-seam
intent where coordinates are ambiguous. Today every keyframe is placed by hand:
pick a slug, paste a YouTube URL, scrub the video, click the map. Most clips were
recorded without usable GPS, so manual placement was the only option.

The Dafna clip has a GPS sidecar:
`data/videos/Dafna/dafna-output.gps.txt`
(`time_s,latitude,longitude,altitude_m,speed_mps`, 1603 fixes). Each fix is a
time/position pair, so we want to bootstrap editable keyframes from the GPS and
then refine them in the existing editor workflow.

## Time alignment

`time_s` is on the `concatenated.mp4` 1x timeline. The published local file is
`processed_5x.mp4`, produced with `setpts=PTS/5` and uploaded as-is with no
intro/outro:

```text
video_time = time_s / speedFactor
```

`speedFactor` defaults to 5 and remains an editor input because other clips may
use different processing factors.

## Why simplification

1603 fixes over ~28 minutes become a ~5m36s published video. One keyframe per
fix would bloat promoted JSON, break the chip-strip UI, and make hand refinement
impractical. The runtime interpolator (`createVideoSync`) is piecewise-linear in
`(time, route-fraction)`, so we reduce the GPS track to the minimum keyframes
that reproduce the snapped route-progress curve within an editable tolerance.

The tolerance bounds error against the **accepted snapped route-progress
samples**, not raw GPS coordinates. Raw GPS fixes can still be up to
`maxOffRouteMeters` from the route before being discarded.

## Chosen approach

Use route snapping plus error-bounded Douglas-Peucker simplification on the
resulting `fraction(time)` curve.

The important correction is that snapping must be **sequence-aware**. Dafna is a
loop; near the start/end seam, a fix can be close to both route fraction `0.01`
and `0.99`. Independent nearest-point snapping can jump across the seam, e.g.
`0.98 -> 0.02`, and then the runtime end anchor causes a visible late jump.

So bootstrap snapping uses all near-route projection candidates for each fix and
selects a temporally plausible candidate sequence:

- Prefer the lowest near-equivalent fraction for the first fix on closed loops.
- For later fixes, prefer candidates that continue from the previous selected
  fraction without backtracking by default.
- Heavily penalize impossible forward jumps based on elapsed video time and a
  generous max route-progress speed.
- Heavily penalize large backward jumps.
- Drop backward fixes by default; callers can raise `maxBacktrackMeters` if a
  future clip intentionally doubles back.

Rejected alternatives:

- Fixed-interval downsampling wastes points on constant-speed stretches and
  under-samples sharp speed changes.
- Full-density keyframes are uneditable.
- Independent nearest-point snapping fails on loops and parallel/seam geometry.

## Shared route geometry

Create `src/components/featured/routeGeometry.js` as a pure module with:

- `haversineMeters`
- `buildCumulativeDistances`
- `projectPointToRouteCandidates`
- `nearestPointOnPolyline`
- `pointAtFraction`

`videoSync.js`, the editor's manual click snapping, and GPS bootstrap all use
this module so route projection behavior is consistent.

## GPS bootstrap module

Create `src/components/featured/gpsBootstrap.js` with:

```js
bootstrapKeyframesFromGps({
  csvText,
  routeGeometry,
  videoDuration,
  speedFactor = 5,
  maxErrorMeters = 10,
  maxOffRouteMeters = 60,
  maxBacktrackMeters = 0,
  maxProgressMetersPerSecond = 60,
}) -> { keyframes, stats }
```

Pipeline:

1. Parse CSV rows into `{ timeS, lat, lon }`; skip header, blank, and non-numeric
   rows.
2. Convert `timeS / speedFactor` to video time.
3. Project each fix to all route candidates within `maxOffRouteMeters`.
4. Drop fixes with no candidate and count them as off-route.
5. Sort by video time; drop beyond-duration and non-increasing timestamps.
6. Select a continuity-aware projection candidate sequence.
7. Simplify the selected `fraction(time)` curve with vertical-error
   Douglas-Peucker using `epsilon = maxErrorMeters / totalRouteLengthMeters`.
8. Emit keyframes `{ t, lat, lon, fraction }` at the selected snapped route
   fractions. Existing keyframes without `fraction` remain supported.

Stats include:

```js
{
  fixesRead,
  offRouteDropped,
  beyondDurationDropped,
  nonIncreasingDropped,
  continuityDropped,
  ambiguousFixes,
  continuityCorrections,
  keyframesOut,
  startFraction,
  endFraction,
}
```

`startFraction`/`endFraction` are surfaced for sanity checks. For a full-loop
clip like Dafna they should be near 0 and 1; if not, the editor status should
make the mismatch obvious before promotion.

## Editor overlay wiring

In the existing video-sync overlay, near the YouTube URL field, add:

- GPS file picker (`.txt`/`.csv`)
- Max error input, default `10`
- Speed factor input, default `5`

The controls are disabled until a route is selected and a video duration is
known. On file pick:

1. Read file text.
2. Call `bootstrapKeyframesFromGps`.
3. If existing keyframes are present, confirm before replacing.
4. Replace `videoSyncState.keyframes`, rebuild sync, render chips, render map
   layer.
5. Show status, e.g. `Bootstrapped 65 keyframes from 1603 fixes (17 off-route,
   0 beyond end dropped; fractions 0.006 -> 0.999).`

From there, the normal editable flow is unchanged: scrub, trim/fix chips, save
draft, promote.

## Edge cases and invariants

- Bootstrap replaces keyframes after confirmation; it does not merge.
- The output is ordinary editable keyframes, with an optional backward-compatible
  `fraction` field; no new draft/promote endpoint is introduced.
- Keyframes are emitted on-route, so they pass the existing 80 m promotion
  validator.
- GPS backtracking is dropped by default; large seam jumps are avoided by
  continuity scoring.
- If the GPS track starts/ends away from route start/end, runtime anchors will
  still force 0/1 at video boundaries. `startFraction`/`endFraction` stats make
  this visible so the user can choose a different route, speed factor, or manual
  edits.

## Testing

Pure module tests cover:

- CSV parsing, including junk rows.
- Time rescale by `speedFactor`.
- Off-route, beyond-duration, and non-increasing-time drops.
- Shared route-geometry projection helpers.
- Constant-speed simplification to two keyframes.
- Simplification error bound against snapped route-progress samples.
- Loop seam continuity: candidate selection should produce a sequence starting
  near fraction 0 and ending near fraction 1 instead of jumping `0.98 -> 0.02`.

Editor wiring is thin glue but should be manually smoke-tested in video-sync
mode with the local Dafna GPS file.

## Out of scope

- Auto-deriving `speedFactor` or time offset from media durations.
- Embedding GPS as an authoritative runtime track.
- Changing the draft/promote/validation pipeline.
