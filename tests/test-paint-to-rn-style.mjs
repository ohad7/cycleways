import assert from "node:assert/strict";
import { paintToRNStyle } from "@cycleways/core/map/paintToRNStyle.js";
import {
  routeNetworkLineStyleForPresentation,
} from "@cycleways/core/map/networkPresentation.js";

// Renames keys, preserves expression-array values.
const out = paintToRNStyle({
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": ["get", "routeColor"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5],
    "line-opacity": ["get", "routeOpacity"],
  },
});
assert.equal(out.lineJoin, "round");
assert.equal(out.lineCap, "round");
assert.deepEqual(out.lineColor, ["get", "routeColor"]);
assert.deepEqual(out.lineWidth, ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5]);
assert.deepEqual(out.lineOpacity, ["get", "routeOpacity"]);

// Works on a real shared spec without throwing and yields camelCase keys only.
const styled = paintToRNStyle(routeNetworkLineStyleForPresentation({ variant: "typed-cased" }));
assert.ok("lineColor" in styled);
assert.ok(!Object.keys(styled).some((key) => key.includes("-")));

// Tolerates missing layout/paint.
assert.deepEqual(paintToRNStyle({}), {});

console.log("test-paint-to-rn-style: OK");
