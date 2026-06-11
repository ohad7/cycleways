import assert from "node:assert/strict";
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
  sortByDistanceFromUser,
} from "@cycleways/core/data/nearMe.js";

const placeById = new Map([
  ["near", { id: "near", name: "קרוב", lat: 33.2, lng: 35.6 }],
  ["far", { id: "far", name: "רחוק", lat: 33.0, lng: 35.6 }],
]);
const fix = { lat: 33.2, lng: 35.6 };

// Distance is the minimum over the entry's start places.
{
  const entry = { slug: "a", startPlaceIds: ["far", "near"] };
  const d = distanceToRouteStartMeters(entry, placeById, fix);
  assert.ok(d !== null && d < 50, `expected ~0m, got ${d}`);
}

// Circular routes fall back to passesNear (routeStartPlaceIds behavior).
{
  const entry = { slug: "b", routeShape: { type: "circular" }, passesNear: ["far"] };
  const d = distanceToRouteStartMeters(entry, placeById, fix);
  assert.ok(d > 20000 && d < 25000, `expected ~22km, got ${d}`);
}

// Unresolvable start → null; bad fix → null.
{
  assert.equal(distanceToRouteStartMeters({ slug: "c" }, placeById, fix), null);
  assert.equal(
    distanceToRouteStartMeters({ slug: "a", startPlaceIds: ["near"] }, placeById, null),
    null,
  );
}

// Labels: meters under 1km, one-decimal km above.
{
  assert.equal(formatDistanceFromUser(320), 'כ-320 מ׳ ממך');
  assert.equal(formatDistanceFromUser(22300), 'כ-22.3 ק"מ ממך');
  assert.equal(formatDistanceFromUser(null), "");
}

// Sort: nearest first, unresolvable last, original order otherwise stable.
{
  const entries = [
    { slug: "no-start" },
    { slug: "far-route", startPlaceIds: ["far"] },
    { slug: "near-route", startPlaceIds: ["near"] },
  ];
  const sorted = sortByDistanceFromUser(entries, placeById, fix);
  assert.deepEqual(sorted.map((e) => e.slug), ["near-route", "far-route", "no-start"]);
  // Without a fix the list is returned unchanged (same reference is fine).
  assert.deepEqual(
    sortByDistanceFromUser(entries, placeById, null).map((e) => e.slug),
    ["no-start", "far-route", "near-route"],
  );
}

console.log("near-me helper tests passed");
