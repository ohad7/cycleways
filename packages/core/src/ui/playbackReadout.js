// Single source for the m:ss playback readout used by the web and native
// playback controls.
export function formatPlaybackTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
