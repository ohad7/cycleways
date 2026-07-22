// The empty route-state shape, kept in its own dependency-free module so that
// read-only consumers (e.g. the featured-route snapshot loader) can reuse the
// shape without importing the full routing engine (route-encoding/route-data
// and the route actions in routeActions.js). routeActions.js re-exports this.
export function emptyRouteSnapshot() {
  return {
    points: [],
    selectedSegments: [],
    geometry: [],
    distance: 0,
    elevationGain: 0,
    elevationLoss: 0,
    activeDataPoints: [],
    routeFailure: null,
    segmentSpans: [],
    guidanceSpans: [],
    guidanceMode: "legacy",
    routingValidation: null,
  };
}
