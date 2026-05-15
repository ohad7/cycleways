export const initialRouteState = {
  status: "initializing",
  points: [],
  selectedSegments: [],
  geometry: [],
  distance: 0,
  elevationGain: 0,
  elevationLoss: 0,
  activeDataPoints: [],
  hoveredSegment: null,
  focusedSegment: null,
  error: null,
};

export function routeReducer(state, action) {
  switch (action.type) {
    case "route/managerReady":
      return {
        ...state,
        status: "ready",
        error: null,
      };

    case "route/update":
      return {
        ...state,
        status: "ready",
        points: action.snapshot.points,
        selectedSegments: action.snapshot.selectedSegments,
        geometry: action.snapshot.geometry,
        distance: action.snapshot.distance,
        elevationGain: action.snapshot.elevationGain,
        elevationLoss: action.snapshot.elevationLoss,
        activeDataPoints: action.snapshot.activeDataPoints,
        hoveredSegment: null,
        focusedSegment: null,
        error: null,
      };

    case "route/clear":
      return {
        ...state,
        points: [],
        selectedSegments: [],
        geometry: [],
        distance: 0,
        elevationGain: 0,
        elevationLoss: 0,
        activeDataPoints: [],
        error: null,
      };

    case "route/error":
      return {
        ...state,
        error: action.error,
      };

    case "route/clearError":
      return {
        ...state,
        error: null,
      };

    case "route/setHoveredSegment":
      return {
        ...state,
        hoveredSegment: action.segmentName,
      };

    case "route/setFocusedSegment":
      return {
        ...state,
        focusedSegment:
          state.focusedSegment === action.segmentName ? null : action.segmentName,
      };

    default:
      return state;
  }
}
