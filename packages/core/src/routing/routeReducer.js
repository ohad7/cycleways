export const initialRouteState = {
  status: "initializing",
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
  pendingPoints: [],
  routingPhase: "idle",
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
        routeFailure: action.snapshot.routeFailure || null,
        segmentSpans: action.snapshot.segmentSpans || [],
        guidanceSpans: action.snapshot.guidanceSpans || [],
        guidanceMode: action.snapshot.guidanceMode || "legacy",
        routingValidation: action.snapshot.routingValidation || null,
        pendingPoints: action.preservePending ? state.pendingPoints : [],
        routingPhase:
          action.preservePending && state.pendingPoints.length > 0
            ? state.routingPhase
            : "idle",
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
        routeFailure: null,
        segmentSpans: [],
        guidanceSpans: [],
        guidanceMode: "legacy",
        routingValidation: null,
        pendingPoints: [],
        routingPhase: "idle",
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

    case "route/addPendingPoint":
      return {
        ...state,
        pendingPoints: [...state.pendingPoints, action.point],
        routingPhase: action.phase || "loading-shards",
        error: null,
      };

    case "route/removePendingPoint": {
      const pendingPoints = state.pendingPoints.filter(
        (point) => point.id !== action.id,
      );
      return {
        ...state,
        pendingPoints,
        routingPhase:
          pendingPoints.length > 0 ? state.routingPhase : "idle",
      };
    }

    case "route/clearPendingPoints":
      return {
        ...state,
        pendingPoints: [],
        routingPhase: "idle",
      };

    case "route/setRoutingPhase":
      if (state.routingPhase === action.phase) {
        return state;
      }
      return {
        ...state,
        routingPhase: action.phase,
      };

    case "route/setHoveredSegment":
      if (state.hoveredSegment === action.segmentName) {
        return state;
      }
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
