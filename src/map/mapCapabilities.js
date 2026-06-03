// Map capability model. A `mode` string is translated into an explicit set of
// capability booleans so that MapSurface gates each behavior on a named flag
// rather than scattering `mode === ...` checks. Keeping the mapping here (a
// pure, dependency-free helper) makes it unit-testable and keeps the planner
// behavior a single, auditable "everything on" path.
//
// See plans/featured-route-map-snapshots/design.md ("Map Modularity") for the
// authoritative list of what each mode enables/disables.

export const MAP_MODE_PLANNER = "planner";
export const MAP_MODE_READONLY_ROUTE = "readonly-route";

// The full planner capability set. Every flag is true: this is the zero-diff
// path that preserves the main app at `/` exactly as before.
function plannerCapabilities() {
  return {
    // Map shell.
    mapInit: true,
    baseStyle: true,
    // CycleWays display network: source/layers + hover/click snapping.
    networkLayers: true,
    networkHitTest: true,
    // Ghost "hover-preview" point that trails the cursor along the network.
    hoverPreview: true,
    // Computed route line + its drag-preview ghost.
    routeGeometryLayer: true,
    routePointDragPreview: true,
    // User-placed waypoint markers + their interactions.
    routePointLayers: true,
    routePointSelect: true,
    routePointEditing: true,
    routeLineEditing: true,
    // Route fit + focused-marker camera.
    routeFit: true,
    focusedMarkerCamera: true,
    // Data markers (POIs) layer + click callback.
    dataMarkerLayer: true,
    dataMarkerClick: true,
    // Video playback cursor layer + route click (video sync) callback.
    videoCursorLayer: true,
    routeClickCallback: true,
    // Direction pulse + elevation-profile cursor pulse.
    directionPulse: true,
    elevationPulse: true,
    // Searched-location highlight.
    searchHighlight: true,
    // Viewport prefetch: user-viewport-change + viewport-idle reporting.
    viewportPrefetch: true,
  };
}

// Read-only featured-route capabilities. Enables only what a public, authored
// route page needs to display and sync with video; disables every planner-only
// editing/network/prefetch capability.
function readonlyRouteCapabilities() {
  return {
    mapInit: true,
    baseStyle: true,
    networkLayers: false,
    networkHitTest: false,
    hoverPreview: false,
    routeGeometryLayer: true,
    routePointDragPreview: false,
    routePointLayers: false,
    routePointSelect: false,
    routePointEditing: false,
    routeLineEditing: false,
    routeFit: true,
    focusedMarkerCamera: true,
    dataMarkerLayer: true,
    dataMarkerClick: true,
    videoCursorLayer: true,
    routeClickCallback: true,
    directionPulse: false,
    elevationPulse: false,
    searchHighlight: false,
    viewportPrefetch: false,
  };
}

// Pure mapping from a mode string to its capability booleans. Unknown modes
// fall back to the planner set so callers never accidentally lose capabilities.
export function capabilitiesForMode(mode = MAP_MODE_PLANNER) {
  if (mode === MAP_MODE_READONLY_ROUTE) {
    return readonlyRouteCapabilities();
  }
  return plannerCapabilities();
}
