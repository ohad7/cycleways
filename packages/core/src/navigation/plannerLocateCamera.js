// Pure view-retention policy for the planner's locate-me action. Re-centering
// should preserve a rider's deliberate view whenever it is already useful,
// while a very wide or unknown view gets the established locate zoom.
export const LOCATE_MIN_ZOOM = 12;
export const LOCATE_TARGET_ZOOM = 14.5;

export function plannerLocateCameraView({ zoom, pitch } = {}) {
  return {
    zoomLevel:
      Number.isFinite(zoom) && zoom >= LOCATE_MIN_ZOOM
        ? zoom
        : LOCATE_TARGET_ZOOM,
    pitch: Number.isFinite(pitch) ? pitch : 0,
  };
}
