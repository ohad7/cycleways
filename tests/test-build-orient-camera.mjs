import assert from "node:assert/strict";
import {
  buildOrientZoom,
  BUILD_ORIENT_ZOOM_OUT,
  BUILD_ORIENT_MIN_ZOOM,
} from "../src/map/buildOrientCamera.js";

// Steps out by the default delta from a typical Discover zoom.
assert.equal(buildOrientZoom(12), 12 - BUILD_ORIENT_ZOOM_OUT, "steps out by default delta");

// Clamps to the floor so entering Build never becomes a whole-country view.
assert.equal(
  buildOrientZoom(BUILD_ORIENT_MIN_ZOOM + 0.5),
  BUILD_ORIENT_MIN_ZOOM,
  "clamps to the floor when the step would cross it",
);
assert.equal(
  buildOrientZoom(BUILD_ORIENT_MIN_ZOOM - 3),
  BUILD_ORIENT_MIN_ZOOM,
  "already-below-floor stays at the floor",
);

// Custom delta / floor are honored.
assert.equal(buildOrientZoom(14, { delta: 2 }), 12, "custom delta honored");
assert.equal(buildOrientZoom(9, { minZoom: 8.5 }), 8.5, "custom floor honored");

// Non-finite input yields null so callers can skip the camera move.
assert.equal(buildOrientZoom(undefined), null, "undefined -> null");
assert.equal(buildOrientZoom(NaN), null, "NaN -> null");

console.log("test-build-orient-camera.mjs passed");
