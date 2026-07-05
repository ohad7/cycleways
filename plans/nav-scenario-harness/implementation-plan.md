# Navigation Scenario Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A declarative navigation scenario library consumed by two runners — a headless node runner (real session + user-visible presentation timeline + milestone assertions, in `npm test`, with agent-readable failure artifacts) and a dev-only in-app scenario picker that replays the same deterministic ride through the real UI at 1×/4×/8×.

**Architecture:** Scenarios are plain JS modules in `packages/core/src/navigation/scenarios/` (importable by both node and Metro). Each resolves — via one shared `resolveScenario()` — to `{ navigationRoute, fixes, connector, expect }`. The headless runner wraps the existing `replaySession` and maps every state through `getNavigationPresentation` + `createCueHapticPlanner` into a user-visible timeline that an expectation evaluator checks. The visual runner installs the fixes through the existing `devSourceProxy`/`createSimulateRideSource` path in BuildScreen, with a dev route override so scenarios carry their own routes.

**Design refinement vs. `design.md`:** scenario routes are **routeState modules**, not runtime slugs. Catalog routes enter the library via a snapshot script (slug resolved at snapshot time using the editor's node decode path), so both runners share one fast, dependency-free route resolution. `arrival` is asserted inside other scenarios rather than being its own file.

**Tech Stack:** plain ESM JS (`@cycleways/core` is `"type": "module"`), node `assert/strict` tests chained in `package.json`'s `test` script, React Native (Expo) for the picker UI. No new dependencies.

## Global Constraints

- `@cycleways/core` src is pure ESM; no node-only APIs (`fs`, `path`) inside `packages/core/src/**` — file access happens in `tests/` and `scripts/` only.
- All scenario data files are `.js` modules (`export default {...}`), never `.json`, so node ESM and Metro import them identically.
- Hebrew display strings in expectations must match `navigationPresentation.js` exactly (e.g. `"פנה שמאלה"`, `"הגעת ליעד"`, `"בדרך למסלול"`, `"הגעת למסלול · הניווט התחיל"`).
- Everything app-side is `__DEV__`-gated exactly like the existing SIM/REC harness (`apps/mobile/src/screens/BuildScreen.jsx:778-798`).
- Do NOT touch `data/map-source.geojson` or anything in `public-data/` (read-only pipeline-owned artifacts; the snapshot script only reads `public-data/route-catalog.json`).
- Each new test file is appended to the `test` chain in the root `package.json`, inserted immediately after `node tests/test-navigation-replay.mjs &&`.
- Off-route physics for authoring expectations: enter threshold = 30 m + accuracy (jitter 8 → accuracy 8 → 38 m), 4 s dwell to confirm, 15 m exit + 3 s to recover (`routeProgress.js:67-71`). Cue preview window = 120 m, final = 35 m (`navigationCues.js:16-17`).
- Milestone windows (`betweenMeters`, `beforeMeters`…) are empirical. If a window assertion fails while the behavior is visibly correct in the artifact JSON, inspect `test-results/nav-scenarios/<name>.json` and adjust the window — do not weaken the assertion type itself.

---

### Task 1: Track post-processing tools (`applyGpsGap`, `insertDwell`)

**Files:**
- Modify: `packages/core/src/navigation/trackGenerator.js` (export a seeded RNG)
- Create: `packages/core/src/navigation/trackTools.js`
- Create: `tests/test-track-tools.mjs`
- Modify: `package.json` (test chain)

**Interfaces:**
- Consumes: `getDistance(a, b)` from `@cycleways/core/utils/distance.js`; `mulberry32` already inside `trackGenerator.js`.
- Produces: `createSeededRandom(seed) -> () => float` (from trackGenerator); `cumulativeFixMeters(fixes) -> number[]`; `applyGpsGap(fixes, { startMeters, endMeters }) -> fixes`; `insertDwell(fixes, { atMeters, durationMs, intervalMs?, jitterM?, seed? }) -> fixes`. Fix objects are `{ lat, lng, accuracy, speed, heading?, timestamp }`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-track-tools.mjs`:

```js
// tests/test-track-tools.mjs
import assert from "node:assert/strict";
import {
  applyGpsGap,
  cumulativeFixMeters,
  insertDwell,
} from "@cycleways/core/navigation/trackTools.js";

// Straight west→east track along lat 33.1, one fix every ~10 m, 1 s apart.
function tenMeterTrack(count = 12) {
  const fixes = [];
  for (let i = 0; i < count; i++) {
    fixes.push({
      lat: 33.1,
      lng: 35.6 + (i * 10) / (111320 * Math.cos((33.1 * Math.PI) / 180)),
      accuracy: 5,
      speed: 10,
      timestamp: i * 1000,
    });
  }
  return fixes;
}

// cumulativeFixMeters: monotonic, ~10 m steps.
{
  const meters = cumulativeFixMeters(tenMeterTrack());
  assert.equal(meters[0], 0);
  assert.ok(Math.abs(meters[1] - 10) < 0.5, `step ~10m, got ${meters[1]}`);
  assert.ok(Math.abs(meters[11] - 110) < 2, `total ~110m, got ${meters[11]}`);
}

// applyGpsGap drops fixes inside [start, end) but keeps timestamps intact,
// producing a timestamp jump (GPS signal loss).
{
  const fixes = applyGpsGap(tenMeterTrack(), { startMeters: 30, endMeters: 60 });
  assert.equal(fixes.length, 9, "3 fixes dropped (at ~30, ~40, ~50 m)");
  const jumpIndex = fixes.findIndex(
    (f, i) => i > 0 && f.timestamp - fixes[i - 1].timestamp > 1000,
  );
  assert.ok(jumpIndex > 0, "a timestamp jump exists");
  assert.equal(fixes[jumpIndex].timestamp - fixes[jumpIndex - 1].timestamp, 4000);
  assert.throws(() => applyGpsGap(tenMeterTrack(), { startMeters: 60, endMeters: 30 }));
}

// insertDwell inserts stationary zero-speed fixes and shifts later timestamps.
{
  const original = tenMeterTrack();
  const fixes = insertDwell(original, {
    atMeters: 50,
    durationMs: 5000,
    intervalMs: 1000,
    jitterM: 3,
    seed: 2,
  });
  assert.equal(fixes.length, original.length + 5, "5 dwell fixes inserted");
  const dwell = fixes.filter((f) => f.speed === 0);
  assert.equal(dwell.length, 5, "dwell fixes have speed 0");
  const anchor = original[5]; // first fix at/after 50 m
  for (const f of dwell) {
    const latM = Math.abs(f.lat - anchor.lat) * 111320;
    assert.ok(latM < 10, "dwell jitter stays near the anchor");
  }
  assert.equal(
    fixes[fixes.length - 1].timestamp,
    original[original.length - 1].timestamp + 5000,
    "later fixes shifted by the dwell duration",
  );
  // Determinism: same seed, same output.
  assert.deepEqual(
    insertDwell(original, { atMeters: 50, durationMs: 5000, seed: 2 }),
    insertDwell(original, { atMeters: 50, durationMs: 5000, seed: 2 }),
  );
  assert.throws(() => insertDwell(original, { atMeters: 99999, durationMs: 5000 }));
}

console.log("track tools tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-track-tools.mjs`
Expected: FAIL with `Cannot find module ... trackTools.js`

- [ ] **Step 3: Export the seeded RNG from trackGenerator**

In `packages/core/src/navigation/trackGenerator.js`, directly below the existing private `mulberry32` function, add:

```js
// Shared deterministic RNG for track tooling (same generator the fixes use).
export function createSeededRandom(seed) {
  return mulberry32(seed);
}
```

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/navigation/trackTools.js`:

```js
// Pure post-processors for GPS fix arrays (nav-scenario-harness). They apply
// equally to generated tracks (trackGenerator) and recorded rides, so effects
// like signal gaps and standing dwells stay out of the generator itself.
import { getDistance } from "../utils/distance.js";
import { createSeededRandom } from "./trackGenerator.js";

const METERS_PER_DEG_LAT = 111320;

// Cumulative along-track meters per fix (straight-line between consecutive
// fixes). Jitter inflates this slightly; author gap/dwell scenarios with
// jitterM 0 when the meter positions need to be exact.
export function cumulativeFixMeters(fixes) {
  const meters = new Array(fixes.length).fill(0);
  for (let i = 1; i < fixes.length; i++) {
    meters[i] = meters[i - 1] + getDistance(fixes[i - 1], fixes[i]);
  }
  return meters;
}

// Drop fixes whose along-track position is in [startMeters, endMeters).
// Timestamps are untouched, so the survivors carry a time jump — a GPS gap.
export function applyGpsGap(fixes, { startMeters, endMeters } = {}) {
  if (
    !Number.isFinite(startMeters) ||
    !Number.isFinite(endMeters) ||
    endMeters <= startMeters
  ) {
    throw new Error("applyGpsGap requires finite startMeters < endMeters");
  }
  const meters = cumulativeFixMeters(fixes);
  return fixes.filter((_, i) => meters[i] < startMeters || meters[i] >= endMeters);
}

// Insert a stationary dwell (rider stops and stands) at the first fix at or
// after `atMeters`: zero-speed fixes jittering around that point, with all
// later timestamps shifted by the dwell duration.
export function insertDwell(
  fixes,
  { atMeters, durationMs, intervalMs = 1000, jitterM = 3, seed = 1 } = {},
) {
  if (!Number.isFinite(atMeters) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("insertDwell requires finite atMeters and durationMs > 0");
  }
  const meters = cumulativeFixMeters(fixes);
  const at = meters.findIndex((m) => m >= atMeters);
  if (at === -1) {
    throw new Error(`insertDwell: track is shorter than atMeters=${atMeters}`);
  }
  const anchor = fixes[at];
  const rand = createSeededRandom(seed);
  const lngScale = Math.max(0.01, Math.abs(Math.cos((anchor.lat * Math.PI) / 180)));
  const count = Math.max(1, Math.round(durationMs / intervalMs));
  const shiftMs = count * intervalMs;
  const dwellFixes = [];
  for (let i = 1; i <= count; i++) {
    dwellFixes.push({
      ...anchor,
      lat: anchor.lat + ((rand() - 0.5) * 2 * jitterM) / METERS_PER_DEG_LAT,
      lng:
        anchor.lng +
        ((rand() - 0.5) * 2 * jitterM) / (METERS_PER_DEG_LAT * lngScale),
      speed: 0,
      timestamp: anchor.timestamp + i * intervalMs,
    });
  }
  const shifted = fixes
    .slice(at + 1)
    .map((f) => ({ ...f, timestamp: f.timestamp + shiftMs }));
  return [...fixes.slice(0, at + 1), ...dwellFixes, ...shifted];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test-track-tools.mjs`
Expected: `track tools tests passed`

- [ ] **Step 6: Add to the test chain**

In the root `package.json` `test` script, replace `node tests/test-navigation-replay.mjs &&` with `node tests/test-navigation-replay.mjs && node tests/test-track-tools.mjs &&`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/trackGenerator.js packages/core/src/navigation/trackTools.js tests/test-track-tools.mjs package.json
git commit -m "feat(nav-scenarios): track post-processors for GPS gaps and dwells"
```

---

### Task 2: Scenario runner — user-visible timeline over the real session

**Files:**
- Create: `packages/core/src/navigation/scenarioRunner.js`
- Create: `tests/test-nav-scenario-runner.mjs`
- Modify: `package.json` (test chain)

**Interfaces:**
- Consumes: `replaySession(navigationRoute, fixes, options)` (`replayRunner.js` — options: `{ connectorRouter }` sync fn or `{ controlledConnector: true }`); `getNavigationPresentation(state)` (`navigationPresentation.js`); `createCueHapticPlanner()` (`cueHaptics.js` — `.plan(cueEvent, nowMs) -> { kind }`); `generateTrack`, `navigationRouteFromRouteState`.
- Produces:
  - `connectorRouterForMode(mode) -> fn|null` for modes `"straight-line" | "fail" | "none"`.
  - `buildUserTimeline(replayTimeline) -> entries[]` where each entry is `{ index, timestamp, status, offRoute, hasAcquiredRoute, justAcquired, progressMeters, remainingMeters, activeCueType, cueEventKind, suggestionStatus, connectorResult, haptic, presentation: { statusText, acquisitionText, cueText, cueDistanceText, remainingText, contextText, guidanceText, showCue, showApproach } }`.
  - `runScenario(resolved) -> { timeline, last, routeRequests, replay }` where `resolved` is `{ navigationRoute, fixes, connector }` (from Task 4's resolver).

- [ ] **Step 1: Write the failing test**

Create `tests/test-nav-scenario-runner.mjs`:

```js
// tests/test-nav-scenario-runner.mjs
import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import { generateTrack } from "@cycleways/core/navigation/trackGenerator.js";
import {
  buildUserTimeline,
  connectorRouterForMode,
  runScenario,
} from "@cycleways/core/navigation/scenarioRunner.js";

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
    { param: "runner-straight" },
  );
}

// Happy ride: timeline carries per-fix presentation and ends at the arrive cue.
{
  const route = straightRoute();
  const fixes = generateTrack(route, { speedMps: 5, intervalMs: 1000, seed: 7 });
  const { timeline, last } = runScenario({
    navigationRoute: route,
    fixes,
    connector: "straight-line",
  });
  assert.ok(timeline.length >= fixes.length, "one entry per fix at minimum");
  assert.equal(timeline[0].status, "navigating", "starts on-route");
  assert.equal(typeof timeline[0].presentation.cueText, "string");
  assert.ok(
    timeline[0].presentation.cueText.length > 0,
    "presentation strings are populated",
  );
  assert.equal(last.activeCueType, "arrive", "ride ends at the arrive cue");
  assert.ok(
    last.presentation.cueText.includes("הגעת ליעד"),
    "arrival banner text present",
  );
  assert.ok(
    timeline.some((e) => e.haptic !== null),
    "at least one haptic event planned",
  );
  assert.ok(
    Number(last.progressMeters) > 800,
    `progress completes, got ${last.progressMeters}`,
  );
}

// Approach ride, per connector mode: straight-line -> suggestion ready;
// fail -> connector failure surfaces; none -> request left pending.
{
  const route = straightRoute();
  const fixes = generateTrack(route, {
    speedMps: 5,
    intervalMs: 1000,
    seed: 7,
    approachFrom: { lat: 33.1, lng: 35.5955 }, // ~420 m west of the start
  });

  const ready = runScenario({ navigationRoute: route, fixes, connector: "straight-line" });
  assert.equal(ready.timeline[0].status, "approaching");
  assert.ok(
    ready.timeline.some((e) => e.suggestionStatus === "ready"),
    "straight-line connector produces a ready suggestion",
  );
  assert.ok(
    ready.timeline.some((e) => e.justAcquired === true),
    "route acquisition event surfaces in the timeline",
  );

  const failed = runScenario({ navigationRoute: route, fixes, connector: "fail" });
  assert.ok(
    failed.timeline.some((e) => e.connectorResult === "failed"),
    "fail connector surfaces a failed connector result",
  );

  const none = runScenario({ navigationRoute: route, fixes, connector: "none" });
  assert.ok(none.routeRequests.length >= 1, "request was issued");
  assert.ok(
    !none.timeline.some((e) => e.suggestionStatus === "ready"),
    "no suggestion resolves in mode none",
  );
}

// connectorRouterForMode contract.
{
  const req = { from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } };
  assert.deepEqual(connectorRouterForMode("straight-line")(req).geometry, [req.from, req.to]);
  assert.equal(connectorRouterForMode("fail")(req).failure, "scenario-forced-failure");
  assert.equal(connectorRouterForMode("none"), null);
}

// buildUserTimeline is pure over a replay timeline (smoke: empty input).
assert.deepEqual(buildUserTimeline([]), []);

console.log("nav scenario runner tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-nav-scenario-runner.mjs`
Expected: FAIL with `Cannot find module ... scenarioRunner.js`

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/navigation/scenarioRunner.js`:

```js
// Headless scenario runner (nav-scenario-harness). Drives the real navigation
// session over a scenario's fixes via replaySession, then maps every recorded
// state through the pure presentation + haptic planners into a "user-visible
// timeline": what the NavPanel showed and buzzed, per fix. This timeline is
// the contract the expectation evaluator (scenarioExpectations.js) checks and
// the JSON artifact agents read when a scenario fails.
import { createCueHapticPlanner } from "./cueHaptics.js";
import { getNavigationPresentation } from "./navigationPresentation.js";
import { replaySession } from "./replayRunner.js";

// Connector behavior per scenario. "straight-line" answers every rejoin/
// approach request with the direct segment (the suggestion lifecycle runs
// without the routing network); "fail" exercises the failure UX; "none"
// leaves requests pending (replaySession controlledConnector).
export function connectorRouterForMode(mode) {
  if (mode === "none") return null;
  if (mode === "fail") return () => ({ failure: "scenario-forced-failure" });
  return (request) => ({ geometry: [request.from, request.to] });
}

export function buildUserTimeline(replayTimeline) {
  const haptics = createCueHapticPlanner();
  return (Array.isArray(replayTimeline) ? replayTimeline : []).map(
    (state, index) => {
      const presentation = getNavigationPresentation(state);
      const hapticPlan = state.cueEvent
        ? haptics.plan(state.cueEvent, state.latestFix?.timestamp ?? 0)
        : { kind: null };
      return {
        index,
        timestamp: state.latestFix?.timestamp ?? null,
        status: state.status,
        offRoute: state.offRoute === true,
        hasAcquiredRoute: state.progress?.hasAcquiredRoute === true,
        justAcquired: state.justAcquired === true,
        progressMeters: state.progress?.progressMeters ?? null,
        remainingMeters: state.progress?.remainingMeters ?? null,
        activeCueType: state.activeCue?.cue?.type ?? null,
        cueEventKind: state.cueEvent?.kind ?? null,
        suggestionStatus: state.approach?.suggestionStatus ?? "idle",
        connectorResult: state.connectorResult?.result ?? null,
        haptic: hapticPlan.kind ?? null,
        presentation: {
          statusText: presentation.statusText,
          acquisitionText: presentation.acquisitionText,
          cueText: presentation.cueText,
          cueDistanceText: presentation.cueDistanceText,
          remainingText: presentation.remainingText,
          contextText: presentation.contextText,
          guidanceText: presentation.guidanceText,
          showCue: presentation.showCue,
          showApproach: presentation.showApproach,
        },
      };
    },
  );
}

export function runScenario(resolved) {
  const mode = resolved.connector ?? "straight-line";
  const router = connectorRouterForMode(mode);
  const options = router
    ? { connectorRouter: router }
    : { controlledConnector: true };
  const replay = replaySession(resolved.navigationRoute, resolved.fixes, options);
  const timeline = buildUserTimeline(replay.timeline);
  return {
    timeline,
    last: timeline[timeline.length - 1] ?? null,
    routeRequests: replay.routeRequests,
    replay,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-nav-scenario-runner.mjs`
Expected: `nav scenario runner tests passed`

- [ ] **Step 5: Add to the test chain**

In `package.json`, replace `node tests/test-track-tools.mjs &&` with `node tests/test-track-tools.mjs && node tests/test-nav-scenario-runner.mjs &&`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/scenarioRunner.js tests/test-nav-scenario-runner.mjs package.json
git commit -m "feat(nav-scenarios): headless runner with user-visible timeline"
```

---

### Task 3: Expectation evaluator

**Files:**
- Create: `packages/core/src/navigation/scenarioExpectations.js`
- Create: `tests/test-nav-scenario-expectations.mjs`
- Modify: `package.json` (test chain)

**Interfaces:**
- Consumes: timeline entries as produced by Task 2's `buildUserTimeline`.
- Produces: `evaluateExpectations(expectations, timeline) -> { passed: boolean, failures: string[] }`. Expectation vocabulary (v1, exact):
  - `{ type: "status", value, betweenMeters?: [min,max], never?: true }`
  - `{ type: "banner", match, field?: <presentation key, default "cueText">, beforeMeters?, afterMeters?, never?: true }`
  - `{ type: "acquired" }`
  - `{ type: "rerouted", withinFixesOfOffRoute?: n }`
  - `{ type: "suggestionFailed" }`
  - `{ type: "arrived" }`
  - `{ type: "haptic", kind: "heavy"|"medium"|"light", never?: true }`
  - `{ type: "progress-at-least", meters }`

- [ ] **Step 1: Write the failing test**

Create `tests/test-nav-scenario-expectations.mjs`:

```js
// tests/test-nav-scenario-expectations.mjs
import assert from "node:assert/strict";
import { evaluateExpectations } from "@cycleways/core/navigation/scenarioExpectations.js";

// Minimal hand-built timeline entries (only the fields the evaluator reads).
function entry(overrides = {}) {
  return {
    status: "navigating",
    justAcquired: false,
    progressMeters: 0,
    activeCueType: null,
    suggestionStatus: "idle",
    connectorResult: null,
    haptic: null,
    presentation: { cueText: "המשך במסלול", statusText: "", guidanceText: "" },
    ...overrides,
  };
}

const timeline = [
  entry({ status: "approaching", progressMeters: 0, presentation: { cueText: "", statusText: "בדרך למסלול", guidanceText: "" } }),
  entry({ justAcquired: true, progressMeters: 10 }),
  entry({ progressMeters: 200 }),
  entry({ status: "off-route", offRoute: true, progressMeters: 300, haptic: "heavy" }),
  entry({ status: "off-route", offRoute: true, progressMeters: 300, suggestionStatus: "ready" }),
  entry({ progressMeters: 500, presentation: { cueText: "פנה שמאלה אל שביל הצפון", statusText: "", guidanceText: "" } }),
  entry({ progressMeters: 900, activeCueType: "arrive", presentation: { cueText: "הגעת ליעד", statusText: "", guidanceText: "" } }),
];

// All-passing set.
{
  const result = evaluateExpectations(
    [
      { type: "status", value: "approaching" },
      { type: "status", value: "off-route", betweenMeters: [250, 350] },
      { type: "acquired" },
      { type: "banner", match: "פנה שמאלה", afterMeters: 400, beforeMeters: 600 },
      { type: "banner", match: "בדרך למסלול", field: "statusText" },
      { type: "rerouted", withinFixesOfOffRoute: 2 },
      { type: "arrived" },
      { type: "haptic", kind: "heavy" },
      { type: "progress-at-least", meters: 800 },
    ],
    timeline,
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.passed, true);
}

// Failing / never / edge cases.
{
  const result = evaluateExpectations(
    [
      { type: "status", value: "paused" }, // never happened
      { type: "status", value: "off-route", never: true }, // did happen
      { type: "status", value: "off-route", betweenMeters: [400, 500] }, // wrong window
      { type: "banner", match: "פנה ימינה" }, // wrong turn direction
      { type: "banner", match: "פנה שמאלה", beforeMeters: 400 }, // too late
      { type: "haptic", kind: "medium" }, // never fired
      { type: "suggestionFailed" }, // connector never failed
      { type: "progress-at-least", meters: 2000 },
      { type: "bogus-type" },
    ],
    timeline,
  );
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 9, JSON.stringify(result.failures, null, 1));
}

// rerouted without any off-route entry fails cleanly.
{
  const result = evaluateExpectations([{ type: "rerouted" }], [entry()]);
  assert.equal(result.passed, false);
  assert.match(result.failures[0], /never went off-route/);
}

// suggestionFailed passes when a connector failure surfaced.
{
  const result = evaluateExpectations(
    [{ type: "suggestionFailed" }],
    [entry({ connectorResult: "failed" })],
  );
  assert.equal(result.passed, true);
}

// Empty expectation list passes (smoke-only scenario).
assert.equal(evaluateExpectations([], timeline).passed, true);

console.log("nav scenario expectations tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-nav-scenario-expectations.mjs`
Expected: FAIL with `Cannot find module ... scenarioExpectations.js`

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/navigation/scenarioExpectations.js`:

```js
// Milestone evaluator for nav scenarios (nav-scenario-harness). Checks a
// scenario's `expect` list against the user-visible timeline produced by
// scenarioRunner.buildUserTimeline. Deliberately small vocabulary — see the
// switch below; unknown types are failures so typos never silently pass.

function progressOf(entry) {
  const value = Number(entry?.progressMeters);
  return Number.isFinite(value) ? value : null;
}

function textOf(entry, field) {
  return String(entry?.presentation?.[field] ?? "");
}

export function evaluateExpectations(expectations, timeline) {
  const failures = [];
  const entries = Array.isArray(timeline) ? timeline : [];
  const firstOffRouteIndex = entries.findIndex((e) => e.status === "off-route");

  for (const exp of Array.isArray(expectations) ? expectations : []) {
    const fail = (message) => failures.push(`${JSON.stringify(exp)} — ${message}`);

    switch (exp.type) {
      case "status": {
        const first = entries.find((e) => e.status === exp.value);
        if (exp.never === true) {
          if (first) fail(`status "${exp.value}" occurred at entry ${first.index ?? entries.indexOf(first)}`);
          break;
        }
        if (!first) {
          fail(`status "${exp.value}" never occurred`);
          break;
        }
        if (Array.isArray(exp.betweenMeters)) {
          const p = progressOf(first);
          const [min, max] = exp.betweenMeters;
          if (p === null || p < min || p > max) {
            fail(`first "${exp.value}" at ${p}m, expected within [${min}, ${max}]`);
          }
        }
        break;
      }

      case "banner": {
        const field = exp.field ?? "cueText";
        const first = entries.find((e) => textOf(e, field).includes(exp.match));
        if (exp.never === true) {
          if (first) fail(`"${exp.match}" appeared in ${field}`);
          break;
        }
        if (!first) {
          fail(`"${exp.match}" never appeared in ${field}`);
          break;
        }
        const p = progressOf(first);
        if (exp.beforeMeters !== undefined && (p === null || p > exp.beforeMeters)) {
          fail(`first "${exp.match}" at ${p}m, expected before ${exp.beforeMeters}m`);
        }
        if (exp.afterMeters !== undefined && (p === null || p < exp.afterMeters)) {
          fail(`first "${exp.match}" at ${p}m, expected after ${exp.afterMeters}m`);
        }
        break;
      }

      case "acquired":
        if (!entries.some((e) => e.justAcquired === true)) {
          fail("route was never acquired");
        }
        break;

      case "rerouted": {
        if (firstOffRouteIndex === -1) {
          fail("never went off-route");
          break;
        }
        const readyIndex = entries.findIndex(
          (e, i) => i > firstOffRouteIndex && e.suggestionStatus === "ready",
        );
        if (readyIndex === -1) {
          fail("no rejoin suggestion became ready after going off-route");
        } else if (
          exp.withinFixesOfOffRoute !== undefined &&
          readyIndex - firstOffRouteIndex > exp.withinFixesOfOffRoute
        ) {
          fail(
            `suggestion ready ${readyIndex - firstOffRouteIndex} entries after off-route (limit ${exp.withinFixesOfOffRoute})`,
          );
        }
        break;
      }

      case "suggestionFailed":
        if (!entries.some((e) => e.connectorResult === "failed")) {
          fail("no connector failure was reported");
        }
        break;

      case "arrived":
        if (!entries.some((e) => e.activeCueType === "arrive")) {
          fail("arrive cue never became active");
        }
        break;

      case "haptic": {
        const fired = entries.some((e) => e.haptic === exp.kind);
        if (exp.never === true) {
          if (fired) fail(`haptic "${exp.kind}" fired`);
        } else if (!fired) {
          fail(`haptic "${exp.kind}" never fired`);
        }
        break;
      }

      case "progress-at-least": {
        const last = entries[entries.length - 1];
        const p = last ? progressOf(last) : null;
        if (p === null || p < exp.meters) {
          fail(`final progress ${p}m is below ${exp.meters}m`);
        }
        break;
      }

      default:
        fail(`unknown expectation type "${exp.type}"`);
    }
  }
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-nav-scenario-expectations.mjs`
Expected: `nav scenario expectations tests passed`

- [ ] **Step 5: Add to the test chain**

In `package.json`, replace `node tests/test-nav-scenario-runner.mjs &&` with `node tests/test-nav-scenario-runner.mjs && node tests/test-nav-scenario-expectations.mjs &&`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/scenarioExpectations.js tests/test-nav-scenario-expectations.mjs package.json
git commit -m "feat(nav-scenarios): milestone expectation evaluator"
```

---

### Task 4: Scenario resolver + synthetic L-turn route

**Files:**
- Create: `packages/core/src/navigation/scenarios/resolve.js`
- Create: `packages/core/src/navigation/scenarios/routes/l-turn.js`
- Create: `tests/test-nav-scenario-resolve.mjs`
- Modify: `package.json` (test chain)

**Interfaces:**
- Consumes: `navigationRouteFromRouteState(routeState, shareInfo)`, `generateTrack(navigationRoute, options)`, `applyGpsGap`, `insertDwell` (Tasks 1).
- Produces: `resolveScenario(scenario, { currentNavigationRoute? }) -> { name, description, visualOnly, navigationRoute, fixes, connector, expect }`. Scenario shape (canonical):

```js
{
  name: "kebab-case-unique",
  description: "one line",
  visualOnly: false,                       // optional; headless suite skips true
  route: { routeState: {...} } | "current",
  track: {
    generate: { /* generateTrack options */ },  // or fixes: [ ... ]
    gap:   { startMeters, endMeters },          // optional post-processor
    dwell: { atMeters, durationMs, ... },       // optional post-processor
  },
  connector: "straight-line" | "fail" | "none", // optional, default straight-line
  expect: [ /* Task 3 vocabulary */ ],          // optional, default []
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/test-nav-scenario-resolve.mjs`:

```js
// tests/test-nav-scenario-resolve.mjs
import assert from "node:assert/strict";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";
import lTurn from "@cycleways/core/navigation/scenarios/routes/l-turn.js";

const base = {
  name: "test-scenario",
  description: "resolver test",
  route: { routeState: lTurn },
  track: { generate: { speedMps: 5, intervalMs: 1000, seed: 1 } },
};

// Happy resolution from a routeState module.
{
  const resolved = resolveScenario(base);
  assert.equal(resolved.name, "test-scenario");
  assert.equal(resolved.connector, "straight-line", "connector defaults");
  assert.deepEqual(resolved.expect, [], "expect defaults to []");
  assert.equal(resolved.visualOnly, false);
  assert.ok(resolved.navigationRoute.canNavigate, "route is navigable");
  assert.ok(
    resolved.navigationRoute.distanceMeters > 1100 &&
      resolved.navigationRoute.distanceMeters < 1300,
    `l-turn is ~1200m, got ${resolved.navigationRoute.distanceMeters}`,
  );
  assert.ok(resolved.fixes.length > 200, "5 m/s over ~1200 m => 240ish fixes");
}

// The l-turn route produces a merged left-turn cue onto the second segment.
{
  const { buildRouteCues } = await import(
    "@cycleways/core/navigation/navigationCues.js"
  );
  const resolved = resolveScenario(base);
  const cues = buildRouteCues(resolved.navigationRoute);
  const turn = cues.find((c) => c.type === "turn");
  assert.ok(turn, "l-turn has a turn cue");
  assert.equal(turn.direction, "left");
  assert.equal(turn.ontoSegmentName, "שביל הצפון", "segment name merged onto the turn");
  assert.ok(
    Math.abs(turn.distanceMeters - 597) < 15,
    `turn at ~597m, got ${turn.distanceMeters}`,
  );
}

// gap + dwell post-processors compose.
{
  const plain = resolveScenario(base);
  const processed = resolveScenario({
    ...base,
    track: {
      ...base.track,
      gap: { startMeters: 300, endMeters: 400 },
      dwell: { atMeters: 500, durationMs: 10000, seed: 4 },
    },
  });
  assert.ok(
    processed.fixes.length < plain.fixes.length + 10 &&
      processed.fixes.length !== plain.fixes.length,
    "post-processors changed the track",
  );
}

// "current" route form requires a navigable current route.
{
  assert.throws(
    () => resolveScenario({ ...base, route: "current" }),
    /requires a navigable current route/,
  );
  const current = resolveScenario(base).navigationRoute;
  const resolved = resolveScenario(
    { ...base, route: "current" },
    { currentNavigationRoute: current },
  );
  assert.equal(resolved.navigationRoute, current);
}

// Validation failures name the scenario and the problem.
assert.throws(() => resolveScenario({ ...base, name: undefined }), /missing a name/);
assert.throws(() => resolveScenario({ ...base, route: {} }), /test-scenario.*route/);
assert.throws(() => resolveScenario({ ...base, track: {} }), /test-scenario.*track/);
assert.throws(
  () => resolveScenario({ ...base, connector: "teleport" }),
  /unknown connector mode/,
);

console.log("nav scenario resolve tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-nav-scenario-resolve.mjs`
Expected: FAIL with `Cannot find module ... scenarios/resolve.js`

- [ ] **Step 3: Create the L-turn route module**

Create `packages/core/src/navigation/scenarios/routes/l-turn.js`:

```js
// Synthetic L-shaped scenario route: ~597 m due east, then a 90° left turn
// onto ~601 m due north. Geometry points every ~150 m keep bearings clean so
// exactly one turn cue is generated at the corner; the second segment span
// starts at the corner so its name merges onto the turn cue
// ("פנה שמאלה אל שביל הצפון"). Segment names are synthetic test fixtures.
export default {
  points: [
    { id: "start", lat: 33.1, lng: 35.6 },
    { id: "corner", lat: 33.1, lng: 35.6064 },
    { id: "end", lat: 33.1054, lng: 35.6064 },
  ],
  selectedSegments: ["דרך הפרדס", "שביל הצפון"],
  geometry: [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.6016 },
    { lat: 33.1, lng: 35.6032 },
    { lat: 33.1, lng: 35.6048 },
    { lat: 33.1, lng: 35.6064 },
    { lat: 33.10135, lng: 35.6064 },
    { lat: 33.1027, lng: 35.6064 },
    { lat: 33.10405, lng: 35.6064 },
    { lat: 33.1054, lng: 35.6064 },
  ],
  segmentSpans: [
    { startMeters: 0, endMeters: 600, name: "דרך הפרדס", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
    { startMeters: 600, endMeters: 1200, name: "שביל הצפון", cwSegmentId: 2, onNetwork: true, routeClass: "path" },
  ],
  distance: 1198,
};
```

- [ ] **Step 4: Write the resolver**

Create `packages/core/src/navigation/scenarios/resolve.js`:

```js
// Shared scenario loader (nav-scenario-harness). Both the headless runner
// (tests/test-nav-scenarios.mjs) and the in-app dev picker resolve scenarios
// through this one function, so a scenario that passes CI is byte-identical
// to the ride replayed on the simulator. Fails fast with messages that name
// the scenario and the offending field.
import { navigationRouteFromRouteState } from "../navigationRoute.js";
import { generateTrack } from "../trackGenerator.js";
import { applyGpsGap, insertDwell } from "../trackTools.js";

const CONNECTOR_MODES = new Set(["straight-line", "fail", "none"]);

export function resolveScenario(scenario, { currentNavigationRoute = null } = {}) {
  const name = scenario?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("scenario is missing a name");
  }
  const err = (message) => new Error(`scenario "${name}": ${message}`);

  let navigationRoute;
  if (scenario.route === "current") {
    if (currentNavigationRoute?.canNavigate !== true) {
      throw err("requires a navigable current route");
    }
    navigationRoute = currentNavigationRoute;
  } else if (scenario.route?.routeState) {
    navigationRoute = navigationRouteFromRouteState(scenario.route.routeState, {
      param: `scenario-${name}`,
    });
    if (!navigationRoute.canNavigate) {
      throw err(`routeState is not navigable (${navigationRoute.unavailableReason})`);
    }
  } else {
    throw err('route must be "current" or { routeState }');
  }

  let fixes;
  if (Array.isArray(scenario.track?.fixes)) {
    fixes = scenario.track.fixes;
  } else if (scenario.track?.generate) {
    fixes = generateTrack(navigationRoute, scenario.track.generate);
  } else {
    throw err("track must provide fixes[] or generate{}");
  }
  if (scenario.track?.gap) fixes = applyGpsGap(fixes, scenario.track.gap);
  if (scenario.track?.dwell) fixes = insertDwell(fixes, scenario.track.dwell);
  if (fixes.length < 2) throw err("track resolved to fewer than 2 fixes");

  const connector = scenario.connector ?? "straight-line";
  if (!CONNECTOR_MODES.has(connector)) {
    throw err(`unknown connector mode "${connector}"`);
  }

  return {
    name,
    description: scenario.description ?? "",
    visualOnly: scenario.visualOnly === true,
    navigationRoute,
    fixes,
    connector,
    expect: Array.isArray(scenario.expect) ? scenario.expect : [],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test-nav-scenario-resolve.mjs`
Expected: `nav scenario resolve tests passed`. If the merged-turn assertion fails, print the cue list (`node -e` with `buildRouteCues`) and adjust the l-turn `segmentSpans` start so the span boundary lands within 20 m of the turn cue (`MIN_TURN_SPACING_M` merge window in `navigationCues.js:87`).

- [ ] **Step 6: Add to the test chain**

In `package.json`, replace `node tests/test-nav-scenario-expectations.mjs &&` with `node tests/test-nav-scenario-expectations.mjs && node tests/test-nav-scenario-resolve.mjs &&`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/scenarios tests/test-nav-scenario-resolve.mjs package.json
git commit -m "feat(nav-scenarios): scenario resolver and synthetic l-turn route"
```

---

### Task 5: Seed scenario library + registry + headless suite

**Files:**
- Create: `packages/core/src/navigation/scenarios/on-route-happy-path.js`
- Create: `packages/core/src/navigation/scenarios/approach-from-distance.js`
- Create: `packages/core/src/navigation/scenarios/missed-turn-reroute.js`
- Create: `packages/core/src/navigation/scenarios/reroute-failure.js`
- Create: `packages/core/src/navigation/scenarios/gps-gap.js`
- Create: `packages/core/src/navigation/scenarios/stop-and-stand.js`
- Create: `packages/core/src/navigation/scenarios/current-route-generic.js`
- Create: `packages/core/src/navigation/scenarios/index.js`
- Create: `tests/test-nav-scenarios.mjs`
- Modify: `package.json` (test chain)

**Interfaces:**
- Consumes: `resolveScenario` (Task 4), `runScenario` (Task 2), `evaluateExpectations` (Task 3), `routes/l-turn.js`.
- Produces: `scenarios` array + `getScenario(name)` from `scenarios/index.js` — the registry both the headless suite and Task 8's picker iterate. Failure artifacts at `test-results/nav-scenarios/<name>.json` shaped `{ scenario, failures, timeline }`.

- [ ] **Step 1: Write the scenario modules**

`packages/core/src/navigation/scenarios/on-route-happy-path.js`:

```js
import lTurn from "./routes/l-turn.js";

// Clean ride from the route start to arrival; also covers the arrival
// milestone (no separate arrival scenario needed).
export default {
  name: "on-route-happy-path",
  description: "רכיבה נקייה מתחילת המסלול ועד היעד (מסלול L סינתטי)",
  route: { routeState: lTurn },
  track: { generate: { speedMps: 5, intervalMs: 1000, jitterM: 8, seed: 11 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "status", value: "off-route", never: true },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430, beforeMeters: 600 },
    { type: "banner", match: "שביל הצפון" },
    { type: "arrived" },
  ],
};
```

`packages/core/src/navigation/scenarios/approach-from-distance.js`:

```js
import lTurn from "./routes/l-turn.js";

// Rider starts ~500 m west of the route start: approach state, approach
// suggestion, acquisition announcement, then a normal ride.
export default {
  name: "approach-from-distance",
  description: "התחלה כ־500 מ׳ לפני תחילת המסלול — מצב התקרבות ורכישת המסלול",
  route: { routeState: lTurn },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 8,
      seed: 12,
      approachFrom: { lat: 33.1, lng: 35.5947 },
    },
  },
  expect: [
    { type: "status", value: "approaching" },
    { type: "banner", match: "בדרך למסלול", field: "statusText" },
    { type: "acquired" },
    { type: "banner", match: "הניווט התחיל", field: "acquisitionText" },
    { type: "arrived" },
  ],
};
```

`packages/core/src/navigation/scenarios/missed-turn-reroute.js`:

```js
import lTurn from "./routes/l-turn.js";

// Rider drifts up to 120 m off the first leg between ~250-450 m (a smooth
// leave-and-return arc), triggering off-route + a rejoin suggestion, then
// rejoins in time to get the turn cue.
export default {
  name: "missed-turn-reroute",
  description: "סטייה של עד 120 מ׳ מהמסלול — זיהוי סטייה, הצעת חזרה, וחזרה למסלול",
  route: { routeState: lTurn },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 8,
      seed: 3,
      offRouteExcursion: { startMeters: 250, lengthMeters: 200, offsetMeters: 120 },
    },
  },
  expect: [
    { type: "status", value: "off-route", betweenMeters: [230, 420] },
    { type: "haptic", kind: "heavy" },
    { type: "rerouted", withinFixesOfOffRoute: 10 },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430 },
    { type: "arrived" },
  ],
};
```

`packages/core/src/navigation/scenarios/reroute-failure.js`:

```js
import lTurn from "./routes/l-turn.js";

// Same excursion as missed-turn-reroute, but every connector request fails —
// exercises the failure UX (rider still finds their own way back).
export default {
  name: "reroute-failure",
  description: "סטייה מהמסלול כשחישוב הצעת החזרה נכשל",
  route: { routeState: lTurn },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 8,
      seed: 3,
      offRouteExcursion: { startMeters: 250, lengthMeters: 200, offsetMeters: 120 },
    },
  },
  connector: "fail",
  expect: [
    { type: "status", value: "off-route", betweenMeters: [230, 420] },
    { type: "suggestionFailed" },
    { type: "arrived" },
  ],
};
```

`packages/core/src/navigation/scenarios/gps-gap.js`:

```js
import lTurn from "./routes/l-turn.js";

// GPS signal drops for ~150 m / 30 s mid-leg (timestamps jump); navigation
// must absorb the on-route jump without a false off-route. jitterM 0 keeps
// the gap's meter positions exact (see trackTools.cumulativeFixMeters).
export default {
  name: "gps-gap",
  description: "אובדן קליטת GPS באמצע המקטע הראשון — קפיצת זמן ומרחק על המסלול",
  route: { routeState: lTurn },
  track: {
    generate: { speedMps: 5, intervalMs: 1000, jitterM: 0, seed: 5 },
    gap: { startMeters: 300, endMeters: 450 },
  },
  expect: [
    { type: "status", value: "off-route", never: true },
    { type: "arrived" },
  ],
};
```

`packages/core/src/navigation/scenarios/stop-and-stand.js`:

```js
import lTurn from "./routes/l-turn.js";

// Rider stops for 90 s at ~300 m (zero speed, small GPS wander). Standing
// still must not trigger off-route or regress progress.
export default {
  name: "stop-and-stand",
  description: "עצירה של 90 שניות באמצע המסלול — בלי סטייה כוזבת",
  route: { routeState: lTurn },
  track: {
    generate: { speedMps: 5, intervalMs: 1000, jitterM: 0, seed: 6 },
    dwell: { atMeters: 300, durationMs: 90000, intervalMs: 1000, jitterM: 3, seed: 6 },
  },
  expect: [
    { type: "status", value: "off-route", never: true },
    { type: "arrived" },
  ],
};
```

`packages/core/src/navigation/scenarios/current-route-generic.js`:

```js
// Visual-runner-only: replay a generic clean ride over whatever route is
// currently open in the Build screen (the old dev SIM button behavior).
export default {
  name: "current-route-generic",
  description: "רכיבה סימולטיבית על המסלול הפתוח כרגע",
  visualOnly: true,
  route: "current",
  track: { generate: { speedMps: 5, intervalMs: 1000, jitterM: 8, seed: 1 } },
  expect: [],
};
```

- [ ] **Step 2: Write the registry**

Create `packages/core/src/navigation/scenarios/index.js`:

```js
// Scenario registry (nav-scenario-harness). Every entry runs headlessly in
// tests/test-nav-scenarios.mjs (visualOnly entries are skipped there) and
// appears in the dev scenario picker on the Build screen. Adding a scenario =
// one module + one line here.
import approachFromDistance from "./approach-from-distance.js";
import currentRouteGeneric from "./current-route-generic.js";
import gpsGap from "./gps-gap.js";
import missedTurnReroute from "./missed-turn-reroute.js";
import onRouteHappyPath from "./on-route-happy-path.js";
import rerouteFailure from "./reroute-failure.js";
import stopAndStand from "./stop-and-stand.js";

export const scenarios = [
  onRouteHappyPath,
  approachFromDistance,
  missedTurnReroute,
  rerouteFailure,
  gpsGap,
  stopAndStand,
  currentRouteGeneric,
];

export function getScenario(name) {
  return scenarios.find((scenario) => scenario.name === name) ?? null;
}
```

- [ ] **Step 3: Write the headless suite**

Create `tests/test-nav-scenarios.mjs`:

```js
// tests/test-nav-scenarios.mjs — runs every registered nav scenario headlessly
// and checks its milestones. On failure, the full user-visible timeline is
// written to test-results/nav-scenarios/<name>.json (gitignored) so an agent
// can diagnose e.g. "banner flipped too early at entry 142" without a device.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { evaluateExpectations } from "@cycleways/core/navigation/scenarioExpectations.js";
import { runScenario } from "@cycleways/core/navigation/scenarioRunner.js";
import { getScenario, scenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";

assert.ok(scenarios.length >= 7, "seed scenario set is registered");
assert.equal(getScenario("on-route-happy-path")?.name, "on-route-happy-path");
assert.equal(getScenario("nope"), null);
assert.equal(
  new Set(scenarios.map((s) => s.name)).size,
  scenarios.length,
  "scenario names are unique",
);

const ARTIFACT_DIR = "test-results/nav-scenarios";
let failedCount = 0;

for (const scenario of scenarios) {
  if (scenario.visualOnly === true) {
    console.log(`- ${scenario.name} (visual-only, skipped)`);
    continue;
  }
  const resolved = resolveScenario(scenario);
  const { timeline } = runScenario(resolved);
  const result = evaluateExpectations(resolved.expect, timeline);
  if (result.passed) {
    console.log(`✓ ${scenario.name} (${timeline.length} entries)`);
    continue;
  }
  failedCount += 1;
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifactPath = `${ARTIFACT_DIR}/${scenario.name}.json`;
  writeFileSync(
    artifactPath,
    JSON.stringify({ scenario: scenario.name, failures: result.failures, timeline }, null, 1),
  );
  console.error(`✗ ${scenario.name}`);
  for (const failure of result.failures) console.error(`    ${failure}`);
  console.error(`    timeline written to ${artifactPath}`);
}

if (failedCount > 0) {
  console.error(`${failedCount} nav scenario(s) failed`);
  process.exit(1);
}
console.log("nav scenarios suite passed");
```

- [ ] **Step 4: Run the suite and tune milestone windows**

Run: `node tests/test-nav-scenarios.mjs`
Expected: `✓` for six scenarios, `- current-route-generic (visual-only, skipped)`, then `nav scenarios suite passed`.

If a scenario fails: open `test-results/nav-scenarios/<name>.json`, find the entries around the failed milestone, and confirm whether the behavior is correct-but-outside-the-window (adjust the window per the Global Constraints tuning rule) or an actual defect (stop and investigate — do not paper over it).

- [ ] **Step 5: Add to the test chain**

In `package.json`, replace `node tests/test-nav-scenario-resolve.mjs &&` with `node tests/test-nav-scenario-resolve.mjs && node tests/test-nav-scenarios.mjs &&`.

Run: `npm test`
Expected: full chain passes.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/scenarios tests/test-nav-scenarios.mjs package.json
git commit -m "feat(nav-scenarios): seed scenario library and headless CI suite"
```

---

### Task 6: Recorded real-ride scenario

**Files:**
- Create: `packages/core/src/navigation/scenarios/recorded/ride-realistic.js` (converted from `tests/fixtures/nav-ride-realistic.json`)
- Create: `packages/core/src/navigation/scenarios/recorded-real-ride.js`
- Modify: `packages/core/src/navigation/scenarios/index.js`

**Interfaces:**
- Consumes: the existing fixture (`{ route, fixes, milestones }`; milestones: `approachFixCount: 6`, `acquiredByFixIndex: 6`, `finalProgressAtLeastM: 800`; 25 fixes, route total 941.9 m). The original JSON stays where it is — `test-navigation-replay.mjs` keeps using it; the recorded module is the scenario-library copy with provenance noted.
- Produces: `recorded/ride-realistic.js` exporting `{ routeState, fixes }`.

- [ ] **Step 1: Convert the fixture to a scenario data module**

Run this one-off conversion from the repo root:

```bash
node --input-type=module -e '
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const fx = JSON.parse(readFileSync("tests/fixtures/nav-ride-realistic.json", "utf8"));
const fixes = fx.fixes.map(({ _comment, ...fix }) => fix);
const header =
  "// Converted from tests/fixtures/nav-ride-realistic.json (real GPS recording\n" +
  "// captured with the BuildScreen REC button). Regenerate with the conversion\n" +
  "// command in plans/nav-scenario-harness/implementation-plan.md Task 6.\n";
mkdirSync("packages/core/src/navigation/scenarios/recorded", { recursive: true });
writeFileSync(
  "packages/core/src/navigation/scenarios/recorded/ride-realistic.js",
  header + "export default " + JSON.stringify({ routeState: fx.route, fixes }, null, 2) + ";\n",
);
console.log("wrote recorded/ride-realistic.js with", fixes.length, "fixes");
'
```

Expected output: `wrote recorded/ride-realistic.js with 25 fixes`

- [ ] **Step 2: Write the scenario**

Create `packages/core/src/navigation/scenarios/recorded-real-ride.js`:

```js
import rideRealistic from "./recorded/ride-realistic.js";

// Replay of a real recorded ride (approach, jittery riding, a pause, and a
// GPS jump — see the fixture provenance header). Milestones mirror the ones
// asserted in tests/test-navigation-replay.mjs.
export default {
  name: "recorded-real-ride",
  description: "שחזור רכיבה אמיתית שהוקלטה בשטח (התקרבות, רעש GPS, קפיצה)",
  route: { routeState: rideRealistic.routeState },
  track: { fixes: rideRealistic.fixes },
  expect: [
    { type: "status", value: "approaching" },
    { type: "acquired" },
    { type: "progress-at-least", meters: 800 },
    { type: "arrived" },
  ],
};
```

- [ ] **Step 3: Register it**

In `packages/core/src/navigation/scenarios/index.js`, add the import and append to the array (before `currentRouteGeneric`):

```js
import recordedRealRide from "./recorded-real-ride.js";
```

```js
  stopAndStand,
  recordedRealRide,
  currentRouteGeneric,
```

- [ ] **Step 4: Run the suite**

Run: `node tests/test-nav-scenarios.mjs`
Expected: `✓ recorded-real-ride (…)` among the passing scenarios. If `acquired` fails: the fixture ride enters the route from an approach, which sets `justAcquired` via the session's `enteredEffectiveRoute` path — inspect the artifact; if the session genuinely never flags `justAcquired` for this recording, replace the `acquired` expectation with `{ type: "status", value: "navigating" }` and note why in the scenario file.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/scenarios
git commit -m "feat(nav-scenarios): recorded real-ride scenario from the field fixture"
```

---

### Task 7: Catalog route snapshot script + real-route scenario

**Files:**
- Create: `scripts/nav-scenario-route-snapshot.mjs`
- Create: `packages/core/src/navigation/scenarios/routes/sovev-beit-hillel.js` (generated by the script)
- Create: `packages/core/src/navigation/scenarios/sovev-beit-hillel-ride.js`
- Modify: `packages/core/src/navigation/scenarios/index.js`

**Interfaces:**
- Consumes: `buildLiveDecodeRoute()` from `editor/server.mjs` (async; returns `decode(token, entry) -> { geometry, selectedSegments, ... } | null`) — the same node decode path `tests/test-route-catalog-base-decode.mjs` uses; `public-data/route-catalog.json` (read-only).
- Produces: committed routeState snapshot modules under `scenarios/routes/<slug>.js` (geometry rounded to 5 decimals ≈ 1 m; no segmentSpans, so context-line expectations don't apply to snapshot routes).

- [ ] **Step 1: Write the snapshot script**

Create `scripts/nav-scenario-route-snapshot.mjs`:

```js
#!/usr/bin/env node
// Snapshot a catalog route's decoded routeState into the nav scenario library
// (plans/nav-scenario-harness). Slugs are resolved here, at snapshot time, so
// scenario resolution at run time stays fast and dependency-free on both node
// and the app. Reads public-data (never writes it).
//
// Usage:
//   node scripts/nav-scenario-route-snapshot.mjs --list
//   node scripts/nav-scenario-route-snapshot.mjs <slug>
import { readFileSync, writeFileSync } from "node:fs";
import { buildLiveDecodeRoute } from "../editor/server.mjs";

const arg = process.argv[2];
const catalog = JSON.parse(readFileSync("public-data/route-catalog.json", "utf-8"));

if (!arg || arg === "--list") {
  console.log(catalog.entries.map((entry) => entry.slug).join("\n"));
  process.exit(arg ? 0 : 1);
}

const entry = catalog.entries.find((candidate) => candidate.slug === arg);
if (!entry) {
  console.error(`unknown catalog slug "${arg}" (use --list)`);
  process.exit(1);
}

const decode = await buildLiveDecodeRoute();
const decoded = decode(entry.route, entry);
if (!decoded || !Array.isArray(decoded.geometry) || decoded.geometry.length < 2) {
  console.error(`route "${arg}" failed to decode to geometry`);
  process.exit(1);
}

const geometry = decoded.geometry.map((point) => ({
  lat: Math.round(point.lat * 1e5) / 1e5,
  lng: Math.round(point.lng * 1e5) / 1e5,
}));
const routeState = {
  points: [
    { id: "start", ...geometry[0] },
    { id: "end", ...geometry[geometry.length - 1] },
  ],
  selectedSegments: decoded.selectedSegments ?? [],
  geometry,
};
const header =
  `// GENERATED by scripts/nav-scenario-route-snapshot.mjs from catalog slug\n` +
  `// "${entry.slug}" (${entry.name}) on ${new Date().toISOString().slice(0, 10)}.\n` +
  `// Re-run the script to refresh after the catalog route changes.\n`;
const outPath = `packages/core/src/navigation/scenarios/routes/${entry.slug}.js`;
writeFileSync(outPath, `${header}export default ${JSON.stringify(routeState, null, 2)};\n`);
console.log(`wrote ${outPath} (${geometry.length} points)`);
```

- [ ] **Step 2: Generate the snapshot**

Run: `node scripts/nav-scenario-route-snapshot.mjs sovev-beit-hillel`
Expected: `wrote packages/core/src/navigation/scenarios/routes/sovev-beit-hillel.js (<N> points)`. (If this slug fails to decode, run with `--list` and pick another slug that decodes — `historic-jordan`, `kovshey-hagolan`… — and use that slug consistently in the next steps.)

- [ ] **Step 3: Write the real-route scenario**

Create `packages/core/src/navigation/scenarios/sovev-beit-hillel-ride.js`:

```js
import sovevBeitHillel from "./routes/sovev-beit-hillel.js";

// Full clean ride over a real catalog route (snapshot). Real geometry means
// real cue density and real corner sharpness — expectations stay structural
// (no meter windows) because the geometry may be refreshed from the catalog.
export default {
  name: "sovev-beit-hillel-ride",
  description: "רכיבה מלאה על מסלול קטלוג אמיתי (סובב בית הלל)",
  route: { routeState: sovevBeitHillel },
  track: { generate: { speedMps: 8, intervalMs: 1000, jitterM: 6, seed: 21 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "status", value: "off-route", never: true },
    { type: "arrived" },
  ],
};
```

- [ ] **Step 4: Register and run**

In `scenarios/index.js` add `import sovevBeitHillelRide from "./sovev-beit-hillel-ride.js";` and insert `sovevBeitHillelRide,` after `recordedRealRide,`.

Run: `node tests/test-nav-scenarios.mjs`
Expected: all pass. If `off-route never` fails on real geometry (a hairpin sharper than the 38 m threshold + jitter allows), reduce `jitterM` to 3; if it still fails, the artifact shows where — decide whether it's a genuine tracker weakness (report it — that's the harness doing its job) before loosening the expectation.

- [ ] **Step 5: Commit**

```bash
git add scripts/nav-scenario-route-snapshot.mjs packages/core/src/navigation/scenarios
git commit -m "feat(nav-scenarios): catalog route snapshot script + real-route scenario"
```

---

### Task 8: Visual runner — dev scenario picker in the app

**Files:**
- Create: `apps/mobile/src/planner/DevScenarioPicker.jsx`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (imports ~line 80-87; `navigationRoute` at line 749; dev state near line 787; `handleDevSimulate` at lines 914-937; render block at lines 1937-1954)

**Interfaces:**
- Consumes: `scenarios` + `resolveScenario` (Tasks 4-7); existing BuildScreen pieces: `devInnerSourceRef`, `devSourceProxy` (lines 787-798), `createSimulateRideSource(fixes, { intervalMs })`, `pendingNavigationRouteId`/`setPendingNavigationRouteId` (line 734) whose effect (lines 894-900) calls `nav.start()` once the session has re-bound to a new route id, `nav`, `navStatus`, `locationState`.
- Produces: dev-only UI only; no exports consumed elsewhere.

- [ ] **Step 1: Create the picker component**

Create `apps/mobile/src/planner/DevScenarioPicker.jsx`:

```jsx
// Dev-only navigation scenario picker (nav-scenario-harness). Rendered only
// under __DEV__ from BuildScreen; lists the shared scenario registry and a
// playback-speed toggle. Deliberately unstyled relative to the app chrome —
// it is a test harness, not product UI.
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const SPEEDS = [1, 4, 8];

export default function DevScenarioPicker({
  visible,
  scenarios,
  speed,
  onSelectSpeed,
  onSelect,
  onClose,
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Dev: simulate scenario</Text>
          <View style={styles.speedRow}>
            {SPEEDS.map((value) => (
              <Pressable
                key={value}
                onPress={() => onSelectSpeed(value)}
                style={[styles.speedChip, speed === value && styles.speedChipActive]}
              >
                <Text style={styles.speedText}>{value}×</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.list}>
            {scenarios.map((scenario) => (
              <Pressable
                key={scenario.name}
                onPress={() => onSelect(scenario)}
                style={styles.row}
              >
                <Text style={styles.rowName}>{scenario.name}</Text>
                <Text style={styles.rowDescription}>{scenario.description}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1c1c1e",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: "70%",
    padding: 16,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 10 },
  speedRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  speedChip: {
    borderColor: "#555",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  speedChipActive: { backgroundColor: "#3a6", borderColor: "#3a6" },
  speedText: { color: "#fff", fontSize: 13 },
  list: { flexGrow: 0 },
  row: { borderTopColor: "#333", borderTopWidth: 1, paddingVertical: 10 },
  rowName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  rowDescription: { color: "#aaa", fontSize: 12, marginTop: 2 },
  close: { alignItems: "center", paddingVertical: 12 },
  closeText: { color: "#3a6", fontSize: 14, fontWeight: "600" },
});
```

- [ ] **Step 2: Wire BuildScreen — imports and state**

In `apps/mobile/src/screens/BuildScreen.jsx`:

(a) Next to the existing dev-harness imports (lines 80-87), add:

```js
import { scenarios as devScenarios } from "@cycleways/core/navigation/scenarios/index.js";
import { resolveScenario } from "@cycleways/core/navigation/scenarios/resolve.js";
import DevScenarioPicker from "../planner/DevScenarioPicker.jsx";
```

Confirm `Alert` is in the `react-native` import list at the top of the file; add it if missing.

Known cost: the registry import pulls scenario data (including the catalog route snapshot, ~a few hundred KB) into the app bundle even in production, since Metro does not tree-shake it away. Acceptable for v1; a dev-only entry point is a noted future improvement — do not attempt it in this plan.

(b) Next to `devInnerSourceRef` (line 787), add:

```js
  const [devPickerVisible, setDevPickerVisible] = useState(false);
  const [devSpeed, setDevSpeed] = useState(4);
  const [devScenarioRoute, setDevScenarioRoute] = useState(null);
```

(c) Replace line 749 so a running dev scenario can carry its own route:

```js
  const navigationRoute =
    (__DEV__ && devScenarioRoute) ||
    confirmedRidePlan?.effectiveRoute ||
    sourceNavigationRoute;
```

Note: `devScenarioRoute` is declared after this line in the current layout — move the three dev `useState` declarations from (b) up next to `pendingNavigationRouteId` (line 734) so they precede line 749.

- [ ] **Step 3: Wire BuildScreen — handlers and cleanup**

Replace the body of `handleDevSimulate` (lines 914-937) with:

```js
  const handleDevSimulate = useCallback(() => {
    if (!__DEV__) return;
    setDevPickerVisible(true);
  }, []);

  // Resolve the picked scenario through the same resolver the headless suite
  // uses (identical fixes for the same seed), install the simulated source on
  // the dev proxy, and start. Scenarios that carry their own route go through
  // the pendingNavigationRouteId effect so nav.start() runs only after the
  // session has re-bound to the scenario route.
  const handleDevScenarioSelect = useCallback(
    (scenario) => {
      if (!__DEV__) return;
      let resolved;
      try {
        resolved = resolveScenario(scenario, {
          currentNavigationRoute: navigationRoute,
        });
      } catch (error) {
        Alert.alert("Scenario error", String(error?.message || error));
        return;
      }
      setDevPickerVisible(false);
      devInnerSourceRef.current = createSimulateRideSource(resolved.fixes, {
        intervalMs: Math.max(60, Math.round(1000 / devSpeed)),
      });
      if (resolved.navigationRoute.id !== navigationRoute?.id) {
        setDevScenarioRoute(resolved.navigationRoute);
        setPendingNavigationRouteId(resolved.navigationRoute.id);
      } else {
        void nav.start();
      }
    },
    [devSpeed, nav, navigationRoute],
  );
```

After `handleDevRecord` (line 968), add the teardown effect:

```js
  // When a dev session ends, drop the scenario route override and the injected
  // source so the next navigation uses the real route and real GPS. (Also
  // fixes the pre-existing leak where a SIM source survived into later rides.)
  useEffect(() => {
    if (!__DEV__) return;
    if (pendingNavigationRouteId) return;
    if (navStatus !== "ended" && navStatus !== "error") return;
    if (devScenarioRoute) setDevScenarioRoute(null);
    devInnerSourceRef.current = null;
  }, [devScenarioRoute, navStatus, pendingNavigationRouteId]);
```

- [ ] **Step 4: Wire BuildScreen — render**

Immediately after the dev-controls block (line 1954, after the closing `) : null}`), add:

```jsx
      {__DEV__ ? (
        <DevScenarioPicker
          visible={devPickerVisible}
          scenarios={devScenarios}
          speed={devSpeed}
          onSelectSpeed={setDevSpeed}
          onSelect={handleDevScenarioSelect}
          onClose={() => setDevPickerVisible(false)}
        />
      ) : null}
```

Also relax the dev-controls visibility condition (line 1937) so the picker is reachable without a built route (scenarios carry their own routes):

```jsx
      {__DEV__ && !isNavigating ? (
```

Inside that block, keep the REC button conditional on a usable route by wrapping it: `{navigationRoute?.geometry?.length >= 2 ? (<Pressable …REC…/>) : null}`.

- [ ] **Step 5: Verify on the simulator**

Run: `cd apps/mobile && npx expo run:ios` (or launch the existing dev build).

Manual checklist (watch the screen — this is the visual runner's acceptance test):
1. Build screen with no route → SIM opens the picker; picking `current-route-generic` shows the "requires a navigable current route" alert.
2. Pick `on-route-happy-path` at 8× → the L-route appears, navigation starts, the puck rides leg 1, the left-turn banner (`פנה שמאלה אל שביל הצפון`) appears before the corner, arrival fires at the end.
3. Pick `missed-turn-reroute` at 4× → off-route state + rejoin suggestion line appear during the excursion, then the ride rejoins and completes.
4. Stop navigation mid-scenario → back to the normal Build screen; start a real route and confirm GPS (not the sim) drives the puck (teardown works).
5. Load a catalog route (Discover → route → navigate flow), SIM → `current-route-generic` → the old one-tap sim behavior on the open route.

- [ ] **Step 6: Run the node suite once more**

Run: `npm test`
Expected: passes (app changes must not affect core/tests).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/planner/DevScenarioPicker.jsx apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(nav-scenarios): dev scenario picker with speed control in BuildScreen"
```

---

### Task 9: Final verification and docs

**Files:**
- Modify: `plans/nav-scenario-harness/design.md` (only if any implemented behavior diverged beyond the refinement note already recorded)

**Steps:**

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: full chain green, including the five new test files.

- [ ] **Step 2: Failure-artifact drill (verifies the agent feedback loop)**

Temporarily break one expectation (e.g. change `missed-turn-reroute`'s `betweenMeters` to `[10, 20]`), run `node tests/test-nav-scenarios.mjs`, and confirm: exit code 1, the failure message names the expectation, and `test-results/nav-scenarios/missed-turn-reroute.json` contains the timeline with per-entry presentation strings. Revert the change and re-run to green.

- [ ] **Step 3: Reconcile the design doc**

Compare `plans/nav-scenario-harness/design.md` against what shipped; the routeState-module refinement is already noted there. Record any additional divergences (e.g. a different snapshot slug) in a short "Implementation notes" section at the bottom.

- [ ] **Step 4: Commit any doc updates**

```bash
git add plans/nav-scenario-harness
git commit -m "docs(nav-scenarios): reconcile design with shipped implementation"
```
