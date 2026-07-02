# Turn-by-Turn Navigation Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native turn-by-turn behave like dependable navigation — explicit route acquisition, network-aware ride context, one smooth adaptive rider puck + camera, and off-route/approach/wrong-way guidance — backed by a deterministic GPS-track replay harness and an in-app simulate-ride mode.

**Architecture:** Almost all logic is pure code in `@cycleways/core` (node-tested via `node tests/test-*.mjs` added to the `npm test` chain); the iPhone app (`apps/mobile`) is a thin renderer. We build the node replay harness first so every later change lands with a deterministic test, then fix the acquisition correctness bug, then plumb a route-distance segment-span index, then layer context/cues/puck/guidance on top, and finally add the in-app simulator that reuses the same pure pieces.

**Tech Stack:** Node ESM, `node:assert/strict` tests, `@cycleways/core` workspace, React Native + `@rnmapbox/maps` + `expo-location`/`expo-haptics` (foreground-only).

## Global Constraints

- **Test runner:** each new/updated pure test is a standalone `node tests/test-<name>.mjs` file using `import assert from "node:assert/strict";` and importing core via `@cycleways/core/...`. New test files MUST be appended to the `"test"` script `&&` chain in `package.json`. Run the whole suite with `npm test`; run one file with `node tests/test-<name>.mjs` (exit 0 = pass, throw = fail).
- **Copy:** all rider-facing strings are Hebrew/RTL, matching `navigationPresentation.js` (`writingDirection: "rtl"`). English in this plan is the meaning, not the literal string — use the Hebrew shown per task.
- **No manual edits to generated map/public data** (`data/map-source.geojson`, `public-data/*`). This plan touches only source code, tests, and fixtures under `tests/fixtures/`.
- **Foreground-only navigation** stays the rule (`background:false` default in `useNavigationSession`). Do not enable background location.
- **NavigationRoute is immutable** input to the session; navigation never mutates planner route state.
- **Distance frame:** any along-route distance (spans, cues, guidance, smoothing) is expressed in the **same haversine frame** as `NavigationRoute.geometry[i].distanceFromStartMeters`. Never mix raw routing-graph edge lengths into that frame.
- **Dev-only code** (simulate-ride source, recorder) must be gated behind a dev flag and excluded from production builds.

---

## File Structure

New core files:
- `packages/core/src/navigation/navigationSmoothing.js` — pure smoothing math (point/bearing at distance, progress tween, angle lerp).
- `packages/core/src/navigation/trackGenerator.js` — synthetic GPS fix-stream generator.
- `packages/core/src/navigation/replayRunner.js` — drives a session over a fix array, records the state timeline.

New fixtures/tests:
- `tests/fixtures/nav-ride-realistic.json` — a hand-authored realistic fix stream (irregular timing, varying accuracy, a pause, a GPS jump, an approach lead-in).
- `tests/test-navigation-smoothing.mjs`, `tests/test-navigation-replay.mjs`, `tests/test-segment-spans.mjs` (new).

Modified core files:
- `packages/core/src/utils/geometry.js` — export `pointAndBearingAtDistance`.
- `packages/core/src/domain/routeDirectionAnimator.js` — consume the extracted helper.
- `packages/core/route-manager.js` — emit `segmentSpans` from `getRouteInfo`.
- `packages/core/src/routing/routeActions.js` — `segmentSpans` in `snapshotRouteManager`, empty snapshot, `routeStateSnapshot`.
- `packages/core/src/routing/routeReducer.js` — `segmentSpans` in `initialRouteState`, `route/update`, `route/clear`.
- `packages/core/src/navigation/navigationRoute.js` — carry + distance-frame-reconcile `segmentSpans`.
- `packages/core/src/navigation/routeProgress.js` — acquisition gate, guidance outputs, segment-context fields.
- `packages/core/src/navigation/navigationSession.js` — `approaching` status; suppress progress/cues until acquired.
- `packages/core/src/navigation/navigationCues.js` — `enter-segment` cues + priority/merge/suppression.
- `packages/core/src/navigation/cueHaptics.js` — gate haptics by cue type.
- `packages/core/src/navigation/navigationPresentation.js` — `contextText`, guidance, wrong-way strings.

Modified native files:
- `apps/mobile/src/navigation/useNavigationSession.js` — injectable `locationSource`.
- `apps/mobile/src/navigation/locationService.js` — export the default (real) source factory.
- `apps/mobile/src/MapScreen.jsx` — hide raw puck while navigating; single adaptive smoothed puck; camera from smoothed position.
- `apps/mobile/src/planner/NavPanel.jsx` — context line, guidance arrow, wrong-way.
- `apps/mobile/src/navigation/simulateRideSource.js` (new, dev-only) + a dev recorder.

Updated existing tests (extend, don't rewrite):
- `tests/test-route-progress.mjs`, `tests/test-navigation-cues.mjs`, `tests/test-navigation-session.mjs`, `tests/test-cue-haptics.mjs`, `tests/test-navigation-presentation.mjs`, `tests/test-navigation-route.mjs`, `tests/test-route-reducer.mjs`, `tests/test-route-direction-animator.mjs`.

---

## Phase 1 — Node replay harness (built first)

### Task 1: Replay runner

**Files:**
- Create: `packages/core/src/navigation/replayRunner.js`
- Create/Test: `tests/test-navigation-replay.mjs`
- Modify: `package.json` (append test to `"test"` chain)

**Interfaces:**
- Consumes: `createNavigationSession(navigationRoute, options)` and `NAV_ACTIONS` from `@cycleways/core/navigation/navigationSession.js`; `navigationRouteFromRouteState` from `navigationRoute.js`.
- Produces: `replaySession(navigationRoute, fixes, options) -> { timeline: object[], last: object }`. It dispatches `START`, then `PERMISSION_GRANTED` (`background:false`), then one `LOCATION` per fix in order, pushing `session.getState()` after each `LOCATION` into `timeline`. `options.sessionOptions` is forwarded to `createNavigationSession`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-navigation-replay.mjs
import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import { replaySession } from "@cycleways/core/navigation/replayRunner.js";

function straightRoute() {
  return navigationRouteFromRouteState(
    {
      points: [
        { id: "a", lat: 33.1, lng: 35.6 },
        { id: "b", lat: 33.1, lng: 35.61 },
      ],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.605 },
        { lat: 33.1, lng: 35.61 },
      ],
      distance: 931.5,
    },
    { param: "straight" },
  );
}

// Runner drives the real session over a fix array and records one state per fix.
{
  const fixes = [
    { lat: 33.1, lng: 35.6, accuracy: 5, speed: 3, timestamp: 1000 },
    { lat: 33.1, lng: 35.605, accuracy: 5, speed: 3, timestamp: 4000 },
    { lat: 33.1, lng: 35.61, accuracy: 5, speed: 3, timestamp: 7000 },
  ];
  const { timeline, last } = replaySession(straightRoute(), fixes);
  assert.equal(timeline.length, 3, "one recorded state per fix");
  assert.ok(last.progress, "last state carries progress");
  assert.ok(
    last.progress.progressMeters > timeline[0].progress.progressMeters,
    "progress advances across the timeline",
  );
}

console.log("test-navigation-replay OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-replay.mjs`
Expected: FAIL — `Cannot find module .../replayRunner.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/core/src/navigation/replayRunner.js
// Pure node harness: drive the real navigation session over a recorded or
// generated fix stream and capture the resulting state timeline. No clocks —
// timestamps come from the fixes.
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "./navigationSession.js";

export function replaySession(navigationRoute, fixes, options = {}) {
  const session = createNavigationSession(navigationRoute, options.sessionOptions);
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const timeline = [];
  for (const fix of Array.isArray(fixes) ? fixes : []) {
    session.dispatch({ type: NAV_ACTIONS.LOCATION, fix });
    timeline.push(session.getState());
  }
  return { timeline, last: timeline[timeline.length - 1] ?? session.getState() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-replay.mjs`
Expected: `test-navigation-replay OK`.

- [ ] **Step 5: Append to the suite and commit**

Append ` && node tests/test-navigation-replay.mjs` to the `"test"` script in `package.json` (end of the chain, before `&& cd tests && node test-route-manager.js`).

```bash
git add packages/core/src/navigation/replayRunner.js tests/test-navigation-replay.mjs package.json
git commit -m "test(nav): node replay runner driving the real session over a fix stream

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Synthetic track generator

**Files:**
- Create: `packages/core/src/navigation/trackGenerator.js`
- Modify/Test: `tests/test-navigation-replay.mjs`

**Interfaces:**
- Consumes: `precomputeArcLength` and `pointAndBearingAtDistance` are NOT yet available; this task samples geometry directly by walking `distanceFromStartMeters`. Consumes `navigationRoute.geometry`.
- Produces: `generateTrack(navigationRoute, options) -> fix[]` where `fix = { lat, lng, accuracy, heading, speed, timestamp }`. Options (all optional): `{ speedMps=4, intervalMs=1000, jitterM=0, seed=1, startTimestamp=0, approachFrom=null, stopAtMeters=null }`. Walks the route from 0 to `stopAtMeters ?? totalMeters` at `speedMps`, emitting a fix every `intervalMs`; `heading` is the geometry bearing; `jitterM` offsets lat/lng deterministically from `seed`; when `approachFrom` is set, prepends fixes linearly interpolating from `approachFrom` to the route start (rider approaching before acquisition).

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-replay.mjs`, above the final `console.log`)

```js
// --- synthetic generator ---
import { generateTrack } from "@cycleways/core/navigation/trackGenerator.js";
{
  const route = straightRoute();
  const fixes = generateTrack(route, { speedMps: 5, intervalMs: 1000, seed: 7 });
  assert.ok(fixes.length >= 2, "generator emits multiple fixes");
  assert.equal(fixes[0].timestamp, 0, "default start timestamp is 0");
  assert.equal(fixes[1].timestamp - fixes[0].timestamp, 1000, "interval honored");
  // Approach lead-in: fixes before the route start.
  const withApproach = generateTrack(route, {
    speedMps: 5,
    approachFrom: { lat: 33.1, lng: 35.594 }, // ~560 m west of start
  });
  const first = withApproach[0];
  const distToStart = Math.hypot((first.lat - 33.1), (first.lng - 35.6));
  assert.ok(distToStart > 0.001, "approach fixes start away from the route");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-replay.mjs`
Expected: FAIL — `Cannot find module .../trackGenerator.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/core/src/navigation/trackGenerator.js
// Deterministic synthetic GPS fix-stream generator for the replay harness.
import { computeBearing } from "../utils/geometry.js";
import { getDistance } from "../utils/distance.js";

const METERS_PER_DEG_LAT = 111320;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Linear interpolate a lat/lng along the geometry at a target distance (m).
function pointAtMeters(geometry, meters) {
  if (meters <= 0) return { ...geometry[0] };
  const last = geometry[geometry.length - 1];
  if (meters >= last.distanceFromStartMeters) return { ...last };
  for (let i = 1; i < geometry.length; i++) {
    if (geometry[i].distanceFromStartMeters >= meters) {
      const a = geometry[i - 1];
      const b = geometry[i];
      const span = b.distanceFromStartMeters - a.distanceFromStartMeters;
      const t = span > 0 ? (meters - a.distanceFromStartMeters) / span : 0;
      return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
    }
  }
  return { ...last };
}

function bearingAtMeters(geometry, meters) {
  for (let i = 1; i < geometry.length; i++) {
    if (geometry[i].distanceFromStartMeters >= meters) {
      return computeBearing(geometry[i - 1], geometry[i]);
    }
  }
  return computeBearing(geometry[geometry.length - 2], geometry[geometry.length - 1]);
}

export function generateTrack(navigationRoute, options = {}) {
  const {
    speedMps = 4,
    intervalMs = 1000,
    jitterM = 0,
    seed = 1,
    startTimestamp = 0,
    approachFrom = null,
    stopAtMeters = null,
  } = options;
  const geometry = navigationRoute?.geometry ?? [];
  if (geometry.length < 2) return [];
  const rand = mulberry32(seed);
  const fixes = [];
  let timestamp = startTimestamp;
  const jitter = (lat) => {
    if (jitterM <= 0) return { dLat: 0, dLng: 0 };
    const dLat = ((rand() - 0.5) * 2 * jitterM) / METERS_PER_DEG_LAT;
    const dLng =
      ((rand() - 0.5) * 2 * jitterM) /
      (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    return { dLat, dLng };
  };

  // Approach lead-in (rider riding toward the route start).
  if (approachFrom) {
    const start = geometry[0];
    const approachDist = getDistance(approachFrom, start);
    const steps = Math.max(1, Math.round(approachDist / (speedMps * (intervalMs / 1000))));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      fixes.push({
        lat: approachFrom.lat + t * (start.lat - approachFrom.lat),
        lng: approachFrom.lng + t * (start.lng - approachFrom.lng),
        accuracy: 5,
        heading: computeBearing(approachFrom, start),
        speed: speedMps,
        timestamp,
      });
      timestamp += intervalMs;
    }
  }

  const total = geometry[geometry.length - 1].distanceFromStartMeters;
  const end = stopAtMeters === null ? total : Math.min(stopAtMeters, total);
  const stepMeters = speedMps * (intervalMs / 1000);
  for (let m = 0; m <= end + 1e-6; m += stepMeters) {
    const meters = Math.min(m, end);
    const p = pointAtMeters(geometry, meters);
    const { dLat, dLng } = jitter(p.lat);
    fixes.push({
      lat: p.lat + dLat,
      lng: p.lng + dLng,
      accuracy: jitterM > 0 ? Math.max(5, jitterM) : 5,
      heading: bearingAtMeters(geometry, meters),
      speed: speedMps,
      timestamp,
    });
    timestamp += intervalMs;
    if (meters >= end) break;
  }
  return fixes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-replay.mjs`
Expected: `test-navigation-replay OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/trackGenerator.js tests/test-navigation-replay.mjs
git commit -m "test(nav): deterministic synthetic GPS track generator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Realistic ride fixture + milestone test (drives the acquisition fix)

**Files:**
- Create: `tests/fixtures/nav-ride-realistic.json`
- Modify/Test: `tests/test-navigation-replay.mjs`

**Interfaces:**
- Consumes: `replaySession`, `navigationRouteFromRouteState`. The fixture is a JSON object `{ route: { points, selectedSegments, geometry, distance }, fixes: fix[], milestones: {...} }`.
- Produces: an asserted-on milestone contract. **This test encodes the CORRECT acquisition behavior and is EXPECTED TO FAIL until Task 4.** Note that in the comment.

The fixture's `fixes` MUST include, in order: (a) an approach lead-in starting ~500 m from the route start (several fixes), (b) on-route progress fixes with irregular timestamps and varying `accuracy` (e.g. 5–25 m), (c) a short pause (2–3 near-identical fixes), (d) one implausible GPS jump (a single fix offset ~80 m then back). Author it by hand or via `generateTrack` then edit; keep it small (≈20–30 fixes).

- [ ] **Step 1: Author the fixture** `tests/fixtures/nav-ride-realistic.json` with the route geometry (reuse a short 3–5 vertex line ~1 km), the fix stream described above, and:

```json
"milestones": {
  "approachFixCount": 6,
  "acquiredByFixIndex": 6,
  "minProgressBeforeAcquireM": 0,
  "finalProgressAtLeastM": 800
}
```

- [ ] **Step 2: Write the failing test** (append to `tests/test-navigation-replay.mjs`)

```js
// --- realistic fixture milestones (EXPECTED TO FAIL until acquisition lands) ---
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
{
  const path = fileURLToPath(new URL("./fixtures/nav-ride-realistic.json", import.meta.url));
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const route = navigationRouteFromRouteState(fx.route, { param: "fixture" });
  const { timeline, last } = replaySession(route, fx.fixes);

  // Before acquisition the session must NOT report on-route progress.
  for (let i = 0; i < fx.milestones.approachFixCount; i++) {
    assert.equal(
      timeline[i].progress.hasAcquiredRoute,
      false,
      `fix ${i} (approach) must not be acquired`,
    );
    assert.equal(
      timeline[i].progress.progressMeters,
      fx.milestones.minProgressBeforeAcquireM,
      `fix ${i} (approach) must not advance progress`,
    );
    assert.equal(timeline[i].status, "approaching", `fix ${i} status is approaching`);
  }
  assert.equal(
    timeline[fx.milestones.acquiredByFixIndex].progress.hasAcquiredRoute,
    true,
    "route acquired once the rider reaches it",
  );
  assert.ok(
    last.progress.progressMeters >= fx.milestones.finalProgressAtLeastM,
    "progress completes despite jitter, pause, and the GPS jump",
  );
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node tests/test-navigation-replay.mjs`
Expected: FAIL — `progress.hasAcquiredRoute` is `undefined`/progress advanced during approach (the current tracker advances from the first far fix). This failure is the spec for Task 4.

- [ ] **Step 4: Commit the failing fixture + test**

```bash
git add tests/fixtures/nav-ride-realistic.json tests/test-navigation-replay.mjs
git commit -m "test(nav): realistic ride fixture asserting acquisition milestones (red)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Route-acquisition correctness

### Task 4: Acquisition gate + guidance outputs in the tracker

**Files:**
- Modify: `packages/core/src/navigation/routeProgress.js`
- Modify/Test: `tests/test-route-progress.mjs`

**Interfaces:**
- Consumes: existing `createRouteProgressTracker(navigationRoute, options).update(fix)`.
- Produces: `update(fix)` return gains `hasAcquiredRoute:boolean`, `guidanceTargetPoint:{lat,lng}|null`, `guidanceTargetProgressMeters:number|null`, `guidanceDistanceMeters:number|null`, `guidanceBearingDeg:number|null`. While `hasAcquiredRoute` is false: `progressMeters` stays `0`, the cursor does not advance, `offRoute` stays false, and guidance targets the route start. Once the rider comes within `acquireMeters` (default `opts.offRouteEnterMeters + accuracyFactor*accuracy`) of the geometry, acquisition latches true for the rest of the session; thereafter guidance targets the nearest point at/ahead of current progress and off-route hysteresis behaves as today.

- [ ] **Step 1: Write the failing test** (append to `tests/test-route-progress.mjs`)

```js
// --- acquisition gate ---
import { computeBearing as _cb } from "@cycleways/core/utils/geometry.js";
{
  const tracker = createRouteProgressTracker(straightRoute());
  // First fix ~557 m north of the route: must NOT acquire or advance.
  const far = tracker.update({ lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 });
  assert.equal(far.hasAcquiredRoute, false, "far first fix is not acquired");
  assert.equal(far.progressMeters, 0, "no progress before acquisition");
  assert.equal(far.offRoute, false, "approaching is not off-route");
  assert.ok(far.guidanceDistanceMeters > 500, "guidance distance to start is reported");
  assert.ok(Number.isFinite(far.guidanceBearingDeg), "guidance bearing is reported");
  assert.deepEqual(far.guidanceTargetPoint, { lat: 33.1, lng: 35.6 }, "targets route start");

  // Arrive at the start: acquire and begin progress.
  const near = tracker.update({ lat: 33.1, lng: 35.6, accuracy: 8, speed: 4, timestamp: 4000 });
  assert.equal(near.hasAcquiredRoute, true, "acquired at the route");
  // Move along: progress advances and stays acquired.
  const mid = tracker.update({ lat: 33.1, lng: 35.605, accuracy: 8, speed: 4, timestamp: 7000 });
  assert.equal(mid.hasAcquiredRoute, true, "acquisition latches");
  assert.ok(mid.progressMeters > 400, "progress advances after acquisition");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-route-progress.mjs`
Expected: FAIL — `hasAcquiredRoute` undefined and `progressMeters` non-zero on the far fix.

- [ ] **Step 3: Write the implementation**

In `routeProgress.js`: add `acquired = false;` to the tracker's mutable state and reset it in `reset()`. Add `acquireMeters` to `DEFAULTS` (reuse: compute inline from `offRouteEnterMeters`). Rewrite the body of `update(fix)` so that:

```js
// inside update(fix), after computing `best` and `enterThreshold`:
const distanceToRouteStart =
  geometry.length > 0 ? getDistance(fix, geometry[0]) : 0;

if (!acquired) {
  // Acquisition: latch true once within the on-route threshold of the line.
  if (best && best.crossTrackMeters <= enterThreshold) {
    acquired = true;
    lastProgressMeters = best.progressMeters;
  } else {
    // Still approaching: do not advance progress or flag off-route.
    prevFix = fix;
    const startBearing =
      geometry.length > 0 ? computeBearing(fix, geometry[0]) : null;
    return {
      onRoute: false,
      offRoute: false,
      hasAcquiredRoute: false,
      crossTrackMeters: best ? best.crossTrackMeters : 0,
      progressMeters: 0,
      fraction: 0,
      remainingMeters: totalMeters,
      bearingToNextDeg: null,
      courseDeg: riderCourse(fix),
      headingAgreementDeg: null,
      wrongWay: false,
      distanceToRouteStart,
      guidanceTargetPoint: geometry.length > 0
        ? { lat: geometry[0].lat, lng: geometry[0].lng }
        : null,
      guidanceTargetProgressMeters: 0,
      guidanceDistanceMeters: distanceToRouteStart,
      guidanceBearingDeg: startBearing,
      snappedPoint: null,
      snappedIndex: null,
    };
  }
}
```

Then, in the acquired return object, ADD guidance fields targeting the nearest at/ahead point (which is the current snapped point when on-route, used by the UI only when off-route):

```js
const guidanceBearingDeg = best ? computeBearing(fix, best.snapped) : null;
// ...add to the existing acquired return:
hasAcquiredRoute: true,
guidanceTargetPoint: best ? { lat: best.snapped.lat, lng: best.snapped.lng } : null,
guidanceTargetProgressMeters: best ? best.progressMeters : null,
guidanceDistanceMeters: crossTrackMeters,
guidanceBearingDeg,
```

(Keep all existing acquired-path fields — `onRoute`, `offRoute`, `progressMeters`, etc. — unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-route-progress.mjs && node tests/test-navigation-replay.mjs`
Expected: both print `... OK` (the realistic fixture from Task 3 now passes its approach/acquire milestones; `status === "approaching"` still fails until Task 5 — see note).

> Note: the fixture test also asserts `status === "approaching"`, which is set by the session in Task 5. If running Task 3's full test now, that assertion still fails; that is expected and resolved by Task 5. The tracker-level assertions here pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/routeProgress.js tests/test-route-progress.mjs
git commit -m "feat(nav): route-acquisition gate + guidance outputs in progress tracker

Suppress progress/off-route until the rider reaches the route; expose
guidanceTargetPoint/Distance/Bearing for approach + off-route UI.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `approaching` session status + cue suppression

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify/Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: `progress.hasAcquiredRoute` from Task 4.
- Produces: session `status` is `"approaching"` while navigating-but-not-acquired; `activeCue`/`cueEvent` are suppressed (null) while `approaching`; `ACTIVE` location handling still runs. Once acquired, status is `"navigating"`/`"off-route"` as before. `cueEvent` for off-route only fires after acquisition.

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-session.mjs`; reuse that file's existing route helper — call it `route()` to match; if the helper name differs, use the existing one)

```js
// --- approaching status ---
{
  const session = createNavigationSession(straightRouteForSession());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const far = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 },
  });
  assert.equal(far.status, "approaching", "far fix -> approaching");
  assert.equal(far.activeCue, null, "no cues while approaching");
  assert.equal(far.cueEvent, null, "no cue events while approaching");
  const near = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 8, speed: 4, timestamp: 4000 },
  });
  assert.equal(near.status, "navigating", "reaching the route -> navigating");
}
```

(Add a local `straightRouteForSession()` helper in the test mirroring the one in `test-route-progress.mjs`, and ensure `createNavigationSession`/`NAV_ACTIONS` are imported — they already are in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — status is `"navigating"` (not `"approaching"`) and a cue may be present.

- [ ] **Step 3: Write the implementation**

In `navigationSession.js`, add `"approaching"` to the `ACTIVE` set so `LOCATION` keeps processing, and update the `LOCATION` case:

```js
const ACTIVE = new Set(["navigating", "off-route", "approaching"]);
```

```js
case NAV_ACTIONS.LOCATION: {
  if (!ACTIVE.has(state.status)) return state;
  const progress = tracker.update(action.fix);

  if (!progress.hasAcquiredRoute) {
    return set({
      status: "approaching",
      progress,
      activeCue: null,
      offRoute: false,
      cueEvent: null,
    });
  }

  const offRoute = progress.offRoute;
  const activeCue = selectActiveCue(cues, progress.progressMeters);
  // ... existing cueEvent computation unchanged ...
  return set({
    status: offRoute ? "off-route" : "navigating",
    progress,
    activeCue,
    offRoute,
    cueEvent,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-replay.mjs`
Expected: both `... OK` (Task 3's fixture now fully passes, including `status === "approaching"`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): approaching session status; suppress cues until acquired

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Segment-span index (foundation)

### Task 6: Emit `segmentSpans` from the route manager

**Files:**
- Modify: `packages/core/route-manager.js` (the `getRouteInfo` return + a helper)
- Create/Test: `tests/test-segment-spans.mjs`
- Modify: `package.json` (append test)

**Interfaces:**
- Consumes: in `getRouteInfo`'s base-routing branch, `routeInfo.traversals` (the computed route's traversal list; each traversal has `edge.cwSegmentIds`, `edge.routeClass`, `edge.highway`, `distanceMeters`, `fromDistance`/`toDistance`) and `this.segmentNamesById`. The legacy (non-base) branch has no traversals.
- Produces: `getRouteInfo()` return gains `segmentSpans: Array<{ startMeters, endMeters, name, cwSegmentId, onNetwork, routeClass }>` built from `routeInfo.traversals` in route order, in **graph-edge meters** (reconciled to the geometry frame later in Task 8). Adjacent traversals with the same `(name, onNetwork)` merge into one span. `name`/`cwSegmentId` null for off-network edges; `routeClass` from `edge.routeClass` (fallback `edge.highway`, else null). The legacy branch and the empty route return `segmentSpans: []`.

- [ ] **Step 1: Confirm the traversal/edge fields (already verified)**

The base route's traversals expose: `traversal.distanceMeters`, `traversal.fromDistance`, `traversal.edge.routeClass`, `traversal.edge.highway`, `traversal.edge.cwSegmentIds` (see `route-manager.js` ~lines 369-387, 925-948). `getRouteInfo`'s base-routing branch already has the computed route as `routeInfo` (carrying `traversals`); the legacy branch does not. No further inspection needed — proceed with these names.

- [ ] **Step 2: Write the failing test** `tests/test-segment-spans.mjs`

```js
import assert from "node:assert/strict";
import { buildSegmentSpans } from "@cycleways/core/route-manager.js";

// buildSegmentSpans is a pure exported helper over an ordered traversal list.
{
  const segmentNamesById = new Map([[10, "Yarkon Path"], [11, "Ayalon Bridge"]]);
  const traversals = [
    { fromDistance: 0, toDistance: 200, distanceMeters: 200, edge: { cwSegmentIds: [10], routeClass: "cycleway" } },
    { fromDistance: 0, toDistance: 150, distanceMeters: 150, edge: { cwSegmentIds: [10], routeClass: "cycleway" } },
    { fromDistance: 0, toDistance: 100, distanceMeters: 100, edge: { cwSegmentIds: [], routeClass: "residential" } },
    { fromDistance: 0, toDistance: 300, distanceMeters: 300, edge: { cwSegmentIds: [11], routeClass: "cycleway" } },
  ];
  const spans = buildSegmentSpans(traversals, segmentNamesById);
  assert.equal(spans.length, 3, "same-name traversals merge");
  assert.deepEqual(
    spans.map((s) => [s.startMeters, s.endMeters, s.name, s.onNetwork, s.routeClass]),
    [
      [0, 350, "Yarkon Path", true, "cycleway"],
      [350, 450, null, false, "residential"],
      [450, 750, "Ayalon Bridge", true, "cycleway"],
    ],
  );
}
console.log("test-segment-spans OK");
```

- [ ] **Step 3: Write the implementation**

In `route-manager.js`, export a pure helper and call it from `getRouteInfo`:

```js
export function buildSegmentSpans(traversals, segmentNamesById) {
  const spans = [];
  let cursor = 0;
  for (const traversal of Array.isArray(traversals) ? traversals : []) {
    const length = Math.abs(
      (traversal.distanceMeters ??
        (traversal.toDistance - traversal.fromDistance)) || 0,
    );
    if (length <= 0) continue;
    const ids = traversal.edge?.cwSegmentIds ?? [];
    const cwSegmentId = ids.length > 0 ? Number(ids[0]) : null;
    const name = cwSegmentId != null ? segmentNamesById.get(cwSegmentId) ?? null : null;
    const onNetwork = name != null;
    const routeClass =
      traversal.edge?.routeClass ?? traversal.edge?.highway ?? null;
    const start = cursor;
    cursor += length;
    const prev = spans[spans.length - 1];
    if (prev && prev.name === name && prev.onNetwork === onNetwork) {
      prev.endMeters = cursor;
      continue;
    }
    spans.push({
      startMeters: start,
      endMeters: cursor,
      name,
      cwSegmentId,
      onNetwork,
      routeClass,
    });
  }
  return spans;
}
```

Then in `getRouteInfo()`:
- In the **base-routing branch** (the `if (this.baseRoutingNetwork)` return, ~line 292), add:
  ```js
  segmentSpans: buildSegmentSpans(routeInfo.traversals, this.segmentNamesById),
  ```
  (`routeInfo` there is `this.baseRouteInfo || this._calculateBaseRoute(...)`, which carries `traversals`.)
- In the **legacy branch** (the second return, ~line 313), add:
  ```js
  segmentSpans: [],
  ```

Append ` && node tests/test-segment-spans.mjs` to `package.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-segment-spans.mjs`
Expected: `test-segment-spans OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/route-manager.js tests/test-segment-spans.mjs package.json
git commit -m "feat(routing): buildSegmentSpans from traversals; expose via getRouteInfo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Propagate `segmentSpans` through snapshots, undo/redo, reducer

**Files:**
- Modify: `packages/core/src/routing/routeActions.js` (`snapshotRouteManager`, empty snapshot, `routeStateSnapshot`)
- Modify: `packages/core/src/routing/routeReducer.js` (`initialRouteState`, `route/update`, `route/clear`)
- Modify/Test: `tests/test-route-reducer.mjs`

**Interfaces:**
- Consumes: `info.segmentSpans` from Task 6.
- Produces: `snapshotRouteManager` and `routeStateSnapshot` outputs carry `segmentSpans`; `routeReducer` `initialRouteState.segmentSpans = []`, `route/update` copies `action.snapshot.segmentSpans`, `route/clear` resets to `[]`.

- [ ] **Step 1: Write the failing test** (append to `tests/test-route-reducer.mjs`)

```js
// --- segmentSpans propagation through the reducer ---
{
  const spans = [{ startMeters: 0, endMeters: 100, name: "X", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" }];
  const updated = routeReducer(initialRouteState, {
    type: "route/update",
    snapshot: {
      points: [], selectedSegments: [], geometry: [], distance: 0,
      elevationGain: 0, elevationLoss: 0, activeDataPoints: [],
      routeFailure: null, segmentSpans: spans,
    },
  });
  assert.deepEqual(updated.segmentSpans, spans, "update copies segmentSpans");
  const cleared = routeReducer(updated, { type: "route/clear" });
  assert.deepEqual(cleared.segmentSpans, [], "clear resets segmentSpans");
  assert.deepEqual(initialRouteState.segmentSpans, [], "initial state has empty spans");
}
```

(Ensure `routeReducer` and `initialRouteState` are imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-route-reducer.mjs`
Expected: FAIL — `segmentSpans` undefined on the reduced state.

- [ ] **Step 3: Write the implementation**

`routeReducer.js`: add `segmentSpans: [],` to `initialRouteState`; add `segmentSpans: action.snapshot.segmentSpans || [],` to the `route/update` return; add `segmentSpans: [],` to the `route/clear` return.

`routeActions.js`: in `snapshotRouteManager` return, add `segmentSpans: info.segmentSpans || [],`; in `routeStateSnapshot`, add `segmentSpans: (routeState.segmentSpans || []).map((s) => ({ ...s })),`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-route-reducer.mjs && npm test 2>&1 | tail -3`
Expected: reducer test `OK`; full suite still green (no regressions in route-manager/snapshot tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/routing/routeActions.js packages/core/src/routing/routeReducer.js tests/test-route-reducer.mjs
git commit -m "feat(routing): propagate segmentSpans through snapshots, undo/redo, reducer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Carry + distance-frame-reconcile `segmentSpans` onto `NavigationRoute`

**Files:**
- Modify: `packages/core/src/navigation/navigationRoute.js`
- Modify/Test: `tests/test-navigation-route.mjs`

**Interfaces:**
- Consumes: `routeState.segmentSpans` (graph-edge meters), `routeState.geometry`, and the geometry's haversine `distanceFromStartMeters` from `buildNavigationGeometry`.
- Produces: `NavigationRoute.segmentSpans` rescaled into the geometry's haversine frame: each span's `startMeters`/`endMeters` are scaled by `geometryTotal / spansTotal` (proportional remap) so the last span ends exactly at the geometry total. Empty/short routes → `[]`.
- Native memo boundary (no code change needed): `MapScreen.jsx` builds `navigationRoute` via `useMemo(..., [routeState.geometry, shareInfo.param, selectedCatalogSlug])`. `segmentSpans` is written in the same `route/update` as `geometry`, so the memo re-runs and picks up spans whenever geometry changes — the existing deps already cover it.

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-route.mjs`)

```js
// --- segmentSpans reconciled to the geometry distance frame ---
{
  const route = navigationRouteFromRouteState(
    {
      points: [{ id: "a", lat: 33.1, lng: 35.6 }, { id: "b", lat: 33.1, lng: 35.61 }],
      selectedSegments: ["X"],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.61 },
      ],
      // graph-edge spans total 1000, geometry haversine total ~931.5
      segmentSpans: [
        { startMeters: 0, endMeters: 600, name: "X", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
        { startMeters: 600, endMeters: 1000, name: null, cwSegmentId: null, onNetwork: false, routeClass: "residential" },
      ],
      distance: 931.5,
    },
    { param: "spans" },
  );
  const geomTotal = route.geometry[route.geometry.length - 1].distanceFromStartMeters;
  assert.equal(route.segmentSpans.length, 2);
  assert.equal(route.segmentSpans[0].startMeters, 0);
  // last span ends exactly at the geometry total (reconciled frame)
  assert.ok(Math.abs(route.segmentSpans[1].endMeters - geomTotal) < 1e-6,
    "spans rescaled to the geometry frame");
  assert.equal(route.segmentSpans[0].name, "X", "metadata preserved");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-route.mjs`
Expected: FAIL — `route.segmentSpans` undefined.

- [ ] **Step 3: Write the implementation**

In `navigationRoute.js`, add a reconciler and include it in the returned object:

```js
function reconcileSegmentSpans(rawSpans, geometryTotalMeters) {
  const spans = Array.isArray(rawSpans) ? rawSpans : [];
  if (spans.length === 0 || geometryTotalMeters <= 0) return [];
  const spansTotal = spans[spans.length - 1].endMeters;
  const scale = spansTotal > 0 ? geometryTotalMeters / spansTotal : 1;
  return spans.map((s, i) => ({
    ...s,
    startMeters: s.startMeters * scale,
    endMeters:
      i === spans.length - 1 ? geometryTotalMeters : s.endMeters * scale,
  }));
}
```

In `createNavigationRoute`, after `computedDistance`/`geometry` are known, add to the return object:

```js
segmentSpans: reconcileSegmentSpans(routeState?.segmentSpans, computedDistance),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-route.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationRoute.js tests/test-navigation-route.mjs
git commit -m "feat(nav): carry segmentSpans onto NavigationRoute, reconciled to geometry frame

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — Ride context + maneuver-quality cues

### Task 9: Segment-context fields in the tracker

**Files:**
- Modify: `packages/core/src/navigation/routeProgress.js`
- Modify/Test: `tests/test-route-progress.mjs`

**Interfaces:**
- Consumes: `navigationRoute.segmentSpans` (reconciled, Task 8); current `progressMeters`.
- Produces: acquired `update(fix)` return gains `currentSpanIndex:number|null`, `currentSegmentName:string|null`, `currentOnNetwork:boolean`, `currentRouteClass:string|null`, `nextSegmentName:string|null`, `distanceToNextSegmentMeters:number|null` (distance from `progressMeters` to the next span whose `name != null`). All null/false while approaching.

- [ ] **Step 1: Write the failing test** (append to `tests/test-route-progress.mjs`; build a route with spans like Task 8 over `straightRoute()` geometry)

```js
// --- segment context ---
{
  const base = straightRoute();
  const route = { ...base, segmentSpans: [
    { startMeters: 0, endMeters: 465, name: "First", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
    { startMeters: 465, endMeters: base.geometry[base.geometry.length-1].distanceFromStartMeters, name: "Second", cwSegmentId: 2, onNetwork: true, routeClass: "cycleway" },
  ]};
  const tracker = createRouteProgressTracker(route);
  tracker.update({ lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 1000 }); // acquire at start
  const p = tracker.update({ lat: 33.1, lng: 35.602, accuracy: 5, speed: 4, timestamp: 4000 });
  assert.equal(p.currentSegmentName, "First", "reports current segment");
  assert.equal(p.currentOnNetwork, true);
  assert.equal(p.nextSegmentName, "Second", "reports next named segment");
  assert.ok(p.distanceToNextSegmentMeters > 0, "distance to next segment");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-route-progress.mjs`
Expected: FAIL — `currentSegmentName` undefined.

- [ ] **Step 3: Write the implementation**

In `routeProgress.js`, read `const segmentSpans = Array.isArray(navigationRoute?.segmentSpans) ? navigationRoute.segmentSpans : [];` at tracker construction. Add a helper:

```js
function segmentContext(progressMeters) {
  if (segmentSpans.length === 0) {
    return {
      currentSpanIndex: null, currentSegmentName: null, currentOnNetwork: false,
      currentRouteClass: null, nextSegmentName: null, distanceToNextSegmentMeters: null,
    };
  }
  let idx = segmentSpans.findIndex(
    (s) => progressMeters >= s.startMeters && progressMeters < s.endMeters,
  );
  if (idx < 0) idx = segmentSpans.length - 1;
  const cur = segmentSpans[idx];
  let nextName = null;
  let nextStart = null;
  for (let i = idx + 1; i < segmentSpans.length; i++) {
    if (segmentSpans[i].name) { nextName = segmentSpans[i].name; nextStart = segmentSpans[i].startMeters; break; }
  }
  return {
    currentSpanIndex: idx,
    currentSegmentName: cur.name,
    currentOnNetwork: cur.onNetwork,
    currentRouteClass: cur.routeClass,
    nextSegmentName: nextName,
    distanceToNextSegmentMeters: nextStart === null ? null : Math.max(0, nextStart - progressMeters),
  };
}
```

Spread `...segmentContext(progressMeters)` into the acquired return object; in the approaching return add the empty-context fields (all null/false).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-route-progress.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/routeProgress.js tests/test-route-progress.mjs
git commit -m "feat(nav): current/next segment context from segmentSpans in the tracker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: `enter-segment` cues + priority/merge/suppression

**Files:**
- Modify: `packages/core/src/navigation/navigationCues.js`
- Modify/Test: `tests/test-navigation-cues.mjs`

**Interfaces:**
- Consumes: `navigationRoute.segmentSpans`.
- Produces: `buildRouteCues` additionally emits `{ type: "enter-segment", distanceMeters, segmentName }` at each named span boundary (start, except the route start at 0). Merge rule: if a `turn` cue falls within `MIN_TURN_SPACING_M` of an `enter-segment` boundary, the turn cue gains `ontoSegmentName` and the standalone `enter-segment` cue is dropped. Priority: when two cues share a distance, order is `turn`/`arrive` before `enter-segment`. `selectActiveCue` unchanged.

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-cues.mjs`)

```js
// --- enter-segment cues + merge ---
import { buildRouteCues as _brc } from "@cycleways/core/navigation/navigationCues.js";
{
  // Route whose sharp turn coincides with a new segment boundary.
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 500 },
      { lat: 33.11, lng: 35.61, distanceFromStartMeters: 1000 }, // ~90° turn at 500m
    ],
    segmentSpans: [
      { startMeters: 0, endMeters: 500, name: "First", onNetwork: true, cwSegmentId: 1, routeClass: "cycleway" },
      { startMeters: 500, endMeters: 1000, name: "Second", onNetwork: true, cwSegmentId: 2, routeClass: "cycleway" },
    ],
    activeDataPoints: [],
  };
  const cues = _brc(route);
  const turn = cues.find((c) => c.type === "turn");
  assert.ok(turn, "turn cue exists at the bend");
  assert.equal(turn.ontoSegmentName, "Second", "turn merged with segment entry");
  assert.equal(
    cues.filter((c) => c.type === "enter-segment" && Math.abs(c.distanceMeters - 500) < 20).length,
    0,
    "standalone enter-segment near the turn is suppressed",
  );
}
{
  // Segment boundary with no nearby turn -> standalone enter-segment cue.
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.62, distanceFromStartMeters: 1000 },
    ],
    segmentSpans: [
      { startMeters: 0, endMeters: 400, name: "A", onNetwork: true, cwSegmentId: 1, routeClass: "cycleway" },
      { startMeters: 400, endMeters: 1000, name: "B", onNetwork: true, cwSegmentId: 2, routeClass: "cycleway" },
    ],
    activeDataPoints: [],
  };
  const cues = _brc(route);
  assert.ok(cues.some((c) => c.type === "enter-segment" && c.segmentName === "B"),
    "standalone enter-segment cue for B");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-cues.mjs`
Expected: FAIL — no `enter-segment` cues / no `ontoSegmentName`.

- [ ] **Step 3: Write the implementation**

In `navigationCues.js`, after building the turn + hazard cues and before the final sort, build enter-segment candidates and apply merge/suppression:

```js
const spans = Array.isArray(navigationRoute?.segmentSpans)
  ? navigationRoute.segmentSpans
  : [];
const turnCues = cues.filter((c) => c.type === "turn");
for (const span of spans) {
  if (!span.name || span.startMeters <= 0) continue;
  const near = turnCues.find(
    (t) => Math.abs(t.distanceMeters - span.startMeters) <= MIN_TURN_SPACING_M,
  );
  if (near) {
    near.ontoSegmentName = span.name; // merge into the turn
    continue;
  }
  cues.push({ type: "enter-segment", distanceMeters: span.startMeters, segmentName: span.name });
}
```

Update the final sort to add a priority tiebreak:

```js
const PRIORITY = { start: 0, turn: 1, arrive: 1, "enter-segment": 2 };
cues.sort((a, b) =>
  a.distanceMeters - b.distanceMeters ||
  (PRIORITY[a.type] ?? 3) - (PRIORITY[b.type] ?? 3),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-cues.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationCues.js tests/test-navigation-cues.mjs
git commit -m "feat(nav): enter-segment cues with turn-merge, suppression, and priority

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Gate haptics by cue type

**Files:**
- Modify: `packages/core/src/navigation/cueHaptics.js`
- Modify/Test: `tests/test-cue-haptics.mjs`

**Interfaces:**
- Consumes: `cueEvent.kind` (`"off-route"` | `"cue"`) and `cueEvent.cueType` (cue's `type`).
- Produces: `plan()` returns `{ kind: null }` for `cueEvent.cueType === "enter-segment"` (visual-only); turns/arrive/merged-turn still fire (medium/light), off-route fires heavy. Cooldown behavior unchanged.

- [ ] **Step 1: Write the failing test** (append to `tests/test-cue-haptics.mjs`)

```js
// --- enter-segment cues do not vibrate ---
{
  const planner = createCueHapticPlanner();
  const out = planner.plan({ kind: "cue", cueType: "enter-segment", phase: "preview" }, 1000);
  assert.equal(out.kind, null, "plain segment entry is visual-only");
  const turn = planner.plan({ kind: "cue", cueType: "turn", phase: "final" }, 5000);
  assert.equal(turn.kind, "medium", "turns still vibrate");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-cue-haptics.mjs`
Expected: FAIL — enter-segment returns `light`, not `null`.

- [ ] **Step 3: Write the implementation**

In `cueHaptics.js` `intensity()`:

```js
function intensity(cueEvent) {
  if (cueEvent.kind === "off-route") return "heavy";
  if (cueEvent.kind === "cue") {
    if (cueEvent.cueType === "enter-segment") return null; // visual-only
    return cueEvent.phase === "final" ? "medium" : "light";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-cue-haptics.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/cueHaptics.js tests/test-cue-haptics.mjs
git commit -m "feat(nav): gate haptics by cue type (no buzz on plain segment entry)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Presentation — context line, guidance, wrong-way

**Files:**
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify/Test: `tests/test-navigation-presentation.mjs`

**Interfaces:**
- Consumes: session `state` with `status` (`approaching`/`navigating`/`off-route`/…), `progress` (segment-context + guidance + `wrongWay` fields), `activeCue` (cue may carry `ontoSegmentName`/`segmentName`).
- Produces: `getNavigationPresentation(state)` return gains: `showContext:boolean`, `contextText:string`, `showGuidance:boolean`, `guidanceText:string`, `guidanceArrowDeg:number|null`, `wrongWay:boolean`, `wrongWayText:string`. Turn cue text uses `ontoSegmentName` when present ("פנה ימינה אל <name>"). `cueDisplay` handles `enter-segment` ("כניסה אל <name>").

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-presentation.mjs`)

```js
// --- context line ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: {
      remainingMeters: 1000, hasAcquiredRoute: true,
      currentSegmentName: "שביל הירקון", currentOnNetwork: true, currentRouteClass: "cycleway",
      nextSegmentName: "גשר איילון", distanceToNextSegmentMeters: 400,
      wrongWay: false,
    },
  });
  assert.equal(p.showContext, true);
  assert.match(p.contextText, /שביל הירקון/);
  assert.match(p.contextText, /גשר איילון/);
}
// --- off-network context uses neutral copy, not "local roads" ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: { hasAcquiredRoute: true, currentSegmentName: null, currentOnNetwork: false, currentRouteClass: "track", nextSegmentName: "גשר איילון", distanceToNextSegmentMeters: 1200, wrongWay: false },
  });
  assert.equal(p.currentOnNetwork ?? false, false);
  assert.ok(p.contextText.length > 0, "off-network still shows context");
  assert.doesNotMatch(p.contextText, /local roads/);
}
// --- approach guidance ---
{
  const p = getNavigationPresentation({
    status: "approaching",
    progress: { hasAcquiredRoute: false, guidanceDistanceMeters: 420, guidanceBearingDeg: 90, courseDeg: 0, wrongWay: false },
  });
  assert.equal(p.showGuidance, true);
  assert.equal(p.guidanceArrowDeg, 90, "arrow relative to course");
  assert.match(p.guidanceText, /420|0\.4/);
}
// --- wrong-way ---
{
  const p = getNavigationPresentation({
    status: "navigating",
    progress: { hasAcquiredRoute: true, wrongWay: true, remainingMeters: 500 },
  });
  assert.equal(p.wrongWay, true);
  assert.ok(p.wrongWayText.length > 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-presentation.mjs`
Expected: FAIL — `showContext`/`guidanceArrowDeg`/`wrongWay` undefined.

- [ ] **Step 3: Write the implementation**

In `navigationPresentation.js`:

```js
// cueDisplay: add enter-segment + onto-segment.
case "turn": {
  const base = cue.direction === "right"
    ? { text: "פנה ימינה", icon: "arrow-forward-outline" }
    : { text: "פנה שמאלה", icon: "arrow-back-outline" };
  return cue.ontoSegmentName ? { ...base, text: `${base.text} אל ${cue.ontoSegmentName}` } : base;
}
case "enter-segment":
  return { text: cue.segmentName ? `כניסה אל ${cue.segmentName}` : "המשך במסלול", icon: "navigate-outline" };
```

Add a context helper and guidance/wrong-way to the return:

```js
function buildContextText(progress) {
  if (!progress?.hasAcquiredRoute) return "";
  const here = progress.currentOnNetwork && progress.currentSegmentName
    ? progress.currentSegmentName
    : routeClassLabel(progress.currentRouteClass); // e.g. "במקטע מקשר"
  const next = progress.nextSegmentName
    ? ` · הבא: ${progress.nextSegmentName} בעוד ${formatDistanceMeters(progress.distanceToNextSegmentMeters)}`
    : "";
  return here ? `${here}${next}` : "";
}

function routeClassLabel(routeClass) {
  switch (routeClass) {
    case "track": return "בדרך עפר";
    case "path": return "בשביל";
    case "footway": return "במדרכה";
    default: return "במקטע מקשר"; // neutral "connector section"
  }
}

function relativeArrowDeg(progress) {
  if (!Number.isFinite(progress?.guidanceBearingDeg)) return null;
  const course = Number.isFinite(progress?.courseDeg) ? progress.courseDeg : 0;
  return ((progress.guidanceBearingDeg - course) % 360 + 360) % 360;
}
```

In the returned object add:

```js
const navigatingNow = navigating; // existing
showContext: navigatingNow && !offRoute && Boolean(state.progress?.hasAcquiredRoute),
contextText: buildContextText(state.progress),
showGuidance: status === "approaching" || offRoute,
guidanceText: Number.isFinite(state.progress?.guidanceDistanceMeters)
  ? `${status === "approaching" ? "לכיוון תחילת המסלול" : "חזרה למסלול"} · ${formatDistanceMeters(state.progress.guidanceDistanceMeters)}`
  : "",
guidanceArrowDeg: relativeArrowDeg(state.progress),
wrongWay: state.progress?.wrongWay === true,
wrongWayText: "אתה נוסע בכיוון הלא נכון — סובב",
currentOnNetwork: state.progress?.currentOnNetwork ?? false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-presentation.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationPresentation.js tests/test-navigation-presentation.mjs
git commit -m "feat(nav): presentation context line, approach/off-route guidance, wrong-way

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — Smoothing math

### Task 13: `pointAndBearingAtDistance` (extract animator interpolation)

**Files:**
- Modify: `packages/core/src/utils/geometry.js`
- Modify: `packages/core/src/domain/routeDirectionAnimator.js` (consume the helper)
- Create/Test: `tests/test-navigation-smoothing.mjs`
- Modify: `package.json` (append test)

**Interfaces:**
- Consumes: `precomputeArcLength(geometry) -> { cumDist, totalDistMeters }`, `computeBearing`.
- Produces: `pointAndBearingAtDistance(arc, geometry, meters) -> { point: { lat, lng }, bearingDeg }`. Clamps `meters` to `[0, totalDistMeters]`; binary-searches `arc.cumDist`; linearly interpolates the point on the bracketing segment; `bearingDeg` is that segment's bearing. The animator's private interpolation is replaced by a call to this.

- [ ] **Step 1: Write the failing test** `tests/test-navigation-smoothing.mjs`

```js
import assert from "node:assert/strict";
import { precomputeArcLength, pointAndBearingAtDistance } from "@cycleways/core/utils/geometry.js";

const geometry = [
  { lat: 33.1, lng: 35.6 },
  { lat: 33.1, lng: 35.61 }, // due east
];
const arc = precomputeArcLength(geometry);
{
  const mid = pointAndBearingAtDistance(arc, geometry, arc.totalDistMeters / 2);
  assert.ok(Math.abs(mid.point.lat - 33.1) < 1e-9, "stays on latitude");
  assert.ok(Math.abs(mid.point.lng - 35.605) < 1e-4, "midpoint lng");
  assert.ok(Math.abs(mid.bearingDeg - 90) < 1, "due-east bearing ~90");
}
{
  const clampLo = pointAndBearingAtDistance(arc, geometry, -50);
  assert.deepEqual(clampLo.point, { lat: 33.1, lng: 35.6 }, "clamp below 0");
  const clampHi = pointAndBearingAtDistance(arc, geometry, 1e9);
  assert.ok(Math.abs(clampHi.point.lng - 35.61) < 1e-9, "clamp above total");
}
console.log("test-navigation-smoothing OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-smoothing.mjs`
Expected: FAIL — `pointAndBearingAtDistance` is not exported.

- [ ] **Step 3: Write the implementation**

In `geometry.js`:

```js
export function pointAndBearingAtDistance(arc, geometry, meters) {
  const total = arc.totalDistMeters;
  const target = Math.max(0, Math.min(meters, total));
  const cum = arc.cumDist;
  // binary search: largest i with cum[i] <= target
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const i = Math.min(lo, geometry.length - 2);
  const a = geometry[i];
  const b = geometry[i + 1];
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (target - cum[i]) / segLen : 0;
  return {
    point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) },
    bearingDeg: computeBearing(a, b),
  };
}
```

Then in `routeDirectionAnimator.js`, replace its private `findSegmentIndex`/`localFrac` interpolation with a call to `pointAndBearingAtDistance(arc, geometry, target)` (re-export it alongside the existing `computeBearing`/`precomputeArcLength`). Keep the animator's external behavior identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-smoothing.mjs && node tests/test-route-direction-animator.mjs`
Expected: both `... OK` (animator behavior preserved).

Append ` && node tests/test-navigation-smoothing.mjs` to `package.json`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/geometry.js packages/core/src/domain/routeDirectionAnimator.js tests/test-navigation-smoothing.mjs package.json
git commit -m "refactor(geo): extract pointAndBearingAtDistance; animator + nav puck share it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Progress-tween + angle-lerp smoothing policy

**Files:**
- Create: `packages/core/src/navigation/navigationSmoothing.js`
- Modify/Test: `tests/test-navigation-smoothing.mjs`

**Interfaces:**
- Produces:
  - `shortestAngleLerp(fromDeg, toDeg, t) -> number` — interpolates across the 0/360 wrap.
  - `nextSmoothedMeters({ current, target, dtMs, speedMps = 0, maxCatchupMs = 1500, snapThresholdM = 60, regressionToleranceM = 3 }) -> number` — eases `current` toward `target`: ignores tiny backward moves (`target < current` within `regressionToleranceM` returns `current`); snaps when `|target-current| > snapThresholdM`; otherwise advances at most `target-current` capped by an eased step over `min(dtMs, maxCatchupMs)`.

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-smoothing.mjs`)

```js
import { shortestAngleLerp, nextSmoothedMeters } from "@cycleways/core/navigation/navigationSmoothing.js";
{
  assert.ok(Math.abs(shortestAngleLerp(350, 10, 0.5) - 0) < 1e-6, "wraps 350->10 through 360");
  assert.ok(Math.abs(shortestAngleLerp(10, 20, 0.5) - 15) < 1e-6, "plain midpoint");
}
{
  // jitter regression suppressed
  assert.equal(nextSmoothedMeters({ current: 100, target: 98, dtMs: 1000 }), 100, "small backward ignored");
  // large jump snaps
  assert.equal(nextSmoothedMeters({ current: 100, target: 400, dtMs: 1000, snapThresholdM: 60 }), 400, "big jump snaps");
  // normal advance moves toward target but not past it
  const v = nextSmoothedMeters({ current: 100, target: 130, dtMs: 1000 });
  assert.ok(v > 100 && v <= 130, "advances toward target");
}
console.log("test-navigation-smoothing policy OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-smoothing.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/navigation/navigationSmoothing.js
// Pure smoothing policy for the nav rider puck/camera. The RAF/clock glue lives
// natively; these are the testable decisions.

export function shortestAngleLerp(fromDeg, toDeg, t) {
  const diff = (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  return (((fromDeg + diff * t) % 360) + 360) % 360;
}

export function nextSmoothedMeters({
  current,
  target,
  dtMs,
  maxCatchupMs = 1500,
  snapThresholdM = 60,
  regressionToleranceM = 3,
}) {
  const delta = target - current;
  if (delta < 0 && Math.abs(delta) <= regressionToleranceM) return current; // jitter
  if (Math.abs(delta) > snapThresholdM) return target; // implausible jump / re-acquire
  const frac = Math.max(0, Math.min(1, dtMs / maxCatchupMs));
  return current + delta * frac;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-smoothing.mjs`
Expected: both `... OK` lines.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSmoothing.js tests/test-navigation-smoothing.mjs
git commit -m "feat(nav): pure smoothing policy (angle lerp + progress tween)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 6 — Native rendering (manual simulator verification)

> Native glue is not covered by the node suite (per the parent plan). Each task's "test" is a concrete simulator check. Build the app with `cd apps/mobile && npx expo run:ios` after wiring the simulate-ride source (Task 17) so these are observable; if doing Phase 6 before Task 17, use a real device GPS or the Xcode simulator Location → Freeway Drive.

### Task 15: Single adaptive smoothed rider puck; hide raw puck; smoothed camera

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `nav.state.progress` (`hasAcquiredRoute`, `offRoute`, `progressMeters`, `snappedPoint`, `bearingToNextDeg`, raw fix lat/lng via `handleUserLocationUpdate`), `pointAndBearingAtDistance`, `precomputeArcLength`, `nextSmoothedMeters`, `shortestAngleLerp`.
- Produces: while navigating, the RNMapbox `UserLocation` puck is hidden; one custom puck renders at a smoothed position (snapped-along-route when `hasAcquiredRoute && !offRoute`, else smoothed raw GPS); the `Camera` is driven via `setCamera` from the same smoothed position instead of `followUserLocation`.

- [ ] **Step 1: Hide the raw puck while navigating**

In the `UserLocation` render condition (`MapScreen.jsx:890`), exclude navigation:

```jsx
{locationState.enabled && !isNavigating ? (
  <UserLocation visible onUpdate={handleUserLocationUpdate} renderMode={UserLocationRenderMode.Native} showsUserHeadingIndicator />
) : null}
```

- [ ] **Step 2: Add a smoothed-puck driver**

Precompute the arc once per route (`useMemo` over `routeGeometry`): `const arc = useMemo(() => precomputeArcLength(navGeometry), [navGeometry]);`. Add a RAF loop (a `useEffect` with `requestAnimationFrame`) that, while `isNavigating`, tweens a `smoothedMetersRef` toward `nav.state.progress.progressMeters` via `nextSmoothedMeters` and tweens a `smoothedBearingRef` via `shortestAngleLerp`, then:
- on-route: `const { point, bearingDeg } = pointAndBearingAtDistance(arc, navGeometry, smoothedMetersRef.current);`
- off-route/approaching: use the latest raw fix position; bearing from `progress.courseDeg ?? bearingDeg`.
Set the custom puck's coordinate + rotation from these, and call `cameraRef.current.setCamera({ centerCoordinate: [lng, lat], heading: bearing, animationDuration: 0 })` when `cameraIntent === "follow"`.

- [ ] **Step 3: Render the custom directional puck**

Add a `MarkerView`/`ShapeSource`+`SymbolLayer` puck (reuse the existing snapped-marker rendering; replace it) with a heading-rotated arrow icon, colored normally on-route and muted/gray off-route.

- [ ] **Step 4: Stop driving the camera from `followUserLocation`**

Set `followUserLocation={false}` while `isNavigating` (keep the planning-mode behavior). The nav camera is now driven by `setCamera` in Step 2.

- [ ] **Step 5: Simulator verification**

Run: `cd apps/mobile && npx expo run:ios` (or reload if running). Start navigation on a route; with a moving GPS source confirm: exactly ONE puck; it glides smoothly (no per-fix teleport); it points along travel; the map pans smoothly with it; panning away then "מרכוז" recenters. Note the result in the commit body.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): single adaptive smoothed rider puck + smoothed nav camera

Hide raw UserLocation puck while navigating; render one directional puck
from a smoothed along-route position; drive the camera via setCamera.
Verified in the iOS simulator: one puck, smooth glide + camera, recenter.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: NavPanel context line, guidance arrow, wrong-way

**Files:**
- Modify: `apps/mobile/src/planner/NavPanel.jsx`

**Interfaces:**
- Consumes: `getNavigationPresentation` fields from Task 12 (`showContext`, `contextText`, `showGuidance`, `guidanceText`, `guidanceArrowDeg`, `wrongWay`, `wrongWayText`).
- Produces: a persistent context line below the maneuver banner; a guidance row with a rotated arrow (`transform: [{ rotate: \`${guidanceArrowDeg}deg\` }]`) + text shown when `showGuidance`; a wrong-way banner when `wrongWay`.

- [ ] **Step 1: Render the context line**

Below the existing `remaining` text in the banner:

```jsx
{p.showContext && p.contextText ? (
  <Text style={styles.context} numberOfLines={1}>{p.contextText}</Text>
) : null}
```

Add a `context` style (muted, smaller, rtl).

- [ ] **Step 2: Render the guidance arrow row**

Replace the bare off-route block with a guidance block when `p.showGuidance`:

```jsx
{p.showGuidance ? (
  <View style={[styles.cueRow, styles.offRow]}>
    <Icon name="navigate" color={palette.white} size={26}
      style={{ transform: [{ rotate: `${p.guidanceArrowDeg ?? 0}deg` }] }} />
    <Text style={[styles.cueText, styles.offText]} numberOfLines={2}>{p.guidanceText}</Text>
  </View>
) : p.showCue ? ( /* existing cue block */ ) : ( /* existing status block */ )}
```

- [ ] **Step 3: Render the wrong-way banner**

Above the banner content, when `p.wrongWay`, show a distinct warning strip with `p.wrongWayText`.

- [ ] **Step 4: Simulator verification**

Reload the app. Confirm: while approaching, the arrow points toward the start and updates as you turn; the context line names the current/next segment while riding; riding the route backward shows the wrong-way strip; drifting off shows the guidance arrow + distance. Note results in the commit.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/planner/NavPanel.jsx
git commit -m "feat(mobile): NavPanel context line, guidance arrow, wrong-way banner

Verified in the iOS simulator: approach arrow, segment context, wrong-way.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 7 — In-app simulate-ride (harness B)

### Task 17: Injectable `locationSource` + simulate-ride dev source + recorder

**Files:**
- Modify: `apps/mobile/src/navigation/locationService.js` (export the default real source)
- Modify: `apps/mobile/src/navigation/useNavigationSession.js` (accept `locationSource`)
- Create: `apps/mobile/src/navigation/simulateRideSource.js` (dev-only)
- Modify: `apps/mobile/src/MapScreen.jsx` (dev-flag toggle + recorder)

**Interfaces:**
- Produces: `useNavigationSession(navigationRoute, { locationSource })` where `locationSource` is `{ requestPermissions(opts) -> { granted, background }, startWatch({ onFix, onError }) -> { stop() } }`. Default source wraps the existing `requestNavigationPermissions` + `startNavigationWatch`. `createSimulateRideSource(fixes, { intervalMs })` replays `fixes` through `onFix` on a timer (always grants permission). A dev recorder collects `onFix` fixes into an exportable array (`console.log`/share JSON) for turning real rides into `tests/fixtures/*.json`.

- [ ] **Step 1: Refactor the real source behind the interface**

In `locationService.js` add:

```js
export function createDefaultLocationSource() {
  return {
    requestPermissions: (opts) => requestNavigationPermissions(opts),
    startWatch: (handlers) => startNavigationWatch(handlers),
  };
}
```

In `useNavigationSession.js`, accept `locationSource` from options (default `createDefaultLocationSource()`), and route `requestNavigationPermissions`/`startNavigationWatch` calls through it. (`startWatch` returns a promise-or-handle; keep the existing race-guard.)

- [ ] **Step 2: Add the simulate-ride source**

```js
// apps/mobile/src/navigation/simulateRideSource.js  (dev-only)
export function createSimulateRideSource(fixes, { intervalMs = 1000 } = {}) {
  return {
    requestPermissions: async () => ({ granted: true, background: false }),
    startWatch: async ({ onFix }) => {
      let i = 0;
      const id = setInterval(() => {
        if (i >= fixes.length) { clearInterval(id); return; }
        onFix(fixes[i++]);
      }, intervalMs);
      return { stop: () => clearInterval(id) };
    },
  };
}
```

- [ ] **Step 3: Wire a dev-flag toggle + recorder in `MapScreen`**

Behind `if (__DEV__)`, add a hidden control that (a) starts navigation with `locationSource = createSimulateRideSource(generateTrack(navigationRoute, { approachFrom, jitterM: 8 }))`, and (b) a recorder that pushes each real `onFix` into a ref and logs JSON on stop. Ensure none of this renders when `!__DEV__`.

- [ ] **Step 4: Simulator verification**

Run: `cd apps/mobile && npx expo run:ios`. Trigger the dev simulate-ride on a built route and a catalog route. Confirm the full pipeline visually: approach arrow → acquisition → smooth puck + camera → context line + cues → induced off-route arrow → wrong-way (use a reversed generated track) → stop returns to the planner with the route intact. Confirm the recorder logs a replayable fix array.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/navigation/locationService.js apps/mobile/src/navigation/useNavigationSession.js apps/mobile/src/navigation/simulateRideSource.js apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): injectable locationSource + dev simulate-ride source & recorder

Verified in the iOS simulator: full approach→acquire→ride→off-route→stop
pipeline via a generated track; recorder exports a replayable fix array.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 18: Capture a real-ride fixture from the recorder; lock its milestones

**Files:**
- Replace: `tests/fixtures/nav-ride-realistic.json` (with a real captured ride, or add `tests/fixtures/nav-ride-real-1.json`)
- Modify/Test: `tests/test-navigation-replay.mjs`

**Interfaces:**
- Consumes: a fix array exported by the Task 17 recorder from an actual ride (or a Freeway-Drive simulator run if no device ride is possible — note which in the fixture).
- Produces: a milestone test over the real ride asserting acquisition index, monotonic progress (within `regressionToleranceM`), at least one segment-context transition, and completion.

- [ ] **Step 1: Capture** a ride via the dev recorder; save the exported JSON (route + fixes) to `tests/fixtures/nav-ride-real-1.json`. Anonymize/trim to the ride only.

- [ ] **Step 2: Write the milestone test** (append to `tests/test-navigation-replay.mjs`)

```js
{
  const path = fileURLToPath(new URL("./fixtures/nav-ride-real-1.json", import.meta.url));
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const route = navigationRouteFromRouteState(fx.route, { param: "real-1" });
  const { timeline, last } = replaySession(route, fx.fixes);
  // monotonic progress (allowing small jitter regressions) once acquired
  let prev = 0;
  for (const s of timeline) {
    if (!s.progress.hasAcquiredRoute) continue;
    assert.ok(s.progress.progressMeters >= prev - 3, "progress is ~monotonic");
    prev = Math.max(prev, s.progress.progressMeters);
  }
  assert.ok(
    timeline.some((s) => s.progress.currentSegmentName),
    "at least one named-segment context appears",
  );
  assert.ok(last.progress.fraction > 0.9, "ride completes");
}
```

- [ ] **Step 3: Run the test**

Run: `node tests/test-navigation-replay.mjs`
Expected: `... OK`. If it fails, the real ride exposed a bug — fix the relevant pure module (debug via the timeline) before locking the milestone.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/nav-ride-real-1.json tests/test-navigation-replay.mjs
git commit -m "test(nav): real-ride fixture milestones over the replay harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: the whole `&&` chain passes (all new test files included).

- [ ] **iOS export sanity**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/isravelo-nav-export`
Expected: bundles cleanly (no missing-import/syntax errors in the native changes).

- [ ] **Update plan status**

Edit `plans/turn-by-turn-improvements/design.md` and `plans/rn-turn-by-turn-navigation/implementation-plan.md` notes to record this slice as landed and that routed rejoin (Phase B) + junction-vs-bend classification remain separate follow-ups. Commit.

---

## Deferred (separate designs — NOT in this plan)

- **Issue 3 Phase B — routed rejoin** (non-mutating router/session, stale-recompute cancellation + generation IDs, target scoring, handoff). Design after this slice is ride-tested.
- **Graph-junction-vs-bend maneuver classification** (needs edge/node identity threaded through the snapshot pipeline; `segmentSpans` already retains `cwSegmentId`/`routeClass` to enable it).
- **Voice/TTS cues**, **background/lock-screen location**, **Android** — unchanged from the parent plan.
