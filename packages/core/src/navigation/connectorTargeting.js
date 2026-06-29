import { getDistance } from "../utils/distance.js";
import { projectToSegment } from "./routeProgress.js";

export const APPROACH_NEAREST_MARGIN_M = 300;
export const REJOIN_FORWARD_WINDOW_M = 1500;
export const CONNECTOR_MAX_DISTANCE_M = 8000;
export const RECOMPUTE_MIN_MS = 5000;
export const RECOMPUTE_MIN_MOVE_M = 30;
export const TRANSIENT_RETRY_BASE_MS = 4000;
export const HANDOFF_RADIUS_M = 25;
export const HANDOFF_ACCURACY_FACTOR = 1;
export const HANDOFF_MAX_ACCURACY_M = 30;

function pointAtFraction(a, b, fraction) {
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
}

export function projectOntoRoute(
  geometry,
  fix,
  { minProgressMeters = -Infinity, maxProgressMeters = Infinity } = {},
) {
  if (!Array.isArray(geometry) || geometry.length < 2 || !fix) return null;
  let best = null;
  for (let index = 0; index < geometry.length - 1; index++) {
    const a = geometry[index];
    const b = geometry[index + 1];
    const startMeters = Number(a.distanceFromStartMeters);
    const endMeters = Number(b.distanceFromStartMeters);
    const legMeters = endMeters - startMeters;
    if (!Number.isFinite(startMeters) || !Number.isFinite(endMeters) || legMeters <= 0) {
      continue;
    }
    const allowedStart = Math.max(startMeters, minProgressMeters);
    const allowedEnd = Math.min(endMeters, maxProgressMeters);
    if (allowedEnd < allowedStart) continue;

    const startT = Math.max(0, Math.min(1, (allowedStart - startMeters) / legMeters));
    const endT = Math.max(0, Math.min(1, (allowedEnd - startMeters) / legMeters));
    const clippedA = pointAtFraction(a, b, startT);
    const clippedB = pointAtFraction(a, b, endT);
    const projection = projectToSegment(fix, clippedA, clippedB);
    const progressMeters = allowedStart + projection.t * (allowedEnd - allowedStart);
    if (best === null || projection.crossTrackMeters < best.crossTrackMeters) {
      best = {
        point: projection.snapped,
        progressMeters,
        crossTrackMeters: projection.crossTrackMeters,
      };
    }
  }
  return best;
}

export function selectConnectorTarget(
  navigationRoute,
  fix,
  { mode, lastConfirmedProgressMeters = 0 } = {},
) {
  const geometry = Array.isArray(navigationRoute?.geometry)
    ? navigationRoute.geometry
    : [];
  if (geometry.length < 2 || !fix) return null;

  if (mode === "rejoin") {
    const min = Math.max(0, Number(lastConfirmedProgressMeters) || 0);
    const projection = projectOntoRoute(geometry, fix, {
      minProgressMeters: min,
      maxProgressMeters: min + REJOIN_FORWARD_WINDOW_M,
    });
    return projection
      ? { point: projection.point, mainProgressMeters: projection.progressMeters }
      : null;
  }

  const start = geometry[0];
  const nearest = projectOntoRoute(geometry, fix);
  if (!nearest) return null;
  const distanceToStart = getDistance(fix, start);
  if (nearest.crossTrackMeters < distanceToStart - APPROACH_NEAREST_MARGIN_M) {
    return { point: nearest.point, mainProgressMeters: nearest.progressMeters };
  }
  return {
    point: { lat: start.lat, lng: start.lng },
    mainProgressMeters: 0,
  };
}

export const CONNECTOR_NEAR_RADIUS_M = 1000;
export const JOIN_SKIP_PROMPT_M = 1500;

export function approachTargetChoices(navigationRoute, fix) {
  const geometry = Array.isArray(navigationRoute?.geometry) ? navigationRoute.geometry : [];
  if (geometry.length < 2 || !fix) return null;
  const startVertex = geometry[0];
  const start = {
    point: { lat: startVertex.lat, lng: startVertex.lng },
    mainProgressMeters: 0,
    distanceMeters: getDistance(fix, startVertex),
  };
  const projection = projectOntoRoute(geometry, fix);
  if (!projection) return null;
  const nearest = {
    point: projection.point,
    mainProgressMeters: projection.progressMeters,
    distanceMeters: getDistance(fix, projection.point),
  };
  const skipMeters = Math.max(0, projection.progressMeters);
  return { start, nearest, skipMeters, shouldPrompt: skipMeters >= JOIN_SKIP_PROMPT_M };
}

export function connectorWithinCap(distanceMeters) {
  const distance = Number(distanceMeters);
  return Number.isFinite(distance) && distance > 0 && distance <= CONNECTOR_MAX_DISTANCE_M;
}
