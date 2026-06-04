// Slow-start playback ramp for featured-page videos. The footage is a
// compressed ride, so starting at full speed is jarring. The opening stretch
// ramps 0.5 → 0.75 → 1.0 by distance from the route start, and composes with
// the existing POI-vicinity slowdown by taking the slower of the two. All
// outputs land on YouTube's allowed rates {0.5, 0.75, 1.0} so the player's
// setPlaybackRate always succeeds.

export const RAMP_STEP_1_M = 250;
export const RAMP_STEP_2_M = 500;
const RAMP_RATE_1 = 0.5;
const RAMP_RATE_2 = 0.75;
export const POI_PLAYBACK_RATE = 0.75;

// `rampDone` lets the caller disable the ramp outright — it is set true once
// the route distance has permanently passed RAMP_STEP_2_M, or after a user seek
// (the ramp only governs the first uninterrupted playthrough). When false, the
// ramp also self-completes by distance, so there are two paths to full speed.
export function computePlaybackRate({ distanceFromStartM, nearPoi, rampDone }) {
  const distance = Number.isFinite(distanceFromStartM) ? distanceFromStartM : 0;

  let base;
  if (rampDone) {
    base = 1;
  } else if (distance < RAMP_STEP_1_M) {
    base = RAMP_RATE_1;
  } else if (distance < RAMP_STEP_2_M) {
    base = RAMP_RATE_2;
  } else {
    base = 1; // past both ramp steps — full speed
  }

  return nearPoi ? Math.min(base, POI_PLAYBACK_RATE) : base;
}
