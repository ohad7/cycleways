import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import {
  addPoint,
  buildShareUrl,
  clearRoute,
  createRouteManager,
  dragPoint,
  removePoint,
  restoreRouteFromParam,
} from "../src/routing/routeActions.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../route-manager.js");

const geoJsonData = JSON.parse(
  await readFile(new URL("./bike_roads_test.geojson", import.meta.url)),
);
const segmentsData = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
const productionGeoJsonData = JSON.parse(
  await readFile(new URL("../bike_roads.cd4bcf12c17f.geojson", import.meta.url)),
);
const productionSegmentsData = JSON.parse(
  await readFile(new URL("../segments.cd4bcf12c17f.json", import.meta.url)),
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
