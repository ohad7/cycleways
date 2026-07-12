import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = {
  location: {
    hostname: "www.cycleways.app",
    origin: "https://www.cycleways.app",
    pathname: "/routes/example",
    search: "?route=SECRET_ROUTE&name=PRIVATE",
    hash: "#PRIVATE_FRAGMENT",
  },
};

const events = [];
globalThis.gtag = (type, name, parameters) => {
  events.push({ type, name, parameters });
};

const {
  analyticsPageLocation,
  analyticsPagePath,
  trackPageView,
  trackRouteOperation,
  trackRoutePointEvent,
  trackSearchEvent,
  trackUndoRedoEvent,
} = await import("@cycleways/core/platform/analytics.js");

assert.equal(analyticsPagePath(window.location), "/routes/example");
assert.equal(
  analyticsPageLocation(window.location),
  "https://www.cycleways.app/routes/example",
);

trackPageView(window.location);
trackPageView(window.location);
trackRoutePointEvent([{ id: 1 }], ["segment"], "click");
trackUndoRedoEvent("undo", [1], [], [{ id: 1 }], ["segment"]);
trackSearchEvent("דפנה PRIVATE", [{ id: 1 }], ["segment"]);
trackSearchEvent("דפנה PRIVATE", [{ id: 1 }], ["segment"], true, {
  lat: 33.23,
  lng: 35.63,
  within_bounds: true,
  email: "private@example.com",
});
trackRouteOperation("download", [{ id: 1 }], ["segment"], {
  distance: 4500,
  route: "SECRET_ROUTE",
});
trackRouteOperation("reset", [], [], {
  cleared_points: 2,
  cleared_segments: 3,
});

assert.deepEqual(
  events.map((event) => event.name),
  [
    "page_view",
    "route_point_modified",
    "route_undo",
    "location_search",
    "location_search_success",
    "gpx_download",
    "route_reset",
  ],
);

assert.deepEqual(events[0].parameters, {
  page_location: "https://www.cycleways.app/routes/example",
  page_path: "/routes/example",
});
assert.equal(events[1].parameters.method, "click");
assert.equal(events[2].parameters.undo_size, 1);
assert.equal(events[3].parameters.has_route, true);
assert.equal(events[4].parameters.within_bounds, true);
assert.equal(events[5].parameters.distance_km, 4.5);
assert.equal(events[6].parameters.cleared_points, 2);

const serialized = JSON.stringify(events);
for (const forbidden of [
  "SECRET_ROUTE",
  "PRIVATE_FRAGMENT",
  "private@example.com",
  "33.23",
  "35.63",
  "דפנה PRIVATE",
  '"lat"',
  '"lng"',
]) {
  assert.ok(!serialized.includes(forbidden), "analytics leaked " + forbidden);
}

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(indexHtml, /send_page_view:\s*false/);
assert.match(indexHtml, /allow_google_signals:\s*false/);
assert.match(indexHtml, /allow_ad_personalization_signals:\s*false/);
assert.match(indexHtml, /var gaMeasurementId = 'G-P1TK7GTD2J'/);
assert.match(indexHtml, /gtag\('config',\s*gaMeasurementId,/);
assert.doesNotMatch(indexHtml, /gtag\('config',\s*'G-P1TK7GTD2J'\s*\);/);

console.log("Analytics privacy and parity test passed");
