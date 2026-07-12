import { getDistance } from "../utils/distance.js";
import { DEFAULT_CONNECTOR_THRESHOLDS } from "../routing/connectorConfidence.js";
import {
  CONNECTOR_NEAR_RADIUS_M,
  JOIN_SKIP_PROMPT_M,
  projectOntoRoute,
} from "./connectorTargeting.js";
import {
  buildEffectiveNavigationRoute,
  reverseNavigationRoute,
  splitGeometryAtProgress,
} from "./effectiveNavigationRoute.js";

export const SETUP_FIX_MAX_AGE_MS = 30_000;
export const SETUP_FIX_MAX_ACCURACY_M = 100;
export const TRIVIAL_JOIN_SKIP_M = 50;
export const SETUP_AT_BASE_RADIUS_M = 30;

export function setupLocationQuality(fix, now = Date.now()) {
  if (!fix || !Number.isFinite(Number(fix.lat)) || !Number.isFinite(Number(fix.lng))) {
    return "unavailable";
  }
  const timestamp = Number(fix.timestamp);
  if (!Number.isFinite(timestamp) || now - timestamp > SETUP_FIX_MAX_AGE_MS) {
    return "stale";
  }
  const accuracy = Number(fix.accuracy);
  if (!Number.isFinite(accuracy) || accuracy > SETUP_FIX_MAX_ACCURACY_M) {
    return "inaccurate";
  }
  return "fresh";
}

export function classifyApproach(distanceMeters, accuracyMeters = 0) {
  if (distanceMeters === null || distanceMeters === undefined || distanceMeters === "") {
    return "unknown";
  }
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance) || distance < 0) return "unknown";
  const accuracy = Math.max(0, Number(accuracyMeters) || 0);
  if (distance <= SETUP_AT_BASE_RADIUS_M + accuracy) return "at";
  return distance <= CONNECTOR_NEAR_RADIUS_M ? "near" : "far";
}

export function ridePlanNeedsConnectorPreview(plan) {
  return ridePlanApproachPreviewKind(plan) === "connector";
}

export function ridePlanNeedsDirectApproachPreview(plan) {
  return ridePlanApproachPreviewKind(plan) === "direct";
}

export function ridePlanApproachPreviewKind(plan) {
  const distance = Number(plan?.distanceToStartMeters);
  if (
    !plan?.selectedPoint ||
    !Number.isFinite(distance) ||
    distance < 0 ||
    plan.approachTier === "at"
  ) return "none";
  if (distance > DEFAULT_CONNECTOR_THRESHOLDS.tooFarRadiusMeters) {
    return "direct";
  }
  return "connector";
}

export function buildRidePlanCandidates(sourceRoute, fix, direction = "forward") {
  const directional = direction === "reverse"
    ? reverseNavigationRoute(sourceRoute)
    : sourceRoute;
  const geometry = Array.isArray(directional?.geometry) ? directional.geometry : [];
  if (geometry.length < 2) return null;
  const officialPoint = { lat: geometry[0].lat, lng: geometry[0].lng };
  const location = fix && Number.isFinite(Number(fix.lat)) && Number.isFinite(Number(fix.lng))
    ? { lat: Number(fix.lat), lng: Number(fix.lng) }
    : null;
  const nearestProjection = location ? projectOntoRoute(geometry, location) : null;
  const official = {
    mode: "official",
    point: officialPoint,
    progressMeters: 0,
    distanceMeters: location ? getDistance(location, officialPoint) : null,
  };
  const nearest = nearestProjection
    ? {
        mode: "nearest",
        point: nearestProjection.point,
        progressMeters: nearestProjection.progressMeters,
        distanceMeters: getDistance(location, nearestProjection.point),
      }
    : null;
  return {
    direction: direction === "reverse" ? "reverse" : "forward",
    official,
    nearest,
    nearestIsMeaningful: Boolean(nearest && nearest.progressMeters > TRIVIAL_JOIN_SKIP_M),
    nearestRequiresConfirmation: Boolean(nearest && nearest.progressMeters >= JOIN_SKIP_PROMPT_M),
  };
}

export function createRidePlan(sourceRoute, selection = {}, fix = null, now = Date.now()) {
  const reverseAllowed = sourceRoute?.routeShape?.type !== "one_way";
  const direction = selection.direction === "reverse" && reverseAllowed
    ? "reverse"
    : "forward";
  const candidates = buildRidePlanCandidates(sourceRoute, fix, direction);
  if (!candidates) return null;
  const quality = setupLocationQuality(fix, now);
  const requestedMode = selection.startMode || "official";
  let chosen = candidates.official;
  const restoredProgressValue = selection.startProgressMeters;
  const hasRestoredProgress =
    restoredProgressValue !== null &&
    restoredProgressValue !== undefined &&
    restoredProgressValue !== "";
  const restoredProgress = Number(restoredProgressValue);
  if (
    (requestedMode === "nearest" || requestedMode === "custom") &&
    hasRestoredProgress &&
    Number.isFinite(restoredProgress) &&
    restoredProgress >= 0
  ) {
    const directional = direction === "reverse"
      ? reverseNavigationRoute(sourceRoute)
      : sourceRoute;
    const split = splitGeometryAtProgress(directional.geometry, restoredProgress);
    if (split) {
      chosen = {
        mode: requestedMode,
        point: split.point,
        progressMeters: split.progressMeters,
        distanceMeters:
          fix && Number.isFinite(Number(fix.lat)) && Number.isFinite(Number(fix.lng))
            ? getDistance(fix, split.point)
            : null,
      };
    }
  } else if (requestedMode === "nearest" && quality === "fresh" && candidates.nearest) {
    chosen = candidates.nearest;
  } else if (requestedMode === "custom" && selection.selectedPoint) {
    const directional = direction === "reverse"
      ? reverseNavigationRoute(sourceRoute)
      : sourceRoute;
    const projection = projectOntoRoute(directional.geometry, selection.selectedPoint);
    if (projection) {
      chosen = {
        mode: "custom",
        point: projection.point,
        progressMeters: projection.progressMeters,
        distanceMeters:
          fix && Number.isFinite(Number(fix.lat)) && Number.isFinite(Number(fix.lng))
            ? getDistance(fix, projection.point)
            : null,
      };
    }
  }
  const effectiveRoute = buildEffectiveNavigationRoute(sourceRoute, {
    direction,
    reverseAllowed,
    startMode: chosen.mode,
    startProgressMeters: chosen.progressMeters,
  });
  return {
    direction,
    reverseAllowed,
    startMode: chosen.mode,
    startProgressMeters: chosen.progressMeters,
    selectedPoint: chosen.point,
    distanceToStartMeters: chosen.distanceMeters,
    skippedMeters: effectiveRoute.isEffectiveLoop ? 0 : chosen.progressMeters,
    guidedDistanceMeters: effectiveRoute.distanceMeters,
    requiresSkipConfirmation:
      chosen.mode !== "official" && chosen.progressMeters >= JOIN_SKIP_PROMPT_M,
    locationQuality: quality,
    approachTier:
      quality === "fresh"
        ? classifyApproach(chosen.distanceMeters, fix?.accuracy)
        : "unknown",
    candidates,
    effectiveRoute,
  };
}
