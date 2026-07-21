import { createHash } from "node:crypto";

const REVIEW_STATES = new Set(["selected", "unavailable"]);

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function edgeWayId(edge) {
  const value = Number(edge?.tags?.osmId ?? edge?.osmWayId);
  return Number.isFinite(value) ? value : null;
}

function edgeLength(edge) {
  return Math.max(0.01, Number(edge?.distanceMeters) || 0.01);
}

function haversineMeters(a, b) {
  const radius = 6_371_000;
  const toRadians = (value) => Number(value) * Math.PI / 180;
  const dLat = toRadians(Number(b?.[1]) - Number(a?.[1]));
  const dLng = toRadians(Number(b?.[0]) - Number(a?.[0]));
  const lat1 = toRadians(a?.[1]);
  const lat2 = toRadians(b?.[1]);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function traversalState(edge, direction) {
  return edge?.bicycleTraversalShadow?.[direction] || "unknown";
}

function directionAllowed(edge, direction, acceptedCwDirections) {
  const state = traversalState(edge, direction);
  if (state === "allowed") return true;
  const reason = edge?.bicycleTraversalShadow?.[`${direction}Reason`];
  return (
    acceptedCwDirections.has(`${edge.id}|${direction}`) &&
    state === "prohibited" &&
    reason === "explicit-access-prohibited"
  );
}

function directedRef(edge, direction, sequenceIndex = 0) {
  return {
    edgeId: String(edge.id),
    direction,
    sequenceIndex,
    fromFraction: 0,
    toFraction: 1,
  };
}

function orderedRefs(mapping) {
  return [...(mapping?.realization?.edgeRefs || [])].sort(
    (left, right) => Number(left.sequenceIndex || 0) - Number(right.sequenceIndex || 0),
  );
}

function acceptedCwDirectionSet(overlay) {
  const result = new Set();
  for (const segment of Object.values(overlay?.segments || {})) {
    for (const alignment of Object.values(segment?.alignments || {})) {
      const mapping = alignment?.published || alignment?.draft;
      if (!mapping?.validation?.ok && mapping?.validation?.status !== "valid") continue;
      for (const ref of orderedRefs(mapping)) result.add(`${ref.edgeId}|${ref.direction}`);
    }
  }
  return result;
}

function shortestPath(startNodeId, endNodeId, internalEdges, acceptedCwDirections) {
  if (!startNodeId || !endNodeId || startNodeId === endNodeId) return null;
  const adjacency = new Map();
  const add = (from, step) => adjacency.set(from, [...(adjacency.get(from) || []), step]);
  for (const edge of internalEdges) {
    if (!edge?.fromNodeId || !edge?.toNodeId) continue;
    if (directionAllowed(edge, "forward", acceptedCwDirections)) {
      add(edge.fromNodeId, {
        nodeId: edge.toNodeId,
        distanceMeters: edgeLength(edge),
        ref: directedRef(edge, "forward"),
      });
    }
    if (directionAllowed(edge, "reverse", acceptedCwDirections)) {
      add(edge.toNodeId, {
        nodeId: edge.fromNodeId,
        distanceMeters: edgeLength(edge),
        ref: directedRef(edge, "reverse"),
      });
    }
  }
  for (const steps of adjacency.values()) {
    steps.sort((a, b) =>
      a.distanceMeters - b.distanceMeters ||
      a.ref.edgeId.localeCompare(b.ref.edgeId) ||
      a.ref.direction.localeCompare(b.ref.direction),
    );
  }
  const distances = new Map([[startNodeId, 0]]);
  const previous = new Map();
  const pending = new Set([startNodeId]);
  while (pending.size) {
    let nodeId = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of pending) {
      const candidateDistance = distances.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (
        candidateDistance < distance ||
        (candidateDistance === distance && String(candidate).localeCompare(String(nodeId)) < 0)
      ) {
        nodeId = candidate;
        distance = candidateDistance;
      }
    }
    pending.delete(nodeId);
    if (nodeId === endNodeId) break;
    for (const step of adjacency.get(nodeId) || []) {
      const next = distance + step.distanceMeters;
      if (next >= (distances.get(step.nodeId) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(step.nodeId, next);
      previous.set(step.nodeId, { nodeId, step });
      pending.add(step.nodeId);
    }
  }
  if (!previous.has(endNodeId)) return null;
  const refs = [];
  let nodeId = endNodeId;
  while (nodeId !== startNodeId) {
    const item = previous.get(nodeId);
    if (!item || refs.length > 128) return null;
    refs.push(item.step.ref);
    nodeId = item.nodeId;
  }
  refs.reverse();
  return {
    edgeRefs: refs.map((ref, sequenceIndex) => ({ ...ref, sequenceIndex })),
    distanceMeters: Math.round((distances.get(endNodeId) || 0) * 10) / 10,
  };
}

function buildPorts(junctionId, ringNodes, ringEdgeIds, internalEdges, acceptedCwDirections) {
  const ports = [];
  for (const edge of internalEdges) {
    if (ringEdgeIds.has(edge.id)) continue;
    const fromRing = ringNodes.has(edge.fromNodeId);
    const toRing = ringNodes.has(edge.toNodeId);
    if (fromRing === toRing) continue;
    const externalNodeId = fromRing ? edge.toNodeId : edge.fromNodeId;
    const ringNodeId = fromRing ? edge.fromNodeId : edge.toNodeId;
    const intoDirection = fromRing ? "reverse" : "forward";
    const outDirection = fromRing ? "forward" : "reverse";
    const coordinate = fromRing ? edge.coordinates?.at(-1) : edge.coordinates?.[0];
    const base = {
      junctionId,
      armId: String(externalNodeId),
      edgeId: edge.id,
      externalNodeId,
      ringNodeId,
      coordinate: coordinate?.slice(0, 2) || null,
    };
    if (directionAllowed(edge, intoDirection, acceptedCwDirections)) {
      ports.push({ ...base, id: `${edge.id}:${intoDirection}:entry`, usage: "entry", direction: intoDirection });
    }
    if (directionAllowed(edge, outDirection, acceptedCwDirections)) {
      ports.push({ ...base, id: `${edge.id}:${outDirection}:exit`, usage: "exit", direction: outDirection });
    }
  }
  return ports.sort((a, b) => a.id.localeCompare(b.id));
}

function findPort(ports, ref, usage) {
  return ports.find(
    (port) => port.edgeId === ref?.edgeId && port.direction === ref?.direction && port.usage === usage,
  ) || null;
}

function segmentAssociations(overlay, internalEdgeIds, ports) {
  const attachments = [];
  const throughAlignments = [];
  const segmentIds = new Set();
  for (const segment of Object.values(overlay?.segments || {})) {
    for (const [alignmentKey, alignment] of Object.entries(segment?.alignments || {})) {
      const mapping = alignment?.published || alignment?.draft;
      const refs = orderedRefs(mapping);
      const internalIndices = refs
        .map((ref, index) => internalEdgeIds.has(ref.edgeId) ? index : -1)
        .filter((index) => index >= 0);
      const hasInvalidInternalReason = (mapping?.validation?.reasons || []).some((reason) =>
        internalEdgeIds.has(reason.edgeId),
      );
      if (!internalIndices.length && !hasInvalidInternalReason) continue;
      segmentIds.add(Number(segment.segmentId));
      const entryIndex = internalIndices[0];
      const exitIndex = internalIndices.at(-1);
      const entryPort = findPort(ports, refs[entryIndex], "entry");
      const exitPort = findPort(ports, refs[exitIndex], "exit");
      if (entryPort) {
        attachments.push({
          segmentId: Number(segment.segmentId),
          segmentName: segment.segmentName,
          alignmentKey,
          endpoint: entryIndex === 0 ? (alignmentKey === "aToB" ? "a" : "b") : null,
          usage: "arrive",
          portId: entryPort.id,
        });
      }
      if (exitPort) {
        attachments.push({
          segmentId: Number(segment.segmentId),
          segmentName: segment.segmentName,
          alignmentKey,
          endpoint: exitIndex === refs.length - 1 ? (alignmentKey === "aToB" ? "b" : "a") : null,
          usage: "depart",
          portId: exitPort.id,
        });
      }
      if (internalIndices.length) {
        throughAlignments.push({
          segmentId: Number(segment.segmentId),
          segmentName: segment.segmentName,
          alignmentKey,
          entryPortId: entryPort?.id || null,
          exitPortId: exitPort?.id || null,
          internalEdgeIds: internalIndices.map((index) => refs[index].edgeId),
          validationStatus: mapping?.validation?.status || (mapping?.validation?.ok ? "valid" : "unknown"),
        });
      }
    }
  }
  return {
    segmentIds: [...segmentIds].sort((a, b) => a - b),
    attachments,
    throughAlignments,
  };
}

function nearbySegmentEndpoints(overlay, center, maxDistanceMeters = 65) {
  const centerCoordinate = [Number(center?.lng), Number(center?.lat)];
  if (!centerCoordinate.every(Number.isFinite)) return [];
  const endpoints = [];
  for (const segment of Object.values(overlay?.segments || {})) {
    if (segment?.navigable === false || segment?.lifecycleStatus === "deprecated") continue;
    for (const [endpoint, record] of Object.entries(segment?.endpoints || {})) {
      if (!Array.isArray(record?.coordinate)) continue;
      const distanceMeters = haversineMeters(centerCoordinate, record.coordinate);
      if (distanceMeters > maxDistanceMeters) continue;
      endpoints.push({
        segmentId: Number(segment.segmentId),
        segmentName: segment.segmentName,
        endpoint,
        coordinate: record.coordinate.slice(0, 2),
        distanceMeters: Math.round(distanceMeters * 10) / 10,
      });
    }
  }
  return endpoints.sort((a, b) => a.distanceMeters - b.distanceMeters || a.segmentId - b.segmentId);
}

function movementCoverage(ports, internalEdges, acceptedCwDirections) {
  const movements = [];
  const entries = ports.filter((port) => port.usage === "entry");
  const exits = ports.filter((port) => port.usage === "exit");
  for (const entry of entries) {
    for (const exit of exits) {
      if (entry.armId === exit.armId) continue;
      const path = shortestPath(entry.externalNodeId, exit.externalNodeId, internalEdges, acceptedCwDirections);
      movements.push({
        id: `${entry.id}->${exit.id}`,
        entryPortId: entry.id,
        exitPortId: exit.id,
        status: path ? "unique" : "unavailable",
        ...(path || { edgeRefs: [], distanceMeters: null }),
      });
    }
  }
  return movements;
}

export function deriveNetworkJunctionCandidates({
  graph = {},
  roundaboutCandidates = {},
  roundaboutReviews = {},
  overlay = {},
} = {}) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const acceptedCwDirections = acceptedCwDirectionSet(overlay);
  const acceptedRoundaboutIds = new Set(
    Object.entries(roundaboutReviews?.reviews || {})
      .filter(([, review]) => review?.status === "accepted")
      .map(([id]) => id),
  );
  const junctions = [];
  for (const roundabout of roundaboutCandidates?.roundabouts || []) {
    if (!acceptedRoundaboutIds.has(roundabout.id)) continue;
    const wayIds = new Set((roundabout.memberWayIds || []).map(Number));
    const ringEdges = edges.filter((edge) => wayIds.has(edgeWayId(edge)) && edge?.tags?.junction === "roundabout");
    if (!ringEdges.length) continue;
    const ringEdgeIds = new Set(ringEdges.map((edge) => edge.id));
    const ringNodes = new Set(ringEdges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]).filter(Boolean));
    const internalEdges = edges.filter((edge) =>
      ringEdgeIds.has(edge.id) || ringNodes.has(edge.fromNodeId) || ringNodes.has(edge.toNodeId),
    );
    const internalEdgeIds = new Set(internalEdges.map((edge) => edge.id));
    const id = `junction-${roundabout.id}`;
    const ports = buildPorts(id, ringNodes, ringEdgeIds, internalEdges, acceptedCwDirections);
    const associations = segmentAssociations(overlay, internalEdgeIds, ports);
    const nearbyEndpoints = nearbySegmentEndpoints(overlay, roundabout.center);
    const segmentIds = [...new Set([
      ...associations.segmentIds,
      ...nearbyEndpoints.map((endpoint) => endpoint.segmentId),
    ])].sort((a, b) => a - b);
    if (!segmentIds.length) continue;
    const movements = movementCoverage(ports, internalEdges, acceptedCwDirections);
    const fingerprintBasis = {
      id,
      roundaboutFingerprint: roundabout.fingerprint,
      edges: internalEdges.map((edge) => ({
        id: edge.id,
        from: edge.fromNodeId,
        to: edge.toNodeId,
        forward: traversalState(edge, "forward"),
        reverse: traversalState(edge, "reverse"),
      })),
      attachments: associations.attachments,
      nearbyEndpoints,
      movements: movements.map((movement) => ({
        id: movement.id,
        status: movement.status,
        edgeRefs: movement.edgeRefs.map(({ edgeId, direction }) => ({ edgeId, direction })),
      })),
    };
    junctions.push({
      id,
      kind: "derived_roundabout",
      roundaboutId: roundabout.id,
      classification: roundabout.classification,
      center: roundabout.center,
      boundary: roundabout.bbox,
      ringEdgeIds: [...ringEdgeIds].sort(),
      internalEdgeIds: [...internalEdgeIds].sort(),
      ports,
      ...associations,
      segmentIds,
      nearbyEndpoints,
      movements,
      fingerprint: digest(fingerprintBasis),
      summary: {
        ports: ports.length,
        movements: movements.length,
        legalMovements: movements.filter((movement) => movement.status !== "unavailable").length,
        unavailableMovements: movements.filter((movement) => movement.status === "unavailable").length,
      },
    });
  }
  junctions.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    junctions,
    summary: {
      relevantJunctions: junctions.length,
      ports: junctions.reduce((sum, junction) => sum + junction.ports.length, 0),
      movements: junctions.reduce((sum, junction) => sum + junction.movements.length, 0),
      unavailableMovements: junctions.reduce((sum, junction) => sum + junction.summary.unavailableMovements, 0),
    },
  };
}

export function joinNetworkJunctionReviews(candidatesPayload = {}, reviewData = {}) {
  const reviews = reviewData?.reviews && typeof reviewData.reviews === "object"
    ? reviewData.reviews
    : {};
  const items = [];
  const blockingIssues = [];
  const seen = new Set();
  for (const candidate of candidatesPayload?.junctions || []) {
    seen.add(candidate.id);
    const movementReviews = reviews[candidate.id]?.movements || {};
    const movements = candidate.movements.map((movement) => {
      const review = movementReviews[movement.id];
      if (!review) return { ...movement, reviewState: "automatic" };
      if (!REVIEW_STATES.has(review.status)) {
        blockingIssues.push({ code: "invalid_movement_review", junctionId: candidate.id, movementId: movement.id });
        return { ...movement, reviewState: "invalid" };
      }
      if (review.junctionFingerprint !== candidate.fingerprint) {
        blockingIssues.push({ code: "stale_movement_review", junctionId: candidate.id, movementId: movement.id });
        return { ...movement, reviewState: "stale", review };
      }
      return {
        ...movement,
        reviewState: "current",
        review,
        ...(review.status === "unavailable" ? { status: "unavailable", edgeRefs: [], distanceMeters: null } : {}),
      };
    });
    const issues = movements.filter((movement) =>
      movement.status === "ambiguous" ||
      (movement.status === "unavailable" && movement.reviewState === "automatic") ||
      movement.reviewState === "stale" ||
      movement.reviewState === "invalid",
    );
    items.push({ candidate: { ...candidate, movements }, review: reviews[candidate.id] || null, issues });
  }
  const orphaned = Object.keys(reviews).filter((id) => !seen.has(id)).sort();
  return {
    schemaVersion: 1,
    items,
    orphaned,
    blockingIssues,
    summary: {
      total: items.length,
      movementIssues: items.reduce((sum, item) => sum + item.issues.length, 0),
      unavailableMovements: items.reduce(
        (sum, item) => sum + item.candidate.movements.filter((movement) => movement.status === "unavailable").length,
        0,
      ),
      orphaned: orphaned.length,
    },
  };
}

export function networkJunctionGeoJson(joined, graph = {}) {
  const edgeById = new Map((graph?.edges || []).map((edge) => [edge.id, edge]));
  const internalEdges = [];
  const ports = [];
  const movements = [];
  const arrows = [];
  for (const item of joined?.items || []) {
    const junction = item.candidate;
    for (const edgeId of junction.internalEdgeIds) {
      const edge = edgeById.get(edgeId);
      if (!edge?.coordinates?.length) continue;
      internalEdges.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: edge.coordinates.map((coord) => coord.slice(0, 2)) },
        properties: {
          junctionId: junction.id,
          edgeId,
          ring: junction.ringEdgeIds.includes(edgeId),
          forward: traversalState(edge, "forward"),
          reverse: traversalState(edge, "reverse"),
        },
      });
      const forwardAllowed = traversalState(edge, "forward") === "allowed";
      const reverseAllowed = traversalState(edge, "reverse") === "allowed";
      if (forwardAllowed !== reverseAllowed) {
        arrows.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: (reverseAllowed ? [...edge.coordinates].reverse() : edge.coordinates)
              .map((coord) => coord.slice(0, 2)),
          },
          properties: { junctionId: junction.id, edgeId, direction: reverseAllowed ? "reverse" : "forward" },
        });
      }
    }
    for (const port of junction.ports) {
      if (!port.coordinate) continue;
      ports.push({ type: "Feature", geometry: { type: "Point", coordinates: port.coordinate }, properties: { ...port } });
    }
    for (const movement of junction.movements) {
      const coordinates = [];
      for (const ref of movement.edgeRefs || []) {
        const edge = edgeById.get(ref.edgeId);
        let edgeCoordinates = edge?.coordinates?.map((coord) => coord.slice(0, 2)) || [];
        if (ref.direction === "reverse") edgeCoordinates = edgeCoordinates.reverse();
        coordinates.push(...edgeCoordinates.slice(coordinates.length ? 1 : 0));
      }
      if (coordinates.length >= 2) {
        movements.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: { junctionId: junction.id, movementId: movement.id, status: movement.status },
        });
      }
    }
  }
  return {
    internalEdges: { type: "FeatureCollection", features: internalEdges },
    ports: { type: "FeatureCollection", features: ports },
    movements: { type: "FeatureCollection", features: movements },
    arrows: { type: "FeatureCollection", features: arrows },
  };
}
