import assert from "node:assert/strict";
import { segmentRoadTypeIcon } from "../src/components/segmentCardHelpers.js";
import { dataPointId } from "@cycleways/core/data/dataMarkers.js";

// segmentRoadTypeIcon maps each known road type to its line icon
assert.equal(segmentRoadTypeIcon("paved"), "bicycle-outline");
assert.equal(segmentRoadTypeIcon("dirt"), "trail-sign-outline");
assert.equal(segmentRoadTypeIcon("road"), "car-outline");

// unknown / missing road types fall back to the neutral trail-sign glyph
assert.equal(segmentRoadTypeIcon(null), "trail-sign-outline");
assert.equal(segmentRoadTypeIcon(undefined), "trail-sign-outline");
assert.equal(segmentRoadTypeIcon("bridge"), "trail-sign-outline");

console.log("segmentRoadTypeIcon tests passed");

// dataPointId: a data point with a real string id uses it; otherwise positional
assert.equal(dataPointId("Seg A", { id: "poi-1", type: "cafe" }, 3), "poi-1");
assert.equal(dataPointId("Seg A", { type: "gate" }, 0), "Seg A-0");
assert.equal(dataPointId("Seg A", { id: "", type: "gate" }, 2), "Seg A-2");
assert.equal(dataPointId("Seg A", { id: 42, type: "gate" }, 1), "Seg A-1");
assert.equal(dataPointId("Seg A", null, 5), "Seg A-5");

console.log("dataPointId tests passed");
