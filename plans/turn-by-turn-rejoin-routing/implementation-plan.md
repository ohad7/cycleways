# Turn-by-Turn Rejoin Routing (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iPhone rider routed, turn-by-turn guidance from their position to the route — a "connector" route (to the start when approaching, the nearest point ahead when rejoining mid-ride) with throttled auto-recompute, a clean handoff back to the main route, and a guaranteed fallback to the existing Phase A arrow when routing isn't possible.

**Architecture:** All decision logic is pure code in `@cycleways/core` (node-tested): a `connectorTargeting` module picks the target, and `navigationSession.js` gains a connector phase (statuses `routing`/`on-connector`, a transient `routeRequest` output, `CONNECTOR_READY`/`CONNECTOR_FAILED` actions, a connector progress tracker + cues, and handoff). The single shard-I/O piece, `computeConnectorRoute`, computes a path on the route-manager **without committing it as the active route**. The native hook reacts to `routeRequest`, calls `computeConnectorRoute`, and owns recompute debounce + generation-id cancellation.

**Tech Stack:** Node ESM, `node:assert/strict` tests, `@cycleways/core` workspace, React Native + `@rnmapbox/maps`, the on-device `ShardedRouteSession` routing graph.

## Global Constraints

- **Test runner:** new pure tests are standalone `node tests/test-<name>.mjs` files using `import assert from "node:assert/strict";`, importing core via `@cycleways/core/...`. New test files MUST be appended to the `"test"` script `&&` chain in `package.json` (end, before the final `&& cd tests && node test-route-manager.js`). Run one with `node tests/test-<name>.mjs` (exit 0 = pass).
- **Non-mutating:** `computeConnectorRoute` and all connector logic must NEVER mutate the planner's loaded route / active `routeState` / the main route-manager's active route. The connector is a separate computed path.
- **NavigationRoute is immutable** input to the session.
- **Fallback always exists:** whenever a connector is unavailable (failure, off-graph, missing shard, detour rejected, or compute in flight), the session must expose the Phase A guidance fields (`guidanceBearingDeg`, `guidanceDistanceMeters`) so the UI never shows a blank guidance state.
- **Distance frame:** all along-route distances are the geometry haversine frame (`geometry[i].distanceFromStartMeters`), matching Phase A.
- **Copy:** rider-facing strings are Hebrew/RTL.
- **Foreground-only**; dev-only code `__DEV__`-gated.
- **Tuning constants** (`APPROACH_NEAREST_MARGIN_M`, `DETOUR_RATIO`, `DETOUR_ABS_CAP_M`, `RECOMPUTE_MIN_MS`, `RECOMPUTE_MIN_MOVE_M`, `HANDOFF_RADIUS_M`) live as named exported constants with the default values in this plan; they are tuned later in the simulate-ride harness.

---

## File Structure

New core files:
- `packages/core/src/navigation/connectorTargeting.js` — pure target selection + detour-budget helpers + tuning constants.
- `packages/core/src/routing/computeConnectorRoute.js` — the non-mutating async path compute (only shard-I/O piece).

Modified core files:
- `packages/core/src/navigation/navigationSession.js` — connector phase (statuses, actions, `routeRequest`, connector tracker/cues, handoff, fallback, generation ids).
- `packages/core/src/navigation/replayRunner.js` — optional injected connector-router stub to pump `routeRequest` → `CONNECTOR_READY`/`CONNECTOR_FAILED` for end-to-end node tests.
- `packages/core/src/navigation/navigationPresentation.js` — connector cue context line + "computing route" status text.

Modified native files:
- `apps/mobile/src/navigation/useNavigationSession.js` — react to `routeRequest`, call `computeConnectorRoute`, dispatch results; recompute debounce + generation-id bookkeeping; injectable router (default real, stub in tests/dev).
- `apps/mobile/src/MapScreen.jsx` — dashed connector line; `on-connector` camera = tight follow; connector geometry passed to the puck/camera path as the active geometry.

New/extended tests:
- `tests/test-connector-targeting.mjs` (new); extend `tests/test-navigation-session.mjs`, `tests/test-navigation-replay.mjs`, `tests/test-navigation-presentation.mjs`; `tests/test-compute-connector-route.mjs` (new).

---

## Phase 1 — Target selection (pure)

### Task 1: connectorTargeting module

**Files:**
- Create: `packages/core/src/navigation/connectorTargeting.js`
- Create/Test: `tests/test-connector-targeting.mjs`
- Modify: `package.json` (append test)

**Interfaces:**
- Consumes: `getDistance` from `@cycleways/core/utils/distance.js`; `navigationRoute.geometry` (vertices `{lat,lng,distanceFromStartMeters}`).
- Produces:
  - `APPROACH_NEAREST_MARGIN_M = 300`, `DETOUR_RATIO = 4`, `DETOUR_ABS_CAP_M = 3000`, `REJOIN_FORWARD_WINDOW_M = 1500` (exported consts).
  - `selectConnectorTarget(navigationRoute, fix, { mode, progressMeters = 0 }) -> { point: {lat,lng}, mainProgressMeters } | null`. `mode` is `"approach"` or `"rejoin"`. Returns null if geometry < 2.
  - `connectorWithinDetourBudget(connectorDistanceMeters, straightLineMeters) -> boolean`.

- [ ] **Step 1: Write the failing test** `tests/test-connector-targeting.mjs`

```js
import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  selectConnectorTarget,
  connectorWithinDetourBudget,
  APPROACH_NEAREST_MARGIN_M,
  DETOUR_RATIO,
} from "@cycleways/core/navigation/connectorTargeting.js";

// ~931 m east-west route at lat 33.1 (3 vertices, ~466 m each leg).
function route() {
  return navigationRouteFromRouteState(
    {
      points: [{ id: "a", lat: 33.1, lng: 35.6 }, { id: "b", lat: 33.1, lng: 35.61 }],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.605 },
        { lat: 33.1, lng: 35.61 },
      ],
      distance: 931.5,
    },
    { param: "t" },
  );
}

// Approach: rider far before the start -> target the start (mainProgress 0).
{
  const r = route();
  const t = selectConnectorTarget(r, { lat: 33.1, lng: 35.594 }, { mode: "approach" });
  assert.ok(t, "returns a target");
  assert.equal(t.mainProgressMeters, 0, "start target has progress 0");
  assert.ok(Math.abs(t.point.lng - 35.6) < 1e-9 && Math.abs(t.point.lat - 33.1) < 1e-9);
}

// Approach: rider much nearer the far end -> join nearest (mid/end), saving > margin.
{
  const r = route();
  // ~near the last vertex (35.61), far from the start (35.6 is ~930 m west).
  const t = selectConnectorTarget(r, { lat: 33.1, lng: 35.6105 }, { mode: "approach" });
  assert.ok(t.mainProgressMeters > APPROACH_NEAREST_MARGIN_M, "joins nearest, not the start");
}

// Rejoin: nearest point AHEAD of current progress (never behind).
{
  const r = route();
  const t = selectConnectorTarget(
    r,
    { lat: 33.105, lng: 35.605 }, // off-route, abreast of the middle
    { mode: "rejoin", progressMeters: 300 },
  );
  assert.ok(t.mainProgressMeters >= 300, "target is at/ahead of current progress");
}

// Detour budget: a connector ~3x the straight line is fine; ~10x is rejected.
{
  assert.equal(connectorWithinDetourBudget(300, 100), true, "3x within budget");
  assert.equal(connectorWithinDetourBudget(1000, 100), false, "10x rejected");
}

console.log("test-connector-targeting OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-connector-targeting.mjs`
Expected: FAIL — `Cannot find module .../connectorTargeting.js`.

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/navigation/connectorTargeting.js
// Pure target selection for the rejoin/approach connector (Phase B).
import { getDistance } from "../utils/distance.js";

export const APPROACH_NEAREST_MARGIN_M = 300;
export const REJOIN_FORWARD_WINDOW_M = 1500;
export const DETOUR_RATIO = 4;
export const DETOUR_ABS_CAP_M = 3000;

function nearestVertex(geometry, fix, minProgressMeters = -Infinity) {
  let best = null;
  for (const v of geometry) {
    if (v.distanceFromStartMeters < minProgressMeters) continue;
    const d = getDistance(fix, v);
    if (best === null || d < best.d) {
      best = { d, point: { lat: v.lat, lng: v.lng }, progress: v.distanceFromStartMeters };
    }
  }
  return best;
}

export function selectConnectorTarget(navigationRoute, fix, { mode, progressMeters = 0 } = {}) {
  const geometry = Array.isArray(navigationRoute?.geometry) ? navigationRoute.geometry : [];
  if (geometry.length < 2) return null;

  if (mode === "rejoin") {
    const ahead = nearestVertex(geometry, fix, progressMeters);
    const within =
      ahead && ahead.progress <= progressMeters + REJOIN_FORWARD_WINDOW_M ? ahead : null;
    const chosen = within || ahead || nearestVertex(geometry, fix);
    if (!chosen) return null;
    return { point: chosen.point, mainProgressMeters: chosen.progress };
  }

  // approach: scored start-vs-nearest
  const start = geometry[0];
  const dStart = getDistance(fix, start);
  const nearest = nearestVertex(geometry, fix);
  if (nearest && nearest.d < dStart - APPROACH_NEAREST_MARGIN_M) {
    return { point: nearest.point, mainProgressMeters: nearest.progress };
  }
  return { point: { lat: start.lat, lng: start.lng }, mainProgressMeters: 0 };
}

export function connectorWithinDetourBudget(connectorDistanceMeters, straightLineMeters) {
  if (!Number.isFinite(connectorDistanceMeters)) return false;
  if (connectorDistanceMeters > DETOUR_ABS_CAP_M) return false;
  const straight = Math.max(1, straightLineMeters || 0);
  return connectorDistanceMeters <= DETOUR_RATIO * straight;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-connector-targeting.mjs`
Expected: `test-connector-targeting OK`.

- [ ] **Step 5: Append to suite and commit**

Append ` && node tests/test-connector-targeting.mjs` to `package.json`.

```bash
git add packages/core/src/navigation/connectorTargeting.js tests/test-connector-targeting.mjs package.json
git commit -m "feat(nav): connector target selection + detour budget (Phase B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Session connector phase (pure)

### Task 2: Approach → routeRequest → on-connector (happy path)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify/Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: `selectConnectorTarget`, `createRouteProgressTracker`, `buildRouteCues`, `selectActiveCue`.
- Produces:
  - `NAV_ACTIONS.CONNECTOR_READY` (`"CONNECTOR_READY"`) and `NAV_ACTIONS.CONNECTOR_FAILED` (`"CONNECTOR_FAILED"`).
  - Session state gains: `routeRequest` (transient: `{ generationId, from:{lat,lng}, to:{lat,lng}, targetKind } | null`, cleared each dispatch like `cueEvent`), `connector` (`{ geometry, target } | null`), and statuses `"routing"`/`"on-connector"`.
  - On a `LOCATION` fix while `!hasAcquiredRoute` and no active connector: emit a `routeRequest` (mode `"approach"`) and set status `"routing"`. While `routing`, still expose Phase A guidance fields from `progress`.
  - On `CONNECTOR_READY { generationId, geometry, target }` matching the current generation: build a connector tracker (`createRouteProgressTracker({geometry})`) + connector cues, set `connector`, status `"on-connector"`.

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-session.mjs`)

```js
// --- Phase B: approach emits a routeRequest, CONNECTOR_READY -> on-connector ---
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const far = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 },
  });
  assert.equal(far.status, "routing", "far fix requests a connector");
  assert.ok(far.routeRequest, "emits a routeRequest");
  assert.equal(far.routeRequest.targetKind, "approach");
  assert.ok(far.routeRequest.to, "request carries a target point");
  const gen = far.routeRequest.generationId;

  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    generationId: gen,
    geometry: [
      { lat: 33.105, lng: 35.6 },
      { lat: 33.1, lng: 35.6 },
    ],
    target: { point: { lat: 33.1, lng: 35.6 }, mainProgressMeters: 0 },
  });
  assert.equal(ready.status, "on-connector", "ready -> on-connector");
  assert.ok(ready.connector, "connector stored");
}
```

(Use the file's existing `straightRoute()` helper added in the Phase A work; `createNavigationSession`/`NAV_ACTIONS` are already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — status is `"approaching"`, no `routeRequest`.

- [ ] **Step 3: Write the implementation**

In `navigationSession.js`:
- import `selectConnectorTarget` and (already imported) the tracker/cues helpers.
- add `CONNECTOR_READY`/`CONNECTOR_FAILED` to `NAV_ACTIONS`; add `"routing"` and `"on-connector"` to the `ACTIVE` set.
- add to initial state: `routeRequest: null, connector: null`.
- module-scope mutable: `let generationId = 0;` inside the closure, plus `let connectorTracker = null; let connectorCues = null;`.
- transient clear: extend the existing `cueEvent` clear to also clear `routeRequest` (`if ((state.cueEvent || state.routeRequest) && action.type !== NAV_ACTIONS.LOCATION) state = { ...state, cueEvent: null, routeRequest: null };`).
- In the `LOCATION` case, BEFORE the existing `!hasAcquiredRoute` branch, handle the connector states. Replace the approaching branch with:

```js
const progress = tracker.update(action.fix);

// On-connector: follow the connector (handled fully in Task 3); for now keep
// status on-connector when a connector is active and not yet acquired.
if (state.connector && !progress.hasAcquiredRoute) {
  return set({ status: "on-connector", progress, offRoute: false });
}

if (!progress.hasAcquiredRoute) {
  // Approaching: request an approach connector (status "routing"); the Phase A
  // guidance fields on `progress` remain the fallback while routing.
  const target = selectConnectorTarget(navigationRoute, action.fix, { mode: "approach" });
  generationId += 1;
  return set({
    status: "routing",
    progress,
    activeCue: null,
    cueEvent: null,
    offRoute: false,
    routeRequest: target
      ? {
          generationId,
          from: { lat: action.fix.lat, lng: action.fix.lng },
          to: target.point,
          toProgressMeters: target.mainProgressMeters,
          targetKind: "approach",
        }
      : null,
  });
}
// ... existing acquired/off-route handling unchanged ...
```

Add the `CONNECTOR_READY` case:

```js
case NAV_ACTIONS.CONNECTOR_READY: {
  if (action.generationId !== generationId) return state; // stale
  const geometry = buildConnectorGeometry(action.geometry);
  if (geometry.length < 2) return set({ connector: null });
  connectorTracker = createRouteProgressTracker({ geometry }, options);
  connectorCues = buildRouteCues({ geometry });
  return set({
    status: "on-connector",
    connector: { geometry, target: action.target },
  });
}
```

Add a small `buildConnectorGeometry(raw)` helper that maps `[{lat,lng}]` → geometry with cumulative `distanceFromStartMeters` (reuse the same approach as `buildNavigationGeometry` — import and reuse it from `navigationRoute.js`, or inline a 6-line cumulative builder using `getDistance`). Prefer importing a shared builder; if not exported, inline it and note the duplication for a follow-up.

(`CONNECTOR_FAILED` is added in Task 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-session.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): approach connector request + CONNECTOR_READY -> on-connector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: On-connector progress + cues + handoff

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify/Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: the `connectorTracker`/`connectorCues` from Task 2; `selectActiveCue`; `HANDOFF_RADIUS_M` from `connectorTargeting.js` (add this export there: `export const HANDOFF_RADIUS_M = 25;`).
- Produces: while `status === "on-connector"`, each `LOCATION` fix advances the connector tracker, sets `progress` to the connector progress, sets `activeCue` from the connector cues, and emits connector `cueEvent`s. **Handoff:** when the fix is within `HANDOFF_RADIUS_M` of `connector.target.point` OR the connector tracker reports `remainingMeters <= HANDOFF_RADIUS_M`, drop the connector, reset the MAIN tracker, seed it so its cursor starts at `connector.target.mainProgressMeters`, and set status `"navigating"`. (Seeding: call `tracker.reset()` then feed the same fix; the windowed cursor re-acquires near the target. Store `connector.target.mainProgressMeters` on the state as `resumeFromMeters` for the UI; the main tracker will converge.)

- [ ] **Step 1: Write the failing test** (append)

```js
// --- Phase B: on-connector advances + hands off at the target ---
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 },
  });
  const gen = session.getState().routeRequest.generationId;
  session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    generationId: gen,
    geometry: [
      { lat: 33.105, lng: 35.6 },
      { lat: 33.1, lng: 35.6 }, // connector ends at the route start
    ],
    target: { point: { lat: 33.1, lng: 35.6 }, mainProgressMeters: 0 },
  });
  // Move along the connector but not yet at the target -> still on-connector.
  const mid = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1025, lng: 35.6, accuracy: 8, speed: 4, timestamp: 4000 },
  });
  assert.equal(mid.status, "on-connector");
  // Arrive at the target (route start) -> handoff to navigating on the main route.
  const arrive = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 8, speed: 4, timestamp: 7000 },
  });
  assert.equal(arrive.status, "navigating", "handoff to main route");
  assert.equal(arrive.connector, null, "connector cleared after handoff");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — stays `on-connector` / never hands off.

- [ ] **Step 3: Write the implementation**

Add `export const HANDOFF_RADIUS_M = 25;` to `connectorTargeting.js` and import it. In the `LOCATION` case, replace the placeholder on-connector branch from Task 2 with:

```js
if (state.connector && connectorTracker) {
  const cp = connectorTracker.update(action.fix);
  const reached =
    cp.remainingMeters <= HANDOFF_RADIUS_M ||
    getDistance(action.fix, state.connector.target.point) <= HANDOFF_RADIUS_M;
  if (reached) {
    // Handoff: resume the main route at the target offset.
    tracker.reset();
    connectorTracker = null;
    connectorCues = null;
    const mp = tracker.update(action.fix); // re-acquire near the target
    return set({
      status: "navigating",
      connector: null,
      progress: mp,
      activeCue: selectActiveCue(cues, mp.progressMeters),
      offRoute: false,
    });
  }
  const activeCue = selectActiveCue(connectorCues, cp.progressMeters);
  // (connector cueEvent dedupe can reuse the same lastCueKey logic; keep simple:
  //  emit a cue event when the active connector cue key changes.)
  return set({ status: "on-connector", progress: cp, activeCue, offRoute: false });
}
```

(`getDistance` is already imported in routeProgress but NOT in the session — add `import { getDistance } from "../utils/distance.js";` to `navigationSession.js`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-session.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js packages/core/src/navigation/connectorTargeting.js tests/test-navigation-session.mjs
git commit -m "feat(nav): on-connector progress/cues + handoff to main route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Mid-ride confirmed off-route → rejoin request

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify/Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: `selectConnectorTarget` (mode `"rejoin"`), the existing off-route detection (`progress.offRoute`).
- Produces: when the rider is acquired and `progress.offRoute` becomes true (confirmed by the existing hysteresis), emit a `routeRequest` (mode `"rejoin"`, `from` = fix, `to` = `selectConnectorTarget(..., {mode:"rejoin", progressMeters})`) and set status `"routing"`; the Phase A arrow remains the fallback meanwhile. `CONNECTOR_READY` then drives `on-connector` (Task 2/3 path, unchanged).

- [ ] **Step 1: Write the failing test** (append) — drive acquisition, then sustained off-route, assert a `rejoin` routeRequest:

```js
// --- Phase B: confirmed mid-ride off-route requests a rejoin connector ---
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  // Acquire on the route.
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 1000 } });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.1, lng: 35.604, accuracy: 5, speed: 4, timestamp: 4000 } });
  // Diverge far + sustain past the off-route confirm dwell.
  let s;
  for (let t = 7000; t <= 20000; t += 3000) {
    s = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.108, lng: 35.605, accuracy: 5, speed: 4, timestamp: t } });
  }
  assert.equal(s.status, "routing", "confirmed off-route requests a connector");
  assert.equal(s.routeRequest.targetKind, "rejoin");
  assert.ok(s.routeRequest.to, "rejoin request has a target ahead");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — status stays `"off-route"`, no `routeRequest`.

- [ ] **Step 3: Write the implementation**

In the acquired branch of `LOCATION`, after computing `offRoute`, before returning the off-route state, add: if `offRoute` and no active connector and not already routing for this episode, emit a rejoin request:

```js
if (offRoute && !state.connector) {
  const target = selectConnectorTarget(navigationRoute, action.fix, {
    mode: "rejoin",
    progressMeters: progress.progressMeters,
  });
  if (target) {
    generationId += 1;
    return set({
      status: "routing",
      progress,
      offRoute: true,
      activeCue: null,
      cueEvent: wasOffRoute ? null : { kind: "off-route" },
      routeRequest: {
        generationId,
        from: { lat: action.fix.lat, lng: action.fix.lng },
        to: target.point,
        toProgressMeters: target.mainProgressMeters,
        targetKind: "rejoin",
      },
    });
  }
}
```

(Keep the existing off-route `wasOffRoute` bookkeeping so the off-route haptic still fires once. The per-fix re-request spam is bounded in Task 5 by the throttle; for this task, emitting on each off-route fix is acceptable and made correct in Task 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-session.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): mid-ride confirmed off-route requests a rejoin connector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Failure fallback, recompute throttle, stale-generation drop

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify/Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: `RECOMPUTE_MIN_MS`, `RECOMPUTE_MIN_MOVE_M` from `connectorTargeting.js` (add: `export const RECOMPUTE_MIN_MS = 5000; export const RECOMPUTE_MIN_MOVE_M = 30;`); `connectorWithinDetourBudget`; `getDistance`.
- Produces:
  - `CONNECTOR_FAILED { generationId, reason }`: if it matches the current generation, clear `connector`, return to the fallback status (`"approaching"` if not acquired, else `"off-route"`) with Phase A guidance fields intact.
  - **Throttle:** the session only emits a new `routeRequest` if `fix.timestamp - lastRequestAt >= RECOMPUTE_MIN_MS` AND the rider moved `>= RECOMPUTE_MIN_MOVE_M` since `lastRequestPos` (or there has been no request yet / a request just failed). Track `lastRequestAt`, `lastRequestPos` in the closure; update them whenever a `routeRequest` is emitted.
  - **Stale drop:** already enforced by the `action.generationId !== generationId` guard in `CONNECTOR_READY`; apply the same guard in `CONNECTOR_FAILED`.
  - **Detour reject:** the hook passes the computed `distanceMeters` in `CONNECTOR_READY`; the session computes `straightLine = getDistance(from, to)` (store the last request's `from`/`to`) and if `!connectorWithinDetourBudget(distanceMeters, straightLine)` treats it as a failure (fallback + throttle), not a connector.

- [ ] **Step 1: Write the failing tests** (append): (a) `CONNECTOR_FAILED` → fallback status with guidance; (b) two off-route fixes within `RECOMPUTE_MIN_MS`/move do NOT emit a second `routeRequest`; (c) a `CONNECTOR_READY` whose `distanceMeters` busts the detour budget is rejected (no connector, fallback).

```js
// (a) failure -> fallback
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const far = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 } });
  const gen = far.routeRequest.generationId;
  const failed = session.dispatch({ type: NAV_ACTIONS.CONNECTOR_FAILED, generationId: gen, reason: "no-path" });
  assert.equal(failed.status, "approaching", "failure falls back to approaching (arrow)");
  assert.equal(failed.connector, null);
  assert.ok(Number.isFinite(failed.progress.guidanceBearingDeg), "Phase A guidance still present");
}
// (b) throttle: no second request within the gate
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const r1 = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 } });
  session.dispatch({ type: NAV_ACTIONS.CONNECTOR_FAILED, generationId: r1.routeRequest.generationId, reason: "x" });
  // 1s later, barely moved -> no new request
  const r2 = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.10501, lng: 35.6, accuracy: 8, speed: 4, timestamp: 2000 } });
  assert.equal(r2.routeRequest, null, "throttled: no second request within the gate");
}
// (c) detour-budget reject
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const far = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 } });
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    generationId: far.routeRequest.generationId,
    geometry: [{ lat: 33.105, lng: 35.6 }, { lat: 33.1, lng: 35.6 }],
    target: { point: { lat: 33.1, lng: 35.6 }, mainProgressMeters: 0 },
    distanceMeters: 99999, // absurd detour vs ~557 m straight line
  });
  assert.notEqual(ready.status, "on-connector", "busted detour budget is not accepted");
  assert.equal(ready.connector, null);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — no `CONNECTOR_FAILED` case; second request emitted; absurd connector accepted.

- [ ] **Step 3: Write the implementation**

- Add closure state: `let lastRequestAt = -Infinity; let lastRequestPos = null; let lastRequestTo = null;`.
- Wrap request emission in a guard helper:

```js
function mayRequest(fix) {
  if (lastRequestPos === null) return true;
  const movedOk = getDistance(lastRequestPos, fix) >= RECOMPUTE_MIN_MOVE_M;
  const timeOk = fix.timestamp - lastRequestAt >= RECOMPUTE_MIN_MS;
  return movedOk && timeOk;
}
function noteRequest(fix, to) {
  lastRequestAt = fix.timestamp;
  lastRequestPos = { lat: fix.lat, lng: fix.lng };
  lastRequestTo = to;
}
```

  Gate BOTH the approach (Task 2) and rejoin (Task 4) emissions with `if (target && mayRequest(action.fix)) { generationId += 1; noteRequest(action.fix, target.point); ...emit... } else { ...return fallback status WITHOUT routeRequest (routeRequest:null)... }`. When throttled in approach, status stays `"routing"` if already routing else fall back to `"approaching"`; for off-route, `"off-route"`.
- `CONNECTOR_READY`: before building the connector, detour-check:

```js
const straight = lastRequestTo ? getDistance(lastRequestTo, lastRequestPos || action) : Infinity;
if (Number.isFinite(action.distanceMeters) &&
    !connectorWithinDetourBudget(action.distanceMeters, straight)) {
  return set({ connector: null }); // fall back; next fix re-evaluates under the throttle
}
```

- Add `CONNECTOR_FAILED`:

```js
case NAV_ACTIONS.CONNECTOR_FAILED: {
  if (action.generationId !== generationId) return state;
  connectorTracker = null;
  connectorCues = null;
  const acquired = state.progress?.hasAcquiredRoute;
  return set({
    status: acquired ? "off-route" : "approaching",
    connector: null,
  });
}
```

  Reset `lastRequestAt`/`lastRequestPos` are intentionally NOT reset on failure (so the throttle still applies to the retry).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-replay.mjs`
Expected: both `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js packages/core/src/navigation/connectorTargeting.js tests/test-navigation-session.mjs
git commit -m "feat(nav): connector failure fallback, recompute throttle, stale-gen + detour reject

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Replay-harness end-to-end (pure)

### Task 6: Replay runner connector-stub support + end-to-end fixtures

**Files:**
- Modify: `packages/core/src/navigation/replayRunner.js`
- Modify/Test: `tests/test-navigation-replay.mjs`

**Interfaces:**
- Consumes: session `routeRequest` output + `CONNECTOR_READY`/`CONNECTOR_FAILED` actions.
- Produces: `replaySession(navigationRoute, fixes, options)` gains `options.connectorRouter` — a function `(routeRequest) -> { geometry, distanceMeters } | { failure }`. After each `LOCATION` dispatch, if `state.routeRequest` is present and a `connectorRouter` is provided, the runner synchronously dispatches `CONNECTOR_READY` (with the router's geometry/distanceMeters + a `target` derived from the request — the runner passes the request's `to` as `target.point` and `mainProgressMeters` from `options.targetProgressFor?.(routeRequest) ?? 0`) or `CONNECTOR_FAILED`. This lets node fixtures exercise the full approach→connector→handoff and off-route→rejoin flows deterministically.

- [ ] **Step 1: Write the failing test** (append to `tests/test-navigation-replay.mjs`): generate an approach track, provide a `connectorRouter` returning a straight connector to the request target, and assert the timeline goes `routing → on-connector → navigating` and completes.

```js
// --- Phase B: end-to-end approach -> connector -> handoff via stub router ---
{
  const route = straightRoute(); // helper already in this file
  const fixes = generateTrack(route, { speedMps: 5, intervalMs: 1000, seed: 3, approachFrom: { lat: 33.1, lng: 35.5965 } });
  const connectorRouter = (req) => ({
    geometry: [req.from, req.to],
    distanceMeters: 0, // straight stub; within budget
  });
  const { timeline, last } = replaySession(route, fixes, {
    connectorRouter,
    targetProgressFor: () => 0,
  });
  assert.ok(timeline.some((s) => s.status === "routing"), "enters routing");
  assert.ok(timeline.some((s) => s.status === "on-connector"), "follows a connector");
  assert.ok(timeline.some((s) => s.status === "navigating"), "hands off to the route");
  assert.ok(last.progress.fraction > 0.8, "completes the ride");
}
```

(`straightRoute()` must exist in this file; if the file's helper differs, reuse it. `generateTrack`, `replaySession` already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-replay.mjs`
Expected: FAIL — never reaches `on-connector` (runner doesn't pump the request).

- [ ] **Step 3: Write the implementation**

In `replayRunner.js`, the loop currently does `session.dispatch({ type: NAV_ACTIONS.LOCATION, fix }); timeline.push(session.getState());`. Insert the connector pump BETWEEN the dispatch and the existing push (do not add a second push) so the single push captures the post-connector state:

```js
const st = session.getState();
if (st.routeRequest && typeof options.connectorRouter === "function") {
  const req = st.routeRequest;
  const res = options.connectorRouter(req);
  if (res && res.failure) {
    session.dispatch({ type: NAV_ACTIONS.CONNECTOR_FAILED, generationId: req.generationId, reason: res.failure });
  } else if (res && Array.isArray(res.geometry)) {
    session.dispatch({
      type: NAV_ACTIONS.CONNECTOR_READY,
      generationId: req.generationId,
      geometry: res.geometry,
      distanceMeters: res.distanceMeters,
      target: {
        point: req.to,
        mainProgressMeters: options.targetProgressFor ? options.targetProgressFor(req) : 0,
      },
    });
  }
}
timeline.push(session.getState());
```

(Push the post-connector state so the timeline shows `on-connector`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-replay.mjs`
Expected: `... OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/replayRunner.js tests/test-navigation-replay.mjs
git commit -m "test(nav): replay-harness connector-router stub + end-to-end connector flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — On-device connector compute (core routing)

### Task 7: computeConnectorRoute (non-mutating)

**Files:**
- Create: `packages/core/src/routing/computeConnectorRoute.js`
- Create/Test: `tests/test-compute-connector-route.mjs`
- Modify: `package.json` (append test)

**Interfaces:**
- Consumes: a `ShardedRouteSession`-like object exposing `ensureCoverage(points)` and a `manager` with a non-mutating path computation. The route-manager's `_calculateBaseRoute(routePoints)` returns `{ orderedCoordinates, distance, failure }` WITHOUT committing the active route (verify: it returns a route object and does not set `selectedSegments`/`baseRouteInfo`). Expose a thin public method on the session: `computeConnector(from, to)`.
- Produces: `computeConnectorRoute(session, from, to) -> Promise<{ geometry, distanceMeters, failure }>`. `geometry` is `orderedCoordinates` mapped to `{lat,lng}`; `failure` non-null when no path. Asserts the planner's active route (`session.manager.getRouteInfo()`) is UNCHANGED across the call.

- [ ] **Step 1: Write the failing test** `tests/test-compute-connector-route.mjs`

```js
import assert from "node:assert/strict";
import { computeConnectorRoute } from "@cycleways/core/routing/computeConnectorRoute.js";

// Fake session: records ensureCoverage calls; manager.computePath returns a
// canned ordered route and must NOT be the mutating route setter.
function fakeSession() {
  let activeRoute = { points: ["A", "B"], orderedCoordinates: [{ lat: 0, lng: 0 }] };
  return {
    ensureCoverageCalls: [],
    async ensureCoverage(points) { this.ensureCoverageCalls.push(points); return true; },
    manager: {
      // non-mutating path computation between two arbitrary points
      computeBaseRouteBetween(from, to) {
        return {
          orderedCoordinates: [from, { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 }, to],
          distance: 123,
          failure: null,
        };
      },
      getRouteInfo() { return activeRoute; },
    },
  };
}

{
  const s = fakeSession();
  const before = s.manager.getRouteInfo();
  const res = await computeConnectorRoute(s, { lat: 33.1, lng: 35.59 }, { lat: 33.1, lng: 35.6 });
  assert.equal(res.failure, null);
  assert.equal(res.geometry.length, 3);
  assert.equal(res.distanceMeters, 123);
  assert.ok(s.ensureCoverageCalls.length >= 1, "ensures coverage for the endpoints");
  assert.deepEqual(s.manager.getRouteInfo(), before, "active route is NOT mutated");
}
// failure path
{
  const s = fakeSession();
  s.manager.computeBaseRouteBetween = () => ({ orderedCoordinates: [], distance: 0, failure: "no-path" });
  const res = await computeConnectorRoute(s, { lat: 0, lng: 0 }, { lat: 1, lng: 1 });
  assert.equal(res.failure, "no-path");
}
console.log("test-compute-connector-route OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-compute-connector-route.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

First add a **non-mutating** path method to `route-manager.js`: `computeBaseRouteBetween(from, to)` that wraps the existing `_calculateBaseRoute([from, to])` (which already returns a route object without committing it) and returns `{ orderedCoordinates, distance, failure }`. (Confirm `_calculateBaseRoute` does not assign `this.selectedSegments`/`this.baseRouteInfo`; from the code it builds and returns a local `route`. If it has any side effect, snapshot+restore the relevant fields around the call.)

Then:

```js
// packages/core/src/routing/computeConnectorRoute.js
// Non-mutating connector path compute (Phase B). The only shard-I/O piece.
export async function computeConnectorRoute(session, from, to) {
  if (!session?.manager) return { geometry: [], distanceMeters: 0, failure: "no-router" };
  if (typeof session.ensureCoverage === "function") {
    const covered = await session.ensureCoverage([from, to]);
    if (covered === false) return { geometry: [], distanceMeters: 0, failure: "no-coverage" };
  }
  const route = session.manager.computeBaseRouteBetween(from, to);
  if (!route || route.failure || !Array.isArray(route.orderedCoordinates) || route.orderedCoordinates.length < 2) {
    return { geometry: [], distanceMeters: 0, failure: route?.failure || "no-path" };
  }
  return {
    geometry: route.orderedCoordinates.map((c) => ({ lat: c.lat, lng: c.lng })),
    distanceMeters: route.distance || 0,
    failure: null,
  };
}
```

Append ` && node tests/test-compute-connector-route.mjs` to `package.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-compute-connector-route.mjs && node tests/test-route-manager-geometry.js`
Expected: connector test `OK`; existing route-manager geometry test still passes (non-mutating method added cleanly).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/routing/computeConnectorRoute.js packages/core/route-manager.js tests/test-compute-connector-route.mjs package.json
git commit -m "feat(routing): non-mutating computeConnectorRoute + computeBaseRouteBetween

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — Native wiring (bundle-checked; visual verification deferred)

> Native glue is not node-tested. Each task's gate is: the iOS bundle exports cleanly (`cd apps/mobile && npx expo export --platform ios --output-dir /tmp/<name>`), and the connector session logic it drives is already covered by the node harness. Live behavior (dashed line, real routing, no thrash, handoff feel) is a DEFERRED MANUAL device/simulator step.

### Task 8: Hook wires routeRequest → computeConnectorRoute

**Files:**
- Modify: `apps/mobile/src/navigation/useNavigationSession.js`

**Interfaces:**
- Consumes: session `state.routeRequest` (`{ generationId, from, to, targetKind }`); the app's `ShardedRouteSession` (passed in as `options.connectorSession`, or reached via the existing routing-session ref); `computeConnectorRoute`.
- Produces: when a new `routeRequest` (by `generationId`) appears, the hook calls `computeConnectorRoute(connectorSession, from, to)` and dispatches `CONNECTOR_READY { generationId, geometry, distanceMeters, target }` or `CONNECTOR_FAILED { generationId, reason }`. `target` = `{ point: routeRequest.to, mainProgressMeters }` where `mainProgressMeters` is computed from the request (for `approach`/`rejoin`, the hook passes the target's main-route progress — provided by the session in the request, see note). In-flight requests for superseded generations are abandoned (compare against the latest seen `generationId`).

> Plan note: the `routeRequest` emitted by the session (Tasks 2 and 4) already carries `toProgressMeters` (= `target.mainProgressMeters` from `selectConnectorTarget`); the hook passes it straight back in `target.mainProgressMeters` so it needn't recompute progress.

- [ ] **Step 1: Implement the effect** — a `useEffect` keyed on `state.routeRequest?.generationId` that:
  - captures `gen = state.routeRequest.generationId`, sets `latestGenRef.current = gen`;
  - `computeConnectorRoute(connectorSession, from, to).then(res => { if (latestGenRef.current !== gen) return; dispatch(res.failure ? CONNECTOR_FAILED : CONNECTOR_READY ...); })`;
  - on error → `CONNECTOR_FAILED`.

```jsx
const latestGenRef = useRef(0);
useEffect(() => {
  const req = state?.routeRequest;
  if (!req || !connectorSession) return;
  const gen = req.generationId;
  latestGenRef.current = gen;
  let cancelled = false;
  computeConnectorRoute(connectorSession, req.from, req.to)
    .then((res) => {
      if (cancelled || latestGenRef.current !== gen) return;
      if (res.failure) {
        dispatch({ type: NAV_ACTIONS.CONNECTOR_FAILED, generationId: gen, reason: res.failure });
      } else {
        dispatch({
          type: NAV_ACTIONS.CONNECTOR_READY,
          generationId: gen,
          geometry: res.geometry,
          distanceMeters: res.distanceMeters,
          target: { point: req.to, mainProgressMeters: req.toProgressMeters ?? 0 },
        });
      }
    })
    .catch((e) => {
      if (!cancelled && latestGenRef.current === gen) {
        dispatch({ type: NAV_ACTIONS.CONNECTOR_FAILED, generationId: gen, reason: String(e?.message || e) });
      }
    });
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [state?.routeRequest?.generationId]);
```

(`dispatch` is the hook's existing session dispatch wrapper; `connectorSession` is a new option, defaulting to the app-provided sharded session.)

- [ ] **Step 2: Bundle check**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nav-connector-8`
Expected: EXIT 0, no bundling/import errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/navigation/useNavigationSession.js
git commit -m "feat(mobile): hook computes connector on routeRequest with gen-id cancellation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Dashed connector line + connector cue presentation + camera

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify/Test: `tests/test-navigation-presentation.mjs`

**Interfaces:**
- Consumes: `nav.state.connector` (`{ geometry, target }`), `nav.state.status` (`on-connector`/`routing`).
- Produces:
  - **Presentation:** `getNavigationPresentation` gains `onConnector: status === "on-connector"` and a `connectorContextText` (Hebrew/RTL, e.g. "מסלול חיבור — לכיוון המסלול"); when `status === "routing"`, `statusText` is "מחשב מסלול…". Node-tested.
  - **MapScreen:** render `nav.state.connector.geometry` as a **dashed** `LineLayer` (distinct from the solid route). While `on-connector`, the smoothed-puck/camera RAF uses the CONNECTOR geometry+arc as its active geometry (so the puck follows the connector and the camera tight-follows), then reverts to the main route on handoff. The approach `fitBounds` view applies only while `routing`/`approaching` with no connector.

- [ ] **Step 1: Presentation TDD** — append a test to `tests/test-navigation-presentation.mjs` for `onConnector`/`connectorContextText` and the `routing` status text; implement in `navigationPresentation.js`. Run `node tests/test-navigation-presentation.mjs` → pass.

```js
{
  const p = getNavigationPresentation({ status: "on-connector", progress: { hasAcquiredRoute: false } });
  assert.equal(p.onConnector, true);
  assert.match(p.connectorContextText, /חיבור/);
}
{
  const p = getNavigationPresentation({ status: "routing", progress: {} });
  assert.match(p.statusText, /מחשב/);
}
```

- [ ] **Step 2: MapScreen dashed line + connector geometry routing** — add a `ShapeSource`/`LineLayer` with a dash pattern for `nav.state.connector?.geometry`; in the RAF, select `activeGeom/activeArc` = connector geometry+arc when `status === "on-connector"`, else the main route (precompute the connector arc with `precomputeArcLength` in a `useMemo` over `connector?.geometry`). Keep tight-follow for `on-connector`.

- [ ] **Step 3: Bundle check**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nav-connector-9`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx packages/core/src/navigation/navigationPresentation.js tests/test-navigation-presentation.mjs
git commit -m "feat(mobile): dashed connector line, connector cue context, on-connector camera

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 6 — Simulate-ride wiring + end-to-end fixture

### Task 10: Dev simulate-ride runs the real connector + a node end-to-end rejoin fixture

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx` (dev simulate-ride passes the app's sharded session as `connectorSession` so the real `computeConnectorRoute` runs in simulation)
- Modify/Test: `tests/test-navigation-replay.mjs` (a node end-to-end **rejoin** fixture using the stub router)

**Interfaces:**
- Consumes: the Task 6 `connectorRouter` stub; the Task 8 `connectorSession` option.
- Produces: a node fixture proving the mid-ride off-route → rejoin → handoff path end-to-end; and the dev simulate-ride wired so a human can watch the real connector compute (deferred-manual).

- [ ] **Step 1: Node rejoin end-to-end test** (append to `tests/test-navigation-replay.mjs`): generate an on-route track, splice a mid-route divergence excursion, provide a `connectorRouter` returning a straight connector to `req.to`, and assert the timeline reaches `on-connector` after the divergence and returns to `navigating` (handoff), completing.

```js
// --- Phase B: mid-ride off-route -> rejoin -> handoff (stub router) ---
{
  const route = straightRoute();
  const onRoute = generateTrack(route, { speedMps: 5, intervalMs: 1000, seed: 9 });
  // splice an off-route excursion in the middle, then return near the route
  const excursion = [];
  for (let i = 0; i < 8; i++) {
    excursion.push({ lat: 33.108, lng: 35.605, accuracy: 6, speed: 4, timestamp: 0 });
  }
  const fixes = [...onRoute.slice(0, 40), ...excursion, ...onRoute.slice(40)].map((f, i) => ({ ...f, timestamp: 1000 + i * 3000 }));
  const connectorRouter = (req) => ({ geometry: [req.from, req.to], distanceMeters: 0 });
  const { timeline } = replaySession(route, fixes, { connectorRouter, targetProgressFor: (req) => req.toProgressMeters ?? 0 });
  const i = timeline.findIndex((s) => s.status === "on-connector");
  assert.ok(i >= 0, "enters on-connector after diverging");
  assert.ok(timeline.slice(i).some((s) => s.status === "navigating"), "hands back to the route");
}
```

- [ ] **Step 2: Run test** — `node tests/test-navigation-replay.mjs` → pass.

- [ ] **Step 3: Wire dev simulate-ride** — in the `__DEV__` simulate-ride path in `MapScreen.jsx`, pass the app's sharded routing session as `connectorSession` to `useNavigationSession` so the real `computeConnectorRoute` runs during simulation. Bundle check: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nav-connector-10` → EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add tests/test-navigation-replay.mjs apps/mobile/src/MapScreen.jsx
git commit -m "test(nav): end-to-end rejoin fixture; dev simulate-ride runs the real connector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full suite** — `npm test` → all green (new test files included).
- [ ] **iOS export** — `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nav-connector-final` → EXIT 0.
- [ ] **Update plan/design status** — mark `plans/turn-by-turn-rejoin-routing/design.md` implemented; note the DEFERRED MANUAL device pass (watch approach connector, mid-ride rejoin, no thrash, handoff feel; tune the constants) and capture a real-ride rejoin recording via the dev recorder. Commit.

## Deferred (manual / future)
- On-device tuning of `APPROACH_NEAREST_MARGIN_M`, `DETOUR_RATIO`/`DETOUR_ABS_CAP_M`, `RECOMPUTE_MIN_MS`/`RECOMPUTE_MIN_MOVE_M`, `HANDOFF_RADIUS_M` in the simulate-ride harness + on a real ride.
- Voice/TTS connector cues (voice-ready already), background location, Android, junction-vs-bend classification — unchanged from prior plans.
