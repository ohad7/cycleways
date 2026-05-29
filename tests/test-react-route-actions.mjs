import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import {
  addPoint,
  buildShareInfo,
  buildShareUrl,
  clearRoute,
  createRouteManager,
  dragPoint,
  expandHybridRoutePayload,
  removePoint,
  restoreRouteFromParam,
} from "@cycleways/core/routing/routeActions.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const geoJsonData = JSON.parse(
  await readFile(new URL("./bike_roads_test.geojson", import.meta.url)),
);
const segmentsData = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
const productionManifest = JSON.parse(
  await readFile(new URL("../public-data/map-manifest.json", import.meta.url)),
);
const productionGeoJsonData = JSON.parse(
  await readFile(new URL(`../public-data/${productionManifest.bikeRoads}`, import.meta.url)),
);
const productionSegmentsData = JSON.parse(
  await readFile(new URL(`../public-data/${productionManifest.segments}`, import.meta.url)),
);

const manager = await createRouteManager(
  RouteManager,
  geoJsonData,
  segmentsData,
);

const firstPoint = {
  lat: 33.128051854432194,
  lng: 35.583601947688756,
};
const secondPoint = {
  lat: 33.11076673723811,
  lng: 35.57875100376203,
};
const thirdPoint = {
  lat: 33.110140144352336,
  lng: 35.59054934237174,
};

let snapshot = addPoint(manager, firstPoint, segmentsData);
assert.equal(snapshot.points.length, 1);
assert.equal(snapshot.selectedSegments.length, 0);
assert.equal(snapshot.geometry.length, 0);

snapshot = addPoint(manager, secondPoint, segmentsData);
assert.equal(snapshot.points.length, 2);
assert.deepEqual(getSegmentIds(snapshot.selectedSegments), [15, 65]);
assert.ok(snapshot.geometry.length >= 2);

snapshot = addPoint(manager, thirdPoint, segmentsData);
assert.equal(snapshot.points.length, 3);
assert.deepEqual(getSegmentIds(snapshot.selectedSegments), [15, 65, 2]);

snapshot = dragPoint(
  manager,
  snapshot.points,
  2,
  {
    lat: 33.11019014435234,
    lng: 35.59049934237174,
  },
  segmentsData,
);
assert.equal(snapshot.points.length, 3);
assert.ok(snapshot.geometry.length >= 2);

const shareUrl = buildShareUrl(
  snapshot,
  segmentsData,
  manager,
  new URL("https://example.test/"),
);
assert.match(shareUrl, /^https:\/\/example\.test\/\?route=/);
const shareInfo = buildShareInfo(
  snapshot,
  segmentsData,
  manager,
  new URL("https://example.test/"),
);
assert.equal(shareInfo.status, "ok");
assert.equal(shareInfo.format, "compact_route");
assert.equal(shareInfo.url, shareUrl);

const expandedHybridPayload = expandHybridRoutePayload(
  {
    type: "hybrid_route_v5",
    graphVersion: "test",
    routePoints: [
      { lng: 35, lat: 33, baseEdgeShareId: 10, baseEdgeFraction: 0 },
      { lng: 35.001, lat: 33, baseEdgeShareId: 12, baseEdgeFraction: 1 },
    ],
    shards: [{ id: "g700_660", x: 700, y: 660 }],
    spans: [{ type: "cw", segmentId: 7, reversed: false }],
  },
  {
    segments: {
      7: [[10, 0], [11, 1], [12, 0]],
    },
  },
);
assert.deepEqual(expandedHybridPayload.legs[0], {
  fromPoint: 0,
  toPoint: 1,
  edgeShareIds: [10, 11, 12],
  directions: ["forward", "reverse", "forward"],
});

const expandedHybridV6Payload = expandHybridRoutePayload(
  {
    type: "hybrid_route_v6",
    graphVersionHash: 123,
    routePoints: [
      { baseEdgeShareId: 10, baseEdgeFraction: 0 },
      { baseEdgeShareId: 13, baseEdgeFraction: 1 },
    ],
    shards: [{ id: "g700_660", x: 700, y: 660 }],
    spans: [
      {
        type: "cwChain",
        runs: [
          { segmentId: 7, reversed: false, startIndex: 0, edgeCount: 2 },
          { segmentId: 8, reversed: true, startIndex: 1, edgeCount: 2 },
        ],
      },
    ],
  },
  {
    segments: {
      7: [[10, 0], [11, 1]],
      8: [[14, 0], [13, 1]],
    },
  },
);
assert.deepEqual(expandedHybridV6Payload.legs[0], {
  fromPoint: 0,
  toPoint: 1,
  edgeShareIds: [10, 11, 13, 14],
  directions: ["forward", "reverse", "forward", "reverse"],
});

const restoredManager = await createRouteManager(
  RouteManager,
  geoJsonData,
  segmentsData,
);
const restoredSnapshot = restoreRouteFromParam(
  restoredManager,
  new URL(shareUrl).searchParams.get("route"),
  segmentsData,
);
assert.ok(restoredSnapshot.points.length <= snapshot.points.length);
assert.deepEqual(getSegmentIds(restoredSnapshot.selectedSegments), [15, 65, 2]);
assert.ok(restoredSnapshot.geometry.length >= 2);

snapshot = removePoint(manager, 1, segmentsData);
assert.equal(snapshot.points.length, 2);
assert.ok(snapshot.geometry.length >= 2);

snapshot = clearRoute(manager);
assert.equal(snapshot.points.length, 0);
assert.equal(snapshot.selectedSegments.length, 0);
assert.equal(snapshot.geometry.length, 0);

const productionManager = await createRouteManager(
  RouteManager,
  productionGeoJsonData,
  productionSegmentsData,
);
const compactProductionSnapshot = restoreRouteFromParam(
  productionManager,
  "Bjjy1nRHHDArrNAoctqGv4RHL3un",
  productionSegmentsData,
);
assert.equal(compactProductionSnapshot.selectedSegments.length, 3);
assert.ok(compactProductionSnapshot.geometry.length >= 2);

const legacyProductionManager = await createRouteManager(
  RouteManager,
  productionGeoJsonData,
  productionSegmentsData,
);
const legacyProductionSnapshot = restoreRouteFromParam(
  legacyProductionManager,
  "AQByAAcABAAFAFgAYABeAAoAeAAZAHIA",
  productionSegmentsData,
);
assert.ok(legacyProductionSnapshot.points.length > 0);
assert.ok(legacyProductionSnapshot.geometry.length >= 2);

console.log("React route action tests passed");

function getSegmentIds(segmentNames) {
  return segmentNames.map((name) => segmentsData[name].id);
}
