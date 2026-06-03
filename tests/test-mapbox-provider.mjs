import assert from "node:assert/strict";
import { getMapboxGl, setMapboxGlForTesting } from "../src/map/mapboxProvider.js";

// Returns the injected instance when present.
const fake = { Map: function () {}, Popup: function () {} };
setMapboxGlForTesting(fake);
assert.equal(getMapboxGl(), fake, "returns the injected mapbox-gl instance");

// Throws a clear error when no instance is available.
setMapboxGlForTesting(null);
assert.throws(
  () => getMapboxGl(),
  /Mapbox GL is not loaded/,
  "throws a clear error when mapbox-gl is absent",
);

// Reset the override so this module leaves no global test state behind.
setMapboxGlForTesting(undefined);

console.log("test-mapbox-provider OK");
