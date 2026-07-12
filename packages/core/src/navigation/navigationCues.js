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

import { getDistance } from "../utils/distance.js";
import { computeBearing } from "../utils/geometry.js";

const TURN_THRESHOLD_DEG = 40; // min heading change to emit a turn cue
// With junction data on the route, sharp corners away from any junction are
// "bends" (עיקול) — the road curving, not a decision — and need to be sharper
// than a turn to be worth announcing. Moderate open-road curves cue nothing.
const BEND_THRESHOLD_DEG = 75;
const JUNCTION_GATE_M = 30; // corner within this of a junction node = a turn
const MIN_TURN_SPACING_M = 10; // hard floor for geometry noise
const COMPOUND_TURN_WINDOW_M = 60;
const SPAN_MERGE_TOLERANCE_M = 20;
const PREVIEW_MAX_M = 120; // upper bound of the preview window before a cue
const ARRIVAL_PREVIEW_MAX_M = 200; // destination heads-up starts earlier
const FINAL_MAX_M = 35; // within this, the cue is "final"
export const ROUNDABOUT_DIRECTION_THRESHOLDS = { straightMaxDeg: 40, uTurnMaxDeg: 130 };
export const ROUNDABOUT_SUPPRESSION_PAD_M = 8;
const SELECTION_PRIORITY = {
  turn: 0,
  roundabout: 0,
  arrive: 0,
  bend: 1,
  caution: 1,
  hazard: 1,
  poi: 1,
  viewpoint: 1,
  "enter-segment": 2,
};

// Signed turn angle in (-180, 180]: positive = right (clockwise), negative = left.
function signedTurn(bearingIn, bearingOut) {
  return ((bearingOut - bearingIn + 540) % 360) - 180;
}

function isCompoundManeuver(cue) {
  return (
    (cue?.type === "turn" || cue?.type === "roundabout") &&
    !(cue.type === "roundabout" && cue.direction === "u-turn")
  );
}

function maneuverCompletionMeters(cue) {
  return cue?.type === "roundabout" && Number.isFinite(Number(cue.exitDistanceMeters))
    ? Number(cue.exitDistanceMeters)
    : Number(cue?.distanceMeters);
}

export function buildRouteCues(navigationRoute, options = {}) {
  const geometry = Array.isArray(navigationRoute?.geometry)
    ? navigationRoute.geometry
    : [];
  if (geometry.length < 2) return [];

  const totalMeters = geometry[geometry.length - 1].distanceFromStartMeters;
  const cues = [{ type: "start", distanceMeters: 0 }];

  // Turn/bend cues from sharp heading deltas, distance-gated to avoid spam.
  // With junction data (network nodes with 3+ edges, baked onto the route at
  // build/decode time): a corner at a junction is a turn, a sharp corner in
  // open road is a bend, a moderate open-road curve is nothing. Without
  // junction data every sharp corner stays a turn (legacy behavior).
  const junctions = Array.isArray(navigationRoute?.junctions)
    ? navigationRoute.junctions
    : null;
  const plainJunctions = junctions?.filter((junction) => junction?.kind !== "roundabout") || junctions;
  const roundaboutTraversals = junctions?.filter(
    (junction) =>
      junction?.kind === "roundabout"
      && Number.isFinite(Number(junction.entryMeters))
      && Number.isFinite(Number(junction.exitMeters))
      && Number(junction.exitMeters) >= Number(junction.entryMeters),
  ) || [];
  const cornerCues = [];
  let lastTurnDistance = -Infinity;
  for (let i = 1; i < geometry.length - 1; i++) {
    const distanceMeters = geometry[i].distanceFromStartMeters;
    if (roundaboutTraversals.some(
      (traversal) =>
        distanceMeters >= Number(traversal.entryMeters) - ROUNDABOUT_SUPPRESSION_PAD_M
        && distanceMeters <= Number(traversal.exitMeters) + ROUNDABOUT_SUPPRESSION_PAD_M,
    )) continue;
    const bearingIn = computeBearing(geometry[i - 1], geometry[i]);
    const bearingOut = computeBearing(geometry[i], geometry[i + 1]);
    const turn = signedTurn(bearingIn, bearingOut);
    const angle = Math.abs(turn);
    if (angle < TURN_THRESHOLD_DEG) continue;
    let type = "turn";
    if (plainJunctions) {
      const atJunction = plainJunctions.some(
        (j) => getDistance(geometry[i], j) <= JUNCTION_GATE_M,
      );
      if (!atJunction) {
        if (angle < BEND_THRESHOLD_DEG) continue;
        type = "bend";
      }
    }
    if (distanceMeters - lastTurnDistance < MIN_TURN_SPACING_M) continue;
    lastTurnDistance = distanceMeters;
    cornerCues.push({
      type,
      distanceMeters,
      direction: turn > 0 ? "right" : "left",
      turnAngleDeg: angle,
    });
  }

  for (const traversal of roundaboutTraversals) {
    if (
      traversal.complete !== true
      || !Number.isFinite(Number(traversal.entryBearingDeg))
      || !Number.isFinite(Number(traversal.exitBearingDeg))
    ) continue;
    const delta = signedTurn(Number(traversal.entryBearingDeg), Number(traversal.exitBearingDeg));
    const angle = Math.abs(delta);
    const direction = angle < ROUNDABOUT_DIRECTION_THRESHOLDS.straightMaxDeg
      ? "straight"
      : angle <= ROUNDABOUT_DIRECTION_THRESHOLDS.uTurnMaxDeg
        ? (delta > 0 ? "right" : "left")
        : "u-turn";
    cornerCues.push({
      type: "roundabout",
      direction,
      distanceMeters: Number(traversal.entryMeters),
      exitDistanceMeters: Number(traversal.exitMeters),
      roundaboutId: traversal.roundaboutId || null,
      turnAngleDeg: angle,
    });
  }
  cornerCues.sort((a, b) => a.distanceMeters - b.distanceMeters);

  // Link close decision pairs without removing the follow-up cue. For a
  // roundabout followed by another maneuver, proximity starts at the
  // roundabout exit rather than its entry. The voice
  // planner suppresses that follow-up only after it has actually accepted the
  // earlier compound instruction, so a missed first announcement cannot make
  // the second maneuver silent as well.
  for (let i = 0; i < cornerCues.length - 1; i += 1) {
    const current = cornerCues[i];
    const next = cornerCues[i + 1];
    const gapMeters = next.distanceMeters - maneuverCompletionMeters(current);
    if (
      isCompoundManeuver(current) &&
      isCompoundManeuver(next) &&
      gapMeters >= 0 &&
      gapMeters <= COMPOUND_TURN_WINDOW_M
    ) {
      current.thenManeuver = { type: next.type, direction: next.direction };
      // Preserve the original turn-turn field for older persisted sessions and
      // consumers while thenManeuver becomes the canonical representation.
      if (current.type === "turn" && next.type === "turn") {
        current.thenDirection = next.direction;
      }
      next.compoundPreviousType = current.type;
      next.compoundPreviousDistanceMeters = current.distanceMeters;
    }
  }
  cues.push(...cornerCues);

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

  if (options.includeArrival !== false) {
    cues.push({ type: "arrive", distanceMeters: totalMeters });
  }

  // Enter-segment cues at named span boundaries, with merge/suppression.
  const spans = Array.isArray(navigationRoute?.segmentSpans)
    ? navigationRoute.segmentSpans
    : [];
  const turnCues = cues.filter((c) => c.type === "turn");
  for (const span of spans) {
    if (!span.name || span.startMeters <= 0) continue;
    if (roundaboutTraversals.some(
      (traversal) =>
        span.startMeters >= Number(traversal.entryMeters) - ROUNDABOUT_SUPPRESSION_PAD_M
        && span.startMeters <= Number(traversal.exitMeters) + ROUNDABOUT_SUPPRESSION_PAD_M,
    )) continue;
    const near = turnCues.find(
      (t) =>
        Math.abs(t.distanceMeters - span.startMeters) <=
        SPAN_MERGE_TOLERANCE_M,
    );
    if (near) {
      near.ontoSegmentName = span.name; // merge into the turn
      continue;
    }
    cues.push({ type: "enter-segment", distanceMeters: span.startMeters, segmentName: span.name });
  }

  // Sort by distance; when distances tie, turn/arrive before enter-segment.
  const PRIORITY = { start: 0, turn: 1, roundabout: 1, arrive: 1, bend: 1, "enter-segment": 2 };
  cues.sort((a, b) =>
    a.distanceMeters - b.distanceMeters ||
    (PRIORITY[a.type] ?? 3) - (PRIORITY[b.type] ?? 3),
  );
  return cues;
}

// Nearest upcoming cue and its scheduling phase, or null when the next cue is
// still beyond the preview window.
export function selectActiveCue(cues, progressMeters) {
  if (!Array.isArray(cues)) return null;
  let selected = null;
  let selectedDistance = Infinity;
  let selectedPriority = Infinity;
  let selectedPhasePriority = Infinity;
  for (const cue of cues) {
    if (cue.type === "start") continue; // start is informational, not a maneuver
    const d = cue.distanceMeters - progressMeters;
    if (d < 0) continue; // already passed
    const previewMax = cue.type === "arrive" ? ARRIVAL_PREVIEW_MAX_M : PREVIEW_MAX_M;
    if (d > previewMax) continue;
    const phasePriority = d <= FINAL_MAX_M ? 0 : 1;
    const priority = SELECTION_PRIORITY[cue.type] ?? 1;
    if (
      phasePriority < selectedPhasePriority ||
      (phasePriority === selectedPhasePriority &&
        (priority < selectedPriority ||
          (priority === selectedPriority && d < selectedDistance)))
    ) {
      selectedPhasePriority = phasePriority;
      selectedPriority = priority;
      selectedDistance = d;
      selected = cue;
    }
  }
  if (selected === null) return null;
  return {
    cue: selected,
    distanceToCueMeters: selectedDistance,
    phase: selectedDistance <= FINAL_MAX_M ? "final" : "preview",
  };
}
