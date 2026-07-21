import { canonicalSha256, canonicalStringify } from "../utils/canonicalHash.js";

const FRACTION_SCALE = 1_000_000;

export function quantizeEdgeFraction(value) {
  const fraction = Math.max(0, Math.min(1, Number(value) || 0));
  return Math.round(fraction * FRACTION_SCALE);
}

export function deterministicFingerprint(value) {
  return `sha256-${canonicalSha256(value)}`;
}

export function buildRouteAttestation({
  validationContext,
  traversalSlices,
  waypointOccurrences,
  legBoundaries,
  geometry,
  reverseConstraint = "policy-only",
  derivation = "directed-search",
} = {}) {
  const evidence = {
    schemaVersion: 1,
    validationContext: normalizeValidationContext(validationContext),
    traversalSlices: normalizeTraversalSlices(traversalSlices),
    waypointOccurrences: normalizeWaypointOccurrences(waypointOccurrences),
    legBoundaries: normalizeLegBoundaries(legBoundaries),
    geometry: normalizeGeometry(geometry),
    reverseConstraint: String(reverseConstraint || "policy-only"),
    derivation,
  };
  evidence.contentFingerprint = routeContentFingerprint(evidence);
  evidence.exactReverseAllowed =
    evidence.reverseConstraint !== "curated-opposite-distinct-or-unavailable" &&
    evidence.traversalSlices.every(
      (slice) => slice.oppositePolicyState === "allowed",
    );
  return evidence;
}

export function routeContentFingerprint(attestation) {
  return deterministicFingerprint({
    traversalSlices: normalizeTraversalSlices(attestation?.traversalSlices),
    waypointOccurrences: normalizeWaypointOccurrences(
      attestation?.waypointOccurrences,
    ),
    legBoundaries: normalizeLegBoundaries(attestation?.legBoundaries),
    geometry: normalizeGeometry(attestation?.geometry),
    reverseConstraint: String(attestation?.reverseConstraint || "policy-only"),
  });
}

export function validateRouteAttestation(attestation, options = {}) {
  if (!attestation || Number(attestation.schemaVersion) !== 1) {
    return { ok: false, reason: "missing-route-attestation" };
  }
  const context = normalizeValidationContext(attestation.validationContext);
  if (
    !context.graphVersion ||
    !context.policyId ||
    !context.policyDigest ||
    Number(context.baseRoutingSchemaVersion) < 3
  ) {
    return { ok: false, reason: "invalid-validation-context" };
  }
  const slices = normalizeTraversalSlices(attestation.traversalSlices);
  if (slices.length === 0) {
    return { ok: false, reason: "missing-traversal-evidence" };
  }
  if (
    slices.some(
      (slice) =>
        !Number.isSafeInteger(slice.edgeShareId) ||
        slice.edgeShareId <= 0 ||
        slice.policyState !== "allowed",
    )
  ) {
    return { ok: false, reason: "invalid-traversal-evidence" };
  }
  if (routeContentFingerprint(attestation) !== attestation.contentFingerprint) {
    return { ok: false, reason: "route-content-fingerprint-mismatch" };
  }
  const geometry = normalizeGeometry(attestation.geometry);
  if (geometry.length < 2) {
    return { ok: false, reason: "missing-attested-geometry" };
  }
  if (
    Array.isArray(options.geometry) &&
    canonicalStringify(geometry) !== canonicalStringify(normalizeGeometry(options.geometry))
  ) {
    return { ok: false, reason: "route-geometry-attestation-mismatch" };
  }
  return { ok: true, reason: null };
}

export function reverseRouteAttestation(attestation) {
  const validation = validateRouteAttestation(attestation);
  if (!validation.ok || attestation.exactReverseAllowed !== true) {
    return null;
  }
  return buildRouteAttestation({
    validationContext: attestation.validationContext,
    traversalSlices: [...attestation.traversalSlices].reverse().map((slice) => ({
      ...slice,
      fromFractionQ: slice.toFractionQ,
      toFractionQ: slice.fromFractionQ,
      policyState: slice.oppositePolicyState,
      policyReason: slice.oppositePolicyReason,
      oppositePolicyState: slice.policyState,
      oppositePolicyReason: slice.policyReason,
      cwMembership: slice.oppositeCwMembership || [],
      oppositeCwMembership: slice.cwMembership || [],
    })),
    waypointOccurrences: [...attestation.waypointOccurrences].reverse(),
    legBoundaries: reverseLegBoundaries(
      attestation.legBoundaries,
      attestation.traversalSlices.length,
    ),
    geometry: [...attestation.geometry].reverse(),
    reverseConstraint: attestation.reverseConstraint,
    derivation: "exact-reverse",
  });
}

export function transformRouteAttestation(
  attestation,
  {
    geometry,
    startProgressMeters = 0,
    sourceGeometryTotalMeters = null,
    rotateLoop = false,
    derivation = rotateLoop ? "loop-rotation" : "route-clip",
  } = {},
) {
  const validation = validateRouteAttestation(attestation);
  const transformedGeometry = normalizeGeometry(geometry);
  if (!validation.ok || transformedGeometry.length < 2) return null;
  const slices = normalizeTraversalSlices(attestation.traversalSlices);
  const progress = Math.max(0, Number(startProgressMeters) || 0);
  const totalMeters = Math.max(
    progress,
    Number(sourceGeometryTotalMeters) || geometryDistanceHint(attestation.geometry),
  );
  const totalWeight = slices.reduce(
    (sum, slice) => sum + Math.max(1, slice.distanceMetersQ),
    0,
  );
  const splitWeight = totalMeters > 0
    ? Math.max(0, Math.min(totalWeight, (progress / totalMeters) * totalWeight))
    : 0;
  const { before, after } = splitTraversalSlices(slices, splitWeight);
  const transformedSlices = rotateLoop ? [...after, ...before] : after;
  if (transformedSlices.length === 0) return null;
  const firstSlice = transformedSlices[0];
  const lastSlice = transformedSlices.at(-1);
  const firstCoordinate = transformedGeometry[0];
  const lastCoordinate = transformedGeometry.at(-1);
  return buildRouteAttestation({
    validationContext: attestation.validationContext,
    traversalSlices: transformedSlices,
    waypointOccurrences: [
      occurrenceForTransform(
        attestation.waypointOccurrences?.[0],
        firstCoordinate,
        firstSlice.edgeShareId,
        firstSlice.fromFractionQ,
        "effective-start",
      ),
      occurrenceForTransform(
        attestation.waypointOccurrences?.at(-1),
        lastCoordinate,
        lastSlice.edgeShareId,
        lastSlice.toFractionQ,
        "effective-end",
      ),
    ],
    legBoundaries: [{
      purpose: rotateLoop ? "loop-rotation" : "effective-route",
      fromOccurrence: 0,
      toOccurrence: 1,
      startTraversal: 0,
      endTraversal: transformedSlices.length,
    }],
    geometry: transformedGeometry,
    reverseConstraint: attestation.reverseConstraint,
    derivation: progress <= 0 ? attestation.derivation : derivation,
  });
}

export function navigationPlanFingerprint(navigationRoute) {
  const evidence = validateRouteAttestation(navigationRoute?.routingValidation, {
    geometry: navigationRoute?.geometry,
  });
  if (!evidence.ok) return null;
  return deterministicFingerprint({
    routeContentFingerprint:
      navigationRoute.routingValidation.contentFingerprint,
    geometry: (navigationRoute.geometry || []).map((point) => [
      Number(Number(point?.lat).toFixed(7)),
      Number(Number(point?.lng).toFixed(7)),
    ]),
    junctions: navigationRoute.junctions || null,
    crossings: navigationRoute.crossings || null,
    segmentSpans: navigationRoute.segmentSpans || [],
    maneuverGeneratorVersion:
      navigationRoute.maneuverGeneratorVersion || "navigation-cues-v3",
    cuePlan: navigationRoute.cuePlan || null,
  });
}

function normalizeValidationContext(value) {
  return {
    baseRoutingSchemaVersion: Number(value?.baseRoutingSchemaVersion) || null,
    graphVersion: String(value?.graphVersion || ""),
    policyId: String(value?.policyId || ""),
    policyDigest: String(value?.policyDigest || ""),
    routingContextDigest: String(value?.routingContextDigest || ""),
  };
}

function normalizeTraversalSlices(values) {
  return (Array.isArray(values) ? values : []).map((slice) => ({
    edgeShareId: Number(slice?.edgeShareId),
    fromFractionQ: Number.isInteger(slice?.fromFractionQ)
      ? slice.fromFractionQ
      : quantizeEdgeFraction(slice?.fromFraction),
    toFractionQ: Number.isInteger(slice?.toFractionQ)
      ? slice.toFractionQ
      : quantizeEdgeFraction(slice?.toFraction),
    distanceMetersQ: Number.isInteger(slice?.distanceMetersQ)
      ? Math.max(1, slice.distanceMetersQ)
      : Math.max(1, Math.round((Number(slice?.distanceMeters) || 0) * 1000)),
    policyState: String(slice?.policyState || "unknown"),
    policyReason: String(slice?.policyReason || ""),
    oppositePolicyState: String(slice?.oppositePolicyState || "unknown"),
    oppositePolicyReason: String(slice?.oppositePolicyReason || ""),
    cwMembership: normalizeMembership(slice?.cwMembership),
    oppositeCwMembership: normalizeMembership(slice?.oppositeCwMembership),
    shardIds: [...new Set((slice?.shardIds || []).map(String))].sort(),
  }));
}

function normalizeMembership(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => ({
      segmentId: Number(value?.segmentId),
      alignmentKey: value?.alignmentKey ? String(value.alignmentKey) : null,
      mappingDigest: value?.mappingDigest ? String(value.mappingDigest) : null,
    }))
    .filter((value) => Number.isSafeInteger(value.segmentId) && value.segmentId > 0)
    .sort(
      (first, second) =>
        first.segmentId - second.segmentId ||
        String(first.alignmentKey).localeCompare(String(second.alignmentKey)),
    );
}

function normalizeWaypointOccurrences(values) {
  return (Array.isArray(values) ? values : []).map((value, index) => ({
    // UI point IDs are deliberately random and are not encoded in shared
    // routes. Ordinal identity is sufficient to distinguish repeated waypoint
    // occurrences and keeps the content fingerprint reproducible.
    occurrenceId: `occurrence-${index}`,
    requestedCoordinate: {
      lat: Number(value?.requestedCoordinate?.lat ?? value?.lat),
      lng: Number(value?.requestedCoordinate?.lng ?? value?.lng),
    },
    selectedAnchor: value?.selectedAnchor
      ? {
          edgeShareId: Number(value.selectedAnchor.edgeShareId),
          edgeFractionQ: Number.isInteger(value.selectedAnchor.edgeFractionQ)
            ? value.selectedAnchor.edgeFractionQ
            : quantizeEdgeFraction(value.selectedAnchor.edgeFraction),
        }
      : {
          edgeShareId: Number(value?.baseEdgeShareId),
          edgeFractionQ: quantizeEdgeFraction(value?.baseEdgeFraction),
        },
  }));
}

function normalizeLegBoundaries(values) {
  return (Array.isArray(values) ? values : []).map((value, index) => ({
    index,
    purpose: String(value?.purpose || "ordinary"),
    fromOccurrence: Number(value?.fromOccurrence ?? index),
    toOccurrence: Number(value?.toOccurrence ?? index + 1),
    startTraversal: Number(value?.startTraversal ?? 0),
    endTraversal: Number(value?.endTraversal ?? 0),
  }));
}

function normalizeGeometry(values) {
  return (Array.isArray(values) ? values : [])
    .map((point) => {
      const lat = Number(point?.lat ?? point?.[1]);
      const lng = Number(point?.lng ?? point?.[0]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7)),
      };
    })
    .filter(Boolean);
}

function splitTraversalSlices(slices, splitWeight) {
  const before = [];
  const after = [];
  let cursor = 0;
  for (const slice of slices) {
    const weight = Math.max(1, Number(slice.distanceMetersQ) || 1);
    const end = cursor + weight;
    if (splitWeight <= cursor) {
      after.push({ ...slice });
    } else if (splitWeight >= end) {
      before.push({ ...slice });
    } else {
      const beforeRatio = (splitWeight - cursor) / weight;
      const splitFractionQ = Math.round(
        slice.fromFractionQ +
          (slice.toFractionQ - slice.fromFractionQ) * beforeRatio,
      );
      const beforeWeight = Math.max(1, Math.round(weight * beforeRatio));
      const afterWeight = Math.max(1, weight - beforeWeight);
      before.push({
        ...slice,
        toFractionQ: splitFractionQ,
        distanceMetersQ: beforeWeight,
      });
      after.push({
        ...slice,
        fromFractionQ: splitFractionQ,
        distanceMetersQ: afterWeight,
      });
    }
    cursor = end;
  }
  return { before, after };
}

function occurrenceForTransform(
  source,
  coordinate,
  edgeShareId,
  edgeFractionQ,
  fallbackId,
) {
  return {
    occurrenceId: String(source?.occurrenceId || fallbackId),
    requestedCoordinate: coordinate,
    selectedAnchor: { edgeShareId, edgeFractionQ },
  };
}

function geometryDistanceHint(geometry) {
  const values = Array.isArray(geometry) ? geometry : [];
  return values.length >= 2 ? values.length - 1 : 0;
}

function reverseLegBoundaries(values, traversalCount) {
  return [...normalizeLegBoundaries(values)].reverse().map((value, index) => ({
    ...value,
    index,
    fromOccurrence: index,
    toOccurrence: index + 1,
    startTraversal: traversalCount - value.endTraversal,
    endTraversal: traversalCount - value.startTraversal,
  }));
}
