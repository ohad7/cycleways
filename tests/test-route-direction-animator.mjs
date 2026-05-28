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
  assert.ok(Number.isFinite(first.t), "first chevron payload has progress");

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

// Lit-point: callback fires once per index change; null on phase transitions out of cycles.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });

  const litEvents = [];
  animator.subscribe("litPoint", (payload) => litEvents.push(payload));

  // 20-step eastward geometry; route points at start, midpoint, end.
  const geometry = eastwardGeometry(20);
  animator.trigger(geometry, [0, 10, 20]);

  // Run cycle1 to completion in 220 frames of ~16 ms each (3520 ms total).
  for (let i = 0; i < 220; i++) clock.advance(16);

  // Window for "lit" is ±500 ms around the chevron's pass. For a 3 s cycle with route
  // points at t = 0, 0.5, 1.0, the windows are non-overlapping, so between them the
  // animator emits a `null` lit payload. Expected dedup'd sequence over cycle1:
  // {0} → null → {1} → null → {2} → null (last null comes from advancePhase into gap).
  const indices = litEvents
    .map((e) => (e ? e.index : null))
    .filter((v, i, arr) => arr[i - 1] !== v);

  assert.deepEqual(
    indices,
    [0, null, 1, null, 2, null],
    `cycle1 lit-point sequence (got ${JSON.stringify(indices)})`,
  );

  const nonNull = litEvents.find((e) => e && e.index === 1);
  assert.ok(
    nonNull && Number.isFinite(nonNull.lng) && Number.isFinite(nonNull.lat),
    "lit payload includes lng/lat",
  );
}

console.log("test-route-direction-animator: lit-point OK");

// Elevation: t goes 0→1 monotonically during each cycle; null during gap and done.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });

  const elevEvents = [];
  animator.subscribe("elevation", (payload) => elevEvents.push(payload));

  const geometry = eastwardGeometry(10);
  animator.trigger(geometry, [0, 10]);

  // Run through cycle1.
  for (let i = 0; i < 200; i++) clock.advance(16);

  const cycle1Ts = elevEvents.filter((e) => e && typeof e.t === "number").map((e) => e.t);
  assert.ok(cycle1Ts.length >= 5, "multiple elevation t values fired");
  assert.equal(cycle1Ts[0] < 0.05, true, "t starts near 0");
  const nullCount1 = elevEvents.filter((e) => e === null).length;
  assert.ok(nullCount1 >= 1, "null fires when entering gap");

  // Run through gap and cycle2.
  for (let i = 0; i < 300; i++) clock.advance(16);

  const finalNullCount = elevEvents.filter((e) => e === null).length;
  assert.ok(finalNullCount >= 2, "null fires again when entering done");
}

console.log("test-route-direction-animator: elevation OK");

// cancel() is idempotent and emits hidden payloads on each channel that needs them.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });

  const chevronEvents = [];
  const elevEvents = [];
  const litEvents = [];
  animator.subscribe("chevron", (p) => chevronEvents.push(p));
  animator.subscribe("elevation", (p) => elevEvents.push(p));
  animator.subscribe("litPoint", (p) => litEvents.push(p));

  animator.trigger(eastwardGeometry(10), [0, 10]);
  clock.advance(16);
  assert.ok(chevronEvents.at(-1), "cycle1 fired a non-null chevron");

  animator.cancel();
  assert.equal(chevronEvents.at(-1), null, "cancel emitted hidden chevron");
  assert.equal(elevEvents.at(-1), null, "cancel emitted hidden elevation");
  assert.equal(clock.pendingFrameCount(), 0, "cancel cleared RAF");

  const beforeLen = chevronEvents.length;
  animator.cancel();
  assert.equal(chevronEvents.length, beforeLen, "second cancel is silent");
}

// Mid-burst trigger restarts cleanly at cycle1 with new geometry.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });
  const events = [];
  animator.subscribe("chevron", (p) => events.push(p));

  animator.trigger(eastwardGeometry(10), [0, 10]);
  clock.advance(2000);

  const second = eastwardGeometry(10).map((p) => ({ lat: -1, lng: p.lng }));
  animator.trigger(second, [0, 10]);

  clock.advance(16);
  const latest = events.at(-1);
  assert.ok(latest && latest.lat < -0.5, "restart picked up new geometry");
}

// trigger with too-short input is a no-op.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });
  const events = [];
  animator.subscribe("chevron", (p) => events.push(p));

  animator.trigger([], []);
  animator.trigger([{ lat: 0, lng: 0 }], [0]);
  animator.trigger(eastwardGeometry(10), [0]); // only 1 point
  assert.equal(events.length, 0, "no events for invalid inputs");
  assert.equal(clock.pendingFrameCount(), 0, "no frames scheduled");
}

// Tab-background fast-forward: advancing past the entire burst transitions cleanly to done.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });
  const events = [];
  animator.subscribe("chevron", (p) => events.push(p));

  animator.trigger(eastwardGeometry(10), [0, 10]);
  clock.advance(60000);

  assert.equal(events.at(-1), null, "final event is hidden");
  assert.equal(clock.pendingFrameCount(), 0, "no more frames scheduled");
}

// dispose: cancels + drops subscribers.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });
  let calls = 0;
  animator.subscribe("chevron", () => { calls++; });
  animator.trigger(eastwardGeometry(10), [0, 10]);
  clock.advance(16);
  assert.ok(calls > 0, "subscriber received frames before dispose");
  const beforeDispose = calls;

  animator.dispose();
  animator.trigger(eastwardGeometry(10), [0, 10]);
  clock.advance(16);
  assert.equal(calls, beforeDispose, "dispose drops subscribers");
}

console.log("test-route-direction-animator: cancel/restart/edge OK");

// prefers-reduced-motion: chevron + elevation never fire; lit-point steps through indices.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: true });

  const chevronEvents = [];
  const elevEvents = [];
  const litEvents = [];
  animator.subscribe("chevron", (p) => chevronEvents.push(p));
  animator.subscribe("elevation", (p) => elevEvents.push(p));
  animator.subscribe("litPoint", (p) => litEvents.push(p));

  animator.trigger(eastwardGeometry(20), [0, 10, 20]);

  // Reduced mode: 500 ms lit per point + 200 ms gap × 3 points = 2100 ms.
  for (let i = 0; i < 200; i++) clock.advance(16);

  assert.equal(chevronEvents.length, 0, "no chevron in reduced motion");
  assert.equal(elevEvents.length, 0, "no elevation in reduced motion");

  const indices = litEvents
    .map((e) => (e ? e.index : null))
    .filter((v, i, arr) => arr[i - 1] !== v);
  assert.deepEqual(
    indices,
    [0, null, 1, null, 2, null],
    `sequential lit fires (got ${JSON.stringify(indices)})`,
  );
  assert.equal(clock.pendingFrameCount(), 0, "no frames pending after reduced burst");
}

console.log("test-route-direction-animator: reduced motion OK");
