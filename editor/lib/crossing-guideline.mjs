import { createHash } from "node:crypto";

export const CROSSING_FRACTION_SCALE = 1_000_000;

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function finiteCoordinate(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180 && Number(value[0]) <= 180
    && Number(value[1]) >= -90 && Number(value[1]) <= 90;
}

export function normalizeCrossingGuideline(value) {
  const coordinates = value?.type === "LineString" ? value.coordinates : value;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(finiteCoordinate)) {
    throw new Error("Draw a crossing guideline with at least two valid coordinates");
  }
  const normalized = coordinates.map((coord) => [Number(coord[0]), Number(coord[1])]);
  if (normalized.every((coord) => coord[0] === normalized[0][0] && coord[1] === normalized[0][1])) {
    throw new Error("The crossing guideline must have non-zero length");
  }
  return { type: "LineString", coordinates: normalized };
}

export function crossingMatcherFeature(guideline, id = 1) {
  const normalized = normalizeCrossingGuideline(guideline);
  return {
    type: "Feature",
    properties: {
      id: Number.isInteger(id) ? id : 1,
      name: "Crossing guideline",
      status: "active",
      roadType: "paved",
    },
    geometry: normalized,
  };
}

function distanceMeters(left, right) {
  const lat = ((Number(left[1]) + Number(right[1])) / 2) * Math.PI / 180;
  const x = (Number(right[0]) - Number(left[0])) * Math.cos(lat) * 111_320;
  const y = (Number(right[1]) - Number(left[1])) * 110_540;
  return Math.hypot(x, y);
}

function projectPointToLine(point, coordinates) {
  const lengths = [];
  let totalMeters = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const length = distanceMeters(coordinates[index], coordinates[index + 1]);
    lengths.push(length);
    totalMeters += length;
  }
  if (totalMeters <= 0) return null;
  const referenceLat = Number(point[1]) * Math.PI / 180;
  const scaleX = Math.cos(referenceLat) * 111_320;
  const scaleY = 110_540;
  let alongBefore = 0;
  let best = null;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const ax = (Number(start[0]) - Number(point[0])) * scaleX;
    const ay = (Number(start[1]) - Number(point[1])) * scaleY;
    const bx = (Number(end[0]) - Number(point[0])) * scaleX;
    const by = (Number(end[1]) - Number(point[1])) * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const t = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const distance = Math.hypot(px, py);
    const candidate = {
      coordinate: [
        Number(start[0]) + (Number(end[0]) - Number(start[0])) * t,
        Number(start[1]) + (Number(end[1]) - Number(start[1])) * t,
      ],
      distanceMeters: distance,
      fraction: (alongBefore + lengths[index] * t) / totalMeters,
    };
    if (!best || candidate.distanceMeters < best.distanceMeters) best = candidate;
    alongBefore += lengths[index];
  }
  return best;
}

function coordinateAtFraction(coordinates, fraction) {
  const target = Math.max(0, Math.min(1, fraction));
  const lengths = [];
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const length = distanceMeters(coordinates[index], coordinates[index + 1]);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) return coordinates[0].slice(0, 2);
  const targetMeters = total * target;
  let before = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (before + lengths[index] >= targetMeters || index === lengths.length - 1) {
      const t = lengths[index] > 0 ? (targetMeters - before) / lengths[index] : 0;
      return [
        coordinates[index][0] + (coordinates[index + 1][0] - coordinates[index][0]) * t,
        coordinates[index][1] + (coordinates[index + 1][1] - coordinates[index][1]) * t,
      ];
    }
    before += lengths[index];
  }
  return coordinates.at(-1).slice(0, 2);
}

function slicedCoordinates(coordinates, fromQ, toQ) {
  const from = fromQ / CROSSING_FRACTION_SCALE;
  const to = toQ / CROSSING_FRACTION_SCALE;
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const lengths = [];
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const length = distanceMeters(coordinates[index], coordinates[index + 1]);
    lengths.push(length);
    total += length;
  }
  const result = [coordinateAtFraction(coordinates, low)];
  let before = 0;
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    before += lengths[index - 1];
    const fraction = total > 0 ? before / total : 0;
    if (fraction > low && fraction < high) result.push(coordinates[index].slice(0, 2));
  }
  result.push(coordinateAtFraction(coordinates, high));
  return fromQ <= toQ ? result : result.reverse();
}

function matchedRefs(preview) {
  const bySequence = new Map();
  for (const feature of preview?.features || []) {
    if (feature?.properties?.kind !== "matchedEdge") continue;
    const sequenceIndex = Number(feature.properties.sequenceIndex);
    const edgeId = String(feature.properties.edgeId || "");
    if (!Number.isInteger(sequenceIndex) || !edgeId || bySequence.has(sequenceIndex)) continue;
    bySequence.set(sequenceIndex, {
      edgeId,
      direction: feature.properties.direction === "reverse" ? "reverse" : "forward",
      sequenceIndex,
    });
  }
  return [...bySequence.values()].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
}

function point(value) {
  return { lat: Number(value[1]), lng: Number(value[0]) };
}

function compactId(value) {
  return digest(value).slice(7, 23);
}

function reverseAllowed(refs, edgeById) {
  return refs.every((ref) => {
    const policy = edgeById.get(ref.edgeId)?.bicycleTraversalShadow || {};
    const opposite = ref.direction === "reverse" ? "forward" : "reverse";
    return policy[opposite] === "allowed";
  });
}

function traceForSlices(slices, edgeByShareId) {
  const trace = [];
  for (const slice of slices) {
    const edge = edgeByShareId.get(Number(slice.edgeShareId));
    const coordinates = slicedCoordinates(edge.coordinates, slice.fromFractionQ, slice.toFractionQ);
    trace.push(...(trace.length ? coordinates.slice(1) : coordinates));
  }
  return trace;
}

export function buildCrossingFromGuideline({
  id,
  guideline,
  match,
  graph,
  shareRegistry,
  crossedRoadName = "",
  guidancePolicy = "always",
  includeReverse = true,
  existingAudit = null,
}) {
  const normalizedGuideline = normalizeCrossingGuideline(guideline);
  const summary = match?.summary || {};
  const refs = matchedRefs(match?.preview);
  if (!refs.length) throw new Error("The guideline did not match any base edges");
  if (Number(summary.continuityGapCount || 0) > 0 || Number(summary.gapCount || 0) > 0) {
    throw new Error("The guideline match is disconnected; adjust its coordinates and try again");
  }
  const edgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id), edge]));
  const shareIds = shareRegistry?.edges || {};
  const missing = refs.filter((ref) => !edgeById.has(ref.edgeId) || !Number.isInteger(shareIds[ref.edgeId]));
  if (missing.length) throw new Error(`Matched base-edge evidence is unavailable: ${missing.map((ref) => ref.edgeId).join(", ")}`);

  const firstEdge = edgeById.get(refs[0].edgeId);
  const lastEdge = edgeById.get(refs.at(-1).edgeId);
  const startProjection = projectPointToLine(normalizedGuideline.coordinates[0], firstEdge.coordinates);
  const endProjection = projectPointToLine(normalizedGuideline.coordinates.at(-1), lastEdge.coordinates);
  if (!startProjection || !endProjection) throw new Error("Could not project the guideline onto its matched path");
  const maximumProjectionDistance = Math.max(startProjection.distanceMeters, endProjection.distanceMeters);
  if (maximumProjectionDistance > 15) {
    throw new Error(`A guideline endpoint is ${Math.round(maximumProjectionDistance)} m from the matched base path`);
  }

  const startQ = Math.round(startProjection.fraction * CROSSING_FRACTION_SCALE);
  const endQ = Math.round(endProjection.fraction * CROSSING_FRACTION_SCALE);
  const action = refs.map((ref, index) => {
    const forward = ref.direction !== "reverse";
    let fromFractionQ = forward ? 0 : CROSSING_FRACTION_SCALE;
    let toFractionQ = forward ? CROSSING_FRACTION_SCALE : 0;
    if (index === 0) fromFractionQ = startQ;
    if (index === refs.length - 1) toFractionQ = endQ;
    return { edgeShareId: shareIds[ref.edgeId], fromFractionQ, toFractionQ };
  });
  if (action.some((slice) => slice.fromFractionQ === slice.toFractionQ)) {
    throw new Error("The guideline produces an empty fractional base-edge slice");
  }
  if ((refs[0].direction === "forward") !== (action[0].toFractionQ > action[0].fromFractionQ)
    || (refs.at(-1).direction === "forward") !== (action.at(-1).toFractionQ > action.at(-1).fromFractionQ)) {
    throw new Error("The guideline endpoints run opposite to the matched base-edge direction");
  }

  const edgeByShareId = new Map(
    Object.entries(shareIds).map(([edgeId, shareId]) => [Number(shareId), edgeById.get(edgeId)]),
  );
  const forwardTrace = traceForSlices(action, edgeByShareId);
  const sourceEdgeFingerprint = digest({
    guideline: normalizedGuideline.coordinates,
    slices: action,
    edges: refs.map((ref) => ({
      edgeId: ref.edgeId,
      direction: ref.direction,
      sourceGeometryDigest: edgeById.get(ref.edgeId)?.sourceGeometryDigest || null,
    })),
    policyDigest: graph?.metadata?.bicycleTraversalShadowPolicyDigest || null,
  });
  const identity = compactId({ guideline: normalizedGuideline.coordinates, action });
  const crossingId = String(id || `manual-crossing-${identity}`);
  if (!crossingId.startsWith("manual-crossing-")) throw new Error("Crossing id must start with manual-crossing-");
  const mapping = (mappingId, direction, slices, trace) => ({
    id: mappingId,
    direction,
    match: { before: [], action: slices, after: [] },
    entry: point(trace[0]),
    exit: point(trace.at(-1)),
    geometry: trace.map(point),
    policy: {
      state: "allowed",
      policyDigest: graph?.metadata?.bicycleTraversalShadowPolicyDigest || null,
    },
    sourceEdgeFingerprint,
  });
  const mappings = [mapping(`mapping-${identity}-forward`, "forward", action, forwardTrace)];
  const canReverse = reverseAllowed(refs, edgeById);
  if (includeReverse && canReverse) {
    const reverseSlices = [...action].reverse().map((slice) => ({
      edgeShareId: slice.edgeShareId,
      fromFractionQ: slice.toFractionQ,
      toFractionQ: slice.fromFractionQ,
    }));
    mappings.push(mapping(`mapping-${identity}-reverse`, "reverse", reverseSlices, [...forwardTrace].reverse()));
  }
  const now = new Date().toISOString();
  const allLng = forwardTrace.map((coord) => coord[0]);
  const allLat = forwardTrace.map((coord) => coord[1]);
  const midpoint = forwardTrace[Math.floor(forwardTrace.length / 2)];
  return {
    crossing: {
      id: crossingId,
      kind: "side-change",
      representation: "edge-path",
      guidancePolicy: guidancePolicy === "user-option" ? "user-option" : "always",
      guideline: normalizedGuideline,
      center: point(midpoint),
      bbox: [Math.min(...allLng), Math.min(...allLat), Math.max(...allLng), Math.max(...allLat)],
      crossedRoad: {
        source: "curated",
        sourceIds: [],
        name: String(crossedRoadName || "").trim() || null,
        highway: "road",
      },
      sourceEdgeFingerprint,
      audit: {
        createdAt: existingAudit?.createdAt || now,
        updatedAt: now,
      },
      warnings: Number(summary.coverageRatio || 0) < 0.92 ? ["guideline-match-needs-visual-confirmation"] : [],
      mappings,
    },
    match: {
      summary,
      edgeRefs: refs,
      maximumProjectionDistanceMeters: Number(maximumProjectionDistance.toFixed(1)),
      reverseAvailable: canReverse,
    },
  };
}
