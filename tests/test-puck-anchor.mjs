// tests/test-puck-anchor.mjs — hysteresis for the navigating rider puck:
// snap to the route line while cross-track error is within GPS noise, detach
// to the detected location when the rider is genuinely beside the route
// (e.g. a parallel path), re-attach only once clearly back on the line.
import assert from "node:assert/strict";
import { createPuckAnchor } from "@cycleways/core/navigation/puckAnchor.js";

// Defaults: detach beyond 18 m, re-attach under 8 m. The wide gap absorbs
// ±8 m GPS jitter without flip-flopping while riding a parallel path.
{
  const anchor = createPuckAnchor();
  assert.equal(anchor.update(0), "route", "starts snapped to the route");
  assert.equal(anchor.update(17), "route", "small cross-track stays snapped");
  assert.equal(anchor.update(19), "detected", "beyond 18 m detaches");
  assert.equal(
    anchor.update(12),
    "detected",
    "hysteresis: 12 m stays detected (between re-attach and detach)",
  );
  assert.equal(anchor.update(7), "route", "under 8 m re-attaches");
  assert.equal(anchor.update(12), "route", "12 m from route side stays snapped");
}

// Boundary values: thresholds are exclusive on both sides.
{
  const anchor = createPuckAnchor();
  assert.equal(anchor.update(18), "route", "exactly 18 m does not detach");
  anchor.update(19);
  assert.equal(anchor.update(8), "detected", "exactly 8 m does not re-attach");
}

// Non-finite cross-track (no projection available) keeps the current mode.
{
  const anchor = createPuckAnchor();
  assert.equal(anchor.update(null), "route");
  anchor.update(20);
  assert.equal(anchor.update(undefined), "detected");
  assert.equal(anchor.update(NaN), "detected");
  assert.equal(anchor.update(null), "detected", "null must not coerce to 0 m");
}

// reset() returns to the snapped state.
{
  const anchor = createPuckAnchor();
  anchor.update(20);
  anchor.reset();
  assert.equal(anchor.update(12), "route", "reset clears the detached state");
}

// Custom thresholds.
{
  const anchor = createPuckAnchor({ detachMeters: 30, reattachMeters: 20 });
  assert.equal(anchor.update(25), "route");
  assert.equal(anchor.update(31), "detected");
  assert.equal(anchor.update(21), "detected");
  assert.equal(anchor.update(19), "route");
}

// Invalid thresholds fail fast.
assert.throws(
  () => createPuckAnchor({ detachMeters: 10, reattachMeters: 15 }),
  /reattachMeters must be below detachMeters/,
);

console.log("puck anchor tests passed");
