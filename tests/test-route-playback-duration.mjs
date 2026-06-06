import assert from "node:assert/strict";
import {
  computeMapPlaybackDuration,
  MAX_MAP_PLAYBACK_SECONDS,
  MIN_MAP_PLAYBACK_SECONDS,
} from "../src/components/featured/routePlaybackDuration.js";

assert.equal(
  computeMapPlaybackDuration({
    distanceMeters: 0,
    elevationGainMeters: 0,
    cueCount: 0,
  }),
  MIN_MAP_PLAYBACK_SECONDS,
);

assert.equal(
  computeMapPlaybackDuration({
    distanceMeters: -1,
    elevationGainMeters: Number.NaN,
    cueCount: -10,
  }),
  MIN_MAP_PLAYBACK_SECONDS,
);

assert.equal(
  computeMapPlaybackDuration({
    distanceMeters: 100_000,
    elevationGainMeters: 5000,
    cueCount: 50,
  }),
  MAX_MAP_PLAYBACK_SECONDS,
);

const base = computeMapPlaybackDuration({
  distanceMeters: 10_000,
  elevationGainMeters: 0,
  cueCount: 0,
});
const withCues = computeMapPlaybackDuration({
  distanceMeters: 10_000,
  elevationGainMeters: 0,
  cueCount: 5,
});
const withElevation = computeMapPlaybackDuration({
  distanceMeters: 10_000,
  elevationGainMeters: 400,
  cueCount: 0,
});
const withDistance = computeMapPlaybackDuration({
  distanceMeters: 15_000,
  elevationGainMeters: 0,
  cueCount: 0,
});

assert.ok(withCues > base, "cue count should increase duration");
assert.ok(withElevation > base, "elevation gain should increase duration");
assert.ok(withDistance > base, "distance should increase duration");

assert.equal(
  computeMapPlaybackDuration({
    distanceMeters: 7000,
    elevationGainMeters: 80,
    cueCount: 3,
  }),
  46,
);

console.log("route playback duration tests passed");
