import assert from "node:assert/strict";
import {
  DEFAULT_RIDE_GUIDANCE_PREFERENCES,
  normalizeRideGuidancePreferences,
} from "@cycleways/core/navigation/rideGuidancePreferences.js";

assert.equal(
  DEFAULT_RIDE_GUIDANCE_PREFERENCES.intersectionCrossingGuidanceEnabled,
  true,
  "the pre-production experiment defaults on",
);
assert.deepEqual(normalizeRideGuidancePreferences(null), {
  schemaVersion: 1,
  intersectionCrossingGuidanceEnabled: true,
});
assert.equal(
  normalizeRideGuidancePreferences({
    schemaVersion: 1,
    intersectionCrossingGuidanceEnabled: false,
  }).intersectionCrossingGuidanceEnabled,
  false,
  "an explicit opt-out persists",
);
assert.equal(
  normalizeRideGuidancePreferences({
    schemaVersion: 99,
    intersectionCrossingGuidanceEnabled: false,
  }).intersectionCrossingGuidanceEnabled,
  true,
  "unknown preference schemas fail safe to the experiment default",
);

console.log("ride guidance preference tests passed");
