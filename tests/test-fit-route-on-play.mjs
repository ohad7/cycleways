import assert from "node:assert/strict";
import { shouldFitOnPlayStart } from "../src/components/routePlayback/useFitRouteOnPlay.js";

// Fresh start from the beginning -> fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: false, isPlaying: true, currentTime: 0, geometryLength: 5 }),
  true,
  "fresh start at t=0 fits",
);

// Resume from mid-route -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: false, isPlaying: true, currentTime: 30, geometryLength: 5 }),
  false,
  "resume at t>threshold does not fit",
);

// Already playing (no transition) -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: true, isPlaying: true, currentTime: 0, geometryLength: 5 }),
  false,
  "no false->true transition does not fit",
);

// Not enough geometry -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: false, isPlaying: true, currentTime: 0, geometryLength: 1 }),
  false,
  "too-short geometry does not fit",
);

// Pausing (isPlaying false) -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: true, isPlaying: false, currentTime: 0, geometryLength: 5 }),
  false,
  "pausing does not fit",
);

console.log("test-fit-route-on-play.mjs passed");
