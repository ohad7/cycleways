import { distanceToLineSegment, getDistance } from "./distance.js";

export const ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS = 50;

export function getDataPointLocation(dataPoint) {
  if (
    dataPoint?.location &&
    Array.isArray(dataPoint.location) &&
    dataPoint.location.length >= 2
  ) {
    const lat = Number(dataPoint.location[0]);
    const lng = Number(dataPoint.location[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

export function distanceToRouteGeometry(point, routeCoordinates) {
  if (!point || !Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
    return Infinity;
  }

  if (routeCoordinates.length === 1) {
    return getDistance(point, routeCoordinates[0]);
  }

  let minDistance = Infinity;
  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const distance = distanceToLineSegment(
      point,
      routeCoordinates[i],
      routeCoordinates[i + 1],
    );
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}

export function projectPointToRouteGeometry(point, routeCoordinates) {
  if (!point || !Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
    return null;
  }

  if (routeCoordinates.length === 1) {
    return {
      routeProgressMeters: 0,
      routeFraction: 0,
      routeDistanceMeters: getDistance(point, routeCoordinates[0]),
      routeLengthMeters: 0,
    };
  }

  const segmentLengths = [];
  let routeLengthMeters = 0;
  for (let index = 0; index < routeCoordinates.length - 1; index++) {
    const length = getDistance(routeCoordinates[index], routeCoordinates[index + 1]);
    segmentLengths.push(length);
    routeLengthMeters += length;
  }

  let best = null;
  let progressBeforeSegment = 0;

  for (let index = 0; index < routeCoordinates.length - 1; index++) {
    const start = routeCoordinates[index];
    const end = routeCoordinates[index + 1];
    const dx = end.lng - start.lng;
    const dy = end.lat - start.lat;
    const lenSq = dx * dx + dy * dy;
    const rawT =
      lenSq === 0
        ? 0
        : ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / lenSq;
    const t = Math.max(0, Math.min(1, rawT));
    const projected = {
      lat: start.lat + t * dy,
      lng: start.lng + t * dx,
    };
    const routeDistanceMeters = getDistance(point, projected);
    const routeProgressMeters = progressBeforeSegment + segmentLengths[index] * t;

    if (!best || routeDistanceMeters < best.routeDistanceMeters) {
      best = {
        projected,
        routeProgressMeters,
        routeDistanceMeters,
      };
    }

    progressBeforeSegment += segmentLengths[index];
  }

  if (!best) return null;

  return {
    ...best,
    routeFraction:
      routeLengthMeters > 0 ? best.routeProgressMeters / routeLengthMeters : 0,
    routeLengthMeters,
  };
}

export function isDataPointOnRoute(
  dataPoint,
  routeCoordinates,
  thresholdMeters = ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
) {
  const location = getDataPointLocation(dataPoint);
  if (!location) return true;

  return distanceToRouteGeometry(location, routeCoordinates) <= thresholdMeters;
}
