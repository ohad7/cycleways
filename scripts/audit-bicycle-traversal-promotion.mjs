#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import {
  isActiveCwOverlaySegment,
  parseCwOverlayV2,
} from "../editor/lib/cw-overlay-v2.mjs";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: "public-data" },
    overlay: { type: "string", default: "data/cw-base-overlay.v2.staged.json" },
    registry: { type: "string", default: "data/base-edge-share-ids.json" },
    "registry-proposal": {
      type: "string",
      default: "build/base-edge-share-ids.proposal.json",
    },
    "registry-history-dir": {
      type: "string",
      default: "data/routing-registry-history",
    },
    "report-only": { type: "boolean", default: false },
  },
});
const root = path.resolve(values.root);
const blockers = [];
const warnings = [];
const stats = {};

function block(code, detail) {
  blockers.push({ code, detail });
}

async function json(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function digest(relative) {
  return createHash("sha256")
    .update(await readFile(path.join(root, relative)))
    .digest("hex");
}

async function digestAbsolute(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function validateShareRegistry(contract) {
  const registryPath = path.resolve(values.registry);
  const proposalPath = path.resolve(values["registry-proposal"]);
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const registryDigest = await digestAbsolute(registryPath);
  let proposal = null;
  let proposalDigest = null;
  try {
    proposal = JSON.parse(await readFile(proposalPath, "utf8"));
    proposalDigest = await digestAbsolute(proposalPath);
  } catch {}
  const expected = contract.baseEdgeShareRegistryDigest;
  if (expected === registryDigest) {
    stats.shareRegistrySource = "released";
    return registry;
  }
  if (!proposal || expected !== proposalDigest) {
    block("share-registry-contract-disagreement", {
      expected,
      registryDigest,
      proposalDigest,
    });
    return null;
  }
  const releasedEdges = registry.edges || {};
  const proposedEdges = proposal.edges || {};
  for (const [edgeId, shareId] of Object.entries(releasedEdges)) {
    if (proposedEdges[edgeId] !== shareId) {
      block("share-registry-rebinding", { edgeId, shareId, proposed: proposedEdges[edgeId] });
    }
  }
  if (Number(proposal.nextShareId) < Number(registry.nextShareId)) {
    block("share-registry-high-water-regression", {
      released: registry.nextShareId,
      proposed: proposal.nextShareId,
    });
  }
  const ids = Object.values(proposedEdges).map(Number);
  if (new Set(ids).size !== ids.length) block("share-registry-duplicate-id", null);
  stats.shareRegistrySource = "proposal";
  stats.shareRegistryNewIds = Object.keys(proposedEdges).length - Object.keys(releasedEdges).length;
  return proposal;
}

async function validateRouteAnchorCompatibility(currentRegistry) {
  const descriptor = manifest?.routeAnchorCompatibility;
  if (!descriptor?.path) {
    block("route-anchor-compatibility-unbundled", null);
    return;
  }
  const actualDigest = await digest(descriptor.path);
  const expectedDigest = String(
    descriptor.sha256 || manifest.hashes?.routeAnchorCompatibility || "",
  );
  if (!expectedDigest || actualDigest !== expectedDigest) {
    block("route-anchor-compatibility-hash-disagreement", {
      expected: expectedDigest,
      actual: actualDigest,
    });
    return;
  }
  const compatibility = await json(descriptor.path);
  if (
    Number(compatibility.schemaVersion) !== 1 ||
    compatibility.fractionBasis !== "distance-along-historical-edge-v1"
  ) {
    block("route-anchor-compatibility-contract-invalid", {
      schemaVersion: compatibility.schemaVersion,
      fractionBasis: compatibility.fractionBasis,
    });
    return;
  }
  const graphVersions = compatibility.graphVersions || {};
  const advertised = descriptor.graphVersionHashes || {};
  const archivedLineage = Object.fromEntries(
    Object.entries(graphVersions).map(([hash, record]) => [hash, record.registryDigest]),
  );
  const lineageKeys = new Set([
    ...Object.keys(advertised),
    ...Object.keys(archivedLineage),
  ]);
  if (
    [...lineageKeys].some(
      (graphHash) => String(advertised[graphHash] || "") !== String(archivedLineage[graphHash] || ""),
    )
  ) {
    block("route-anchor-compatibility-lineage-disagreement", {
      advertised,
      archived: archivedLineage,
    });
  }

  const currentByShareId = new Map(
    Object.entries(currentRegistry?.edges || {}).map(([edgeId, shareId]) => [
      String(shareId),
      edgeId,
    ]),
  );
  const historyDir = path.resolve(values["registry-history-dir"]);
  const checkedRegistries = new Map();
  let archivedEdges = 0;
  let routeIntents = 0;
  for (const [graphHash, record] of Object.entries(graphVersions)) {
    const registryDigest = String(record?.registryDigest || "");
    if (!/^[0-9a-f]{8}$/.test(graphHash) || !/^[0-9a-f]{64}$/.test(registryDigest)) {
      block("route-anchor-compatibility-lineage-invalid", { graphHash, registryDigest });
      continue;
    }
    let historicalRegistry = checkedRegistries.get(registryDigest);
    if (!historicalRegistry) {
      const registryPath = path.join(historyDir, `${registryDigest}.json`);
      let registryBytes;
      try {
        registryBytes = await readFile(registryPath);
        const registryActualDigest = createHash("sha256").update(registryBytes).digest("hex");
        if (registryActualDigest !== registryDigest) {
          block("route-anchor-history-registry-hash-mismatch", {
            registryDigest,
            actual: registryActualDigest,
          });
          continue;
        }
        historicalRegistry = JSON.parse(registryBytes.toString("utf8"));
        checkedRegistries.set(registryDigest, historicalRegistry);
      } catch (error) {
        block("route-anchor-history-registry-missing", {
          registryDigest,
          error: error.message,
        });
        continue;
      }
    }
    for (const [shareId, edge] of Object.entries(record.archivedEdges || {})) {
      archivedEdges += 1;
      const edgeId = String(edge?.edgeId || "");
      if (String(historicalRegistry.edges?.[edgeId]) !== shareId) {
        block("route-anchor-history-binding-invalid", {
          graphHash,
          shareId,
          edgeId,
          historicalShareId: historicalRegistry.edges?.[edgeId] ?? null,
        });
      }
      const currentEdgeId = currentByShareId.get(shareId);
      if (currentEdgeId && currentEdgeId !== edgeId) {
        block("route-anchor-share-id-rebound", {
          graphHash,
          shareId,
          historicalEdgeId: edgeId,
          currentEdgeId,
        });
      }
      const coordinates = edge?.coordinates || [];
      if (
        coordinates.length < 2 ||
        coordinates.some(
          (coordinate) =>
            !Array.isArray(coordinate) ||
            !Number.isFinite(Number(coordinate[0])) ||
            !Number.isFinite(Number(coordinate[1])),
        )
      ) {
        block("route-anchor-geometry-invalid", { graphHash, shareId, edgeId });
      }
    }
    const intents = record.routeIntents || {};
    if (Object.keys(intents).length === 0) {
      block("route-anchor-intents-missing", { graphHash });
    }
    for (const [intentKey, intent] of Object.entries(intents)) {
      routeIntents += 1;
      const points = intent?.points || [];
      const detours = intent?.detours || [];
      if (
        !/^sha256-[0-9a-f]{64}$/.test(intentKey) ||
        points.length < 2 ||
        points.some(
          (point) =>
            !Array.isArray(point) ||
            !Number.isFinite(Number(point[0])) ||
            !Number.isFinite(Number(point[1])),
        )
        || !Array.isArray(detours)
        || detours.some((detour) =>
          !Number.isSafeInteger(Number(detour?.afterPointIndex))
          || Number(detour.afterPointIndex) < 0
          || Number(detour.afterPointIndex) >= points.length - 1
          || !Array.isArray(detour?.segmentIds)
          || detour.segmentIds.some((segmentId) => !Number.isSafeInteger(Number(segmentId)))
          || !Array.isArray(detour?.points)
          || detour.points.length === 0
          || detour.points.some((point) =>
            !Array.isArray(point)
            || !Number.isFinite(Number(point[0]))
            || !Number.isFinite(Number(point[1]))
          )
          || (detour.strongPoints !== undefined && (
            !Array.isArray(detour.strongPoints)
            || detour.strongPoints.length === 0
            || detour.strongPoints.some((point) =>
              !Array.isArray(point)
              || !Number.isFinite(Number(point[0]))
              || !Number.isFinite(Number(point[1]))
            )
          ))
        )
      ) {
        block("route-anchor-intent-invalid", { graphHash, intentKey });
      }
    }
  }
  stats.routeAnchorCompatibilityGraphVersions = Object.keys(graphVersions).length;
  stats.routeAnchorCompatibilityArchivedEdges = archivedEdges;
  stats.routeAnchorCompatibilityRegistries = checkedRegistries.size;
  stats.routeAnchorCompatibilityRouteIntents = routeIntents;
}

let manifest;
let shardManifest;
let overlay;
let cwIndex;
let alignmentGeometry;
try {
  manifest = await json("map-manifest.json");
  shardManifest = await json(manifest.baseRoutingShards);
  cwIndex = await json(manifest.cwBaseIndex);
  alignmentGeometry = manifest.cwAlignmentGeometry
    ? await json(manifest.cwAlignmentGeometry)
    : null;
  overlay = parseCwOverlayV2(
    JSON.parse(await readFile(path.resolve(values.overlay), "utf8")),
  );
} catch (error) {
  block("asset-load-failed", error.message);
}

if (manifest && shardManifest && overlay && cwIndex) {
  const contract = shardManifest.routingContract || {};
  const currentRegistry = await validateShareRegistry(contract);
  await validateRouteAnchorCompatibility(currentRegistry);
  if (
    Number(shardManifest.sourceRoutingSchemaVersion) !== 3 ||
    Number(contract.baseRoutingSchemaVersion) !== 3 ||
    contract.strictTraversalPolicy !== true
  ) {
    block("routing-contract-not-strict-v3", contract);
  }
  if (
    contract.policyId !== overlay.policyId ||
    contract.policyDigest !== overlay.policyDigest
  ) {
    block("policy-identity-disagreement", {
      contract: [contract.policyId, contract.policyDigest],
      overlay: [overlay.policyId, overlay.policyDigest],
    });
  }
  if (Number(cwIndex.schemaVersion) !== 2) block("cw-index-not-v2", cwIndex.schemaVersion);
  if (
    !alignmentGeometry ||
    ![1, 2].includes(Number(alignmentGeometry.schemaVersion))
  ) {
    block("alignment-geometry-missing", null);
  }
  if (!manifest.legacyRoutingCompatibility) {
    block("legacy-compatibility-unbundled", null);
  } else {
    const legacy = manifest.legacyRoutingCompatibility;
    if (legacy.cwBaseIndexSha256 !== manifest.hashes?.legacyCwBaseIndex) {
      block("legacy-compatibility-hash-disagreement", legacy);
    }
    if (
      contract.legacyCompatibilityRegistryDigest !== legacy.registryDigest
    ) {
      block("legacy-registry-contract-disagreement", null);
    }
  }

  for (const [key, expected] of Object.entries(manifest.hashes || {})) {
    const relative = {
      bikeRoads: manifest.bikeRoads,
      segments: manifest.segments,
      cwBaseIndex: manifest.cwBaseIndex,
      kml: manifest.kml,
      baseRoutingShards: manifest.baseRoutingShards,
      roundabouts: manifest.roundabouts,
      crossings: manifest.crossings,
      cwAlignmentGeometry: manifest.cwAlignmentGeometry,
      legacyCwBaseIndex: manifest.legacyRoutingCompatibility?.cwBaseIndex,
      legacyRoutingCompatibilityMetadata:
        manifest.legacyRoutingCompatibility?.metadata,
      routeAnchorCompatibility: manifest.routeAnchorCompatibility?.path,
    }[key];
    if (!relative) continue;
    const actual = await digest(relative);
    if (actual !== expected) block("manifest-hash-mismatch", { key, expected, actual });
  }

  const expectedMemberships = new Set();
  const acceptedAlignmentKeys = new Set();
  let unresolvedSlots = 0;
  for (const segment of Object.values(overlay.segments || {})) {
    const indexSegment = cwIndex.segments?.[String(segment.segmentId)];
    if (!isActiveCwOverlaySegment(segment)) {
      if (indexSegment) {
        block("inactive-segment-published-in-index", {
          segmentId: segment.segmentId,
          lifecycleStatus: segment.lifecycleStatus,
        });
      }
      continue;
    }
    let accepted = 0;
    for (const alignmentKey of ["aToB", "bToA"]) {
      const published = segment.alignments?.[alignmentKey]?.published;
      const publicAlignment = indexSegment?.alignments?.[alignmentKey];
      if (!published) {
        unresolvedSlots += 1;
        if (publicAlignment?.disposition !== "needs_review") {
          block("unresolved-slot-published-in-index", { segmentId: segment.segmentId, alignmentKey });
        }
        continue;
      }
      if (published.disposition === "accepted") {
        accepted += 1;
        acceptedAlignmentKeys.add(`${segment.segmentId}:${alignmentKey}`);
        if (publicAlignment?.disposition !== "accepted") {
          block("accepted-alignment-missing-from-index", { segmentId: segment.segmentId, alignmentKey });
          continue;
        }
        for (const value of publicAlignment.edgeRefs || []) {
          const shareId = Number(Array.isArray(value) ? value[0] : value?.shareId);
          const direction =
            Number(Array.isArray(value) ? value[1] : value?.direction) === 1 ||
            (!Array.isArray(value) && value?.direction === "reverse")
              ? "reverse"
              : "forward";
          expectedMemberships.add(
            `${shareId}:${direction}:${segment.segmentId}:${alignmentKey}`,
          );
        }
      } else if (publicAlignment?.disposition !== "unavailable") {
        block("unavailable-alignment-index-disagreement", {
          segmentId: segment.segmentId,
          alignmentKey,
        });
      }
    }
    if (segment.lifecycleStatus === "active" && segment.navigable !== false) {
      if (accepted === 0) block("active-segment-has-no-accepted-alignment", segment.segmentId);
      for (const alignmentKey of ["aToB", "bToA"]) {
        if (!segment.alignments?.[alignmentKey]?.published) {
          block("active-segment-direction-unreviewed", {
            segmentId: segment.segmentId,
            alignmentKey,
          });
        }
      }
    }
  }
  stats.unresolvedSlots = unresolvedSlots;
  stats.acceptedAlignments = acceptedAlignmentKeys.size;

  const geometryKeys = new Set();
  for (const feature of alignmentGeometry?.features || []) {
    const segmentId = feature.properties?.segmentId;
    const alignmentKey = feature.properties?.alignmentKey;
    const declaredKeys = Array.isArray(feature.properties?.alignmentKeys)
      ? feature.properties.alignmentKeys
      : String(feature.properties?.alignmentKeys || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    const alignmentKeys = alignmentKey === "both"
      ? (declaredKeys.length > 0 ? declaredKeys : ["aToB", "bToA"])
      : [alignmentKey];
    for (const key of alignmentKeys) {
      if (segmentId == null || !["aToB", "bToA"].includes(key)) {
        block("alignment-geometry-key-invalid", {
          segmentId,
          alignmentKey,
          alignmentKeys: declaredKeys,
        });
        continue;
      }
      geometryKeys.add(`${segmentId}:${key}`);
    }
  }
  for (const key of acceptedAlignmentKeys) {
    if (!geometryKeys.has(key)) block("accepted-alignment-missing-geometry", key);
  }
  for (const key of geometryKeys) {
    if (!acceptedAlignmentKeys.has(key)) block("orphan-alignment-geometry", key);
  }

  const actualMemberships = new Set();
  let decodedEdges = 0;
  for (const entry of shardManifest.shards || []) {
    const compact = entry.formats?.compact;
    const relative = compact?.path || entry.path;
    const shardPath = path.join(path.dirname(manifest.baseRoutingShards), relative);
    const bytes = await readFile(path.join(root, shardPath));
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (compact?.sha256 && actualDigest !== compact.sha256) {
      block("shard-hash-mismatch", entry.id);
      continue;
    }
    const shard = decodeCompactBaseRoutingShard(bytes);
    if (Number(shard.sourceRoutingSchemaVersion) !== 3) {
      block("mixed-routing-schema", { shard: entry.id, schema: shard.sourceRoutingSchemaVersion });
    }
    for (const edge of shard.edges || []) {
      decodedEdges += 1;
      const traversal = edge.bicycleTraversal || {};
      if (
        traversal.policyId !== contract.policyId ||
        traversal.policyDigest !== contract.policyDigest
      ) {
        block("edge-policy-identity-mismatch", edge.id);
      }
      for (const direction of ["forward", "reverse"]) {
        const memberships = edge.cwAlignments?.[direction] || [];
        if (memberships.length > 0 && traversal[direction] !== "allowed") {
          block("membership-on-nonallowed-traversal", {
            edgeId: edge.id,
            direction,
            state: traversal[direction],
          });
        }
        for (const membership of memberships) {
          actualMemberships.add(
            `${edge.shareId}:${direction}:${membership.segmentId}:${membership.alignmentKey}`,
          );
        }
      }
    }
  }
  stats.decodedShardEdges = decodedEdges;
  for (const key of expectedMemberships) {
    if (!actualMemberships.has(key)) block("index-membership-missing-from-shards", key);
  }
  for (const key of actualMemberships) {
    if (!expectedMemberships.has(key)) block("orphan-runtime-membership", key);
  }
  stats.expectedMemberships = expectedMemberships.size;
  stats.actualMemberships = actualMemberships.size;
}

const report = {
  schemaVersion: 1,
  status: blockers.length === 0 ? "ready" : "blocked",
  root,
  overlay: path.resolve(values.overlay),
  stats,
  blockerCount: blockers.length,
  warningCount: warnings.length,
  blockerCounts: Object.fromEntries(
    [...new Set(blockers.map((item) => item.code))]
      .sort()
      .map((code) => [code, blockers.filter((item) => item.code === code).length]),
  ),
  blockerSamples: blockers.slice(0, 100),
  warnings,
};
console.log(JSON.stringify(report, null, 2));
if (blockers.length > 0 && !values["report-only"]) process.exitCode = 1;
