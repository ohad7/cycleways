import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import RouteManager from "../packages/core/route-manager.js";
import {
  createRouteManager,
  expandHybridRoutePayload,
  restoreRoute,
} from "../packages/core/src/routing/routeActions.js";
import { decodeRoutePayload } from "../packages/core/src/utils/route-encoding.js";
import {
  getBaseRoutingDecodeAssets,
  loadFeaturedAssetsFromDisk,
} from "../scripts/lib/featuredRouteSnapshotBuilder.mjs";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/bicycle-traversal/road-99-ride.json", "utf8"),
);
const metadata = JSON.parse(
  readFileSync("data/routing-compat/cw-base-index-v1.metadata.json", "utf8"),
);
const indexBytes = readFileSync("data/routing-compat/cw-base-index-v1.json");
const index = JSON.parse(indexBytes);

const decodedA = decodeRoutePayload(fixture.token);
const decodedB = decodeRoutePayload(fixture.token);
const anchors = (payload) =>
  payload.routePoints.map(({ baseEdgeShareId, baseEdgeFraction }) => ({
    baseEdgeShareId,
    baseEdgeFraction,
  }));
assert.equal(decodedA.type, "hybrid_route_v6");
assert.equal(decodedA.graphVersion, fixture.decoded.graphVersion);
assert.equal(decodedA.graphVersionHash, fixture.decoded.graphVersionHash);
assert.deepEqual(anchors(decodedA), fixture.decoded.anchors);
assert.deepEqual(anchors(decodedA), anchors(decodedB));
assert.deepEqual(decodedA.segmentIds, fixture.decoded.segmentIds);
assert.equal(
  createHash("sha256").update(indexBytes).digest("hex"),
  metadata.sourceSha256,
);
assert.equal(Object.keys(index.segments).length, 284);

const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk();
const { baseRoutingNetwork } = await getBaseRoutingDecodeAssets();
const manager = await createRouteManager(
  RouteManager,
  geoJsonData,
  segmentsData,
  baseRoutingNetwork,
);
const expanded = expandHybridRoutePayload(decodedA, index);
assert.equal(manager.restoreBaseRouteFromPayload(expanded), true);
let diagnostics = manager.getBaseRouteDiagnostics();
assert.ok(Math.abs(diagnostics.distance - fixture.knownBadExactReplay.distanceMeters) < 0.001);
assert.equal(diagnostics.traversals.length, fixture.knownBadExactReplay.traversalCount);
let edge370 = diagnostics.traversals.filter(
  (traversal) => traversal.edgeShareId === 370 && traversal.direction === "reverse",
);
assert.ok(Math.abs(edge370.reduce((sum, value) => sum + value.distanceMeters, 0) - 547.3) < 0.001);

restoreRoute(
  manager,
  fixture.coordinateReplan.coordinates.map((point, index) => ({ ...point, id: `fixture-${index}` })),
  segmentsData,
);
diagnostics = manager.getBaseRouteDiagnostics();
assert.equal(diagnostics.failure, null);
edge370 = diagnostics.traversals.filter(
  (traversal) => traversal.edgeShareId === 370 && traversal.direction === "reverse",
);
assert.ok(Math.abs(edge370.reduce((sum, value) => sum + value.distanceMeters, 0) - 547.3) < 0.001);

const audit = spawnSync("node", ["scripts/audit-bicycle-traversal-baseline.mjs", "--check"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
assert.equal(audit.status, 0, `${audit.stdout}\n${audit.stderr}`);

console.log("bicycle traversal baseline ok");
