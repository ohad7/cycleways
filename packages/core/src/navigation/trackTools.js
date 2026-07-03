// Pure post-processors for GPS fix arrays (nav-scenario-harness). They apply
// equally to generated tracks (trackGenerator) and recorded rides, so effects
// like signal gaps and standing dwells stay out of the generator itself.
import { getDistance } from "../utils/distance.js";
import { createSeededRandom } from "./trackGenerator.js";

const METERS_PER_DEG_LAT = 111320;

// Cumulative along-track meters per fix (straight-line between consecutive
// fixes). Jitter inflates this slightly; author gap/dwell scenarios with
// jitterM 0 when the meter positions need to be exact.
export function cumulativeFixMeters(fixes) {
  const meters = new Array(fixes.length).fill(0);
  for (let i = 1; i < fixes.length; i++) {
    meters[i] = meters[i - 1] + getDistance(fixes[i - 1], fixes[i]);
  }
  return meters;
}

// Drop fixes whose along-track position is in [startMeters, endMeters).
// Timestamps are untouched, so the survivors carry a time jump — a GPS gap.
export function applyGpsGap(fixes, { startMeters, endMeters } = {}) {
  if (
    !Number.isFinite(startMeters) ||
    !Number.isFinite(endMeters) ||
    endMeters <= startMeters
  ) {
    throw new Error("applyGpsGap requires finite startMeters < endMeters");
  }
  const meters = cumulativeFixMeters(fixes);
  return fixes.filter((_, i) => meters[i] < startMeters || meters[i] >= endMeters);
}

// Insert a stationary dwell (rider stops and stands) at the first fix at or
// after `atMeters`: zero-speed fixes jittering around that point, with all
// later timestamps shifted by the dwell duration.
export function insertDwell(
  fixes,
  { atMeters, durationMs, intervalMs = 1000, jitterM = 3, seed = 1 } = {},
) {
  if (!Number.isFinite(atMeters) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("insertDwell requires finite atMeters and durationMs > 0");
  }
  const meters = cumulativeFixMeters(fixes);
  const at = meters.findIndex((m) => m >= atMeters);
  if (at === -1) {
    throw new Error(`insertDwell: track is shorter than atMeters=${atMeters}`);
  }
  const anchor = fixes[at];
  const rand = createSeededRandom(seed);
  const lngScale = Math.max(0.01, Math.abs(Math.cos((anchor.lat * Math.PI) / 180)));
  const count = Math.max(1, Math.round(durationMs / intervalMs));
  const shiftMs = count * intervalMs;
  const dwellFixes = [];
  for (let i = 1; i <= count; i++) {
    dwellFixes.push({
      ...anchor,
      lat: anchor.lat + ((rand() - 0.5) * 2 * jitterM) / METERS_PER_DEG_LAT,
      lng:
        anchor.lng +
        ((rand() - 0.5) * 2 * jitterM) / (METERS_PER_DEG_LAT * lngScale),
      speed: 0,
      timestamp: anchor.timestamp + i * intervalMs,
    });
  }
  const shifted = fixes
    .slice(at + 1)
    .map((f) => ({ ...f, timestamp: f.timestamp + shiftMs }));
  return [...fixes.slice(0, at + 1), ...dwellFixes, ...shifted];
}
