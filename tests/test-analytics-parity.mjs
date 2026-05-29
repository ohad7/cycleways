import assert from "node:assert/strict";

globalThis.window = {
  location: {
    hostname: "www.cycleways.app",
  },
};

const events = [];
globalThis.gtag = (type, name, parameters) => {
  events.push({ type, name, parameters });
};

const {
  trackRouteOperation,
  trackRoutePointEvent,
  trackSearchEvent,
  trackTutorial,
  trackUndoRedoEvent,
} = await import("../src/platform/analytics.js");

trackRoutePointEvent([{ id: 1 }], ["segment"], "click");
trackUndoRedoEvent("undo", [1], [], [{ id: 1 }], ["segment"]);
trackSearchEvent("דפנה", [{ id: 1 }], ["segment"]);
trackSearchEvent("דפנה", [{ id: 1 }], ["segment"], true, {
  lat: 33.23,
  lng: 35.63,
  within_bounds: true,
});
trackRouteOperation("download", [{ id: 1 }], ["segment"], {
  distance: 4500,
});
trackRouteOperation("reset", [], [], {
  cleared_points: 2,
  cleared_segments: 3,
});
trackTutorial("started", true, "help_button");

assert.deepEqual(
  events.map((event) => event.name),
  [
    "route_point_modified",
    "route_undo",
    "location_search",
    "location_search_success",
    "gpx_download",
    "route_reset",
    "tutorial_started",
  ],
);

assert.equal(events[0].parameters.method, "click");
assert.equal(events[1].parameters.undo_size, 1);
assert.equal(events[2].parameters.has_route, true);
assert.equal(events[3].parameters.within_bounds, true);
assert.equal(events[4].parameters.distance_km, 4.5);
assert.equal(events[5].parameters.cleared_points, 2);
assert.equal(events[6].parameters.source, "help_button");

console.log("Analytics parity test passed");
