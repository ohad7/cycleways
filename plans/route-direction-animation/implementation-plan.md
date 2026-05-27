# Route Direction Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded 2-cycle chevron-pulse animation that travels along the user's route on load and on each post-compose geometry change, lights each route-point briefly as it passes, and slides a synced marker across the elevation graph in lockstep.

**Architecture:** A framework-free `routeDirectionAnimator` module owns a `requestAnimationFrame` loop and a deterministic state machine (`cycle1 → gap → cycle2 → done`). Map and elevation graph subscribe to three channels (`chevron`, `litPoint`, `elevation`) and apply per-frame updates imperatively, bypassing React re-renders. The animator is pure JS — clock and `prefers-reduced-motion` are injected, so its logic is unit-testable end-to-end with a fake clock.

**Tech Stack:** Vanilla JS (ES modules), React 19, Mapbox GL JS, Node `assert/strict` for tests (no test framework).

**Reference:** Full design at `plans/route-direction-animation/design.md`.

---

## File Map

**Create:**
- `src/map/routeDirectionAnimator.js` — pure-JS animator (~200 lines)
- `tests/test-route-direction-animator.mjs` — unit tests with injected fake clock (~200 lines)

**Modify:**
- `src/map/mapLayers.js` — add lit-point source/layer + sync helper
- `src/map/MapView.jsx` — accept `animator` prop, subscribe `chevron` + `litPoint`
- `src/components/RoutePanel.jsx` — `ElevationProfile` accepts `animator` prop, subscribes `elevation`
- `src/App.jsx` — create animator ref, snap helper, trigger effect, `isDragging` tracking, prop drilling
- `package.json` — add new test file to `test` script chain

---

## Task 1: Scaffold animator module + fake clock + API surface tests

**Files:**
- Create: `src/map/routeDirectionAnimator.js`
- Create: `tests/test-route-direction-animator.mjs`
- Modify: `package.json` (test script)

- [ ] **Step 1: Write the failing test file**

Create `tests/test-route-direction-animator.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL with `Cannot find module '.../routeDirectionAnimator.js'`.

- [ ] **Step 3: Create the animator scaffold**

Create `src/map/routeDirectionAnimator.js`:

```js
const CHANNELS = new Set(["chevron", "litPoint", "elevation"]);

export function createRouteDirectionAnimator(options = {}) {
  const clock = options.clock ?? defaultClock();
  const prefersReducedMotion =
    options.prefersReducedMotion ?? detectPrefersReducedMotion();

  const subscribers = {
    chevron: new Set(),
    litPoint: new Set(),
    elevation: new Set(),
  };

  function subscribe(channel, callback) {
    if (!CHANNELS.has(channel)) {
      throw new Error(`unknown channel: ${channel}`);
    }
    subscribers[channel].add(callback);
    let active = true;
    return function unsubscribe() {
      if (!active) return;
      active = false;
      subscribers[channel].delete(callback);
    };
  }

  function trigger(_geometry, _routePointIndices) {
    // Implemented in later tasks.
  }

  function cancel() {
    // Implemented in later tasks.
  }

  function dispose() {
    cancel();
    Object.values(subscribers).forEach((s) => s.clear());
  }

  // Returned so future tasks can read prefersReducedMotion via the test harness.
  return { trigger, subscribe, cancel, dispose, _internal: { clock, prefersReducedMotion } };
}

function defaultClock() {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
  };
}

function detectPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
```

- [ ] **Step 4: Add the new test to `package.json`**

Open `package.json` and append the new test runner to the `test` script. Find the line that starts with `"test": "npm run test:osm && ...` and add ` && node tests/test-route-direction-animator.mjs` immediately after `&& node tests/test-route-reducer.mjs` (any consistent position is fine).

After the edit, the relevant portion should look like:

```
... && node tests/test-route-reducer.mjs && node tests/test-route-direction-animator.mjs && node tests/test-react-route-actions.mjs ...
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — final stdout line is `test-route-direction-animator: API surface OK`.

- [ ] **Step 6: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs package.json
git commit -m "Scaffold route direction animator with API tests"
```

---

## Task 2: Cycle duration formula

**Files:**
- Modify: `src/map/routeDirectionAnimator.js` (export `computeCycleDuration`)
- Modify: `tests/test-route-direction-animator.mjs` (append tests)

- [ ] **Step 1: Write the failing test**

Append to `tests/test-route-direction-animator.mjs`:

```js
import { computeCycleDuration } from "../src/map/routeDirectionAnimator.js";

// computeCycleDuration: clamp(distance_km * 0.25 + 2.0, 3.0, 7.0)
assert.equal(computeCycleDuration(0), 3.0, "zero distance floors at 3s");
assert.equal(computeCycleDuration(500), 3.0, "0.5 km floors at 3s");
assert.equal(computeCycleDuration(4000), 3.0, "4 km still floors at 3s");
assert.equal(computeCycleDuration(10000), 4.5, "10 km computes to 4.5s");
assert.equal(computeCycleDuration(16000), 6.0, "16 km computes to 6.0s");
assert.equal(computeCycleDuration(20000), 7.0, "20 km hits ceiling at 7s");
assert.equal(computeCycleDuration(50000), 7.0, "50 km caps at 7s");

console.log("test-route-direction-animator: cycle duration OK");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL with `computeCycleDuration is not a function`.

- [ ] **Step 3: Implement and export `computeCycleDuration`**

Add to `src/map/routeDirectionAnimator.js` (top-level, above `createRouteDirectionAnimator`):

```js
export function computeCycleDuration(totalDistanceMeters) {
  const distanceKm = (totalDistanceMeters || 0) / 1000;
  const raw = distanceKm * 0.25 + 2.0;
  return Math.min(7.0, Math.max(3.0, raw));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — both `API surface OK` and `cycle duration OK` print.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Add cycle duration formula with distance-based clamp"
```

---

## Task 3: Arc-length precomputation

**Files:**
- Modify: `src/map/routeDirectionAnimator.js` (export `precomputeArcLength`)
- Modify: `tests/test-route-direction-animator.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-route-direction-animator.mjs`:

```js
import { precomputeArcLength } from "../src/map/routeDirectionAnimator.js";

// Two close points ~111 km apart at the equator (1 degree of latitude)
{
  const geometry = [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
  ];
  const arc = precomputeArcLength(geometry);
  assert.equal(arc.cumDist.length, 2, "cumDist matches geometry length");
  assert.equal(arc.cumDist[0], 0, "starts at zero");
  // 1 degree latitude ≈ 111195 m; allow a generous tolerance for haversine rounding
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
    { lat: 0, lng: 1.0 }, // big jump
  ];
  const arc = precomputeArcLength(geometry);
  assert.ok(
    arc.cumDist[1] > 0 && arc.cumDist[2] > arc.cumDist[1] && arc.cumDist[3] > arc.cumDist[2],
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
    { lat: 0, lng: 0 },        // duplicate
    { lat: 0, lng: 0.001 },
  ];
  const arc = precomputeArcLength(geometry);
  assert.equal(arc.cumDist[0], 0);
  assert.equal(arc.cumDist[1], 0, "duplicate consecutive yields cumDist 0");
  assert.ok(arc.cumDist[2] > 0, "third point extends arc length");
  assert.ok(Number.isFinite(arc.totalDistMeters), "totalDistMeters is finite");
}

console.log("test-route-direction-animator: arc length OK");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL — `precomputeArcLength is not a function`.

- [ ] **Step 3: Implement `precomputeArcLength`**

Add to `src/map/routeDirectionAnimator.js` (above `createRouteDirectionAnimator`):

```js
import { getDistance } from "../../utils/distance.js";

export function precomputeArcLength(geometry) {
  const n = geometry.length;
  const cumDist = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const segment = getDistance(geometry[i - 1], geometry[i]);
    // Guard against NaN/negative from degenerate input
    acc += Number.isFinite(segment) && segment > 0 ? segment : 0;
    cumDist[i] = acc;
  }
  return { cumDist, totalDistMeters: acc };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — `arc length OK` printed.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Add arc-length precomputation with degenerate-segment handling"
```

---

## Task 4: State machine + chevron callback per frame

**Files:**
- Modify: `src/map/routeDirectionAnimator.js` (implement `trigger`, `cancel`, frame loop)
- Modify: `tests/test-route-direction-animator.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-route-direction-animator.mjs`:

```js
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
  assert.ok(first && Number.isFinite(first.lng) && Number.isFinite(first.lat),
    "first chevron payload has lng/lat");
  assert.ok(Number.isFinite(first.bearing), "first chevron payload has bearing");

  // Advance ~1.5s into cycle1, halfway through.
  clock.advance(1500);
  const mid = chevronEvents.at(-1);
  assert.ok(mid.lng > 0.004 && mid.lng < 0.006, `mid-cycle near midpoint (got ${mid.lng})`);

  // Advance to end of cycle1 (total 3.0s elapsed). The next frame should mark the
  // entry into `gap` and fire a hidden chevron payload (null).
  clock.advance(1600); // 16+1500+1600 = 3116 ms → past 3000 ms
  const endCycle1 = chevronEvents.at(-1);
  assert.equal(endCycle1, null, "hidden payload at start of gap");

  // Advance through the 1.2s gap.
  clock.advance(1300);
  // First frame of cycle2 should produce a non-null payload near the start again.
  // After advance, the first cycle2 frame lands at t≈0.07 → lng≈0.0007 along a 0–0.01 lng range.
  const cycle2Start = chevronEvents.at(-1);
  assert.ok(cycle2Start && cycle2Start.lng < 0.001, "cycle2 starts near route start");

  // Advance to end of cycle2 + a beat.
  clock.advance(3200);
  const finalEvent = chevronEvents.at(-1);
  assert.equal(finalEvent, null, "hidden payload at done");

  // After done, no more frames should be scheduled.
  assert.equal(clock.pendingFrameCount(), 0, "no frames pending after done");
}

console.log("test-route-direction-animator: state machine + chevron OK");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL — `trigger` does nothing, so no chevron events arrive.

- [ ] **Step 3: Implement the state machine and chevron firing**

Replace the body of `createRouteDirectionAnimator` in `src/map/routeDirectionAnimator.js`. Add these constants at module top (above `CHANNELS`):

```js
const GAP_DURATION_MS = 1200;
```

Replace the inside of `createRouteDirectionAnimator` (keep the subscribers object and `subscribe` from Task 1, replace the `trigger`/`cancel`/`dispose` stubs):

```js
export function createRouteDirectionAnimator(options = {}) {
  const clock = options.clock ?? defaultClock();
  const prefersReducedMotion =
    options.prefersReducedMotion ?? detectPrefersReducedMotion();

  const subscribers = {
    chevron: new Set(),
    litPoint: new Set(),
    elevation: new Set(),
  };

  let state = null;
  let frameId = null;

  function subscribe(channel, callback) {
    if (!CHANNELS.has(channel)) {
      throw new Error(`unknown channel: ${channel}`);
    }
    subscribers[channel].add(callback);
    let active = true;
    return function unsubscribe() {
      if (!active) return;
      active = false;
      subscribers[channel].delete(callback);
    };
  }

  function emit(channel, payload) {
    subscribers[channel].forEach((cb) => cb(payload));
  }

  function trigger(geometry, routePointIndices) {
    if (!Array.isArray(geometry) || geometry.length < 2) return;
    if (!Array.isArray(routePointIndices) || routePointIndices.length < 2) return;

    cancelInternal({ silent: true }); // cancel any in-flight burst without emitting hidden

    const arc = precomputeArcLength(geometry);
    if (!(arc.totalDistMeters > 0)) return;

    const cycleDurationSec = computeCycleDuration(arc.totalDistMeters);
    state = {
      phase: "cycle1",
      phaseStartTime: clock.now(),
      geometry,
      arc,
      cycleDurationMs: cycleDurationSec * 1000,
      routePointIndices,
    };
    scheduleNextFrame();
  }

  function scheduleNextFrame() {
    frameId = clock.requestFrame(onFrame);
  }

  function onFrame(now) {
    frameId = null;
    if (!state) return;

    // Fast-forward through any phases we have blown past (handles tab-background catch-up).
    while (state) {
      const elapsed = now - state.phaseStartTime;
      const phaseDur =
        state.phase === "gap" ? GAP_DURATION_MS : state.cycleDurationMs;
      if (elapsed < phaseDur) break;
      advancePhase();
    }

    if (!state) return;

    if (state.phase === "cycle1" || state.phase === "cycle2") {
      const t = Math.min((now - state.phaseStartTime) / state.cycleDurationMs, 1);
      emit("chevron", computeChevronPayload(state, t));
    }
    // gap: hidden payload was emitted on entry inside advancePhase()

    scheduleNextFrame();
  }

  function advancePhase() {
    if (state.phase === "cycle1") {
      emit("chevron", null);
      state.phase = "gap";
      state.phaseStartTime += state.cycleDurationMs;
    } else if (state.phase === "gap") {
      state.phase = "cycle2";
      state.phaseStartTime += GAP_DURATION_MS;
    } else if (state.phase === "cycle2") {
      emit("chevron", null);
      state = null;
    }
  }

  function cancelInternal({ silent }) {
    if (frameId !== null) {
      clock.cancelFrame(frameId);
      frameId = null;
    }
    if (state && !silent) {
      emit("chevron", null);
    }
    state = null;
  }

  function cancel() {
    cancelInternal({ silent: false });
  }

  function dispose() {
    cancelInternal({ silent: true });
    Object.values(subscribers).forEach((s) => s.clear());
  }

  return { trigger, subscribe, cancel, dispose };
}
```

Add the chevron payload helper, immediately below `createRouteDirectionAnimator`:

```js
function computeChevronPayload(state, t) {
  const { arc, geometry } = state;
  const target = t * arc.totalDistMeters;
  const i = findSegmentIndex(arc.cumDist, target);
  const segLen = arc.cumDist[i + 1] - arc.cumDist[i];
  const localFrac = segLen > 0 ? (target - arc.cumDist[i]) / segLen : 0;
  const a = geometry[i];
  const b = geometry[i + 1];
  return {
    lng: a.lng + (b.lng - a.lng) * localFrac,
    lat: a.lat + (b.lat - a.lat) * localFrac,
    bearing: computeBearing(a, b),
  };
}

function findSegmentIndex(cumDist, target) {
  // Binary search for the largest i such that cumDist[i] <= target.
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (cumDist[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, cumDist.length - 2);
}

function computeBearing(from, to) {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — `state machine + chevron OK` printed.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Implement state machine and chevron frame computation"
```

---

## Task 5: Lit-point detection (change-only firing)

**Files:**
- Modify: `src/map/routeDirectionAnimator.js`
- Modify: `tests/test-route-direction-animator.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-route-direction-animator.mjs`:

```js
// Lit-point: callback fires once per index change; null on phase transitions out of cycles.
{
  const clock = createFakeClock();
  const animator = createRouteDirectionAnimator({ clock, prefersReducedMotion: false });

  const litEvents = [];
  animator.subscribe("litPoint", (payload) => litEvents.push(payload));

  // 20-step eastward geometry; route points at start, midpoint, end.
  const geometry = eastwardGeometry(20);
  animator.trigger(geometry, [0, 10, 20]);

  // Run cycle1 to completion in ~10 substeps.
  for (let i = 0; i < 220; i++) clock.advance(16);

  // Window for "lit" is ±500 ms around the chevron's pass. For a 3 s cycle with route
  // points at t = 0, 0.5, 1.0, the windows are non-overlapping, so between them the
  // animator emits a `null` lit payload. Expected dedup'd sequence over cycle1:
  // {0} → null → {1} → null → {2} → null (last null comes from advancePhase into gap).
  const indices = litEvents
    .map((e) => (e ? e.index : null))
    .filter((v, i, arr) => arr[i - 1] !== v); // dedupe adjacent

  assert.deepEqual(
    indices,
    [0, null, 1, null, 2, null],
    `cycle1 lit-point sequence (got ${JSON.stringify(indices)})`,
  );

  // Each non-null payload includes lng/lat for marker rendering.
  const nonNull = litEvents.find((e) => e && e.index === 1);
  assert.ok(nonNull && Number.isFinite(nonNull.lng) && Number.isFinite(nonNull.lat),
    "lit payload includes lng/lat");
}

console.log("test-route-direction-animator: lit-point OK");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL — no `litPoint` events arrive (channel exists but is never emitted to).

- [ ] **Step 3: Implement lit-point detection**

In `src/map/routeDirectionAnimator.js`, extend `trigger` to precompute `routePointTs` and seed `lastLitIndex`. Inside the `trigger` function, after computing `arc`, add:

```js
    const routePointTs = routePointIndices.map((idx) => {
      const safe = Math.max(0, Math.min(idx, arc.cumDist.length - 1));
      return arc.cumDist[safe] / arc.totalDistMeters;
    });
```

Change the `state = {...}` assignment to include the new fields:

```js
    state = {
      phase: "cycle1",
      phaseStartTime: clock.now(),
      geometry,
      arc,
      cycleDurationMs: cycleDurationSec * 1000,
      routePointIndices,
      routePointTs,
      lastLitIndex: null,
    };
```

Modify `onFrame` to also emit lit-point in cycle1/cycle2. Replace the `if (state.phase === "cycle1" || state.phase === "cycle2") { ... }` block with:

```js
    if (state.phase === "cycle1" || state.phase === "cycle2") {
      const t = Math.min((now - state.phaseStartTime) / state.cycleDurationMs, 1);
      emit("chevron", computeChevronPayload(state, t));
      const litIndex = detectLitIndex(state, t);
      if (litIndex !== state.lastLitIndex) {
        state.lastLitIndex = litIndex;
        emit("litPoint", buildLitPayload(state, litIndex));
      }
    }
```

Modify `advancePhase` so that entering `gap`, entering `cycle2`, and going to `done` each reset `lastLitIndex` and emit `null`. Replace the body of `advancePhase`:

```js
  function advancePhase() {
    if (state.phase === "cycle1") {
      emit("chevron", null);
      emitLitNullIfNeeded();
      state.phase = "gap";
      state.phaseStartTime += state.cycleDurationMs;
    } else if (state.phase === "gap") {
      state.phase = "cycle2";
      state.phaseStartTime += GAP_DURATION_MS;
      state.lastLitIndex = null;
    } else if (state.phase === "cycle2") {
      emit("chevron", null);
      emitLitNullIfNeeded();
      state = null;
    }
  }

  function emitLitNullIfNeeded() {
    if (state && state.lastLitIndex !== null) {
      state.lastLitIndex = null;
      emit("litPoint", null);
    }
  }
```

Also update `cancelInternal` to emit the lit null when not silent:

```js
  function cancelInternal({ silent }) {
    if (frameId !== null) {
      clock.cancelFrame(frameId);
      frameId = null;
    }
    if (state && !silent) {
      emit("chevron", null);
      if (state.lastLitIndex !== null) emit("litPoint", null);
    }
    state = null;
  }
```

Add the helpers below `findSegmentIndex` / `computeBearing`:

```js
function detectLitIndex(state, t) {
  // Window of ±0.5s expressed in normalised t units.
  const windowT = 500 / state.cycleDurationMs;
  let lit = null;
  for (let k = 0; k < state.routePointTs.length; k++) {
    if (Math.abs(t - state.routePointTs[k]) <= windowT) {
      // Keep the highest index inside the window so tightly-spaced points resolve.
      lit = k;
    }
  }
  return lit;
}

function buildLitPayload(state, k) {
  if (k === null) return null;
  const geomIndex = state.routePointIndices[k];
  const coord = state.geometry[geomIndex];
  return {
    index: k, // 0-based; consumers add 1 for display
    lng: coord.lng,
    lat: coord.lat,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — `lit-point OK` printed along with prior lines.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Add lit-point detection with change-only firing"
```

---

## Task 6: Elevation channel

**Files:**
- Modify: `src/map/routeDirectionAnimator.js`
- Modify: `tests/test-route-direction-animator.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-route-direction-animator.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL — no elevation events arrive.

- [ ] **Step 3: Implement elevation emission**

In `src/map/routeDirectionAnimator.js`, inside the `if (state.phase === "cycle1" || state.phase === "cycle2")` branch in `onFrame`, add the elevation emit right after the lit-point block:

```js
      emit("elevation", { t });
```

Add `emit("elevation", null)` symmetric with the chevron null. Replace `advancePhase` (only the two cycle-end branches; keep the rest) so it becomes:

```js
  function advancePhase() {
    if (state.phase === "cycle1") {
      emit("chevron", null);
      emit("elevation", null);
      emitLitNullIfNeeded();
      state.phase = "gap";
      state.phaseStartTime += state.cycleDurationMs;
    } else if (state.phase === "gap") {
      state.phase = "cycle2";
      state.phaseStartTime += GAP_DURATION_MS;
      state.lastLitIndex = null;
    } else if (state.phase === "cycle2") {
      emit("chevron", null);
      emit("elevation", null);
      emitLitNullIfNeeded();
      state = null;
    }
  }
```

Also update `cancelInternal` to emit elevation null:

```js
    if (state && !silent) {
      emit("chevron", null);
      emit("elevation", null);
      if (state.lastLitIndex !== null) emit("litPoint", null);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — `elevation OK` printed.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Add elevation channel that mirrors chevron timeline"
```

---

## Task 7: Cancel, restart, dispose, edge cases

**Files:**
- Modify: `src/map/routeDirectionAnimator.js`
- Modify: `tests/test-route-direction-animator.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-route-direction-animator.mjs`:

```js
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

  // Idempotent: a second cancel emits nothing more and does not throw.
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
  clock.advance(2000); // partway through cycle1

  // New trigger with a geometry that's offset southward
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
  clock.advance(60000); // way past the ~7s burst

  // The big jump fires one frame; that frame may emit multiple nulls during fast-forward,
  // but the final state is done.
  assert.equal(events.at(-1), null, "final event is hidden");
  assert.equal(clock.pendingFrameCount(), 0, "no more frames scheduled");
}

// dispose: cancels + drops subscribers (further subscribe after dispose still works for sanity).
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
  // Subsequent trigger after dispose: still callable, but the dropped subscriber gets nothing.
  animator.trigger(eastwardGeometry(10), [0, 10]);
  clock.advance(16);
  assert.equal(calls, beforeDispose, "dispose drops subscribers");
}

console.log("test-route-direction-animator: cancel/restart/edge OK");
```

- [ ] **Step 2: Run the test to confirm any failures**

Run: `node tests/test-route-direction-animator.mjs`
Expected: depending on the current state, some of these may pass already (the bulk of the logic is in place); fix any that fail.

Most likely the **dispose-then-trigger** test fails: after `dispose` you should still allow `trigger`/`subscribe` to be called without crashing, but no events should reach previously-dropped subscribers. The existing `dispose` already calls `cancelInternal({silent: true})` and clears subscribers, so it should pass; verify.

- [ ] **Step 3: Patch any failures**

If the **mid-burst restart** test fails because `cancelInternal({silent:true})` does not properly stop the in-flight frame before re-arming, the existing implementation should already be correct — confirm by reading. If it fails for another reason, address inline.

If the **tab-background fast-forward** test fails, ensure the `while (state)` loop in `onFrame` correctly walks through `cycle1 → gap → cycle2 → done` without scheduling additional frames after `state = null`. The current code sets `frameId = null` at frame entry and only re-schedules if `state` is still non-null at the end, which is correct — no patch should be needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — `cancel/restart/edge OK` printed.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Verify cancel restart and tab-background edge cases"
```

---

## Task 8: Reduced-motion fallback

**Files:**
- Modify: `src/map/routeDirectionAnimator.js`
- Modify: `tests/test-route-direction-animator.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-route-direction-animator.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/test-route-direction-animator.mjs`
Expected: FAIL — current `trigger` ignores `prefersReducedMotion` and uses the full chevron path.

- [ ] **Step 3: Implement reduced-motion branch**

In `src/map/routeDirectionAnimator.js`, branch at the top of `trigger`. Replace the body of `trigger` (keep the early-return guards) with:

```js
  function trigger(geometry, routePointIndices) {
    if (!Array.isArray(geometry) || geometry.length < 2) return;
    if (!Array.isArray(routePointIndices) || routePointIndices.length < 2) return;

    cancelInternal({ silent: true });

    if (prefersReducedMotion) {
      triggerReducedMotion(geometry, routePointIndices);
      return;
    }

    const arc = precomputeArcLength(geometry);
    if (!(arc.totalDistMeters > 0)) return;

    const cycleDurationSec = computeCycleDuration(arc.totalDistMeters);
    state = {
      phase: "cycle1",
      phaseStartTime: clock.now(),
      geometry,
      arc,
      cycleDurationMs: cycleDurationSec * 1000,
      routePointIndices,
      routePointTs: routePointIndices.map((idx) => {
        const safe = Math.max(0, Math.min(idx, arc.cumDist.length - 1));
        return arc.cumDist[safe] / arc.totalDistMeters;
      }),
      lastLitIndex: null,
    };
    scheduleNextFrame();
  }
```

Add the reduced-motion helper inside `createRouteDirectionAnimator`, near the other inner functions:

```js
  function triggerReducedMotion(geometry, routePointIndices) {
    const LIT_MS = 500;
    const GAP_MS = 200;
    state = {
      phase: "reduced",
      reducedStart: clock.now(),
      geometry,
      routePointIndices,
      lastLitIndex: null,
    };

    function reducedFrame(now) {
      frameId = null;
      if (!state || state.phase !== "reduced") return;

      const elapsed = now - state.reducedStart;
      const cycle = LIT_MS + GAP_MS;
      const totalPoints = routePointIndices.length;
      const totalMs = totalPoints * cycle;

      if (elapsed >= totalMs) {
        if (state.lastLitIndex !== null) {
          state.lastLitIndex = null;
          emit("litPoint", null);
        }
        state = null;
        return;
      }

      const i = Math.floor(elapsed / cycle);
      const inLit = elapsed - i * cycle < LIT_MS;
      const targetIndex = inLit ? i : null;

      if (targetIndex !== state.lastLitIndex) {
        state.lastLitIndex = targetIndex;
        if (targetIndex === null) {
          emit("litPoint", null);
        } else {
          const geomIndex = routePointIndices[targetIndex];
          const coord = geometry[geomIndex];
          emit("litPoint", { index: targetIndex, lng: coord.lng, lat: coord.lat });
        }
      }

      frameId = clock.requestFrame(reducedFrame);
    }

    frameId = clock.requestFrame(reducedFrame);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-route-direction-animator.mjs`
Expected: PASS — `reduced motion OK` printed.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeDirectionAnimator.js tests/test-route-direction-animator.mjs
git commit -m "Add reduced-motion fallback that lights points sequentially"
```

---

## Task 9: Mapbox lit-point source + layers + sync helpers

**Files:**
- Modify: `src/map/mapLayers.js`

No unit tests — Mapbox layer code requires a live map. Manual verification happens in Task 13.

- [ ] **Step 1: Add the source/layer IDs**

At the top of `src/map/mapLayers.js` (alongside the existing exported IDs like `ROUTE_GEOMETRY_SOURCE_ID`), add:

```js
export const ROUTE_DIRECTION_LIT_POINT_SOURCE_ID = "route-direction-lit-point";
export const ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID =
  "route-direction-lit-point-circle";
export const ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID =
  "route-direction-lit-point-text";
```

- [ ] **Step 2: Add `syncRouteDirectionLitPointLayer`**

Append to `src/map/mapLayers.js` (anywhere near other `sync*` exports — for example after `syncRouteGeometryLayer`):

```js
export function syncRouteDirectionLitPointLayer(map, payload) {
  const data = {
    type: "FeatureCollection",
    features:
      payload && Number.isFinite(payload.lng) && Number.isFinite(payload.lat)
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [payload.lng, payload.lat],
              },
              properties: {
                index: payload.displayIndex,
              },
            },
          ]
        : [],
  };

  if (map.getSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID)) {
    map.getSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID).setData(data);
    return;
  }

  map.addSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID,
    type: "circle",
    source: ROUTE_DIRECTION_LIT_POINT_SOURCE_ID,
    paint: {
      "circle-radius": 7,
      "circle-color": "#ff4444",
      "circle-stroke-color": "#ffd54a",
      "circle-stroke-width": 3,
      "circle-blur": 0.4,
    },
  });

  map.addLayer({
    id: ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID,
    type: "symbol",
    source: ROUTE_DIRECTION_LIT_POINT_SOURCE_ID,
    layout: {
      "text-field": ["coalesce", ["get", "index"], ""],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });
}

export function clearRouteDirectionLitPointLayer(map) {
  if (map.getLayer(ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID)) {
    map.removeLayer(ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID);
  }
  if (map.getLayer(ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID)) {
    map.removeLayer(ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID);
  }
  if (map.getSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID)) {
    map.removeSource(ROUTE_DIRECTION_LIT_POINT_SOURCE_ID);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/map/mapLayers.js
git commit -m "Add lit-point Mapbox source and layer helpers"
```

---

## Task 10: MapView — chevron marker + lit-point subscription

**Files:**
- Modify: `src/map/MapView.jsx`

Manual verification at the end; no new unit tests. The existing test suite must still pass.

- [ ] **Step 1: Extend the props list**

In `src/map/MapView.jsx`, add `animator` and `mapDirectionAnimator` related imports at the top. First, extend the imports from `mapLayers.js` (the existing import block at the top of the file) to also import:

```js
  clearRouteDirectionLitPointLayer,
  syncRouteDirectionLitPointLayer,
```

Then add `animator = null,` to the `MapView` function's destructured props (just below `activeDataPointIds = []` for consistency):

```js
function MapView({
  activeDataPointIds = [],
  animator = null,
  dataMarkerFeatures = [],
  // ... rest unchanged
}) {
```

- [ ] **Step 2: Add the chevron-marker effect**

Inside the `MapView` component, *after* the existing route-geometry sync effect (the one that calls `syncRouteGeometryLayer`), add:

```jsx
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !animator) return undefined;

    const mapboxgl = window.mapboxgl;
    if (!mapboxgl) return undefined;

    const element = document.createElement("div");
    element.className = "route-direction-chevron";
    element.style.cssText = `
      width: 24px;
      height: 16px;
      pointer-events: none;
      display: none;
      mix-blend-mode: screen;
      transform-origin: 50% 50%;
    `;
    element.innerHTML = `
      <svg viewBox="-12 -8 24 16" width="24" height="16" xmlns="http://www.w3.org/2000/svg">
        <polygon points="0,-5 9,0 0,5" fill="#ffffff" fill-opacity="0.95"/>
        <polygon points="-9,-4 0,0 -9,4" fill="#ffffff" fill-opacity="0.55"/>
        <polygon points="-18,-3 -9,0 -18,3" fill="#ffffff" fill-opacity="0.25"/>
      </svg>
    `;

    const marker = new mapboxgl.Marker({ element, anchor: "center" })
      .setLngLat([0, 0])
      .addTo(map);

    const unsubscribe = animator.subscribe("chevron", (payload) => {
      if (!payload) {
        element.style.display = "none";
        return;
      }
      marker.setLngLat([payload.lng, payload.lat]);
      element.style.display = "block";
      element.style.transform = `translate(-50%, -50%) rotate(${payload.bearing}deg)`;
    });

    return () => {
      unsubscribe();
      marker.remove();
    };
  }, [animator, status]);
```

Note: the Mapbox `Marker` element's `transform` is owned by Mapbox itself for positioning. To rotate without fighting it, instead apply the rotation to a child wrapper. Adjust the SVG element wrap as follows — replace the marker block with this version that wraps the rotating SVG in the marker's host element:

```jsx
    const host = document.createElement("div");
    host.className = "route-direction-chevron";
    host.style.cssText = `
      width: 24px;
      height: 16px;
      pointer-events: none;
      display: none;
    `;
    const rotor = document.createElement("div");
    rotor.style.cssText = `
      width: 100%;
      height: 100%;
      transform-origin: 50% 50%;
      mix-blend-mode: screen;
    `;
    rotor.innerHTML = `
      <svg viewBox="-12 -8 24 16" width="24" height="16" xmlns="http://www.w3.org/2000/svg">
        <polygon points="0,-5 9,0 0,5" fill="#ffffff" fill-opacity="0.95"/>
        <polygon points="-9,-4 0,0 -9,4" fill="#ffffff" fill-opacity="0.55"/>
        <polygon points="-18,-3 -9,0 -18,3" fill="#ffffff" fill-opacity="0.25"/>
      </svg>
    `;
    host.appendChild(rotor);

    const marker = new mapboxgl.Marker({ element: host, anchor: "center" })
      .setLngLat([0, 0])
      .addTo(map);

    const unsubscribe = animator.subscribe("chevron", (payload) => {
      if (!payload) {
        host.style.display = "none";
        return;
      }
      marker.setLngLat([payload.lng, payload.lat]);
      host.style.display = "block";
      rotor.style.transform = `rotate(${payload.bearing}deg)`;
    });

    return () => {
      unsubscribe();
      marker.remove();
    };
```

The `host` is positioned by Mapbox; the inner `rotor` is rotated by our code without conflict.

- [ ] **Step 3: Add the lit-point subscription effect**

Immediately after the chevron effect, add:

```jsx
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !animator) return undefined;

    const unsubscribe = animator.subscribe("litPoint", (payload) => {
      if (!map.getSource) return;
      const adapted = payload
        ? { ...payload, displayIndex: payload.index + 1 }
        : null;
      syncRouteDirectionLitPointLayer(map, adapted);
    });

    return () => {
      unsubscribe();
      clearRouteDirectionLitPointLayer(map);
    };
  }, [animator, status]);
```

- [ ] **Step 4: Run the existing test suite to make sure nothing else broke**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/map/MapView.jsx
git commit -m "Wire MapView to render the chevron marker and lit-point layer"
```

---

## Task 11: ElevationProfile — synced moving marker

**Files:**
- Modify: `src/components/RoutePanel.jsx` (well — actually `src/App.jsx`; see step note)

> **Note:** `ElevationProfile` is defined inline in `src/App.jsx` (around line 1589), not in `RoutePanel.jsx`. Modify it where it lives.

- [ ] **Step 1: Extend the `ElevationProfile` signature**

In `src/App.jsx`, find `function ElevationProfile({ distance, geometry, onElevationHover })` (~line 1589). Change the signature to also accept `animator`:

```jsx
function ElevationProfile({ animator, distance, geometry, onElevationHover }) {
```

Update the call site (the `RouteDescription` function around line 1515) to pass `animator` through. First, change the `RouteDescription` signature to accept `animator`, then pass it down:

```jsx
function RouteDescription({
  animator,
  error,
  hasBrokenRoute,
  onElevationHover,
  onRemoveRoutePoint,
  onSelectRoutePoint,
  routeState,
  selectedRoutePointIndex,
}) {
```

Inside `RouteDescription`, find the `<ElevationProfile … />` JSX and add the prop:

```jsx
<ElevationProfile
  animator={animator}
  distance={routeState.distance}
  geometry={routeState.geometry}
  onElevationHover={onElevationHover}
/>
```

- [ ] **Step 2: Add the marker ref and subscription**

Inside `ElevationProfile`, add a ref for the SVG line and a subscription effect. Insert immediately after the `const profile = useMemo(...)` line:

```jsx
  const markerLineRef = useRef(null);

  useEffect(() => {
    if (!animator) return undefined;
    const unsubscribe = animator.subscribe("elevation", (payload) => {
      const line = markerLineRef.current;
      if (!line) return;
      if (!payload) {
        line.setAttribute("opacity", "0");
        return;
      }
      const x = Math.max(0, Math.min(100, payload.t * 100));
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("opacity", "1");
    });
    return unsubscribe;
  }, [animator]);
```

At the top of `App.jsx`, ensure `useRef` is in the React import. The existing import already includes most hooks; if `useRef` is missing, add it.

- [ ] **Step 3: Render the marker line inside the existing SVG**

In the same `ElevationProfile`, find the existing `<svg ...>` block. Inside, alongside the `<path d={profile.pathData} ... />`, add the line:

```jsx
<line
  ref={markerLineRef}
  x1="0"
  x2="0"
  y1="0"
  y2="100"
  stroke="#ffd54a"
  strokeWidth="0.6"
  strokeLinecap="round"
  opacity="0"
  style={{ pointerEvents: "none" }}
/>
```

- [ ] **Step 4: Run the existing test suite**

Run: `npm test`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "Add synced direction marker to elevation profile"
```

---

## Task 12: App-level wiring — animator ref, snap helper, trigger effect, isDragging

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Import the animator and create the ref**

In `src/App.jsx`, add the import near the other `src/map/...` imports at the top:

```js
import { createRouteDirectionAnimator } from "./map/routeDirectionAnimator.js";
```

Inside the main `App` component, near the other `useRef` declarations (e.g. `routeManagerRef`, `routeStateRef`), add:

```jsx
  const directionAnimatorRef = useRef(null);
  if (directionAnimatorRef.current === null) {
    directionAnimatorRef.current = createRouteDirectionAnimator();
  }

  useEffect(() => {
    return () => {
      directionAnimatorRef.current?.dispose();
      directionAnimatorRef.current = null;
    };
  }, []);
```

The lazy init pattern avoids re-creating the animator on every render (a plain `useRef(createRouteDirectionAnimator())` would call the factory each render — undesirable for an object that owns a RAF loop).

- [ ] **Step 2: Add `isDragging` tracking**

Find `handleRoutePointDragStart` (~line 629). Add a ref before it:

```jsx
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
```

(If `useState` is not yet imported in this file, it already is — `useState` is used heavily.)

Update `handleRoutePointDragStart`:

```jsx
  const handleRoutePointDragStart = useCallback(() => {
    dragStartSnapshotRef.current = routeStateSnapshot(routeState);
    isDraggingRef.current = true;
    setIsDragging(true);
  }, [routeState]);
```

Update `handleRoutePointDragEnd`:

```jsx
  const handleRoutePointDragEnd = useCallback(() => {
    if (!dragStartSnapshotRef.current) return;
    const startSnapshot = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    setRouteHistory((current) => ({
      past: [...current.past, startSnapshot],
      future: [],
    }));
    trackRoutePointEvent(routeState.points, routeState.selectedSegments, "drag");
    isDraggingRef.current = false;
    setIsDragging(false);
  }, [routeState.points, routeState.selectedSegments]);
```

- [ ] **Step 3: Add the snap helper and the trigger effect**

Near the bottom of the file (alongside `findClosestElevationPoint` and `buildElevationProfile`), add:

```js
function snapRoutePointsToGeometryIndices(routePoints, geometry) {
  if (!Array.isArray(routePoints) || !Array.isArray(geometry)) return [];
  const indices = [];
  for (const point of routePoints) {
    if (point?.pending) continue;
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) continue;
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < geometry.length; i++) {
      const g = geometry[i];
      const dLat = g.lat - point.lat;
      const dLng = g.lng - point.lng;
      // Equirectangular squared distance is sufficient for argmin selection.
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    indices.push(bestIndex);
  }
  return indices;
}
```

Back in `App`, place a new effect alongside the existing route effects (after the route URL-restoration effect; the exact placement is not load-bearing — anywhere inside the component body works):

```jsx
  useEffect(() => {
    const animator = directionAnimatorRef.current;
    if (!animator) return;
    if (isDragging) return;

    const geometry = routeState.geometry;
    const points = routeState.points || [];

    if (!Array.isArray(geometry) || geometry.length < 2 || points.length < 2) {
      animator.cancel();
      return;
    }

    const indices = snapRoutePointsToGeometryIndices(points, geometry);
    if (indices.length < 2) {
      animator.cancel();
      return;
    }

    animator.trigger(geometry, indices);
  }, [routeState.geometry, routeState.points, isDragging]);
```

- [ ] **Step 4: Prop-drill the animator into `MapView` and `RouteDescription`**

In the same App render tree, find the `<MapView ... />` JSX. Add:

```jsx
animator={directionAnimatorRef.current}
```

In the same alphabetic order as the other props (i.e., between `activeDataPointIds` and `dataMarkerFeatures`).

Find the `<RouteDescription ... />` JSX. Add:

```jsx
animator={directionAnimatorRef.current}
```

(As the first or alphabetically-correct prop.)

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "Wire direction animator into App with snap helper and trigger effect"
```

---

## Task 13: Manual smoke + final verification

**Files:** none modified; verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every test file passes, including `test-route-direction-animator.mjs`.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: Vite serves at `http://127.0.0.1:5173/`.

- [ ] **Step 3: Manual smoke — URL-loaded route**

Open a shareable `?route=...` URL in the browser. Within 1 second of the route line appearing, verify:

- a small white chevron pulse slides from the route start to the route end;
- each route-point dot briefly glows gold with a tiny number "1", "2", "3", ... as the chevron passes;
- a thin gold vertical line on the elevation graph slides left → right in lockstep with the chevron;
- after a ~1.2s pause, the pulse runs once more (cycle 2);
- after cycle 2 completes, all overlays disappear and stay gone.

- [ ] **Step 4: Manual smoke — compose mode**

Clear the URL and click points on the map to compose a route:

- single point: no animation (correct — direction is undefined);
- second point added: animation burst plays;
- add a third point: in-flight burst cancels, a fresh burst plays against the new geometry;
- drag a point: no animation runs *during* the drag; on drag-end, animation fires once;
- remove a point (right-click): animation fires;
- remove all points: any in-flight animation overlay disappears.

- [ ] **Step 5: Manual smoke — direction reversal**

Compose an out-and-back route: click point A, then a far point B, then a point near A. Verify the chevron physically reverses course at point B (the pulse appears to turn around).

- [ ] **Step 6: Manual smoke — reduced motion**

In your OS, enable "Reduce motion" (macOS: System Settings → Accessibility → Display → Reduce motion). Reload the dev server tab. Load a `?route=...` URL again. Verify:

- no chevron appears;
- no elevation marker slides;
- each route-point dot lights briefly in sequence (1 → 2 → 3 → ...) with no movement.

Disable reduced motion afterwards.

- [ ] **Step 7: Manual smoke — performance sanity**

With Chrome DevTools Performance tab recording, trigger an animation burst. After the ~10s burst ends, verify there is no further activity on the main thread attributable to the animator (no recurring RAF callbacks).

- [ ] **Step 8: Final commit (only if any tweaks were needed during smoke)**

If steps 3–7 turned up small issues you fixed (e.g., adjusting `circle-radius`, `text-size`, or `stroke-width` for visual polish), commit them now:

```bash
git status
git add <files>
git commit -m "Polish direction animation based on smoke testing"
```

If no fixes were needed, skip this step.

---

## Self-Review Notes

Spec coverage check: ✓ Goal · ✓ Style A pulse · ✓ Tiny dot + glow + number · ✓ 2-cycle burst · ✓ cycle duration formula · ✓ Elevation synced marker · ✓ Triggers (URL load, geometry change, suppress during drag) · ✓ Direction reversal handled by index-order traversal · ✓ Reduced motion · ✓ Cancel-and-restart · ✓ Tab background recovery · ✓ Edge cases (geometry < 2, zero-length segments).

Type/name consistency: animator surface is `{trigger, subscribe, cancel, dispose}` everywhere. Channels are `"chevron" | "litPoint" | "elevation"`. Payloads: chevron `{lng, lat, bearing} | null`, litPoint `{index, lng, lat} | null` (0-based index; consumers add 1 for display via `displayIndex` in `syncRouteDirectionLitPointLayer`), elevation `{t} | null`. State machine phases: `cycle1 | gap | cycle2 | done(=null state)` plus `reduced`.

No placeholders — every step has the actual code or command, and exact file paths.
