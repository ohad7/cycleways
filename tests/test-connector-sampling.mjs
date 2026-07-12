import assert from "node:assert/strict";
import { buildOriginGrid } from "@cycleways/core/routing/connectorSampling.js";

const center = { lat: 33.0, lng: 35.0 };

const grid = buildOriginGrid(center, {
  radiusMeters: 1000,
  spacingMeters: 250,
  maxOrigins: 400,
});
assert.ok(grid.origins.length > 0, "grid should have origins");
assert.ok(grid.origins.length <= 400, "grid respects the cap");
assert.equal(grid.capped, false, "1km/250m is under the cap");

// Every origin is within the radius (+ small tolerance) of center.
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
for (const o of grid.origins) {
  const dLat = toRad(o.lat - center.lat);
  const dLng = toRad(o.lng - center.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(center.lat)) * Math.cos(toRad(o.lat)) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  assert.ok(dist <= 1000 + 1, `origin within radius (${dist})`);
}

// The center itself is excluded.
assert.ok(
  !grid.origins.some((o) => o.lat === center.lat && o.lng === center.lng),
  "center excluded",
);

// A dense request over a big radius must coarsen and cap.
const capped = buildOriginGrid(center, {
  radiusMeters: 5000,
  spacingMeters: 50,
  maxOrigins: 400,
});
assert.ok(capped.origins.length <= 400, "coarsened grid respects the cap");
assert.equal(capped.capped, true, "flagged as capped");
assert.ok(capped.spacingMeters > 50, "spacing was coarsened");

console.log("connector-sampling OK");
