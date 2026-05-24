import assert from "node:assert/strict";
import { createVideoSync } from "../src/components/featured/videoSync.js";

const simpleRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.01 },
];

// Valid keyframes — should succeed
const sync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: simpleRoute,
});
assert.ok(sync, "createVideoSync returns a non-null object");

// Empty keyframes — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /at least 2 keyframes/i,
);

// Not sorted by t — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 10, lat: 33.0, lng: 35.01 },
        { t: 0, lat: 33.0, lng: 35.0 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /sorted by t/i,
);

// First t must be 0
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 1, lat: 33.0, lng: 35.0 },
        { t: 10, lat: 33.0, lng: 35.01 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /first keyframe.*t === 0/i,
);

// Last t must equal videoDuration
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0 },
        { t: 9, lat: 33.0, lng: 35.01 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /last keyframe.*videoDuration/i,
);

// Route too short (< 2 points) — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0 },
        { t: 10, lat: 33.0, lng: 35.0 },
      ],
      videoDuration: 10,
      routeGeometry: [{ lat: 33.0, lng: 35.0 }],
    }),
  /route.*at least 2/i,
);

console.log("videoSync validation tests passed");
