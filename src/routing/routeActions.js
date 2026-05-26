import { getDistance } from "../../utils/distance.js";
import {
  decodeRoutePayload,
  encodeBaseRoute,
  encodeCompactRoute,
  extractMiddlePoints,
} from "../../utils/route-encoding.js";
import {
  distanceToRouteGeometry,
  getDataPointLocation,
  ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
} from "../../utils/route-data.js";

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

export function restoreRouteFromParam(manager, routeParam, segmentsData) {
  const payload = decodeRoutePayload(routeParam);
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
    activeDataPoints: getActiveRouteDataPoints(
      info.segments,
      geometry,
      segmentsData,
    ),
  };
}

export function emptyRouteSnapshot() {
  return {
    points: [],
    selectedSegments: [],
    geometry: [],
    distance: 0,
    elevationGain: 0,
    elevationLoss: 0,
    activeDataPoints: [],
    routeFailure: null,
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
  };
}

export function buildShareUrl(routeState, segmentsData, manager, location) {
  return buildShareInfo(routeState, segmentsData, manager, location).url;
}

export function buildShareInfo(routeState, segmentsData, manager, location) {
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

function getActiveRouteDataPoints(segmentNames, geometry, segmentsData) {
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
      if (location) {
        if (geometry.length < 2) return;
        routeDistanceMeters = distanceToRouteGeometry(location, geometry);
        if (
          routeDistanceMeters > ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS
        ) {
          return;
        }
      }

      seen.add(stableId);
      active.push({
        ...dataPoint,
        id: stableId,
        segmentName,
        routeDistanceMeters,
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
  };
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
