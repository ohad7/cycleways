import { getDistance } from "../utils/distance.js";
import {
  decodeRoutePayload,
  encodeBaseRoute,
  encodeCompactRoute,
  encodeHybridRoute,
  encodeHybridRouteV6,
  extractMiddlePoints,
} from "../utils/route-encoding.js";
import {
  distanceToRouteGeometry,
  getDataPointLocation,
  projectPointToRouteGeometry,
  ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
} from "../utils/route-data.js";
import { emptyRouteSnapshot } from "./routeSnapshot.js";

// Re-exported so existing importers of routeActions keep working. The shape
// itself lives in routeSnapshot.js (dependency-free) so read-only consumers can
// import it without pulling in the routing engine.
export { emptyRouteSnapshot };

export async function createRouteManager(
  RouteManagerClass,
  geoJsonData,
  segmentsData,
  baseRoutingNetworkData = null,
) {
  if (typeof RouteManagerClass !== "function") {
    throw new Error("RouteManager is not available");
  }

  const manager = new RouteManagerClass();
  await manager.load(geoJsonData, segmentsData, baseRoutingNetworkData);
  return manager;
}

export function addPoint(manager, point, segmentsData) {
  manager.addPoint(point);
  return snapshotRouteManager(manager, segmentsData);
}

export function dragPoint(manager, points, index, point, segmentsData) {
  const nextPoints = points.map((existingPoint, pointIndex) =>
    pointIndex === index
      ? {
          ...existingPoint,
          lat: point.lat,
          lng: point.lng,
        }
      : existingPoint,
  );
  manager.recalculateRoute(nextPoints);
  return snapshotRouteManager(manager, segmentsData);
}

export function recalculatePoints(manager, points, segmentsData) {
  manager.recalculateRoute(points);
  return snapshotRouteManager(manager, segmentsData);
}

export function removePoint(manager, index, segmentsData) {
  manager.removePoint(index);
  return snapshotRouteManager(manager, segmentsData);
}

export function clearRoute(manager) {
  manager.clearRoute();
  return emptyRouteSnapshot();
}

export function restoreRoute(manager, points, segmentsData) {
  manager.restoreFromPoints(points);
  return snapshotRouteManager(manager, segmentsData);
}

export function applyRouteSnapshot(manager, snapshot) {
  if (typeof manager.updateInternalState === "function") {
    manager.updateInternalState(snapshot.points, snapshot.selectedSegments);
  }

  return snapshot;
}

export function restoreRouteFromParam(
  manager,
  routeParam,
  segmentsData,
  cwBaseIndex = null,
) {
  const payload = decodeRoutePayload(routeParam);
  if (
    isHybridRoutePayload(payload) &&
    typeof manager?.restoreBaseRouteFromPayload === "function"
  ) {
    const expandedPayload = expandHybridRoutePayload(payload, cwBaseIndex);
    if (expandedPayload && manager.restoreBaseRouteFromPayload(expandedPayload)) {
      return snapshotRouteManager(manager, segmentsData);
    }
  }

  if (
    payload.type === "base_route_v4" &&
    typeof manager?.restoreBaseRouteFromPayload === "function" &&
    manager.restoreBaseRouteFromPayload(payload)
  ) {
    return snapshotRouteManager(manager, segmentsData);
  }

  const points = routePointsFromPayload(payload, segmentsData);
  return points ? restoreRoute(manager, points, segmentsData) : null;
}

export function routePointsFromParam(routeParam, segmentsData) {
  const payload = decodeRoutePayload(routeParam);
  return routePointsFromPayload(payload, segmentsData);
}

function routePointsFromPayload(payload, segmentsData) {
  if (
    isHybridRoutePayload(payload) &&
    payload.routePoints.length > 0 &&
    payload.routePoints.every(hasLngLat)
  ) {
    return payload.routePoints;
  }
  if (payload.type === "base_route_v4" && payload.routePoints.length > 0) {
    return payload.routePoints;
  }
  if (payload.type === "compact_route" && payload.routePoints.length > 0) {
    return payload.routePoints;
  }

  if (payload.type === "legacy_segments" && payload.segmentIds.length > 0) {
    const middlePoints = extractMiddlePoints(payload.segmentIds, segmentsData);
    return middlePoints.length > 0 ? middlePoints : null;
  }

  if (payload.type === "invalid") {
    throw new Error("Route URL is invalid");
  }

  return null;
}

export function snapshotRouteManager(manager, segmentsData) {
  const info = manager.getRouteInfo();
  const points = info.points.map((point, index) => ({
    ...point,
    id: point.id || `route-point-${Date.now()}-${index}`,
  }));
  const geometry = info.orderedCoordinates || [];

  return {
    points,
    selectedSegments: info.segments,
    geometry,
    distance: info.distance || 0,
    elevationGain: info.elevationGain || 0,
    elevationLoss: info.elevationLoss || 0,
    routeFailure: info.failure || null,
    segmentSpans: info.segmentSpans || [],
    routingValidation: info.routingValidation
      ? cloneJsonValue(info.routingValidation)
      : null,
    activeDataPoints: getActiveRouteDataPoints(
      info.segments,
      geometry,
      segmentsData,
    ),
  };
}

export const ROUTE_SHARE_WARN_URL_LENGTH = 1800;
export const ROUTE_SHARE_MAX_URL_LENGTH = 3500;

export function routeStateSnapshot(routeState) {
  return {
    points: routeState.points.map((point) => ({ ...point })),
    selectedSegments: [...routeState.selectedSegments],
    geometry: routeState.geometry.map((point) => ({ ...point })),
    distance: routeState.distance || 0,
    elevationGain: routeState.elevationGain || 0,
    elevationLoss: routeState.elevationLoss || 0,
    activeDataPoints: routeState.activeDataPoints.map((dataPoint) => ({
      ...dataPoint,
    })),
    routeFailure: routeState.routeFailure || null,
    segmentSpans: (routeState.segmentSpans || []).map((s) => ({ ...s })),
    routingValidation: routeState.routingValidation
      ? cloneJsonValue(routeState.routingValidation)
      : null,
  };
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function buildShareUrl(
  routeState,
  segmentsData,
  manager,
  location,
  cwBaseIndex = null,
) {
  return buildShareInfo(
    routeState,
    segmentsData,
    manager,
    location,
    cwBaseIndex,
  ).url;
}

export function buildShareInfo(
  routeState,
  segmentsData,
  manager,
  location,
  cwBaseIndex = null,
) {
  const hybridV6SharePayload = hybridRouteSharePayload(
    routeState,
    manager,
    cwBaseIndex,
    { compactCyclewaysChains: true },
  );
  const encodedHybridV6Route = hybridV6SharePayload
    ? encodeHybridRouteV6(hybridV6SharePayload)
    : "";
  if (encodedHybridV6Route) {
    return shareInfoFromEncodedRoute(
      encodedHybridV6Route,
      "hybrid_route_v6",
      location,
    );
  }

  const hybridSharePayload = hybridRouteSharePayload(
    routeState,
    manager,
    cwBaseIndex,
  );
  const encodedHybridRoute = hybridSharePayload
    ? encodeHybridRoute(hybridSharePayload)
    : "";
  if (encodedHybridRoute) {
    return shareInfoFromEncodedRoute(
      encodedHybridRoute,
      "hybrid_route_v5",
      location,
    );
  }

  const baseSharePayload = baseRouteSharePayload(routeState, manager);
  const encodedBaseRoute = baseSharePayload ? encodeBaseRoute(baseSharePayload) : "";
  if (encodedBaseRoute) {
    return shareInfoFromEncodedRoute(encodedBaseRoute, "base_route_v4", location);
  }

  const baseDiagnostics =
    typeof manager?.getBaseRouteDiagnostics === "function"
      ? manager.getBaseRouteDiagnostics()
      : null;
  const points = compactRoutePointsForSharing(
    routeState.points,
    routeState.selectedSegments,
    routeState.geometry,
    baseDiagnostics?.traversals?.length > 0 ? null : manager,
  );
  const segmentIds = getSegmentIds(routeState.selectedSegments, segmentsData);
  const encodedRoute = encodeCompactRoute(points, segmentIds);
  if (!encodedRoute) return emptyShareInfo();

  return shareInfoFromEncodedRoute(encodedRoute, "compact_route", location);
}

export function getSegmentIds(segmentNames, segmentsData) {
  return segmentNames
    .map((name) => Number(segmentsData?.[name]?.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export function getActiveRouteDataPoints(segmentNames, geometry, segmentsData) {
  if (!Array.isArray(segmentNames) || segmentNames.length === 0) return [];

  const active = [];
  const seen = new Set();

  segmentNames.forEach((segmentName) => {
    const segmentInfo = segmentsData?.[segmentName];
    const dataPoints = Array.isArray(segmentInfo?.data) ? segmentInfo.data : [];

    dataPoints.forEach((dataPoint, index) => {
      const stableId =
        typeof dataPoint.id === "string" && dataPoint.id.length > 0
          ? dataPoint.id
          : `${segmentName}-${index}`;
      if (seen.has(stableId)) return;

      const location = getDataPointLocation(dataPoint);
      let routeDistanceMeters = null;
      let routeProgressMeters = null;
      let routeFraction = null;
      if (location) {
        if (geometry.length < 2) return;
        const projection = projectPointToRouteGeometry(location, geometry);
        routeDistanceMeters =
          projection?.routeDistanceMeters ?? distanceToRouteGeometry(location, geometry);
        if (
          routeDistanceMeters > ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS
        ) {
          return;
        }
        routeProgressMeters = projection?.routeProgressMeters ?? null;
        routeFraction = projection?.routeFraction ?? null;
      }

      seen.add(stableId);
      active.push({
        ...dataPoint,
        id: stableId,
        segmentName,
        routeDistanceMeters,
        routeProgressMeters,
        routeFraction,
      });
    });
  });

  return active;
}

function emptyShareInfo() {
  return {
    url: "",
    format: null,
    length: 0,
    status: "unavailable",
    param: "",
  };
}

function isHybridRoutePayload(payload) {
  return payload?.type === "hybrid_route_v5" || payload?.type === "hybrid_route_v6";
}

function hasLngLat(point) {
  return Number.isFinite(Number(point?.lng)) && Number.isFinite(Number(point?.lat));
}

function shareInfoFromEncodedRoute(encodedRoute, format, location) {
  const url = new URL(location.href);
  url.searchParams.set("route", encodedRoute);
  const shareUrl = url.toString();
  return {
    url: shareUrl,
    format,
    length: shareUrl.length,
    status:
      shareUrl.length > ROUTE_SHARE_MAX_URL_LENGTH
        ? "too_long"
        : shareUrl.length > ROUTE_SHARE_WARN_URL_LENGTH
          ? "long"
          : "ok",
    param: encodedRoute,
  };
}

export function expandHybridRoutePayload(payload, cwBaseIndex) {
  if (!isHybridRoutePayload(payload)) return null;
  const points = Array.isArray(payload.routePoints) ? payload.routePoints : [];
  const spans = Array.isArray(payload.spans) ? payload.spans : [];
  if (points.length < 2 || spans.length !== points.length - 1) return null;

  const normalizedIndex = normalizeCwBaseIndex(cwBaseIndex);
  const legs = [];
  for (const [index, span] of spans.entries()) {
    if (span.type === "cw") {
      const leg = expandCyclewaysSpan(
        span,
        points[index],
        points[index + 1],
        normalizedIndex,
      );
      if (!leg) return null;
      legs.push({
        fromPoint: index,
        toPoint: index + 1,
        ...leg,
      });
      continue;
    }

    if (span.type === "cwChain") {
      const leg = expandCyclewaysChainSpan(span, normalizedIndex);
      if (!leg) return null;
      legs.push({
        fromPoint: index,
        toPoint: index + 1,
        ...leg,
      });
      continue;
    }

    const edgeShareIds = (Array.isArray(span.edgeShareIds)
      ? span.edgeShareIds
      : Array.isArray(span.edges)
        ? span.edges
        : [])
      .map((edgeShareId) => Number(edgeShareId))
      .filter((edgeShareId) => Number.isSafeInteger(edgeShareId) && edgeShareId > 0);
    if (edgeShareIds.length === 0) return null;
    const directions = normalizeDirections(span.directions, edgeShareIds.length);
    legs.push({
      fromPoint: index,
      toPoint: index + 1,
      edgeShareIds,
      directions,
    });
  }

  return {
    type: "base_route_v4",
    graphVersion: payload.graphVersion || "",
    routePoints: points,
    shards: Array.isArray(payload.shards) ? payload.shards : [],
    legs,
    segmentIds: [],
  };
}

function hybridRouteSharePayload(
  routeState,
  manager,
  cwBaseIndex,
  options = {},
) {
  if (
    !routeState ||
    !Array.isArray(routeState.points) ||
    routeState.points.length < 2 ||
    typeof manager?.getBaseRouteDiagnostics !== "function"
  ) {
    return null;
  }

  const normalizedIndex = normalizeCwBaseIndex(cwBaseIndex);
  if (normalizedIndex.size === 0) return null;

  const diagnostics = manager.getBaseRouteDiagnostics();
  const legs = Array.isArray(diagnostics?.legs) ? diagnostics.legs : [];
  if (diagnostics?.failure || legs.length !== routeState.points.length - 1) {
    return null;
  }

  const spanLegs = [];
  const shardIds = new Set();
  const baseLegs = legs.map((leg, index) => {
    const traversals = Array.isArray(leg?.traversals) ? leg.traversals : [];
    return {
      edgeShareIds: traversals.map((traversal) => traversal.edgeShareId),
      directions: traversals.map((traversal) =>
        traversal.direction === "reverse" ? "reverse" : "forward",
      ),
      fromPoint: index,
      toPoint: index + 1,
    };
  });
  for (const [legIndex, leg] of legs.entries()) {
    const traversals = Array.isArray(leg?.traversals) ? leg.traversals : [];
    if (traversals.length === 0) return null;
    for (const traversal of traversals) {
      const traversalShardIds = Array.isArray(traversal.shardIds)
        ? traversal.shardIds
        : [];
      if (traversalShardIds.length === 0) return null;
      traversalShardIds.forEach((shardId) => shardIds.add(String(shardId)));
    }

    const cyclewaysSpan = cyclewaysSpanForTraversals(
      traversals,
      normalizedIndex,
    );
    if (cyclewaysSpan) {
      spanLegs.push({
        startPoint: legIndex,
        endPoint: legIndex + 1,
        span: cyclewaysSpan,
      });
      continue;
    }

    const baseSpan = baseSpanForTraversals(traversals);
    if (!baseSpan) return null;
    const compactCyclewaysChainSpan = options.compactCyclewaysChains
      ? cyclewaysChainSpanForTraversals(
          traversals,
          normalizedIndex,
          baseSpan,
        )
      : null;
    spanLegs.push({
      startPoint: legIndex,
      endPoint: legIndex + 1,
      span: compactCyclewaysChainSpan || baseSpan,
    });
  }

  const mergedSpanLegs = mergeConsecutiveCyclewaysSpanLegs(spanLegs);
  const pointIndexes = [0, ...mergedSpanLegs.map((spanLeg) => spanLeg.endPoint)];
  const points = pointIndexes.map((pointIndex) =>
    sharePointForOriginalIndex(routeState.points, baseLegs, legs, pointIndex),
  );
  if (points.some((point) => point === null)) return null;

  return {
    version: 5,
    graphVersion: diagnostics.graphVersion || "",
    points,
    shards: [...shardIds].sort(),
    spans: mergedSpanLegs.map((spanLeg) => spanLeg.span),
  };
}

function baseRouteSharePayload(routeState, manager) {
  if (
    !routeState ||
    !Array.isArray(routeState.points) ||
    routeState.points.length < 2 ||
    typeof manager?.getBaseRouteDiagnostics !== "function"
  ) {
    return null;
  }

  const diagnostics = manager.getBaseRouteDiagnostics();
  const legs = Array.isArray(diagnostics?.legs) ? diagnostics.legs : [];
  if (diagnostics?.failure || legs.length !== routeState.points.length - 1) {
    return null;
  }

  const shareLegs = [];
  const shardIds = new Set();
  for (const [legIndex, leg] of legs.entries()) {
    const traversals = Array.isArray(leg?.traversals) ? leg.traversals : [];
    if (traversals.length === 0) return null;
    const edgeShareIds = [];
    const directions = [];
    for (const traversal of traversals) {
      const edgeShareId = Number(traversal.edgeShareId);
      if (!Number.isSafeInteger(edgeShareId) || edgeShareId <= 0) {
        return null;
      }
      const traversalShardIds = Array.isArray(traversal.shardIds)
        ? traversal.shardIds
        : [];
      if (traversalShardIds.length === 0) {
        return null;
      }
      traversalShardIds.forEach((shardId) => shardIds.add(String(shardId)));
      edgeShareIds.push(edgeShareId);
      directions.push(traversal.direction === "reverse" ? "reverse" : "forward");
    }
    shareLegs.push({
      fromPoint: legIndex,
      toPoint: legIndex + 1,
      edgeShareIds,
      directions,
    });
  }

  const points = routeState.points.map((point, index) => {
    const edgeShareId = routePointEdgeShareId(point, shareLegs, index);
    const edgeFraction = routePointEdgeFraction(point, legs, index);
    if (!Number.isSafeInteger(edgeShareId) || edgeShareId <= 0) {
      return null;
    }
    return {
      lng: point.lng,
      lat: point.lat,
      edgeShareId,
      edgeFraction,
    };
  });
  if (points.some((point) => point === null)) return null;

  return {
    version: 4,
    graphVersion: diagnostics.graphVersion || "",
    points,
    shards: [...shardIds].sort(),
    legs: shareLegs,
  };
}

function baseSpanForTraversals(traversals) {
  const edgeShareIds = [];
  const directions = [];
  for (const traversal of traversals) {
    const edgeShareId = Number(traversal.edgeShareId);
    if (!Number.isSafeInteger(edgeShareId) || edgeShareId <= 0) {
      return null;
    }
    edgeShareIds.push(edgeShareId);
    directions.push(traversal.direction === "reverse" ? "reverse" : "forward");
  }
  return {
    type: "base",
    edgeShareIds,
    directions,
  };
}

function cyclewaysSpanForTraversals(traversals, cwBaseIndex) {
  const segmentIds = new Set();
  for (const traversal of traversals) {
    const ids = Array.isArray(traversal.cyclewaysSegmentIds)
      ? traversal.cyclewaysSegmentIds
      : [];
    ids.map(Number)
      .filter((segmentId) => Number.isSafeInteger(segmentId) && segmentId > 0)
      .forEach((segmentId) => segmentIds.add(segmentId));
  }
  if (segmentIds.size !== 1) return null;

  const [segmentId] = [...segmentIds];
  const refs = cwBaseIndex.get(segmentId);
  if (!refs || refs.length === 0) return null;

  const indexes = traversals.map((traversal) =>
    refs.byShareId.get(Number(traversal.edgeShareId)),
  );
  if (indexes.some((index) => !Number.isSafeInteger(index))) return null;

  const firstIndex = indexes[0];
  const lastIndex = indexes[indexes.length - 1];
  let reversed = firstIndex > lastIndex;
  if (firstIndex === lastIndex) {
    const firstRef = refs.edgeRefs[firstIndex];
    reversed =
      normalizeDirection(traversals[0].direction) !==
      normalizeDirection(firstRef.direction);
  }

  const expectedIndexes = reversed
    ? descendingRange(firstIndex, lastIndex)
    : ascendingRange(firstIndex, lastIndex);
  if (!arraysEqual(indexes, expectedIndexes)) return null;

  for (const [index, traversal] of traversals.entries()) {
    const ref = refs.edgeRefs[indexes[index]];
    const expectedDirection = reversed
      ? oppositeDirection(ref.direction)
      : normalizeDirection(ref.direction);
    if (normalizeDirection(traversal.direction) !== expectedDirection) {
      return null;
    }
  }

  return {
    type: "cw",
    segmentId,
    reversed,
  };
}

function cyclewaysChainSpanForTraversals(traversals, cwBaseIndex, baseSpan) {
  if (!baseSpan || !Array.isArray(traversals) || traversals.length === 0) {
    return null;
  }

  const chosenRefs = [];
  let previousChoice = null;
  for (const traversal of traversals) {
    const candidates = cyclewaysRefCandidatesForTraversal(
      traversal,
      cwBaseIndex,
    );
    if (candidates.length === 0) return null;

    const continuingCandidate = previousChoice
      ? candidates.find(
          (candidate) =>
            candidate.segmentId === previousChoice.segmentId &&
            candidate.reversed === previousChoice.reversed &&
            candidate.index ===
              previousChoice.index + (previousChoice.reversed ? -1 : 1),
        )
      : null;
    const selected = continuingCandidate || candidates[0];
    chosenRefs.push(selected);
    previousChoice = selected;
  }

  const runs = [];
  for (const choice of chosenRefs) {
    const previousRun = runs[runs.length - 1];
    if (
      previousRun &&
      previousRun.segmentId === choice.segmentId &&
      previousRun.reversed === choice.reversed &&
      choice.index ===
        previousRun.startIndex +
          (previousRun.reversed ? -previousRun.edgeCount : previousRun.edgeCount)
    ) {
      previousRun.edgeCount += 1;
      continue;
    }
    runs.push({
      segmentId: choice.segmentId,
      reversed: choice.reversed,
      startIndex: choice.index,
      edgeCount: 1,
    });
  }

  const span = { type: "cwChain", runs };
  const expandedSpan = expandCyclewaysChainSpan(span, cwBaseIndex);
  if (
    !expandedSpan ||
    !arraysEqual(expandedSpan.edgeShareIds, baseSpan.edgeShareIds) ||
    !arraysEqual(expandedSpan.directions, baseSpan.directions)
  ) {
    return null;
  }

  return estimateV6CyclewaysChainSpanBytes(span) <
    estimateV6BaseSpanBytes(baseSpan)
    ? span
    : null;
}

function cyclewaysRefCandidatesForTraversal(traversal, cwBaseIndex) {
  const edgeShareId = Number(traversal?.edgeShareId);
  const traversalDirection = normalizeDirection(traversal?.direction);
  if (!Number.isSafeInteger(edgeShareId) || edgeShareId <= 0) {
    return [];
  }

  return (Array.isArray(traversal?.cyclewaysSegmentIds)
    ? traversal.cyclewaysSegmentIds
    : []
  )
    .map(Number)
    .filter((segmentId) => Number.isSafeInteger(segmentId) && segmentId > 0)
    .flatMap((segmentId) => {
      const refs = cwBaseIndex.get(segmentId);
      const index = refs?.byShareId?.get(edgeShareId);
      if (!refs || !Number.isSafeInteger(index)) return [];
      const refDirection = normalizeDirection(refs.edgeRefs[index]?.direction);
      const candidates = [];
      if (traversalDirection === refDirection) {
        candidates.push({ segmentId, index, reversed: false });
      }
      if (traversalDirection === oppositeDirection(refDirection)) {
        candidates.push({ segmentId, index, reversed: true });
      }
      return candidates;
    });
}

function mergeConsecutiveCyclewaysSpanLegs(spanLegs) {
  const merged = [];
  for (const spanLeg of spanLegs) {
    const previous = merged[merged.length - 1];
    if (
      previous?.span?.type === "cw" &&
      spanLeg.span?.type === "cw" &&
      previous.span.segmentId === spanLeg.span.segmentId &&
      previous.span.reversed === spanLeg.span.reversed &&
      previous.endPoint === spanLeg.startPoint
    ) {
      previous.endPoint = spanLeg.endPoint;
      continue;
    }
    merged.push({
      startPoint: spanLeg.startPoint,
      endPoint: spanLeg.endPoint,
      span: { ...spanLeg.span },
    });
  }
  return merged;
}

function sharePointForOriginalIndex(points, baseLegs, diagnosticLegs, index) {
  const point = points[index];
  if (!point) return null;
  const edgeShareId = routePointEdgeShareId(point, baseLegs, index);
  const edgeFraction = routePointEdgeFraction(point, diagnosticLegs, index);
  if (!Number.isSafeInteger(edgeShareId) || edgeShareId <= 0) {
    return null;
  }
  return {
    lng: point.lng,
    lat: point.lat,
    edgeShareId,
    edgeFraction,
  };
}

function expandCyclewaysSpan(span, startPoint, endPoint, cwBaseIndex) {
  const segmentId = Number(span.segmentId);
  const refs = cwBaseIndex.get(segmentId);
  if (!refs || refs.length === 0) return null;
  const startEdgeShareId = Number(
    startPoint?.baseEdgeShareId ?? startPoint?.edgeShareId,
  );
  const endEdgeShareId = Number(
    endPoint?.baseEdgeShareId ?? endPoint?.edgeShareId,
  );
  const startIndex = refs.byShareId.get(startEdgeShareId);
  const endIndex = refs.byShareId.get(endEdgeShareId);
  if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex)) {
    return null;
  }

  const indexes = span.reversed
    ? descendingRange(startIndex, endIndex)
    : ascendingRange(startIndex, endIndex);
  if (indexes.length === 0) return null;

  return {
    edgeShareIds: indexes.map((index) => refs.edgeRefs[index].shareId),
    directions: indexes.map((index) => {
      const direction = refs.edgeRefs[index].direction;
      return span.reversed ? oppositeDirection(direction) : normalizeDirection(direction);
    }),
  };
}

function expandCyclewaysChainSpan(span, cwBaseIndex) {
  const edgeShareIds = [];
  const directions = [];
  for (const run of Array.isArray(span?.runs) ? span.runs : []) {
    const segmentId = Number(run.segmentId);
    const refs = cwBaseIndex.get(segmentId);
    const startIndex = Number(run.startIndex);
    const edgeCount = Number(run.edgeCount);
    if (
      !refs ||
      !Number.isSafeInteger(startIndex) ||
      !Number.isSafeInteger(edgeCount) ||
      edgeCount <= 0
    ) {
      return null;
    }

    for (let offset = 0; offset < edgeCount; offset++) {
      const index = run.reversed ? startIndex - offset : startIndex + offset;
      const ref = refs.edgeRefs[index];
      if (!ref) return null;
      edgeShareIds.push(ref.shareId);
      directions.push(
        run.reversed
          ? oppositeDirection(ref.direction)
          : normalizeDirection(ref.direction),
      );
    }
  }

  return edgeShareIds.length > 0 ? { edgeShareIds, directions } : null;
}

function normalizeCwBaseIndex(cwBaseIndex) {
  const normalized = new Map();
  const rawSegments = cwBaseIndex?.segments;
  if (!rawSegments || typeof rawSegments !== "object") return normalized;

  for (const [segmentKey, segment] of Object.entries(rawSegments)) {
    const segmentId = Number(segment?.segmentId ?? segmentKey);
    const rawEdgeRefs = Array.isArray(segment)
      ? segment
      : Array.isArray(segment?.edgeRefs)
      ? segment.edgeRefs
      : [];
    const edgeRefs = rawEdgeRefs
      .map((edgeRef, index) => {
        if (Array.isArray(edgeRef)) {
          return {
            shareId: Number(edgeRef[0]),
            direction: Number(edgeRef[1]) === 1 ? "reverse" : "forward",
            sequenceIndex: index,
          };
        }
        return {
          shareId: Number(edgeRef?.shareId ?? edgeRef?.edgeShareId),
          direction: normalizeDirection(edgeRef?.direction),
          sequenceIndex: Number(edgeRef?.sequenceIndex),
        };
      })
      .filter((edgeRef) => Number.isSafeInteger(edgeRef.shareId) && edgeRef.shareId > 0)
      .sort((first, second) => {
        const firstIndex = Number.isFinite(first.sequenceIndex)
          ? first.sequenceIndex
          : 0;
        const secondIndex = Number.isFinite(second.sequenceIndex)
          ? second.sequenceIndex
          : 0;
        return firstIndex - secondIndex;
      });
    if (!Number.isSafeInteger(segmentId) || segmentId <= 0 || edgeRefs.length === 0) {
      continue;
    }
    normalized.set(segmentId, {
      edgeRefs,
      byShareId: new Map(
        edgeRefs.map((edgeRef, index) => [edgeRef.shareId, index]),
      ),
      length: edgeRefs.length,
    });
  }
  return normalized;
}

function normalizeDirections(directions, count) {
  const normalized = (Array.isArray(directions) ? directions : [])
    .slice(0, count)
    .map(normalizeDirection);
  while (normalized.length < count) {
    normalized.push("forward");
  }
  return normalized;
}

function normalizeDirection(direction) {
  return direction === "reverse" || direction === 1 ? "reverse" : "forward";
}

function oppositeDirection(direction) {
  return normalizeDirection(direction) === "reverse" ? "forward" : "reverse";
}

function estimateV6BaseSpanBytes(span) {
  const edgeShareIds = Array.isArray(span?.edgeShareIds)
    ? span.edgeShareIds
    : [];
  if (edgeShareIds.length === 0) return Infinity;

  let bytes = 1 + varUintByteLength(edgeShareIds.length);
  let previousEdgeShareId = 0;
  edgeShareIds.forEach((edgeShareId, index) => {
    bytes +=
      index === 0
        ? varUintByteLength(edgeShareId)
        : signedVarintByteLength(edgeShareId - previousEdgeShareId);
    previousEdgeShareId = edgeShareId;
  });
  bytes += Math.ceil(edgeShareIds.length / 8);
  return bytes;
}

function estimateV6CyclewaysChainSpanBytes(span) {
  const runs = Array.isArray(span?.runs) ? span.runs : [];
  if (runs.length === 0) return Infinity;
  return runs.reduce(
    (bytes, run) =>
      bytes +
      varUintByteLength(run.segmentId) +
      1 +
      varUintByteLength(run.startIndex) +
      varUintByteLength(run.edgeCount),
    1 + varUintByteLength(runs.length),
  );
}

function varUintByteLength(value) {
  let remaining = Number(value);
  if (!Number.isSafeInteger(remaining) || remaining < 0) return Infinity;
  let bytes = 1;
  while (remaining >= 0x80) {
    remaining = Math.floor(remaining / 128);
    bytes += 1;
  }
  return bytes;
}

function signedVarintByteLength(value) {
  const encoded = value >= 0 ? value * 2 : -value * 2 - 1;
  return varUintByteLength(encoded);
}

function ascendingRange(start, end) {
  if (start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function descendingRange(start, end) {
  if (start < end) return [];
  return Array.from({ length: start - end + 1 }, (_, index) => start - index);
}

function routePointEdgeShareId(point, shareLegs, index) {
  const direct = Number(point?.baseEdgeShareId ?? point?.edgeShareId);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  if (index === 0) return shareLegs[0]?.edgeShareIds?.[0] || null;
  const previousLeg = shareLegs[index - 1];
  return previousLeg?.edgeShareIds?.[previousLeg.edgeShareIds.length - 1] || null;
}

function routePointEdgeFraction(point, diagnosticLegs, index) {
  const direct = Number(point?.baseEdgeFraction ?? point?.edgeFraction);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(1, direct));
  if (index === 0) {
    return diagnosticLegs[0]?.traversals?.[0]?.fromFraction ?? 0;
  }
  const previousLeg = diagnosticLegs[index - 1];
  return previousLeg?.traversals?.[previousLeg.traversals.length - 1]?.toFraction ?? 0;
}

function compactRoutePointsForSharing(points, targetSegments, targetGeometry, manager) {
  if (!manager || !Array.isArray(points) || points.length <= 2) {
    return Array.isArray(points) ? points : [];
  }

  let compactPoints = points.map((point) => ({ ...point }));
  let removedPoint = true;

  while (removedPoint) {
    removedPoint = false;

    for (let index = 1; index < compactPoints.length - 1; index++) {
      const candidatePoints = [
        ...compactPoints.slice(0, index),
        ...compactPoints.slice(index + 1),
      ];

      if (
        routePreviewMatchesTarget(
          manager,
          candidatePoints,
          targetSegments,
          targetGeometry,
        )
      ) {
        compactPoints = candidatePoints;
        removedPoint = true;
        break;
      }
    }
  }

  return compactPoints;
}

function routePreviewMatchesTarget(
  manager,
  candidatePoints,
  targetSegments,
  targetGeometry,
) {
  if (typeof manager.previewRouteInfo !== "function") {
    return false;
  }

  const preview = manager.previewRouteInfo(candidatePoints);
  if (!arraysEqual(preview.segments, targetSegments)) {
    return false;
  }

  if (targetGeometry.length >= 2 && preview.orderedCoordinates.length >= 2) {
    const targetDistance = calculateCoordinatesDistance(targetGeometry);
    const previewDistance = calculateCoordinatesDistance(
      preview.orderedCoordinates,
    );

    if (Math.abs(targetDistance - previewDistance) > 5) {
      return false;
    }

    const targetStart = targetGeometry[0];
    const targetEnd = targetGeometry[targetGeometry.length - 1];
    const previewStart = preview.orderedCoordinates[0];
    const previewEnd =
      preview.orderedCoordinates[preview.orderedCoordinates.length - 1];

    if (
      getDistance(targetStart, previewStart) > 2 ||
      getDistance(targetEnd, previewEnd) > 2
    ) {
      return false;
    }
  }

  return true;
}

function calculateCoordinatesDistance(coordinates) {
  let distance = 0;
  for (let index = 0; index < coordinates.length - 1; index++) {
    distance += getDistance(coordinates[index], coordinates[index + 1]);
  }
  return distance;
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
