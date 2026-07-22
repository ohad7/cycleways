import { getDistance } from "../utils/distance.js";
import { pointAndBearingAtDistance, precomputeArcLength } from "../utils/geometry.js";
import { validateRouteAttestation } from "./routeAttestation.js";

const FRACTION_TOLERANCE_Q = 2;
const MAX_ANCHOR_DISTANCE_METERS = 35;

function validCoordinate(value) {
  return Number.isFinite(Number(value?.lat))
    && Number.isFinite(Number(value?.lng))
    && Number(value.lat) >= -90 && Number(value.lat) <= 90
    && Number(value.lng) >= -180 && Number(value.lng) <= 180;
}

function validExpectedSlice(value) {
  return Number.isSafeInteger(value?.edgeShareId) && value.edgeShareId > 0
    && Number.isInteger(value?.fromFractionQ)
    && Number.isInteger(value?.toFractionQ)
    && value.fromFractionQ >= 0 && value.fromFractionQ <= 1_000_000
    && value.toFractionQ >= 0 && value.toFractionQ <= 1_000_000
    && value.fromFractionQ !== value.toFractionQ;
}

function validMapping(mapping, representation = "action-path") {
  if (!mapping?.id || !validCoordinate(mapping.entry) || !validCoordinate(mapping.exit)) return false;
  const sectionsValid = ["before", "action", "after"].every((section) => {
    const slices = mapping?.match?.[section];
    const allowEmpty = (representation === "junction-transition" && section === "action")
      || (representation === "edge-path" && section !== "action");
    if (allowEmpty) return Array.isArray(slices) && slices.length === 0;
    return Array.isArray(slices)
      && slices.length > 0
      && slices.every(validExpectedSlice);
  });
  if (!sectionsValid) return false;
  if (representation === "edge-path") {
    return mapping.match.before.length === 0 && mapping.match.after.length === 0;
  }
  if (representation !== "junction-transition") return true;
  return Math.abs(Number(mapping.entry.lat) - Number(mapping.exit.lat)) <= 0.000001
    && Math.abs(Number(mapping.entry.lng) - Number(mapping.exit.lng)) <= 0.000001
    && mapping.continuation?.type === "turn"
    && (mapping.continuation?.direction === "left" || mapping.continuation?.direction === "right");
}

function validArtifactCrossings(crossings) {
  const logicalIds = new Set();
  const mappingIds = new Set();
  for (const crossing of crossings) {
    const representation = crossing?.representation || "action-path";
    const guidancePolicy = crossing?.guidancePolicy || "always";
    if (!crossing?.id || crossing.kind !== "side-change" || logicalIds.has(crossing.id)
      || !new Set(["action-path", "junction-transition", "edge-path"]).has(representation)
      || !new Set(["always", "user-option"]).has(guidancePolicy)
      || (guidancePolicy === "user-option"
        && !new Set(["junction-transition", "edge-path"]).has(representation))
      || !Array.isArray(crossing.mappings) || !crossing.mappings.length) return false;
    logicalIds.add(crossing.id);
    for (const mapping of crossing.mappings) {
      if (!validMapping(mapping, representation) || mappingIds.has(mapping.id)) return false;
      mappingIds.add(mapping.id);
    }
  }
  return true;
}

function direction(value) {
  const delta = Number(value?.toFractionQ) - Number(value?.fromFractionQ);
  return delta > 0 ? 1 : delta < 0 ? -1 : 0;
}

function normalizeRouteGeometry(geometry) {
  return (Array.isArray(geometry) ? geometry : [])
    .map((point) => ({ lat: Number(point?.lat), lng: Number(point?.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function compatibleArtifact(artifact, attestation) {
  if (!artifact || Number(artifact.schemaVersion) !== 1 || !Array.isArray(artifact.crossings)) {
    return { ok: false, reason: "missing-crossing-artifact" };
  }
  if (!validArtifactCrossings(artifact.crossings)) {
    return { ok: false, reason: "invalid-crossing-artifact" };
  }
  const context = attestation.validationContext || {};
  if (artifact.graphVersion && artifact.graphVersion !== context.graphVersion) {
    return { ok: false, reason: "crossing-graph-version-mismatch" };
  }
  if (artifact.traversalPolicyDigest && artifact.traversalPolicyDigest !== context.policyDigest) {
    return { ok: false, reason: "crossing-policy-digest-mismatch" };
  }
  return { ok: true, reason: null };
}

function containsDirectedPosition(routeSlice, expected, positionQ) {
  if (Number(routeSlice?.edgeShareId) !== Number(expected?.edgeShareId)) return false;
  const routeDirection = direction(routeSlice);
  if (!routeDirection || routeDirection !== direction(expected)) return false;
  const routeStart = Number(routeSlice.fromFractionQ);
  const routeEnd = Number(routeSlice.toFractionQ);
  if (routeDirection > 0) {
    return positionQ >= routeStart - FRACTION_TOLERANCE_Q
      && positionQ <= routeEnd + FRACTION_TOLERANCE_Q;
  }
  return positionQ <= routeStart + FRACTION_TOLERANCE_Q
    && positionQ >= routeEnd - FRACTION_TOLERANCE_Q;
}

function followsMinimum(positionQ, routeDirection, minimumPositionQ) {
  if (minimumPositionQ === null) return true;
  return routeDirection > 0
    ? positionQ >= minimumPositionQ - FRACTION_TOLERANCE_Q
    : positionQ <= minimumPositionQ + FRACTION_TOLERANCE_Q;
}

function sliceProgressMeters(routeSlices) {
  let totalQ = 0;
  return routeSlices.map((slice) => {
    const distanceQ = Math.max(1, Number(slice.distanceMetersQ) || 1);
    const record = { startQ: totalQ, endQ: totalQ + distanceQ, distanceQ };
    totalQ += distanceQ;
    return record;
  });
}

function progressInsideSlice(routeSlice, progress, fractionQ) {
  const span = Math.abs(Number(routeSlice.toFractionQ) - Number(routeSlice.fromFractionQ));
  if (span <= 0) return progress.startQ;
  const traversed = Math.abs(Number(fractionQ) - Number(routeSlice.fromFractionQ));
  return progress.startQ + Math.max(0, Math.min(1, traversed / span)) * progress.distanceQ;
}

function coverExpectedSlice(
  expected,
  routeSlices,
  progress,
  { fromRouteIndex, minimumPositionQ = null, scan = false },
) {
  const expectedDirection = direction(expected);
  const expectedStart = Number(expected.fromFractionQ);
  const expectedEnd = Number(expected.toFractionQ);
  const lastCandidateIndex = scan
    ? routeSlices.length - 1
    : Math.min(routeSlices.length - 1, fromRouteIndex + 1);

  for (let candidateIndex = fromRouteIndex; candidateIndex <= lastCandidateIndex; candidateIndex += 1) {
    const routeSlice = routeSlices[candidateIndex];
    const candidateMinimum = candidateIndex === fromRouteIndex ? minimumPositionQ : null;
    if (!containsDirectedPosition(routeSlice, expected, expectedStart)
      || !followsMinimum(expectedStart, expectedDirection, candidateMinimum)) continue;

    const startProgressQ = progressInsideSlice(
      routeSlice,
      progress[candidateIndex],
      expectedStart,
    );
    let endIndex = candidateIndex;
    while (endIndex < routeSlices.length) {
      const current = routeSlices[endIndex];
      if (containsDirectedPosition(current, expected, expectedEnd)) {
        return {
          firstRouteIndex: candidateIndex,
          lastRouteIndex: endIndex,
          startProgressQ,
          endProgressQ: progressInsideSlice(current, progress[endIndex], expectedEnd),
        };
      }
      const currentEnd = Number(current?.toFractionQ);
      const notYetCovered = expectedDirection > 0
        ? currentEnd < expectedEnd - FRACTION_TOLERANCE_Q
        : currentEnd > expectedEnd + FRACTION_TOLERANCE_Q;
      const next = routeSlices[endIndex + 1];
      if (!notYetCovered
        || Number(next?.edgeShareId) !== Number(expected.edgeShareId)
        || direction(next) !== expectedDirection
        || Math.abs(Number(next?.fromFractionQ) - currentEnd) > FRACTION_TOLERANCE_Q) break;
      endIndex += 1;
    }
  }
  return null;
}

function attemptCompleteMapping(expected, routeSlices, progress, fromRouteIndex) {
  let routeIndex = fromRouteIndex;
  let minimumPositionQ = null;
  let actionStartQ = null;
  let actionEndQ = null;
  let beforeEndQ = null;
  let afterStartQ = null;
  let firstRouteIndex = null;
  for (let tokenIndex = 0; tokenIndex < expected.length; tokenIndex += 1) {
    const token = expected[tokenIndex];
    const coverage = coverExpectedSlice(token.slice, routeSlices, progress, {
      fromRouteIndex: routeIndex,
      minimumPositionQ,
      scan: tokenIndex === 0,
    });
    if (!coverage) return { match: null, firstRouteIndex };
    if (firstRouteIndex === null) firstRouteIndex = coverage.firstRouteIndex;
    routeIndex = coverage.lastRouteIndex;
    if (token.section === "action" && actionStartQ === null) {
      actionStartQ = coverage.startProgressQ;
    }
    if (token.section === "action") actionEndQ = coverage.endProgressQ;
    if (token.section === "before") beforeEndQ = coverage.endProgressQ;
    if (token.section === "after" && afterStartQ === null) {
      afterStartQ = coverage.startProgressQ;
    }
    minimumPositionQ = Number(token.slice.toFractionQ);
  }
  if (actionStartQ === null && beforeEndQ !== null && afterStartQ !== null) {
    const boundaryQ = (beforeEndQ + afterStartQ) / 2;
    actionStartQ = boundaryQ;
    actionEndQ = boundaryQ;
  }
  return {
    match: {
      firstRouteIndex,
      lastRouteIndex: routeIndex,
      actionStartQ,
      actionEndQ,
    },
    firstRouteIndex,
  };
}

function findCompleteMapping(mapping, routeSlices, progress, fromRouteIndex = 0, representation = "action-path") {
  const expected = [
    ...(mapping?.match?.before || []).map((slice) => ({ section: "before", slice })),
    ...(mapping?.match?.action || []).map((slice) => ({ section: "action", slice })),
    ...(mapping?.match?.after || []).map((slice) => ({ section: "after", slice })),
  ];
  const actionRequired = representation !== "junction-transition";
  const contextRequired = representation !== "edge-path";
  if (!expected.length
    || (contextRequired && !mapping?.match?.before?.length)
    || (actionRequired && !mapping?.match?.action?.length)
    || (contextRequired && !mapping?.match?.after?.length)) {
    return null;
  }
  let searchFrom = fromRouteIndex;
  while (searchFrom < routeSlices.length) {
    const attempt = attemptCompleteMapping(expected, routeSlices, progress, searchFrom);
    if (attempt.match) return attempt.match;
    if (!Number.isInteger(attempt.firstRouteIndex)) return null;
    searchFrom = Math.max(searchFrom + 1, attempt.firstRouteIndex + 1);
  }
  return null;
}

function crossingRecord(crossing, mapping, match, attestedTotalQ, geometry, arc) {
  const geometryTotalMeters = arc.totalDistMeters;
  const scale = attestedTotalQ > 0 ? geometryTotalMeters / attestedTotalQ : 0;
  const entryMeters = match.actionStartQ * scale;
  const exitMeters = match.actionEndQ * scale;
  const entryPoint = pointAndBearingAtDistance(arc, geometry, entryMeters).point;
  const exitPoint = pointAndBearingAtDistance(arc, geometry, exitMeters).point;
  if (getDistance(entryPoint, mapping.entry) > MAX_ANCHOR_DISTANCE_METERS
    || getDistance(exitPoint, mapping.exit) > MAX_ANCHOR_DISTANCE_METERS) return null;
  return {
    kind: "crossing",
    crossingId: crossing.id,
    mappingId: mapping.id,
    crossingKind: crossing.kind,
    crossingRepresentation: crossing.representation || "action-path",
    guidancePolicy: crossing.guidancePolicy || "always",
    crossedRoadName: crossing.crossedRoad?.name || null,
    continuation: mapping.continuation
      ? { type: mapping.continuation.type, direction: mapping.continuation.direction }
      : null,
    entryMeters,
    exitMeters,
    complete: true,
  };
}

function dedupeMatches(matches) {
  const ordered = [...matches].sort((a, b) =>
    a.entryMeters - b.entryMeters
    || a.exitMeters - b.exitMeters
    || a.crossingId.localeCompare(b.crossingId)
    || a.mappingId.localeCompare(b.mappingId));
  const result = [];
  for (const match of ordered) {
    const duplicate = result.find((value) =>
      value.crossingId === match.crossingId
      && Math.abs(value.entryMeters - match.entryMeters) < 0.1
      && Math.abs(value.exitMeters - match.exitMeters) < 0.1);
    if (!duplicate) result.push(match);
  }
  return result;
}

/**
 * Match editor-confirmed directed crossing signatures to an attested route.
 * `null` means the evidence was unavailable/incompatible; `[]` means it was
 * compatible and no confirmed crossing was traversed.
 */
export function crossingsOnRoute(artifact, routeAttestation, routeGeometry) {
  const validation = validateRouteAttestation(routeAttestation, { geometry: routeGeometry });
  if (!validation.ok) return null;
  if (!compatibleArtifact(artifact, routeAttestation).ok) return null;
  const routeSlices = routeAttestation.traversalSlices || [];
  const progress = sliceProgressMeters(routeSlices);
  const attestedTotalQ = progress.at(-1)?.endQ || 0;
  const geometry = normalizeRouteGeometry(routeGeometry);
  const arc = geometry.length >= 2 ? precomputeArcLength(geometry) : null;
  const geometryTotalMeters = arc?.totalDistMeters || 0;
  if (attestedTotalQ <= 0 || geometryTotalMeters <= 0) return null;
  const matches = [];
  for (const crossing of artifact.crossings) {
    if (!crossing?.id || crossing.kind !== "side-change") continue;
    const representation = crossing.representation || "action-path";
    for (const mapping of crossing.mappings || []) {
      let searchFrom = 0;
      while (searchFrom < routeSlices.length) {
        const match = findCompleteMapping(mapping, routeSlices, progress, searchFrom, representation);
        if (!match) break;
        const record = crossingRecord(crossing, mapping, match, attestedTotalQ, geometry, arc);
        if (record) matches.push(record);
        searchFrom = Math.max(searchFrom + 1, match.firstRouteIndex + 1);
      }
    }
  }
  return dedupeMatches(matches);
}

export function crossingArtifactCompatibility(artifact, routeAttestation, routeGeometry) {
  const validation = validateRouteAttestation(routeAttestation, { geometry: routeGeometry });
  if (!validation.ok) return validation;
  return compatibleArtifact(artifact, routeAttestation);
}
