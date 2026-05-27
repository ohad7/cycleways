import assert from "node:assert/strict";
import {
  createRouteDirectionAnimator,
  computeCycleDuration,
  precomputeArcLength,
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

// Two close points ~111 km apart at the equator (1 degree of latitude)
{
  const geometry = [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ];
  const arc = precomputeArcLength(geometry);
  assert.equal(arc.cumDist.length, 2, "cumDist matches geometry length");
  assert.equal(arc.cumDist[0], 0, "starts at zero");
  assert.ok(
    Math.abs(arc.totalDistMeters - 111195) < 50,
    `totalDistMeters ≈ 111195 (got ${arc.totalDistMeters})`,
  );
  assert.equal(arc.cumDist[1], arc.totalDistMeters, "last cum equals total");
}

// Non-uniform geometry: 3 short hops then 1 long hop
{
  const geometry = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0, lng: 0.002 },
    { lat: 0, lng: 0.003 },
    { lat: 0, lng: 1.0 },
  ];
  const arc = precomputeArcLength(geometry);
  assert.ok(
    arc.cumDist[1] > 0 &&
      arc.cumDist[2] > arc.cumDist[1] &&
      arc.cumDist[3] > arc.cumDist[2],
    "cumDist is strictly monotonic for non-degenerate segments",
  );
  assert.ok(
    arc.cumDist[4] - arc.cumDist[3] > arc.cumDist[3] * 100,
    "the big jump dominates the total",
  );
}

// Zero-length segment (duplicate consecutive points) does not introduce NaN
{
  const geometry = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
  ];
  const arc = precomputeArcLength(geometry);
  assert.equal(arc.cumDist[0], 0);
  assert.equal(arc.cumDist[1], 0, "duplicate consecutive yields cumDist 0");
  assert.ok(arc.cumDist[2] > 0, "third point extends arc length");
  assert.ok(Number.isFinite(arc.totalDistMeters), "totalDistMeters is finite");
}

console.log("test-route-direction-animator: arc length OK");

// Helper: a simple linear-east geometry (~111 m per 0.001° lng).
function eastwardGeometry(steps) {
  const arr = [];
  for (let i = 0; i <= steps; i++) {
    arr.push({ lat: 0, lng: i * 0.001 });
  }
  return arr;
}

// State machine: cycle1 → gap → cycle2 → done with chevron callback firing in cycles only.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });

  const chevronEvents = [];
  animator.subscribe("chevron", (payload) => chevronEvents.push(payload));

  const geometry = eastwardGeometry(10); // ~1110 m → cycleDuration floors at 3s
  animator.trigger(geometry, [0, 10]);

  // After the trigger frame should be scheduled.
  assert.equal(clock.pendingFrameCount(), 1, "trigger schedules a frame");

  // Advance one frame: should produce a chevron payload at t≈0.
  clock.advance(16);
  const first = chevronEvents.at(-1);
  assert.ok(
    first && Number.isFinite(first.lng) && Number.isFinite(first.lat),
    "first chevron payload has lng/lat",
  );
  assert.ok(Number.isFinite(first.bearing), "first chevron payload has bearing");

  // Advance ~1.5s into cycle1, halfway through.
  clock.advance(1500);
  const mid = chevronEvents.at(-1);
  assert.ok(
    mid.lng > 0.004 && mid.lng < 0.006,
    `mid-cycle near midpoint (got ${mid.lng})`,
  );

  // Advance to end of cycle1 (total 3.1s elapsed). The next frame should mark entry
  // into `gap` and fire a hidden chevron payload (null).
  clock.advance(1600); // 16+1500+1600 = 3116 ms → past 3000 ms
  const endCycle1 = chevronEvents.at(-1);
  assert.equal(endCycle1, null, "hidden payload at start of gap");

  // Advance through the 1.2s gap.
  clock.advance(1300);
  // First frame of cycle2 should produce a non-null payload near the start again.
  // After advance, the first cycle2 frame lands at t≈0.07 → lng≈0.0007 along a 0–0.01 lng range.
  const cycle2Start = chevronEvents.at(-1);
  assert.ok(
    cycle2Start && cycle2Start.lng < 0.001,
    "cycle2 starts near route start",
  );

  // Advance to end of cycle2 + a beat.
  clock.advance(3200);
  const finalEvent = chevronEvents.at(-1);
  assert.equal(finalEvent, null, "hidden payload at done");

  // After done, no more frames should be scheduled.
  assert.equal(clock.pendingFrameCount(), 0, "no frames pending after done");
}

console.log("test-route-direction-animator: state machine + chevron OK");
