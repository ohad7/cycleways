import { createHash } from "node:crypto";

const FRACTION_SCALE = 1_000_000;
const MOTOR_PRIORITY = new Map([
  ["motorway", 0], ["trunk", 1], ["primary", 2], ["secondary", 3],
  ["tertiary", 4], ["motorway_link", 5], ["trunk_link", 6],
  ["primary_link", 7], ["secondary_link", 8], ["tertiary_link", 9],
  ["unclassified", 10], ["residential", 11], ["service", 12],
]);

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function coordinate(value) {
  return { lat: Number(value?.[1]), lng: Number(value?.[0]) };
}

function bboxIntersects(left, right) {
  return Array.isArray(left) && left.length === 4
    && Array.isArray(right) && right.length === 4
    && left[0] <= right[2] && left[2] >= right[0]
    && left[1] <= right[3] && left[3] >= right[1];
}

function logicalBbox(logical) {
  return logical?.bbox || [
    logical?.center?.lng,
    logical?.center?.lat,
    logical?.center?.lng,
    logical?.center?.lat,
  ];
}

function crossingItems(joined) {
  return [
    ...(joined?.items || []).map((item) => ({ ...item, logical: item.candidate, manual: false })),
    ...(joined?.manualItems || []).map((item) => ({ ...item, logical: item.crossing, manual: true })),
  ];
}

function edgeIdsForSlices(slices, edgeIdByShareId) {
  return (slices || []).map((slice) => edgeIdByShareId.get(Number(slice.edgeShareId))).filter(Boolean);
}

function mappingMatchesMovement(mapping, movementEdgeIds, edgeIdByShareId, representation) {
  const before = edgeIdsForSlices(mapping?.match?.before, edgeIdByShareId);
  const action = edgeIdsForSlices(mapping?.match?.action, edgeIdByShareId);
  const after = edgeIdsForSlices(mapping?.match?.after, edgeIdByShareId);
  if (representation === "junction-transition") {
    const context = [...before, ...after];
    return context.length >= 2 && context.every((edgeId) => movementEdgeIds.has(edgeId));
  }
  return action.length > 0 && action.every((edgeId) => movementEdgeIds.has(edgeId));
}

function siteState(items) {
  const states = new Set(items.map((item) => item.state));
  if (states.has("invalid")) return "conflict";
  if (states.has("staleAccepted") || states.has("staleRejected")) return "stale";
  if (states.has("pending")) return states.size === 1 ? "needs-review" : "partially-reviewed";
  if (states.has("accepted") || states.has("manual")) {
    return states.size === 1 ? "confirmed" : "partially-reviewed";
  }
  if (states.size === 1 && states.has("rejected")) return "no-guidance";
  return "partially-reviewed";
}

function mergedBbox(items) {
  const boxes = items.map((item) => logicalBbox(item.logical));
  return [
    Math.min(...boxes.map((bbox) => bbox[0])),
    Math.min(...boxes.map((bbox) => bbox[1])),
    Math.max(...boxes.map((bbox) => bbox[2])),
    Math.max(...boxes.map((bbox) => bbox[3])),
  ];
}

export function buildCrossingReviewSites({ joined, junctionItems = [], shareRegistry = {} }) {
  const edgeIdByShareId = new Map(
    Object.entries(shareRegistry?.edges || {}).map(([edgeId, shareId]) => [Number(shareId), edgeId]),
  );
  const junctions = junctionItems.map((item) => item?.candidate || item).filter(Boolean);
  const contexts = new Map();
  const items = crossingItems(joined);

  for (const item of items) {
    const logical = item.logical;
    const associations = [];
    for (const junction of junctions) {
      if (!bboxIntersects(logicalBbox(logical), junction.boundary || junction.bbox)) continue;
      const movementIds = [];
      for (const movement of junction.movements || []) {
        if (movement.status === "unavailable") continue;
        const movementEdgeIds = new Set((movement.edgeRefs || []).map((ref) => String(ref.edgeId)));
        if ((logical.mappings || []).some((mapping) => mappingMatchesMovement(
          mapping,
          movementEdgeIds,
          edgeIdByShareId,
          logical.representation || "action-path",
        ))) {
          movementIds.push(movement.id);
        }
      }
      if (movementIds.length) {
        associations.push({
          junctionId: junction.id,
          junctionBbox: junction.boundary || junction.bbox || null,
          movementIds: [...new Set(movementIds)].sort(),
          roundaboutId: junction.roundaboutId || null,
          navigationKind: junction.navigationKind || junction.classification || "intersection",
          topologyFingerprint: junction.topologyFingerprint || null,
          name: junction.name || null,
        });
      }
    }
    associations.sort((a, b) => a.junctionId.localeCompare(b.junctionId));
    const primary = associations[0] || null;
    const reviewSiteId = primary
      ? `junction:${primary.junctionId}`
      : `standalone:${logical.id}`;
    contexts.set(logical.id, {
      reviewSiteId,
      junctionId: primary?.junctionId || null,
      movementIds: primary?.movementIds || [],
      roundaboutId: primary?.roundaboutId || null,
      navigationKind: primary?.navigationKind || null,
      topologyFingerprint: primary?.topologyFingerprint || null,
      associations,
    });
  }

  const grouped = new Map();
  for (const item of items) {
    const context = contexts.get(item.logical.id);
    const list = grouped.get(context.reviewSiteId) || [];
    list.push(item);
    grouped.set(context.reviewSiteId, list);
  }
  const reviewSites = [...grouped.entries()].map(([id, siteItems]) => {
    const context = contexts.get(siteItems[0].logical.id);
    const bbox = Array.isArray(context.associations[0]?.junctionBbox)
      && context.associations[0].junctionBbox.length === 4
      ? context.associations[0].junctionBbox
      : mergedBbox(siteItems);
    const center = { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 };
    const candidateIds = siteItems.filter((item) => !item.manual).map((item) => item.logical.id).sort();
    const manualIds = siteItems.filter((item) => item.manual).map((item) => item.logical.id).sort();
    const evidence = new Set(siteItems.flatMap((item) => item.logical.evidence || []));
    return {
      id,
      label: context.junctionId
        ? context.associations[0]?.name || `Junction ${context.junctionId}`
        : siteItems[0].logical.crossedRoad?.name
          || siteItems[0].logical.crossedRoad?.highway
          || "Standalone crossing",
      state: siteState(siteItems),
      center,
      bbox,
      candidateIds,
      manualIds,
      crossingIds: [...candidateIds, ...manualIds],
      junctionId: context.junctionId,
      movementIds: [...new Set(siteItems.flatMap((item) => contexts.get(item.logical.id).movementIds))].sort(),
      roundaboutId: context.roundaboutId,
      navigationKind: context.navigationKind,
      evidence: [...evidence].sort(),
      priorityTier: context.junctionId ? (context.roundaboutId ? 3 : 2) : evidence.has("osm-crossing-tag") ? 4 : 6,
    };
  });
  reviewSites.sort((a, b) => a.priorityTier - b.priorityTier || a.state.localeCompare(b.state) || a.id.localeCompare(b.id));
  return { reviewSites, contexts };
}

export function decorateCrossingReview(joined, siteResult) {
  const decorate = (logical) => {
    const context = siteResult.contexts.get(logical.id);
    return context ? { ...logical, reviewSiteId: context.reviewSiteId, context } : logical;
  };
  return {
    items: (joined?.items || []).map((item) => ({ ...item, candidate: decorate(item.candidate) })),
    manualItems: (joined?.manualItems || []).map((item) => ({ ...item, crossing: decorate(item.crossing) })),
  };
}

export function crossingReviewSiteGeoJson(reviewSites = []) {
  return {
    type: "FeatureCollection",
    features: reviewSites.map((site) => ({
      type: "Feature",
      id: site.id,
      geometry: { type: "Point", coordinates: [site.center.lng, site.center.lat] },
      properties: {
        id: site.id,
        state: site.state,
        label: site.label,
        junctionId: site.junctionId,
        candidateCount: site.crossingIds.length,
        priorityTier: site.priorityTier,
      },
    })),
  };
}

function directedCoordinates(edge, direction) {
  const coordinates = (edge?.coordinates || []).map((value) => value.slice(0, 2));
  return direction === "reverse" ? coordinates.reverse() : coordinates;
}

function sliceFor(ref, shareId) {
  return {
    edgeShareId: shareId,
    fromFractionQ: ref.direction === "reverse" ? FRACTION_SCALE : 0,
    toFractionQ: ref.direction === "reverse" ? 0 : FRACTION_SCALE,
  };
}

function sameCoordinate(left, right) {
  return Math.abs(Number(left?.[0]) - Number(right?.[0])) <= 0.000001
    && Math.abs(Number(left?.[1]) - Number(right?.[1])) <= 0.000001;
}

function crossingRoad(edges, junction) {
  const selected = [...edges].sort((left, right) => {
    const leftPriority = MOTOR_PRIORITY.get(String(left?.tags?.highway || "")) ?? 99;
    const rightPriority = MOTOR_PRIORITY.get(String(right?.tags?.highway || "")) ?? 99;
    return leftPriority - rightPriority || String(left?.id).localeCompare(String(right?.id));
  })[0];
  const sourceId = selected?.osmWayId ?? selected?.tags?.osmId ?? null;
  return {
    source: sourceId ? "osm" : "junction",
    sourceIds: sourceId ? [sourceId] : [],
    name: selected?.tags?.name || junction.name || null,
    highway: selected?.tags?.highway || "junction",
  };
}

export function buildJunctionCrossingProposal({
  junction,
  movementId,
  graph,
  shareRegistry,
  continuationDirection,
}) {
  if (!junction || !movementId) throw new Error("Select a junction movement first");
  if (junction.roundaboutId || junction.navigationKind === "roundabout") {
    throw new Error("Create roundabout-adjacent crossing guidance from its approach or departure, not through the ring");
  }
  const movement = (junction.movements || []).find((item) => item.id === movementId);
  if (!movement || movement.status === "unavailable") throw new Error("The selected junction movement is unavailable");
  if (!["left", "right"].includes(continuationDirection)) {
    throw new Error("Choose whether the rider turns left or right after crossing");
  }
  const refs = [...(movement.edgeRefs || [])].sort(
    (left, right) => Number(left.sequenceIndex || 0) - Number(right.sequenceIndex || 0),
  );
  if (refs.length < 2) throw new Error("This movement needs at least two directed base edges before crossing guidance can be created");
  const edgeById = new Map((graph?.edges || []).map((edge) => [String(edge.id), edge]));
  const shareIds = shareRegistry?.edges || {};
  const edges = refs.map((ref) => edgeById.get(String(ref.edgeId)));
  const missing = refs.filter((ref, index) => !edges[index] || !Number.isInteger(shareIds[String(ref.edgeId)]));
  if (missing.length) throw new Error(`Movement edges are missing current stable evidence: ${missing.map((ref) => ref.edgeId).join(", ")}`);
  const geometries = refs.map((ref, index) => directedCoordinates(edges[index], ref.direction));
  if (geometries.some((value) => value.length < 2)) throw new Error("Movement contains an edge without usable geometry");
  for (let index = 1; index < geometries.length; index += 1) {
    if (!sameCoordinate(geometries[index - 1].at(-1), geometries[index][0])) {
      throw new Error(`Movement is disconnected between ${refs[index - 1].edgeId} and ${refs[index].edgeId}`);
    }
  }
  const representation = refs.length === 2 ? "junction-transition" : "action-path";
  const before = refs[0];
  const after = refs.at(-1);
  const actionRefs = representation === "action-path" ? refs.slice(1, -1) : [];
  const actionGeometries = representation === "action-path" ? geometries.slice(1, -1) : [];
  const entryRaw = geometries[0].at(-1);
  const exitRaw = representation === "junction-transition" ? entryRaw : geometries.at(-1)[0];
  const actionGeometry = actionGeometries.flatMap((value, index) => index ? value.slice(1) : value);
  const allCoordinates = geometries.flat();
  const policyDigest = graph?.metadata?.bicycleTraversalShadowPolicyDigest || null;
  const signature = {
    before: [sliceFor(before, shareIds[String(before.edgeId)])],
    action: actionRefs.map((ref) => sliceFor(ref, shareIds[String(ref.edgeId)])),
    after: [sliceFor(after, shareIds[String(after.edgeId)])],
  };
  const identityDigest = digest({ junctionId: junction.id, movementId, signature }).slice(7, 23);
  const sourceEdgeFingerprint = digest({
    junctionId: junction.id,
    topologyFingerprint: junction.topologyFingerprint,
    edges: refs.map((ref, index) => ({
      edgeId: String(ref.edgeId),
      direction: ref.direction,
      sourceGeometryDigest: edges[index].sourceGeometryDigest || null,
    })),
    policyDigest,
  });
  const mapping = {
    id: `mapping-junction-${identityDigest}`,
    direction: `${movement.entryPortId}->${movement.exitPortId}`,
    match: signature,
    entry: coordinate(entryRaw),
    exit: coordinate(exitRaw),
    continuation: { type: "turn", direction: continuationDirection },
    beforeGeometry: geometries[0].map(coordinate),
    afterGeometry: geometries.at(-1).map(coordinate),
    ...(actionGeometry.length >= 2 ? { geometry: actionGeometry.map(coordinate) } : {}),
    policy: { state: "allowed", policyDigest },
    sourceEdgeFingerprint,
  };
  return {
    id: `manual-crossing-junction-${identityDigest}`,
    kind: "side-change",
    representation,
    guidancePolicy: representation === "junction-transition" ? "user-option" : "always",
    center: coordinate(entryRaw),
    bbox: [
      Math.min(...allCoordinates.map((value) => value[0])),
      Math.min(...allCoordinates.map((value) => value[1])),
      Math.max(...allCoordinates.map((value) => value[0])),
      Math.max(...allCoordinates.map((value) => value[1])),
    ],
    crossedRoad: crossingRoad(edges, junction),
    reviewSiteId: `junction:${junction.id}`,
    context: {
      junctionId: junction.id,
      movementId,
      roundaboutId: null,
      roundaboutPhase: null,
      junctionFingerprint: junction.fingerprint || null,
      topologyFingerprint: junction.topologyFingerprint || null,
    },
    sourceEdgeFingerprint,
    warnings: ["curator-confirmed-junction-side-change"],
    mappings: [mapping],
  };
}
