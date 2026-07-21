#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
    "geojson-output": { type: "string" },
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
const traversedShareIds = new Set(slices.map((slice) => Number(slice.edgeShareId)));
const requiredSegments = (fixture.coordinateReplan.requiredSegmentIds || []).map((value) => {
  const segmentId = Number(value);
  const segment = cwBaseIndex.segments?.[String(segmentId)];
  const acceptedShareIds = [...new Set(
    Object.values(segment?.alignments || {})
      .filter((alignment) => alignment?.disposition === "accepted")
      .flatMap((alignment) => alignment.edgeRefs || [])
      .map((ref) => Number(ref[0])),
  )];
  const traversedAcceptedShareIds = acceptedShareIds.filter((shareId) =>
    traversedShareIds.has(shareId),
  );
  return {
    segmentId,
    published: acceptedShareIds.length > 0,
    traversed: traversedAcceptedShareIds.length > 0,
    traversedAcceptedShareIds,
  };
});
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
for (const required of requiredSegments) {
  if (!required.published) blockers.push(`required-segment-unpublished:${required.segmentId}`);
  else if (!required.traversed) blockers.push(`required-segment-not-traversed:${required.segmentId}`);
}
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
  requiredSegments,
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
if (values["geojson-output"] && Array.isArray(route?.geometry) && route.geometry.length >= 2) {
  await writeFile(
    path.resolve(values["geojson-output"]),
    `${JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            scenario: "road-99-reported-ride",
            kind: "current-policy-recreation",
            distanceMeters: route.distance,
            traversalCount: slices.length,
            stroke: "#16833f",
            "stroke-width": 6,
            "stroke-opacity": 0.9,
          },
          geometry: {
            type: "LineString",
            coordinates: route.geometry.map((point) => [
              Number(point.lng),
              Number(point.lat),
            ]),
          },
        },
      ],
    }, null, 2)}\n`,
  );
}
console.log(JSON.stringify(report, null, 2));
if (values.check && blockers.length > 0) process.exitCode = 1;
