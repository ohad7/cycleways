# Navigation UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Active navigation becomes its own visual mode — full-screen pre-ride setup, one top cue card with collapse-to-pill, on-map segment/approach/rejoin chips, a minimal control row (data pill + pause/stop, contextual recenter), an arrival summary card, and a five-stage camera director — per `plans/nav-ui-redesign/design.md`.

**Architecture:** All decision logic goes into `@cycleways/core` (progress gains a smoothed speed, the session gains a resettable ride-start timestamp, the presentation gains `cardMode`/`chip`/`speedText`/`cuePrimaryText`/`cueSecondaryText`/`arrivalSummary`, and a new pure `cameraDirector` decides declarative follow-vs-fit shots per fix). The scenario-harness timeline exposes the new fields so scenarios assert them in CI. `NavPanel.jsx`, `RideSetupSheet.jsx`, and `BuildScreen.jsx` become renderers of those models.

**Tech Stack:** plain ESM JS in `packages/core/src` (no node-only APIs), node `assert/strict` tests chained in the root `package.json` `test` script, React Native (Expo) for the app side. No new dependencies.

## Global Constraints

- `packages/core/src/**` is pure ESM; `fs`/`path` only in `tests/` and `scripts/`.
- Hebrew strings live in `navigationPresentation.js` and must match tests byte-for-byte (`עיקול ימינה`, `חזרה למסלול`, `המסלול המוצע`, `קמ״ש`).
- Do NOT touch `data/map-source.geojson` or anything in `public-data/`.
- New test files are inserted into the root `package.json` `test` chain at the location each task states.
- App-side (`apps/mobile`) changes are `__DEV__`-agnostic product UI; verify each app task compiles with `node_modules/.bin/esbuild --loader:.jsx=jsx apps/mobile/src/screens/BuildScreen.jsx --outfile=/dev/null` (and the same for any other `.jsx` file touched) and visually via the dev scenario picker.
- Camera-director numbers come from the design table: approach pitch 20°, ride pitch 50° + zoom 16.8↔15.8 by speed, pre-turn pitch 35° zoom 17.2, off-route pitch 20°, arrival pitch 35° zoom 17.2, arrived pitch 0 + whole-route fit.
- Pre-turn begins when a turn/bend cue becomes active (the existing 120 m preview window in `navigationCues.js`).
- Snapshot scenario routes (`sovev-beit-hillel`, `banias-gan-hatsafon`) have no `segmentSpans`, so segment-chip scenario assertions use the synthetic l-turn scenarios (whose spans carry `דרך הפרדס` / `שביל הצפון`); Task 9 records this too.

## Review Updates To Preserve During Implementation

- Smoothed speed must not double-count the current fix. Compute it after
  `recordCourseFix(fix)` from the recorded history, or compute it before
  recording and include the current fix exactly once.
- `rideStartTimestamp` resets to `null` whenever `PERMISSION_GRANTED` resets a
  session; otherwise a second ride inherits elapsed time from the previous one.
- Off-route state wins over arrival. `cardMode === "arrived"` and camera stage
  `"arrived"` require acquired route, `remainingMeters <= 15`, and
  `offRoute !== true`.
- The presentation model exposes `cuePrimaryText` and `cueSecondaryText`.
  `cueText` may remain for backward compatibility, but `NavPanel` must render
  the split fields instead of parsing or reusing route context text.
- `roadClassChipLabel()` must cover route classes seen in existing navigation
  spans: `cycleway`, `path`, `track`, `path_track`, `footway`, `local_road`,
  `road`, and `residential`, with a conservative fallback.
- Camera director hysteresis tracks a candidate stage and candidate start time.
  A stage that appears briefly long after the previous accepted stage must not
  switch immediately. `off-route` and `arrived` remain immediate.
- Approach/off-route/arrived camera shots are declarative fit shots, not only
  zoom approximations. BuildScreen resolves fit points and calls its existing
  fit helper / array-padding convention.
- `RideSetupSheet.jsx` is part of this redesign: `הכנת הרכיבה` becomes a
  full-screen opaque pre-ride setup gate. The map should not peek underneath
  except during the explicit map-pick mode.
- Scenario timeline assertions should validate `cardMode` in addition to
  `cameraStage` and chips.

---

### Task 1: Smoothed rider speed in routeProgress

**Files:**
- Modify: `packages/core/src/navigation/routeProgress.js`
- Test: `tests/test-route-progress.mjs` (append a block; file already in the test chain)

**Interfaces:**
- Consumes: the existing `courseHistory` ring buffer (entries `{ lat, lng, timestamp }`, recorded per fix by `recordCourseFix`).
- Produces: `update(fix)` result gains `smoothedSpeedMps` — average of finite fix speeds over the last 3 s (including the current fix), `null` when no finite speeds exist in the window. Task 3 (presentation `speedText`) and Task 4 (ride-zoom breathing) consume it.

- [ ] **Step 1: Write the failing test**

Append to `tests/test-route-progress.mjs`, immediately before the final `console.log` line:

```js
// --- smoothedSpeedMps: 3 s average of fix speeds -----------------------------
{
  const mPerDegLng = 111320 * Math.cos((33.1 * Math.PI) / 180);
  const fix = (meters, timestamp, speed) => ({
    lat: 33.1,
    lng: 35.6 + meters / mPerDegLng,
    accuracy: 5,
    speed,
    timestamp,
  });
  const tracker = createRouteProgressTracker(straightRoute());
  tracker.update(fix(0, 1000, 4));
  tracker.update(fix(5, 2000, 5));
  const third = tracker.update(fix(10, 3000, 6));
  assert.ok(
    Math.abs(third.smoothedSpeedMps - 5) < 0.01,
    `average of 4,5,6 over 3 s is 5, got ${third.smoothedSpeedMps}`,
  );
  // Older fixes fall out of the window.
  const fourth = tracker.update(fix(15, 5500, 8));
  assert.ok(
    Math.abs(fourth.smoothedSpeedMps - 7) < 0.01,
    `only the 6 (t=3000) and 8 (t=5500) are within 3 s, got ${fourth.smoothedSpeedMps}`,
  );
  // No finite speeds in the window -> null.
  const noSpeed = tracker.update({
    lat: 33.1, lng: 35.6 + 20 / mPerDegLng, accuracy: 5, timestamp: 20000,
  });
  assert.equal(noSpeed.smoothedSpeedMps, null, "no finite speed -> null");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-route-progress.mjs`
Expected: FAIL with `average of 4,5,6 over 3 s is 5, got undefined`

- [ ] **Step 3: Implement**

In `packages/core/src/navigation/routeProgress.js`:

(a) Next to the other wrong-way constants add:

```js
const SPEED_WINDOW_MS = 3000; // smoothed rider speed = mean fix speed over this
```

(b) In `recordCourseFix`, keep the fix speed:

```js
  function recordCourseFix(fix) {
    courseHistory.push({
      lat: fix.lat,
      lng: fix.lng,
      timestamp: fix.timestamp,
      speed: Number.isFinite(fix.speed) ? fix.speed : null,
    });
    if (courseHistory.length > COURSE_HISTORY_LIMIT) courseHistory.shift();
  }
```

(c) Below `smoothedCourse`, add:

```js
  // Mean of finite fix speeds over the last SPEED_WINDOW_MS (including the
  // current fix): steady enough for a readout, responsive enough to feel live.
  function smoothedSpeed(nowMs) {
    const speeds = [];
    for (let i = courseHistory.length - 1; i >= 0; i--) {
      const entry = courseHistory[i];
      if (nowMs - entry.timestamp > SPEED_WINDOW_MS) break;
      if (Number.isFinite(entry.speed)) speeds.push(entry.speed);
    }
    if (speeds.length === 0) return null;
    return speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
  }
```

(d) Add `smoothedSpeedMps` to BOTH result objects of `update()` — the early
"still approaching" return (next to `smoothedCourseDeg:
approachSmoothedCourse,`) and the main return (next to `smoothedCourseDeg,`).
Compute it after `recordCourseFix(fix)` so the current fix is included exactly
once:

```js
        const approachSmoothedCourse = smoothedCourse(fix);
        prevFix = fix;
        recordCourseFix(fix);
        const approachSmoothedSpeed = smoothedSpeed(fix.timestamp);
```

and in the main path:

```js
    prevFix = fix;
    recordCourseFix(fix);
    const smoothedSpeedMps = smoothedSpeed(fix.timestamp);
```

Then return `smoothedSpeedMps: approachSmoothedSpeed` in the approaching object
and `smoothedSpeedMps` in the main object. Do not also push `fix.speed` inside
`smoothedSpeed()`; the test above catches that double-counting bug.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-route-progress.mjs`
Expected: `route progress tests passed`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/routeProgress.js tests/test-route-progress.mjs
git commit -m "feat(nav): smoothed rider speed on progress output"
```

---

### Task 2: Ride start timestamp on the session

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js`
- Test: `tests/test-navigation-session.mjs` (append a block; already in the chain)

**Interfaces:**
- Consumes: the session's `LOCATION` action handling (`dispatch({ type: NAV_ACTIONS.LOCATION, fix })`).
- Produces: `state.rideStartTimestamp` — the timestamp of the first LOCATION fix of the session, `null` before it. Task 3's `arrivalSummary` (elapsed/avg speed) consumes it.

- [ ] **Step 1: Write the failing test**

Append to `tests/test-navigation-session.mjs`, before its final `console.log`:

```js
// --- rideStartTimestamp: first fix of the session ---------------------------
{
  const route = navigationRouteFromRouteState(
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
    { param: "ride-start-ts" },
  );
  const session = createNavigationSession(route);
  session.dispatch({ type: NAV_ACTIONS.START });
  let state = session.dispatch({
    type: NAV_ACTIONS.PERMISSION_GRANTED,
    background: false,
  });
  assert.equal(state.rideStartTimestamp, null, "null before the first fix");
  state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 7000 },
  });
  assert.equal(state.rideStartTimestamp, 7000, "set from the first fix");
  state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6005, accuracy: 5, speed: 4, timestamp: 9000 },
  });
  assert.equal(state.rideStartTimestamp, 7000, "unchanged by later fixes");
}
```

If the file imports `createNavigationSession` / `NAV_ACTIONS` / `navigationRouteFromRouteState` already (it does — check the imports at the top), reuse them; otherwise add the missing import lines to the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL with `set from the first fix` (actual `undefined`)

- [ ] **Step 3: Implement**

In `packages/core/src/navigation/navigationSession.js`:

(a) Add to the initial `state` object (next to `justAcquired: false,`):

```js
    rideStartTimestamp: null,
```

(b) In the `PERMISSION_GRANTED` return patch, add:

```js
          rideStartTimestamp: null,
```

This reset is required for the second and later rides in the same app session.

(c) In the `LOCATION` action handler, immediately before `const mainProgress = mainTracker.update(action.fix);` add:

```js
        if (state.rideStartTimestamp === null) {
          state = set({ rideStartTimestamp: action.fix.timestamp });
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-replay.mjs && node tests/test-nav-scenarios.mjs`
Expected: all pass (the replay/scenario suites exercise the same session).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): record the ride start timestamp on the session"
```

---

### Task 3: Presentation models — cardMode, chip, speedText, arrivalSummary

**Files:**
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Test: `tests/test-navigation-presentation.mjs` (append; already in the chain)

**Interfaces:**
- Consumes: `state.progress` (`currentSegmentName`, `currentRouteClass`, `remainingMeters`, `progressMeters`, `hasAcquiredRoute`, `smoothedSpeedMps` from Task 1), `state.rideStartTimestamp` (Task 2), `state.latestFix.timestamp`, `state.activeCue`, `state.approach.suggestionGeometry`, existing `status`/`offRoute`.
- Produces (new keys on `getNavigationPresentation`'s return object; Tasks 5–7 consume them):
  - `cardMode`: `"arrived" | "off-route" | "approach" | "cue" | "status"`.
  - `chip`: `{ kind: "segment" | "approach" | "rejoin", text: string } | null`.
  - `speedText`: `"17.5 קמ״ש"` style string, `""` when speed is null or `< 1 m/s`.
  - `cuePrimaryText` / `cueSecondaryText`: split cue-card lines (`פנה שמאלה`
    / `אל שביל הצפון`) so the UI does not parse `cueText` or misuse route
    context as the secondary cue line.
  - `arrivalSummary`: `{ distanceText, elapsedText, avgSpeedText } | null` (non-null only when `cardMode === "arrived"`).
  - Exported helper `roadClassChipLabel(routeClass)` (bare-noun labels).

**Decision rules (implement exactly):**
- `cardMode`: `"off-route"` when `offRoute`; else `"arrived"` when `progress.hasAcquiredRoute && progress.remainingMeters <= 15`; else `"approach"` when `status === "approaching"`; else `"cue"` when an `activeCue` exists (any type except `start`); else `"status"`.
- `chip`: off-route → `{ kind: "rejoin", text: "חזרה למסלול" }`; approaching with `suggestionGeometry.length >= 2` → `{ kind: "approach", text: "המסלול המוצע" }`; approaching without → `null`; `cardMode === "cue"` or `"arrived"` → segment chip: `name && label` → `` `${name} · ${label}` ``, else `name || label || null` mapped into `{ kind: "segment", text }` (null text → chip null); `cardMode === "status"` → `null` (the collapsed pill already shows the name).
- `roadClassChipLabel`: `cycleway → "שביל אופניים"`, `track`/`path_track → "דרך עפר"`, `path → "שביל"`, `footway → "מדרכה"`, `local_road`/`road`/`residential → "כביש"`, anything else → `null`.
- `cuePrimaryText` / `cueSecondaryText`: turns with `ontoSegmentName` split the
  current `cueDisplay` text into primary direction text and `אל ...`;
  `enter-segment` uses primary `המשך במסלול` and secondary `אל ...` when a
  segment name exists; bends and hazards generally have an empty secondary
  unless next-segment context is within the design window.

- [ ] **Step 1: Write the failing test**

Append to `tests/test-navigation-presentation.mjs` before its final `console.log`:

```js
// --- cardMode / chip / speedText / arrivalSummary ---------------------------
{
  const riding = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: {
      cue: { type: "turn", direction: "left", ontoSegmentName: "שביל הצפון" },
      phase: "preview",
      distanceToCueMeters: 100,
    },
    latestFix: { timestamp: 600000 },
    rideStartTimestamp: 0,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 800,
      progressMeters: 400,
      currentSegmentName: "דרך נוף הירדן",
      currentRouteClass: "track",
      smoothedSpeedMps: 4.87,
      wrongWay: false,
    },
  });
  assert.equal(riding.cardMode, "cue");
  assert.equal(riding.cuePrimaryText, "פנה שמאלה");
  assert.equal(riding.cueSecondaryText, "אל שביל הצפון");
  assert.deepEqual(riding.chip, { kind: "segment", text: "דרך נוף הירדן · דרך עפר" });
  assert.equal(riding.speedText, "17.5 קמ״ש");
  assert.equal(riding.arrivalSummary, null);

  const cruising = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    activeCue: null,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 800,
      progressMeters: 400,
      currentSegmentName: "דרך נוף הירדן",
      currentRouteClass: "track",
      smoothedSpeedMps: 0.4,
      wrongWay: false,
    },
  });
  assert.equal(cruising.cardMode, "status");
  assert.equal(cruising.chip, null, "status pill shows the name; no duplicate chip");
  assert.equal(cruising.speedText, "", "standing still shows no speed");

  const offRoute = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    progress: { hasAcquiredRoute: true, remainingMeters: 8, wrongWay: false },
  });
  assert.equal(offRoute.cardMode, "off-route");
  assert.deepEqual(offRoute.chip, { kind: "rejoin", text: "חזרה למסלול" });

  const approaching = getNavigationPresentation({
    status: "approaching",
    approach: {
      suggestionGeometry: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }],
      suggestionStatus: "ready",
      distanceToRouteMeters: 500,
    },
    progress: { hasAcquiredRoute: false, wrongWay: false },
  });
  assert.equal(approaching.cardMode, "approach");
  assert.deepEqual(approaching.chip, { kind: "approach", text: "המסלול המוצע" });

  const arrived = getNavigationPresentation({
    status: "navigating",
    offRoute: false,
    latestFix: { timestamp: 4320000 }, // 72 min after start
    rideStartTimestamp: 0,
    progress: {
      hasAcquiredRoute: true,
      remainingMeters: 8,
      progressMeters: 14800,
      smoothedSpeedMps: 3,
      wrongWay: false,
    },
  });
  assert.equal(arrived.cardMode, "arrived");
  assert.equal(arrived.arrivalSummary.distanceText, "14.8 ק״מ");
  assert.equal(arrived.arrivalSummary.elapsedText, "1:12");
  assert.equal(arrived.arrivalSummary.avgSpeedText, "12.3 קמ״ש");
}

// --- roadClassChipLabel: bare noun form --------------------------------------
{
  const { roadClassChipLabel } = await import(
    "@cycleways/core/navigation/navigationPresentation.js"
  );
  assert.equal(roadClassChipLabel("cycleway"), "שביל אופניים");
  assert.equal(roadClassChipLabel("track"), "דרך עפר");
  assert.equal(roadClassChipLabel("path_track"), "דרך עפר");
  assert.equal(roadClassChipLabel("path"), "שביל");
  assert.equal(roadClassChipLabel("footway"), "מדרכה");
  assert.equal(roadClassChipLabel("local_road"), "כביש");
  assert.equal(roadClassChipLabel("road"), "כביש");
  assert.equal(roadClassChipLabel("residential"), "כביש");
  assert.equal(roadClassChipLabel("anything-else"), null);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-presentation.mjs`
Expected: FAIL with `cardMode` undefined mismatch.

- [ ] **Step 3: Implement**

In `packages/core/src/navigation/navigationPresentation.js`:

(a) Below `routeClassLabel`, add the exported bare-noun helper:

```js
// Bare noun for the on-map chip ("דרך עפר"); routeClassLabel keeps the
// prefixed form ("בדרך עפר") used in sentence context.
export function roadClassChipLabel(routeClass) {
  switch (routeClass) {
    case "cycleway": return "שביל אופניים";
    case "track": return "דרך עפר";
    case "path_track": return "דרך עפר";
    case "path": return "שביל";
    case "footway": return "מדרכה";
    case "local_road":
    case "road":
    case "residential": return "כביש";
    default: return null;
  }
}
```

(b) Inside `getNavigationPresentation`, after the existing `const cue = cueDisplay(...)` block, add the model derivations:

```js
  const progress = state.progress || null;
  const arrived =
    !offRoute &&
    progress?.hasAcquiredRoute === true &&
    Number.isFinite(progress?.remainingMeters) &&
    progress.remainingMeters <= 15;
  const cardMode = arrived
    ? "arrived"
    : offRoute
      ? "off-route"
      : status === "approaching"
        ? "approach"
        : active && active.cue?.type !== "start"
          ? "cue"
          : "status";

  const segmentChipText = (() => {
    const name = progress?.currentSegmentName || null;
    const label = roadClassChipLabel(progress?.currentRouteClass);
    if (name && label) return `${name} · ${label}`;
    return name || label || null;
  })();
  const chip = offRoute
    ? { kind: "rejoin", text: "חזרה למסלול" }
    : status === "approaching"
      ? (hasSuggestionGeometry ? { kind: "approach", text: "המסלול המוצע" } : null)
      : (cardMode === "cue" || cardMode === "arrived") && segmentChipText
        ? { kind: "segment", text: segmentChipText }
        : null;

  const speedMps = progress?.smoothedSpeedMps;
  const speedText =
    Number.isFinite(speedMps) && speedMps >= 1
      ? `${(speedMps * 3.6).toFixed(1)} קמ״ש`
      : "";

  let arrivalSummary = null;
  if (cardMode === "arrived") {
    const elapsedMs =
      Number.isFinite(state.latestFix?.timestamp) &&
      Number.isFinite(state.rideStartTimestamp)
        ? state.latestFix.timestamp - state.rideStartTimestamp
        : null;
    const minutes = elapsedMs !== null ? Math.round(elapsedMs / 60000) : null;
    const elapsedText =
      minutes === null
        ? ""
        : minutes >= 60
          ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
          : `${minutes} דק׳`;
    const avgMps =
      elapsedMs > 0 && Number.isFinite(progress?.progressMeters)
        ? progress.progressMeters / (elapsedMs / 1000)
        : null;
    arrivalSummary = {
      distanceText: formatDistanceMeters(progress?.progressMeters),
      elapsedText,
      avgSpeedText: Number.isFinite(avgMps) ? `${(avgMps * 3.6).toFixed(1)} קמ״ש` : "",
    };
  }
```

Add cue-line derivation beside the model block:

```js
  const cuePrimaryText = (() => {
    const c = active?.cue || null;
    if (!c) return cue.text;
    if (c.type === "turn") return c.direction === "right" ? "פנה ימינה" : "פנה שמאלה";
    if (c.type === "enter-segment") return "המשך במסלול";
    return cue.text;
  })();
  const cueSecondaryText = (() => {
    const c = active?.cue || null;
    if (!c) return "";
    if (c.type === "turn" && c.ontoSegmentName) return `אל ${c.ontoSegmentName}`;
    if (c.type === "enter-segment" && c.segmentName) return `אל ${c.segmentName}`;
    if (
      progress?.nextSegmentName &&
      Number.isFinite(progress?.distanceToNextSegmentMeters) &&
      progress.distanceToNextSegmentMeters <= 300
    ) {
      return `אל ${progress.nextSegmentName}`;
    }
    return "";
  })();
```

Note: `hasSuggestionGeometry`, `active`, `offRoute`, `status`, `cue`, and `formatDistanceMeters` already exist in this scope — place the block after they are defined.

(c) Add to the returned object: `cardMode,`, `chip,`, `speedText,`,
`cuePrimaryText,`, `cueSecondaryText,`, `arrivalSummary,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-presentation.mjs && node tests/test-nav-scenarios.mjs`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationPresentation.js tests/test-navigation-presentation.mjs
git commit -m "feat(nav): presentation models for cue card, chips, speed, arrival"
```

---

### Task 4: Camera director

**Files:**
- Create: `packages/core/src/navigation/cameraDirector.js`
- Test: `tests/test-camera-director.mjs`
- Modify: `package.json` (insert `node tests/test-camera-director.mjs && ` immediately after `node tests/test-camera-heading.mjs && `)

**Interfaces:**
- Consumes: session-state shape `{ status, offRoute, activeCue, approach, progress: { hasAcquiredRoute, remainingMeters, guidanceDistanceMeters, smoothedSpeedMps } }`.
- Produces:
  - `createCameraDirector() -> { update(state, nowMs) -> shot, reset() }` where `shot = { stage, mode, pitch, zoom?, centerBias?, focusKind?, fitKind? }`.
  - `stage`: `"approach" | "ride" | "pre-turn" | "off-route" | "arrival" | "arrived"`.
  - `mode`: `"follow"` for normal rider-centered shots; `"fit"` for overview shots where BuildScreen resolves fit points and calls the existing fit helper.
  - `centerBias`: 0..1 — for follow shots, how far from the rider toward the stage focus point to center (BuildScreen resolves the focus point per `focusKind`).
  - `fitKind`: `"approach" | "rejoin" | "route"` for fit shots.
  - `zoomForSpanMeters(spanMeters)` exported for tests: `clamp(12, 17.5, 17.5 - log2(max(50, span) / 100))`.
- Stage decision order (first match): `off-route` (offRoute true) → `arrived` (acquired && remaining ≤ 15) → `approach` (status approaching) → `arrival` (activeCue arrive && distanceToCueMeters ≤ 150) → `pre-turn` (activeCue turn|bend) → `ride`.
- Hysteresis: a stage change is adopted only after the candidate stage has been continuously wanted for ≥2000 ms, EXCEPT changes into `off-route` or `arrived`, which are immediate. Until adopted, `update` keeps returning the previous stage's shot (recomputed with current inputs). Do not implement this as "time since previous accepted stage"; that incorrectly switches on a transient cue that appears long after the last accepted stage.
- Shots: approach `{ mode: "fit", pitch 20, fitKind: "approach" }`; ride `{ mode: "follow", pitch 50, zoom = 16.8 + (15.8 − 16.8) · clamp01((speed − 2) / 6), centerBias 0 }` (speed = `smoothedSpeedMps ?? 3`); pre-turn `{ mode: "follow", pitch 35, zoom 17.2, centerBias 0.5, focusKind: "cue" }`; off-route `{ mode: "fit", pitch 20, fitKind: "rejoin" }`; arrival `{ mode: "follow", pitch 35, zoom 17.2, centerBias 0.4, focusKind: "cue" }`; arrived `{ mode: "fit", pitch 0, fitKind: "route" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-camera-director.mjs`:

```js
// tests/test-camera-director.mjs — stage-aware navigation camera shots.
import assert from "node:assert/strict";
import {
  createCameraDirector,
  zoomForSpanMeters,
} from "@cycleways/core/navigation/cameraDirector.js";

const riding = (over = {}) => ({
  status: "navigating",
  offRoute: false,
  activeCue: null,
  approach: null,
  progress: {
    hasAcquiredRoute: true,
    remainingMeters: 5000,
    smoothedSpeedMps: 5,
    guidanceDistanceMeters: null,
  },
  ...over,
});

// zoomForSpanMeters: monotone, clamped.
{
  assert.ok(Math.abs(zoomForSpanMeters(100) - 17.5) < 0.01);
  assert.ok(Math.abs(zoomForSpanMeters(400) - 15.5) < 0.01);
  assert.ok(Math.abs(zoomForSpanMeters(1600) - 13.5) < 0.01);
  assert.equal(zoomForSpanMeters(1e9), 12, "clamped low");
  assert.equal(zoomForSpanMeters(10), 17.5, "clamped high (span floor 50)");
}

// Ride: pitch 50, speed-breathing zoom.
{
  const director = createCameraDirector();
  const slow = director.update(
    riding({ progress: { ...riding().progress, smoothedSpeedMps: 2 } }),
    0,
  );
  assert.equal(slow.stage, "ride");
  assert.equal(slow.pitch, 50);
  assert.ok(Math.abs(slow.zoom - 16.8) < 0.01, "slow = zoomed in");
  const fast = director.update(
    riding({ progress: { ...riding().progress, smoothedSpeedMps: 8 } }),
    100,
  );
  assert.ok(Math.abs(fast.zoom - 15.8) < 0.01, "fast = zoomed out");
}

// Approach and off-route shots.
{
  const director = createCameraDirector();
  const approach = director.update(
    riding({
      status: "approaching",
      approach: { distanceToRouteMeters: 400 },
      progress: { hasAcquiredRoute: false, remainingMeters: 5000, smoothedSpeedMps: 5 },
    }),
    0,
  );
  assert.equal(approach.stage, "approach");
  assert.equal(approach.mode, "fit");
  assert.equal(approach.pitch, 20);
  assert.equal(approach.fitKind, "approach");

  const off = director.update(
    riding({
      status: "off-route",
      offRoute: true,
      progress: { ...riding().progress, guidanceDistanceMeters: 150 },
    }),
    100, // within the dwell window — off-route must still win immediately
  );
  assert.equal(off.stage, "off-route", "off-route adopts immediately");
  assert.equal(off.mode, "fit");
  assert.equal(off.fitKind, "rejoin");
}

// Pre-turn waits for the candidate dwell; a turn cue seen only briefly does not switch.
{
  const director = createCameraDirector();
  director.update(riding(), 0);
  const early = director.update(
    riding({ activeCue: { cue: { type: "turn" }, distanceToCueMeters: 110 } }),
    1000,
  );
  assert.equal(early.stage, "ride", "pre-turn waits out the 2 s dwell");
  const gone = director.update(riding(), 1500);
  assert.equal(gone.stage, "ride", "transient cue does not leave a stale candidate");
  const candidateAgain = director.update(
    riding({ activeCue: { cue: { type: "turn" }, distanceToCueMeters: 95 } }),
    1700,
  );
  assert.equal(candidateAgain.stage, "ride", "candidate dwell restarts after disappearing");
  const adopted = director.update(
    riding({ activeCue: { cue: { type: "turn" }, distanceToCueMeters: 90 } }),
    3800,
  );
  assert.equal(adopted.stage, "pre-turn");
  assert.equal(adopted.mode, "follow");
  assert.equal(adopted.pitch, 35);
  assert.equal(adopted.zoom, 17.2);
  assert.equal(adopted.centerBias, 0.5);
  assert.equal(adopted.focusKind, "cue");
  // Bends get the same treatment.
  const bend = createCameraDirector();
  bend.update(riding(), 0);
  const bendShot = bend.update(
    riding({ activeCue: { cue: { type: "bend" }, distanceToCueMeters: 80 } }),
    2100,
  );
  assert.equal(bendShot.stage, "pre-turn");
}

// Arrival then arrived; arrived fits the route and is immediate.
{
  const director = createCameraDirector();
  director.update(riding(), 0);
  const arrival = director.update(
    riding({
      activeCue: { cue: { type: "arrive" }, distanceToCueMeters: 120 },
      progress: { ...riding().progress, remainingMeters: 120 },
    }),
    3000,
  );
  assert.equal(arrival.stage, "arrival");
  const done = director.update(
    riding({ progress: { ...riding().progress, remainingMeters: 8 } }),
    3200, // inside the dwell — arrived is immediate anyway
  );
  assert.equal(done.stage, "arrived");
  assert.equal(done.mode, "fit");
  assert.equal(done.pitch, 0);
  assert.equal(done.fitKind, "route");
}

// Off-route wins over arrived when both conditions are true.
{
  const director = createCameraDirector();
  const shot = director.update(
    riding({
      status: "off-route",
      offRoute: true,
      progress: { ...riding().progress, remainingMeters: 8 },
    }),
    0,
  );
  assert.equal(shot.stage, "off-route");
  assert.equal(shot.fitKind, "rejoin");
}

// reset() forgets the stage.
{
  const director = createCameraDirector();
  director.update(riding({ status: "off-route", offRoute: true }), 0);
  director.reset();
  assert.equal(director.update(riding(), 10).stage, "ride");
}

console.log("camera director tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-camera-director.mjs`
Expected: FAIL with `Cannot find module ... cameraDirector.js`

- [ ] **Step 3: Implement**

Create `packages/core/src/navigation/cameraDirector.js`:

```js
// Stage-aware navigation camera (nav-ui-redesign). Decides per fix WHAT the
// camera should do: a follow shot (pitch/zoom/center bias) or a declarative fit
// shot (approach/rejoin/whole-route). The heading governor (cameraHeading.js)
// keeps deciding orientation; BuildScreen resolves focus/fit points.

const MIN_STAGE_DWELL_MS = 2000; // stage changes settle; off-route/arrived skip it
const ARRIVED_REMAINING_M = 15;
const ARRIVAL_CUE_MAX_M = 150;

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

// Zoom that frames a span of roughly `spanMeters` on a phone screen.
export function zoomForSpanMeters(spanMeters) {
  const span = Math.max(50, Number(spanMeters) || 0);
  return clamp(12, 17.5, 17.5 - Math.log2(span / 100));
}

function stageFor(state) {
  const progress = state?.progress || null;
  if (state?.offRoute === true) return "off-route";
  if (
    progress?.hasAcquiredRoute === true &&
    Number.isFinite(progress?.remainingMeters) &&
    progress.remainingMeters <= ARRIVED_REMAINING_M
  ) {
    return "arrived";
  }
  if (state?.status === "approaching") return "approach";
  const cueType = state?.activeCue?.cue?.type ?? null;
  if (
    cueType === "arrive" &&
    (state.activeCue.distanceToCueMeters ?? Infinity) <= ARRIVAL_CUE_MAX_M
  ) {
    return "arrival";
  }
  if (cueType === "turn" || cueType === "bend") return "pre-turn";
  return "ride";
}

function shotFor(stage, state) {
  const progress = state?.progress || null;
  switch (stage) {
    case "approach":
      return { stage, mode: "fit", pitch: 20, fitKind: "approach" };
    case "off-route":
      return { stage, mode: "fit", pitch: 20, fitKind: "rejoin" };
    case "pre-turn":
      return {
        stage,
        mode: "follow",
        pitch: 35,
        zoom: 17.2,
        centerBias: 0.5,
        focusKind: "cue",
      };
    case "arrival":
      return {
        stage,
        mode: "follow",
        pitch: 35,
        zoom: 17.2,
        centerBias: 0.4,
        focusKind: "cue",
      };
    case "arrived":
      return { stage, mode: "fit", pitch: 0, fitKind: "route" };
    default: {
      // ride: zoom breathes with speed — see far when fast.
      const speed = Number.isFinite(progress?.smoothedSpeedMps)
        ? progress.smoothedSpeedMps
        : 3;
      const t = clamp(0, 1, (speed - 2) / 6);
      return {
        stage: "ride",
        mode: "follow",
        pitch: 50,
        zoom: 16.8 + (15.8 - 16.8) * t,
        centerBias: 0,
      };
    }
  }
}

export function createCameraDirector() {
  let stage = null;
  let candidateStage = null;
  let candidateSinceMs = null;

  return {
    update(state, nowMs) {
      const wanted = stageFor(state);
      if (stage === null) {
        stage = wanted;
        candidateStage = null;
        candidateSinceMs = null;
      } else if (wanted !== stage) {
        const immediate = wanted === "off-route" || wanted === "arrived";
        if (immediate) {
          stage = wanted;
          candidateStage = null;
          candidateSinceMs = null;
        } else {
          if (candidateStage !== wanted) {
            candidateStage = wanted;
            candidateSinceMs = nowMs;
          }
          if (nowMs - candidateSinceMs >= MIN_STAGE_DWELL_MS) {
            stage = wanted;
            candidateStage = null;
            candidateSinceMs = null;
          }
        }
      } else {
        candidateStage = null;
        candidateSinceMs = null;
      }
      return shotFor(stage, state);
    },
    reset() {
      stage = null;
      candidateStage = null;
      candidateSinceMs = null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-camera-director.mjs`
Expected: `camera director tests passed`

- [ ] **Step 5: Add to the test chain**

In the root `package.json` `test` script, replace `node tests/test-camera-heading.mjs && ` with `node tests/test-camera-heading.mjs && node tests/test-camera-director.mjs && `.

- [ ] **Step 6: Run the chain segment and commit**

Run: `node tests/test-camera-director.mjs && node tests/test-camera-heading.mjs`
Expected: both pass.

```bash
git add packages/core/src/navigation/cameraDirector.js tests/test-camera-director.mjs package.json
git commit -m "feat(nav): stage-aware camera director"
```

---

### Task 5: Harness exposure + scenario expectations

**Files:**
- Modify: `packages/core/src/navigation/scenarioRunner.js`
- Modify: `packages/core/src/navigation/scenarioExpectations.js`
- Modify: `packages/core/src/navigation/scenarios/on-route-happy-path.js`
- Modify: `packages/core/src/navigation/scenarios/approach-calculated-route.js`
- Modify: `packages/core/src/navigation/scenarios/missed-turn-reroute.js`
- Test: `tests/test-nav-scenario-runner.mjs`, `tests/test-nav-scenario-expectations.mjs` (append; already in chain)

**Interfaces:**
- Consumes: `createCameraDirector` (Task 4), presentation `cardMode`/`chip` (Task 3).
- Produces: timeline entries gain `cameraStage` (string), `cardMode` (string), `chipText` (string|null). New expectation types:
  - `{ type: "camera-stage", value, betweenMeters?, never? }` — first entry whose `cameraStage === value` (window checked like `status`).
  - `{ type: "card-mode", value, betweenMeters?, never? }` — first entry whose `cardMode === value` (window checked like `status`).
  - `{ type: "chip", match, never? }` — substring match over `chipText`.

- [ ] **Step 1: Write the failing runner test**

In `tests/test-nav-scenario-runner.mjs`, inside the happy-ride block (after the `wrongWay` assertion added previously), add:

```js
  assert.ok(
    timeline.every((e) => typeof e.cameraStage === "string"),
    "every entry carries the camera stage",
  );
  assert.ok(
    timeline.every((e) => typeof e.cardMode === "string"),
    "every entry carries the card mode",
  );
  assert.equal(timeline[timeline.length - 1].cameraStage, "arrived");
```

Run: `node tests/test-nav-scenario-runner.mjs`
Expected: FAIL with `every entry carries the camera stage`.

- [ ] **Step 2: Expose the fields in the runner**

In `packages/core/src/navigation/scenarioRunner.js`:

(a) Add to the imports:

```js
import { createCameraDirector } from "./cameraDirector.js";
```

(b) In `buildUserTimeline`, next to `const cameraGovernor = createCameraHeadingGovernor();` add:

```js
  const cameraDirector = createCameraDirector();
```

(c) Inside the map callback, next to the `cameraHeadingDeg` computation add:

```js
      const cameraShot = cameraDirector.update(
        state,
        state.latestFix?.timestamp ?? 0,
      );
```

(d) Add to the returned entry object:

```js
        cameraStage: cameraShot.stage,
        cardMode: presentation.cardMode,
        chipText: presentation.chip?.text ?? null,
```

Run: `node tests/test-nav-scenario-runner.mjs`
Expected: `nav scenario runner tests passed`

- [ ] **Step 3: Write the failing expectations test**

In `tests/test-nav-scenario-expectations.mjs`:

(a) Add to the `entry()` factory defaults (next to `wrongWay: false,`):

```js
    cameraStage: "ride",
    cardMode: "status",
    chipText: null,
```

(b) Append a block before the final `console.log`:

```js
// camera-stage and chip expectations.
{
  const ride = [
    entry({ cameraStage: "approach", cardMode: "approach", chipText: "המסלול המוצע", progressMeters: 0 }),
    entry({ progressMeters: 100 }),
    entry({ cameraStage: "pre-turn", cardMode: "cue", chipText: "דרך הפרדס · דרך עפר", progressMeters: 500 }),
    entry({ cameraStage: "arrived", cardMode: "arrived", progressMeters: 900 }),
  ];
  const pass = evaluateExpectations(
    [
      { type: "camera-stage", value: "approach" },
      { type: "camera-stage", value: "pre-turn", betweenMeters: [450, 550] },
      { type: "camera-stage", value: "arrived" },
      { type: "camera-stage", value: "off-route", never: true },
      { type: "card-mode", value: "approach" },
      { type: "card-mode", value: "cue", betweenMeters: [450, 550] },
      { type: "card-mode", value: "arrived" },
      { type: "chip", match: "דרך הפרדס" },
      { type: "chip", match: "חזרה למסלול", never: true },
    ],
    ride,
  );
  assert.deepEqual(pass.failures, []);
  const fail = evaluateExpectations(
    [
      { type: "camera-stage", value: "off-route" },
      { type: "camera-stage", value: "pre-turn", betweenMeters: [0, 100] },
      { type: "card-mode", value: "off-route" },
      { type: "chip", match: "לא קיים" },
      { type: "chip", match: "המסלול המוצע", never: true },
    ],
    ride,
  );
  assert.equal(fail.failures.length, 5, JSON.stringify(fail.failures, null, 1));
}
```

Run: `node tests/test-nav-scenario-expectations.mjs`
Expected: FAIL with `unknown expectation type "camera-stage"` and
`unknown expectation type "card-mode"` among failures.

- [ ] **Step 4: Implement the expectation types**

In `packages/core/src/navigation/scenarioExpectations.js`, add two cases beside `case "wrong-way"`:

```js
      case "camera-stage": {
        const first = entries.find((e) => e.cameraStage === exp.value);
        if (exp.never === true) {
          if (first) fail(`camera stage "${exp.value}" occurred at ${progressOf(first)}m`);
          break;
        }
        if (!first) {
          fail(`camera stage "${exp.value}" never occurred`);
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

      case "chip": {
        const first = entries.find(
          (e) => typeof e.chipText === "string" && e.chipText.includes(exp.match),
        );
        if (exp.never === true) {
          if (first) fail(`chip "${exp.match}" appeared at ${progressOf(first)}m`);
        } else if (!first) {
          fail(`chip "${exp.match}" never appeared`);
        }
        break;
      }
```

Add the `card-mode` case beside `camera-stage`:

```js
      case "card-mode": {
        const first = entries.find((e) => e.cardMode === exp.value);
        if (exp.never === true) {
          if (first) fail(`card mode "${exp.value}" occurred at ${progressOf(first)}m`);
          break;
        }
        if (!first) {
          fail(`card mode "${exp.value}" never occurred`);
          break;
        }
        if (Array.isArray(exp.betweenMeters)) {
          const p = progressOf(first);
          const [min, max] = exp.betweenMeters;
          if (p === null || p < min || p > max) {
            fail(`first card mode "${exp.value}" at ${p}m, expected within [${min}, ${max}]`);
          }
        }
        break;
      }
```

Run: `node tests/test-nav-scenario-expectations.mjs`
Expected: passes.

- [ ] **Step 5: Add scenario expectations**

(a) `packages/core/src/navigation/scenarios/on-route-happy-path.js` — add to `expect`:

```js
    { type: "camera-stage", value: "pre-turn", betweenMeters: [430, 600] },
    { type: "camera-stage", value: "arrived" },
    { type: "camera-stage", value: "off-route", never: true },
    { type: "card-mode", value: "status" },
    { type: "card-mode", value: "cue", betweenMeters: [430, 600] },
    { type: "card-mode", value: "arrived" },
    { type: "chip", match: "דרך הפרדס" },
```

(b) `packages/core/src/navigation/scenarios/approach-calculated-route.js` — add to `expect`:

```js
    { type: "camera-stage", value: "approach" },
    { type: "camera-stage", value: "ride" },
    { type: "card-mode", value: "approach" },
    { type: "card-mode", value: "status" },
    { type: "chip", match: "המסלול המוצע" },
```

(c) `packages/core/src/navigation/scenarios/missed-turn-reroute.js` — add to `expect`:

```js
    { type: "camera-stage", value: "off-route", betweenMeters: [230, 420] },
    { type: "card-mode", value: "off-route", betweenMeters: [230, 420] },
    { type: "chip", match: "חזרה למסלול" },
```

- [ ] **Step 6: Run the scenario suite and tune windows**

Run: `node tests/test-nav-scenarios.mjs`
Expected: all pass. If a `betweenMeters` window fails while the artifact (`test-results/nav-scenarios/<name>.json`) shows correct behavior at a nearby distance, adjust the window; never weaken the expectation type.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/scenarioRunner.js packages/core/src/navigation/scenarioExpectations.js packages/core/src/navigation/scenarios tests/test-nav-scenario-runner.mjs tests/test-nav-scenario-expectations.mjs
git commit -m "feat(nav-scenarios): camera stage, card mode and chip on the timeline"
```

---

### Task 6: NavPanel restructure + full-screen ride setup

**Files:**
- Modify: `apps/mobile/src/planner/NavPanel.jsx` (restructure)
- Modify: `apps/mobile/src/planner/RideSetupSheet.jsx` (full-screen setup + haptics row)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (prop threading only)

**Interfaces:**
- Consumes: presentation `cardMode`, `speedText`, `arrivalSummary` (Task 3) plus all existing presentation fields; `sessionState.cameraIntent` for the contextual recenter.
- Produces: no exports consumed elsewhere. NavPanel keeps its existing props and gains none; `RideSetupSheet` gains `hapticsEnabled` / `onToggleHaptics` props and changes from a bottom sheet to an opaque full-screen setup surface.

No node tests cover these files (native UI); the gate is the esbuild parse plus the dev-scenario visual checklist in Task 9.

- [ ] **Step 1: Restructure NavPanel**

Replace the body of `NavPanel` and the relevant styles in `apps/mobile/src/planner/NavPanel.jsx`. Keep the imports, `NavButton`, and any styles still referenced. The new return:

```jsx
  const arrived = p.cardMode === "arrived";
  const showRecenter = sessionState?.cameraIntent === "free";

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* --- Top cue card (hidden once arrived — the summary card takes over) */}
      {arrived ? <View /> : (
      <View style={[styles.banner, { marginTop: insets.top + space.sm }]}>
        {p.justAcquired ? (
          <View style={styles.acquiredRow}>
            <Icon name="checkmark-circle" color={palette.white} size={22} />
            <Text style={styles.acquiredText}>{p.acquisitionText}</Text>
          </View>
        ) : null}
        {p.wrongWay ? (
          <View style={styles.wrongWayRow}>
            <Icon name="warning-outline" color={palette.white} size={22} />
            <Text style={[styles.cueText, styles.offText]} numberOfLines={1}>
              {p.wrongWayText}
            </Text>
          </View>
        ) : null}

        {p.cardMode === "approach" || p.cardMode === "off-route" ? (
          <>
            <Text style={[styles.approachHeading, p.offRoute ? styles.offText : null]}>
              {p.approachHeading}
            </Text>
            <View style={p.offRoute ? [styles.cueRow, styles.offRow] : styles.cueRow}>
              {showApproachArrow ? (
                <View style={{ transform: [{ rotate: `${approachArrowDeg}deg` }] }}>
                  <Icon
                    name="navigate"
                    color={p.offRoute ? palette.white : palette.forest}
                    size={26}
                  />
                </View>
              ) : null}
              <Text
                style={[styles.cueText, p.offRoute ? styles.offText : null]}
                numberOfLines={1}
              >
                {p.destinationLabel}
                {p.approachDistanceShort ? ` · ${p.approachDistanceShort}` : ""}
              </Text>
            </View>
            {p.approachSupportText ? (
              <Text style={styles.approachSupport}>{p.approachSupportText}</Text>
            ) : null}
            {p.cardMode === "approach" ? (
              <View style={styles.approachActions}>
                <Pressable
                  style={({ pressed }) => [styles.destBtn, pressed ? styles.destBtnPressed : null]}
                  onPress={onOpenExternal}
                  accessibilityRole="button"
                  accessibilityLabel="פתיחה באפליקציית ניווט"
                >
                  <Icon name="open-outline" color={palette.forest} size={18} />
                  <Text style={styles.destBtnText}>אפליקציית ניווט</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.destBtn, pressed ? styles.destBtnPressed : null]}
                  onPress={onChangeRideSettings}
                  accessibilityRole="button"
                  accessibilityLabel="שינוי הגדרות רכיבה"
                >
                  <Icon name="options-outline" color={palette.forest} size={18} />
                  <Text style={styles.destBtnText}>הגדרות רכיבה</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : p.cardMode === "cue" ? (
          <View style={styles.cueRow}>
            <Icon name={p.cueIcon} color={palette.forest} size={30} />
            <View style={styles.cueTextWrap}>
              <Text style={styles.cueText} numberOfLines={1}>
                {p.cuePrimaryText || p.cueText}
              </Text>
              {p.cueSecondaryText ? (
                <Text style={styles.context} numberOfLines={1}>{p.cueSecondaryText}</Text>
              ) : null}
            </View>
            {p.cueDistanceText ? (
              <Text style={styles.cueBigDistance}>{p.cueDistanceText}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.statusText} numberOfLines={1}>
            {p.contextText || p.statusText || p.cueText}
          </Text>
        )}
      </View>
      )}

      {/* --- Contextual recenter --------------------------------------- */}
      {showRecenter && !arrived ? (
        <View style={[styles.recenterWrap, { bottom: insets.bottom + 84 }]}>
          <NavButton icon="locate-outline" label="מרכוז" onPress={onRecenter} />
        </View>
      ) : null}

      {/* --- Bottom: arrival card or control row ------------------------ */}
      {arrived && p.arrivalSummary ? (
        <View style={[styles.arrivalCard, { marginBottom: insets.bottom + space.md }]}>
          <Text style={styles.arrivalTitle}>הגעת ליעד 🎉</Text>
          <View style={styles.arrivalStats}>
            <ArrivalStat value={p.arrivalSummary.distanceText} label="מרחק" />
            <ArrivalStat value={p.arrivalSummary.elapsedText} label="זמן" />
            <ArrivalStat value={p.arrivalSummary.avgSpeedText} label="ממוצע" />
          </View>
          <Pressable
            style={({ pressed }) => [styles.arrivalDone, pressed ? styles.destBtnPressed : null]}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="סיום הניווט"
          >
            <Text style={styles.arrivalDoneText}>סיום</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.controls, { marginBottom: insets.bottom + space.md }]}>
          <View style={styles.dataPill}>
            <Text style={styles.dataPillMain} numberOfLines={1}>
              {p.remainingText || ""}
            </Text>
            {p.speedText ? (
              <Text style={styles.dataPillSub}>{p.speedText}</Text>
            ) : null}
          </View>
          <RoundButton
            icon={paused ? "play" : "pause"}
            label={paused ? "המשך" : "השהה"}
            onPress={onPauseResume}
          />
          <RoundButton icon="stop" label="סיום" danger onPress={onStop} />
        </View>
      )}
    </View>
  );
```

Add the two small components beside `NavButton`:

```jsx
function RoundButton({ icon, label, onPress, danger = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navBtn,
        danger ? styles.navBtnDanger : null,
        pressed ? styles.navBtnPressed : null,
      ]}
    >
      <Icon name={icon} color={danger ? palette.white : palette.ink} size={22} />
    </Pressable>
  );
}

function ArrivalStat({ value, label }) {
  return (
    <View style={styles.arrivalStat}>
      <Text style={styles.arrivalStatValue}>{value}</Text>
      <Text style={styles.arrivalStatLabel}>{label}</Text>
    </View>
  );
}
```

Style changes (add; keep existing ones that are still referenced, delete `remaining` and `routeSettingsBtn`/`routeSettingsText` if no longer used):

```js
  cueBigDistance: {
    color: "#1c4fd6",
    fontSize: 22,
    fontWeight: "900",
  },
  controls: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.sm,
  },
  dataPill: {
    flex: 1,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: palette.white,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  dataPillMain: { color: palette.ink, fontSize: 14, fontWeight: "900", writingDirection: "rtl" },
  dataPillSub: { color: palette.muted, fontSize: 13, fontWeight: "700", writingDirection: "rtl" },
  recenterWrap: { position: "absolute", left: space.md },
  arrivalCard: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    padding: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  arrivalTitle: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
  },
  arrivalStats: {
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    marginTop: space.md,
  },
  arrivalStat: { alignItems: "center" },
  arrivalStatValue: { color: palette.ink, fontSize: 18, fontWeight: "900" },
  arrivalStatLabel: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  arrivalDone: {
    marginTop: space.md,
    backgroundColor: palette.forest,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    alignItems: "center",
  },
  arrivalDoneText: { color: palette.white, fontSize: 15, fontWeight: "900" },
```

Note the cue card no longer renders `remainingText` (it moved to the data pill) and the "הגדרות רכיבה" quick link renders only in approach mode (it already does above).

- [ ] **Step 2: Make RideSetupSheet full-screen and move haptics into it**

(a) In `apps/mobile/src/planner/RideSetupSheet.jsx`, keep the existing `Modal`
but make the visible surface full-screen/opaque:

- Remove the translucent map-peek backdrop behavior for normal setup.
- Make `styles.sheet` fill the viewport (`top: 0`, `left: 0`, `right: 0`,
  `bottom: 0`, no `maxHeight`), use `paddingTop: insets.top + space.md`, and
  keep `paddingBottom: insets.bottom + space.md`.
- Remove the bottom-sheet handle, or hide it in this mode.
- Keep the primary button pinned below the scroll content.
- Keep map-pick mode unchanged: tapping `בחירת נקודה על המפה` closes setup,
  lets the user pick on the map, then returns to the setup surface.

(b) Add the two props to the component signature (`hapticsEnabled = true,
onToggleHaptics`), and inside the `ScrollView` after the start-point section
add:

```jsx
          {onToggleHaptics ? (
            <>
              <Text style={styles.sectionTitle}>התראות רטט</Text>
              <Choice
                label={hapticsEnabled ? "רטט פעיל" : "רטט כבוי"}
                sub="רטט קצר לפני פניות והתראות"
                selected={hapticsEnabled}
                onPress={onToggleHaptics}
              />
            </>
          ) : null}
```

(c) In `apps/mobile/src/screens/BuildScreen.jsx`, find the `<RideSetupSheet` element and add:

```jsx
            hapticsEnabled={nav.hapticsEnabled}
            onToggleHaptics={() => nav.setHapticsEnabled(!nav.hapticsEnabled)}
```

(d) In the `<NavPanel` element in BuildScreen, delete the `hapticsEnabled` and `onToggleHaptics` props, and delete those two props from NavPanel's signature.

- [ ] **Step 3: Parse-check**

Run:
```bash
node_modules/.bin/esbuild --loader:.jsx=jsx apps/mobile/src/planner/NavPanel.jsx --outfile=/dev/null
node_modules/.bin/esbuild --loader:.jsx=jsx apps/mobile/src/planner/RideSetupSheet.jsx --outfile=/dev/null
node_modules/.bin/esbuild --loader:.jsx=jsx apps/mobile/src/screens/BuildScreen.jsx --outfile=/dev/null
```
Expected: all clean.

- [ ] **Step 3b: Visual setup checks**

In the simulator, open `הכנת הרכיבה` from the planner and from mid-approach
ride settings:

1. The setup surface is opaque and occupies the full screen; no map peeks from
   below.
2. Direction, start-point, haptics, summary, and primary action are reachable
   on a small phone viewport.
3. `בחירת נקודה על המפה` still exits to map-pick mode and returns after the
   point is chosen.
4. For far/unknown approach, the primary action routes to external app handoff.

- [ ] **Step 4: Run the node suite (must be unaffected)**

Run: `npm test`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/planner/NavPanel.jsx apps/mobile/src/planner/RideSetupSheet.jsx apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(nav-ui): cue card, data pill controls, arrival card"
```

---

### Task 7: On-map chips in BuildScreen

**Files:**
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Interfaces:**
- Consumes: `navPresentation.chip` (Task 3), `riderPuck` state (existing), `approach.suggestionGeometry` (existing).
- Produces: UI only.

- [ ] **Step 1: Add the chip anchor computation**

Near the existing `suggestionFeature` memo add:

```jsx
  // Midpoint of the dashed suggestion line — anchor for the approach/rejoin chip.
  const suggestionMidpoint = useMemo(() => {
    if (!Array.isArray(suggestionGeometry) || suggestionGeometry.length < 2) return null;
    const mid = suggestionGeometry[Math.floor(suggestionGeometry.length / 2)];
    return Number.isFinite(mid?.lat) && Number.isFinite(mid?.lng) ? mid : null;
  }, [suggestionGeometry]);
  const navChip = navPresentation.chip ?? null;
```

- [ ] **Step 2: Render the chips**

Inside the map children, immediately after the `showSuggestion` block, add:

```jsx
        {isNavigating && navChip?.kind === "segment" && riderPuck ? (
          <MarkerView
            coordinate={[riderPuck.lng, riderPuck.lat]}
            anchor={{ x: 0.5, y: -0.9 }}
            allowOverlap
          >
            <View style={styles.navChip}>
              <Text style={styles.navChipText} numberOfLines={1}>{navChip.text}</Text>
            </View>
          </MarkerView>
        ) : null}
        {isNavigating &&
        (navChip?.kind === "approach" || navChip?.kind === "rejoin") &&
        suggestionMidpoint ? (
          <MarkerView
            coordinate={[suggestionMidpoint.lng, suggestionMidpoint.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View style={[styles.navChip, navChip.kind === "rejoin" ? styles.navChipRejoin : styles.navChipApproach]}>
              <Text
                style={[styles.navChipText, navChip.kind === "rejoin" ? styles.navChipRejoinText : styles.navChipApproachText]}
                numberOfLines={1}
              >
                {navChip.text}
              </Text>
            </View>
          </MarkerView>
        ) : null}
```

- [ ] **Step 3: Add the chip styles**

In BuildScreen's `StyleSheet.create` block add:

```js
  navChip: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
    maxWidth: 220,
  },
  navChipText: {
    color: "#1a2b1e",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  navChipApproach: { backgroundColor: "#eef4ff", borderWidth: 1, borderColor: "#b9ccf5" },
  navChipApproachText: { color: "#1c4fd6" },
  navChipRejoin: { backgroundColor: "#fff0ee", borderWidth: 1, borderColor: "#f2c4be" },
  navChipRejoinText: { color: "#c9372c" },
```

- [ ] **Step 4: Parse-check and node suite**

Run: `node_modules/.bin/esbuild --loader:.jsx=jsx apps/mobile/src/screens/BuildScreen.jsx --outfile=/dev/null && npm test`
Expected: clean parse, suite passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(nav-ui): current-segment and suggestion chips on the map"
```

---

### Task 8: Camera director wiring in BuildScreen

**Files:**
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Interfaces:**
- Consumes: `createCameraDirector` (Task 4); existing refs (`progressRef`, `rawFixRef`, `cameraBearingRef`, `smoothedMetersRef`, `arcRef`, `navGeometryRef`, `cameraIntentRef`, `navStatusRef`); `pointAndBearingAtDistance` and `fitCameraToPoints` (existing helpers in the file).
- Produces: the RAF loop uses director follow shots for pitch/zoom/center and director fit shots for approach/rejoin/route overview, replacing the fixed `NAV_FOLLOW_ZOOM`/`NAV_FOLLOW_PITCH`.

- [ ] **Step 1: Refs and setup**

(a) Import: add `createCameraDirector` to the `cameraHeading.js` import line's sibling:

```js
import { createCameraDirector } from "@cycleways/core/navigation/cameraDirector.js";
```

(b) Next to `cameraGovernorRef` add:

```js
  const cameraDirectorRef = useRef(null);
  const cameraPitchRef = useRef(50);
  const cameraZoomRef = useRef(16.5);
  const sessionStateRef = useRef(null);
  const cameraFitKeyRef = useRef(null);
```

(c) Next to the other per-render ref mirrors (`progressRef.current = navProgress;` etc.) add:

```js
  sessionStateRef.current = nav.state;
```

(d) In the `isNavigating` effect: on start (next to `cameraGovernorRef.current = createCameraHeadingGovernor();`) add:

```js
    cameraDirectorRef.current = createCameraDirector();
    cameraPitchRef.current = NAV_FOLLOW_PITCH;
    cameraZoomRef.current = NAV_FOLLOW_ZOOM;
    cameraFitKeyRef.current = null;
```

and in the cleanup branch add:

```js
      cameraDirectorRef.current = null;
      cameraFitKeyRef.current = null;
```

- [ ] **Step 2: Use the director in the RAF tick**

Inside the tick, in the camera block (where `setCamera` is called), replace the fixed-value call. Before the `if (cameraIntentRef.current === "follow" ...)` guard add:

```js
          // Stage-aware shot from the camera director. Fit shots use the same
          // helper/padding convention as the rest of this file; follow shots
          // ease pitch/zoom like heading changes.
          const shot =
            cameraDirectorRef.current?.update(sessionStateRef.current ?? {}, ts) ??
            { stage: "ride", mode: "follow", pitch: NAV_FOLLOW_PITCH, zoom: NAV_FOLLOW_ZOOM, centerBias: 0 };
          const ease = Math.min(1, dtMs / CAMERA_ROTATE_MS);
          cameraPitchRef.current += (shot.pitch - cameraPitchRef.current) * ease;
          if (Number.isFinite(shot.zoom)) {
            cameraZoomRef.current += (shot.zoom - cameraZoomRef.current) * ease;
          }

          if (shot.mode === "fit") {
            const raw = rawFixRef.current;
            const suggestion = sessionStateRef.current?.approach?.suggestionGeometry;
            const target = sessionStateRef.current?.approach?.target?.point;
            const fitPoints =
              shot.fitKind === "route"
                ? geom
                : [
                    raw && Number.isFinite(raw.lat) && Number.isFinite(raw.lng) ? raw : null,
                    target || progress.guidanceTargetPoint || null,
                    ...(Array.isArray(suggestion) ? suggestion : []),
                  ].filter(Boolean);
            const fitKey = `${shot.fitKind}:${fitPoints
              .map((p) => `${Number(p.lng).toFixed(5)},${Number(p.lat).toFixed(5)}`)
              .join("|")}`;
            if (
              cameraIntentRef.current === "follow" &&
              navStatusRef.current !== "paused" &&
              fitPoints.length >= 1 &&
              cameraFitKeyRef.current !== fitKey
            ) {
              cameraFitKeyRef.current = fitKey;
              if (shot.fitKind === "route") {
                cameraRef.current?.setCamera?.({
                  pitch: 0,
                  heading: 0,
                  animationDuration: 250,
                  animationMode: "easeTo",
                });
              }
              fitCameraToPoints(
                cameraRef.current,
                fitPoints,
                shot.fitKind === "route" ? 84 : 150,
              );
            }
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          cameraFitKeyRef.current = null;

          // Focus point per stage; center = lerp(rider, focus, centerBias).
          let focus = null;
          if (shot.focusKind === "cue") {
            const cueMeters = sessionStateRef.current?.activeCue?.cue?.distanceMeters;
            if (Number.isFinite(cueMeters) && arcNow && geom.length >= 2) {
              focus = pointAndBearingAtDistance(arcNow, geom, cueMeters).point;
            }
          }
          let centerLng = lng;
          let centerLat = lat;
          if (focus && shot.centerBias > 0) {
            centerLng = lng + (focus.lng - lng) * shot.centerBias;
            centerLat = lat + (focus.lat - lat) * shot.centerBias;
          }
```

Then change the `setCamera` call to:

```js
            cameraRef.current?.setCamera?.({
              centerCoordinate: [centerLng, centerLat],
              heading: cameraBearingRef.current,
              pitch: cameraPitchRef.current,
              zoomLevel: cameraZoomRef.current,
              animationDuration: 0,
            });
```

- [ ] **Step 3: Fit-shot guardrails**

Do not call `cameraRef.fitBounds` directly with scalar padding. Use the existing
`fitCameraToPoints(cameraRef.current, points, bottomPadding)` helper so argument
order and four-value padding stay consistent with the rest of BuildScreen.
Throttle fit calls with `cameraFitKeyRef` (rounded coordinates are fine) so the
RAF loop does not issue an expensive fit every frame.

- [ ] **Step 4: Parse-check and full suite**

Run: `node_modules/.bin/esbuild --loader:.jsx=jsx apps/mobile/src/screens/BuildScreen.jsx --outfile=/dev/null && npm test`
Expected: clean, suite passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(nav-ui): stage-aware camera wiring in BuildScreen"
```

---

### Task 9: Visual acceptance, design reconciliation, final suite

**Files:**
- Modify: `plans/nav-ui-redesign/design.md` (implementation notes)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 2: Simulator checklist (dev scenario picker)**

Run the app (`cd apps/mobile && npx expo run:ios` or the existing dev build) and verify, one scenario per state:

1. `on-route-happy-path` (8×): collapsed status pill while cruising; cue card with big blue distance + "אל שביל הצפון" before the corner; segment chip under the puck while the cue shows; camera tilts to 35° near the corner and back; arrival card with distance/time/avg and route fit at the end.
2. `approach-calculated-route` (4×): overview camera framing rider + route start; "המסלול המוצע" chip on the dashed line; approach card actions; hand-off to ride stage after acquisition.
3. `missed-turn-reroute` (4×): off-route card turns red; "חזרה למסלול" chip on the rejoin line; camera pulls back with frozen heading; recovery back to ride.
4. `parallel-path` (8×): no warnings, chip/pill behavior stable, camera calm.
5. Pan the map mid-ride: recenter button appears; tap: it disappears and follow resumes.
6. Open ride settings mid-ride: haptics toggle present and functional.
7. Open `הכנת הרכיבה` before starting: it is full-screen/opaque, no map peeks
   below, content is reachable on small phones, and map-pick mode exits/returns
   correctly.

- [ ] **Step 3: Reconcile the design doc**

Append an "Implementation notes" section to `plans/nav-ui-redesign/design.md` recording:
- Any camera/setup window or padding value tuned during Task 5/8/9.
- Segment-chip scenario assertions run on the synthetic l-turn scenarios because snapshot catalog routes carry no `segmentSpans`.
- Any route-class label fallback chosen beyond the classes listed in the design.

- [ ] **Step 4: Commit**

```bash
git add plans/nav-ui-redesign/design.md
git commit -m "docs(nav-ui): reconcile design with shipped implementation"
```
