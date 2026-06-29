# Turn-by-Turn Rejoin Routing (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iPhone rider routed, turn-by-turn guidance to the route — a "connector" path (to the start when approaching, the nearest point ahead when rejoining mid-ride) with throttled auto-recompute, a seeded handoff back to the main route, and a guaranteed fallback to the existing Phase A arrow.

**Architecture:** Pure logic in `@cycleways/core` (node-tested). Connector lifecycle is an **orthogonal** field on the session (`connector:{status,requestId,pendingTarget}`) — `status` stays `approaching`/`off-route` while computing so the Phase A arrow keeps showing; `on-connector` is the only new top-level status. The **session owns** request ids, throttle, pending target, and stale-result acceptance; the **hook only runs the async compute**. Connectors are computed by a non-mutating `previewBaseRoute` (snaps raw GPS first) wrapped in a `computeConnector` capability that preserves the planner's cached route across shard-coverage extension.

**Tech Stack:** Node ESM, `node:assert/strict` tests, `@cycleways/core`, React Native + `@rnmapbox/maps`, the on-device `ShardedRouteSession` graph.

## Global Constraints

- **Test runner:** new pure tests are standalone `node tests/test-<name>.mjs` (import `node:assert/strict`, import core via `@cycleways/core/...`), appended to the `"test"` chain in `package.json` (end, before `&& cd tests && node test-route-manager.js`).
- **No planner mutation:** connector computation must NOT change the planner's active route. Specifically it must preserve `manager.baseRouteInfo` + `lastRouteFailure` across `ensureCoverage` (shard loading nulls `baseRouteInfo` at route-manager.js:877). A mutation-regression test is mandatory.
- **Router input:** never call `_calculateBaseRoute` with raw GPS; raw points must be snapped first (`previewBaseRoute` does this).
- **Orthogonal state:** no top-level `"routing"` status. While computing, `status` stays `approaching`/`off-route`; connector lifecycle lives in `connector.status` (`idle|requesting|active|failed`). `on-connector` is the only new status.
- **Session authoritative:** request ids, throttle, pending target, stale acceptance live in the session. The hook performs async work and returns a result only.
- **Detour:** accept by an absolute distance cap (`CONNECTOR_MAX_DISTANCE_M`); do NOT reject by straight-line ratio (a barrier is where routing helps most).
- **Single rider-position source:** the session stores `latestFix`; the puck/off-route position derive from it (not Mapbox `UserLocation`).
- **Distance frame:** geometry haversine (`distanceFromStartMeters`), as Phase A.
- **Copy:** Hebrew/RTL. **Foreground-only.** **Dev-only code `__DEV__`-gated.**
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (standing convention).
- **Acceptance:** a clean iOS bundle export is NOT "implemented" — a real device/simulator acceptance pass (Task 13) is required.
- **Tuning constants** are named exported consts with the defaults below; tuned later in the simulate-ride harness: `APPROACH_NEAREST_MARGIN_M=300`, `REJOIN_FORWARD_WINDOW_M=1500`, `CONNECTOR_MAX_DISTANCE_M=8000`, `RECOMPUTE_MIN_MS=5000`, `RECOMPUTE_MIN_MOVE_M=30`, `TRANSIENT_RETRY_BASE_MS=4000`, `HANDOFF_RADIUS_M=25`, `HANDOFF_ACCURACY_FACTOR=1`.

---

## File Structure

New core: `packages/core/src/navigation/connectorTargeting.js` (projection target selection + cap); `packages/core/src/routing/computeConnectorRoute.js` (thin orchestrator over the session capability) — OR fold into the session capability (see Task 3).
Modified core: `route-manager.js` (`previewBaseRoute`), `shardedRouteSession.js` (`computeConnector`), `routeProgress.js` (`seed()` + export `projectToSegment`), `navigationSession.js` (connector phase), `replayRunner.js` (stub + transition recording), `navigationPresentation.js`, `useCyclewaysApp.js` (expose `computeConnector`).
Modified native: `useNavigationSession.js` (async-only compute), `MapScreen.jsx` (latestFix source, dashed line, status consumers, geometry-switch resets, camera).
Tests: `tests/test-connector-targeting.mjs`, `tests/test-preview-base-route.mjs`, `tests/test-compute-connector.mjs` (new); extend `tests/test-route-progress.mjs`, `tests/test-navigation-session.mjs`, `tests/test-navigation-replay.mjs`, `tests/test-navigation-presentation.mjs`.

---

## Phase 1 — Pure foundations

### Task 1: `tracker.seed()` for the handoff

**Files:** Modify `packages/core/src/navigation/routeProgress.js`; export `projectToSegment`. Modify/Test `tests/test-route-progress.mjs`.

**Interfaces:**
- Produces: `createRouteProgressTracker(...).seed({ progressMeters, acquired = true })` — sets `lastProgressMeters = progressMeters`, `acquired`, clears off-route hysteresis, so the NEXT `update(fix)` searches the windowed forward cursor around `progressMeters` (not a global reacquire). Also `export function projectToSegment(p, a, b)` (lift the existing internal one to a named export; keep the internal call site).

- [ ] **Step 1: Failing test** (append to `tests/test-route-progress.mjs`): seed mid-route, then an off-axis fix near that point resolves progress near the seed (not 0, not a far branch).

```js
// --- seed() places the cursor without a global reacquire ---
{
  const tracker = createRouteProgressTracker(straightRoute());
  tracker.seed({ progressMeters: 600, acquired: true });
  const p = tracker.update({ lat: 33.1, lng: 35.6068, accuracy: 6, speed: 4, timestamp: 1000 });
  assert.equal(p.hasAcquiredRoute, true, "seed marks acquired");
  assert.ok(Math.abs(p.progressMeters - 600) < 120, "resumes near the seed, not 0");
}
```

- [ ] **Step 2:** `node tests/test-route-progress.mjs` → FAIL (`seed` not a function).
- [ ] **Step 3:** add `acquired`/`lastProgressMeters` seeding:

```js
function seed({ progressMeters, acquired = true }) {
  lastProgressMeters = Number.isFinite(progressMeters) ? progressMeters : null;
  acquiredFlag = acquired === true; // the Phase A acquisition latch
  offRouteState = "on"; candidateSince = null; recoverSince = null;
}
// ...return { update, reset, seed };
```
(Rename the Phase A `acquired` closure var if needed so `seed` can set it; export `projectToSegment`.)

- [ ] **Step 4:** `node tests/test-route-progress.mjs` → PASS.
- [ ] **Step 5:** commit `feat(nav): tracker.seed() + export projectToSegment for connector handoff`.

---

### Task 2: `previewBaseRoute` (non-mutating, snaps raw GPS)

**Files:** Modify `packages/core/route-manager.js`. Create/Test `tests/test-preview-base-route.mjs` (append to `package.json`).

**Interfaces:**
- Consumes: existing `previewRouteInfo` (snaps via `_snapRoutePoints` then `_calculateBaseRoute`, no mutation — route-manager.js:228).
- Produces: `previewBaseRoute(points) -> { geometry, distanceMeters, failure, snappedEndpoints }`. Snaps, computes, returns `geometry` = `orderedCoordinates` as `{lat,lng}`, `distanceMeters` = route distance, `failure` (null/string), `snappedEndpoints` = `[snappedStart, snappedEnd]`. Must NOT mutate active route (`selectedSegments`/`baseRouteInfo`/`routePoints`).

- [ ] **Step 1: Failing test** `tests/test-preview-base-route.mjs` — build a **real** `RouteManager` over the small base-routing graph fixture the existing base-routing tests use (see `tests/test-base-routing-network.mjs` for how it constructs the manager + network), restore an active route through two points, snapshot `getRouteInfo()`, call `previewBaseRoute([rawA, rawB])` with raw lat/lng near the graph, assert: non-empty `geometry`, finite positive `distanceMeters`, `failure === null`, and `getRouteInfo()` deep-equals the pre-call snapshot. Add a second case with off-graph points asserting `failure` non-null. (Use the fixture-construction helper from the existing base-routing test; do not invent a fake manager.)

- [ ] **Step 2:** run → FAIL (`previewBaseRoute` undefined).
- [ ] **Step 3:** implement on `RouteManager`:

```js
previewBaseRoute(points) {
  const snapped = this._snapRoutePoints(points);
  if (!Array.isArray(snapped) || snapped.length < 2) {
    return { geometry: [], distanceMeters: 0, failure: "snap-failed", snappedEndpoints: snapped || [] };
  }
  if (!this.baseRoutingNetwork) {
    return { geometry: [], distanceMeters: 0, failure: "no-base-network", snappedEndpoints: snapped };
  }
  const route = this._calculateBaseRoute(snapped); // returns a route object; does not commit
  if (route.failure || !Array.isArray(route.orderedCoordinates) || route.orderedCoordinates.length < 2) {
    return { geometry: [], distanceMeters: 0, failure: route.failure || "no-path", snappedEndpoints: snapped };
  }
  return {
    geometry: route.orderedCoordinates.map((c) => ({ lat: c.lat, lng: c.lng })),
    distanceMeters: route.distance || 0,
    failure: null,
    snappedEndpoints: [snapped[0], snapped[snapped.length - 1]],
  };
}
```
(Verify `_calculateBaseRoute` has no active-route side effects; the test's deep-equal snapshot guards this. If it does mutate, snapshot+restore the touched fields inside `previewBaseRoute`.)

- [ ] **Step 4:** run + `node tests/test-route-manager-geometry.js` → PASS.
- [ ] **Step 5:** append to `package.json`; commit `feat(routing): non-mutating previewBaseRoute (snaps raw GPS, returns distance+failure)`.

---

### Task 3: `computeConnector` capability (preserves planner route across coverage)

**Files:** Modify `packages/core/src/routing/shardedRouteSession.js`; modify `packages/core/src/app/useCyclewaysApp.js` (expose `computeConnector`). Create/Test `tests/test-compute-connector.mjs` (append to `package.json`).

**Interfaces:**
- Produces: `ShardedRouteSession.computeConnector(from, to) -> Promise<{ geometry, distanceMeters, failure, snappedEndpoints }>`. It: saves `manager.baseRouteInfo` + `manager.lastRouteFailure`, awaits `ensureCoverage([from, to])`, restores those two fields (so the planner's cached route survives the shard merge), then returns `manager.previewBaseRoute([from, to])` (or `{failure:"no-coverage"}` if coverage failed). `useCyclewaysApp` returns a bound `computeConnector(from, to)` that delegates to `shardedRouteSessionRef.current?.computeConnector` (or `{failure:"no-router"}` when no session).

- [ ] **Step 1: Failing mutation-regression test** `tests/test-compute-connector.mjs` — build a real sharded session over a fixture with at least two shards where the second isn't initially loaded (reuse `tests/test-base-routing-shards.mjs` fixture construction). Restore a planner route; snapshot `manager.getRouteInfo()`. Call `session.computeConnector(rawA, rawB)` where `rawB` is in the not-yet-loaded shard (forces `ensureCoverage` to merge a shard). Assert: a connector `geometry` is returned, and `manager.getRouteInfo()` deep-equals the snapshot (planner route unchanged). Second case: `from` off-grid → `{failure}` and snapshot still unchanged.

- [ ] **Step 2:** run → FAIL (`computeConnector` undefined / planner route changed).
- [ ] **Step 3:** implement on `ShardedRouteSession`:

```js
async computeConnector(from, to) {
  if (!this.manager) return { geometry: [], distanceMeters: 0, failure: "no-router", snappedEndpoints: [] };
  const savedRouteInfo = this.manager.baseRouteInfo;
  const savedFailure = this.manager.lastRouteFailure;
  let covered = true;
  try {
    covered = await this.ensureCoverage([from, to]);
  } finally {
    // Coverage may have merged a shard, nulling baseRouteInfo — restore it so the
    // planner's displayed route is untouched.
    this.manager.baseRouteInfo = savedRouteInfo;
    this.manager.lastRouteFailure = savedFailure;
  }
  if (covered === false || !this.indexedNetwork()) {
    return { geometry: [], distanceMeters: 0, failure: "no-coverage", snappedEndpoints: [] };
  }
  return this.manager.previewBaseRoute([from, to]);
}
```
In `useCyclewaysApp`, add to the returned API: `computeConnector: useCallback((from, to) => shardedRouteSessionRef.current?.computeConnector?.(from, to) ?? Promise.resolve({ geometry: [], distanceMeters: 0, failure: "no-router", snappedEndpoints: [] }), [])`.

- [ ] **Step 4:** run + `node tests/test-base-routing-shards.mjs` → PASS.
- [ ] **Step 5:** append to `package.json`; commit `feat(routing): computeConnector preserves planner route across coverage; expose via useCyclewaysApp`.

---

### Task 4: connectorTargeting (projection, last-confirmed-progress, absolute cap)

**Files:** Create `packages/core/src/navigation/connectorTargeting.js`. Create/Test `tests/test-connector-targeting.mjs` (append to `package.json`).

**Interfaces:**
- Consumes: `projectToSegment` (Task 1 export), `getDistance`.
- Produces (exported consts `APPROACH_NEAREST_MARGIN_M=300`, `REJOIN_FORWARD_WINDOW_M=1500`, `CONNECTOR_MAX_DISTANCE_M=8000`, `HANDOFF_RADIUS_M=25`, `HANDOFF_ACCURACY_FACTOR=1`):
  - `projectOntoRoute(geometry, fix, { minProgressMeters = -Infinity, maxProgressMeters = Infinity }) -> { point:{lat,lng}, progressMeters, crossTrackMeters } | null` — nearest **projected** point on the polyline within the progress window (continuous, interpolated), reusing `projectToSegment` per segment.
  - `selectConnectorTarget(navigationRoute, fix, { mode, lastConfirmedProgressMeters = 0 }) -> { point, mainProgressMeters } | null`:
    - `approach`: project over the whole route → `nearest`; if `nearest.crossTrack...`/distance saves `> APPROACH_NEAREST_MARGIN_M` vs distance to the start, target nearest, else the start (progress 0).
    - `rejoin`: project within `[lastConfirmedProgressMeters, lastConfirmedProgressMeters + REJOIN_FORWARD_WINDOW_M]`; return that point + progress; **null** if none in-window (never behind).
  - `connectorWithinCap(distanceMeters) -> boolean` = `Number.isFinite(distanceMeters) && distanceMeters <= CONNECTOR_MAX_DISTANCE_M`. (No ratio rejection.)

- [ ] **Step 1: Failing tests** (real geometry): approach far-before-start → start (progress 0); approach near far-end → nearest (progress > margin); rejoin with `lastConfirmedProgressMeters` returns a target `>=` that and `<= +window`; rejoin when off-route abreast of an already-passed loop point does NOT return a behind target (null or forward only); `connectorWithinCap(8001)` false, `connectorWithinCap(500)` true.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `projectOntoRoute` (loop segments `i..i+1`, `projectToSegment`, track min crossTrack within the progress window, interpolate progress = `geometry[i].distanceFromStartMeters + t*(seg length)`), then `selectConnectorTarget` + `connectorWithinCap`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** append to `package.json`; commit `feat(nav): projection-based connector targeting + absolute distance cap`.

---

## Phase 2 — Session connector phase (pure, orthogonal state)

> All Task 5–9 tests are direct-dispatch on `createNavigationSession` (as `tests/test-navigation-session.mjs` already does). `connector` is `{ status:"idle"|"requesting"|"active"|"failed", requestId, pendingTarget }`. `status` NEVER becomes "routing".

### Task 5: latestFix + approach/off-route → connector "requesting" (session-owned throttle + ids)

**Files:** Modify `packages/core/src/navigation/navigationSession.js`. Modify/Test `tests/test-navigation-session.mjs`.

**Interfaces:**
- Produces: `NAV_ACTIONS.CONNECTOR_READY`/`CONNECTOR_FAILED`. State adds `latestFix`, `connector` (default `{status:"idle",requestId:0,pendingTarget:null}`), and a transient `routeRequest` (`{requestId, from, to, toProgressMeters, mode}|null`, cleared like `cueEvent`). Closure tracks `lastConfirmedProgressMeters`, `lastRequestAt`, `lastRequestPos`, `requestSeq`. On a `LOCATION` fix: store `latestFix`; update `lastConfirmedProgressMeters` whenever `!offRoute && hasAcquiredRoute`. When (approaching) or (acquired AND confirmed off-route) AND `connector.status` is `idle`/`failed` AND the throttle allows: increment `requestSeq`, set `connector={status:"requesting",requestId,pendingTarget:target}`, emit `routeRequest`. **`status` stays `approaching`/`off-route`** (Phase A arrow continues). Throttle = `mayRequest(fix)` (time AND move) — except retry policy in Task 8.

- [ ] **Step 1: Failing test**: far first fix → `status==="approaching"` (NOT "routing"), `connector.status==="requesting"`, a `routeRequest` with `mode:"approach"` + `toProgressMeters`. `latestFix` stored.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement (extend the `!hasAcquiredRoute` branch to emit a request while keeping status `approaching`; add the off-route request similarly; add `CONNECTOR_READY`/`CONNECTOR_FAILED` to `NAV_ACTIONS` and `"on-connector"` to `ACTIVE`; add the transient `routeRequest` clear).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(nav): latestFix + session-owned connector request (orthogonal state, throttle, ids)`.

### Task 6: CONNECTOR_READY → active connector + on-connector; cap reject; stale drop

**Files:** session + test.
- On `CONNECTOR_READY {requestId, geometry, distanceMeters, snappedEndpoints}`: if `requestId !== connector.requestId` → ignore (stale). If `!connectorWithinCap(distanceMeters)` → `connector.status="failed"` and keep fallback status (`approaching`/`off-route`) — see retry (Task 8). Else build a connector tracker (`createRouteProgressTracker({geometry})`) + cues, `connector={status:"active",requestId,pendingTarget}`, `status="on-connector"`.
- Tests: ready → `on-connector` + connector stored; an over-cap `distanceMeters` → not on-connector, `connector.status==="failed"`, status back to fallback; a `CONNECTOR_READY` with a stale `requestId` → ignored.
- Commit `feat(nav): accept connector (cap-gated), enter on-connector; drop stale/over-cap`.

### Task 7: on-connector progress + namespaced cues + seeded handoff

**Files:** session + test.
- While `connector.status==="active"`: advance the connector tracker, set `progress`/`activeCue` from it, dedupe cue events **namespaced by `connector.requestId`** (so connector cues don't collide with main-route cues; reset the namespace on handoff). 
- **Handoff** when: `getDistance(fix, pendingTarget.point) <= HANDOFF_RADIUS_M + HANDOFF_ACCURACY_FACTOR*accuracy` **OR** the main tracker (fed the same fix) reports `hasAcquiredRoute` near `pendingTarget.mainProgressMeters`. Then: `mainTracker.seed({progressMeters: pendingTarget.mainProgressMeters, acquired:true})`, feed the fix, clear connector (`status:"idle"`), `status="navigating"`. **Do NOT** hand off on connector `remainingMeters` alone.
- Tests: progress advances on-connector; arriving within radius of the target hands off to `navigating` with main progress ≈ the seed (not 0); being far laterally but projecting onto the connector's last segment does NOT hand off.
- Commit `feat(nav): on-connector progress/cues + seeded, proximity-gated handoff`.

### Task 8: failure fallback + differentiated retry + off-connector recompute + early reacquire

**Files:** session (+ `connectorTargeting` retry consts) + test.
- `CONNECTOR_FAILED {requestId, reason}` (stale-guarded): `connector.status="failed"`; status → fallback (`approaching`/`off-route`); Phase A guidance fields stay present.
- **Differentiated retry** (when `connector.status==="failed"`): `reason==="transient"` → retry allowed after `TRANSIENT_RETRY_BASE_MS` **regardless of movement** (recovers while stationary); `reason` in `{"no-path","off-graph","no-coverage"}` or over-cap → retry only after `RECOMPUTE_MIN_MOVE_M` movement. (Add `TRANSIENT_RETRY_BASE_MS=4000`.)
- **Off-connector recompute:** while `on-connector`, if the connector tracker reports off-route (rider left the connector) beyond the dwell, request a fresh connector (new requestId) under the throttle.
- **Early main reacquire:** while `on-connector`, also run the MAIN tracker on each fix; if it reports `hasAcquiredRoute` (rider hit the route early, not at the target), hand off immediately (seed at the main tracker's current progress).
- Tests: FAILED → fallback + Phase A guidance present; transient retry fires while stationary after backoff; no-path does NOT retry while stationary; off-connector divergence triggers a new request; reaching the main route early hands off.
- Commit `feat(nav): connector failure fallback, differentiated retry, off-connector recompute, early reacquire`.

### Task 9: pause/resume restore prior phase + stop-while-requesting

**Files:** session + test.
- Track `prePauseStatus`. `PAUSE` from any active status → `paused` (store prior). `RESUME` → restore `prePauseStatus` (e.g. `on-connector`/`approaching`/`off-route`/`navigating`), not hardcoded `navigating`. While `paused`, ignore `LOCATION` for connector requests/timers.
- `STOP` while `connector.status==="requesting"`: clear the connector (`idle`) so a late `CONNECTOR_READY` (stale requestId) is ignored after stop.
- Tests: pause on-connector → resume returns `on-connector`; stop during requesting then a late CONNECTOR_READY is ignored (status stays `ended`).
- Commit `fix(nav): resume restores prior phase; stop clears in-flight connector`.

---

## Phase 3 — Replay harness (deterministic, records transitions)

### Task 10: harness stub + transition recording + end-to-end fixtures

**Files:** Modify `packages/core/src/navigation/replayRunner.js`. Modify/Test `tests/test-navigation-replay.mjs`.

**Interfaces:** `replaySession(route, fixes, { connectorRouter, controlledConnector })`:
- Default behavior records EVERY transition: after `LOCATION` dispatch, push state (this captures the `requesting` transition, status `approaching`/`off-route`); THEN if `state.routeRequest` and a `connectorRouter` is given, call it, dispatch `CONNECTOR_READY`/`CONNECTOR_FAILED` (with **computed** geometry-consistent `distanceMeters`, not 0), and push AGAIN (captures `on-connector`). So the timeline contains both transitions.
- `controlledConnector` mode: do NOT auto-pump; instead collect emitted `routeRequest`s so a test can dispatch responses in a controlled order (for stale-result tests) — exposed via the return value.

- [ ] **Step 1: Failing tests:** (a) approach end-to-end via `connectorRouter` (real distance) → timeline contains `approaching` (requesting), `on-connector`, then `navigating` (handoff), completes; (b) mid-ride off-route → rejoin → handoff; (c) controlled stale: emit two requests, answer the first AFTER the second is outstanding, assert the stale answer is ignored.
- [ ] **Step 2:** run → FAIL (no transition recorded / no controlled mode).
- [ ] **Step 3:** implement the double-push + `controlledConnector` collection; compute the stub's `distanceMeters` from its geometry via `getDistance`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `test(nav): replay records connector transitions + controlled stale + e2e approach/rejoin`.

---

## Phase 4 — Native wiring (bundle-checked; device pass in Task 13)

### Task 11: hook runs async compute only (no throttle/ids)

**Files:** Modify `apps/mobile/src/navigation/useNavigationSession.js`.
- New option `computeConnector` (the `useCyclewaysApp` capability; in tests/sim a stub). An effect keyed on `state.routeRequest?.requestId`: capture `req`, call `computeConnector(req.from, req.to)`, and on resolve dispatch `CONNECTOR_READY {requestId:req.requestId, geometry, distanceMeters, snappedEndpoints}` or `CONNECTOR_FAILED {requestId:req.requestId, reason: res.failure}`; map thrown errors to `reason:"transient"`. The hook does NO throttling/id-generation/staleness (the session owns those; it ignores stale requestIds).
- Gate: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nav-connector-11` → EXIT 0.
- Commit `feat(mobile): hook runs connector compute on routeRequest (session owns ids/throttle)`.

### Task 12: MapScreen — latestFix source, dashed line, status consumers, geometry switch, camera; presentation

**Files:** Modify `apps/mobile/src/MapScreen.jsx`, `packages/core/src/navigation/navigationPresentation.js`; pass `computeConnector` from `useCyclewaysApp` into `useNavigationSession`. Modify/Test `tests/test-navigation-presentation.mjs`.
- **Position source:** use `nav.state.latestFix` as the sole rider/off-route position (replace `rawFixRef = locationState.point`), so simulated fixes move the puck.
- **Status consumers:** add `"on-connector"` to `isNavigating`; presentation treats `on-connector` as cue-bearing; add `onConnector` + `connectorContextText` ("מסלול חיבור — לכיוון המסלול") to `getNavigationPresentation` (node-tested).
- **Active geometry switch:** when `status==="on-connector"` the RAF puck/camera use the connector geometry+arc (memo over `connector.geometry`); on switch (main↔connector, detected by `connector.requestId` change) reset `smoothedMetersRef`/`travelIndexRef`/`smoothedBearingRef`/`lastPushedPuckRef`/`lastApproachFitRef`.
- **Dashed line:** render `connector.geometry` as a dashed `LineLayer`. On-connector camera = tight follow; approach fit-view only while no connector active.
- Presentation TDD first (`onConnector`, `connectorContextText`), then native; gate: `npx expo export --platform ios --output-dir /tmp/nav-connector-12` → EXIT 0.
- Commit `feat(mobile): connector rendering, latestFix position source, on-connector camera/cues`.

---

## Phase 5 — Acceptance

### Task 13: Real device/simulator acceptance gate

**Files:** add `plans/turn-by-turn-rejoin-routing/acceptance.md` (checklist); run full suite + export.
- [ ] `npm test` → all green. `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nav-connector-final` → EXIT 0.
- [ ] **Device/simulator acceptance** (via the dev simulate-ride + a real ride): (1) approach connector appears (dashed) and guides to start; (2) mid-ride off-route → connector rejoin, no instruction thrash; (3) routing failure (off-grid) → Phase A arrow, recovers on movement; (4) recompute when leaving the connector; (5) early reacquire when cutting to the route; (6) pause/resume restores the phase; stop mid-request is clean; (7) loop/out-and-back handoff lands at the right progress (not a wrong branch). Record results in `acceptance.md`.
- [ ] Only after acceptance: mark `design.md` implemented. Commit.

## Deferred (future)
- Multi-candidate targeting (route several candidates, pick by measured cost).
- On-device tuning of all constants; a real-ride rejoin fixture via the dev recorder.
- Voice/TTS connector cues, background location, Android, junction-vs-bend classification.
