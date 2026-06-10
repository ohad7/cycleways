export const INITIAL_PANEL_STATE = { state: "discover", lastPointCount: 0 };

// Pure reducer for the Discover/Build panel.
// Events:
//   { type: "toggle", to: "discover" | "build" }      explicit user switch
//   { type: "route-points-changed", pointCount }       route geometry changed
export function resolvePanelState(prev, event) {
  if (event.type === "toggle") {
    return { ...prev, state: event.to };
  }
  if (event.type === "route-points-changed") {
    const wasEmpty = prev.lastPointCount === 0;
    const nowHasPoint = event.pointCount > 0;
    // Auto-switch to build only on the empty -> first-point transition.
    const state = wasEmpty && nowHasPoint ? "build" : prev.state;
    return { state, lastPointCount: event.pointCount };
  }
  return prev;
}
