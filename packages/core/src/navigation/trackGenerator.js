// packages/core/src/navigation/trackGenerator.js
// Deterministic synthetic GPS fix-stream generator for the replay harness.
import { computeBearing } from "../utils/geometry.js";
import { getDistance } from "../utils/distance.js";

const METERS_PER_DEG_LAT = 111320;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Linear interpolate a lat/lng along the geometry at a target distance (m).
function pointAtMeters(geometry, meters) {
  if (meters <= 0) return { ...geometry[0] };
  const last = geometry[geometry.length - 1];
  if (meters >= last.distanceFromStartMeters) return { ...last };
  for (let i = 1; i < geometry.length; i++) {
    if (geometry[i].distanceFromStartMeters >= meters) {
      const a = geometry[i - 1];
      const b = geometry[i];
      const span = b.distanceFromStartMeters - a.distanceFromStartMeters;
      const t = span > 0 ? (meters - a.distanceFromStartMeters) / span : 0;
      return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
    }
  }
  return { ...last };
}

function bearingAtMeters(geometry, meters) {
  for (let i = 1; i < geometry.length; i++) {
    if (geometry[i].distanceFromStartMeters >= meters) {
      return computeBearing(geometry[i - 1], geometry[i]);
    }
  }
  return computeBearing(geometry[geometry.length - 2], geometry[geometry.length - 1]);
}

function offsetPoint(point, bearing, meters) {
  if (!Number.isFinite(meters) || meters === 0) return point;
  const radians = ((bearing + 90) * Math.PI) / 180;
  const longitudeScale = Math.max(
    0.01,
    Math.abs(Math.cos((point.lat * Math.PI) / 180)),
  );
  return {
    lat: point.lat + (Math.cos(radians) * meters) / METERS_PER_DEG_LAT,
    lng:
      point.lng +
      (Math.sin(radians) * meters) / (METERS_PER_DEG_LAT * longitudeScale),
  };
}

export function generateTrack(navigationRoute, options = {}) {
  const {
    speedMps = 4,
    intervalMs = 1000,
    jitterM = 0,
    seed = 1,
    startTimestamp = 0,
    approachFrom = null,
    stopAtMeters = null,
    offRouteExcursion = null,
  } = options;
  const geometry = navigationRoute?.geometry ?? [];
  if (geometry.length < 2) return [];
  const rand = mulberry32(seed);
  const fixes = [];
  let timestamp = startTimestamp;
  const jitter = (lat) => {
    if (jitterM <= 0) return { dLat: 0, dLng: 0 };
    const dLat = ((rand() - 0.5) * 2 * jitterM) / METERS_PER_DEG_LAT;
    const dLng =
      ((rand() - 0.5) * 2 * jitterM) /
      (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    return { dLat, dLng };
  };

  // Approach lead-in (rider riding toward the route start).
  if (approachFrom) {
    const start = geometry[0];
    const approachDist = getDistance(approachFrom, start);
    const steps = Math.max(1, Math.round(approachDist / (speedMps * (intervalMs / 1000))));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      fixes.push({
        lat: approachFrom.lat + t * (start.lat - approachFrom.lat),
        lng: approachFrom.lng + t * (start.lng - approachFrom.lng),
        accuracy: 5,
        heading: computeBearing(approachFrom, start),
        speed: speedMps,
        timestamp,
      });
      timestamp += intervalMs;
    }
  }

  const total = geometry[geometry.length - 1].distanceFromStartMeters;
  const end = stopAtMeters === null ? total : Math.min(stopAtMeters, total);
  const stepMeters = speedMps * (intervalMs / 1000);
  for (let m = 0; m <= end + 1e-6; m += stepMeters) {
    const meters = Math.min(m, end);
    let p = pointAtMeters(geometry, meters);
    if (offRouteExcursion) {
      const startMeters = Number(offRouteExcursion.startMeters);
      const lengthMeters = Number(offRouteExcursion.lengthMeters ?? 160);
      const offsetMeters = Number(offRouteExcursion.offsetMeters ?? 120);
      const phase = (meters - startMeters) / lengthMeters;
      if (
        Number.isFinite(startMeters) &&
        Number.isFinite(lengthMeters) &&
        lengthMeters > 0 &&
        Number.isFinite(offsetMeters) &&
        phase > 0 &&
        phase < 1
      ) {
        // A smooth leave-and-return arc creates a sustained, moving deviation.
        // This is more representative than teleporting fixes away from the route
        // and gives the connector lifecycle enough time to become observable.
        p = offsetPoint(
          p,
          bearingAtMeters(geometry, meters),
          Math.sin(Math.PI * phase) * offsetMeters,
        );
      }
    }
    const { dLat, dLng } = jitter(p.lat);
    fixes.push({
      lat: p.lat + dLat,
      lng: p.lng + dLng,
      accuracy: jitterM > 0 ? Math.max(5, jitterM) : 5,
      heading: bearingAtMeters(geometry, meters),
      speed: speedMps,
      timestamp,
    });
    timestamp += intervalMs;
    if (meters >= end) break;
  }
  return fixes;
}
