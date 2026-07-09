import {
  computeBearing,
  pointAndBearingAtDistance,
  precomputeArcLength,
} from "../utils/geometry.js";
import { getDistance } from "../utils/distance.js";

const EARTH_METERS_PER_DEGREE = 111320;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function validPoint(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
}

function normalizedGeometry(geometry) {
  return (Array.isArray(geometry) ? geometry : [])
    .filter(validPoint)
    .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }));
}

function pointAt(arc, geometry, meters) {
  return pointAndBearingAtDistance(arc, geometry, meters).point;
}

export function cameraCorridorForProgress(geometry, progressMeters, options = {}) {
  const points = normalizedGeometry(geometry);
  if (points.length < 2) return points;
  const arc = precomputeArcLength(points);
  const progress = clamp(Number(progressMeters) || 0, 0, arc.totalDistMeters);
  const startMeters = clamp(progress - Math.max(0, Number(options.behindMeters) || 0), 0, arc.totalDistMeters);
  const endMeters = clamp(progress + Math.max(0, Number(options.lookaheadMeters) || 0), 0, arc.totalDistMeters);
  const corridor = [pointAt(arc, points, startMeters)];
  for (let index = 1; index < points.length - 1; index += 1) {
    const meters = arc.cumDist[index];
    if (meters > startMeters && meters < endMeters) corridor.push(points[index]);
  }
  corridor.push(pointAt(arc, points, endMeters));
  return corridor;
}

export function cameraManeuverCorridor(
  geometry,
  riderMeters,
  cueMeters,
  options = {},
) {
  const behindMeters = Math.max(0, Number(options.behindMeters) || 30);
  const postManeuverMeters = Math.max(0, Number(options.postManeuverMeters) || 90);
  const lookaheadMeters = Math.max(
    0,
    Number(cueMeters) + postManeuverMeters - Number(riderMeters || 0),
  );
  return cameraCorridorForProgress(geometry, riderMeters, {
    behindMeters,
    lookaheadMeters,
  });
}

export function cameraCorridorBearing(geometry, progressMeters, options = {}) {
  const points = normalizedGeometry(geometry);
  if (points.length < 2) return null;
  const arc = precomputeArcLength(points);
  const progress = clamp(Number(progressMeters) || 0, 0, arc.totalDistMeters);
  const start = pointAt(arc, points, progress);
  const end = pointAt(
    arc,
    points,
    clamp(
      progress + Math.max(20, Number(options.sampleMeters) || 70),
      0,
      arc.totalDistMeters,
    ),
  );
  return getDistance(start, end) < 1 ? null : computeBearing(start, end);
}

export function cameraDominantBearing(geometry) {
  const points = normalizedGeometry(geometry);
  if (points.length < 2) return null;
  let best = null;
  let bestDistance = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = getDistance(points[index], points[index + 1]);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = computeBearing(points[index], points[index + 1]);
    }
  }
  return best;
}

function localExtents(geometry, bearingDeg = 0) {
  const points = normalizedGeometry(geometry);
  if (points.length === 0) return null;
  const origin = points[0];
  const latitudeScale = Math.max(0.05, Math.cos((origin.lat * Math.PI) / 180));
  const theta = (-Number(bearingDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rotated = points.map((point) => {
    const x = (point.lng - origin.lng) * EARTH_METERS_PER_DEGREE * latitudeScale;
    const y = (point.lat - origin.lat) * EARTH_METERS_PER_DEGREE;
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  });
  return {
    latitude: origin.lat,
    widthMeters: Math.max(1, Math.max(...rotated.map((p) => p.x)) - Math.min(...rotated.map((p) => p.x))),
    heightMeters: Math.max(1, Math.max(...rotated.map((p) => p.y)) - Math.min(...rotated.map((p) => p.y))),
  };
}

// Semantic phone-scale estimate used to govern follow zoom. Exact perspective
// placement remains native Mapbox's responsibility and is validated on-screen.
export function cameraTargetZoom({
  geometry,
  viewport,
  pitch = 0,
  bearing = 0,
  minZoom = 0,
  maxZoom = 22,
}) {
  const extents = localExtents(geometry, bearing);
  if (!extents) return clamp(16, minZoom, maxZoom);
  const widthPx = Math.max(80, Number(viewport?.usableWidth || viewport?.width) || 320);
  const heightPx = Math.max(80, Number(viewport?.usableHeight || viewport?.height) || 480);
  const pitchFraction = clamp(Number(pitch) || 0, 0, 60) / 60;
  const effectiveHeightPx = heightPx * (1 - 0.32 * pitchFraction);
  const metersPerPixel = Math.max(
    extents.widthMeters / widthPx,
    extents.heightMeters / effectiveHeightPx,
    0.01,
  );
  const latitudeScale = Math.max(
    0.05,
    Math.cos((extents.latitude * Math.PI) / 180),
  );
  const zoom = Math.log2((156543.03392 * latitudeScale) / metersPerPixel);
  return clamp(zoom, minZoom, maxZoom);
}

export function nextAppliedZoom({ current, target, dtMs, policy = {}, force = false }) {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  const deadBand = Math.max(0, Number(policy.deadBand) || 0.15);
  const delta = target - current;
  if (!force && Math.abs(delta) <= deadBand) return current;
  const maxVelocity = Math.max(0.01, Number(policy.maxVelocityPerSecond) || 0.7);
  const maxStep = maxVelocity * Math.max(0, Number(dtMs) || 0) / 1000;
  if (maxStep <= 0) return current;
  return current + clamp(delta, -maxStep, maxStep);
}

export function cameraPitchForRegionalZoom(targetPitch, zoom) {
  const pitch = Math.max(0, Number(targetPitch) || 0);
  if (!Number.isFinite(zoom)) return pitch;
  if (zoom <= 10.5) return 0;
  if (zoom <= 12) return Math.min(pitch, 20);
  if (zoom <= 13) return Math.min(pitch, 30);
  return pitch;
}

export function cameraGeometryKey(geometry, decimals = 5) {
  const points = normalizedGeometry(geometry);
  if (points.length === 0) return "empty";
  return points
    .map((point) => `${point.lng.toFixed(decimals)},${point.lat.toFixed(decimals)}`)
    .join("|");
}

export function shouldReframeOverview(previous, next, policy = {}) {
  if (!previous) return { reframe: true, reason: "initial" };
  if (previous.geometryKey !== next.geometryKey) {
    return { reframe: true, reason: "geometry" };
  }
  if (previous.viewportKey !== next.viewportKey) {
    return { reframe: true, reason: "viewport" };
  }
  const minMoveMeters = Math.max(0, Number(policy.minMoveMeters) || 35);
  if (validPoint(previous.rider) && validPoint(next.rider)) {
    if (getDistance(previous.rider, next.rider) >= minMoveMeters) {
      return { reframe: true, reason: "rider-moved" };
    }
  }
  return { reframe: false, reason: "stable" };
}

