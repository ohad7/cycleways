// Featured-page layout selector. `?layout=overlay` opts into the desktop
// map-on-video layout; anything else (incl. absent) is the current layout.
export const DEFAULT = "default";
export const OVERLAY = "overlay";

export function featuredLayoutFromParam(value) {
  return value === OVERLAY ? OVERLAY : DEFAULT;
}
