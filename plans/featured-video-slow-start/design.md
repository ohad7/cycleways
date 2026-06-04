# Featured-page video slow-start ramp — design

Date: 2026-06-04

## Problem

On the featured route pages (`/featured/<slug>`), the embedded YouTube ride
video begins playing at full speed the instant the user hits play. Because the
footage is a compressed ride, the opening is jarring and disorienting — viewers
don't get a moment to orient before the scenery rushes past.

We want the video to **start slow and ramp up** over the opening stretch of the
route, while keeping the existing **POI-vicinity slowdown** intact.

## Constraint: YouTube discrete playback rates

The player is a YouTube IFrame embed (`VideoEmbed.jsx`). YouTube's
`getAvailablePlaybackRates()` returns a fixed set —
`[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]` — and the existing code already
guards on it (`canSetPlaybackRate`). Requests for intermediate rates (0.6, 0.7,
0.8, 0.9) are silently rejected by the player.

Therefore a literal "+10% every 100 m" ramp is **not possible** on a YouTube
video. The only usable speeds below normal are **0.5, 0.75, 1.0**, so the ramp
is a 3-step curve over those values.

## Behavior (agreed)

### Ramp bands (by distance from route start)

| Distance from start | Base rate |
|---------------------|-----------|
| `0 – 250 m`         | `0.5`     |
| `250 – 500 m`       | `0.75`    |
| `≥ 500 m`           | `1.0` (full speed; ramp completes) |

Full speed is reached by ~500 m.

### POI composition — slower of the two

When the cursor is near a POI (the existing `previewSlideForCursor` vicinity
check), the effective rate is the **slower** of the base ramp rate and the POI
rate (`0.75`):

```
effective = nearPoi ? min(base, POI_PLAYBACK_RATE) : base
```

- ramp `0.5` + POI → `0.5` (a POI never speeds the video up)
- ramp `0.75` + POI → `0.75`
- ramp `1.0` + POI → `0.75` (today's behavior, unchanged)

All outputs land on `{0.5, 0.75, 1.0}`, so `setPlaybackRate` always succeeds.

### Trigger — first play only

The ramp governs the **initial playthrough from the start** only:

- The ramp is "armed" until it either completes naturally (distance first
  reaches 500 m) **or** the user performs a manual seek.
- Every `seekToTime(...)` call is user-initiated (slider scrub via
  `handleScrubChange`, or a map/POI click via `playerSeekRef`). There is no
  programmatic seek-on-play. So a `seekToTime` call cleanly disarms the ramp.
- Once disarmed, the base rate is `1.0` everywhere; scrubbing back near the
  start does **not** re-arm it.
- Pausing and resuming (no seek) does **not** disarm — playback continues
  through the ramp.

| Action | Result |
|--------|--------|
| Play from 0 | slow ramp `0.5 → 0.75 → 1.0` |
| Manual seek to 100 m | `1.0` (no ramp) |
| Scrub back to 50 m | `1.0` (still disarmed) |

## Approach: one pure rate function, one writer

Today two concerns write `playbackRate` through a capture/restore pair
(`slowPlaybackActiveRef` + `restorePlaybackRateRef`): on entering a POI zone the
previous rate is captured and `0.75` applied; on leaving, the captured rate is
restored. Layering a distance ramp on top of that would mean two systems writing
`setPlaybackRate`, with stale "restore" values — a recipe for flicker.

Instead, collapse both concerns into a **single pure function** that is the sole
writer of the rate:

```js
computePlaybackRate({ distanceFromStartM, nearPoi, rampDone })
// returns 0.5 | 0.75 | 1.0
```

```
base = rampDone               ? 1.0
     : distanceFromStartM < RAMP_STEP_1_M ? RAMP_RATE_1   // 0.5
     : distanceFromStartM < RAMP_STEP_2_M ? RAMP_RATE_2   // 0.75
     :                                      1.0           // ramp completes
return nearPoi ? Math.min(base, POI_PLAYBACK_RATE) : base
```

The function does not own the "ramp completed at 500 m" state transition; the
caller flips `rampDoneRef` to `true` when `distanceFromStartM >= RAMP_STEP_2_M`
so subsequent ticks short-circuit to `1.0`.

### Module / file layout

- **`src/components/featured/playbackRamp.js`** (new) — exports the pure
  `computePlaybackRate(...)` and the constants. Mirrors the
  pure-function-plus-node-test convention used by `videoSync.js`.
- **`src/components/featured/VideoEmbed.jsx`** (edit):
  - Remove `slowPlaybackActiveRef`, `restorePlaybackRateRef`,
    `syncPoiPlaybackRate`, and the capture/restore body of `resetPlaybackRate`.
  - Add `rampDoneRef` (starts `false`).
  - In the ticker (and once at play-start, and on `onReady`), compute
    `distanceFromStartM = pos.fraction * routeDistanceRef.current`, call
    `computePlaybackRate(...)`, and apply it via the existing
    `setPlaybackRate(player, rate)` (which keeps the `canSetPlaybackRate`
    guard). Flip `rampDoneRef` when distance ≥ `RAMP_STEP_2_M`.
  - In `seekToTime`, set `rampDoneRef.current = true`.
  - Apply the rate once at play-start (`onStateChange` → playing) and at
    `onReady` so the opening `0.5` is set before the first frame, avoiding a
    brief full-speed flash.

### Constants (in `playbackRamp.js`)

```
RAMP_STEP_1_M = 250
RAMP_STEP_2_M = 500
RAMP_RATE_1   = 0.5
RAMP_RATE_2   = 0.75
POI_PLAYBACK_RATE = 0.75
```

(`POI_PLAYBACK_RATE` moves here from `VideoEmbed.jsx` so the function and its
test share one source of truth.)

## Testing

`tests/test-playback-ramp.mjs` (new, wired into `npm test`) covering:

- Each ramp band: `< 250 m → 0.5`, `[250, 500) → 0.75`, `≥ 500 m → 1.0`.
- POI composition (slower-of-two) at each band:
  `(0.5, poi) → 0.5`, `(0.75, poi) → 0.75`, `(1.0, poi) → 0.75`.
- `rampDone === true` forces base `1.0` regardless of distance (and POI then
  → `0.75`).
- Boundary at exactly `250` and `500` m.
- All returned rates are members of `{0.5, 0.75, 1.0}`.

## Edge cases

- **Short routes (< 500 m total):** the ramp reaches `1.0` only near the route
  end (or not at all); acceptable, no special-casing.
- **Pause/resume mid-ramp:** ramp stays armed; resumes at the band for the
  current distance.
- **Manual seek during ramp:** disarms immediately; base `1.0` thereafter.

## Out of scope

- No change to the YouTube embed, fallback iframe, keyframes, or any data files.
- No change to POI proximity thresholds (`previewSlideForCursor`).
- No new UI / speed control.
- Not switching off YouTube to a self-hosted MP4 (would be required for a truly
  smooth continuous ramp; explicitly deferred).
