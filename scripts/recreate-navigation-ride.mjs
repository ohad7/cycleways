#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import { decodeMessagePack } from "../packages/core/src/routing/messagePack.js";
import { validateRouteAttestation } from "../packages/core/src/routing/routeAttestation.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");
const { values } = parseArgs({
  options: {
    root: { type: "string", default: "build/public-data" },
    fixture: {
      type: "string",
      default: "tests/fixtures/bicycle-traversal/road-99-ride.json",
    },
    check: { type: "boolean", default: false },
  },
});

const root = path.resolve(values.root);
const fixture = JSON.parse(await readFile(path.resolve(values.fixture), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "map-manifest.json"), "utf8"));
const geoJsonData = JSON.parse(await readFile(path.join(root, manifest.bikeRoads), "utf8"));
const segmentsData = JSON.parse(await readFile(path.join(root, manifest.segments), "utf8"));
const cwBaseIndex = JSON.parse(await readFile(path.join(root, manifest.cwBaseIndex), "utf8"));
const shardManifestPath = path.join(root, manifest.baseRoutingShards);
const shardManifest = JSON.parse(await readFile(shardManifestPath, "utf8"));
const shardRoot = path.dirname(shardManifestPath);

async function loadShard(entry) {
  const bytes = await readFile(path.join(shardRoot, entry.path));
  const expected = entry.formats?.[entry.format]?.sha256;
  if (expected) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`shard digest mismatch: ${entry.id}`);
  }
  if (entry.format === "compact") return decodeCompactBaseRoutingShard(bytes);
  if (entry.format === "msgpack") return decodeMessagePack(bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const session = await createShardedRouteSession(
  RouteManager,
  geoJsonData,
  segmentsData,
  shardManifest,
  loadShard,
  { cwBaseIndex, paddingShards: 1 },
);
const points = fixture.coordinateReplan.coordinates.map((point, index) => ({
  ...point,
  id: `reported-ride-${index}`,
}));
const route = await session.restorePoints(points);
const slices = route?.routingValidation?.traversalSlices || [];
const forbidden = slices.filter((slice) => slice.policyState !== "allowed");
const edge370Reverse = slices.filter(
  (slice) =>
    Number(slice.edgeShareId) === 370 &&
    Number(slice.fromFractionQ) > Number(slice.toFractionQ),
);
const blockers = [];
if (!route || route.routeFailure) blockers.push("coordinate-replan-failed");
if (!validateRouteAttestation(route?.routingValidation, { geometry: route?.geometry }).ok) {
  blockers.push("route-attestation-invalid");
}
if (forbidden.length > 0) blockers.push("non-allowed-traversal");
if (edge370Reverse.length > 0) blockers.push("road-99-edge-370-reverse");
const acceptedFingerprint = fixture.coordinateReplan.acceptedFingerprint;
const actualFingerprint = route?.routingValidation?.contentFingerprint || null;
if (!acceptedFingerprint) {
  blockers.push("replacement-fingerprint-unaccepted");
} else if (acceptedFingerprint !== actualFingerprint) {
  blockers.push("replacement-fingerprint-changed");
}

const report = {
  schemaVersion: 1,
  status: blockers.length === 0 ? "ready" : "blocked",
  root,
  fixture: path.resolve(values.fixture),
  blockers,
  route: route
    ? {
      distanceMeters: route.distance,
      waypointCount: route.points?.length || 0,
      traversalCount: slices.length,
      contentFingerprint: actualFingerprint,
      requiresReview: route.requiresReview === true,
      routeFailure: route.routeFailure || null,
      unsnappedPoints: (route.points || [])
        .map((point, index) => ({ index, lat: point.lat, lng: point.lng, unsnapped: point.unsnapped === true }))
        .filter((point) => point.unsnapped),
      }
    : null,
};
console.log(JSON.stringify(report, null, 2));
if (values.check && blockers.length > 0) process.exitCode = 1;
