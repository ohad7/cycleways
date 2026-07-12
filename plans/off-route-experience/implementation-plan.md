# Off-Route Experience Rethink — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `plans/off-route-experience/design.md` (O1–O6): off-route becomes a rider-centered follow stage with the rejoin connector as the framed corridor, eased transitions, guided turn-by-turn rejoin, and a live distance-back banner.

**Architecture:** All behavior changes are in pure core modules (`packages/core/src/navigation/`) — camera intent, session guided-rejoin runtime, heading policy, presentation — with node tests. The only mobile change is BuildScreen's corridor-geometry pick for the new `rejoin` geometry role. The guided rejoin reuses the existing approach-leg machinery (`buildApproachLeg`, `approachTracker`, `approachCues`, `approachCueFor`) rather than adding a parallel system.

**Tech Stack:** Node test scripts (`node tests/test-*.mjs`, plain `assert`), `@cycleways/core` workspace package, React Native mobile app.

## Global Constraints

- Run all tests from the repo root: `node tests/test-<name>.mjs` (exit 0 = pass).
- Never edit `data/map-source.geojson` or `public-data/` (CLAUDE.md; not touched by this plan).
- Hebrew UI copy, RTL.
- Commit after every task; `feat(nav): …` / `fix(nav): …` messages with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Finish with `node tests/test-mobile-undefined-references.mjs` (catches release-crashing stale references).
- **Coordination:** resolved — ride-feedback-round-2 landed (`77a05e4 feat(nav): implement ride feedback round 2`); `navigationSession.js` / `BuildScreen.jsx` are clean as of 2026-07-12. Work on a dedicated branch off `main` (e.g. `feature/off-route-experience`); the currently checked-out `feature/voice-commands-bugfix` has unrelated uncommitted changes (`apps/mobile/app.json`, `data/sticker-redirects.json`) — leave them untouched.

---

### Task 1: Off-route camera intent becomes follow-with-rejoin-corridor (O1 + O2)

**Files:**
- Modify: `packages/core/src/navigation/cameraViewportIntent.js:132-142` (the `case "off-route"`)
- Test: `tests/test-camera-viewport-intent.mjs` (extend)

**Interfaces:**
- Consumes: the file's `follow(geometryRole, values)` helper (line ~64) and `NAVIGATION_CAMERA_DEFAULTS`.
- Produces: `cameraIntentForStage("off-route", state)` returns `viewportMode: "follow"`, `geometryRole: "rejoin"`, `bearingPolicy: "route"`, pitch 38 (range 35–40), `zoomPolicy: { kind: "corridor-fit", minZoom: 14.5, maxZoom: NAVIGATION_CAMERA_DEFAULTS.followMaxZoom }`, `transition: { kind: "eased", durationMs: 600 }`. Task 3 (BuildScreen) keys on `geometryRole === "rejoin"`.

- [ ] **Step 1: Write the failing test**

Read the top of `tests/test-camera-viewport-intent.mjs` for its import/assert style, then append:

```js
// --- O1/O2: off-route is a follow stage framing the rejoin corridor --------
{
  const shot = cameraIntentForStage("off-route", {});
  assert.equal(shot.viewportMode, "follow", "off-route follows the rider");
  assert.equal(shot.geometryRole, "rejoin");
  assert.equal(shot.bearingPolicy, "route");
  assert.ok(shot.pitch >= 35 && shot.pitch <= 40, `riding pitch, got ${shot.pitch}`);
  assert.equal(shot.zoomPolicy.kind, "corridor-fit");
  assert.equal(shot.zoomPolicy.minZoom, 14.5, "zoom floored, never an overview dive");
  assert.notEqual(shot.transition.kind, "immediate", "no hard cut");
  assert.ok(shot.transition.durationMs >= 400, "eased transition");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-camera-viewport-intent.mjs`
Expected: FAIL — today `viewportMode` is `"overview"`.

- [ ] **Step 3: Implement**

Replace the `case "off-route":` block (currently `viewportMode: "overview"`, `minZoom: 12`, pitch 20, `transition: { kind: "immediate", durationMs: 0 }`) with:

```js
    case "off-route":
      // O1/O2 (plans/off-route-experience): stay rider-centered and frame the
      // rejoin connector like an upcoming maneuver. The zoom floor keeps the
      // rider readable; a connector that does not fit stays off-screen.
      return follow("rejoin", {
        pitch: 38,
        pitchRange: { min: 35, max: 40 },
        zoomPolicy: {
          kind: "corridor-fit",
          minZoom: 14.5,
          maxZoom: defaults.followMaxZoom,
        },
        transition: { kind: "eased", durationMs: 600 },
      });
```

The transition kind `"eased"` is new — **verified 2026-07-12: safe.** No consumer switches on `transition.kind`: `cameraTimeline.js:12` reads only `durationMs`, `BuildScreen.jsx:2804` passes `durationMs` to `applyOverview` (overview mode only), and `cameraDirector.js` reads `state.cameraTransition` (a different object). In live follow mode the smoothing comes from the per-frame pitch lerp (`CAMERA_ROTATE_MS`) plus the zoom velocity clamp in `nextAppliedZoom` (`force: stageChanged` bypasses only the dead band, not the rate limit), so there is no hard cut; the 600 ms is exercised by the headless `cameraTimeline` sampler and by `applyOverview` when leaving off-route into an overview stage. Keep the Step 1 assertion (`durationMs >= 400`, kind !== "immediate") as the regression guard.

- [ ] **Step 4: Run camera suites**

Run: `node tests/test-camera-viewport-intent.mjs && node tests/test-camera-director.mjs && node tests/test-camera-timeline.mjs && node tests/test-nav-scenario-runner.mjs`
Expected: all PASS. Scenario fixtures that assert the old overview off-route intent must be updated to the new expectation (they encode current behavior, not requirements).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/cameraViewportIntent.js tests/test-camera-viewport-intent.mjs
git commit -m "feat(nav): off-route camera stays in rider-centered follow"
```

---

### Task 2: Guided rejoin — the connector becomes a guided leg (O4 + O6)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js` — the rejoin branch of `CONNECTOR_READY` (lines ~852-900) and the off-route `LOCATION` branch (lines ~523-581)
- Test: `tests/test-navigation-session.mjs` (extend)

**Interfaces:**
- Consumes: the guided-approach pattern already in the non-rejoin `CONNECTOR_READY` branch (lines ~774-830): `buildApproachLeg(connectorResult, { id, target })`, `createRouteProgressTracker(approachLeg.route, options)`, `buildRouteCues(approachLeg.route, { includeArrival: false })`, `approachCueFor(activeCue)` (emits `{ kind: "cue", …, leg: "approach" }` which `navigationVoice` already phrases).
- Produces: during off-route with a ready connector, `state.approach.approachLegGeometry`/`approachProgress`/`approachActiveCue` are populated and `cueEvent`s stream per fix. Task 3's corridor pick reads `approach.approachLegGeometry`. Re-acquisition still emits the existing `reacquired` announcement and `resetApproachRuntime()` clears the leg (line ~660 `if (acquiredApproach) resetApproachRuntime()` — verify `acquiredApproach` is true when a rejoin leg was active; it checks `state.approach.target`, which rejoin sets).

- [ ] **Step 1: Write the failing test**

Append to `tests/test-navigation-session.mjs` (reuse `straightRoute()` + `fix(lng, ts)`; ride onto the route, leave it, deliver a connector):

```js
// --- O4: rejoin connector is a guided leg ----------------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6, 1_000) });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.602, 5_000) });
  // Leave the route: ~200m north, dwell past the off-route confirm window.
  const off1 = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1018, lng: 35.602, accuracy: 5, timestamp: 20_000 },
  });
  const off2 = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1018, lng: 35.6021, accuracy: 5, timestamp: 26_000 },
  });
  const offState = off2.status === "off-route" ? off2 : off1;
  assert.equal(offState.status, "off-route", "left the route");
  const request = offState.routeRequest;
  assert.ok(request, "rejoin connector requested");

  // Connector back to the route: north-to-south leg with a corner.
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: request.requestId,
    geometry: [
      { lat: 33.1018, lng: 35.6021 },
      { lat: 33.1009, lng: 35.6021 },
      { lat: 33.1, lng: 35.603 },
    ],
    distanceMeters: 230,
  });
  assert.ok(
    Array.isArray(ready.approach.approachLegGeometry) &&
      ready.approach.approachLegGeometry.length >= 2,
    "rejoin connector became a guided leg",
  );

  // Fixes along the connector produce guided cue events.
  const events = [];
  for (const [lat, lng, ts] of [
    [33.1016, 35.6021, 30_000],
    [33.1012, 35.6021, 34_000],
    [33.1009, 35.6021, 38_000],
  ]) {
    const next = session.dispatch({
      type: NAV_ACTIONS.LOCATION,
      fix: { lat, lng, accuracy: 5, timestamp: ts },
    });
    if (next.cueEvent?.kind === "cue") events.push(next.cueEvent);
  }
  assert.ok(events.length >= 1, "guided cues fire along the rejoin connector");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — today the rejoin branch stores only `suggestionGeometry`; `approachLegGeometry` stays null and no `cue` events fire off-route.

- [ ] **Step 3: Implement**

1. **`CONNECTOR_READY` rejoin branch** (lines ~852-900): before the `return set({...})`, build the guided leg exactly like the approach branch does:

```js
        // O4: the rejoin connector is a guided leg — same machinery as the
        // pre-ride approach (plans/off-route-experience).
        let rejoinLeg = buildApproachLeg(connectorResult, {
          id: `${navigationRoute?.id || "route"}:rejoin:${action.requestId}`,
          target: state.approach.target?.point || state.routeRequest.to,
        });
        let rejoinProgress = null;
        let rejoinActiveCue = null;
        if (rejoinLeg) {
          approachTracker = createRouteProgressTracker(rejoinLeg.route, options);
          approachCues = buildRouteCues(rejoinLeg.route, { includeArrival: false });
          approachCueKey = null;
          if (state.latestFix) {
            rejoinProgress = approachTracker.update(state.latestFix);
            rejoinActiveCue = selectActiveCue(
              approachCues,
              rejoinProgress.progressMeters,
            );
          }
        }
```

and extend the branch's `approach` patch with:

```js
            approachLegGeometry: rejoinLeg ? rejoinLeg.geometry : null,
            approachProgress: rejoinProgress,
            approachActiveCue: rejoinActiveCue,
            ownershipTier: rejoinLeg ? "guide" : state.approach.ownershipTier,
```

(keep `suggestionGeometry` as-is — the drawn line uses it today; when `rejoinLeg` exists prefer `rejoinLeg.geometry` for both.)

2. **Off-route `LOCATION` branch** (both `return set({...})` sites, lines ~540-564 and ~573-581): when `approachTracker` is set, update the leg per fix and emit guided cues, mirroring the approaching branch (lines ~459-480):

```js
          let rejoinLegProgress = null;
          let rejoinLegActiveCue = null;
          let rejoinLegCueEvent = null;
          if (approachTracker) {
            rejoinLegProgress = approachTracker.update(action.fix);
            rejoinLegActiveCue = selectActiveCue(
              approachCues,
              rejoinLegProgress.progressMeters,
            );
            rejoinLegCueEvent = approachCueFor(rejoinLegActiveCue);
          }
```

In each off-route `set` patch, add `approachProgress: rejoinLegProgress`, `approachActiveCue: rejoinLegActiveCue` to the `approach` object and prefer the guided cue for `cueEvent`:

```js
            cueEvent: firstOffRoute ? { kind: "off-route" } : rejoinLegCueEvent,
```

3. **Leg reset:** when a *new* rejoin connector request goes out (`suggestionStatus: "requesting"` patch in the off-route branch), the previous leg keeps guiding until the replacement arrives — do not reset there. Re-acquisition reset is **verified 2026-07-12**: the acquired path (`navigationSession.js:650-660`) computes `acquiredApproach` from `state.approach.target || suggestionStatus !== "idle"` — the off-route branch always maintains `target` — so `resetApproachRuntime()` runs and the patch sets `approach: emptyApproach()`, clearing the leg geometry. Still add an assert to the Task 2 test: after riding back onto the route, `approach.approachLegGeometry` is null and the `acquired`/`reacquired` cue event fires.

- [ ] **Step 4: Run session + voice suites**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-voice.mjs && node tests/test-approach-leg.mjs && node tests/test-nav-scenario-runner.mjs`
Expected: all PASS (voice already phrases `kind: "cue"` events with `leg: "approach"`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): guided turn-by-turn rejoin along the off-route connector"
```

---

### Task 3: Heading follows the rejoin leg; BuildScreen frames the rejoin corridor (O1 wiring)

**Files:**
- Modify: `packages/core/src/navigation/cameraHeading.js` (off-route currently returns null / holds the frame)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx:2519-2545` (corridor-geometry pick in the navigation rAF loop)
- Test: `tests/test-camera-heading.mjs` (extend)

**Interfaces:**
- Consumes: `approach.approachLegGeometry` / `approach.approachProgress` populated by Task 2; `geometryRole: "rejoin"` from Task 1.
- Produces: heading target follows the rejoin leg's course while a guided leg exists off-route (frame still held when there is no leg); BuildScreen corridor = the guided leg geometry, falling back to the straight rider→rejoin-target line.

- [ ] **Step 1: Write the failing heading test**

Read `tests/test-camera-heading.mjs` for the target-function name and call convention (the heading module holds the frame off-route today — `cameraHeading.js:19-26`), then append a case:

```js
// --- O1: off-route with a guided rejoin leg steers along the leg -----------
{
  const target = cameraHeadingTargetForState(
    {
      status: "off-route",
      progress: { offRoute: true },
      approach: {
        approachLegGeometry: [
          { lat: 33.1018, lng: 35.6021 },
          { lat: 33.1, lng: 35.6021 },
        ],
        approachProgress: { offRoute: false, bearingToNextDeg: 180, smoothedSpeedMps: 4 },
      },
    },
    { stage: "off-route", bearingPolicy: "route" },
  );
  assert.ok(Number.isFinite(target), "guided rejoin has a heading target");
}
```

Adjust the call signature to the file's actual exports after reading it — the assertion to preserve: **finite heading target when a guided rejoin leg is active; null (hold) when off-route without a leg** (add the companion no-leg case asserting `null`).

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-camera-heading.mjs`
Expected: FAIL — off-route returns null unconditionally today.

- [ ] **Step 3: Implement heading**

**The fix goes in `cameraHeadingTargetForState`, NOT `cameraHeadingTarget`.** The stage-level early return at `cameraHeading.js:50-55` (`stage === "off-route" || "arrived-local" || "ride-summary"` → null) short-circuits before `cameraHeadingTarget(progress)` is ever consulted, so patching the `progress.offRoute === true` branch alone is dead code for this stage. Split `"off-route"` out of that early return and reuse the same corridor-bearing path the `approach-guide` stages use (lines 57-67):

```js
  if (stage === "arrived-local" || stage === "ride-summary") return null;

  if (stage === "off-route") {
    // Guided rejoin leg active: steer along it like an approach leg.
    // No leg: hold perfectly still — the puck carries the live direction.
    const approachProgress = state?.approach?.approachProgress || null;
    if (
      Array.isArray(state?.approach?.approachLegGeometry) &&
      state.approach.approachLegGeometry.length >= 2
    ) {
      const corridorBearing = cameraCorridorBearing(
        state.approach.approachLegGeometry,
        approachProgress?.progressMeters,
      );
      if (Number.isFinite(corridorBearing)) return corridorBearing;
      if (Number.isFinite(approachProgress?.bearingToNextDeg)) {
        return approachProgress.bearingToNextDeg;
      }
    }
    return null;
  }
```

Also update the module header comment (lines 19-26, "returns null off-route: … the map must hold perfectly still") to say the frame holds still only while no guided rejoin leg exists.

- [ ] **Step 4: BuildScreen corridor for `rejoin`**

In the rAF loop's corridor pick (`BuildScreen.jsx:2520-2545`), the geometry choice keys on `shot.geometryRole === "approach"`. Extend it:

```js
            const isApproachGeometry =
              shot.geometryRole === "approach" || shot.geometryRole === "rejoin";
            let corridorGeometry = isApproachGeometry
              ? stateNow.approach?.approachLegGeometry || []
              : geom;
            // O1 fallback: before the connector arrives, frame the straight
            // line to the rejoin target so the camera still points the way.
            if (
              shot.geometryRole === "rejoin" &&
              corridorGeometry.length < 2 &&
              validMapPoint(rawFixRef.current) &&
              validMapPoint(stateNow.approach?.target?.point)
            ) {
              corridorGeometry = [rawFixRef.current, stateNow.approach.target.point];
            }
```

(`const` → `let` for `corridorGeometry`; `corridorProgress`/`cueMeters` already use the approach fields, which Task 2 populates for rejoin.)

Cleanup while here: the overview `fitKind === "rejoin"` paths in BuildScreen become dead once off-route is a follow stage — `REJOIN_CAMERA_FIT_MIN_INTERVAL_MS` (line ~207, used ~2779) and the `"rejoin"` cases in the fit-points/`minMoveMeters` picks (~2691, ~2728, ~2766). Remove them (and the constant) rather than leaving unreachable branches.

- [ ] **Step 5: Update scenario expectations that encode "map holds still off-route"**

Three scenario fixtures assert `{ type: "camera-rotations", atMost: 0, during: "off-route" }`, which the guided-rejoin heading deliberately breaks (the frame is course-up along the leg):

- `packages/core/src/navigation/scenarios/off-route-excursion.js:28`
- `packages/core/src/navigation/scenarios/missed-turn-rejoin-later.js:44`
- `packages/core/src/navigation/scenarios/camera-journeys.js:334`, plus the `off-route-hold` / "Off-route stable overview" bookmark (~lines 292-299) which expects the old overview framing.

Where the scenario has no connector delivered (rider off-route, no leg), keep `atMost: 0` — the hold behavior is preserved without a leg. Where a rejoin leg is active, replace with a bounded expectation (e.g. rotations only while the leg turns) or drop the constraint; update the `off-route-hold` bookmark to expect the follow stage/pitch. These encode the *old* design, not requirements.

- [ ] **Step 6: Run suites + static check**

Run: `node tests/test-camera-heading.mjs && node tests/test-camera-viewport.mjs && node tests/test-nav-scenario-runner.mjs && node tests/test-nav-scenarios.mjs && node tests/test-mobile-undefined-references.mjs`
Expected: all PASS / `ok`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/cameraHeading.js apps/mobile/src/screens/BuildScreen.jsx packages/core/src/navigation/scenarios tests/test-camera-heading.mjs
git commit -m "feat(nav): off-route camera steers and frames along the rejoin leg"
```

---

### Task 4: Live off-route banner (O5)

**Files:**
- Modify: `packages/core/src/navigation/navigationPresentation.js` (off-route card state)
- Test: `tests/test-navigation-presentation.mjs` (extend)

**Interfaces:**
- Consumes: `state.approach.approachProgress.remainingMeters` (populated by Task 2 while a guided rejoin leg is active), falling back to `state.approach.distanceToRouteMeters` (maintained by the session off-route branch) when no leg exists.
- Produces: the off-route card text carries the live distance: `"יצאתם מהמסלול · 120 מ׳ לחזרה"` (distance formatted by the existing `formatDistanceMeters`; omit the suffix when neither distance is known: `"יצאתם מהמסלול"`).

- [ ] **Step 1: Write the failing test**

Read `tests/test-navigation-presentation.mjs` and the presentation module to find the function that renders the off-route card state (search `off-route` / `offRoute` in `navigationPresentation.js`), then add:

```js
// --- O5: off-route card shows the live distance back -----------------------
{
  // Guided leg active: remaining-along-leg wins over straight-line.
  const guided = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: {
      distanceToRouteMeters: 118,
      approachLegGeometry: [{ lat: 33.1, lng: 35.6 }, { lat: 33.101, lng: 35.6 }],
      approachProgress: { remainingMeters: 240 },
    },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.ok(guided.offRouteText.includes("יצאתם מהמסלול"), guided.offRouteText);
  assert.ok(/240/.test(guided.offRouteText), `leg distance, got ${guided.offRouteText}`);

  // No leg yet: straight-line fallback.
  const bare = getNavigationPresentation({
    status: "off-route",
    offRoute: true,
    approach: { distanceToRouteMeters: 118 },
    progress: { hasAcquiredRoute: true, offRoute: true },
  });
  assert.ok(/1[0-2]0/.test(bare.offRouteText), `fallback distance, got ${bare.offRouteText}`);
}
```

Replace the placeholder call with the module's real builder and shape. Verified 2026-07-12: the builder is `getNavigationPresentation(state)`; the off-route copy lives in `offRouteText` (currently the static `"חזרו למסלול"`, `navigationPresentation.js:333`) alongside `cardMode: "off-route"` and the chip `{ kind: "rejoin", text: "חזרה למסלול" }`. Existing off-route cases in `tests/test-navigation-presentation.mjs` (~lines 81, 386) show the state shape — extend those. Assert on the field BuildScreen actually renders for the off-route card (check its `cardMode === "off-route"` branch) rather than a generic `card.text`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-presentation.mjs`
Expected: FAIL — current off-route text is a generic state with no distance.

- [ ] **Step 3: Implement**

In `navigationPresentation.js`, compose `offRouteText` from the existing `formatDistanceMeters` (do not add a new formatter). Prefer remaining-along-leg, fall back to straight-line (design O5 as amended):

```js
    const legRemaining = Number(approach?.approachProgress?.remainingMeters);
    const straightLine = Number(approach?.distanceToRouteMeters);
    const hasGuidedLeg =
      Array.isArray(approach?.approachLegGeometry) &&
      approach.approachLegGeometry.length >= 2;
    const backMeters =
      hasGuidedLeg && Number.isFinite(legRemaining) ? legRemaining : straightLine;
    const offRouteText = Number.isFinite(backMeters)
      ? `יצאתם מהמסלול · ${formatDistanceMeters(backMeters)} לחזרה`
      : "יצאתם מהמסלול";
```

(wire it into the returned `offRouteText` field — currently the static `"חזרו למסלול"` at line ~333; check BuildScreen's off-route card rendering still reads that field and update copy expectations in existing tests that pin the old string.)

- [ ] **Step 4: Run to verify pass**

Run: `node tests/test-navigation-presentation.mjs && node tests/test-navigation-session.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationPresentation.js tests/test-navigation-presentation.mjs
git commit -m "feat(nav): off-route banner shows live distance back to the route"
```

---

### Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Full node suite**

```bash
for f in tests/test-*.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo suite-done
```
Expected: only `suite-done`.

- [ ] **Step 2: Release simulator smoke**

Build (`cd apps/mobile && npx expo run:ios --configuration Release --device <booted-sim-udid> --no-bundler`), open the Build screen via Maestro (`tapOn: "תכנן מסלול"`), confirm no crash. Off-route behavior itself cannot be simulated without GPS playback — if the dev simulate-ride harness (`__DEV__` Task 17 harness in BuildScreen) is available in a debug build, run an off-route scenario there and confirm: camera stays rider-centered, banner shows distance, cues voice along the connector.

- [ ] **Step 3: Device validation note**

After the next TestFlight ride, record in this file: leaving the route keeps the rider centered (no overview cut), turn-by-turn guides back, reacquire announces and returns to normal follow, and the same works under a locked screen.
