const MIN_MAP_PLAYBACK_SECONDS = 35;
const MAX_MAP_PLAYBACK_SECONDS = 80;

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function computeMapPlaybackDuration({
  distanceMeters,
  elevationGainMeters,
  cueCount,
} = {}) {
  const distanceKm = finiteNonNegative(distanceMeters) / 1000;
  const elevationGainM = finiteNonNegative(elevationGainMeters);
  const cues = finiteNonNegative(cueCount);
  const seconds = 26 + distanceKm * 2 + cues * 1.8 + elevationGainM / 300;
  return Math.round(clamp(
    seconds,
    MIN_MAP_PLAYBACK_SECONDS,
    MAX_MAP_PLAYBACK_SECONDS,
  ));
}

export {
  MIN_MAP_PLAYBACK_SECONDS,
  MAX_MAP_PLAYBACK_SECONDS,
};
