import assert from "node:assert/strict";
import { initialRouteState, routeReducer } from "@cycleways/core/routing/routeReducer.js";

const idleHoverState = {
  ...initialRouteState,
  status: "ready",
};
assert.equal(
  routeReducer(idleHoverState, {
    type: "route/setHoveredSegment",
    segmentName: null,
  }),
  idleHoverState,
  "repeated empty route hover updates must not rerender route state",
);

const hoveredState = routeReducer(idleHoverState, {
  type: "route/setHoveredSegment",
  segmentName: "Hovered segment",
});
assert.equal(hoveredState.hoveredSegment, "Hovered segment");
assert.equal(
  routeReducer(hoveredState, {
    type: "route/setHoveredSegment",
    segmentName: "Hovered segment",
  }),
  hoveredState,
  "repeated segment hover updates must preserve route state identity",
);

const pendingState = routeReducer(idleHoverState, {
  type: "route/addPendingPoint",
  point: {
    id: "pending-1",
    lat: 33,
    lng: 35,
    pending: true,
  },
});
assert.equal(pendingState.pendingPoints.length, 1);
assert.equal(pendingState.routingPhase, "loading-shards");

const updatedWithPending = routeReducer(pendingState, {
  type: "route/update",
  preservePending: true,
  snapshot: {
    points: [{ id: "route-point-1", lat: 33, lng: 35 }],
    selectedSegments: [],
    geometry: [],
    distance: 0,
    elevationGain: 0,
    elevationLoss: 0,
    activeDataPoints: [],
    routeFailure: null,
  },
});
assert.equal(updatedWithPending.pendingPoints.length, 1);

const clearedPending = routeReducer(updatedWithPending, {
  type: "route/removePendingPoint",
  id: "pending-1",
});
assert.equal(clearedPending.pendingPoints.length, 0);
assert.equal(clearedPending.routingPhase, "idle");

console.log("Route reducer hover tests passed");

// --- segmentSpans propagation through the reducer ---
{
  const spans = [{ startMeters: 0, endMeters: 100, name: "X", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" }];
  const updated = routeReducer(initialRouteState, {
    type: "route/update",
    snapshot: {
      points: [], selectedSegments: [], geometry: [], distance: 0,
      elevationGain: 0, elevationLoss: 0, activeDataPoints: [],
      routeFailure: null, segmentSpans: spans,
    },
  });
  assert.deepEqual(updated.segmentSpans, spans, "update copies segmentSpans");
  const cleared = routeReducer(updated, { type: "route/clear" });
  assert.deepEqual(cleared.segmentSpans, [], "clear resets segmentSpans");
  assert.deepEqual(initialRouteState.segmentSpans, [], "initial state has empty spans");
}

console.log("Route reducer segmentSpans tests passed");
