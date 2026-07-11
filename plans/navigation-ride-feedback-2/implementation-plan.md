# Navigation Ride Feedback Round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement design `plans/navigation-ride-feedback-2/design.md` (R1–R6): arrival auto-end, crash-resume policy with the headless zombie-voice fix, planner locate-me view preservation, and mid-route join.

**Architecture:** Route/session policy lands in pure core modules (`packages/core/src/navigation/`) with node tests. Mobile lifecycle work is split into dependency-injected, Expo-free coordinators that node tests can exercise, while React Native modules only wire services, params, and camera calls. Core first (Tasks 1–4), lifecycle + native wiring (Tasks 5–7), then end-to-end verification (Task 8).

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

// On an out-and-back shared corridor, the earliest qualifying projection is
// the outbound leg rather than the geometrically identical return leg.
{
  const route = {
    requiresStartAcquisition: true,
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 931 },
      { lat: 33.1, lng: 35.62, distanceFromStartMeters: 1862 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 2793 },
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 3724 },
    ],
  };
  const tracker = createRouteProgressTracker(route);
  const p = tracker.update({ lat: 33.1, lng: 35.61, accuracy: 5, timestamp: 1_000 });
  assert.equal(p.hasAcquiredRoute, true, "out-and-back corridor acquires");
  assert.ok(
    Math.abs(p.progressMeters - 931) < 30,
    `outbound projection wins, got ${p.progressMeters}`,
  );
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
- Produces: new module constants `ARRIVAL_LATCH_M = 15` and `ARRIVAL_CONFIRM_FIXES = 2` (exported for tests); state gains `endReason: "arrived" | "user" | null` and `arrival: { detectedAt } | null`; snapshots round-trip `arrivalDetectedAt`/`arrivalFixCount`. There is deliberately no timer fallback: two qualifying fixes are required. Task 5 relies on `getState().status === "ended"` after the headless dispatch loop.

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

// Elapsed time alone cannot confirm arrival: one qualifying fix is still only
// one sample. A non-arrival fix much later clears the latch.
{
  const session = createNavigationSession(straightRoute());
  rideToNearEnd(session);
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.61, 120_000) });
  const lateNoise = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: fix(35.6088, 180_000),
  });
  assert.equal(lateNoise.status, "navigating", "elapsed time does not auto-confirm");
  assert.equal(lateNoise.arrival, null, "later non-arrival clears the latch");
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

Also add three premature-arrival fixtures: a normal loop, a short loop whose
total length is within the tracker's search window, and a self-crossing route
with the finish geometrically near the start. For each, the first acquired fix
at the shared/near-shared start must keep `status: "navigating"`,
`arrival: null`, and a large positive `remainingMeters`. These fixtures are
the safety proof; do not replace them with an assertion that progress is
strictly monotonic.

- [ ] **Step 2: Run to verify the new cases fail**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — today the second arrival fix leaves `status: "navigating"` and `endReason`/`arrival` are undefined.

- [ ] **Step 3: Implement latch + auto-end**

In `navigationSession.js`:

1. Export constants near the top:

```js
export const ARRIVAL_LATCH_M = 15;
export const ARRIVAL_CONFIRM_FIXES = 2;
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
        // R1/R2 arrival: only an acquired route is eligible. Latch on
        // progress-based remaining distance and end on the second consecutive
        // qualifying fix. Route-shape edge cases are covered by fixtures; the
        // tracker permits bounded regression and is not assumed monotonic.
        const remainingNow = Number(mainProgress.remainingMeters);
        const arrivalFix =
          Number.isFinite(remainingNow) && remainingNow <= ARRIVAL_LATCH_M;
        if (arrivalFix) {
          if (arrivalDetectedAt === null) {
            arrivalDetectedAt = action.fix.timestamp;
            arrivalFixCount = 0;
          }
          arrivalFixCount += 1;
          const confirmed = arrivalFixCount >= ARRIVAL_CONFIRM_FIXES;
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
              cueEvent: null,
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

Note the off-route suppression test: a latched rider whose next projection
still qualifies as arrival ends via the second-fix confirm before the
off-route branch. Do not claim the tracker is strictly monotonic; the noisy
backtrack fixture above verifies that a genuine non-arrival projection clears
the latch.

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
  sessionId: "s1",
  sessionSnapshot: { version: 1, state: { status: "navigating" } },
  navigationRoute: { id: "r1", routeParam: "encoded-route" },
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
  classifyResumeRecord({ ...record(0), lastProcessedFixTimestamp: undefined }, NOW),
  "none",
  "missing fix timestamp is not resumable",
);
assert.equal(
  classifyResumeRecord({ ...record(0), lastProcessedFixTimestamp: null }, NOW),
  "none",
  "null fix timestamp is not epoch zero",
);
assert.equal(
  classifyResumeRecord({ ...record(0), lastProcessedFixTimestamp: "" }, NOW),
  "none",
  "empty fix timestamp is invalid",
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
// node-tested; the native runtime supplies timestamps and reads AppState.

export const RESUME_HOT_MAX_AGE_MS = 10 * 60 * 1000;
export const RESUME_WARM_MAX_AGE_MS = 60 * 60 * 1000;

// hot: crashed moments ago, mid-ride — auto-resume into the nav UI.
// warm: recent — prompt to continue or end.
// stale: too old — clear silently. none: nothing usable persisted.
export function classifyResumeRecord(record, now = Date.now()) {
  if (
    !record?.sessionId ||
    !record?.sessionSnapshot ||
    !record?.navigationRoute?.id ||
    !record?.navigationRoute?.routeParam
  ) return "none";
  const rawLast = record.lastProcessedFixTimestamp;
  if (rawLast === null || rawLast === undefined || rawLast === "") return "none";
  const last = Number(rawLast);
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

### Task 5: One native finalizer + bootstrap-safe headless runtime (R2 + R3)

**Files:**
- Create: `apps/mobile/src/navigation/navigationLifecycle.js`
- Modify: `apps/mobile/src/navigation/useNavigationSession.js`
- Modify: `apps/mobile/src/navigation/navigationRuntime.js`
- Modify: `apps/mobile/src/navigation/activeNavigationStore.js:11` (`STALE_AFTER_MS`)
- Test: `tests/test-navigation-lifecycle.mjs` (new)

**Interfaces:**
- Consumes: `shouldSpeakHeadlessCue`, `RESUME_WARM_MAX_AGE_MS` from `@cycleways/core/navigation/resumePolicy.js`; `endReason` and `status === "ended"` from Task 3.
- Produces: `createNavigationFinalizer(dependencies)`, an idempotent coordinator used by manual stop and foreground automatic arrival; `isAppForegroundForHeadlessSpeech(appState)`, the bootstrap-safe AppState classifier. The headless runtime keeps its smaller clear+background-stop equivalent.

- [ ] **Step 1: Write the finalizer test**

Create `tests/test-navigation-lifecycle.mjs`. Import
`createNavigationFinalizer` from the new mobile module with a relative import.
Inject counters for `stopWatch`, `stopBackgroundUpdates`,
`deactivateKeepAwake`, `stopSpeech`, and `clearPersisted`. Assert:

1. Two concurrent calls return the same in-flight promise.
2. Every dependency runs exactly once.
3. A third call after completion is a no-op.
4. One rejected best-effort dependency does not prevent the remaining cleanup
   functions from running or the finalizer from becoming complete.
5. `isAppForegroundForHeadlessSpeech` returns true for `"active"`,
   `"inactive"`, and `null`, and false only for confirmed `"background"`.

- [ ] **Step 2: Implement the injectable finalizer**

`navigationLifecycle.js` must import no React Native or Expo modules. Export:

```js
export function isAppForegroundForHeadlessSpeech(appState) {
  return appState !== "background";
}

export function createNavigationFinalizer({
  stopWatch,
  stopBackgroundUpdates,
  deactivateKeepAwake,
  stopSpeech,
  clearPersisted,
}) {
  let inFlight = null;
  let complete = false;
  return function finalizeNavigation() {
    if (complete) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const steps = [
      stopWatch,
      stopBackgroundUpdates,
      deactivateKeepAwake,
      stopSpeech,
      clearPersisted,
    ];
    inFlight = Promise.allSettled(
      steps.map((step) => Promise.resolve().then(() => step?.())),
    ).then(() => {
      complete = true;
      return true;
    });
    return inFlight;
  };
}
```

- [ ] **Step 3: Use the finalizer for both foreground end paths**

In `useNavigationSession.js`, create a fresh finalizer whenever `routeId`
changes, using the hook's existing native cleanup functions. Manual `stop()`
must dispatch `NAV_ACTIONS.STOP` first (preserving `endReason: "user"`) and
then invoke the finalizer. Add an effect that invokes the same finalizer when
the state transitions to `status === "ended" && endReason === "arrived"`.
Do not dispatch `STOP` from that effect: it would overwrite the arrival reason.

Increment `persistGenerationRef` before clearing so no late throttled callback
can advance persistence bookkeeping. Keep finalization idempotent across the
effect, an explicit stop press, route unmount, and repeated renders.

- [ ] **Step 4: Make the headless activity default safe before React mounts**

In `navigationRuntime.js`, import `AppState` from `react-native`. The default
probe is synchronous and conservative at module initialization: React Native
may report `null` while launching, and unknown must be silent rather than
mistaken for lock-screen background.

```js
const defaultAppActiveProbe = () =>
  isAppForegroundForHeadlessSpeech(AppState.currentState);
let appActiveProbe = defaultAppActiveProbe;

export function setNavigationRuntimeAppActiveProbe(probe) {
  appActiveProbe = typeof probe === "function"
    ? probe
    : defaultAppActiveProbe;
}
```

Keep the setter for deterministic tests, but do not depend on an App component
effect to establish safe behavior. Gate speech with
`shouldSpeakHeadlessCue({ appActive: appActiveProbe() })`; the AppState cases
are covered by `test-navigation-lifecycle.mjs` without importing Expo/native
runtime modules.

- [ ] **Step 5: End and break the headless fix batch**

Delete `ARRIVAL_BACKGROUND_CONFIRM_MS`, `isArrival`, and the runtime-level
`arrivalDetectedAt` record field. Inside the fix loop, after voice planning for
the current fix, check `next.status === "ended"`. On end:

1. Break immediately so later fixes cannot reuse an ended session or stale cue.
2. Clear the active session.
3. Stop background updates.
4. Return without calling `persistFromSession`.

Retain `persistFromSession`'s record-identity re-check for the non-ended path.
`persistForegroundNavigation` also stops writing the deleted runtime arrival
field.

- [ ] **Step 6: Shrink store staleness and run tests**

Import `RESUME_WARM_MAX_AGE_MS` into `activeNavigationStore.js` and use it as
`STALE_AFTER_MS`. Then run:

```bash
node tests/test-navigation-lifecycle.mjs
node tests/test-navigation-session.mjs
node tests/test-mobile-undefined-references.mjs
```

Expected: all PASS and no references to
`ARRIVAL_BACKGROUND_CONFIRM_MS` or the record-level `arrivalDetectedAt`.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/navigation/navigationLifecycle.js apps/mobile/src/navigation/useNavigationSession.js apps/mobile/src/navigation/navigationRuntime.js apps/mobile/src/navigation/activeNavigationStore.js tests/test-navigation-lifecycle.mjs
git commit -m "fix(nav): finalize foreground and headless arrival exactly once"
```

---

### Task 6: Dedicated crash-resume activation and launch precedence (R4)

**Files:**
- Create: `apps/mobile/src/navigation/navigationResume.js`
- Modify: `apps/mobile/App.js` (cold-launch resolution and warm prompt)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (rebuild the effective route without auto-start)
- Modify: `apps/mobile/src/navigation/useNavigationSession.js` (activate a requested persisted session)
- Test: `tests/test-navigation-resume.mjs` (new)
- Test: `tests/test-resume-policy.mjs` (extend)

**Interfaces:**
- Consumes: `classifyResumeRecord`, the active-session store, the shared finalizer from Task 5, `createRidePlan`, and existing location/keep-awake services.
- Produces: Build params `{ routeToken, resumeRide: { sessionId, direction, startMode, startProgressMeters, selectedPoint } }`; `createNavigationResumeCoordinator(dependencies)`; hook option `resumeSessionId` and hook state `restoreStatus: "idle" | "restoring" | "restored" | "failed"`.

- [ ] **Step 1: Tighten classifier validity and write coordinator tests**

`classifyResumeRecord` returns `none` unless the record has all of:
`sessionId`, `sessionSnapshot`, `navigationRoute.id`,
`navigationRoute.routeParam`, and a finite non-future
`lastProcessedFixTimestamp`. Extend `test-resume-policy.mjs` for every invalid
field and the exact hot/warm boundaries.

Create `tests/test-navigation-resume.mjs` for an injectable coordinator. Test:

1. Matching `sessionId` + route id installs the restored session before
   `beginWatch` and never dispatches normal start/reset actions.
2. An active restored foreground-only session starts the watch and keep-awake.
3. A restored background session starts background updates and the watch; if
   background startup fails, it marks the session foreground-only and enables
   keep-awake.
4. A paused snapshot installs but does not start either watch.
5. Session-id, route-id, invalid snapshot, and ended-snapshot mismatches run
   clear+stop and report `failed`; they never start a fresh ride.
6. Repeated activation with the same request is idempotent.

- [ ] **Step 2: Implement the pure injected resume coordinator**

`navigationResume.js` imports no React or Expo modules. Dependencies provide:
`loadRecord`, `createSession`, `installSession`, `beginWatch`,
`startBackgroundUpdates`, `stopBackgroundUpdates`, `activateKeepAwake`,
`deactivateKeepAwake`, `clearPersisted`, and `markForegroundOnly`.

Its `activate({ navigationRoute, sessionId, sessionOptions })` algorithm is:

1. Load once and require matching session and effective-route ids.
2. Construct the restored session with the snapshot and reject terminal or
   invalid state.
3. Install the restored session, settings, latest-fix dedupe key, voice memory,
   and persistence clock before starting services.
4. If paused, leave services stopped.
5. Otherwise attempt background updates when the snapshot requested them;
   fall back to foreground-only + keep-awake if unavailable, then start the
   foreground watch.
6. On any pre-install validation failure, clear persistence and stop orphaned
   background updates. Never call the normal `START` or
   `PERMISSION_GRANTED` actions.

- [ ] **Step 3: Wire explicit restoration into `useNavigationSession`**

Remove the hook's unconditional asynchronous mount restore. A session is
restored only when `resumeSessionId` is supplied. While activation is pending,
expose `restoreStatus: "restoring"` and do not expose an idle state that could
trigger BuildScreen's normal auto-start effect. Install the coordinator with
callbacks that update the hook refs/state atomically.

The ordinary route path remains unchanged when no resume id is present. A
failed explicit restore calls the shared finalizer and reports `failed`; it
does not silently create or start a clean ride.

- [ ] **Step 4: Rebuild the saved effective route without normal auto-start**

Add `sessionId` to `resumeParamsFromRecord`. In BuildScreen:

1. Read `resumeRideParam` and keep a `resumeRideHandledRef`.
2. Rebuild with `createRidePlan(sourceNavigationRoute, resumeRideParam, null)`;
   the persisted `startProgressMeters` makes nearest/custom reconstruction
   deterministic without a live fix.
3. Change `confirmRidePlan` to accept
   `{ startSession = true } = {}`. Its normal callers retain today's behavior;
   the restore caller uses `{ startSession: false }`, so it sets the confirmed
   effective route and UI but never sets `pendingNavigationRouteId`.
4. Pass `resumeRideParam.sessionId` to `useNavigationSession` as
   `resumeSessionId`.
5. If the reconstructed effective-route id differs from the persisted route
   id, let the coordinator fail+clear. This mismatch is not an acceptable
   silent degradation.

- [ ] **Step 5: Resolve active rides before URL and pending intents**

In `App.js`, classify the active record once at the start of cold-launch
resolution, outside `if (!url && !warm)`. Precedence is:

1. Hot active ride → initial Build target with resume params; return before URL
   or pending-intent resolution.
2. Warm active ride → retain `{ record, deferredUrl: url }`, finish bootstrap
   on Discover, and prompt once the navigator is ready.
3. Stale/invalid/none → clear when needed and always stop orphaned background
   updates before resolving the URL or pending intent normally.

For the warm prompt:

- **Continue:** navigate to Build with resume params; do not apply the deferred
  URL/pending intent during this launch.
- **End:** await clear+background-stop, then resolve/navigate the deferred URL;
  when there was no URL, load and navigate the pending ride intent using the
  existing shape. Do not merely mutate `initialTargetRef` after the navigator
  is already mounted.

Task 5 already supplies a bootstrap-safe `AppState` default; App.js does not
register a late probe effect.

- [ ] **Step 6: Run tests and static checks**

```bash
node tests/test-resume-policy.mjs
node tests/test-navigation-resume.mjs
node tests/test-navigation-session.mjs
node tests/test-mobile-undefined-references.mjs
```

Also grep for the removed unconditional restore path and verify no resume path
sets `pendingNavigationRouteId` or calls `nav.start()`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/resumePolicy.js apps/mobile/src/navigation/navigationResume.js apps/mobile/src/navigation/useNavigationSession.js apps/mobile/App.js apps/mobile/src/screens/BuildScreen.jsx tests/test-resume-policy.mjs tests/test-navigation-resume.mjs
git commit -m "feat(nav): restore crashed rides without resetting session progress"
```

---

### Task 7: Planner locate-me preserves the view (R5)

**Files:**
- Create: `packages/core/src/navigation/plannerLocateCamera.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx:743-751` (locate handler) and the `handleCameraChanged` handler (~line 2964)
- Test: `tests/test-planner-locate-camera.mjs` (new)

**Interfaces:**
- Consumes: rnmapbox `onCameraChanged` events expose `properties.zoom` and `properties.pitch`.
- Produces: pure `plannerLocateCameraView({ zoom, pitch })` → `{ zoomLevel, pitch }`; heading is deliberately absent so Mapbox retains it.

- [ ] **Step 1: Write and implement the pure camera-view policy**

Create tests for zoom 11.9 → 14.5, zoom 12 → 12, zoom 16 → 16,
preserved finite pitch, and missing/non-finite values → `{ zoomLevel: 14.5,
pitch: 0 }`. Assert the returned object has no `heading` key.

Implement in `plannerLocateCamera.js` with exported constants
`LOCATE_MIN_ZOOM = 12` and `LOCATE_TARGET_ZOOM = 14.5`.

- [ ] **Step 2: Track zoom and pitch**

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

- [ ] **Step 3: Preserve the view on locate**

Import `plannerLocateCameraView` from the new core module.

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
      const retainedView = plannerLocateCameraView({
        zoom: mapZoomRef.current,
        pitch: mapPitchRef.current,
      });
      cameraRef.current?.setCamera?.({
        type: "CameraStop",
        centerCoordinate: [locationState.point.lng, locationState.point.lat],
        ...retainedView,
        animationDuration: 500,
        animationMode: "easeTo",
      });
```

Heading is deliberately not passed. Mapbox therefore retains the current
heading, including a user-rotated planner view.

- [ ] **Step 4: Tests and static check**

Run: `node tests/test-planner-locate-camera.mjs && node tests/test-mobile-undefined-references.mjs`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/plannerLocateCamera.js apps/mobile/src/screens/BuildScreen.jsx tests/test-planner-locate-camera.mjs
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
3. Foreground arrival cleanup: use a short SIM journey through the real
   `useNavigationSession` path; after the second arrival fix verify the UI is
   ended, `endReason` remains `arrived`, no more foreground fixes are consumed,
   keep-awake is released, background location is stopped, and the active
   session file is absent.
4. Hot resume: start a simulator ride with simulated location, wait until at
   least one progressed snapshot is persisted, then terminate without using
   the stop button:

   ```bash
   xcrun simctl terminate <booted-sim-udid> app.cycleways.mobile
   xcrun simctl launch <booted-sim-udid> app.cycleways.mobile
   ```

   Verify launch lands directly on Build in active navigation, progress is not
   reset to zero, and new simulated fixes continue advancing it. This check is
   required; a no-record cold launch is not an acceptable substitute.
5. Cold launch with no persisted session: no prompt, Discover opens, and no
   background location task remains registered.
6. Cold deep link while a warm record exists: the resume prompt appears before
   the linked route. Choosing End clears the ride and then opens the linked
   route; choosing Continue opens the saved active ride instead.

- [ ] **Step 3: Device validation note**

Arrival auto-end, mid-route join, and crash-resume still need a real ride.
Record expectations for the next TestFlight build in
`plans/navigation-ride-feedback-2/implementation-plan.md` under a "Device
validation" section after the ride: arrival ends the ride on the second
qualifying fix and releases location/keep-awake; joining +200 m from the start
acquires immediately with guidance to the join point; killing the app
mid-ride and relaunching lands back in navigation within seconds, silently,
at the saved progress.

- [ ] **Step 4: Commit any verification fixes**

```bash
git status
```

Expected: clean tree (all work committed per task).
