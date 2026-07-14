#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import { parseCwOverlayV2 } from "../editor/lib/cw-overlay-v2.mjs";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: "public-data" },
    overlay: { type: "string", default: "data/cw-base-overlay.v2.staged.json" },
    registry: { type: "string", default: "data/base-edge-share-ids.json" },
    "registry-proposal": {
      type: "string",
      default: "build/base-edge-share-ids.proposal.json",
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
    return;
  }
  if (!proposal || expected !== proposalDigest) {
    block("share-registry-contract-disagreement", {
      expected,
      registryDigest,
      proposalDigest,
    });
    return;
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
  await validateShareRegistry(contract);
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
  if (!alignmentGeometry || Number(alignmentGeometry.schemaVersion) !== 1) {
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

  const geometryKeys = new Set(
    (alignmentGeometry?.features || []).map(
      (feature) =>
        `${feature.properties?.segmentId}:${feature.properties?.alignmentKey}`,
    ),
  );
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
