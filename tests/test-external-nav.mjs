import assert from "node:assert/strict";
import {
  EXTERNAL_NAV_APPS,
  buildAppUrl,
} from "@cycleways/core/navigation/externalNav.js";

const byId = Object.fromEntries(EXTERNAL_NAV_APPS.map((a) => [a.id, a]));
const point = { lat: 32.123456, lng: 35.654321 };

// Registry shape: each app has an id, label, probeUrl, and a buildUrl fn.
for (const app of EXTERNAL_NAV_APPS) {
  assert.ok(app.id && app.label && app.probeUrl);
  assert.equal(typeof app.buildUrl, "function");
}

// Apple Maps is always available (built-in) and routes (walking) to the point.
assert.equal(byId["apple-maps"].alwaysAvailable, true);
assert.match(
  buildAppUrl(byId["apple-maps"], point),
  /^https:\/\/maps\.apple\.com\/\?daddr=32\.123456,35\.654321/,
);
assert.match(buildAppUrl(byId["apple-maps"], point), /dirflg=w/);

// Google Maps: app scheme + bicycling mode; probed via comgooglemaps://.
assert.equal(byId["google-maps"].probeUrl, "comgooglemaps://");
assert.match(
  buildAppUrl(byId["google-maps"], point),
  /^comgooglemaps:\/\/\?daddr=32\.123456,35\.654321/,
);
assert.match(buildAppUrl(byId["google-maps"], point), /directionsmode=bicycling/);

// Waze (car) + Moovit (transit).
assert.equal(byId["waze"].probeUrl, "waze://");
assert.match(
  buildAppUrl(byId["waze"], point),
  /^https:\/\/waze\.com\/ul\?ll=32\.123456,35\.654321&navigate=yes/,
);
assert.equal(byId["moovit"].probeUrl, "moovit://");
assert.match(
  buildAppUrl(byId["moovit"], point),
  /^moovit:\/\/directions\?dest_lat=32\.123456&dest_lon=35\.654321/,
);

// Invalid point / app → null.
assert.equal(buildAppUrl(byId["waze"], null), null);
assert.equal(buildAppUrl(byId["waze"], { lat: NaN, lng: 1 }), null);
assert.equal(buildAppUrl(null, point), null);

console.log("external-nav ok");
