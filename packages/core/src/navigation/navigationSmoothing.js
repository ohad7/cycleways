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

export function mediaAlignedProgressMeters({
  progressMeters,
  speedMetersPerSecond,
  fixTimestampMs,
  mediaTimeMs,
  maxExtrapolationMs = 1250,
}) {
  const progress = Number(progressMeters);
  const speed = Number(speedMetersPerSecond);
  const fixTime = Number(fixTimestampMs);
  const mediaTime = Number(mediaTimeMs);
  if (![progress, speed, fixTime, mediaTime].every(Number.isFinite) || speed <= 0) {
    return Number.isFinite(progress) ? progress : 0;
  }
  const elapsedMs = Math.max(0, Math.min(Number(maxExtrapolationMs) || 0, mediaTime - fixTime));
  return progress + speed * elapsedMs / 1000;
}
