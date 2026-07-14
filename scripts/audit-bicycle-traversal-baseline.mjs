#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outputArgIndex = process.argv.indexOf("--output");
const outputPath = resolve(
  root,
  outputArgIndex >= 0
    ? process.argv[outputArgIndex + 1]
    : "data/routing-compat/bicycle-traversal-baseline.json",
);
const check = process.argv.includes("--check");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath).toString("utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function directedKey(ref) {
  return [
    String(ref.edgeId || ""),
    ref.direction === "reverse" ? "reverse" : "forward",
    Number(ref.fromFraction ?? 0),
    Number(ref.toFraction ?? 1),
  ].join("|");
}

const indexBytes = read("data/routing-compat/cw-base-index-v1.json");
const overlayBytes = read("data/routing-compat/cw-base-overlay-v1.json");
const registryBytes = read("data/routing-compat/base-edge-share-registry-v1.json");
const index = JSON.parse(indexBytes);
const overlay = JSON.parse(overlayBytes);
const registry = JSON.parse(registryBytes);
const ride = readJson("tests/fixtures/bicycle-traversal/road-99-ride.json");
const mapSource = readJson("data/map-source.geojson");
const publicSegmentIds = new Set(Object.keys(index.segments || {}));
const overlayEntries = Object.entries(overlay.segments || {});
const archivedEntries = overlayEntries.filter(([segmentId]) => !publicSegmentIds.has(segmentId));
const activeEntries = overlayEntries.filter(([segmentId]) => publicSegmentIds.has(segmentId));

const keyOwners = new Map();
for (const [segmentId, mapping] of overlayEntries) {
  for (const ref of mapping.edgeRefs || []) {
    const key = directedKey(ref);
    const owners = keyOwners.get(key) || [];
    owners.push({ segmentId: Number(segmentId), active: publicSegmentIds.has(segmentId) });
    keyOwners.set(key, owners);
  }
}

const overlaps = {
  duplicatedDirectedKeys: 0,
  activeToActiveKeys: 0,
  activeToArchiveKeys: 0,
  archiveToArchiveKeys: 0,
};
for (const owners of keyOwners.values()) {
  if (owners.length < 2) continue;
  overlaps.duplicatedDirectedKeys += 1;
  const active = owners.filter((owner) => owner.active).length;
  const archived = owners.length - active;
  if (active > 1) overlaps.activeToActiveKeys += 1;
  if (active > 0 && archived > 0) overlaps.activeToArchiveKeys += 1;
  if (archived > 1) overlaps.archiveToArchiveKeys += 1;
}

const logicalStatusCounts = {};
for (const feature of mapSource.features || []) {
  const status = String(feature?.properties?.status || "active");
  logicalStatusCounts[status] = (logicalStatusCounts[status] || 0) + 1;
}

const consumerPaths = [
  "packages/core/src/routing/routeActions.js",
  "packages/core/src/routing/shardedRouteSession.js",
  "packages/core/route-manager.js",
  "public-data/route-catalog.json",
  "public-data/featured-routes",
  "src/featured",
];

const inventory = {
  schemaVersion: 1,
  releaseId: "2026-07-13-v1",
  immutableInputs: {
    cwBaseIndexV1Sha256: sha256(indexBytes),
    cwBaseOverlayV1Sha256: sha256(overlayBytes),
    baseEdgeShareRegistryV1FileSha256: sha256(registryBytes),
    baseEdgeShareRegistryDigest: registry.registryDigest,
    logicalMapSourceSha256: sha256(read("data/map-source.geojson")),
    baseRoutingManifestSha256: sha256(read("public-data/base-routing-shards/manifest.json")),
  },
  graphIdentity: {
    graphVersion: registry.graphVersion,
    legacyGraphVersionHash: ride.decoded.graphVersion.slice(1),
    registryDigest: registry.registryDigest,
    lookup: registry.legacyGraphVersionHashes,
  },
  cycleways: {
    publicIndexMappings: publicSegmentIds.size,
    overlayRecords: overlayEntries.length,
    activeOverlayMappings: activeEntries.length,
    deprecatedSplitArchiveMappings: archivedEntries.length,
    activeMappingRefs: activeEntries.reduce(
      (sum, [, mapping]) => sum + (mapping.edgeRefs || []).length,
      0,
    ),
    archiveMappingRefs: archivedEntries.reduce(
      (sum, [, mapping]) => sum + (mapping.edgeRefs || []).length,
      0,
    ),
    archivedSegmentIds: archivedEntries.map(([segmentId]) => Number(segmentId)).sort((a, b) => a - b),
    logicalStatusCounts: stable(logicalStatusCounts),
    directedOwnershipOverlaps: overlaps,
  },
  routeConsumers: consumerPaths.map((path) => ({
    path,
    present: existsSync(resolve(root, path)),
  })),
  road99Fingerprint: {
    tokenSha256: ride.tokenSha256,
    graphVersion: ride.decoded.graphVersion,
    anchorsSha256: sha256(canonical(ride.decoded.anchors)),
    coordinatesSha256: sha256(canonical(ride.coordinateReplan.coordinates)),
    knownBadDistanceMeters: ride.knownBadExactReplay.distanceMeters,
    knownBadEdgeShareId: ride.knownBadExactReplay.forbiddenTraversal.edgeShareId,
    knownBadReverseMeters: ride.knownBadExactReplay.forbiddenTraversal.distanceMeters,
  },
};

if (inventory.cycleways.publicIndexMappings !== 284) {
  throw new Error(`expected 284 V1 public mappings, got ${inventory.cycleways.publicIndexMappings}`);
}
if (inventory.cycleways.overlayRecords !== 309) {
  throw new Error(`expected 309 V1 overlay records, got ${inventory.cycleways.overlayRecords}`);
}
if (inventory.cycleways.deprecatedSplitArchiveMappings !== 25) {
  throw new Error(
    `expected 25 deprecated overlay archives, got ${inventory.cycleways.deprecatedSplitArchiveMappings}`,
  );
}
if (overlaps.activeToActiveKeys !== 0 || overlaps.activeToArchiveKeys !== 155) {
  throw new Error(`unexpected directed ownership baseline: ${JSON.stringify(overlaps)}`);
}
const hashOwners = Object.values(registry.legacyGraphVersionHashes || {});
if (hashOwners.length !== 1 || hashOwners[0] !== registry.registryDigest) {
  throw new Error("legacy graphVersionHash does not resolve to exactly one released registry");
}

const content = JSON.stringify(inventory, null, 2) + "\n";
if (check) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content) {
    console.error(`bicycle traversal baseline is stale: ${outputPath}`);
    process.exit(1);
  }
} else {
  writeFileSync(outputPath, content);
}
console.log(
  `bicycle traversal baseline ok: ${inventory.cycleways.publicIndexMappings} active, ` +
    `${inventory.cycleways.deprecatedSplitArchiveMappings} archived, ` +
    `${overlaps.activeToActiveKeys} active overlaps`,
);
