import {
  buildCumulativeDistances,
  nearestPointOnPolyline,
  pointAtFraction,
} from "./routeGeometry.js";

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function clampTime(value, duration) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(duration, number));
}

export function createLinearRoutePlaybackSync({
  durationSeconds,
  routeGeometry,
}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("route playback duration must be a positive number");
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("route playback geometry must have at least 2 points");
  }

  const cumulative = buildCumulativeDistances(routeGeometry);

  function timeToPosition(timeSeconds) {
    const t = clampTime(timeSeconds, duration);
    const fraction = duration > 0 ? t / duration : 0;
    return pointAtFraction(routeGeometry, cumulative, fraction);
  }

  function positionToTime(routeFraction) {
    return clamp01(routeFraction) * duration;
  }

  function snapClickToRoute(latLng, maxMeters = 80) {
    const snap = nearestPointOnPolyline(latLng, routeGeometry, cumulative);
    if (snap.distanceMeters > maxMeters) return null;
    const position = pointAtFraction(routeGeometry, cumulative, snap.fraction);
    return {
      lat: position.lat,
      lng: position.lng,
      fraction: snap.fraction,
      distanceMeters: snap.distanceMeters,
    };
  }

  return {
    durationSeconds: duration,
    timeToPosition,
    positionToTime,
    snapClickToRoute,
  };
}
