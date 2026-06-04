# Featured-page Video Slow-Start Ramp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the featured-page YouTube video start slow (0.5×) and ramp up to full speed over the first ~500 m of the route, while keeping the existing POI-vicinity slowdown intact.

**Architecture:** Extract a single pure function `computePlaybackRate({ distanceFromStartM, nearPoi, rampDone })` into a new `playbackRamp.js`, unit-tested as a plain Node script (the repo convention, mirroring `videoSync.js`). `VideoEmbed.jsx` becomes the sole caller: it removes the old POI capture/restore rate logic and instead computes the rate from current route distance + POI proximity on every playback tick (and once at play-start / player-ready), with a `rampDoneRef` that disarms the ramp after it completes naturally (≥500 m) or on any user seek.

**Tech Stack:** React (function components + hooks), YouTube IFrame Player API, Node's built-in `assert` for tests, npm test chain.

Design spec: `plans/featured-video-slow-start/design.md`.

---

## File Structure

- **Create** `src/components/featured/playbackRamp.js` — pure rate function + constants (`RAMP_STEP_1_M`, `RAMP_STEP_2_M`, `RAMP_RATE_1`, `RAMP_RATE_2`, `POI_PLAYBACK_RATE`). One responsibility: map `(distance, nearPoi, rampDone)` → an allowed YouTube rate.
- **Create** `tests/test-playback-ramp.mjs` — Node test for `computePlaybackRate`.
- **Modify** `src/components/featured/VideoEmbed.jsx` — remove the capture/restore rate machinery; add `rampDoneRef`; apply the computed rate in the ticker, at play-start, and at `onReady`; disarm on `seekToTime`.
- **Modify** `package.json` — add the new test to the `test` script.

---

## Task 1: Pure playback-rate ramp function

**Files:**
- Create: `src/components/featured/playbackRamp.js`
- Test: `tests/test-playback-ramp.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test-playback-ramp.mjs`:

```js
import assert from "node:assert/strict";
import {
  computePlaybackRate,
  RAMP_STEP_1_M,
  RAMP_STEP_2_M,
  POI_PLAYBACK_RATE,
} from "../src/components/featured/playbackRamp.js";

const ALLOWED = new Set([0.5, 0.75, 1]);
const rate = (distanceFromStartM, nearPoi = false, rampDone = false) =>
  computePlaybackRate({ distanceFromStartM, nearPoi, rampDone });

// Ramp bands (no POI, ramp armed).
assert.equal(rate(0), 0.5, "start → 0.5");
assert.equal(rate(100), 0.5, "100m → 0.5");
assert.equal(rate(RAMP_STEP_1_M - 1), 0.5, "just under 250m → 0.5");
assert.equal(rate(RAMP_STEP_1_M), 0.75, "exactly 250m → 0.75");
assert.equal(rate(400), 0.75, "400m → 0.75");
assert.equal(rate(RAMP_STEP_2_M - 1), 0.75, "just under 500m → 0.75");
assert.equal(rate(RAMP_STEP_2_M), 1, "exactly 500m → 1.0");
assert.equal(rate(1000), 1, "1000m → 1.0");

// POI composition: slower of the two.
assert.equal(rate(0, true), 0.5, "ramp 0.5 + POI → 0.5");
assert.equal(rate(300, true), 0.75, "ramp 0.75 + POI → 0.75");
assert.equal(rate(600, true), POI_PLAYBACK_RATE, "ramp 1.0 + POI → 0.75");

// rampDone forces base 1.0 regardless of distance.
assert.equal(rate(0, false, true), 1, "rampDone near start → 1.0");
assert.equal(rate(0, true, true), 0.75, "rampDone near start + POI → 0.75");

// Non-finite distance is treated as 0 (start of ramp).
assert.equal(rate(NaN), 0.5, "NaN distance → 0.5");
assert.equal(rate(undefined), 0.5, "undefined distance → 0.5");

// Every output is an allowed YouTube rate.
for (const d of [0, 100, 250, 400, 500, 1000]) {
  for (const poi of [false, true]) {
    for (const done of [false, true]) {
      assert.ok(
        ALLOWED.has(computePlaybackRate({ distanceFromStartM: d, nearPoi: poi, rampDone: done })),
        `rate must be in {0.5,0.75,1} for d=${d} poi=${poi} done=${done}`,
      );
    }
  }
}

console.log("test-playback-ramp: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-playback-ramp.mjs`
Expected: FAIL — `Cannot find module '.../playbackRamp.js'` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/featured/playbackRamp.js`:

```js
// Slow-start playback ramp for featured-page videos. The footage is a
// compressed ride, so starting at full speed is jarring. The opening stretch
// ramps 0.5 → 0.75 → 1.0 by distance from the route start, and composes with
// the existing POI-vicinity slowdown by taking the slower of the two. All
// outputs land on YouTube's allowed rates {0.5, 0.75, 1.0} so the player's
// setPlaybackRate always succeeds.

export const RAMP_STEP_1_M = 250;
export const RAMP_STEP_2_M = 500;
export const RAMP_RATE_1 = 0.5;
export const RAMP_RATE_2 = 0.75;
export const POI_PLAYBACK_RATE = 0.75;

export function computePlaybackRate({ distanceFromStartM, nearPoi, rampDone }) {
  const distance = Number.isFinite(distanceFromStartM) ? distanceFromStartM : 0;

  let base;
  if (rampDone) {
    base = 1;
  } else if (distance < RAMP_STEP_1_M) {
    base = RAMP_RATE_1;
  } else if (distance < RAMP_STEP_2_M) {
    base = RAMP_RATE_2;
  } else {
    base = 1;
  }

  return nearPoi ? Math.min(base, POI_PLAYBACK_RATE) : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-playback-ramp.mjs`
Expected: PASS — prints `test-playback-ramp: OK`.

- [ ] **Step 5: Wire the test into the npm test chain**

In `package.json`, in the `"test"` script, find the substring:

```
&& node tests/test-vs-time.mjs &&
```

and replace it with:

```
&& node tests/test-vs-time.mjs && node tests/test-playback-ramp.mjs &&
```

- [ ] **Step 6: Verify the chained test runs**

Run: `node tests/test-playback-ramp.mjs && echo CHAINED-OK`
Expected: `test-playback-ramp: OK` then `CHAINED-OK`.
(Full `npm test` also exercises Python + many suites; running the single test confirms the wiring is syntactically valid.)

- [ ] **Step 7: Commit**

```bash
git add src/components/featured/playbackRamp.js tests/test-playback-ramp.mjs package.json
git commit -m "feat(featured): add slow-start playback-rate ramp function"
```

---

## Task 2: Use the ramp in VideoEmbed (remove capture/restore)

**Files:**
- Modify: `src/components/featured/VideoEmbed.jsx`

This task has no new unit test — the logic under test lives in `playbackRamp.js` (Task 1); the change here is React/YouTube integration verified manually in Step 8.

- [ ] **Step 1: Replace the local rate constants with the shared module import**

In `src/components/featured/VideoEmbed.jsx`, the imports currently end with:

```js
import { loadYouTubeIframeApi } from "./youtubeIframeApi.js";
import { createVideoSync } from "./videoSync.js";

const POI_PLAYBACK_RATE = 0.75;
const DEFAULT_PLAYBACK_RATE = 1;
const MANUAL_SCRUB_SAMPLE_MS = 300;
```

Replace those lines with:

```js
import { loadYouTubeIframeApi } from "./youtubeIframeApi.js";
import { createVideoSync } from "./videoSync.js";
import {
  computePlaybackRate,
  POI_PLAYBACK_RATE,
  RAMP_STEP_2_M,
} from "./playbackRamp.js";

const MANUAL_SCRUB_SAMPLE_MS = 300;
```

(`POI_PLAYBACK_RATE` now comes from `playbackRamp.js`; `DEFAULT_PLAYBACK_RATE` is no longer referenced after this task.)

- [ ] **Step 2: Replace the capture/restore refs with `rampDoneRef`**

Find:

```js
  const poiSlidesRef = useRef([]);
  const routeDistanceRef = useRef(0);
  const slowPlaybackActiveRef = useRef(false);
  const restorePlaybackRateRef = useRef(DEFAULT_PLAYBACK_RATE);
```

Replace with:

```js
  const poiSlidesRef = useRef([]);
  const routeDistanceRef = useRef(0);
  // Slow-start ramp is "armed" until it completes naturally (distance reaches
  // RAMP_STEP_2_M) or the user performs a manual seek; once disarmed the base
  // rate is 1.0 everywhere. See playbackRamp.js.
  const rampDoneRef = useRef(false);
```

- [ ] **Step 3: Disarm the ramp on any user seek**

Find the `seekToTime` callback:

```js
  const seekToTime = useCallback((time) => {
    const t = clampTime(time);
    const player = playerRef.current;
```

Replace with (insert the disarm line):

```js
  const seekToTime = useCallback((time) => {
    // Any seek is user-initiated (slider scrub or map/POI click); "first play
    // only" means the ramp does not re-apply after the user has navigated.
    rampDoneRef.current = true;
    const t = clampTime(time);
    const player = playerRef.current;
```

- [ ] **Step 4: Replace the POI rate helpers with the ramp helper**

Find this block (the `getPlaybackRate`, `syncPoiPlaybackRate`, and `resetPlaybackRate` functions):

```js
    function getPlaybackRate(p) {
      if (!p || typeof p.getPlaybackRate !== "function") return DEFAULT_PLAYBACK_RATE;
      const rate = p.getPlaybackRate();
      return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PLAYBACK_RATE;
    }

    function canSetPlaybackRate(p, rate) {
      if (!p || typeof p.setPlaybackRate !== "function") return false;
      if (typeof p.getAvailablePlaybackRates !== "function") return true;
      const rates = p.getAvailablePlaybackRates();
      if (!Array.isArray(rates) || rates.length === 0) return true;
      return rates.some((availableRate) => Math.abs(availableRate - rate) < 0.001);
    }

    function setPlaybackRate(p, rate) {
      if (!canSetPlaybackRate(p, rate)) return false;
      try {
        p.setPlaybackRate(rate);
        return true;
      } catch {
        return false;
      }
    }

    function syncPoiPlaybackRate(p, nearPoi) {
      if (nearPoi) {
        if (slowPlaybackActiveRef.current) return;
        restorePlaybackRateRef.current = getPlaybackRate(p);
        if (setPlaybackRate(p, POI_PLAYBACK_RATE)) {
          slowPlaybackActiveRef.current = true;
        }
        return;
      }
      resetPlaybackRate();
    }

    function resetPlaybackRate() {
      if (!slowPlaybackActiveRef.current) return;
      const p = playerRef.current || player;
      setPlaybackRate(p, restorePlaybackRateRef.current || DEFAULT_PLAYBACK_RATE);
      slowPlaybackActiveRef.current = false;
      restorePlaybackRateRef.current = DEFAULT_PLAYBACK_RATE;
    }
```

Replace the whole block with (keep `canSetPlaybackRate`/`setPlaybackRate`, drop the rest, add `applyPlaybackRate`):

```js
    function canSetPlaybackRate(p, rate) {
      if (!p || typeof p.setPlaybackRate !== "function") return false;
      if (typeof p.getAvailablePlaybackRates !== "function") return true;
      const rates = p.getAvailablePlaybackRates();
      if (!Array.isArray(rates) || rates.length === 0) return true;
      return rates.some((availableRate) => Math.abs(availableRate - rate) < 0.001);
    }

    function setPlaybackRate(p, rate) {
      if (!canSetPlaybackRate(p, rate)) return false;
      try {
        p.setPlaybackRate(rate);
        return true;
      } catch {
        return false;
      }
    }

    // Sole writer of the playback rate: derive it from route distance + POI
    // proximity via the pure ramp function, flipping rampDone once the ramp
    // completes so later ticks short-circuit to full speed.
    function applyPlaybackRate(p, fraction, nearPoi) {
      if (!p) return;
      const distanceFromStartM =
        (Number(fraction) || 0) * (routeDistanceRef.current || 0);
      if (!rampDoneRef.current && distanceFromStartM >= RAMP_STEP_2_M) {
        rampDoneRef.current = true;
      }
      const rate = computePlaybackRate({
        distanceFromStartM,
        nearPoi,
        rampDone: rampDoneRef.current,
      });
      setPlaybackRate(p, rate);
    }
```

- [ ] **Step 5: Call `applyPlaybackRate` from the ticker**

Find the ticker loop body:

```js
        const p = playerRef.current;
        const pos = emitCurrentPosition(p, { force: true });
        if (!pos) return;
        syncPoiPlaybackRate(p, Boolean(
          previewSlideForCursor(
            poiSlidesRef.current,
            pos.fraction,
            routeDistanceRef.current,
          ),
        ));
```

Replace with:

```js
        const p = playerRef.current;
        const pos = emitCurrentPosition(p, { force: true });
        if (!pos) return;
        const nearPoi = Boolean(
          previewSlideForCursor(
            poiSlidesRef.current,
            pos.fraction,
            routeDistanceRef.current,
          ),
        );
        applyPlaybackRate(p, pos.fraction, nearPoi);
```

- [ ] **Step 6: Apply the rate at play-start and remove the pause reset**

Find the play/pause branch in `onStateChange`:

```js
            if (isPlaying) {
              setVideoPlaying(true);
              startTicker();
            } else {
              setVideoPlaying(false);
              stopTicker();
              resetPlaybackRate();
            }
```

Replace with (apply immediately on play so the opening 0.5× lands before the first ticker frame; nothing to reset on pause):

```js
            if (isPlaying) {
              setVideoPlaying(true);
              const pos = emitCurrentPosition(playerRef.current, { force: true });
              if (pos) {
                const nearPoi = Boolean(
                  previewSlideForCursor(
                    poiSlidesRef.current,
                    pos.fraction,
                    routeDistanceRef.current,
                  ),
                );
                applyPlaybackRate(playerRef.current, pos.fraction, nearPoi);
              }
              startTicker();
            } else {
              setVideoPlaying(false);
              stopTicker();
            }
```

- [ ] **Step 7: Set the initial rate at player-ready and drop the cleanup reset**

First, in the `onReady` handler, find:

```js
            setIsPlayerReady(true);
            startManualScrubSampler();
```

Replace with (prime the armed ramp to 0.5× before the first play):

```js
            applyPlaybackRate(player, 0, false);
            setIsPlayerReady(true);
            startManualScrubSampler();
```

Then, in the effect's cleanup `return () => { ... }`, find and **delete** the now-undefined call:

```js
      stopTicker();
      resetPlaybackRate();
      playingRef.current = false;
```

so it becomes:

```js
      stopTicker();
      playingRef.current = false;
```

- [ ] **Step 8: Verify the build and behavior**

Run: `npm run build`
Expected: build succeeds with no "is not defined" / unused-import errors (confirms `DEFAULT_PLAYBACK_RATE`, `syncPoiPlaybackRate`, `resetPlaybackRate`, `slowPlaybackActiveRef`, `restorePlaybackRateRef` are fully removed and `applyPlaybackRate` references resolve).

Manual check (dev server): run `npm run dev`, open a featured page (e.g. `/featured/sovev-beit-hillel`), press play from the start, and confirm:
- The opening plays at half speed, steps up around 250 m, and reaches full speed by ~500 m (watch the distance readout under the video).
- Near a POI after the ramp, speed drops to 0.75× as before.
- After scrubbing the slider or clicking the map/a POI, replaying near the start stays at full speed (ramp disarmed).

- [ ] **Step 9: Commit**

```bash
git add src/components/featured/VideoEmbed.jsx
git commit -m "feat(featured): ramp video speed from slow start, composed with POI slowdown"
```

---

## Self-Review

**Spec coverage:**
- Ramp bands 0.5 / 0.75 / 1.0 at 250 m / 500 m → Task 1 function + tests; applied in Task 2 ticker/play-start.
- POI composition (slower of two) → Task 1 `Math.min(base, POI_PLAYBACK_RATE)` + tests.
- First-play-only trigger → Task 2 Step 3 (`seekToTime` disarm) + Step 4 (`rampDone` flip at `RAMP_STEP_2_M`).
- No flash of full speed at start → Task 2 Step 6 (apply on play) + Step 7 (apply at `onReady`).
- Single writer / remove capture-restore → Task 2 Step 4 removes `getPlaybackRate`/`syncPoiPlaybackRate`/`resetPlaybackRate` and the two refs.
- Test wired into `npm test` → Task 1 Step 5.
- Out-of-scope items (YouTube embed, keyframes, POI thresholds, data files, UI) → untouched; only listed files change.

**Placeholder scan:** none — every code step shows full before/after text.

**Type/name consistency:** `computePlaybackRate({ distanceFromStartM, nearPoi, rampDone })`, `RAMP_STEP_2_M`, `POI_PLAYBACK_RATE`, `applyPlaybackRate(p, fraction, nearPoi)`, and `rampDoneRef` are used identically across Tasks 1 and 2. `canSetPlaybackRate`/`setPlaybackRate` keep their existing signatures.
