import assert from "node:assert/strict";
import { getCurrentPosition } from "@cycleways/core/platform/geolocation.js";

// Resolves a one-shot fix mapped to {lat, lng, accuracy}.
{
  Object.defineProperty(globalThis, "navigator", {
    value: {
      geolocation: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 33.2, longitude: 35.6, accuracy: 25 } });
        },
      },
    },
    configurable: true,
  });
  const fix = await getCurrentPosition();
  assert.deepEqual(fix, { lat: 33.2, lng: 35.6, accuracy: 25 });
}

// Rejects when the device denies/fails.
{
  Object.defineProperty(globalThis, "navigator", {
    value: {
      geolocation: {
        getCurrentPosition(_success, error) {
          error(new Error("denied"));
        },
      },
    },
    configurable: true,
  });
  await assert.rejects(() => getCurrentPosition(), /denied/);
}

// Rejects when the API is missing entirely.
{
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
  });
  await assert.rejects(() => getCurrentPosition(), /geolocation-unsupported/);
}

delete globalThis.navigator;
console.log("geolocation platform tests passed");
