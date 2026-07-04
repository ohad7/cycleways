// Rider-puck anchoring during navigation. While the cross-track error is
// within GPS noise the puck is drawn ON the route line (snapping hides
// per-fix jitter); when the rider is genuinely beside the route — a parallel
// path, still inside the off-route threshold — the puck must show the
// detected location instead of pretending they are on the track. Hysteresis
// (detach high, re-attach low) keeps the puck from flip-flopping at the
// boundary, mirroring the off-route state machine in routeProgress.js.

// The gap between the thresholds must exceed the GPS jitter amplitude
// (~±8 m), otherwise the puck flip-flops while riding a parallel path whose
// offset ramps through the band (verified over the parallel-path scenario).
const DEFAULTS = {
  detachMeters: 18, // beyond this, show the detected location
  reattachMeters: 8, // back under this, snap to the route line again
};

export function createPuckAnchor(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (opts.reattachMeters >= opts.detachMeters) {
    throw new Error("puck anchor: reattachMeters must be below detachMeters");
  }
  let mode = "route";

  return {
    // crossTrackMeters -> "route" | "detected"; non-finite input (no
    // projection this fix) keeps the current mode.
    update(crossTrackMeters) {
      const meters = Number(crossTrackMeters);
      if (Number.isFinite(meters)) {
        if (mode === "route" && meters > opts.detachMeters) mode = "detected";
        else if (mode === "detected" && meters < opts.reattachMeters) mode = "route";
      }
      return mode;
    },
    reset() {
      mode = "route";
    },
  };
}
