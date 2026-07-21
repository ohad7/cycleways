import { createHash } from "node:crypto";
import {
  materializeAcceptedAlignment,
  normalizeAlignmentEdgeRefs,
} from "./cw-overlay-v2.mjs";

const REVIEW_STATES = new Set(["selected", "unavailable"]);
const PUBLICATION_STATES = new Set(["detected", "published", "excluded"]);
const NAVIGATION_KINDS = new Set(["roundabout", "intersection", "crossing", "plaza"]);

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
  return edge?.bicycleTraversalShadow?.[direction] || edge?.bicycleTraversal?.[direction] || "unknown";
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

function alignmentRefs(segment, alignmentKey) {
  const accepted = materializeAcceptedAlignment(segment, alignmentKey);
  if (accepted?.length) return accepted;
  const slot = segment?.alignments?.[alignmentKey];
  const record = slot?.draft || slot?.published;
  if (
    record?.realization?.type === "explicit" ||
    Array.isArray(record?.realization?.edgeRefs)
  ) {
    return normalizeAlignmentEdgeRefs(record.realization.edgeRefs);
  }
  if (record?.realization?.type === "reverseOf") {
    const targetSlot = segment?.alignments?.[record.realization.alignmentKey];
    const target = targetSlot?.published || targetSlot?.draft;
    if (target?.realization?.type === "explicit") {
      return normalizeAlignmentEdgeRefs(target.realization.edgeRefs)
        .reverse()
        .map((ref, sequenceIndex) => ({
          ...ref,
          direction: ref.direction === "reverse" ? "forward" : "reverse",
          sequenceIndex,
        }));
    }
  }
  return [];
}

function activeNavigableSegment(segment) {
  return Boolean(
    segment &&
    segment.navigable !== false &&
    !["deprecated", "legacy", "draft"].includes(String(segment.lifecycleStatus || "active")),
  );
}

function acceptedCwDirectionSet(overlay) {
  const result = new Set();
  for (const segment of Object.values(overlay?.segments || {})) {
    if (!activeNavigableSegment(segment)) continue;
    for (const alignmentKey of ["aToB", "bToA"]) {
      const slot = segment?.alignments?.[alignmentKey];
      const mapping = slot?.published || slot?.draft;
      if (!mapping) continue;
      if (
        mapping === slot?.draft &&
        !mapping?.validation?.ok &&
        mapping?.validation?.status !== "valid"
      ) continue;
      for (const ref of alignmentRefs(segment, alignmentKey)) {
        result.add(`${ref.edgeId}|${ref.direction}`);
      }
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

function customBoundaryPorts(
  junctionId,
  internalEdges,
  allEdges,
  acceptedCwDirections,
  excludedPortIds = [],
) {
  const internalEdgeIds = new Set(internalEdges.map((edge) => String(edge.id)));
  const excluded = new Set((excludedPortIds || []).map(String));
  const externalNodes = new Set();
  for (const edge of allEdges) {
    if (internalEdgeIds.has(String(edge?.id))) continue;
    if (edge?.fromNodeId) externalNodes.add(String(edge.fromNodeId));
    if (edge?.toNodeId) externalNodes.add(String(edge.toNodeId));
  }
  const ports = [];
  const add = (edge, nodeId, coordinate, direction, usage) => {
    if (!nodeId || !externalNodes.has(String(nodeId))) return;
    if (!directionAllowed(edge, direction, acceptedCwDirections)) return;
    const id = `${edge.id}:${direction}:${usage}`;
    if (excluded.has(id)) return;
    ports.push({
      id,
      junctionId,
      armId: String(nodeId),
      edgeId: String(edge.id),
      externalNodeId: String(nodeId),
      ringNodeId: null,
      coordinate: coordinate?.slice(0, 2) || null,
      usage,
      direction,
      source: "custom-boundary",
    });
  };
  for (const edge of internalEdges) {
    add(edge, edge.fromNodeId, edge.coordinates?.[0], "forward", "entry");
    add(edge, edge.fromNodeId, edge.coordinates?.[0], "reverse", "exit");
    add(edge, edge.toNodeId, edge.coordinates?.at(-1), "reverse", "entry");
    add(edge, edge.toNodeId, edge.coordinates?.at(-1), "forward", "exit");
  }
  return ports.sort((left, right) => left.id.localeCompare(right.id));
}

function geometryBounds(edges) {
  const coordinates = edges.flatMap((edge) => edge?.coordinates || []);
  if (!coordinates.length) return { bbox: null, center: null };
  const lngs = coordinates.map((coordinate) => Number(coordinate?.[0])).filter(Number.isFinite);
  const lats = coordinates.map((coordinate) => Number(coordinate?.[1])).filter(Number.isFinite);
  if (!lngs.length || !lats.length) return { bbox: null, center: null };
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  return {
    bbox,
    center: { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 },
  };
}

function findPort(ports, ref, usage) {
  return ports.find(
    (port) => port.edgeId === ref?.edgeId && port.direction === ref?.direction && port.usage === usage,
  ) || null;
}

function directedStartNode(ref, edge) {
  return ref?.direction === "reverse" ? edge?.toNodeId : edge?.fromNodeId;
}

function directedEndNode(ref, edge) {
  return ref?.direction === "reverse" ? edge?.fromNodeId : edge?.toNodeId;
}

const ENDPOINT_DIRECTION_USES = Object.freeze({
  a: Object.freeze([
    { alignmentKey: "aToB", terminal: "start", usage: "depart", portUsage: "exit" },
    { alignmentKey: "bToA", terminal: "end", usage: "arrive", portUsage: "entry" },
  ]),
  b: Object.freeze([
    { alignmentKey: "aToB", terminal: "end", usage: "arrive", portUsage: "entry" },
    { alignmentKey: "bToA", terminal: "start", usage: "depart", portUsage: "exit" },
  ]),
});

function endpointArmAssociations(
  segment,
  junctionId,
  ports,
  edgeById,
  { allowMultipleDirectionalPorts = false } = {},
) {
  const armAttachments = [];
  const attachments = [];
  const attachmentIssues = [];
  const portsByArm = new Map();
  const portEdgeIds = new Set(ports.map((port) => String(port.edgeId)));
  for (const port of ports) {
    portsByArm.set(port.armId, [...(portsByArm.get(port.armId) || []), port]);
  }

  for (const endpoint of ["a", "b"]) {
    const uses = [];
    for (const descriptor of ENDPOINT_DIRECTION_USES[endpoint]) {
      const refs = alignmentRefs(segment, descriptor.alignmentKey);
      if (!refs.length) continue;
      const ref = descriptor.terminal === "start" ? refs[0] : refs.at(-1);
      if (portEdgeIds.has(String(ref.edgeId))) continue;
      const edge = edgeById.get(String(ref.edgeId));
      if (!edge) continue;
      const terminalNodeId = descriptor.terminal === "start"
        ? directedStartNode(ref, edge)
        : directedEndNode(ref, edge);
      if (!terminalNodeId) continue;
      uses.push({ ...descriptor, terminalNodeId: String(terminalNodeId) });
    }
    if (!uses.length) continue;

    const matchingArmIds = [...new Set(
      uses.flatMap((use) =>
        [...portsByArm.keys()].filter((armId) => String(armId) === use.terminalNodeId),
      ),
    )];
    if (matchingArmIds.length === 0) {
      const stored = segment?.junctionAttachments?.[endpoint];
      if (stored?.junctionId === junctionId) {
        attachmentIssues.push({
          code: "stale_arm_attachment",
          junctionId,
          segmentId: Number(segment.segmentId),
          endpoint,
          armId: stored.armId,
        });
      }
      continue;
    }
    if (matchingArmIds.length > 1) {
      attachmentIssues.push({
        code: "ambiguous_arm_attachment",
        junctionId,
        segmentId: Number(segment.segmentId),
        endpoint,
        armIds: matchingArmIds.sort(),
      });
      continue;
    }

    const armId = matchingArmIds[0];
    const armPorts = portsByArm.get(armId) || [];
    const stored = segment?.junctionAttachments?.[endpoint];
    if (
      stored?.junctionId === junctionId &&
      (String(stored.armId) !== String(armId) || String(stored.externalNodeId) !== String(armId))
    ) {
      attachmentIssues.push({
        code: "stale_arm_attachment",
        junctionId,
        segmentId: Number(segment.segmentId),
        endpoint,
        armId: stored.armId,
        derivedArmId: armId,
      });
    }
    const coordinate = armPorts.find((port) => port.coordinate)?.coordinate || null;
    const endpointCoordinate = segment?.endpoints?.[endpoint]?.coordinate;
    armAttachments.push({
      junctionId,
      segmentId: Number(segment.segmentId),
      segmentName: segment.segmentName,
      endpoint,
      armId,
      externalNodeId: armId,
      coordinate,
      distanceMeters: coordinate && endpointCoordinate
        ? Math.round(haversineMeters(coordinate, endpointCoordinate) * 10) / 10
        : null,
      source: stored?.junctionId === junctionId && String(stored.armId) === String(armId)
        ? stored.source || "stored-terminal-node"
        : "automatic-terminal-node",
    });

    for (const use of uses.filter((item) => item.terminalNodeId === String(armId))) {
      const matchingPorts = armPorts.filter((port) => port.usage === use.portUsage);
      if (matchingPorts.length === 0 || (matchingPorts.length > 1 && !allowMultipleDirectionalPorts)) {
        attachmentIssues.push({
          code: matchingPorts.length ? "ambiguous_directional_port" : "missing_directional_port",
          junctionId,
          segmentId: Number(segment.segmentId),
          endpoint,
          alignmentKey: use.alignmentKey,
          usage: use.usage,
          armId,
          portIds: matchingPorts.map((port) => port.id),
        });
        continue;
      }
      for (const port of matchingPorts) {
        attachments.push({
          junctionId,
          segmentId: Number(segment.segmentId),
          segmentName: segment.segmentName,
          alignmentKey: use.alignmentKey,
          endpoint,
          usage: use.usage,
          armId,
          externalNodeId: armId,
          portId: port.id,
          source: "arm-attachment",
          ...(matchingPorts.length > 1 ? { alternative: true } : {}),
        });
      }
    }
  }
  return { armAttachments, attachments, attachmentIssues };
}

function segmentAssociations(
  overlay,
  internalEdgeIds,
  ports,
  edgeById,
  junctionId,
  { allowMultipleDirectionalPorts = false } = {},
) {
  const attachments = [];
  const armAttachments = [];
  const attachmentIssues = [];
  const throughAlignments = [];
  const segmentIds = new Set();
  for (const segment of Object.values(overlay?.segments || {})) {
    if (!activeNavigableSegment(segment)) continue;
    const endpointAssociations = endpointArmAssociations(
      segment,
      junctionId,
      ports,
      edgeById,
      { allowMultipleDirectionalPorts },
    );
    if (endpointAssociations.armAttachments.length) {
      segmentIds.add(Number(segment.segmentId));
      armAttachments.push(...endpointAssociations.armAttachments);
      attachments.push(...endpointAssociations.attachments);
    }
    attachmentIssues.push(...endpointAssociations.attachmentIssues);
    for (const [alignmentKey, alignment] of Object.entries(segment?.alignments || {})) {
      const mapping = alignment?.published || alignment?.draft;
      const refs = alignmentRefs(segment, alignmentKey);
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
    armAttachments,
    attachmentIssues,
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

function junctionFingerprint(junction) {
  return digest({
    id: junction.id,
    roundaboutFingerprint: junction.roundaboutFingerprint || null,
    topologyFingerprint: junction.topologyFingerprint,
    attachments: junction.attachments || [],
    armAttachments: junction.armAttachments || [],
    nearbyEndpoints: junction.nearbyEndpoints || [],
    movements: (junction.movements || []).map((movement) => ({
      id: movement.id,
      status: movement.status,
      edgeRefs: (movement.edgeRefs || []).map(({ edgeId, direction }) => ({ edgeId, direction })),
    })),
  });
}

function movementCoverage(ports, internalEdges, acceptedCwDirections) {
  const edgeById = new Map(internalEdges.map((edge) => [String(edge.id), edge]));
  const constrainedPath = (entry, exit) => {
    const entryEdge = edgeById.get(String(entry.edgeId));
    const exitEdge = edgeById.get(String(exit.edgeId));
    if (!entryEdge || !exitEdge) return null;
    if (!directionAllowed(entryEdge, entry.direction, acceptedCwDirections)) return null;
    if (!directionAllowed(exitEdge, exit.direction, acceptedCwDirections)) return null;
    const entryRef = directedRef(entryEdge, entry.direction);
    const exitRef = directedRef(exitEdge, exit.direction);
    const entryStart = directedStartNode(entryRef, entryEdge);
    const entryEnd = directedEndNode(entryRef, entryEdge);
    const exitStart = directedStartNode(exitRef, exitEdge);
    const exitEnd = directedEndNode(exitRef, exitEdge);
    if (
      String(entryStart) !== String(entry.externalNodeId) ||
      String(exitEnd) !== String(exit.externalNodeId)
    ) return null;
    if (entryRef.edgeId === exitRef.edgeId && entryRef.direction === exitRef.direction) {
      return {
        edgeRefs: [{ ...entryRef, sequenceIndex: 0 }],
        distanceMeters: Math.round(edgeLength(entryEdge) * 10) / 10,
      };
    }
    const middleEdges = internalEdges.filter(
      (edge) => ![entryRef.edgeId, exitRef.edgeId].includes(String(edge.id)),
    );
    const middle = String(entryEnd) === String(exitStart)
      ? { edgeRefs: [], distanceMeters: 0 }
      : shortestPath(entryEnd, exitStart, middleEdges, acceptedCwDirections);
    if (!middle) return null;
    return {
      edgeRefs: [entryRef, ...(middle.edgeRefs || []), exitRef]
        .map((ref, sequenceIndex) => ({ ...ref, sequenceIndex })),
      distanceMeters: Math.round((
        edgeLength(entryEdge) + Number(middle.distanceMeters || 0) + edgeLength(exitEdge)
      ) * 10) / 10,
    };
  };
  const movements = [];
  const entries = ports.filter((port) => port.usage === "entry");
  const exits = ports.filter((port) => port.usage === "exit");
  for (const entry of entries) {
    for (const exit of exits) {
      if (entry.armId === exit.armId) continue;
      const path = constrainedPath(entry, exit);
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

export function normalizeNetworkJunctionRegistry(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Network junction registry must be an object");
  }
  const records = value.junctions && typeof value.junctions === "object" && !Array.isArray(value.junctions)
    ? value.junctions
    : {};
  const normalized = { schemaVersion: 1, junctions: {} };
  for (const [id, input] of Object.entries(records)) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`Junction ${id} must be an object`);
    }
    const sourceType = input.source?.type;
    if (!['derived_roundabout', 'custom'].includes(sourceType)) {
      throw new Error(`Junction ${id} has unsupported source type`);
    }
    const status = input.status || "detected";
    if (!PUBLICATION_STATES.has(status)) throw new Error(`Junction ${id} has invalid status ${status}`);
    const navigationKind = input.navigationKind || (sourceType === "derived_roundabout" ? "roundabout" : "intersection");
    if (!NAVIGATION_KINDS.has(navigationKind)) {
      throw new Error(`Junction ${id} has invalid navigation kind ${navigationKind}`);
    }
    const internalEdgeIds = sourceType === "custom"
      ? [...new Set((input.source.internalEdgeIds || []).map(String).filter(Boolean))]
      : [];
    if (sourceType === "custom" && internalEdgeIds.length === 0) {
      throw new Error(`Custom junction ${id} must reference at least one internal edge`);
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    normalized.junctions[id] = {
      id,
      name,
      status,
      navigationKind,
      source: sourceType === "custom"
        ? { type: "custom", internalEdgeIds }
        : { type: "derived_roundabout", roundaboutId: String(input.source.roundaboutId || "") },
      excludedPortIds: [...new Set((input.excludedPortIds || []).map(String).filter(Boolean))].sort(),
      topologyFingerprint: typeof input.topologyFingerprint === "string" ? input.topologyFingerprint : null,
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
      reviewer: typeof input.reviewer === "string" ? input.reviewer : null,
    };
  }
  return normalized;
}

function publicationState(candidate, record) {
  const issues = [];
  if (!record?.name) issues.push({ code: "junction_name_required" });
  if ((candidate.armAttachments || []).length < 2) issues.push({ code: "two_junction_arms_required" });
  if ((candidate.summary?.legalMovements || 0) < 1) issues.push({ code: "legal_junction_movement_required" });
  issues.push(...(candidate.attachmentIssues || []));
  const fingerprintCurrent = record?.status !== "published"
    || (Boolean(record.topologyFingerprint) && record.topologyFingerprint === candidate.topologyFingerprint);
  if (record?.status === "published" && !fingerprintCurrent) {
    issues.push({ code: "published_junction_topology_stale" });
  }
  const requestedStatus = record?.status || "detected";
  const effectiveStatus = requestedStatus === "published" && !fingerprintCurrent ? "stale" : requestedStatus;
  return {
    requestedStatus,
    status: effectiveStatus,
    canPublish: issues.length === 0,
    issues,
    fingerprintCurrent,
  };
}

function withCuration(candidate, record = null) {
  const publication = publicationState(candidate, record);
  return {
    ...candidate,
    name: record?.name || null,
    navigationKind: record?.navigationKind || (candidate.kind === "derived_roundabout" ? "roundabout" : "intersection"),
    publication,
    registryRecord: record,
  };
}

function customJunctionCandidate(record, graph, overlay, acceptedCwDirections) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const edgeById = new Map(edges.map((edge) => [String(edge.id), edge]));
  const missingInternalEdgeIds = record.source.internalEdgeIds.filter((edgeId) => !edgeById.has(edgeId));
  const internalEdges = record.source.internalEdgeIds.map((edgeId) => edgeById.get(edgeId)).filter(Boolean);
  const internalEdgeIds = new Set(internalEdges.map((edge) => String(edge.id)));
  const proposedPorts = customBoundaryPorts(
    record.id,
    internalEdges,
    edges,
    acceptedCwDirections,
    [],
  );
  const excludedPortIds = new Set(record.excludedPortIds || []);
  const ports = proposedPorts.filter((port) => !excludedPortIds.has(port.id));
  const associations = segmentAssociations(
    overlay,
    internalEdgeIds,
    ports,
    edgeById,
    record.id,
    { allowMultipleDirectionalPorts: true },
  );
  const { bbox, center } = geometryBounds(internalEdges);
  const nearbyEndpoints = nearbySegmentEndpoints(overlay, center);
  const segmentIds = [...new Set([
    ...associations.segmentIds,
    ...nearbyEndpoints.map((endpoint) => endpoint.segmentId),
  ])].sort((a, b) => a - b);
  const movements = movementCoverage(ports, internalEdges, acceptedCwDirections);
  const topologyFingerprint = digest({
    id: record.id,
    edges: internalEdges.map((edge) => ({
      id: String(edge.id),
      from: edge.fromNodeId,
      to: edge.toNodeId,
      forward: traversalState(edge, "forward"),
      reverse: traversalState(edge, "reverse"),
    })),
    ports: ports.map(({ id, armId, edgeId, direction, usage }) => ({ id, armId, edgeId, direction, usage })),
  });
  const candidate = {
    id: record.id,
    kind: "custom_bicycle",
    roundaboutId: null,
    roundaboutFingerprint: null,
    classification: record.navigationKind,
    center,
    boundary: bbox,
    ringEdgeIds: record.navigationKind === "roundabout"
      ? [...internalEdgeIds].sort()
      : [],
    internalEdgeIds: [...internalEdgeIds].sort(),
    missingInternalEdgeIds,
    ports,
    proposedPorts,
    ...associations,
    attachmentIssues: [
      ...associations.attachmentIssues,
      ...missingInternalEdgeIds.map((edgeId) => ({ code: "missing_custom_junction_edge", edgeId })),
    ],
    segmentIds,
    nearbyEndpoints,
    movements,
    topologyFingerprint,
    summary: {
      ports: ports.length,
      armAttachments: associations.armAttachments.length,
      directionalAttachments: associations.attachments.length,
      movements: movements.length,
      legalMovements: movements.filter((movement) => movement.status !== "unavailable").length,
      unavailableMovements: movements.filter((movement) => movement.status === "unavailable").length,
    },
  };
  candidate.fingerprint = junctionFingerprint(candidate);
  return withCuration(candidate, record);
}

export function deriveNetworkJunctionCandidates({
  graph = {},
  roundaboutCandidates = {},
  roundaboutReviews = {},
  overlay = {},
  curatedJunctions = {},
} = {}) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const edgeById = new Map(edges.map((edge) => [String(edge.id), edge]));
  const acceptedCwDirections = acceptedCwDirectionSet(overlay);
  const registry = normalizeNetworkJunctionRegistry(curatedJunctions);
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
    const associations = segmentAssociations(overlay, internalEdgeIds, ports, edgeById, id);
    const nearbyEndpoints = nearbySegmentEndpoints(overlay, roundabout.center);
    const segmentIds = [...new Set([
      ...associations.segmentIds,
      ...nearbyEndpoints.map((endpoint) => endpoint.segmentId),
    ])].sort((a, b) => a - b);
    if (!segmentIds.length) continue;
    const movements = movementCoverage(ports, internalEdges, acceptedCwDirections);
    const topologyFingerprint = digest({
      id,
      roundaboutFingerprint: roundabout.fingerprint,
      edges: internalEdges.map((edge) => ({
        id: edge.id,
        from: edge.fromNodeId,
        to: edge.toNodeId,
        forward: traversalState(edge, "forward"),
        reverse: traversalState(edge, "reverse"),
      })),
      ports: ports.map(({ id: portId, armId, edgeId, direction, usage }) => ({
        id: portId,
        armId,
        edgeId,
        direction,
        usage,
      })),
    });
    const junction = {
      id,
      kind: "derived_roundabout",
      roundaboutId: roundabout.id,
      roundaboutFingerprint: roundabout.fingerprint,
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
      topologyFingerprint,
      summary: {
        ports: ports.length,
        armAttachments: associations.armAttachments.length,
        directionalAttachments: associations.attachments.length,
        movements: movements.length,
        legalMovements: movements.filter((movement) => movement.status !== "unavailable").length,
        unavailableMovements: movements.filter((movement) => movement.status === "unavailable").length,
      },
    };
    junction.fingerprint = junctionFingerprint(junction);
    const record = registry.junctions[id] || null;
    junctions.push(withCuration(junction, record));
  }
  for (const record of Object.values(registry.junctions)) {
    if (record.source.type !== "custom") continue;
    junctions.push(customJunctionCandidate(record, graph, overlay, acceptedCwDirections));
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
      armAttachments: junctions.reduce((sum, junction) => sum + junction.summary.armAttachments, 0),
      directionalAttachments: junctions.reduce((sum, junction) => sum + junction.summary.directionalAttachments, 0),
    },
  };
}

export function mergeNetworkJunctionRegistry(candidatesPayload = {}, graph = {}, overlay = {}, registryValue = {}) {
  const registry = normalizeNetworkJunctionRegistry(registryValue);
  const acceptedCwDirections = acceptedCwDirectionSet(overlay);
  const junctions = (candidatesPayload.junctions || [])
    .filter((candidate) => candidate.kind !== "custom_bicycle")
    .map((candidate) => withCuration(candidate, registry.junctions[candidate.id] || null));
  for (const record of Object.values(registry.junctions)) {
    if (record.source.type !== "custom") continue;
    junctions.push(customJunctionCandidate(record, graph, overlay, acceptedCwDirections));
  }
  junctions.sort((left, right) => left.id.localeCompare(right.id));
  return {
    ...candidatesPayload,
    junctions,
    summary: {
      ...(candidatesPayload.summary || {}),
      relevantJunctions: junctions.length,
      ports: junctions.reduce((sum, junction) => sum + junction.ports.length, 0),
      movements: junctions.reduce((sum, junction) => sum + junction.movements.length, 0),
      unavailableMovements: junctions.reduce((sum, junction) => sum + junction.summary.unavailableMovements, 0),
      armAttachments: junctions.reduce((sum, junction) => sum + junction.summary.armAttachments, 0),
      directionalAttachments: junctions.reduce((sum, junction) => sum + junction.summary.directionalAttachments, 0),
    },
  };
}

export function reconcileOverlayJunctionArmAttachments(
  overlay,
  candidatesPayload,
  { segmentIds = null } = {},
) {
  const selected = segmentIds == null ? null : new Set(segmentIds.map(Number));
  const next = structuredClone(overlay);
  const bySegmentEndpoint = new Map();
  for (const junction of candidatesPayload?.junctions || []) {
    for (const attachment of junction.armAttachments || []) {
      if (selected && !selected.has(Number(attachment.segmentId))) continue;
      const key = `${Number(attachment.segmentId)}|${attachment.endpoint}`;
      bySegmentEndpoint.set(key, [...(bySegmentEndpoint.get(key) || []), attachment]);
    }
  }
  const applied = [];
  const removed = [];
  const issues = [];
  for (const segment of Object.values(next.segments || {})) {
    if (selected && !selected.has(Number(segment.segmentId))) continue;
    segment.junctionAttachments ||= {};
    for (const endpoint of ["a", "b"]) {
      const key = `${Number(segment.segmentId)}|${endpoint}`;
      const matches = bySegmentEndpoint.get(key) || [];
      const current = segment.junctionAttachments[endpoint];
      if (matches.length === 1) {
        const match = matches[0];
        const value = {
          junctionId: match.junctionId,
          armId: match.armId,
          externalNodeId: match.externalNodeId,
          source: current?.source === "curator" ? "curator" : "automatic-terminal-node",
        };
        segment.junctionAttachments[endpoint] = value;
        applied.push({ segmentId: Number(segment.segmentId), endpoint, ...value });
      } else if (matches.length > 1) {
        issues.push({
          code: "ambiguous_junction_attachment",
          segmentId: Number(segment.segmentId),
          endpoint,
          junctionIds: matches.map((item) => item.junctionId).sort(),
        });
      } else if (current?.source !== "curator") {
        if (current) removed.push({ segmentId: Number(segment.segmentId), endpoint, ...current });
        delete segment.junctionAttachments[endpoint];
      }
    }
    if (Object.keys(segment.junctionAttachments).length === 0) delete segment.junctionAttachments;
  }
  return { overlay: next, applied, removed, issues };
}

export function deriveJunctionArmAttachmentCandidates({
  overlay,
  graph = {},
  junctions = [],
  segmentIds = null,
} = {}) {
  const selected = segmentIds == null ? null : new Set(segmentIds.map(Number));
  const edgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id), edge]));
  const selectedSegments = Object.values(overlay?.segments || {}).filter(
    (segment) =>
      activeNavigableSegment(segment) &&
      (!selected || selected.has(Number(segment.segmentId))),
  );
  return {
    schemaVersion: 1,
    junctions: junctions.map((junction) => {
      const armAttachments = [];
      const attachments = [];
      const attachmentIssues = [];
      for (const segment of selectedSegments) {
        const associations = endpointArmAssociations(
          segment,
          junction.id,
          junction.ports || [],
          edgeById,
          { allowMultipleDirectionalPorts: junction.kind === "custom_bicycle" },
        );
        armAttachments.push(...associations.armAttachments);
        attachments.push(...associations.attachments);
        attachmentIssues.push(...associations.attachmentIssues);
      }
      return { ...junction, armAttachments, attachments, attachmentIssues };
    }),
  };
}

export function refreshNetworkJunctionArmAssociations(candidatesPayload, overlay, graph = {}) {
  const edgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id), edge]));
  const junctions = (candidatesPayload?.junctions || []).map((candidate) => {
    const armAttachments = [];
    const attachments = (candidate.attachments || []).filter(
      (attachment) => attachment.source !== "arm-attachment",
    );
    const attachmentIssues = [];
    for (const segment of Object.values(overlay?.segments || {})) {
      if (!activeNavigableSegment(segment)) continue;
      const associations = endpointArmAssociations(
        segment,
        candidate.id,
        candidate.ports || [],
        edgeById,
        { allowMultipleDirectionalPorts: candidate.kind === "custom_bicycle" },
      );
      armAttachments.push(...associations.armAttachments);
      attachments.push(...associations.attachments);
      attachmentIssues.push(...associations.attachmentIssues);
    }
    const nearbyEndpoints = nearbySegmentEndpoints(overlay, candidate.center);
    const segmentIds = [...new Set([
      ...(candidate.throughAlignments || []).map((item) => Number(item.segmentId)),
      ...attachments.map((item) => Number(item.segmentId)),
      ...armAttachments.map((item) => Number(item.segmentId)),
      ...nearbyEndpoints.map((item) => Number(item.segmentId)),
    ])].filter(Number.isInteger).sort((a, b) => a - b);
    const junction = {
      ...candidate,
      armAttachments,
      attachments,
      attachmentIssues,
      nearbyEndpoints,
      segmentIds,
      summary: {
        ...(candidate.summary || {}),
        armAttachments: armAttachments.length,
        directionalAttachments: attachments.length,
      },
    };
    junction.fingerprint = junctionFingerprint(junction);
    return withCuration(junction, candidate.registryRecord || null);
  });
  return {
    ...candidatesPayload,
    junctions,
    summary: {
      ...(candidatesPayload?.summary || {}),
      armAttachments: junctions.reduce((sum, junction) => sum + junction.armAttachments.length, 0),
      directionalAttachments: junctions.reduce((sum, junction) => sum + junction.attachments.length, 0),
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
  const armAttachments = [];
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
          navigationKind: junction.navigationKind,
          publicationStatus: junction.publication?.status || "detected",
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
    for (const attachment of junction.armAttachments || []) {
      if (!attachment.coordinate) continue;
      armAttachments.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: attachment.coordinate },
        properties: { ...attachment },
      });
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
    armAttachments: { type: "FeatureCollection", features: armAttachments },
    publishedFootprint: networkJunctionPublicGeoJson(joined, graph),
  };
}

export function networkJunctionPublicGeoJson(joined, graph = {}) {
  const edgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id), edge]));
  const features = [];
  for (const item of joined?.items || []) {
    const junction = item.candidate;
    if (junction.publication?.status !== "published") continue;
    const attachedArms = new Set((junction.armAttachments || []).map((attachment) => String(attachment.armId)));
    const portById = new Map((junction.ports || []).map((port) => [String(port.id), port]));
    const footprintEdgeIds = new Set();
    for (const movement of junction.movements || []) {
      if (movement.status === "unavailable") continue;
      const entry = portById.get(String(movement.entryPortId));
      const exit = portById.get(String(movement.exitPortId));
      if (!entry || !exit || !attachedArms.has(String(entry.armId)) || !attachedArms.has(String(exit.armId))) continue;
      for (const ref of movement.edgeRefs || []) footprintEdgeIds.add(String(ref.edgeId));
    }
    for (const edgeId of [...footprintEdgeIds].sort()) {
      const edge = edgeById.get(edgeId);
      if (!edge?.coordinates?.length) continue;
      features.push({
        type: "Feature",
        id: `${junction.id}:${edgeId}`,
        geometry: {
          type: "LineString",
          coordinates: edge.coordinates.map((coordinate) => coordinate.slice(0, 2)),
        },
        properties: {
          id: `${junction.id}:${edgeId}`,
          junctionId: junction.id,
          name: junction.name,
          navigationKind: junction.navigationKind,
          networkRole: "junction",
          roadType: "paved",
          interactive: false,
          edgeId,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
