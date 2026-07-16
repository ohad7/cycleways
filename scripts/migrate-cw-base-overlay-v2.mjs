#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  ALIGNMENT_KEYS,
  alignmentEvidenceDigest,
  alignmentMappingDigest,
  digestCwOverlayValue,
  parseCwOverlayV2,
  serializeCwOverlayV2,
} from "../editor/lib/cw-overlay-v2.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function orderedRefs(mapping) {
  return [...(mapping?.edgeRefs || [])]
    .sort((left, right) => Number(left.sequenceIndex ?? 0) - Number(right.sequenceIndex ?? 0))
    .map((ref, sequenceIndex) => ({
      ...ref,
      edgeId: String(ref.edgeId || ""),
      direction: ref.direction === "reverse" ? "reverse" : "forward",
      sequenceIndex,
      fromFraction: Number(ref.fromFraction ?? 0),
      toFraction: Number(ref.toFraction ?? 1),
    }));
}

function haversineMeters(a, b) {
  const radius = 6_371_000;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pointAtFraction(coordinates, fraction) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const targetFraction = Math.max(0, Math.min(1, Number(fraction)));
  const lengths = coordinates.slice(1).map((coordinate, index) =>
    haversineMeters(coordinates[index], coordinate),
  );
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return coordinates[0].slice(0, 2);
  const target = total * targetFraction;
  let before = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (before + lengths[index] >= target || index === lengths.length - 1) {
      const t = lengths[index] <= 0 ? 0 : (target - before) / lengths[index];
      return [
        coordinates[index][0] + (coordinates[index + 1][0] - coordinates[index][0]) * t,
        coordinates[index][1] + (coordinates[index + 1][1] - coordinates[index][1]) * t,
      ];
    }
    before += lengths[index];
  }
  return coordinates.at(-1).slice(0, 2);
}

function orientedRefEndpoints(edge, ref) {
  if (!edge) return null;
  const from = pointAtFraction(edge.coordinates, ref.fromFraction);
  const to = pointAtFraction(edge.coordinates, ref.toFraction);
  if (!from || !to) return null;
  return ref.direction === "reverse" ? { start: to, end: from } : { start: from, end: to };
}

function opposite(direction) {
  return direction === "reverse" ? "forward" : "reverse";
}

function reverseRealization(refs) {
  return {
    type: "explicit",
    edgeRefs: [...refs].reverse().map((ref, sequenceIndex) => ({
      ...ref,
      direction: opposite(ref.direction),
      sequenceIndex,
      fromFraction: ref.fromFraction,
      toFraction: ref.toFraction,
    })),
  };
}

function nonAllowedLookup(policyAudit) {
  const lookup = new Map();
  for (const queueName of ["restricted", "conditional", "unknown"]) {
    for (const item of policyAudit?.queues?.[queueName] || []) {
      lookup.set(`${item.edgeId}|${item.direction}`, {
        state: item.state,
        reason: item.reason,
      });
    }
  }
  return lookup;
}

function validateRefs(refs, graphById, policyLookup) {
  const reasons = [];
  const traversalStates = {};
  let previous = null;
  for (const [index, ref] of refs.entries()) {
    const edge = graphById.get(ref.edgeId);
    if (!edge) {
      reasons.push({ code: "missing_edge", edgeId: ref.edgeId, index });
      traversalStates[`${index}:${ref.edgeId}`] = "unknown";
      previous = null;
      continue;
    }
    const policy = policyLookup.get(`${ref.edgeId}|${ref.direction}`);
    traversalStates[`${index}:${ref.edgeId}`] = policy?.state || "allowed";
    if (policy) {
      reasons.push({
        code: "non_allowed_traversal",
        edgeId: ref.edgeId,
        direction: ref.direction,
        state: policy.state,
        reason: policy.reason,
      });
    }
    const endpoints = orientedRefEndpoints(edge, ref);
    if (!endpoints) {
      reasons.push({ code: "invalid_edge_geometry", edgeId: ref.edgeId, index });
      previous = null;
      continue;
    }
    if (previous) {
      const gapMeters = haversineMeters(previous.end, endpoints.start);
      if (gapMeters > 12) {
        reasons.push({
          code: "continuity_gap",
          fromEdgeId: previous.edgeId,
          toEdgeId: ref.edgeId,
          gapMeters: Math.round(gapMeters * 100) / 100,
        });
      }
    }
    previous = { ...endpoints, edgeId: ref.edgeId };
  }
  const first = refs.length ? orientedRefEndpoints(graphById.get(refs[0].edgeId), refs[0]) : null;
  const last = refs.length
    ? orientedRefEndpoints(graphById.get(refs.at(-1).edgeId), refs.at(-1))
    : null;
  return {
    status: reasons.length === 0 ? "valid" : "invalid",
    reasons,
    traversalStates,
    terminals: first && last ? { start: first.start, end: last.end } : null,
  };
}

function needsOnlyManualDirectionEvidence(validation) {
  const reasons = validation?.reasons || [];
  return (
    reasons.length > 0 &&
    reasons.every(
      (reason) =>
        reason?.code === "non_allowed_traversal" &&
        reason?.state === "unknown" &&
        reason?.reason === "manual-unreviewed",
    )
  );
}

function sourceFeatureById(mapSource) {
  return new Map(
    (mapSource.features || [])
      .filter((feature) => Number.isInteger(Number(feature?.properties?.id)))
      .map((feature) => [Number(feature.properties.id), feature]),
  );
}

function endpointMatch(validation, a, b, zoneMeters) {
  if (!validation.terminals) return { alignmentKey: null, reason: "missing_terminals" };
  const startA = haversineMeters(validation.terminals.start, a);
  const endB = haversineMeters(validation.terminals.end, b);
  const startB = haversineMeters(validation.terminals.start, b);
  const endA = haversineMeters(validation.terminals.end, a);
  const aToB = startA <= zoneMeters && endB <= zoneMeters;
  const bToA = startB <= zoneMeters && endA <= zoneMeters;
  if (aToB === bToA) {
    return {
      alignmentKey: null,
      reason: aToB ? "ambiguous_both_endpoint_orientations" : "outside_endpoint_zones",
      distances: { startA, endB, startB, endA },
    };
  }
  return {
    alignmentKey: aToB ? "aToB" : "bToA",
    reason: "matched",
    distances: { startA, endB, startB, endA },
  };
}

export function buildMigrationProposal({
  overlayV1,
  authoringOverlayV1 = overlayV1,
  publicIndexV1,
  mapSource,
  graph,
  policyAudit,
  graphDigest,
  endpointZoneMeters = 30,
}) {
  const sourceById = sourceFeatureById(mapSource);
  const legacyActiveIds = new Set(Object.keys(publicIndexV1.segments || {}).map(Number));
  const activeIds = new Set([
    ...legacyActiveIds,
    ...[...sourceById.entries()]
      .filter(([, feature]) => String(feature.properties?.status || "active") === "active")
      .map(([segmentId]) => segmentId),
  ]);
  const graphById = new Map((graph.edges || []).map((edge) => [String(edge.id), edge]));
  const policyLookup = nonAllowedLookup(policyAudit);
  const segments = {};
  const classifications = {};
  const queue = [];
  const ownership = new Map();
  const candidateOwnership = new Map();
  const automaticAuthoringCandidates = [];

  const addCandidateOwnership = (segmentId, alignmentKey, refs) => {
    for (const ref of refs) {
      const key = `${ref.edgeId}|${ref.direction}|${ref.fromFraction}|${ref.toFraction}`;
      const owners = candidateOwnership.get(key) || [];
      owners.push({ segmentId, alignmentKey });
      candidateOwnership.set(key, owners);
    }
  };

  for (const segmentId of [...activeIds].sort((a, b) => a - b)) {
    const isLegacySegment = legacyActiveIds.has(segmentId);
    const mapping = isLegacySegment
      ? overlayV1.segments?.[String(segmentId)]
      : authoringOverlayV1.segments?.[String(segmentId)];
    const source = sourceById.get(segmentId);
    if (!mapping || !source || source.geometry?.type !== "LineString") {
      queue.push({ segmentId, code: !mapping ? "missing_v1_mapping" : "missing_logical_source" });
      continue;
    }
    const sourceCoordinates = source.geometry.coordinates.map((coordinate) => coordinate.slice(0, 2));
    const a = sourceCoordinates[0];
    const b = sourceCoordinates.at(-1);
    const sourceGeometryDigest = digestCwOverlayValue(sourceCoordinates);
    const refs = orderedRefs(mapping);
    const existingValidation = validateRefs(refs, graphById, policyLookup);
    const endpoint = endpointMatch(existingValidation, a, b, endpointZoneMeters);
    if (!endpoint.alignmentKey) {
      existingValidation.status = "invalid";
      existingValidation.reasons.push({ code: endpoint.reason, distances: endpoint.distances });
    }

    const existingKey = endpoint.alignmentKey || "aToB";
    const oppositeKey = existingKey === "aToB" ? "bToA" : "aToB";
    const existingRealization = { type: "explicit", edgeRefs: refs };
    const existingDigest = alignmentMappingDigest(segmentId, existingKey, existingRealization);
    const reversed = reverseRealization(refs);
    const reverseValidation = validateRefs(reversed.edgeRefs, graphById, policyLookup);
    const classification =
      existingValidation.status !== "valid"
        ? endpoint.alignmentKey
          ? needsOnlyManualDirectionEvidence(existingValidation)
            ? "direction_evidence_needed"
            : "invalid_existing"
          : "unresolved"
        : reverseValidation.status === "valid"
          ? "symmetric_candidate"
          : "single_direction_candidate";
    classifications[classification] = (classifications[classification] || 0) + 1;

    const segment = {
      segmentId,
      segmentName: String(source.properties?.name || mapping.segmentName || segmentId),
      lifecycleStatus: String(source.properties?.status || "active"),
      navigable: true,
      sourceGeometryDigest,
      endpoints: {
        a: { coordinate: a, zoneMeters: endpointZoneMeters, labels: { key: "A" } },
        b: { coordinate: b, zoneMeters: endpointZoneMeters, labels: { key: "B" } },
      },
      migration: {
        classification,
        sourceSchemaVersion: 1,
        sourceMappingOrigin: isLegacySegment ? "frozen-v1" : "authoring-v1",
        sourceMappingStatus: mapping.status,
        endpointMatch: endpoint,
      },
      alignments: {
        aToB: { published: null, draft: null },
        bToA: { published: null, draft: null },
      },
    };
    segment.alignments[existingKey].draft = {
      disposition: "needs_review",
      realization: existingRealization,
      mappingDigest: existingDigest,
      candidate: { kind: isLegacySegment ? "v1-existing" : "new-authoring", classification },
      validation: existingValidation,
    };

    if (reverseValidation.status === "valid") {
      segment.alignments[oppositeKey].draft = {
        disposition: "needs_review",
        candidate: {
          kind: "exact-reverse",
          classification,
          reverseOfAlignmentKey: existingKey,
          referencedMappingDigest: existingDigest,
        },
        validation: reverseValidation,
      };
    } else {
      segment.alignments[oppositeKey].draft = {
        disposition: "needs_review",
        candidate: { kind: "opposite-alignment-required", classification },
        validation: reverseValidation,
      };
    }

    addCandidateOwnership(segmentId, existingKey, refs);
    if (reverseValidation.status === "valid") {
      addCandidateOwnership(segmentId, oppositeKey, reversed.edgeRefs);
    }
    if (
      !isLegacySegment &&
      mapping.status === "accepted_edge_set" &&
      mapping.source === "edge_pick" &&
      classification === "symmetric_candidate" &&
      typeof mapping.updatedAt === "string" &&
      mapping.updatedAt.length >= 10
    ) {
      automaticAuthoringCandidates.push({
        segmentId,
        existingKey,
        oppositeKey,
        refs,
        reversedRefs: reversed.edgeRefs,
        mapping,
      });
    }

    for (const ref of refs) {
      const key = `${ref.edgeId}|${ref.direction}|${ref.fromFraction}|${ref.toFraction}`;
      const owners = ownership.get(key) || [];
      owners.push({ segmentId, alignmentKey: existingKey });
      ownership.set(key, owners);
    }
    segments[String(segmentId)] = segment;
  }

  for (const [directedKey, owners] of ownership) {
    if (owners.length > 1) queue.push({ code: "directed_ownership_conflict", directedKey, owners });
  }

  let automaticallyPublishedAuthoringSegments = 0;
  for (const candidate of automaticAuthoringCandidates) {
    const candidateKeys = [...candidate.refs, ...candidate.reversedRefs].map(
      (ref) => `${ref.edgeId}|${ref.direction}|${ref.fromFraction}|${ref.toFraction}`,
    );
    const conflicts = candidateKeys.flatMap((directedKey) =>
      (candidateOwnership.get(directedKey) || [])
        .filter((owner) => owner.segmentId !== candidate.segmentId)
        .map((owner) => ({ directedKey, owner })),
    );
    if (conflicts.length > 0) {
      queue.push({
        segmentId: candidate.segmentId,
        code: "automatic_authoring_ownership_conflict",
        conflicts,
      });
      continue;
    }
    const segment = segments[String(candidate.segmentId)];
    const reviewedAt = candidate.mapping.updatedAt.slice(0, 10);
    const batchId = `automatic-bidirectional-authoring-${candidate.segmentId}`;
    const explicitRealization = { type: "explicit", edgeRefs: candidate.refs };
    const explicitDigest = alignmentMappingDigest(
      candidate.segmentId,
      candidate.existingKey,
      explicitRealization,
    );
    segment.alignments[candidate.existingKey] = {
      published: {
        disposition: "accepted",
        realization: explicitRealization,
        mappingDigest: explicitDigest,
        review: {
          reviewer: "editor-authored",
          reviewedAt,
          batchId,
          rationale: "Explicitly authored mapping with a mechanically validated exact reverse",
          acceptanceBasis: "automatic-bidirectional-authoring",
          automated: true,
          graphDigest,
          policyDigest: policyAudit.policyDigest,
          sourceGeometryDigest: segment.sourceGeometryDigest,
          mappingDigest: explicitDigest,
          evidenceDigest: alignmentEvidenceDigest(
            candidate.refs,
            graphById,
            policyAudit.policyDigest,
          ),
        },
      },
      draft: null,
    };
    const reverseRealization = {
      type: "reverseOf",
      alignmentKey: candidate.existingKey,
      referencedMappingDigest: explicitDigest,
    };
    const reverseDigest = alignmentMappingDigest(
      candidate.segmentId,
      candidate.oppositeKey,
      reverseRealization,
    );
    segment.alignments[candidate.oppositeKey] = {
      published: {
        disposition: "accepted",
        realization: reverseRealization,
        mappingDigest: reverseDigest,
        review: {
          reviewer: "editor-authored",
          reviewedAt,
          batchId,
          rationale: "Mechanically validated exact reverse of an explicitly authored mapping",
          acceptanceBasis: "automatic-bidirectional-authoring",
          automated: true,
          graphDigest,
          policyDigest: policyAudit.policyDigest,
          sourceGeometryDigest: segment.sourceGeometryDigest,
          mappingDigest: reverseDigest,
          evidenceDigest: alignmentEvidenceDigest(
            candidate.reversedRefs,
            graphById,
            policyAudit.policyDigest,
          ),
        },
      },
      draft: null,
    };
    segment.migration.automaticPublication = "bidirectional-authoring";
    automaticallyPublishedAuthoringSegments += 1;
  }

  const overlay = {
    schemaVersion: 2,
    policyId: policyAudit.policy.policyId,
    policyDigest: policyAudit.policyDigest,
    graphDigest,
    proposal: {
      source: "cw-base-overlay-v1",
      sourceOverlayDigest: digestCwOverlayValue(overlayV1),
      authoringOverlayDigest: digestCwOverlayValue(authoringOverlayV1),
      sourceIndexDigest: digestCwOverlayValue(publicIndexV1),
      nonAuthoritative: true,
    },
    segments,
  };
  parseCwOverlayV2(overlay);
  const report = {
    schemaVersion: 1,
    graphDigest,
    policyDigest: policyAudit.policyDigest,
    activeV1Mappings: legacyActiveIds.size,
    activeAuthoringSegments: activeIds.size,
    newAuthoringSegments: activeIds.size - legacyActiveIds.size,
    automaticallyPublishedAuthoringSegments,
    proposedSegments: Object.keys(segments).length,
    archivedV1Mappings: Object.keys(overlayV1.segments || {}).length - legacyActiveIds.size,
    classifications: Object.fromEntries(Object.entries(classifications).sort()),
    queue,
  };
  report.reportDigest = digestCwOverlayValue(report);
  return { overlay, report };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function main() {
  const paths = {
    overlay: argument("--overlay-v1", "data/routing-compat/cw-base-overlay-v1.json"),
    authoringOverlay: argument("--authoring-overlay-v1", "data/cw-base-overlay.json"),
    index: argument("--index-v1", "data/routing-compat/cw-base-index-v1.json"),
    source: argument("--map-source", "data/map-source.geojson"),
    graph: argument("--graph", "build/osm/osm-base-graph-elevated.json"),
    policy: argument("--policy-audit", "build/bicycle-traversal-policy-audit.json"),
    output: argument("--output", "build/cw-base-overlay-v2.proposal.json"),
    report: argument("--report", "build/cw-base-overlay-v2.migration-report.json"),
  };
  const graphBytes = readFileSync(paths.graph);
  const result = buildMigrationProposal({
    overlayV1: JSON.parse(readFileSync(paths.overlay, "utf8")),
    authoringOverlayV1: JSON.parse(readFileSync(paths.authoringOverlay, "utf8")),
    publicIndexV1: JSON.parse(readFileSync(paths.index, "utf8")),
    mapSource: JSON.parse(readFileSync(paths.source, "utf8")),
    graph: JSON.parse(graphBytes),
    policyAudit: JSON.parse(readFileSync(paths.policy, "utf8")),
    graphDigest: sha256(graphBytes),
  });
  const overlayContent = serializeCwOverlayV2(result.overlay);
  const reportContent = `${JSON.stringify(result.report, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (
      readFileSync(paths.output, "utf8") !== overlayContent ||
      readFileSync(paths.report, "utf8") !== reportContent
    ) {
      throw new Error("CW Overlay V2 migration proposal is stale");
    }
  } else {
    writeFileSync(paths.output, overlayContent);
    writeFileSync(paths.report, reportContent);
  }
  console.log(
    `CW Overlay V2 proposal: ${result.report.proposedSegments} segments, ` +
      `${result.report.queue.length} queue items`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
