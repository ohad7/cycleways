# Navigation Ride Feedback Round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement design `plans/navigation-ride-feedback-2/design.md` (R1–R6): arrival auto-end, crash-resume policy with the headless zombie-voice fix, planner locate-me view preservation, and mid-route join.

**Architecture:** All decision logic lands in pure core modules (`packages/core/src/navigation/`) with node tests; the mobile app (`apps/mobile/`) only wires probes, params, and camera calls. Core first (Tasks 1–4), then native glue (Tasks 5–7), then end-to-end verification (Task 8).

**Tech Stack:** Node test scripts (`node tests/test-*.mjs`, plain `assert`), React Native / Expo mobile app, `@cycleways/core` workspace package (imported by tests via the `@cycleways/core/*` alias).

## Global Constraints

- Run all tests from the repo root: `node tests/test-<name>.mjs` (exit 0 = pass).
- Never edit `data/map-source.geojson` or `public-data/` (CLAUDE.md; not touched by this plan).
- Hebrew UI copy, RTL; new user-facing strings are Hebrew.
- Commit after every task; messages follow `feat(nav): …` / `fix(nav): …` with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- After finishing, run `node tests/test-mobile-undefined-references.mjs` — it catches references to deleted identifiers that crash release builds.

---

### Task 1: Earliest-candidate route acquisition (R6, core tracker)

**Files:**
- Modify: `packages/core/src/navigation/routeProgress.js:395-445` (the `update()` acquisition branch)
- Test: `tests/test-route-progress.mjs` (extend)

**Interfaces:**
- Consumes: existing `createRouteProgressTracker(navigationRoute, opts)` and `projectToSegment` in the same file.
- Produces: unchanged public API; acquisition semantics change — with `navigationRoute.requiresStartAcquisition === true`, acquisition now latches at the **smallest-progress projection within the enter threshold** anywhere on the route (was: within 150 m of the start only). `opts.startAcquisitionWindowMeters` is deleted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-route-progress.mjs` (reuse the file's existing route/tracker/fix helpers — read the top of the file first; the fixtures below follow its conventions of `distanceFromStartMeters`-annotated geometry):

```js
// --- R6: earliest-candidate acquisition -----------------------------------
// A rider standing +200m along the route acquires there instead of being
// held for the start point.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
      { lat: 33.1, lng: 35.62, distanceFromStartMeters: 1862 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  // ~200m east of the start, on the line.
  const p = tracker.update({ lat: 33.1, lng: 35.60215, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, true, "mid-route join acquires");
  assert.ok(Math.abs(p.progressMeters - 200) < 30, `progress ~200m, got ${p.progressMeters}`);
}

// On a loop (start == end) standing at the shared point picks progress 0,
// not the far end.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
      { lat: 33.105, lng: 35.61, distanceFromStartMeters: 1487 },
      { lat: 33.105, lng: 35.6, distanceFromStartMeters: 2418 },
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 2974 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const p = tracker.update({ lat: 33.1, lng: 35.6, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, true, "loop start acquires");
  assert.ok(p.progressMeters < 100, `loop picks the start leg, got ${p.progressMeters}`);
}

// Far from the route: still not acquired.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const p = tracker.update({ lat: 33.15, lng: 35.6, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, false, "off-route fix does not acquire");
}
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `node tests/test-route-progress.mjs`
Expected: FAIL on `"mid-route join acquires"` (today the +200 m fix is outside the 150 m start window).

- [ ] **Step 3: Implement earliest-candidate acquisition**

In `routeProgress.js`, add next to `findNearest`:

```js
  // Earliest on-route candidate: among projections within the threshold, the
  // smallest progressMeters wins. Standing on a loop's shared start/end picks
  // the start leg; an out-and-back's shared corridor picks the outbound leg.
  function findEarliestWithin(fix, thresholdMeters) {
    let best = null;
    for (let i = 0; i < geometry.length - 1; i++) {
      const a = geometry[i];
      const b = geometry[i + 1];
      const legMeters = b.distanceFromStartMeters - a.distanceFromStartMeters;
      if (!Number.isFinite(legMeters) || legMeters <= 0) continue;
      const proj = projectToSegment(fix, a, b);
      if (proj.crossTrackMeters > thresholdMeters) continue;
      const progressMeters = a.distanceFromStartMeters + proj.t * legMeters;
      if (best === null || progressMeters < best.progressMeters) {
        best = {
          index: i,
          crossTrackMeters: proj.crossTrackMeters,
          progressMeters,
          snapped: proj.snapped,
        };
      }
    }
    return best;
  }
```

Then in `update()` replace the start-gated branch:

```js
    if (!acquired && requireStartAcquisition) {
      best = findNearest(fix, 0, opts.startAcquisitionWindowMeters);
    } else if (lastProgressMeters === null) {
```

with:

```js
    if (!acquired && requireStartAcquisition) {
      best = findEarliestWithin(fix, enterThreshold) || findNearest(fix, null, null);
    } else if (lastProgressMeters === null) {
```

and in the acquisition latch delete the start-distance gate — replace:

```js
      const withinSelectedStart =
        !requireStartAcquisition || distanceToRouteStart <= enterThreshold;
      if (best && best.crossTrackMeters <= enterThreshold && withinSelectedStart) {
```

with:

```js
      if (best && best.crossTrackMeters <= enterThreshold) {
```

Keep `distanceToRouteStart` — it is still returned for approach UI. Delete `startAcquisitionWindowMeters: 150,` from the defaults object (it is now unused; `grep -rn startAcquisitionWindowMeters` must come back empty).

- [ ] **Step 4: Run the tracker and session suites**

Run: `node tests/test-route-progress.mjs && node tests/test-navigation-session.mjs && node tests/test-approach-leg.mjs`
Expected: all PASS (session tests exercise acquisition indirectly; fix regressions here, not later).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/routeProgress.js tests/test-route-progress.mjs
git commit -m "feat(nav): earliest-candidate route acquisition for mid-route joins"
```

---

### Task 2: Approach guidance targets the join point for small skips (R6, session)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js:422-427` (default approach target)
- Test: `tests/test-navigation-session.mjs` (extend)

**Interfaces:**
- Consumes: `approachTargetChoices` and `JOIN_SKIP_PROMPT_M` from `./connectorTargeting.js` (the session already imports the former; add the latter to the same import).
- Produces: `state.approach.target.mode === "nearest"` (with `mainProgressMeters` at the projection) whenever the rider's nearest projection skips `0 < skip < JOIN_SKIP_PROMPT_M`; `"start"` otherwise. Downstream consumers read `target.point`/`target.mode` and are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/test-navigation-session.mjs` (reuse its `fix`/route helpers; note `fix(lng, ts)` produces a point on the straight fixture's latitude — build a custom fix object for the offset case):

```js
// --- R6: approach target is the nearest point for small skips --------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  // ~55m north of the route line at ~+200m along: not acquired, small skip.
  const state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1005, lng: 35.60215, accuracy: 5, timestamp: 1_000 },
  });
  assert.equal(state.status, "approaching");
  assert.equal(state.approach.target.mode, "nearest", "small skip targets the join point");
  assert.ok(
    Math.abs(state.approach.target.mainProgressMeters - 200) < 40,
    `target progress ~200m, got ${state.approach.target.mainProgressMeters}`,
  );
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL with `target.mode` `"start"`.

- [ ] **Step 3: Implement the target choice**

In `navigationSession.js`, extend the `connectorTargeting.js` import with `JOIN_SKIP_PROMPT_M`, then replace:

```js
          let target = state.approach.target;
          if (!target && choices) {
            target = { ...choices.start, mode: "start" };
          }
```

with:

```js
          let target = state.approach.target;
          if (!target && choices) {
            // Small skips join at the nearest point (R6); big skips keep the
            // guide-to-start behavior (the start-vs-join prompt UI is
            // deferred — design non-goal).
            target =
              choices.skipMeters > 0 && choices.skipMeters < JOIN_SKIP_PROMPT_M
                ? { ...choices.nearest, mode: "nearest" }
                : { ...choices.start, mode: "start" };
          }
```

- [ ] **Step 4: Run to verify pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-approach-leg.mjs && node tests/test-compute-connector.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): approach guidance targets the nearest join point for small skips"
```

---

### Task 3: Arrival latch and auto-end (R1 + R2, session)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js` (LOCATION handler around lines 519-580, STOP handler ~line 942, snapshot/restore, initial state)
- Test: `tests/test-navigation-session.mjs` (extend)

**Interfaces:**
- Consumes: `mainProgress.remainingMeters` from the tracker (already progress-based).
- Produces: new module constants `ARRIVAL_LATCH_M = 15`, `ARRIVAL_CONFIRM_FIXES = 2`, `ARRIVAL_CONFIRM_FALLBACK_MS = 30_000` (exported for tests); state gains `endReason: "arrived" | "user" | null` and `arrival: { detectedAt } | null`; snapshots round-trip `arrivalDetectedAt`/`arrivalFixCount`. Task 5 relies on `getState().status === "ended"` after the headless dispatch loop.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-navigation-session.mjs`. The straight fixture's route end is at lng 35.61 (~931 m). Helper for on-route fixes at a given lng was established in Task 2's step; reuse the file's `fix(lng, ts)` helper:

```js
// --- R1/R2: arrival latches and auto-ends ----------------------------------
function rideToNearEnd(session) {
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6, 1_000) });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 60_000) });
}

// Two consecutive arrival fixes end the ride.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  const first = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 120_000) });
  assert.equal(first.status, "navigating", "first arrival fix latches, does not end");
  assert.ok(first.arrival, "arrival latch exposed");
  const second = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 121_000) });
  assert.equal(second.status, "ended", "second consecutive arrival fix ends");
  assert.equal(second.endReason, "arrived");
}

// A single noisy arrival fix cannot end the ride.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 120_000) });
  const back = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6088, 121_000) });
  assert.equal(back.status, "navigating", "non-arrival fix clears the latch");
  assert.equal(back.arrival, null);
  const again = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 122_000) });
  assert.equal(again.status, "navigating", "confirmation restarts after a cleared latch");
}

// Wall-clock fallback: latched, then a sparse fix 30s later ends the ride
// even though it is only the second arrival fix in a slow stream.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 120_000) });
  const late = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 151_000) });
  assert.equal(late.status, "ended", "30s fallback confirms arrival");
}

// While latched, wandering off the line completes the arrival instead of
// rerouting the rider back to the finish.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 120_000) });
  // ~120m past/off the end: off-route by cross-track, but latched.
  const past = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6113, accuracy: 5, timestamp: 121_000 },
  });
  assert.notEqual(past.status, "off-route", "off-route suppressed while latched");
  assert.equal(past.status, "ended", "riding away past the end completes arrival");
}

// Manual stop records its own reason.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  assert.equal(session.dispatch({ type: NAV_ACTIONS.STOP }).endReason, "user");
}

// The latch survives a snapshot round-trip.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 120_000) });
  const revived = createNavigationSession(straightRoute(), { snapshot: session.snapshot() });
  const done = revived.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 121_000) });
  assert.equal(done.status, "ended", "restored latch confirms on the next arrival fix");
}
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — today the second arrival fix leaves `status: "navigating"` and `endReason`/`arrival` are undefined.

- [ ] **Step 3: Implement latch + auto-end**

In `navigationSession.js`:

1. Export constants near the top:

```js
export const ARRIVAL_LATCH_M = 15;
export const ARRIVAL_CONFIRM_FIXES = 2;
export const ARRIVAL_CONFIRM_FALLBACK_MS = 30_000;
```

2. Add latch runtime state next to `rejoinAnnounced` (~line 79), restoring from snapshots the same way it does:

```js
  let arrivalDetectedAt = Number.isFinite(Number(restored?.arrivalDetectedAt))
    ? Number(restored.arrivalDetectedAt)
    : null;
  let arrivalFixCount = Number.isFinite(Number(restored?.arrivalFixCount))
    ? Number(restored.arrivalFixCount)
    : 0;
```

Find the `snapshot()` implementation (it already serializes `rejoinAnnounced` and the tracker snapshots) and add `arrivalDetectedAt` and `arrivalFixCount` to the returned object.

3. Initial state: add `endReason: null` and `arrival: null` next to `offRoute: false` in the initial-state object (~line 114), and set `arrival: arrivalDetectedAt === null ? null : { detectedAt: arrivalDetectedAt }` in the acquired-branch `set(...)` patches below.

4. In the LOCATION handler, insert immediately after `const offRoute = mainProgress.offRoute;` (line 519):

```js
        // R1/R2 arrival: latch on progress-based remaining distance; end on
        // the second consecutive arrival fix or 30s after the latch. Progress
        // is monotonic, so loops cannot false-latch at their start.
        const remainingNow = Number(mainProgress.remainingMeters);
        const arrivalFix =
          Number.isFinite(remainingNow) && remainingNow <= ARRIVAL_LATCH_M;
        if (arrivalFix) {
          if (arrivalDetectedAt === null) {
            arrivalDetectedAt = action.fix.timestamp;
            arrivalFixCount = 0;
          }
          arrivalFixCount += 1;
          const confirmed =
            arrivalFixCount >= ARRIVAL_CONFIRM_FIXES ||
            action.fix.timestamp - arrivalDetectedAt >= ARRIVAL_CONFIRM_FALLBACK_MS;
          if (confirmed) {
            requestSeq += 1;
            resetApproachRuntime();
            lastRequestPos = null;
            connectorRequestAttempt = 0;
            return set({
              status: "ended",
              endReason: "arrived",
              progress: mainProgress,
              activeCue: null,
              offRoute: false,
              arrival: { detectedAt: arrivalDetectedAt },
              approach: emptyApproach(),
              routeRequest: null,
              connectorResult: null,
              cameraTransition: null,
              justAcquired: false,
            });
          }
        } else {
          arrivalDetectedAt = null;
          arrivalFixCount = 0;
        }
```

The off-route suppression must also cover a rider who wanders off the line
*while latched* (the tracker may report `offRoute` on the same fix that
confirms arrival — the confirm above already returned; for the latched-but-
unconfirmed fix, fall through to the acquired/navigating branch). Change the
off-route gate (line 523's `if (offRoute) {`) to:

```js
        if (offRoute && arrivalDetectedAt === null) {
```

Note the off-route suppression test: a latched rider who goes off the line
still ends via the second-fix confirm because the arrival check runs before
the off-route branch and the tracker's `remainingMeters` stays ≤ 15 once
progress has reached the end.

5. STOP handler (~line 942): add `endReason: "user",` and `arrival: null,` to its `set({ status: "ended", ... })` patch, and reset the latch (`arrivalDetectedAt = null; arrivalFixCount = 0;`) alongside its other resets. Reset both in `NAV_ACTIONS.START` handling too (find where `rejoinAnnounced = false` is reset on start and mirror it).

- [ ] **Step 4: Run to verify pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-route-progress.mjs && node tests/test-analytics-parity.mjs`
Expected: all PASS. If the off-route-suppression case fails because the tracker reports a large `remainingMeters` once cross-track exceeds the threshold, adjust the past-the-end test fix to stay within ~40 m of the line rather than change the implementation.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): arrival latches in the session and auto-ends the ride"
```

---

### Task 4: Resume policy module (R3 policy + R4 classifier)

**Files:**
- Create: `packages/core/src/navigation/resumePolicy.js`
- Test: `tests/test-resume-policy.mjs` (new)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used verbatim by Tasks 5–6):
  - `RESUME_HOT_MAX_AGE_MS = 10 * 60 * 1000`, `RESUME_WARM_MAX_AGE_MS = 60 * 60 * 1000`
  - `classifyResumeRecord(record, now = Date.now())` → `"hot" | "warm" | "stale" | "none"` (`record.lastProcessedFixTimestamp` drives age; missing/invalid record or route → `"none"`)
  - `shouldSpeakHeadlessCue({ appActive = false } = {})` → `boolean` (speak iff not foreground-active)

- [ ] **Step 1: Write the failing test**

Create `tests/test-resume-policy.mjs`:

```js
import assert from "node:assert/strict";
import {
  RESUME_HOT_MAX_AGE_MS,
  RESUME_WARM_MAX_AGE_MS,
  classifyResumeRecord,
  shouldSpeakHeadlessCue,
} from "@cycleways/core/navigation/resumePolicy.js";

const NOW = 1_800_000_000_000;
const record = (ageMs) => ({
  navigationRoute: { id: "r1" },
  lastProcessedFixTimestamp: NOW - ageMs,
});

assert.equal(classifyResumeRecord(record(60_000), NOW), "hot");
assert.equal(classifyResumeRecord(record(RESUME_HOT_MAX_AGE_MS), NOW), "hot");
assert.equal(classifyResumeRecord(record(RESUME_HOT_MAX_AGE_MS + 1), NOW), "warm");
assert.equal(classifyResumeRecord(record(RESUME_WARM_MAX_AGE_MS), NOW), "warm");
assert.equal(classifyResumeRecord(record(RESUME_WARM_MAX_AGE_MS + 1), NOW), "stale");
assert.equal(classifyResumeRecord(null, NOW), "none");
assert.equal(classifyResumeRecord({}, NOW), "none");
assert.equal(
  classifyResumeRecord({ navigationRoute: { id: "r1" } }, NOW),
  "none",
  "missing fix timestamp is not resumable",
);
assert.equal(
  classifyResumeRecord(record(-5_000), NOW),
  "none",
  "future timestamps are invalid",
);

assert.equal(shouldSpeakHeadlessCue({ appActive: true }), false);
assert.equal(shouldSpeakHeadlessCue({ appActive: false }), true);
assert.equal(shouldSpeakHeadlessCue(), true, "no probe = assume off-screen (lock screen)");

console.log("resume policy tests passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-resume-policy.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/navigation/resumePolicy.js`:

```js
// Pure resume/headless-voice policy (plans/navigation-ride-feedback-2, R3/R4).
// The mobile runtime and App bootstrap consume these so the decisions stay
// node-tested; the native side only supplies timestamps and an AppState probe.

export const RESUME_HOT_MAX_AGE_MS = 10 * 60 * 1000;
export const RESUME_WARM_MAX_AGE_MS = 60 * 60 * 1000;

// hot: crashed moments ago, mid-ride — auto-resume into the nav UI.
// warm: recent — prompt to continue or end.
// stale: too old — clear silently. none: nothing usable persisted.
export function classifyResumeRecord(record, now = Date.now()) {
  if (!record || !record.navigationRoute) return "none";
  const last = Number(record.lastProcessedFixTimestamp);
  if (!Number.isFinite(last)) return "none";
  const age = now - last;
  if (age < 0) return "none";
  if (age <= RESUME_HOT_MAX_AGE_MS) return "hot";
  if (age <= RESUME_WARM_MAX_AGE_MS) return "warm";
  return "stale";
}

// Headless cues exist for the locked screen; a rider looking at the app on
// another screen must not hear a ghost ride (R3).
export function shouldSpeakHeadlessCue({ appActive = false } = {}) {
  return appActive !== true;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node tests/test-resume-policy.mjs`
Expected: `resume policy tests passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/resumePolicy.js tests/test-resume-policy.mjs
git commit -m "feat(nav): pure resume classification and headless-voice policy"
```

---

### Task 5: Runtime wiring — silent foreground headless, arrival ends and clears (R3 + R2 background)

**Files:**
- Modify: `apps/mobile/src/navigation/navigationRuntime.js`
- Modify: `apps/mobile/src/navigation/activeNavigationStore.js:11` (`STALE_AFTER_MS`)

**Interfaces:**
- Consumes: `shouldSpeakHeadlessCue`, `RESUME_WARM_MAX_AGE_MS` from `@cycleways/core/navigation/resumePolicy.js`; `getState().status === "ended"` from Task 3.
- Produces: `setNavigationRuntimeAppActiveProbe(probe)` export — Task 6 registers `() => AppState.currentState === "active"` from App bootstrap.

This file is native glue (imports expo modules) — no node test; the decisions it applies are tested in Task 4, and Task 8 verifies on the simulator.

- [ ] **Step 1: Add the probe and gate speech**

In `navigationRuntime.js` add to the imports:

```js
import { shouldSpeakHeadlessCue } from "@cycleways/core/navigation/resumePolicy.js";
```

Add near `foregroundProcessor`:

```js
// App bootstrap registers an AppState probe; headless cues stay silent while
// the rider is foreground-active without the nav screen mounted (R3). Default
// false = off-screen, so lock-screen guidance works before registration.
let appActiveProbe = () => false;

export function setNavigationRuntimeAppActiveProbe(probe) {
  appActiveProbe = typeof probe === "function" ? probe : () => false;
}
```

In `processBackgroundNavigationFixes`, change the speak condition:

```js
    if (next.cueEvent && record.settings?.voiceEnabled === true) {
```

to:

```js
    if (
      next.cueEvent &&
      record.settings?.voiceEnabled === true &&
      shouldSpeakHeadlessCue({ appActive: appActiveProbe() })
    ) {
```

- [ ] **Step 2: Replace the 60s arrival timer with end+clear**

Delete `ARRIVAL_BACKGROUND_CONFIRM_MS`, the `isArrival` helper, and the `arrivalDetectedAt` bookkeeping in `persistFromSession` (the core session owns arrival now — Task 3). In `processBackgroundNavigationFixes`, after the fix loop and before `persistFromSession`, add:

```js
  // The core session auto-ends on confirmed arrival (R2): finish the ride
  // headlessly — clear the persisted session and release location updates.
  if (session.getState()?.status === "ended") {
    await clearActiveNavigationSession();
    await stopNavigationBackgroundUpdates();
    return true;
  }
```

`clearActiveNavigationSession` is already imported. In `persistFromSession`, keep the record-identity re-check but save without `arrivalDetectedAt`.

- [ ] **Step 3: Shrink the store staleness window**

In `activeNavigationStore.js` replace:

```js
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
```

with:

```js
import { RESUME_WARM_MAX_AGE_MS } from "@cycleways/core/navigation/resumePolicy.js";

const STALE_AFTER_MS = RESUME_WARM_MAX_AGE_MS;
```

(place the import with the file's other imports).

- [ ] **Step 4: Static check**

Run: `node tests/test-mobile-undefined-references.mjs`
Expected: `ok` (catches any leftover reference to the deleted `isArrival`/`ARRIVAL_BACKGROUND_CONFIRM_MS`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/navigation/navigationRuntime.js apps/mobile/src/navigation/activeNavigationStore.js
git commit -m "fix(nav): headless voice only off-screen; background arrival ends and clears the ride"
```

---

### Task 6: Launch resume — hot auto-resume, warm prompt (R4 UI)

**Files:**
- Modify: `apps/mobile/App.js` (bootstrap effect around lines 71-121, plus a warm-prompt effect)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (consume a `resumeRide` param near the `routeTokenParam` load effect, ~line 3054)

**Interfaces:**
- Consumes: `classifyResumeRecord` (Task 4), `setNavigationRuntimeAppActiveProbe` (Task 5), `loadActiveNavigationSession`/`clearActiveNavigationSession` from `activeNavigationStore.js`, `stopNavigationBackgroundUpdates` from `locationService.js`, `createRidePlan` from `@cycleways/core/navigation/ridePlan.js`, and BuildScreen's existing `confirmRidePlan` + `setPendingNavigationRouteId` (auto-starts navigation when the confirmed route id matches).
- Produces: Build screen params `{ routeToken, resumeRide: { direction, startMode, startProgressMeters, selectedPoint } }`. The persisted `record.navigationRoute` carries `routeParam`, `direction`, `startMode`, `startProgressMeters` (see `effectiveNavigationRoute.js:245-259` and `navigationRoute.js:17`).

Native glue — verified on the simulator in Task 8.

- [ ] **Step 1: App bootstrap — classify and route**

In `App.js` add imports:

```js
import { Alert } from "react-native";
import { AppState } from "react-native"; // merge into the existing react-native import
import { classifyResumeRecord } from "@cycleways/core/navigation/resumePolicy.js";
import {
  clearActiveNavigationSession,
  loadActiveNavigationSession,
} from "./src/navigation/activeNavigationStore.js";
import { setNavigationRuntimeAppActiveProbe } from "./src/navigation/navigationRuntime.js";
import { stopNavigationBackgroundUpdates } from "./src/navigation/locationService.js";
```

Add module-level helper next to `navigationRef`:

```js
function resumeParamsFromRecord(record) {
  const route = record.navigationRoute;
  return {
    routeToken: route.routeParam,
    resumeRide: {
      direction: route.direction,
      startMode: route.startMode,
      startProgressMeters: route.startProgressMeters,
      selectedPoint: route.selectedPoint ?? null,
    },
  };
}
```

Inside `App()` add `const [warmResume, setWarmResume] = useState(null);` and register the probe once:

```js
  useEffect(() => {
    setNavigationRuntimeAppActiveProbe(() => AppState.currentState === "active");
    return () => setNavigationRuntimeAppActiveProbe(null);
  }, []);
```

In `applyLaunchUrl`, at the top of the `if (!url && !warm) {` branch (an active ride outranks a pending ride intent and deep links on cold start):

```js
        const resumeRecord = await loadActiveNavigationSession();
        if (!mounted || requestId !== launchRequestId) return;
        const resumeClass = classifyResumeRecord(resumeRecord);
        if (resumeClass === "hot" && resumeRecord.navigationRoute?.routeParam) {
          initialTargetRef.current = {
            screen: "Build",
            params: resumeParamsFromRecord(resumeRecord),
          };
          return { error: null, resolved: null };
        }
        if (resumeClass === "warm" && resumeRecord.navigationRoute?.routeParam) {
          setWarmResume(resumeRecord);
        } else if (resumeClass === "stale") {
          void clearActiveNavigationSession();
          void stopNavigationBackgroundUpdates();
        }
```

- [ ] **Step 2: Warm prompt**

Add an effect in `App()` (fires once the navigator is up; `ready` is the existing bootstrap-complete state):

```js
  useEffect(() => {
    if (!ready || !warmResume) return;
    const record = warmResume;
    setWarmResume(null);
    Alert.alert("רכיבה פעילה נשמרה", "להמשיך את הרכיבה הקודמת?", [
      {
        text: "סיום הרכיבה",
        style: "destructive",
        onPress: () => {
          void clearActiveNavigationSession();
          void stopNavigationBackgroundUpdates();
        },
      },
      {
        text: "המשך רכיבה",
        onPress: () => {
          if (navigationRef.isReady()) {
            navigationRef.navigate("Build", resumeParamsFromRecord(record));
          }
        },
      },
    ]);
  }, [ready, warmResume]);
```

- [ ] **Step 3: BuildScreen — honor `resumeRide`**

In `BuildScreen.jsx`, next to `const routeTokenParam = route?.params?.routeToken ?? null;` (line 363) add:

```js
  const resumeRideParam = route?.params?.resumeRide ?? null;
  const resumeRideHandledRef = useRef(false);
```

Add an effect after the `routeTokenParam` load effect (~line 3054-3080; it sets `sourceNavigationRoute` via `handleLoadRouteParam`). Import `createRidePlan` from `@cycleways/core/navigation/ridePlan.js` if not already imported:

```js
  // Crash-resume (R4): rebuild the exact effective route the persisted session
  // was riding and auto-start; useNavigationSession's mount-restore then swaps
  // in the persisted snapshot because the route ids match.
  useEffect(() => {
    if (!resumeRideParam || resumeRideHandledRef.current) return;
    if (!sourceNavigationRoute) return;
    resumeRideHandledRef.current = true;
    const plan = createRidePlan(sourceNavigationRoute, resumeRideParam, null);
    if (!plan?.effectiveRoute?.canNavigate) return;
    confirmRidePlan(plan);
    setPendingNavigationRouteId(plan.effectiveRoute.id);
  }, [confirmRidePlan, resumeRideParam, sourceNavigationRoute]);
```

If `createRidePlan`'s derived `effectiveRoute.id` does not match the persisted `record.navigationRoute.id` for a `startMode` (`nearest`/`custom` re-derive from a live fix), the restore silently keeps a clean session — acceptable degraded mode, but verify the `official`+`forward` happy path restores on the simulator in Task 8 before accepting this task.

- [ ] **Step 4: Static check**

Run: `node tests/test-mobile-undefined-references.mjs`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/App.js apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(nav): launch-time ride resume - hot auto-resume, warm prompt, stale clear"
```

---

### Task 7: Planner locate-me preserves the view (R5)

**Files:**
- Modify: `apps/mobile/src/screens/BuildScreen.jsx:743-751` (locate handler) and the `handleCameraChanged` handler (~line 2964)

**Interfaces:**
- Consumes: existing `mapHeadingRef` pattern in `handleCameraChanged`; rnmapbox `onCameraChanged` events expose `properties.zoom` and `properties.pitch`.
- Produces: nothing downstream.

Native glue — verified on the simulator in Task 8.

- [ ] **Step 1: Track zoom and pitch**

Add refs next to `mapHeadingRef`'s declaration (search `const mapHeadingRef`):

```js
  const mapZoomRef = useRef(null);
  const mapPitchRef = useRef(null);
```

In `handleCameraChanged` (where `mapHeadingRef.current = heading;` is set, ~line 2964) add:

```js
    const zoom = Number(event?.properties?.zoom);
    if (Number.isFinite(zoom)) mapZoomRef.current = zoom;
    const pitch = Number(event?.properties?.pitch);
    if (Number.isFinite(pitch)) mapPitchRef.current = pitch;
```

(match the handler's actual event parameter name).

- [ ] **Step 2: Preserve the view on locate**

Add constants near the file's other camera constants (search `NAV_FOLLOW_ZOOM`):

```js
// Planner locate-me (R5): keep the rider's zoom/pitch; only zoom in when the
// map is too far out for the centered position to be readable.
const LOCATE_MIN_ZOOM = 12;
const LOCATE_TARGET_ZOOM = 14.5;
```

Replace the locate `setCamera` call (`BuildScreen.jsx:744-750`):

```js
      cameraRef.current?.setCamera?.({
        type: "CameraStop",
        centerCoordinate: [locationState.point.lng, locationState.point.lat],
        zoomLevel: 14.5,
        animationDuration: 500,
        animationMode: "easeTo",
      });
```

with:

```js
      const currentZoom = mapZoomRef.current;
      const currentPitch = mapPitchRef.current;
      cameraRef.current?.setCamera?.({
        type: "CameraStop",
        centerCoordinate: [locationState.point.lng, locationState.point.lat],
        zoomLevel:
          Number.isFinite(currentZoom) && currentZoom >= LOCATE_MIN_ZOOM
            ? currentZoom
            : LOCATE_TARGET_ZOOM,
        pitch: Number.isFinite(currentPitch) ? currentPitch : 0,
        animationDuration: 500,
        animationMode: "easeTo",
      });
```

Heading is deliberately not passed — the planner never sets one, so the map stays north-up.

- [ ] **Step 3: Static check**

Run: `node tests/test-mobile-undefined-references.mjs`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/BuildScreen.jsx
git commit -m "fix(nav): planner locate-me preserves zoom and pitch"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full node suite**

Run from the repo root:

```bash
for f in tests/test-*.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo suite-done
```

Expected: only `suite-done` (no `FAIL` lines). Investigate and fix any failure before proceeding.

- [ ] **Step 2: Release simulator smoke**

```bash
cd apps/mobile && npx expo run:ios --configuration Release --device <booted-sim-udid> --no-bundler
```

Then verify with Maestro (`~/.maestro/bin/maestro`, flows in `apps/mobile/.maestro/` and ad-hoc flows):
1. App opens to Discover; tapping "תכנן מסלול" opens the Build screen (no crash).
2. Locate-me: zoom into ~z15 on the Build screen, tap the locate button, screenshot — the zoom level must be visually unchanged (no jump to 14.5 framing).
3. Hot resume: hard to simulate a persisted mid-ride session on the sim without riding; at minimum verify a cold launch with no persisted session shows no resume prompt and lands on Discover.

- [ ] **Step 3: Device validation note**

Arrival auto-end, mid-route join, and crash-resume need a real ride. Record expectations for the next TestFlight build in `plans/navigation-ride-feedback-2/implementation-plan.md` under a "Device validation" section after the ride: arrival ends the ride within ~3 s of reaching the destination; joining +200 m from the start acquires immediately with guidance to the join point; killing the app mid-ride and relaunching lands back in navigation within seconds, silently.

- [ ] **Step 4: Commit any verification fixes**

```bash
git status
```

Expected: clean tree (all work committed per task).
