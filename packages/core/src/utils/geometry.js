// Shared route-geometry helpers (arc length + bearing) used by the route
// direction animator and the navigation route-progress engine, so the bearing
// math lives in exactly one place.

import { getDistance } from "./distance.js";

// Cumulative arc length (meters) for a polyline, plus the total.
export function precomputeArcLength(geometry) {
  const n = geometry.length;
  const cumDist = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const segment = getDistance(geometry[i - 1], geometry[i]);
    acc += Number.isFinite(segment) && segment > 0 ? segment : 0;
    cumDist[i] = acc;
  }
  return { cumDist, totalDistMeters: acc };
}

// Initial bearing (degrees, 0-360, 0 = north) from `from` to `to`.
export function computeBearing(from, to) {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

// Point and bearing at a given distance (meters) along the arc.
// Clamps meters to [0, totalDistMeters]; binary-searches cumDist; linearly
// interpolates the point on the bracketing segment; bearing = segment bearing.
export function pointAndBearingAtDistance(arc, geometry, meters) {
  const total = arc.totalDistMeters;
  const target = Math.max(0, Math.min(meters, total));
  const cum = arc.cumDist;
  // binary search: largest i with cum[i] <= target
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const i = Math.min(lo, geometry.length - 2);
  const a = geometry[i];
  const b = geometry[i + 1];
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (target - cum[i]) / segLen : 0;
  return {
    point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) },
    bearingDeg: computeBearing(a, b),
  };
}

// Smallest absolute angular difference between two bearings (0-180 degrees).
export function bearingDelta(a, b) {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}
