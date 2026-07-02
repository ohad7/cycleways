import assert from "node:assert/strict";
import {
  PENDING_RIDE_MAX_AGE_MS,
  normalizePendingRideIntent,
} from "../packages/core/src/navigation/pendingRidePlan.js";

const now = 100_000;
const valid = normalizePendingRideIntent({
  routeToken: "abc",
  slug: "route-a",
  timestamp: now,
  direction: "reverse",
  startMode: "nearest",
}, now);
assert.equal(valid.direction, "reverse");
assert.equal(valid.startMode, "nearest");
assert.equal(valid.slug, "route-a");
assert.equal(normalizePendingRideIntent({ routeToken: "", timestamp: now }, now), null);
assert.equal(
  normalizePendingRideIntent({ routeToken: "abc", timestamp: now, startMode: "custom" }, now),
  null,
);
assert.equal(
  normalizePendingRideIntent({ routeToken: "abc", timestamp: now - PENDING_RIDE_MAX_AGE_MS - 1 }, now),
  null,
);

console.log("test-pending-ride-plan: OK");
