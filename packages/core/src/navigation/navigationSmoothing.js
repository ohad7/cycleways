// packages/core/src/navigation/navigationSmoothing.js
// Pure smoothing policy for the nav rider puck/camera. The RAF/clock glue lives
// natively; these are the testable decisions.

export function shortestAngleLerp(fromDeg, toDeg, t) {
  const diff = (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  return (((fromDeg + diff * t) % 360) + 360) % 360;
}

export function nextSmoothedMeters({
  current,
  target,
  dtMs,
  maxCatchupMs = 1500,
  snapThresholdM = 60,
  regressionToleranceM = 3,
}) {
  const delta = target - current;
  if (delta < 0 && Math.abs(delta) <= regressionToleranceM) return current; // jitter
  if (Math.abs(delta) > snapThresholdM) return target; // implausible jump / re-acquire
  const frac = Math.max(0, Math.min(1, dtMs / maxCatchupMs));
  return current + delta * frac;
}
