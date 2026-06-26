import {
  routeShapeType,
  routeSurfaceType,
} from "../data/catalog.js";
import { getDistance } from "../utils/distance.js";

const DEFAULT_BUILT_ROUTE_NAME = "My route";

export function navigationRouteFromRouteState(
  routeState,
  shareInfo = {},
  metadata = {},
) {
  return createNavigationRoute({
    source: metadata.source || "built",
    routeState,
    routeParam: shareInfo?.param || metadata.routeParam || "",
    routeFormat: shareInfo?.format || metadata.routeFormat || null,
    metadata: {
      ...metadata,
      name: metadata.name || DEFAULT_BUILT_ROUTE_NAME,
    },
  });
}

export function navigationRouteFromCatalogEntry(entry, restoredRouteState) {
  return createNavigationRoute({
    source: "catalog",
    routeState: restoredRouteState,
    routeParam: entry?.route || "",
    routeFormat: entry?.routeFormat || null,
    metadata: {
      slug: entry?.slug || "",
      name: entry?.name || "",
      summary: entry?.summary || "",
      featured: entry?.featured === true,
      difficulty: entry?.difficulty || "",
      surfaceType: routeSurfaceType(entry),
      routeShape: normalizedRouteShape(entry),
      distanceKm: finiteNumberOrNull(entry?.distanceKm),
      elevationGainM: finiteNumberOrNull(entry?.elevationGainM),
      elevationLossM: finiteNumberOrNull(entry?.elevationLossM),
      start: entry?.start || null,
      end: entry?.end || null,
      regionId: entry?.regionId || "",
      startPlaceIds: arrayOfStrings(entry?.startPlaceIds),
      passesNear: arrayOfStrings(entry?.passesNear),
    },
  });
}

function createNavigationRoute({
  source,
  routeState,
  routeParam,
  routeFormat,
  metadata,
}) {
  const points = clonePointList(routeState?.points);
  const selectedSegments = arrayOfStrings(routeState?.selectedSegments);
  const geometry = buildNavigationGeometry(routeState?.geometry);
  const computedDistance = geometry.length > 0
    ? geometry[geometry.length - 1].distanceFromStartMeters
    : 0;
  const distanceMeters =
    finiteNonNegative(routeState?.distance) || computedDistance;
  const routeFailure = routeState?.routeFailure || null;
  const status = navigationRouteStatus({ points, geometry, routeFailure });
  const segmentRefs = selectedSegments.map((name) => ({
    name,
    id: segmentIdForName(name, metadata?.segmentsData),
  }));

  return {
    id: navigationRouteId(source, routeParam, metadata?.slug),
    source,
    canNavigate: status.reason === null,
    unavailableReason: status.reason,
    routeParam: routeParam || "",
    routeFormat: routeFormat || null,
    slug: metadata?.slug || "",
    name: metadata?.name || "",
    summary: metadata?.summary || "",
    featured: metadata?.featured === true,
    difficulty: metadata?.difficulty || "",
    surfaceType: metadata?.surfaceType || null,
    routeShape: metadata?.routeShape || null,
    distanceMeters,
    distanceKm: roundDistanceKm(distanceMeters),
    elevationGainM: finiteNonNegative(routeState?.elevationGain),
    elevationLossM: finiteNonNegative(routeState?.elevationLoss),
    catalogDistanceKm: finiteNumberOrNull(metadata?.distanceKm),
    catalogElevationGainM: finiteNumberOrNull(metadata?.elevationGainM),
    catalogElevationLossM: finiteNumberOrNull(metadata?.elevationLossM),
    points,
    geometry,
    selectedSegments: segmentRefs,
    selectedSegmentNames: selectedSegments,
    activeDataPoints: cloneDataPointList(routeState?.activeDataPoints),
    routeFailure,
    start: metadata?.start || null,
    end: metadata?.end || null,
    regionId: metadata?.regionId || "",
    startPlaceIds: arrayOfStrings(metadata?.startPlaceIds),
    passesNear: arrayOfStrings(metadata?.passesNear),
  };
}

function navigationRouteStatus({ points, geometry, routeFailure }) {
  if (routeFailure || (points.length >= 2 && geometry.length < 2)) {
    return { reason: "broken-route" };
  }
  if (geometry.length < 2) {
    return { reason: "empty-route" };
  }
  return { reason: null };
}

function buildNavigationGeometry(geometry) {
  const points = clonePointList(geometry);
  let distanceFromStartMeters = 0;
  return points.map((point, index) => {
    if (index > 0) {
      distanceFromStartMeters += getDistance(points[index - 1], point);
    }
    return {
      ...point,
      index,
      distanceFromStartMeters,
    };
  });
}

function normalizedRouteShape(entry) {
  const type = routeShapeType(entry);
  if (!type) return null;
  const endpointDistanceM = finiteNumberOrNull(entry?.routeShape?.endpointDistanceM);
  return endpointDistanceM === null ? { type } : { type, endpointDistanceM };
}

function navigationRouteId(source, routeParam, slug) {
  if (source === "catalog" && slug) return `catalog:${slug}`;
  if (routeParam) return `${source}:${routeParam.slice(0, 32)}`;
  return `${source}:draft`;
}

function segmentIdForName(name, segmentsData) {
  const id = Number(segmentsData?.[name]?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function clonePointList(points) {
  return (Array.isArray(points) ? points : [])
    .map((point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        ...point,
        lat,
        lng,
      };
    })
    .filter(Boolean);
}

function cloneDataPointList(dataPoints) {
  return (Array.isArray(dataPoints) ? dataPoints : []).map((dataPoint) => ({
    ...dataPoint,
  }));
}

function arrayOfStrings(value) {
  return (Array.isArray(value) ? value : []).filter(
    (item) => typeof item === "string" && item.length > 0,
  );
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundDistanceKm(distanceMeters) {
  return Math.round((finiteNonNegative(distanceMeters) / 1000) * 10) / 10;
}
