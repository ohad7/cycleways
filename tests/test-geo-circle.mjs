import assert from "node:assert/strict";
import { circlePolygon } from "@cycleways/core/utils/geoCircle.js";
import { getDistance } from "@cycleways/core/utils/distance.js";

// A closed GeoJSON polygon whose ring points sit ~radius meters from center.
{
  const center = { lat: 33.2, lng: 35.6 };
  const poly = circlePolygon(center.lat, center.lng, 250, 32);
  assert.equal(poly.type, "Polygon");
  const ring = poly.coordinates[0];
  assert.equal(ring.length, 33, "32 steps + closing point");
  assert.deepEqual(ring[0], ring[ring.length - 1], "ring is closed");
  for (const [lng, lat] of ring.slice(0, -1)) {
    const d = getDistance(center, { lat, lng });
    assert.ok(Math.abs(d - 250) < 5, `ring point ${d}m from center, expected ~250m`);
  }
}

console.log("geo circle tests passed");
