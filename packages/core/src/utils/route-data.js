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

export function isDataPointOnRoute(
  dataPoint,
  routeCoordinates,
  thresholdMeters = ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
) {
  const location = getDataPointLocation(dataPoint);
  if (!location) return true;

  return distanceToRouteGeometry(location, routeCoordinates) <= thresholdMeters;
}
