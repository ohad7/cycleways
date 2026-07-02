# Approach-to-Route Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implemented Phase B turn-by-turn connector with non-narrated **approach guidance**: turn-by-turn only on the vetted route; within ~1 km a suggested (road-preferring) connector + direct line + distance/progress + disclaimer + "Open in Waze/Google Maps"; beyond ~1 km or off coverage, the external-app handoff is the primary action. Adds an explicit start-vs-join-here target prompt.

**Architecture:** Pure logic stays in `@cycleways/core` (node-tested). The connector is computed by the existing non-mutating `ShardedRouteSession.computeConnector` → `previewBaseRoute`, now with a **road-preferring cost profile**. The navigation session loses its connector *navigation* phase (no `on-connector` status, no connector tracker/cues, no seeded handoff, no recompute hysteresis): it keeps the main route's acquisition logic and gains an **approach slot** (chosen target + a single best-effort suggestion geometry + a direct-line distance). The main tracker acquires the route wherever the rider physically reaches it — "handoff" is just acquisition. The native hook runs the one async compute; MapScreen renders the direct line + dashed suggestion; NavPanel shows the disclaimer, the start-vs-join prompt, and the external-app buttons.

**Tech Stack:** Node ESM, `node:assert/strict` tests, `@cycleways/core`, React Native + `@rnmapbox/maps`, `react-native` `Linking`, the on-device `ShardedRouteSession` graph.

## Global Constraints

- **Test runner:** new pure tests are standalone `node tests/test-<name>.mjs` (import `node:assert/strict`, import core via `@cycleways/core/...`), appended to the `"test"` chain in `package.json` immediately before `&& cd tests && node test-route-manager.js`.
- **No planner mutation:** connector computation must NOT change the planner's active route. `computeConnector` already preserves `manager.baseRouteInfo` + `lastRouteFailure` across `ensureCoverage`. The road-preference profile must be a transient flag cleared in a `finally`, never left set on the manager. The existing mutation-regression test must keep passing.
- **Router input:** never call `_calculateBaseRoute` with raw GPS; raw points are snapped first by `previewBaseRoute`.
- **Guidance, not navigation:** the suggested connector is drawn but NEVER narrated — no maneuver cues, no haptics, no voice, no follow-camera bound to it, no progress-based handoff. The only transition into `navigating` is the main tracker physically acquiring the route.
- **Single rider-position source:** the session stores `latestFix`; the puck/direct-line/distance derive from it.
- **Distance frame:** geometry haversine (`distanceFromStartMeters`), as Phase A. The "distance to route" readout is the straight-line `getDistance(fix, target.point)` (honest spatial distance), NOT the connector length.
- **Copy:** Hebrew/RTL, matching existing NavPanel strings. **Foreground-only.** Dev-only code stays `__DEV__`-gated.
- **Tuning constants** are named exported consts with these defaults (tuned later in the simulate-ride harness): `CONNECTOR_NEAR_RADIUS_M = 1000`, `JOIN_SKIP_PROMPT_M = 1500`. Reused unchanged: `REJOIN_FORWARD_WINDOW_M = 1500`. Road-preference multipliers per Task 1.
- **Acceptance:** a clean iOS bundle export is NOT "implemented" — the device/simulator acceptance pass (Task 12) is required.

---

## File Structure

**Core (node-tested):**
- `packages/core/route-manager.js` — add a road-preferring connector cost profile to `previewBaseRoute` (Task 1).
- `packages/core/src/routing/shardedRouteSession.js` — pass the connector profile through `computeConnector` (Task 1).
- `packages/core/src/navigation/connectorTargeting.js` — keep `projectOntoRoute` / `selectConnectorTarget` (rejoin); add `approachTargetChoices` + `JOIN_SKIP_PROMPT_M` + `CONNECTOR_NEAR_RADIUS_M`; remove dead handoff/recompute consts (Tasks 2, 9).
- `packages/core/src/navigation/externalNav.js` — **new**, pure builder for Google Maps (cycling) + Waze (car) deep links (Task 3).
- `packages/core/src/navigation/navigationSession.js` — strip the connector navigation phase; add the approach slot + `SET_APPROACH_TARGET` (Task 4).
- `packages/core/src/navigation/navigationPresentation.js` — drop `on-connector`; add approach/disclaimer/external-nav/prompt presentation (Task 5).

**Native (verified on device, not node-tested):**
- `apps/mobile/src/navigation/useNavigationSession.js` — simplify request effect; expose `setApproachTarget` (Task 6).
- `apps/mobile/src/MapScreen.jsx` — direct-line layer + dashed suggestion (near tier only); drop `on-connector` camera/geometry switching (Task 7).
- `apps/mobile/src/planner/NavPanel.jsx` — disclaimer, start-vs-join prompt, external-app buttons via `Linking` (Task 8).

**Tests:** `tests/test-preview-base-route.mjs`, `tests/test-compute-connector.mjs`, `tests/test-connector-targeting.mjs`, `tests/test-external-nav.mjs` (new), `tests/test-navigation-session.mjs`, `tests/test-navigation-replay.mjs`, `tests/test-navigation-presentation.mjs`.

---

### Task 1: Road-preferring connector cost profile

**Files:**
- Modify: `packages/core/route-manager.js` (`previewBaseRoute` ~254, `_baseRoutingCostMultiplier` ~1043, constructor base-routing fields)
- Modify: `packages/core/src/routing/shardedRouteSession.js:296`
- Test: `tests/test-preview-base-route.mjs`, `tests/test-compute-connector.mjs`

**Interfaces:**
- Produces: `previewBaseRoute(points, { costProfile } = {})` where `costProfile === "connector"` prefers public roads. Same `{ geometry, distanceMeters, failure, snappedEndpoints }` return.
- Consumes (Task 4 via hook): `computeConnector(from, to)` unchanged signature; internally uses the connector profile.

The planner's default multiplier deliberately *penalizes* roads (`road = 4`) to favor cycling. The connector wants the opposite. Implement as a transient profile flag on the manager so the Dijkstra inner loop needs no new parameter threading.

- [ ] **Step 1: Write the failing test**

Append to `tests/test-preview-base-route.mjs`, reusing that file's existing fixture manager/points:

```js
const conn = manager.previewBaseRoute([fromPoint, toPoint], { costProfile: "connector" });
assert.equal(conn.failure, null);
assert.ok(conn.geometry.length >= 2);
assert.equal(manager._connectorCostProfile, false); // transient flag cleared
```

If the file's fixture has a road edge parallel to a path edge, additionally assert the connector route uses the road; otherwise the above (route succeeds + flag cleared) is the minimum gate.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-preview-base-route.mjs`
Expected: FAIL (`_connectorCostProfile` undefined / 2nd arg ignored).

- [ ] **Step 3: Implement the profile**

Constructor (near other base-routing fields): `this._connectorCostProfile = false;`

Replace `previewBaseRoute(points)` with the options form, toggling the flag in a `try/finally`:

```js
previewBaseRoute(points, { costProfile = "default" } = {}) {
  const snapped = this._snapRoutePoints(points);
  const snappedEndpoints =
    snapped.length >= 2 ? [snapped[0], snapped[snapped.length - 1]] : snapped;
  if (snapped.length < 2 || snapped.some((point) => point.unsnapped)) {
    return { geometry: [], distanceMeters: 0, failure: "snap-failed", snappedEndpoints };
  }
  if (!this.baseRoutingNetwork) {
    return { geometry: [], distanceMeters: 0, failure: "no-base-network", snappedEndpoints };
  }
  this._connectorCostProfile = costProfile === "connector";
  let route;
  try {
    route = this._calculateBaseRoute(snapped);
  } finally {
    this._connectorCostProfile = false;
  }
  if (route.failure || !Array.isArray(route.orderedCoordinates) || route.orderedCoordinates.length < 2) {
    return { geometry: [], distanceMeters: 0, failure: route.failure || "no-path", snappedEndpoints };
  }
  return {
    geometry: route.orderedCoordinates.map((c) => ({ lat: c.lat, lng: c.lng })),
    distanceMeters: route.distance || 0,
    failure: null,
    snappedEndpoints,
  };
}
```

Add a connector multiplier and branch `_baseRoutingCostMultiplier`:

```js
_connectorCostMultiplierFor(edge) {
  // Connector = reliable public roads cheap; uncertain paths/tracks expensive.
  if (edge.routeClass === "road" || edge.roadType === "road") return 1;
  if (edge.routeClass === "local_road") return 1.1;
  if (edge.routeClass === "cycle") return 1.3;
  if (edge.cwSegmentIds.length > 0) return 1.4;
  if (edge.routeClass === "path_track" || edge.routeClass === "manual") return 3;
  if (edge.routeClass === "footway") return 3.5;
  return 2.5;
}

_baseRoutingCostMultiplier(edge) {
  if (this._connectorCostProfile) return this._connectorCostMultiplierFor(edge);
  if (edge.cwSegmentIds.length > 0) return 1;
  if (edge.routeClass === "cycle") return 1.35;
  if (edge.routeClass === "path_track" || edge.routeClass === "manual") return 1.6;
  if (edge.routeClass === "local_road") return 2.2;
  if (edge.routeClass === "road" || edge.roadType === "road") return 4;
  return 2.5;
}
```

In `shardedRouteSession.js:296`:

```js
return this.manager.previewBaseRoute([from, to], { costProfile: "connector" });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-preview-base-route.mjs && node tests/test-compute-connector.mjs`
Expected: PASS (compute-connector's non-mutation + failure paths unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/core/route-manager.js packages/core/src/routing/shardedRouteSession.js tests/test-preview-base-route.mjs
git commit -m "feat(nav): road-preferring connector cost profile"
```

---

### Task 2: Approach target choices (start vs join-here) + near-tier constant

**Files:**
- Modify: `packages/core/src/navigation/connectorTargeting.js`
- Test: `tests/test-connector-targeting.mjs`

**Interfaces:**
- Produces:
  - `export const CONNECTOR_NEAR_RADIUS_M = 1000;`
  - `export const JOIN_SKIP_PROMPT_M = 1500;`
  - `export function approachTargetChoices(navigationRoute, fix)` → `null` or
    `{ start: { point, mainProgressMeters: 0, distanceMeters }, nearest: { point, mainProgressMeters, distanceMeters }, skipMeters, shouldPrompt }`. `distanceMeters` is straight-line rider→point; `skipMeters = nearest.mainProgressMeters`; `shouldPrompt = skipMeters >= JOIN_SKIP_PROMPT_M`.
- Consumes: existing `projectOntoRoute`, `getDistance`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test-connector-targeting.mjs`:

```js
import {
  approachTargetChoices,
  JOIN_SKIP_PROMPT_M,
} from "@cycleways/core/navigation/connectorTargeting.js";

const route = { geometry: [
  { lat: 32.0, lng: 35.000, distanceFromStartMeters: 0 },
  { lat: 32.0, lng: 35.020, distanceFromStartMeters: 2000 },
] };

const far = approachTargetChoices(route, { lat: 32.001, lng: 35.019 });
assert.equal(far.start.mainProgressMeters, 0);
assert.ok(far.nearest.mainProgressMeters > JOIN_SKIP_PROMPT_M);
assert.equal(far.shouldPrompt, true);

const near = approachTargetChoices(route, { lat: 32.001, lng: 35.001 });
assert.equal(near.shouldPrompt, false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-connector-targeting.mjs`
Expected: FAIL (`approachTargetChoices` not exported).

- [ ] **Step 3: Implement**

```js
export const CONNECTOR_NEAR_RADIUS_M = 1000;
export const JOIN_SKIP_PROMPT_M = 1500;

export function approachTargetChoices(navigationRoute, fix) {
  const geometry = Array.isArray(navigationRoute?.geometry) ? navigationRoute.geometry : [];
  if (geometry.length < 2 || !fix) return null;
  const startVertex = geometry[0];
  const start = {
    point: { lat: startVertex.lat, lng: startVertex.lng },
    mainProgressMeters: 0,
    distanceMeters: getDistance(fix, startVertex),
  };
  const projection = projectOntoRoute(geometry, fix);
  if (!projection) return null;
  const nearest = {
    point: projection.point,
    mainProgressMeters: projection.progressMeters,
    distanceMeters: getDistance(fix, projection.point),
  };
  const skipMeters = Math.max(0, projection.progressMeters);
  return { start, nearest, skipMeters, shouldPrompt: skipMeters >= JOIN_SKIP_PROMPT_M };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-connector-targeting.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/connectorTargeting.js tests/test-connector-targeting.mjs
git commit -m "feat(nav): approach target choices (start vs join-here)"
```

---

### Task 3: External-app deep links (Google Maps cycling, Waze car)

**Files:**
- Create: `packages/core/src/navigation/externalNav.js`
- Create test: `tests/test-external-nav.mjs`
- Modify: `package.json` (append the test to the chain)

**Interfaces:**
- Produces: `export function buildExternalNavLinks(point)` → `null` or `{ googleMaps, waze }` for `point = { lat, lng }`. Google Maps universal directions URL in **bicycling** mode; Waze universal URL with **navigate=yes** (car).

- [ ] **Step 1: Write the failing test**

Create `tests/test-external-nav.mjs`:

```js
import assert from "node:assert/strict";
import { buildExternalNavLinks } from "@cycleways/core/navigation/externalNav.js";

assert.equal(buildExternalNavLinks(null), null);
assert.equal(buildExternalNavLinks({ lat: NaN, lng: 1 }), null);

const links = buildExternalNavLinks({ lat: 32.123456, lng: 35.654321 });
assert.match(links.googleMaps, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
assert.match(links.googleMaps, /destination=32\.123456%2C35\.654321/);
assert.match(links.googleMaps, /travelmode=bicycling/);
assert.match(links.waze, /^https:\/\/waze\.com\/ul\?/);
assert.match(links.waze, /ll=32\.123456%2C35\.654321/);
assert.match(links.waze, /navigate=yes/);

console.log("external-nav ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-external-nav.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/core/src/navigation/externalNav.js`:

```js
// Pure builders for handing the approach leg off to a dedicated navigation app.
// Universal https links so the OS opens the installed app (else web/App Store).
// Google Maps in bicycling mode; Waze in its (car-only) navigate mode.

function valid(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
}

export function buildExternalNavLinks(point) {
  if (!valid(point)) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  const dest = `${lat}%2C${lng}`;
  return {
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=bicycling`,
    waze: `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-external-nav.mjs`
Expected: PASS (`external-nav ok`).

- [ ] **Step 5: Append to the test chain**

In `package.json` `"test"`, insert `&& node tests/test-external-nav.mjs` immediately before `&& cd tests && node test-route-manager.js`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/externalNav.js tests/test-external-nav.mjs package.json
git commit -m "feat(nav): external-app deep links (Google Maps cycling, Waze car)"
```

---

### Task 4: Session — replace connector navigation with the approach slot

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Test: `tests/test-navigation-session.mjs`, `tests/test-navigation-replay.mjs`

**Interfaces:**
- Produces (state shape changes):
  - **Removed:** `"on-connector"` status; the `connector` navigation slot; connector tracker/cues; seeded handoff; recompute hysteresis fields.
  - **Added** `approach` slot:
    ```js
    approach: {
      target: { point, mainProgressMeters, mode } | null,
      choices: { start, nearest, skipMeters, shouldPrompt } | null,
      suggestionGeometry: [{lat,lng,distanceFromStartMeters}] | null,
      suggestionStatus: "idle" | "requesting" | "ready" | "failed",
      distanceToRouteMeters: number | null,
    }
    ```
  - `routeRequest` stays `{ requestId, from, to }`.
  - New action `NAV_ACTIONS.SET_APPROACH_TARGET` with `{ choice: "start" | "nearest" }`.
  - `CONNECTOR_READY` / `CONNECTOR_FAILED` retained but only populate `approach.suggestionGeometry` / `suggestionStatus` (never enter a navigation phase).
- Consumes: `approachTargetChoices`, `selectConnectorTarget` (rejoin only), `buildNavigationGeometry`, `getDistance`.

Behaviour:
1. `ACTIVE = new Set(["navigating", "off-route", "approaching"])`.
2. `LOCATION` while **not acquired** (`approaching`): compute `choices = approachTargetChoices(route, fix)`; if `approach.target` is null default it to `choices.start` (mode `"approach"`); set `distanceToRouteMeters = getDistance(fix, approach.target.point)`; if `suggestionStatus === "idle"` and `shouldRequest(fix)` (no prior request, or moved ≥ 200 m since last), emit one `routeRequest` to the target and set `suggestionStatus = "requesting"`; keep `status = "approaching"`.
3. `LOCATION` while **acquired and off-route**: target via `selectConnectorTarget(..., mode:"rejoin")`; drives `approach.target` + a single best-effort `routeRequest`; no prompt, no `on-connector`.
4. `LOCATION` while **acquired and on-route**: `approach = emptyApproach()`, `routeRequest = null`, behave as Phase A `navigating` (main cues unchanged).
5. `CONNECTOR_READY` (matching `requestId`): build geometry; ≥2 pts → `suggestionGeometry` + `suggestionStatus = "ready"`, else `"failed"`. Never changes `status`. (No distance-cap rejection; an over-cap suggestion may simply be dropped to `"failed"`.)
6. `CONNECTOR_FAILED`: `suggestionStatus = "failed"`, `suggestionGeometry = null`. Direct line + distance remain.
7. `SET_APPROACH_TARGET`: set `approach.target` to `choices.start`/`choices.nearest` (mode `"approach"`), reset `suggestionStatus = "idle"`, `suggestionGeometry = null` → fresh `routeRequest` next `LOCATION`.
8. **Acquisition is the only handoff:** `mainProgress.hasAcquiredRoute && !offRoute` → `navigating`, clear approach. No `tracker.seed`.
9. `PAUSE`/`RESUME`: `RESUME` restores `prePauseStatus`; approach slot persists across pause.
10. `PERMISSION_GRANTED`/`STOP`/`ERROR`: clear approach + `routeRequest`.

- [ ] **Step 1: Write failing tests**

In `tests/test-navigation-session.mjs` replace connector-navigation assertions with:

```js
const s = createNavigationSession(route);
s.dispatch({ type: NAV_ACTIONS.START });
s.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED });
s.dispatch({ type: NAV_ACTIONS.LOCATION, fix: farFromStartFix });
let st = s.getState();
assert.equal(st.status, "approaching");
assert.ok(st.approach.choices);
assert.equal(st.approach.target.mode, "approach");
assert.equal(st.approach.suggestionStatus, "requesting");
assert.ok(st.routeRequest && st.routeRequest.to);
assert.ok(Number.isFinite(st.approach.distanceToRouteMeters));

s.dispatch({ type: NAV_ACTIONS.CONNECTOR_READY, requestId: st.routeRequest.requestId,
  geometry: connectorGeom, distanceMeters: 800, snappedEndpoints: [] });
st = s.getState();
assert.equal(st.status, "approaching");
assert.equal(st.approach.suggestionStatus, "ready");
assert.ok(st.approach.suggestionGeometry.length >= 2);

s.dispatch({ type: NAV_ACTIONS.SET_APPROACH_TARGET, choice: "nearest" });
st = s.getState();
assert.equal(st.approach.suggestionStatus, "idle");
assert.equal(st.approach.suggestionGeometry, null);

s.dispatch({ type: NAV_ACTIONS.LOCATION, fix: onRouteFix });
st = s.getState();
assert.equal(st.status, "navigating");
assert.equal(st.approach.target, null);
```

Add a `CONNECTOR_FAILED` case (status stays `approaching`, `suggestionStatus:"failed"`) and assert no state ever equals `"on-connector"`. In `tests/test-navigation-replay.mjs` replace the connector-handoff scenario with: far start → suggestion → physically reaches route → `navigating` at the main-route progress (no seeded jump).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL (no `approach` slot / `SET_APPROACH_TARGET`).

- [ ] **Step 3: Implement the rewrite**

- Imports: drop `HANDOFF_*`, `RECOMPUTE_*`, `TRANSIENT_RETRY_BASE_MS`, `connectorWithinCap`; add `approachTargetChoices`.
- `NAV_ACTIONS.SET_APPROACH_TARGET = "SET_APPROACH_TARGET"`.
- `const ACTIVE = new Set(["navigating", "off-route", "approaching"]);`
- Replace `EMPTY_CONNECTOR`/`connectorState` with `emptyApproach()`:

```js
function emptyApproach() {
  return { target: null, choices: null, suggestionGeometry: null, suggestionStatus: "idle", distanceToRouteMeters: null };
}
```

- Remove `connectorTracker`, `connectorCues`, `connectorCueKey`, `updateConnector`, `handoffAtTarget`, `handoffAtMainProgress`, `clearConnector`, and the recompute gate; add:

```js
let lastRequestPos = null;
function shouldRequest(fix) {
  if (lastRequestPos === null) return true;
  return getDistance(lastRequestPos, fix) >= 200;
}
function requestSuggestion(fix, target, fallbackStatus, extra = {}) {
  requestSeq += 1;
  lastRequestPos = fixPoint(fix);
  return set({
    status: fallbackStatus,
    routeRequest: { requestId: requestSeq, from: fixPoint(fix), to: target.point },
    approach: { ...state.approach, target: { ...target, mode: target.mode || "approach" }, suggestionStatus: "requesting", suggestionGeometry: null },
    ...extra,
  });
}
```

- Rewrite `LOCATION` per the behaviour list (keep `mainTracker.update`, acquisition test, off-route `{kind:"off-route"}` cue, and main cues identical to Phase A).
- Rewrite `CONNECTOR_READY`/`CONNECTOR_FAILED` to only touch `approach` (guard `action.requestId === state.routeRequest?.requestId` and `state.status !== "paused"`).
- Add `SET_APPROACH_TARGET`: pick from `state.approach.choices`, set target + reset suggestion, `lastRequestPos = null` (force a fresh request next fix).
- Update `PERMISSION_GRANTED`/`STOP`/`ERROR`/`PAUSE`/`RESUME` to reset/preserve `approach` instead of `connector`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-replay.mjs && node tests/test-route-progress.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs tests/test-navigation-replay.mjs
git commit -m "feat(nav): approach slot replaces connector navigation phase"
```

---

### Task 5: Presentation — approach/disclaimer/external-nav/prompt

**Files:**
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Test: `tests/test-navigation-presentation.mjs`

**Interfaces:**
- Produces new fields on `getNavigationPresentation(state)`:
  - `showApproach` (status `approaching` or `off-route`).
  - `tier: "near" | "far"` from `approach.distanceToRouteMeters` vs `CONNECTOR_NEAR_RADIUS_M` (null → `"far"`).
  - `approachDistanceText` e.g. `"600 מ׳ למסלול"`.
  - `disclaimerText: "ניווט מחוץ לרשת CycleWays"`.
  - `showExternalNav` (true in both tiers), `externalNavPrimary` (`tier === "far"`), `externalNavTarget` (`approach.target.point` or null).
  - `showJoinPrompt` (`status === "approaching" && approach.choices?.shouldPrompt`), `joinPrompt: { startText, nearestText } | null`.
- **Removed:** `onConnector`, `connectorContextText`, and the `on-connector` branch in `showContext`/`contextText`.

- [ ] **Step 1: Write failing tests**

In `tests/test-navigation-presentation.mjs`:

```js
import { CONNECTOR_NEAR_RADIUS_M } from "@cycleways/core/navigation/connectorTargeting.js";

const near = getNavigationPresentation({
  status: "approaching",
  approach: { target: { point: { lat: 32, lng: 35 } }, distanceToRouteMeters: 600,
    choices: { skipMeters: 1500, shouldPrompt: true } },
});
assert.equal(near.showApproach, true);
assert.equal(near.tier, "near");
assert.equal(near.externalNavPrimary, false);
assert.match(near.approachDistanceText, /למסלול/);
assert.equal(near.disclaimerText, "ניווט מחוץ לרשת CycleWays");
assert.equal(near.showJoinPrompt, true);
assert.ok(near.joinPrompt.nearestText.includes("דילוג"));

const far = getNavigationPresentation({
  status: "approaching",
  approach: { target: { point: { lat: 32, lng: 35 } }, distanceToRouteMeters: 4000, choices: null },
});
assert.equal(far.tier, "far");
assert.equal(far.externalNavPrimary, true);
assert.equal(far.showJoinPrompt, false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-presentation.mjs`
Expected: FAIL (fields undefined).

- [ ] **Step 3: Implement**

```js
import { CONNECTOR_NEAR_RADIUS_M } from "./connectorTargeting.js";
// inside getNavigationPresentation:
const approach = state.approach || null;
const showApproach = status === "approaching" || offRoute;
const distanceToRoute = Number(approach?.distanceToRouteMeters);
const tier = Number.isFinite(distanceToRoute) && distanceToRoute <= CONNECTOR_NEAR_RADIUS_M ? "near" : "far";
const choices = approach?.choices || null;
```

In the returned object replace the connector lines with:

```js
showApproach,
tier,
approachDistanceText: Number.isFinite(distanceToRoute) ? `${formatDistanceMeters(distanceToRoute)} למסלול` : "",
disclaimerText: "ניווט מחוץ לרשת CycleWays",
showExternalNav: showApproach,
externalNavPrimary: tier === "far",
externalNavTarget: approach?.target?.point ?? null,
showJoinPrompt: status === "approaching" && choices?.shouldPrompt === true,
joinPrompt: choices?.shouldPrompt
  ? { startText: "התחל מתחילת המסלול", nearestText: `הצטרף כאן (דילוג ~${formatDistanceMeters(choices.skipMeters)})` }
  : null,
```

Drop the `onConnector` cases from `showContext`/`contextText` (keep the acquired-main-route context only).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-presentation.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationPresentation.js tests/test-navigation-presentation.mjs
git commit -m "feat(nav): approach/disclaimer/external-nav presentation"
```

---

### Task 6: Hook — expose setApproachTarget

**Files:**
- Modify: `apps/mobile/src/navigation/useNavigationSession.js`

**Interfaces:**
- Produces: hook return adds `setApproachTarget(choice)` → dispatches `SET_APPROACH_TARGET`. The existing request effect already runs `computeConnector(from,to)` → `CONNECTOR_READY`/`CONNECTOR_FAILED`; it now only fills the suggestion.

- [ ] **Step 1: Add the callback + return it**

After `userPanned`:

```js
const setApproachTarget = useCallback(
  (choice) => dispatch({ type: NAV_ACTIONS.SET_APPROACH_TARGET, choice }),
  [dispatch],
);
```

Add `setApproachTarget` to the returned object.

- [ ] **Step 2: Babel-parse check**

Run: `npx babel apps/mobile/src/navigation/useNavigationSession.js --config-file ./apps/mobile/babel.config.js -o /dev/null`
Expected: no error. (Confirm the exact babel config path under `apps/mobile/`.)

- [ ] **Step 3: Run the core suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/navigation/useNavigationSession.js
git commit -m "feat(mobile): expose setApproachTarget"
```

---

### Task 7: MapScreen — direct line + dashed suggestion, drop on-connector switching

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `nav.state.approach.{ target, suggestionGeometry }`, `nav.state.latestFix`, presentation `tier`.
- Removes `onConnector` geometry/camera switching (puck/camera always ride the main route; the suggestion is a static overlay).

- [ ] **Step 1: Remove the connector geometry switching**

Delete the `onConnector` block (~853–863) and the `connectorRouteGeometry` memo (~864–870). Set `navGeometry = routeState.geometry` and `activeGeometryKey = "main"`. In the smoothing reset effect (~918) change `onConnector ? 0 : navProgress?.progressMeters ?? 0` → `navProgress?.progressMeters ?? 0`. Remove `|| navStatusRef.current === "on-connector"` from the camera follow test (~1044).

- [ ] **Step 2: Add nav presentation + the two overlay sources**

If not already present, add near the other nav derivations and import `getNavigationPresentation`:

```jsx
const navPresentation = useMemo(() => getNavigationPresentation(nav.state), [nav.state]);
```

Then:

```jsx
const approach = nav.state?.approach ?? null;
const latestFix = nav.state?.latestFix ?? null;
const approachTargetPoint = approach?.target?.point ?? null;
const showApproachLines = navStatus === "approaching" || navStatus === "off-route";

const directLineGeometry = useMemo(() => {
  if (!showApproachLines || !latestFix || !approachTargetPoint) return EMPTY_FEATURE_COLLECTION;
  return { type: "FeatureCollection", features: [{
    type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: [
      [latestFix.lng, latestFix.lat],
      [approachTargetPoint.lng, approachTargetPoint.lat],
    ] } }] };
}, [showApproachLines, latestFix?.lat, latestFix?.lng, approachTargetPoint?.lat, approachTargetPoint?.lng]);

const suggestionGeometry = approach?.suggestionGeometry;
const showSuggestion = showApproachLines && navPresentation.tier === "near" &&
  Array.isArray(suggestionGeometry) && suggestionGeometry.length >= 2;
const suggestionFeature = useMemo(
  () => (Array.isArray(suggestionGeometry) && suggestionGeometry.length >= 2
    ? buildRouteGeometryFeatureCollection(suggestionGeometry) : EMPTY_FEATURE_COLLECTION),
  [suggestionGeometry],
);
```

- [ ] **Step 3: Replace the connector ShapeSource render (~1281–1285)**

```jsx
{showApproachLines ? (
  <ShapeSource id="approach-direct" shape={directLineGeometry}>
    <LineLayer id="approach-direct-line" style={APPROACH_DIRECT_LINE_STYLE} />
  </ShapeSource>
) : null}
{showSuggestion ? (
  <ShapeSource id="approach-suggestion" shape={suggestionFeature}>
    <LineLayer id="approach-suggestion-line" style={APPROACH_SUGGESTION_LINE_STYLE} />
  </ShapeSource>
) : null}
```

Replace `CONNECTOR_LINE_STYLE` with:

```js
const APPROACH_DIRECT_LINE_STYLE = { lineColor: "#6b7280", lineWidth: 2, lineOpacity: 0.6, lineDasharray: [1, 2] };
const APPROACH_SUGGESTION_LINE_STYLE = { lineColor: "#2563eb", lineWidth: 4, lineOpacity: 0.9, lineDasharray: [2, 1.5] };
```

- [ ] **Step 4: Babel-parse check**

Run: `npx babel apps/mobile/src/MapScreen.jsx --config-file ./apps/mobile/babel.config.js -o /dev/null`
Expected: no error.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): direct line + dashed suggestion; drop on-connector switching"
```

---

### Task 8: NavPanel — disclaimer, start-vs-join prompt, external-app buttons

**Files:**
- Modify: `apps/mobile/src/planner/NavPanel.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx` (pass `onSetApproachTarget`)

**Interfaces:**
- Consumes presentation: `showApproach`, `approachDistanceText`, `disclaimerText`, `showExternalNav`, `externalNavPrimary`, `externalNavTarget`, `showJoinPrompt`, `joinPrompt`.
- Uses `Linking` + `buildExternalNavLinks`; calls `onSetApproachTarget("start"|"nearest")`.

- [ ] **Step 1: Imports + props + helper**

```jsx
import { Linking } from "react-native";
import { buildExternalNavLinks } from "@cycleways/core/navigation/externalNav.js";
```

Add `onSetApproachTarget` to props. Above `return`:

```jsx
function openExternal(point, app) {
  const links = buildExternalNavLinks(point);
  if (!links) return;
  Linking.openURL(links[app]).catch(() => {});
}
```

- [ ] **Step 2: Render the approach block** (inside the banner, after the cue/guidance rows)

```jsx
{p.showApproach ? (
  <View style={styles.approach}>
    {p.approachDistanceText ? <Text style={styles.approachDistance}>{p.approachDistanceText}</Text> : null}
    <Text style={styles.disclaimer} numberOfLines={2}>{p.disclaimerText}</Text>
    {p.showJoinPrompt ? (
      <View style={styles.promptRow}>
        <Pressable style={styles.promptBtn} onPress={() => onSetApproachTarget?.("start")}>
          <Text style={styles.promptText}>{p.joinPrompt.startText}</Text>
        </Pressable>
        <Pressable style={styles.promptBtn} onPress={() => onSetApproachTarget?.("nearest")}>
          <Text style={styles.promptText}>{p.joinPrompt.nearestText}</Text>
        </Pressable>
      </View>
    ) : null}
    {p.showExternalNav && p.externalNavTarget ? (
      <View style={styles.extRow}>
        <Pressable style={[styles.extBtn, p.externalNavPrimary ? styles.extPrimary : null]} onPress={() => openExternal(p.externalNavTarget, "waze")}>
          <Text style={styles.extText}>Waze</Text>
        </Pressable>
        <Pressable style={[styles.extBtn, p.externalNavPrimary ? styles.extPrimary : null]} onPress={() => openExternal(p.externalNavTarget, "googleMaps")}>
          <Text style={styles.extText}>Google Maps</Text>
        </Pressable>
      </View>
    ) : null}
  </View>
) : null}
```

Add styles `approach`, `approachDistance`, `disclaimer`, `promptRow`, `promptBtn`, `promptText`, `extRow`, `extBtn`, `extPrimary`, `extText` following the existing RTL conventions (`flexDirection: "row-reverse"`, `writingDirection: "rtl"`, `textAlign: "right"`, `palette`/`space`/`radius`).

- [ ] **Step 3: Wire the prop in MapScreen**

At the `<NavPanel ... />` render, add `onSetApproachTarget={nav.setApproachTarget}`.

- [ ] **Step 4: Babel-parse check**

Run: `npx babel apps/mobile/src/planner/NavPanel.jsx --config-file ./apps/mobile/babel.config.js -o /dev/null && npx babel apps/mobile/src/MapScreen.jsx --config-file ./apps/mobile/babel.config.js -o /dev/null`
Expected: no error.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/planner/NavPanel.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): approach disclaimer, join prompt, external-app buttons"
```

---

### Task 9: Remove dead connector-navigation code + constants

**Files:**
- Modify: `packages/core/src/navigation/connectorTargeting.js`
- Modify: `tests/test-connector-targeting.mjs`, `tests/test-compute-connector.mjs`
- Grep-modify any remaining references.

- [ ] **Step 1: Find remaining references**

Run: `grep -rnE "APPROACH_NEAREST_MARGIN_M|CONNECTOR_MAX_DISTANCE_M|RECOMPUTE_MIN_|TRANSIENT_RETRY_BASE_MS|HANDOFF_|connectorWithinCap|on-connector|onConnector|connectorContextText" packages apps tests | grep -v node_modules`
Expected: only definitions + tests asserting them.

- [ ] **Step 2: Remove the dead exports + assertions**

Delete the unused consts and `connectorWithinCap` from `connectorTargeting.js`. Keep `projectOntoRoute`, `selectConnectorTarget`, `REJOIN_FORWARD_WINDOW_M`, `approachTargetChoices`, `CONNECTOR_NEAR_RADIUS_M`, `JOIN_SKIP_PROMPT_M`. Remove their assertions from the tests; update `test-compute-connector.mjs` if it asserts the cap.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/navigation/connectorTargeting.js tests/
git commit -m "refactor(nav): remove dead connector-navigation constants"
```

---

### Task 10: Full suite + web build gate

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Web production build (must not regress)**

Run: `npm run build`
Expected: success. **Do not** `git add` regenerated `public-data/` artifacts (pipeline-owned).

- [ ] **Step 3: Commit any source-only fixes**

```bash
git add -p   # source files only
git commit -m "test(nav): green suite + web build for approach guidance"
```

---

### Task 11: iOS export

- [ ] **Step 1: Export the iOS bundle**

Run the app's checked-in Expo export command (per `apps/mobile`), e.g. `cd apps/mobile && npx expo export --platform ios`.
Expected: bundle builds without resolver/syntax errors.

- [ ] **Step 2: Record the result** in `plans/turn-by-turn-rejoin-routing/acceptance.md`.

---

### Task 12: Simulator/device acceptance

Update `plans/turn-by-turn-rejoin-routing/acceptance.md` to this checklist and execute it with the dev simulate-ride source:

- [ ] **≤1 km approach:** dashed road-preferring suggestion + faint direct line both render and differentiate; "X to route" + disclaimer show; "Open in Waze / Google Maps" launches the right app at the target.
- [ ] **Start-vs-join prompt:** appears only when joining skips ≥ `JOIN_SKIP_PROMPT_M`; each option re-targets line/suggestion/external destination.
- [ ] **>1 km / off coverage:** suggestion suppressed; external-app button primary; direct line + distance + disclaimer remain.
- [ ] **Acquisition handoff:** physically reaching the route starts Phase A turn-by-turn at that point (no jump).
- [ ] **Mid-ride off-route:** a confirmed departure shows the approach view toward the nearest-ahead point (no narrated rejoin).
- [ ] **Failure:** off-graph/no-path keeps direct line + external handoff; no crash, logged once.
- [ ] **Pause/stop:** pause preserves the approach slot; stop clears it and ignores a late suggestion result.
- [ ] Record device/build identifiers and any tuning changes.

---

## Self-Review

- **Spec coverage:** tiered ladder → Tasks 5/7/8; road-preferring suggested connector → Tasks 1/4/7; direct line → Task 7; start-vs-join prompt → Tasks 2/4/5/8; external handoff (GMaps cycling + Waze car) → Tasks 3/8; cut connector navigation/cues/handoff/recompute → Tasks 4/9; reuse computeConnector/preview/coverage/target-selection → Tasks 1/2/4; fallback = tier 3 → Tasks 4/5; node + device testing → Tasks 1–6/9/10 + 11/12.
- **Placeholder scan:** none — code in every step; only the named tuning constants are deferred.
- **Type consistency:** `approach.{target,choices,suggestionGeometry,suggestionStatus,distanceToRouteMeters}` and presentation `tier/showApproach/joinPrompt/externalNavTarget` used identically across Tasks 4/5/7/8; `buildExternalNavLinks(point)→{googleMaps,waze}` consumed in Task 8; `setApproachTarget(choice)`/`SET_APPROACH_TARGET` consistent across Tasks 4/6/8.

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — batch with checkpoints.
