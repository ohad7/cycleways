import assert from "node:assert/strict";
import { featuredLayoutFromParam, OVERLAY, DEFAULT } from "../src/components/featured/featuredLayout.js";

assert.equal(featuredLayoutFromParam("overlay"), OVERLAY, "exact 'overlay' selects overlay");
assert.equal(featuredLayoutFromParam(null), DEFAULT, "missing param defaults");
assert.equal(featuredLayoutFromParam(""), DEFAULT, "empty defaults");
assert.equal(featuredLayoutFromParam("OVERLAY"), DEFAULT, "case-sensitive: not overlay");
assert.equal(featuredLayoutFromParam("anything"), DEFAULT, "unknown defaults");

// elevationCursorX is a pure helper extracted to a plain .js module so it is
// importable by the node test runner (Node cannot load the JSX component).
// ElevationProfile.jsx re-exports it for component-side use.
import { elevationCursorX } from "../src/components/elevationCursor.js";

assert.equal(elevationCursorX(0), 0, "fraction 0 -> 0");
assert.equal(elevationCursorX(1), 100, "fraction 1 -> 100");
assert.equal(elevationCursorX(0.5), 50, "fraction 0.5 -> 50");
assert.equal(elevationCursorX(-1), 0, "clamps below 0");
assert.equal(elevationCursorX(2), 100, "clamps above 100");
assert.equal(elevationCursorX(NaN), null, "non-finite -> null");

console.log("test-featured-layout passed");
