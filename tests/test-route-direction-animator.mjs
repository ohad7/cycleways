import assert from "node:assert/strict";
import { createRouteDirectionAnimator } from "../src/map/routeDirectionAnimator.js";

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
