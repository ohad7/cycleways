import assert from "node:assert/strict";
import { featuredLayoutFromParam, OVERLAY, DEFAULT } from "../src/components/featured/featuredLayout.js";

assert.equal(featuredLayoutFromParam("overlay"), OVERLAY, "exact 'overlay' selects overlay");
assert.equal(featuredLayoutFromParam(null), DEFAULT, "missing param defaults");
assert.equal(featuredLayoutFromParam(""), DEFAULT, "empty defaults");
assert.equal(featuredLayoutFromParam("OVERLAY"), DEFAULT, "case-sensitive: not overlay");
assert.equal(featuredLayoutFromParam("anything"), DEFAULT, "unknown defaults");

console.log("test-featured-layout passed");
