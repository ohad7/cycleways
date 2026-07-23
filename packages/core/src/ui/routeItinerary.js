import {
  ITINERARY_FOLD_MAX_M,
  fallbackGuidanceKind,
  guidanceClassIcon,
  guidanceClassLabel,
} from "../data/navigationWays.js";
import { getDistance } from "../utils/distance.js";

const EPSILON_M = 0.5;

/**
 * Clip route geometry to an itinerary distance range. The result preserves the
 * route point shape and interpolates exact boundary points, so web and native
 * highlight the same occurrence instead of every member of the named way.
 */
export function sliceRouteGeometryRange(geometry, startMeters, endMeters) {
  const points = Array.isArray(geometry) ? geometry : [];
  if (points.length < 2) return [];
  const start = Math.max(0, finite(startMeters));
  const end = Math.max(start, finite(endMeters, start));
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + getDistance(points[index - 1], points[index]),
    );
  }
  const total = cumulative.at(-1);
  if (start > total || end <= 0) return [];
  const clippedStart = Math.min(total, start);
  const clippedEnd = Math.min(total, end);
  const atDistance = (meters) => {
    if (meters <= 0) return { ...points[0] };
    if (meters >= total) return { ...points.at(-1) };
    let index = 1;
    while (index < cumulative.length && cumulative[index] < meters) index += 1;
    const previousDistance = cumulative[index - 1];
    const length = Math.max(EPSILON_M, cumulative[index] - previousDistance);
    const fraction = Math.max(0, Math.min(1, (meters - previousDistance) / length));
    const from = points[index - 1];
    const to = points[index];
    return {
      ...from,
      lat: Number(from.lat) + (Number(to.lat) - Number(from.lat)) * fraction,
      lng: Number(from.lng) + (Number(to.lng) - Number(from.lng)) * fraction,
      ...(Number.isFinite(Number(from.elevation)) && Number.isFinite(Number(to.elevation))
        ? {
            elevation:
              Number(from.elevation)
              + (Number(to.elevation) - Number(from.elevation)) * fraction,
          }
        : {}),
    };
  };
  const result = [atDistance(clippedStart)];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (
      cumulative[index] > clippedStart + EPSILON_M
      && cumulative[index] < clippedEnd - EPSILON_M
    ) {
      result.push({ ...points[index] });
    }
  }
  result.push(atDistance(clippedEnd));
  return result;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function occurrenceId(identity, ordinal, startMeters, endMeters) {
  const stable = identity || "class";
  return `${stable}:${ordinal}:${Math.round(startMeters)}-${Math.round(endMeters)}`;
}

function pointsInRange(points, startMeters, endMeters) {
  return (Array.isArray(points) ? points : []).filter((point) => {
    const progress = finite(point?.routeProgressMeters, NaN);
    return Number.isFinite(progress)
      && progress >= startMeters - EPSILON_M
      && progress <= endMeters + EPSILON_M;
  });
}

function presentationForSpan(span, properNamesEnabled) {
  const kind = fallbackGuidanceKind(span?.kind, span?.routeClass);
  const canUseName = properNamesEnabled
    && (span?.resolutionStatus === "resolved" || span?.role === "standalone")
    && span?.name;
  return {
    name: canUseName ? String(span.name) : guidanceClassLabel(kind, span?.routeClass),
    spokenName: canUseName ? span.spokenName || span.name : guidanceClassLabel(kind, span?.routeClass),
    kind,
    icon: guidanceClassIcon(kind, span?.routeClass),
    isFallback: !canUseName,
  };
}

function rowFromSpan(span, ordinal, activeDataPoints, properNamesEnabled) {
  const startMeters = finite(span.startMeters);
  const endMeters = Math.max(startMeters, finite(span.endMeters, startMeters));
  const points = pointsInRange(activeDataPoints, startMeters, endMeters);
  const presentation = presentationForSpan(span, properNamesEnabled);
  return {
    id: occurrenceId(span.guidanceIdentity, ordinal, startMeters, endMeters),
    guidanceIdentity: span.guidanceIdentity || null,
    role: span.role || null,
    resolutionStatus: span.resolutionStatus || "unreviewed",
    ...presentation,
    startMeters,
    endMeters,
    distanceMeters: endMeters - startMeters,
    segmentIds: [...new Set((span.segmentIds || []).map(Number).filter(Number.isSafeInteger))],
    sectionLabels: [...new Set((span.sectionLabels || []).filter(Boolean))],
    junctionContexts: [],
    children: [{ ...span, startMeters, endMeters }],
    warningCount: points.length,
    poiCount: points.length,
    dataPointIds: points.map((point) => point.id).filter(Boolean),
  };
}

function mergeRow(row, span, activeDataPoints) {
  row.endMeters = Math.max(row.endMeters, finite(span.endMeters, row.endMeters));
  row.distanceMeters = row.endMeters - row.startMeters;
  row.segmentIds = [...new Set([
    ...row.segmentIds,
    ...(span.segmentIds || []).map(Number).filter(Number.isSafeInteger),
  ])];
  row.sectionLabels = [...new Set([
    ...row.sectionLabels,
    ...(span.sectionLabels || []).filter(Boolean),
  ])];
  row.children.push({ ...span });
  const points = pointsInRange(activeDataPoints, span.startMeters, span.endMeters);
  row.dataPointIds = [...new Set([
    ...row.dataPointIds,
    ...points.map((point) => point.id).filter(Boolean),
  ])];
  row.warningCount = row.dataPointIds.length;
  row.poiCount = row.dataPointIds.length;
}

function fallbackSpansFromExact(routeState) {
  return (routeState?.segmentSpans || []).map((span) => ({
    startMeters: span.startMeters,
    endMeters: span.endMeters,
    networkRole: span.networkRole || (span.onNetwork ? "segment" : null),
    resolutionStatus: span.networkRole === "junction" ? "junction" : "unreviewed",
    guidanceIdentity: null,
    name: null,
    spokenName: null,
    role: null,
    kind: fallbackGuidanceKind(null, span.routeClass),
    routeClass: span.routeClass || null,
    segmentIds: span.segmentIds || (span.segmentId ? [span.segmentId] : []),
    sectionLabels: [],
    junctionId: span.junctionId || null,
    junctionName: span.junctionName || null,
  }));
}

function itineraryFromSnapshot(routeState, properNamesEnabled) {
  return (routeState?.guidanceItinerary || []).map((row) => {
    const kind = fallbackGuidanceKind(row?.kind, row?.routeClass);
    const className = guidanceClassLabel(kind, row?.routeClass);
    return {
      ...row,
      name: properNamesEnabled && row?.name ? row.name : className,
      spokenName:
        properNamesEnabled && row?.name
          ? row.spokenName || row.name
          : className,
      kind,
      icon: guidanceClassIcon(kind, row?.routeClass),
      isFallback: properNamesEnabled ? Boolean(row?.isFallback) : true,
    };
  });
}

/**
 * Derive the shared web/native rider-facing route occurrence list.
 * Exact spans remain on route state; rows are a presentation projection only.
 */
export function buildRouteItinerary(routeState, options = {}) {
  const properNamesEnabled = options.properNamesEnabled !== undefined
    ? options.properNamesEnabled !== false
    : routeState?.guidancePresentationPolicy !== "class-only";
  const activeDataPoints = routeState?.activeDataPoints || [];
  if (
    (!Array.isArray(routeState?.guidanceSpans) || routeState.guidanceSpans.length === 0)
    && (!Array.isArray(routeState?.segmentSpans) || routeState.segmentSpans.length === 0)
    && Array.isArray(routeState?.guidanceItinerary)
    && routeState.guidanceItinerary.length > 0
  ) {
    return itineraryFromSnapshot(routeState, properNamesEnabled);
  }
  const sourceSpans = Array.isArray(routeState?.guidanceSpans)
    && routeState.guidanceSpans.length > 0
    ? routeState.guidanceSpans
    : fallbackSpansFromExact(routeState);
  const rows = [];
  let pendingJunctions = [];
  const occurrenceCounts = new Map();

  for (let index = 0; index < sourceSpans.length; index += 1) {
    const span = sourceSpans[index];
    if (span.networkRole === "junction" || span.resolutionStatus === "junction") {
      pendingJunctions.push({
        junctionId: span.junctionId || null,
        junctionName: span.junctionName || null,
        startMeters: finite(span.startMeters),
        endMeters: finite(span.endMeters),
      });
      continue;
    }
    const previous = rows[rows.length - 1];
    const nextIdentity = span.guidanceIdentity || null;
    const canBridgeJunction = pendingJunctions.length > 0
      && previous
      && previous.guidanceIdentity
      && previous.guidanceIdentity === nextIdentity;
    const canMerge = previous
      && previous.role !== "standalone"
      && span.role !== "standalone"
      && previous.guidanceIdentity
      && previous.guidanceIdentity === nextIdentity
      && (
        Math.abs(previous.endMeters - finite(span.startMeters)) <= EPSILON_M
        || canBridgeJunction
      );
    if (canMerge) {
      previous.junctionContexts.push(...pendingJunctions);
      pendingJunctions = [];
      mergeRow(previous, span, activeDataPoints);
      continue;
    }
    const key = nextIdentity || `${span.resolutionStatus || "class"}:${span.kind || span.routeClass || "other"}`;
    const ordinal = (occurrenceCounts.get(key) || 0) + 1;
    occurrenceCounts.set(key, ordinal);
    const row = rowFromSpan(span, ordinal, activeDataPoints, properNamesEnabled);
    row.junctionContexts.push(...pendingJunctions);
    pendingJunctions = [];
    rows.push(row);
  }
  if (pendingJunctions.length > 0 && rows.length > 0) {
    rows[rows.length - 1].junctionContexts.push(...pendingJunctions);
  }

  // Fold only short nameless connectors with no retained information. A
  // standalone feature is never folded.
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const foldable = row.isFallback
      && row.role !== "standalone"
      && row.distanceMeters <= ITINERARY_FOLD_MAX_M
      && row.warningCount === 0
      && row.poiCount === 0;
    if (!foldable || rows.length === 1) continue;
    const target = rows[index - 1] || rows[index + 1];
    if (!target) continue;
    target.children.push(...row.children);
    target.junctionContexts.push(...row.junctionContexts);
    target.segmentIds = [...new Set([...target.segmentIds, ...row.segmentIds])];
    target.startMeters = Math.min(target.startMeters, row.startMeters);
    target.endMeters = Math.max(target.endMeters, row.endMeters);
    target.distanceMeters = target.endMeters - target.startMeters;
    rows.splice(index, 1);
  }
  return rows;
}
