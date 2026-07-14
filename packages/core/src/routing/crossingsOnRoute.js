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

function validMapping(mapping) {
  if (!mapping?.id || !validCoordinate(mapping.entry) || !validCoordinate(mapping.exit)) return false;
  return ["before", "action", "after"].every((section) =>
    Array.isArray(mapping?.match?.[section])
    && mapping.match[section].length > 0
    && mapping.match[section].every(validExpectedSlice));
}

function validArtifactCrossings(crossings) {
  const logicalIds = new Set();
  const mappingIds = new Set();
  for (const crossing of crossings) {
    if (!crossing?.id || crossing.kind !== "side-change" || logicalIds.has(crossing.id)
      || !Array.isArray(crossing.mappings) || !crossing.mappings.length) return false;
    logicalIds.add(crossing.id);
    for (const mapping of crossing.mappings) {
      if (!validMapping(mapping) || mappingIds.has(mapping.id)) return false;
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

function containsDirectedSlice(routeSlice, expected, minimumPositionQ = null) {
  if (Number(routeSlice?.edgeShareId) !== Number(expected?.edgeShareId)) return false;
  const routeDirection = direction(routeSlice);
  if (!routeDirection || routeDirection !== direction(expected)) return false;
  const routeStart = Number(routeSlice.fromFractionQ);
  const routeEnd = Number(routeSlice.toFractionQ);
  const expectedStart = Number(expected.fromFractionQ);
  const expectedEnd = Number(expected.toFractionQ);
  if (routeDirection > 0) {
    return expectedStart >= routeStart - FRACTION_TOLERANCE_Q
      && expectedEnd <= routeEnd + FRACTION_TOLERANCE_Q
      && (minimumPositionQ === null || expectedStart >= minimumPositionQ - FRACTION_TOLERANCE_Q);
  }
  return expectedStart <= routeStart + FRACTION_TOLERANCE_Q
    && expectedEnd >= routeEnd - FRACTION_TOLERANCE_Q
    && (minimumPositionQ === null || expectedStart <= minimumPositionQ + FRACTION_TOLERANCE_Q);
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

function findCompleteMapping(mapping, routeSlices, progress, fromRouteIndex = 0) {
  const expected = [
    ...(mapping?.match?.before || []).map((slice) => ({ section: "before", slice })),
    ...(mapping?.match?.action || []).map((slice) => ({ section: "action", slice })),
    ...(mapping?.match?.after || []).map((slice) => ({ section: "after", slice })),
  ];
  if (!expected.length || !mapping?.match?.before?.length || !mapping?.match?.action?.length || !mapping?.match?.after?.length) {
    return null;
  }
  let routeIndex = fromRouteIndex;
  let minimumPositionQ = null;
  let actionStartQ = null;
  let actionEndQ = null;
  let firstRouteIndex = null;
  for (const token of expected) {
    let found = false;
    while (routeIndex < routeSlices.length) {
      const routeSlice = routeSlices[routeIndex];
      if (containsDirectedSlice(routeSlice, token.slice, minimumPositionQ)) {
        if (firstRouteIndex === null) firstRouteIndex = routeIndex;
        if (token.section === "action" && actionStartQ === null) {
          actionStartQ = progressInsideSlice(routeSlice, progress[routeIndex], token.slice.fromFractionQ);
        }
        if (token.section === "action") {
          actionEndQ = progressInsideSlice(routeSlice, progress[routeIndex], token.slice.toFractionQ);
        }
        minimumPositionQ = Number(token.slice.toFractionQ);
        found = true;
        break;
      }
      routeIndex += 1;
      minimumPositionQ = null;
    }
    if (!found) return null;
  }
  return {
    firstRouteIndex,
    lastRouteIndex: routeIndex,
    actionStartQ,
    actionEndQ,
  };
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
    crossedRoadName: crossing.crossedRoad?.name || null,
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
    for (const mapping of crossing.mappings || []) {
      let searchFrom = 0;
      while (searchFrom < routeSlices.length) {
        const match = findCompleteMapping(mapping, routeSlices, progress, searchFrom);
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
