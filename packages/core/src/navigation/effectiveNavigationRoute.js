import { getDistance } from "../utils/distance.js";
import { buildNavigationGeometry } from "./navigationRoute.js";

export const LOOP_SEAM_TOLERANCE_M = 25;

const EPSILON_M = 0.5;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clonePoint(point) {
  return point ? { ...point } : point;
}

function cloneJunctions(junctions) {
  return Array.isArray(junctions)
    ? junctions.map((junction) => ({ ...junction }))
    : null;
}

function totalMeters(route) {
  const geometry = Array.isArray(route?.geometry) ? route.geometry : [];
  return geometry.length > 0
    ? Number(geometry[geometry.length - 1].distanceFromStartMeters) || 0
    : 0;
}

function derivedId(route, direction, startProgressMeters, loop) {
  const rounded = Math.round(Math.max(0, Number(startProgressMeters) || 0) * 10);
  return `${route?.id || "route"}:ride:${direction}:${loop ? "loop" : "linear"}:${rounded}`;
}

function interpolatePoint(a, b, fraction) {
  const point = {
    ...a,
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
  const elevationA = finite(a.elevation);
  const elevationB = finite(b.elevation);
  if (elevationA !== null && elevationB !== null) {
    point.elevation = elevationA + (elevationB - elevationA) * fraction;
  }
  delete point.index;
  delete point.distanceFromStartMeters;
  return point;
}

export function splitGeometryAtProgress(geometry, progressMeters) {
  const points = Array.isArray(geometry) ? geometry : [];
  if (points.length < 2) return null;
  const total = Number(points[points.length - 1].distanceFromStartMeters) || 0;
  const progress = Math.max(0, Math.min(total, Number(progressMeters) || 0));

  if (progress <= EPSILON_M) {
    return {
      point: clonePoint(points[0]),
      prefix: [clonePoint(points[0])],
      suffix: points.map(clonePoint),
      progressMeters: 0,
    };
  }
  if (total - progress <= EPSILON_M) {
    return {
      point: clonePoint(points[points.length - 1]),
      prefix: points.map(clonePoint),
      suffix: [clonePoint(points[points.length - 1])],
      progressMeters: total,
    };
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = Number(points[index].distanceFromStartMeters) || 0;
    const end = Number(points[index + 1].distanceFromStartMeters) || start;
    if (progress < start || progress > end || end <= start) continue;
    const fraction = (progress - start) / (end - start);
    const point =
      fraction <= 1e-9
        ? clonePoint(points[index])
        : fraction >= 1 - 1e-9
          ? clonePoint(points[index + 1])
          : interpolatePoint(points[index], points[index + 1], fraction);
    const prefixEnd = fraction >= 1 - 1e-9 ? index + 1 : index;
    const suffixStart = fraction <= 1e-9 ? index : index + 1;
    return {
      point,
      prefix: [...points.slice(0, prefixEnd + 1).map(clonePoint), ...(fraction > 1e-9 && fraction < 1 - 1e-9 ? [clonePoint(point)] : [])],
      suffix: [...(fraction > 1e-9 && fraction < 1 - 1e-9 ? [clonePoint(point)] : []), ...points.slice(suffixStart).map(clonePoint)],
      progressMeters: progress,
    };
  }
  return null;
}

function remapReverseSpans(spans, total) {
  return (Array.isArray(spans) ? spans : [])
    .map((span) => ({
      ...span,
      startMeters: Math.max(0, total - Number(span.endMeters || 0)),
      endMeters: Math.max(0, total - Number(span.startMeters || 0)),
    }))
    .sort((a, b) => a.startMeters - b.startMeters);
}

function remapReverseDataPoints(dataPoints, total) {
  return (Array.isArray(dataPoints) ? dataPoints : []).map((point) => {
    const progress = finite(point?.routeProgressMeters);
    return progress === null
      ? { ...point }
      : { ...point, routeProgressMeters: Math.max(0, total - progress) };
  });
}

export function reverseNavigationRoute(route) {
  const geometry = Array.isArray(route?.geometry) ? route.geometry : [];
  if (geometry.length < 2) {
    return {
      ...route,
      id: derivedId(route, "reverse", 0, false),
      canNavigate: false,
      unavailableReason: "invalid-effective-route",
      geometry: [],
    };
  }
  const total = totalMeters(route);
  const reversedGeometry = buildNavigationGeometry(
    [...geometry].reverse().map((point) => {
      const copy = { ...point };
      delete copy.index;
      delete copy.distanceFromStartMeters;
      return copy;
    }),
  );
  return {
    ...route,
    id: derivedId(route, "reverse", 0, false),
    direction: "reverse",
    geometry: reversedGeometry,
    points: Array.isArray(route?.points)
      ? [...route.points].reverse().map(clonePoint)
      : [],
    distanceMeters: total,
    distanceKm: Math.round((total / 1000) * 10) / 10,
    elevationGainM: Number(route?.elevationLossM) || 0,
    elevationLossM: Number(route?.elevationGainM) || 0,
    start: route?.end ? { ...route.end } : null,
    end: route?.start ? { ...route.start } : null,
    activeDataPoints: remapReverseDataPoints(route?.activeDataPoints, total),
    segmentSpans: remapReverseSpans(route?.segmentSpans, total),
    junctions: cloneJunctions(route?.junctions),
  };
}

export function isSafeCircularRoute(route) {
  const geometry = Array.isArray(route?.geometry) ? route.geometry : [];
  if (geometry.length < 3) return false;
  const seamMeters = getDistance(geometry[0], geometry[geometry.length - 1]);
  return seamMeters <= LOOP_SEAM_TOLERANCE_M;
}

function clipLinearSpans(spans, offset, total) {
  return (Array.isArray(spans) ? spans : [])
    .filter((span) => Number(span.endMeters) > offset + EPSILON_M)
    .map((span) => ({
      ...span,
      startMeters: Math.max(0, Number(span.startMeters) - offset),
      endMeters: Math.min(total, Number(span.endMeters) - offset),
    }))
    .filter((span) => span.endMeters > span.startMeters + EPSILON_M);
}

function clipLinearDataPoints(dataPoints, offset, total) {
  return (Array.isArray(dataPoints) ? dataPoints : [])
    .filter((point) => {
      const progress = finite(point?.routeProgressMeters);
      return progress === null || (progress >= offset - EPSILON_M && progress <= offset + total + EPSILON_M);
    })
    .map((point) => {
      const progress = finite(point?.routeProgressMeters);
      return progress === null
        ? { ...point }
        : { ...point, routeProgressMeters: Math.max(0, progress - offset) };
    });
}

function rotateProgress(progress, offset, total) {
  const shifted = progress - offset;
  return shifted >= -EPSILON_M ? Math.max(0, shifted) : shifted + total;
}

function rotateSpans(spans, offset, total) {
  const result = [];
  for (const span of Array.isArray(spans) ? spans : []) {
    const start = Number(span.startMeters);
    const end = Number(span.endMeters);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const newStart = rotateProgress(start, offset, total);
    const length = end - start;
    const newEnd = newStart + length;
    if (newEnd <= total + EPSILON_M) {
      result.push({ ...span, startMeters: newStart, endMeters: Math.min(total, newEnd) });
    } else {
      result.push({ ...span, startMeters: newStart, endMeters: total });
      result.push({ ...span, startMeters: 0, endMeters: newEnd - total });
    }
  }
  return result
    .filter((span) => span.endMeters > span.startMeters + EPSILON_M)
    .sort((a, b) => a.startMeters - b.startMeters);
}

function rotateDataPoints(dataPoints, offset, total) {
  return (Array.isArray(dataPoints) ? dataPoints : [])
    .map((point) => {
      const progress = finite(point?.routeProgressMeters);
      return progress === null
        ? { ...point }
        : { ...point, routeProgressMeters: rotateProgress(progress, offset, total) };
    })
    .sort((a, b) =>
      (finite(a.routeProgressMeters) ?? Infinity) -
      (finite(b.routeProgressMeters) ?? Infinity),
    );
}

function closeLoopGeometry(geometry) {
  const points = geometry.map((point) => {
    const copy = { ...point };
    delete copy.index;
    delete copy.distanceFromStartMeters;
    return copy;
  });
  const first = points[0];
  const last = points[points.length - 1];
  if (getDistance(first, last) > EPSILON_M) points.push({ ...first });
  return buildNavigationGeometry(points);
}

function withEffectiveCommon(route, geometry, selection, loop) {
  const distance = geometry.length > 0
    ? Number(geometry[geometry.length - 1].distanceFromStartMeters) || 0
    : 0;
  return {
    ...route,
    id: derivedId(route, selection.direction, selection.startProgressMeters, loop),
    direction: selection.direction,
    startMode: selection.startMode,
    startProgressMeters: selection.startProgressMeters,
    isEffectiveLoop: loop,
    requiresStartAcquisition: true,
    canNavigate: geometry.length >= 2,
    unavailableReason: geometry.length >= 2 ? null : "invalid-effective-route",
    geometry,
    distanceMeters: distance,
    distanceKm: Math.round((distance / 1000) * 10) / 10,
    junctions: cloneJunctions(route?.junctions),
  };
}

export function buildEffectiveNavigationRoute(sourceRoute, selection = {}) {
  const direction = selection.direction === "reverse" ? "reverse" : "forward";
  const directional = direction === "reverse"
    ? reverseNavigationRoute(sourceRoute)
    : {
        ...sourceRoute,
        direction: "forward",
        geometry: Array.isArray(sourceRoute?.geometry)
          ? sourceRoute.geometry.map(clonePoint)
          : [],
        points: Array.isArray(sourceRoute?.points)
          ? sourceRoute.points.map(clonePoint)
          : [],
        activeDataPoints: Array.isArray(sourceRoute?.activeDataPoints)
          ? sourceRoute.activeDataPoints.map((point) => ({ ...point }))
          : [],
        segmentSpans: Array.isArray(sourceRoute?.segmentSpans)
          ? sourceRoute.segmentSpans.map((span) => ({ ...span }))
          : [],
      };
  const total = totalMeters(directional);
  const requestedProgress = Math.max(
    0,
    Math.min(total, Number(selection.startProgressMeters) || 0),
  );
  const normalizedSelection = {
    direction,
    startMode: selection.startMode || "official",
    startProgressMeters: requestedProgress,
  };
  const loop = isSafeCircularRoute(directional);

  if (requestedProgress <= EPSILON_M) {
    const geometry = buildNavigationGeometry(directional.geometry);
    return withEffectiveCommon(
      {
        ...directional,
        activeDataPoints: directional.activeDataPoints.map((point) => ({ ...point })),
        segmentSpans: directional.segmentSpans.map((span) => ({ ...span })),
      },
      geometry,
      normalizedSelection,
      loop,
    );
  }

  const split = splitGeometryAtProgress(directional.geometry, requestedProgress);
  if (!split) {
    return {
      ...directional,
      id: derivedId(directional, direction, requestedProgress, loop),
      canNavigate: false,
      unavailableReason: "invalid-start-point",
      geometry: [],
    };
  }

  if (loop) {
    const closed = closeLoopGeometry(directional.geometry);
    const closedTotal = totalMeters({ geometry: closed });
    const closedSplit = splitGeometryAtProgress(closed, Math.min(requestedProgress, closedTotal));
    if (!closedSplit) return directional;
    const raw = [
      ...closedSplit.suffix,
      ...closedSplit.prefix.slice(1),
    ].map((point) => {
      const copy = { ...point };
      delete copy.index;
      delete copy.distanceFromStartMeters;
      return copy;
    });
    const geometry = buildNavigationGeometry(raw);
    const effective = withEffectiveCommon(
      directional,
      geometry,
      normalizedSelection,
      true,
    );
    return {
      ...effective,
      points: [clonePoint(geometry[0]), clonePoint(geometry[geometry.length - 1])],
      start: {
        lat: geometry[0].lat,
        lng: geometry[0].lng,
        name: "נקודת התחלה שנבחרה",
      },
      end: {
        lat: geometry[0].lat,
        lng: geometry[0].lng,
        name: "חזרה לנקודת ההתחלה",
      },
      activeDataPoints: rotateDataPoints(
        directional.activeDataPoints,
        requestedProgress,
        closedTotal,
      ),
      segmentSpans: rotateSpans(
        directional.segmentSpans,
        requestedProgress,
        closedTotal,
      ),
    };
  }

  const geometry = buildNavigationGeometry(split.suffix);
  const effective = withEffectiveCommon(
    directional,
    geometry,
    normalizedSelection,
    false,
  );
  return {
    ...effective,
    points: [clonePoint(geometry[0]), clonePoint(geometry[geometry.length - 1])],
    start: {
      lat: geometry[0].lat,
      lng: geometry[0].lng,
      name: "נקודת התחלה שנבחרה",
    },
    activeDataPoints: clipLinearDataPoints(
      directional.activeDataPoints,
      requestedProgress,
      effective.distanceMeters,
    ),
    segmentSpans: clipLinearSpans(
      directional.segmentSpans,
      requestedProgress,
      effective.distanceMeters,
    ),
  };
}
