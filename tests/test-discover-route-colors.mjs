import assert from "node:assert/strict";
import {
  DISCOVER_ROUTE_PALETTE,
  discoverRouteColor,
} from "@cycleways/core/map/discoverRouteColors.js";

// Palette is non-empty and has no duplicates.
assert.ok(DISCOVER_ROUTE_PALETTE.length >= 6, "palette has enough colors");
assert.equal(
  new Set(DISCOVER_ROUTE_PALETTE).size,
  DISCOVER_ROUTE_PALETTE.length,
  "no duplicate colors",
);

// Index 0 -> first color.
assert.equal(discoverRouteColor(0), DISCOVER_ROUTE_PALETTE[0], "index 0 is first");

// Cycles modulo palette length.
const n = DISCOVER_ROUTE_PALETTE.length;
assert.equal(discoverRouteColor(n), DISCOVER_ROUTE_PALETTE[0], "wraps at n");
assert.equal(discoverRouteColor(n + 2), DISCOVER_ROUTE_PALETTE[2], "wraps at n+2");

// Non-integer / negative -> first color.
assert.equal(discoverRouteColor(-1), DISCOVER_ROUTE_PALETTE[0], "negative -> first");
assert.equal(discoverRouteColor(undefined), DISCOVER_ROUTE_PALETTE[0], "undefined -> first");
assert.equal(discoverRouteColor(1.5), DISCOVER_ROUTE_PALETTE[0], "non-integer -> first");

console.log("test-discover-route-colors.mjs passed");
