import { getDistance } from "../../utils/distance.js";
import {
  decodeRoutePayload,
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
  const points = routePointsFromParam(routeParam, segmentsData);
  return points ? restoreRoute(manager, points, segmentsData) : null;
}

export function routePointsFromParam(routeParam, segmentsData) {
  const payload = decodeRoutePayload(routeParam);

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
  const points = compactRoutePointsForSharing(
    routeState.points,
    routeState.selectedSegments,
    routeState.geometry,
    manager,
  );
  const segmentIds = getSegmentIds(routeState.selectedSegments, segmentsData);
  const encodedRoute = encodeCompactRoute(points, segmentIds);
  if (!encodedRoute) return "";

  const url = new URL(location.href);
  url.searchParams.set("route", encodedRoute);
  return url.toString();
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
