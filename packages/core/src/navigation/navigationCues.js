// Navigation cue generation (design D4/D7 / implementation-plan Phase 5).
//
// Split into a pure static builder and a cheap per-fix selector:
//   buildRouteCues(navigationRoute)        -> deterministic ordered cue list
//   selectActiveCue(cues, progressMeters)  -> the upcoming cue + scheduling phase
//
// Cues are intentionally conservative (design D4): route start/end, sharp
// geometry turns (deduped so dense geometry noise does not spam), and on-route
// hazards/POIs that already carry `routeProgressMeters`. Where cue data is weak
// the UI falls back to "continue on route".

import { computeBearing } from "../utils/geometry.js";

const TURN_THRESHOLD_DEG = 40; // min heading change to emit a turn cue
const MIN_TURN_SPACING_M = 20; // suppress turns closer than this (geometry noise)
const PREVIEW_MAX_M = 120; // upper bound of the preview window before a cue
const FINAL_MAX_M = 35; // within this, the cue is "final"

// Signed turn angle in (-180, 180]: positive = right (clockwise), negative = left.
function signedTurn(bearingIn, bearingOut) {
  return ((bearingOut - bearingIn + 540) % 360) - 180;
}

export function buildRouteCues(navigationRoute) {
  const geometry = Array.isArray(navigationRoute?.geometry)
    ? navigationRoute.geometry
    : [];
  if (geometry.length < 2) return [];

  const totalMeters = geometry[geometry.length - 1].distanceFromStartMeters;
  const cues = [{ type: "start", distanceMeters: 0 }];

  // Turn cues from sharp heading deltas, distance-gated to avoid spam.
  let lastTurnDistance = -Infinity;
  for (let i = 1; i < geometry.length - 1; i++) {
    const bearingIn = computeBearing(geometry[i - 1], geometry[i]);
    const bearingOut = computeBearing(geometry[i], geometry[i + 1]);
    const turn = signedTurn(bearingIn, bearingOut);
    const angle = Math.abs(turn);
    if (angle < TURN_THRESHOLD_DEG) continue;
    const distanceMeters = geometry[i].distanceFromStartMeters;
    if (distanceMeters - lastTurnDistance < MIN_TURN_SPACING_M) continue;
    lastTurnDistance = distanceMeters;
    cues.push({
      type: "turn",
      distanceMeters,
      direction: turn > 0 ? "right" : "left",
      turnAngleDeg: angle,
    });
  }

  // Hazard/POI cues from on-route active data points.
  const dataPoints = Array.isArray(navigationRoute?.activeDataPoints)
    ? navigationRoute.activeDataPoints
    : [];
  for (const dp of dataPoints) {
    const distanceMeters = Number(dp?.routeProgressMeters);
    if (!Number.isFinite(distanceMeters)) continue;
    if (distanceMeters < 0 || distanceMeters > totalMeters) continue;
    cues.push({
      type: dp.type || "poi",
      distanceMeters,
      dataPointId: dp.id || null,
      segmentName: dp.segmentName || null,
    });
  }

  cues.push({ type: "arrive", distanceMeters: totalMeters });

  // Stable sort by distance keeps start first and arrive last.
  cues.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return cues;
}

// Nearest upcoming cue and its scheduling phase, or null when the next cue is
// still beyond the preview window.
export function selectActiveCue(cues, progressMeters) {
  if (!Array.isArray(cues)) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const cue of cues) {
    if (cue.type === "start") continue; // start is informational, not a maneuver
    const d = cue.distanceMeters - progressMeters;
    if (d < 0) continue; // already passed
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = cue;
    }
  }
  if (nearest === null || nearestDistance > PREVIEW_MAX_M) return null;
  return {
    cue: nearest,
    distanceToCueMeters: nearestDistance,
    phase: nearestDistance <= FINAL_MAX_M ? "final" : "preview",
  };
}
