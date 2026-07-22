import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import RouteManager from "../packages/core/route-manager.js";
import {
  createRouteManager,
  expandHybridRoutePayload,
} from "../packages/core/src/routing/routeActions.js";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import { decodeMessagePack } from "../packages/core/src/routing/messagePack.js";
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
const decodeAssets = await getBaseRoutingDecodeAssets();
const { baseRoutingNetwork } = decodeAssets;
const manager = await createRouteManager(
  RouteManager,
  geoJsonData,
  segmentsData,
  baseRoutingNetwork,
);
const expanded = expandHybridRoutePayload(decodedA, index);
assert.equal(
  manager.restoreBaseRouteFromPayload(expanded),
  false,
  "the historical unsafe traversal must not replay against the current graph",
);

const routeAnchorCompatibility = JSON.parse(
  readFileSync("data/routing-compat/route-anchor-compatibility.json", "utf8"),
);
const session = await createShardedRouteSession(
  RouteManager,
  geoJsonData,
  segmentsData,
  decodeAssets.shardManifest,
  async (entry) => {
    const bytes = readFileSync(resolve(decodeAssets.shardsDir, entry.path));
    if (entry.format === "compact") return decodeCompactBaseRoutingShard(bytes);
    if (entry.format === "msgpack") return decodeMessagePack(bytes);
    return JSON.parse(new TextDecoder().decode(bytes));
  },
  {
    paddingShards: 1,
    cwBaseIndex: decodeAssets.cwBaseIndex,
    legacyRoutingCompatibility: decodeAssets.legacyRoutingCompatibility,
    routeAnchorCompatibility,
  },
);
const recovered = await session.restoreRouteParam(fixture.token);
assert.ok(recovered, "the released reported-ride token must preserve its waypoint intent");
assert.equal(recovered.requiresReview, true);
assert.match(recovered.restoreDisposition, /^replanned-current-policy/);
assert.equal(recovered.routeFailure, null);
assert.ok(recovered.geometry.length >= 2);
assert.equal(
  recovered.routingValidation.traversalSlices.every(
    (slice) => slice.policyState === "allowed",
  ),
  true,
  "historical recovery must use only current-policy allowed traversals",
);
assert.equal(
  recovered.routingValidation.traversalSlices.some(
    (slice) =>
      Number(slice.edgeShareId) === 370 &&
      Number(slice.fromFractionQ) > Number(slice.toFractionQ),
  ),
  false,
  "historical recovery must not restore the forbidden Road 99 reverse",
);

const audit = spawnSync("node", ["scripts/audit-bicycle-traversal-baseline.mjs", "--check"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
assert.equal(audit.status, 0, `${audit.stdout}\n${audit.stderr}`);

console.log("bicycle traversal baseline ok");
