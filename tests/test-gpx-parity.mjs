import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import { generateGPX } from "@cycleways/core/utils/gpx-generator.js";
import { addPoint, createRouteManager } from "@cycleways/core/routing/routeActions.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");

const geoJsonData = JSON.parse(
  await readFile(new URL("./bike_roads_test.geojson", import.meta.url)),
);
const segmentsData = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
const expectedHash = (
  await readFile(
    new URL("./fixtures/gpx-route-15-65-2.sha256", import.meta.url),
    "utf8",
  )
).trim();

const manager = await createRouteManager(
  RouteManager,
  geoJsonData,
  segmentsData,
);

let snapshot = addPoint(
  manager,
  { lat: 33.128051854432194, lng: 35.583601947688756 },
  segmentsData,
);
snapshot = addPoint(
  manager,
  { lat: 33.11076673723811, lng: 35.57875100376203 },
  segmentsData,
);
snapshot = addPoint(
  manager,
  { lat: 33.110140144352336, lng: 35.59054934237174 },
  segmentsData,
);

const gpx = generateGPX(snapshot.geometry);
assert.match(gpx, /<gpx version="1.1"/);
assert.equal((gpx.match(/<trkpt /g) || []).length, snapshot.geometry.length);
assert.equal(createHash("sha256").update(gpx).digest("hex"), expectedHash);

console.log("GPX parity test passed");
