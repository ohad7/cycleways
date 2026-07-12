import { getDistance, distanceToLineSegment } from "../utils/distance.js";
import { computeBearing, pointAndBearingAtDistance, precomputeArcLength } from "../utils/geometry.js";

export const RING_MATCH_M = 12;
export const MIN_MATCHED_ROUTE_M = 8;
export const COURSE_SAMPLE_OFFSET_M = 20;
const SAMPLE_STEP_M = 4;
const MAX_ALIGNMENT_DELTA_DEG = 65;

function normalizedGeometry(routeGeometry) {
  const points = (Array.isArray(routeGeometry) ? routeGeometry : [])
    .map((point) => ({ lat: Number(point?.lat), lng: Number(point?.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length < 2) return null;
  const arc = precomputeArcLength(points);
  return arc.totalDistMeters > 0 ? { points, arc } : null;
}

function candidateBounds(candidate, padM) {
  const bbox = candidate?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const lat = Number(candidate?.center?.lat) || (bbox[1] + bbox[3]) / 2;
  const latPad = padM / 111_320;
  const lngPad = latPad / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return [bbox[0] - lngPad, bbox[1] - latPad, bbox[2] + lngPad, bbox[3] + latPad];
}

function segmentIntersectsBounds(a, b, bounds) {
  return !(
    Math.max(a.lng, b.lng) < bounds[0]
    || Math.min(a.lng, b.lng) > bounds[2]
    || Math.max(a.lat, b.lat) < bounds[1]
    || Math.min(a.lat, b.lat) > bounds[3]
  );
}

function angleToUndirectedLine(a, b) {
  const delta = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(delta, 180 - delta);
}

function ringMatch(point, routeBearing, candidate, matchM) {
  let best = Infinity;
  let bestBearing = null;
  for (const rawPath of candidate?.paths || []) {
    const path = rawPath.map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }));
    for (let index = 1; index < path.length; index += 1) {
      const distance = distanceToLineSegment(point, path[index - 1], path[index]);
      if (distance < best) {
        best = distance;
        bestBearing = computeBearing(path[index - 1], path[index]);
      }
    }
  }
  return best <= matchM
    && Number.isFinite(bestBearing)
    && angleToUndirectedLine(routeBearing, bestBearing) <= MAX_ALIGNMENT_DELTA_DEG;
}

function pointMatches(point, routeBearing, candidate, matchM) {
  if (candidate?.classification === "mini_roundabout") {
    return getDistance(point, candidate.center) <= Math.max(1, Number(candidate.radiusM) || 10);
  }
  return ringMatch(point, routeBearing, candidate, matchM);
}

function interpolate(a, b, fraction) {
  return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
}

function refineBoundary(a, b, routeBearing, candidate, matchM, lowT, highT, targetInside) {
  let low = lowT;
  let high = highT;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const mid = (low + high) / 2;
    const inside = pointMatches(interpolate(a, b, mid), routeBearing, candidate, matchM);
    if (inside === targetInside) high = mid;
    else low = mid;
  }
  return high;
}

function intervalsForCandidate(candidate, points, arc, options) {
  const matchM = candidate?.classification === "mini_roundabout"
    ? Math.max(1, Number(candidate.radiusM) || 10)
    : options.ringMatchM;
  const bounds = candidateBounds(candidate, matchM);
  if (!bounds) return [];
  const intervals = [];
  let activeStart = null;
  let lastProgress = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const startM = arc.cumDist[index - 1];
    const endM = arc.cumDist[index];
    const lengthM = endM - startM;
    if (lengthM <= 0) continue;
    const bearing = computeBearing(a, b);
    if (!segmentIntersectsBounds(a, b, bounds)) {
      if (activeStart !== null) {
        intervals.push([activeStart, startM]);
        activeStart = null;
      }
      lastProgress = endM;
      continue;
    }
    const steps = Math.max(1, Math.ceil(lengthM / SAMPLE_STEP_M));
    let previousT = 0;
    let previousInside = pointMatches(a, bearing, candidate, matchM);
    if (previousInside && activeStart === null) activeStart = startM;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const inside = pointMatches(interpolate(a, b, t), bearing, candidate, matchM);
      if (inside !== previousInside) {
        const boundaryT = refineBoundary(
          a, b, bearing, candidate, matchM, previousT, t, inside,
        );
        const boundaryM = startM + boundaryT * lengthM;
        if (inside) activeStart = boundaryM;
        else if (activeStart !== null) {
          intervals.push([activeStart, boundaryM]);
          activeStart = null;
        }
      }
      previousInside = inside;
      previousT = t;
    }
    lastProgress = endM;
  }
  if (activeStart !== null) intervals.push([activeStart, lastProgress]);
  return intervals.filter(([start, end]) => end - start >= options.minMatchedRouteM);
}

export function roundaboutsOnRoute(roundabouts, routeGeometry, options = {}) {
  const normalized = normalizedGeometry(routeGeometry);
  if (!normalized || !Array.isArray(roundabouts) || roundabouts.length === 0) return [];
  const opts = {
    ringMatchM: Number(options.ringMatchM) || RING_MATCH_M,
    minMatchedRouteM: Number(options.minMatchedRouteM) || MIN_MATCHED_ROUTE_M,
    courseSampleOffsetM: Number(options.courseSampleOffsetM) || COURSE_SAMPLE_OFFSET_M,
  };
  const { points, arc } = normalized;
  const total = arc.totalDistMeters;
  const traversals = [];
  for (const candidate of roundabouts) {
    if (!candidate?.id || !candidateBounds(candidate, opts.ringMatchM)) continue;
    for (const [entryMeters, exitMeters] of intervalsForCandidate(candidate, points, arc, opts)) {
      const complete = entryMeters > 0.5 && exitMeters < total - 0.5;
      const entrySample = complete
        ? pointAndBearingAtDistance(arc, points, Math.max(0, entryMeters - opts.courseSampleOffsetM))
        : null;
      const exitSample = complete
        ? pointAndBearingAtDistance(arc, points, Math.min(total, exitMeters + opts.courseSampleOffsetM))
        : null;
      traversals.push({
        kind: "roundabout",
        roundaboutId: candidate.id,
        lat: Number(candidate.center?.lat),
        lng: Number(candidate.center?.lng),
        entryMeters,
        exitMeters,
        entryBearingDeg: entrySample?.bearingDeg ?? null,
        exitBearingDeg: exitSample?.bearingDeg ?? null,
        complete,
      });
    }
  }
  return traversals.sort((a, b) => a.entryMeters - b.entryMeters || a.roundaboutId.localeCompare(b.roundaboutId));
}
