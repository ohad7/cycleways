// Camera math for the "orient to nearby network" move that runs when the user
// enters Build from Discover with an empty planner. Rather than fitting the
// entire CW network (a jarring, country-wide zoom-out), we keep the current
// center and step the zoom out by a fixed amount so the surrounding network
// comes into view — a modest "one step wider" framing of where they already are.

// How many zoom levels to step out from the current view. One full level ≈ 2x
// linear scale ("one step wider"). Tuned against the live map.
export const BUILD_ORIENT_ZOOM_OUT = 1;

// Never step out past this floor: keeps the move a local orient, not a
// whole-country view (the full network fits around zoom ~8, initial view 11.5).
export const BUILD_ORIENT_MIN_ZOOM = 8;

// Pure: given the current map zoom, return the zoom to ease to. Returns null
// for non-finite input so callers can skip the camera move entirely.
export function buildOrientZoom(
  currentZoom,
  { delta = BUILD_ORIENT_ZOOM_OUT, minZoom = BUILD_ORIENT_MIN_ZOOM } = {},
) {
  if (!Number.isFinite(currentZoom)) return null;
  return Math.max(currentZoom - delta, minZoom);
}
