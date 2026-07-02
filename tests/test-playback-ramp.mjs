import assert from "node:assert/strict";
import {
  computePlaybackRate,
  normalizePlaybackBehavior,
  PLAYBACK_BEHAVIOR_LEGACY,
  PLAYBACK_BEHAVIOR_NONE,
  RAMP_STEP_1_M,
  RAMP_STEP_2_M,
  POI_PLAYBACK_RATE,
} from "../packages/core/src/featured/playbackRamp.js";

const ALLOWED = new Set([0.25, 0.5, 1]);
const rate = (distanceFromStartM, nearPoi = false, rampDone = false) =>
  computePlaybackRate({ distanceFromStartM, nearPoi, rampDone });
const noRate = (distanceFromStartM, nearPoi = false, rampDone = false) =>
  computePlaybackRate({
    distanceFromStartM,
    nearPoi,
    rampDone,
    playbackBehavior: PLAYBACK_BEHAVIOR_NONE,
  });

// Ramp bands (no POI, ramp armed).
assert.equal(rate(0), 0.25, "start → 0.25");
assert.equal(rate(100), 0.25, "100m → 0.25");
assert.equal(rate(RAMP_STEP_1_M - 1), 0.25, "just under step 1 → 0.25");
assert.equal(rate(RAMP_STEP_1_M), 0.5, "exactly step 1 → 0.5");
assert.equal(rate(600), 0.5, "600m → 0.5");
assert.equal(rate(RAMP_STEP_2_M - 1), 0.5, "just under step 2 → 0.5");
assert.equal(rate(RAMP_STEP_2_M), 1, "exactly step 2 → 1.0");
assert.equal(rate(1000), 1, "1000m → 1.0");

// POI composition: slower of the two.
assert.equal(rate(0, true), 0.25, "ramp 0.25 + POI → 0.25");
assert.equal(rate(600, true), 0.5, "ramp 0.5 + POI → 0.5");
assert.equal(rate(1000, true), POI_PLAYBACK_RATE, "ramp 1.0 + POI → 0.5");

// rampDone forces base 1.0 regardless of distance.
assert.equal(rate(0, false, true), 1, "rampDone near start → 1.0");
assert.equal(rate(0, true, true), 0.5, "rampDone near start + POI → 0.5");

// Non-finite distance is treated as 0 (start of ramp).
assert.equal(rate(NaN), 0.25, "NaN distance → 0.25");
assert.equal(rate(undefined), 0.25, "undefined distance → 0.25");

// "none" disables both the opening ramp and POI slowdown.
assert.equal(noRate(0), 1, "none at start → 1.0");
assert.equal(noRate(600), 1, "none mid-ramp → 1.0");
assert.equal(noRate(1000, true), 1, "none near POI → 1.0");
assert.equal(noRate(0, true, true), 1, "none ignores rampDone/POI → 1.0");

// Missing/unknown behavior preserves legacy behavior for old video JSON.
assert.equal(normalizePlaybackBehavior(undefined), PLAYBACK_BEHAVIOR_LEGACY);
assert.equal(normalizePlaybackBehavior("bad-value"), PLAYBACK_BEHAVIOR_LEGACY);
assert.equal(normalizePlaybackBehavior(PLAYBACK_BEHAVIOR_NONE), PLAYBACK_BEHAVIOR_NONE);

// Every output is an allowed YouTube rate.
for (const d of [-1, 0, 100, 250, 400, 500, 801, 1000, Infinity]) {
  for (const poi of [false, true]) {
    for (const done of [false, true]) {
      assert.ok(
        ALLOWED.has(computePlaybackRate({ distanceFromStartM: d, nearPoi: poi, rampDone: done })),
        `rate must be in {0.25,0.5,1} for d=${d} poi=${poi} done=${done}`,
      );
    }
  }
}

console.log("test-playback-ramp: OK");
