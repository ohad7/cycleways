import {
  routeShapeType,
  routeSurfaceType,
} from "../data/catalog.js";
import { getDistance } from "../utils/distance.js";
import { validateRouteAttestation } from "../routing/routeAttestation.js";

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
  const routingValidation = routeState?.routingValidation
    ? JSON.parse(JSON.stringify(routeState.routingValidation))
    : null;
  const status = navigationRouteStatus({
    points,
    geometry,
    routeFailure,
    routingValidation,
  });
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
    routingValidation,
    start: metadata?.start || null,
    end: metadata?.end || null,
    regionId: metadata?.regionId || "",
    startPlaceIds: arrayOfStrings(metadata?.startPlaceIds),
    passesNear: arrayOfStrings(metadata?.passesNear),
    segmentSpans: reconcileSegmentSpans(routeState?.segmentSpans, computedDistance),
    guidanceSpans: reconcileSegmentSpans(routeState?.guidanceSpans, computedDistance),
    guidanceMode: routeState?.guidanceMode === "guidance-v1"
      ? "guidance-v1"
      : "legacy",
    guidancePresentationPolicy:
      routeState?.guidancePresentationPolicy === "class-only"
        ? "class-only"
        : "named",
    guidanceProvenance: {
      mapVersion: metadata?.mapVersion || null,
      segmentsHash: metadata?.segmentsHash || null,
    },
    junctions: cloneJunctionList(routeState?.junctions),
    crossings: cloneCrossingList(routeState?.crossings),
    maneuverGeneratorVersion: "navigation-cues-v4",
  };
}

function cloneCrossingList(rawCrossings) {
  if (!Array.isArray(rawCrossings)) return null;
  return rawCrossings
    .filter((crossing) =>
      crossing?.kind === "crossing"
      && crossing.complete === true
      && Number.isFinite(Number(crossing.entryMeters))
      && Number.isFinite(Number(crossing.exitMeters))
      && Number(crossing.exitMeters) >= Number(crossing.entryMeters))
    .map((crossing) => ({
      kind: "crossing",
      crossingId: String(crossing.crossingId || ""),
      mappingId: String(crossing.mappingId || ""),
      crossingKind: crossing.crossingKind || "side-change",
      crossingRepresentation: crossing.crossingRepresentation || "action-path",
      guidancePolicy: crossing.guidancePolicy || "always",
      crossedRoadName: crossing.crossedRoadName || null,
      continuation: crossing.continuation?.type === "turn"
        && (crossing.continuation?.direction === "left" || crossing.continuation?.direction === "right")
        ? { type: "turn", direction: crossing.continuation.direction }
        : null,
      entryMeters: Number(crossing.entryMeters),
      exitMeters: Number(crossing.exitMeters),
      complete: true,
    }));
}

// Network junction nodes (3+ edges) near the route, baked in at route
// build/decode/snapshot time. null (not []) when the data is absent, so cue
// generation can tell "no junctions nearby" from "no junction data".
function cloneJunctionList(rawJunctions) {
  if (!Array.isArray(rawJunctions)) return null;
  return rawJunctions
    .filter((j) => Number.isFinite(j?.lat) && Number.isFinite(j?.lng))
    .map((j) => j.kind === "roundabout"
      ? {
          kind: "roundabout",
          roundaboutId: j.roundaboutId,
          lat: j.lat,
          lng: j.lng,
          entryMeters: Number(j.entryMeters),
          exitMeters: Number(j.exitMeters),
          entryBearingDeg: Number.isFinite(Number(j.entryBearingDeg)) ? Number(j.entryBearingDeg) : null,
          exitBearingDeg: Number.isFinite(Number(j.exitBearingDeg)) ? Number(j.exitBearingDeg) : null,
          complete: j.complete === true,
        }
      : { kind: j.kind || "junction", lat: j.lat, lng: j.lng });
}

function reconcileSegmentSpans(rawSpans, geometryTotalMeters) {
  const spans = Array.isArray(rawSpans) ? rawSpans : [];
  if (spans.length === 0 || geometryTotalMeters <= 0) return [];
  const spansTotal = spans[spans.length - 1].endMeters;
  const scale = spansTotal > 0 ? geometryTotalMeters / spansTotal : 1;
  return spans.map((s, i) => ({
    ...s,
    startMeters: s.startMeters * scale,
    endMeters:
      i === spans.length - 1 ? geometryTotalMeters : s.endMeters * scale,
  }));
}

function navigationRouteStatus({
  points,
  geometry,
  routeFailure,
  routingValidation,
}) {
  if (routeFailure || (points.length >= 2 && geometry.length < 2)) {
    return { reason: "broken-route" };
  }
  if (geometry.length < 2) {
    return { reason: "empty-route" };
  }
  const evidence = validateRouteAttestation(routingValidation, { geometry });
  if (!evidence.ok) {
    return { reason: evidence.reason };
  }
  return { reason: null };
}

export function buildNavigationGeometry(geometry) {
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
