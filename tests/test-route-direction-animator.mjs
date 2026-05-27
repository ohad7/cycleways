import assert from "node:assert/strict";
import {
  createRouteDirectionAnimator,
  computeCycleDuration,
} from "../src/map/routeDirectionAnimator.js";

// ── Fake clock harness ────────────────────────────────────────────────────
function createFakeClock() {
  let now = 0;
  let nextFrameId = 1;
  const callbacks = new Map();
  return {
    now: () => now,
    requestFrame(cb) {
      const id = nextFrameId++;
      callbacks.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    advance(ms) {
      now += ms;
      const pending = [...callbacks.entries()];
      callbacks.clear();
      pending.forEach(([, cb]) => cb(now));
    },
    pendingFrameCount: () => callbacks.size,
  };
}

// ── API surface ───────────────────────────────────────────────────────────
{
  const animator = createRouteDirectionAnimator({
    clock: createFakeClock(),
    prefersReducedMotion: false,
  });
  assert.equal(typeof animator.trigger, "function", "exposes trigger");
  assert.equal(typeof animator.subscribe, "function", "exposes subscribe");
  assert.equal(typeof animator.cancel, "function", "exposes cancel");
  assert.equal(typeof animator.dispose, "function", "exposes dispose");
}

// subscribe returns an unsubscribe function
{
  const animator = createRouteDirectionAnimator({
    clock: createFakeClock(),
    prefersReducedMotion: false,
  });
  const unsubscribe = animator.subscribe("chevron", () => {});
  assert.equal(typeof unsubscribe, "function", "subscribe returns unsubscribe");
  unsubscribe();
  unsubscribe(); // double-unsubscribe must not throw
}

// invalid channel name throws
{
  const animator = createRouteDirectionAnimator({
    clock: createFakeClock(),
    prefersReducedMotion: false,
  });
  assert.throws(
    () => animator.subscribe("bogus", () => {}),
    /unknown channel/i,
    "unknown channel rejected",
  );
}

console.log("test-route-direction-animator: API surface OK");

// computeCycleDuration: clamp(distance_km * 0.25 + 2.0, 3.0, 7.0)
assert.equal(computeCycleDuration(0), 3.0, "zero distance floors at 3s");
assert.equal(computeCycleDuration(500), 3.0, "0.5 km floors at 3s");
assert.equal(computeCycleDuration(4000), 3.0, "4 km still floors at 3s");
assert.equal(computeCycleDuration(10000), 4.5, "10 km computes to 4.5s");
assert.equal(computeCycleDuration(16000), 6.0, "16 km computes to 6.0s");
assert.equal(computeCycleDuration(20000), 7.0, "20 km hits ceiling at 7s");
assert.equal(computeCycleDuration(50000), 7.0, "50 km caps at 7s");

console.log("test-route-direction-animator: cycle duration OK");
