import assert from "node:assert/strict";
import {
  LOCATE_MIN_ZOOM,
  LOCATE_TARGET_ZOOM,
  plannerLocateCameraView,
} from "@cycleways/core/navigation/plannerLocateCamera.js";

assert.equal(LOCATE_MIN_ZOOM, 12);
assert.equal(LOCATE_TARGET_ZOOM, 14.5);

assert.deepEqual(
  plannerLocateCameraView({ zoom: 11.9, pitch: 0 }),
  { zoomLevel: 14.5, pitch: 0 },
  "a wide view uses the locate target zoom",
);
assert.deepEqual(
  plannerLocateCameraView({ zoom: 12, pitch: 18 }),
  { zoomLevel: 12, pitch: 18 },
  "the minimum retained zoom and a finite pitch are preserved",
);
assert.deepEqual(
  plannerLocateCameraView({ zoom: 16, pitch: 45 }),
  { zoomLevel: 16, pitch: 45 },
  "a close, tilted planner view is preserved",
);
assert.deepEqual(
  plannerLocateCameraView(),
  { zoomLevel: 14.5, pitch: 0 },
  "missing values use the safe locate defaults",
);
assert.deepEqual(
  plannerLocateCameraView({ zoom: Number.NaN, pitch: Number.POSITIVE_INFINITY }),
  { zoomLevel: 14.5, pitch: 0 },
  "non-finite values use the safe locate defaults",
);

const view = plannerLocateCameraView({ zoom: 15, pitch: 30 });
assert.equal(
  Object.hasOwn(view, "heading"),
  false,
  "heading is omitted so Mapbox retains the user-rotated view",
);

console.log("ok");
