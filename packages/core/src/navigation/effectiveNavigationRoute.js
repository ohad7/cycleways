import { getDistance } from "../utils/distance.js";
import { buildNavigationGeometry } from "./navigationRoute.js";
import { fallbackGuidanceKind } from "../data/navigationWays.js";
import {
  reverseRouteAttestation,
  transformRouteAttestation,
  validateRouteAttestation,
} from "../routing/routeAttestation.js";

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

function reverseTurnDirection(direction) {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  return direction;
}

function reverseCrossings(crossings, total) {
  if (!Array.isArray(crossings)) return null;
  return crossings
    .map((crossing) => ({
      ...crossing,
      entryMeters: Math.max(0, total - Number(crossing.exitMeters)),
      exitMeters: Math.max(0, total - Number(crossing.entryMeters)),
      continuation: crossing.continuation?.type === "turn"
        ? {
            ...crossing.continuation,
            direction: reverseTurnDirection(crossing.continuation.direction),
          }
        : crossing.continuation || null,
    }))
    .sort((a, b) => a.entryMeters - b.entryMeters);
}

function transformCrossingsForStart(crossings, offset, total, loop) {
  if (!Array.isArray(crossings)) return { crossings: null, safe: true };
  if (offset <= EPSILON_M) {
    return { crossings: crossings.map((crossing) => ({ ...crossing })), safe: true };
  }
  const cursorInsideCrossing = crossings.some(
    (crossing) =>
      Number(crossing.entryMeters) < offset - EPSILON_M
      && Number(crossing.exitMeters) > offset + EPSILON_M,
  );
  if (cursorInsideCrossing) return { crossings: null, safe: false };
  if (!loop) {
    return {
      safe: true,
      crossings: crossings
        .filter((crossing) => Number(crossing.entryMeters) >= offset - EPSILON_M)
        .map((crossing) => ({
          ...crossing,
          entryMeters: Math.max(0, Number(crossing.entryMeters) - offset),
          exitMeters: Math.max(0, Number(crossing.exitMeters) - offset),
        })),
    };
  }
  return {
    safe: true,
    crossings: crossings
      .map((crossing) => {
        let entryMeters = Number(crossing.entryMeters) - offset;
        let exitMeters = Number(crossing.exitMeters) - offset;
        if (entryMeters < 0) {
          entryMeters += total;
          exitMeters += total;
        }
        return { ...crossing, entryMeters, exitMeters };
      })
      .sort((a, b) => a.entryMeters - b.entryMeters),
  };
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

function cloneSpans(spans) {
  return Array.isArray(spans) ? spans.map((span) => ({ ...span })) : [];
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
  const reversedValidation = reverseRouteAttestation(route?.routingValidation);
  return {
    ...route,
    id: derivedId(route, "reverse", 0, false),
    direction: "reverse",
    canNavigate: reversedValidation !== null,
    unavailableReason:
      reversedValidation !== null ? null : "reverse-not-allowed",
    routingValidation: reversedValidation,
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
    // Reverse swaps the precomputed direction pair rather than reversing
    // forward rider-facing identities. The opposite projections were resolved
    // during route construction, where the guidance index and the per-edge
    // reverse memberships were available; they already sit in the reverse
    // route's distance frame, so no remap is needed. Their counterparts — the
    // forward lists — do need remapping, because a second reverse must restore
    // the original.
    segmentSpans: oppositeOrRemapped(route?.oppositeSegmentSpans, route?.segmentSpans, total),
    guidanceSpans: oppositeGuidanceOrFallback(
      route?.oppositeGuidanceSpans,
      route?.guidanceSpans,
      total,
    ),
    // The reverse route's own opposite direction is the original forward
    // direction, and its opposite frame is the original forward frame — so the
    // pair is carried across unchanged, and a second reverse restores exactly
    // what the first one started from.
    oppositeSegmentSpans: cloneSpans(route?.segmentSpans),
    oppositeGuidanceSpans: cloneSpans(route?.guidanceSpans),
    guidanceMode: route?.guidanceMode || "legacy",
    junctions: cloneJunctions(route?.junctions),
    crossings: reverseCrossings(route?.crossings, total),
    crossingsNeedRecompute: false,
  };
}

// When the opposite projection is missing — a legacy route state persisted
// before reverse-ready spans existed — fall back to remapping the forward list.
// That is safe for exact spans and for symmetric guidance, and an asymmetric
// membership simply keeps its class fallback rather than reverting to legacy
// naming.
function oppositeOrRemapped(oppositeSpans, forwardSpans, total) {
  if (Array.isArray(oppositeSpans) && oppositeSpans.length > 0) {
    return oppositeSpans.map((span) => ({ ...span }));
  }
  return remapReverseSpans(forwardSpans, total);
}

function oppositeGuidanceOrFallback(oppositeSpans, forwardSpans, total) {
  if (Array.isArray(oppositeSpans) && oppositeSpans.length > 0) {
    return oppositeSpans.map((span) => ({ ...span }));
  }
  // An old persisted route has no evidence for asymmetric return membership.
  // Reusing the outbound proper name would be a confident lie, so retain only
  // the distance/class context until the route is rebuilt from current assets.
  return remapReverseSpans(forwardSpans, total).map((span) => ({
    ...span,
    guidanceIdentity: null,
    name: null,
    spokenName: null,
    wayId: null,
    role: null,
    resolutionStatus: span.networkRole === "segment" ? "unreviewed" : span.resolutionStatus,
    kind: fallbackGuidanceKind(span.kind, span.routeClass),
  }));
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
  const routingValidation = transformRouteAttestation(
    route?.routingValidation,
    {
      geometry,
      startProgressMeters: selection.startProgressMeters,
      sourceGeometryTotalMeters: totalMeters(route),
      rotateLoop: loop,
    },
  );
  const evidence = validateRouteAttestation(routingValidation, { geometry });
  const crossingProjection = transformCrossingsForStart(
    route?.crossings,
    selection.startProgressMeters,
    totalMeters(route),
    loop,
  );
  const canNavigate = geometry.length >= 2
    && route?.canNavigate === true
    && evidence.ok
    && crossingProjection.safe;
  return {
    ...route,
    id: derivedId(route, selection.direction, selection.startProgressMeters, loop),
    direction: selection.direction,
    startMode: selection.startMode,
    startProgressMeters: selection.startProgressMeters,
    isEffectiveLoop: loop,
    requiresStartAcquisition: true,
    routingValidation,
    canNavigate,
    unavailableReason: canNavigate
      ? null
      : route?.unavailableReason
        || (!crossingProjection.safe ? "start-inside-reviewed-crossing" : null)
        || evidence.reason
        || "invalid-effective-route",
    geometry,
    distanceMeters: distance,
    distanceKm: Math.round((distance / 1000) * 10) / 10,
    junctions: cloneJunctions(route?.junctions),
    crossings: crossingProjection.crossings,
    crossingsNeedRecompute: false,
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
        guidanceSpans: Array.isArray(sourceRoute?.guidanceSpans)
          ? sourceRoute.guidanceSpans.map((span) => ({ ...span }))
          : [],
        oppositeSegmentSpans: Array.isArray(sourceRoute?.oppositeSegmentSpans)
          ? sourceRoute.oppositeSegmentSpans.map((span) => ({ ...span }))
          : [],
        oppositeGuidanceSpans: Array.isArray(sourceRoute?.oppositeGuidanceSpans)
          ? sourceRoute.oppositeGuidanceSpans.map((span) => ({ ...span }))
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
        guidanceSpans: directional.guidanceSpans.map((span) => ({ ...span })),
        oppositeSegmentSpans: cloneSpans(directional.oppositeSegmentSpans),
        oppositeGuidanceSpans: cloneSpans(directional.oppositeGuidanceSpans),
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
      guidanceSpans: rotateSpans(
        directional.guidanceSpans,
        requestedProgress,
        closedTotal,
      ),
      // The reverse-ready pair is rotated by the mirrored offset so a reverse
      // of this rotated loop still lines up with its own geometry.
      oppositeSegmentSpans: rotateSpans(
        directional.oppositeSegmentSpans,
        closedTotal - requestedProgress,
        closedTotal,
      ),
      oppositeGuidanceSpans: rotateSpans(
        directional.oppositeGuidanceSpans,
        closedTotal - requestedProgress,
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
    guidanceSpans: clipLinearSpans(
      directional.guidanceSpans,
      requestedProgress,
      effective.distanceMeters,
    ),
    // A clipped route's reverse starts at the clip point and ends at the
    // original start, so the opposite pair is clipped from its own tail.
    oppositeSegmentSpans: clipLinearSpans(
      directional.oppositeSegmentSpans,
      0,
      effective.distanceMeters,
    ),
    oppositeGuidanceSpans: clipLinearSpans(
      directional.oppositeGuidanceSpans,
      0,
      effective.distanceMeters,
    ),
  };
}
