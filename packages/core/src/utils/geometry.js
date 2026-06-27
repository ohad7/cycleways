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

// Smallest absolute angular difference between two bearings (0-180 degrees).
export function bearingDelta(a, b) {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}
