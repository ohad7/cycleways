// packages/core/src/navigation/replayRunner.js
// Pure node harness: drive the real navigation session over a recorded or
// generated fix stream and capture the resulting state timeline. No clocks —
// timestamps come from the fixes.
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "./navigationSession.js";
import { getDistance } from "../utils/distance.js";

function geometryDistance(geometry) {
  let distance = 0;
  for (let index = 1; index < (geometry?.length || 0); index++) {
    distance += getDistance(geometry[index - 1], geometry[index]);
  }
  return distance;
}

export function replaySession(navigationRoute, fixes, options = {}) {
  const session = createNavigationSession(navigationRoute, options.sessionOptions);
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const timeline = [];
  const routeRequests = [];
  const handledRequests = new Set();
  for (const fix of Array.isArray(fixes) ? fixes : []) {
    session.dispatch({ type: NAV_ACTIONS.LOCATION, fix });
    timeline.push(session.getState());
    const request = session.getState().routeRequest;
    if (!request || handledRequests.has(request.requestId)) continue;
    handledRequests.add(request.requestId);
    routeRequests.push(request);
    if (options.controlledConnector || typeof options.connectorRouter !== "function") {
      continue;
    }
    const result = options.connectorRouter(request);
    if (result && typeof result.then === "function") {
      throw new Error("replaySession connectorRouter must be synchronous");
    }
    if (result?.failure) {
      session.dispatch({
        type: NAV_ACTIONS.CONNECTOR_FAILED,
        requestId: request.requestId,
        reason: result.failure,
      });
    } else if (Array.isArray(result?.geometry)) {
      session.dispatch({
        type: NAV_ACTIONS.CONNECTOR_READY,
        requestId: request.requestId,
        geometry: result.geometry,
        distanceMeters:
          Number.isFinite(Number(result.distanceMeters)) && Number(result.distanceMeters) > 0
            ? Number(result.distanceMeters)
            : geometryDistance(result.geometry),
        snappedEndpoints: result.snappedEndpoints || [],
      });
    }
    timeline.push(session.getState());
  }
  return {
    timeline,
    last: timeline[timeline.length - 1] ?? session.getState(),
    routeRequests,
    session,
  };
}
