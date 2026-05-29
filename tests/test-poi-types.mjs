import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  createRouteManager,
  addPoint,
} from "@cycleways/core/routing/routeActions.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const geoJsonData = JSON.parse(
  await readFile(new URL("./bike_roads_test.geojson", import.meta.url)),
);

// build a test segments file inline with a stable-id POI on a segment we know
// the route will traverse (segment id 15 — "דרך המנפטה" — see
// tests/test-react-route-actions.mjs).
const baseSegments = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
const segmentName = "דרך המנפטה";
baseSegments[segmentName] = {
  ...baseSegments[segmentName],
  data: [
    {
      type: "cafe",
      id: "cafe-test-1",
      information: "test cafe",
      location: [33.11124, 35.586584],
    },
  ],
};

const manager = await createRouteManager(
  RouteManager,
  geoJsonData,
  baseSegments,
);
// Adding points to cross the segment — coordinates pulled from existing test
let snapshot = addPoint(
  manager,
  { lat: 33.128051854432194, lng: 35.583601947688756 },
  baseSegments,
);
snapshot = addPoint(
  manager,
  { lat: 33.11076673723811, lng: 35.57875100376203 },
  baseSegments,
);

assert.ok(
  snapshot.selectedSegments.includes(segmentName),
  `expected route to cross ${segmentName}, got ${JSON.stringify(snapshot.selectedSegments)}`,
);

// The test segment may or may not be on the route; the important behavior:
// if a data point has an id, the resulting activeDataPoint must carry that id.
let matched = 0;
for (const dp of snapshot.activeDataPoints) {
  if (dp.segmentName === segmentName) {
    assert.equal(dp.id, "cafe-test-1");
    matched += 1;
  }
}
assert.ok(
  matched > 0,
  "expected at least one activeDataPoint from the seeded segment",
);

// Sanity: a POI without an explicit id still falls back to the synthesized id
const fallbackSegmentName = "כביש גישה אגמון החולה";
const fallbackBaseSegments = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
fallbackBaseSegments[fallbackSegmentName] = {
  ...fallbackBaseSegments[fallbackSegmentName],
  data: [
    {
      type: "viewpoint",
      information: "no-id viewpoint",
      location: [33.11124, 35.586584],
    },
  ],
};
const fallbackManager = await createRouteManager(
  RouteManager,
  geoJsonData,
  fallbackBaseSegments,
);
let fallbackSnapshot = addPoint(
  fallbackManager,
  { lat: 33.128051854432194, lng: 35.583601947688756 },
  fallbackBaseSegments,
);
fallbackSnapshot = addPoint(
  fallbackManager,
  { lat: 33.11076673723811, lng: 35.57875100376203 },
  fallbackBaseSegments,
);
for (const dp of fallbackSnapshot.activeDataPoints) {
  if (dp.segmentName === fallbackSegmentName) {
    assert.equal(dp.id, `${fallbackSegmentName}-0`);
  }
}

console.log("POI types tests passed");
