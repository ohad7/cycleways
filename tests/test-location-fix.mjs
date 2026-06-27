import assert from "node:assert/strict";
import { toNavigationFix } from "@cycleways/core/navigation/locationFix.js";

// Expo Location.LocationObject -> route-progress fix shape.
{
  const fix = toNavigationFix({
    coords: {
      latitude: 33.1,
      longitude: 35.6,
      accuracy: 8,
      heading: 90,
      speed: 4.2,
    },
    timestamp: 1717000000000,
  });
  assert.deepEqual(fix, {
    lat: 33.1,
    lng: 35.6,
    accuracy: 8,
    heading: 90,
    speed: 4.2,
    timestamp: 1717000000000,
  });
}

// Expo reports -1 (or null) for unknown heading/speed -> normalized to null.
{
  const fix = toNavigationFix({
    coords: { latitude: 33.1, longitude: 35.6, accuracy: 20, heading: -1, speed: -1 },
    timestamp: 1717000001000,
  });
  assert.equal(fix.heading, null, "unknown heading -> null");
  assert.equal(fix.speed, null, "unknown speed -> null");
  assert.equal(fix.accuracy, 20);

  const nullish = toNavigationFix({
    coords: { latitude: 33.1, longitude: 35.6, accuracy: null, heading: null, speed: null },
    timestamp: 1,
  });
  assert.equal(nullish.heading, null);
  assert.equal(nullish.speed, null);
  assert.equal(nullish.accuracy, null, "missing accuracy -> null");
}

// Invalid / missing coordinates -> null (cannot drive navigation).
{
  assert.equal(toNavigationFix(null), null, "no location -> null");
  assert.equal(toNavigationFix({ coords: {} }), null, "no lat/lng -> null");
  assert.equal(
    toNavigationFix({ coords: { latitude: 33.1, longitude: "x" } }),
    null,
    "non-finite lng -> null",
  );
}

console.log("location fix mapper tests passed");
