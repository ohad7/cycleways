# Navigation Camera and Scenario Harness — Implementation Plan

**Date:** 2026-07-09
**Status:** Ready for implementation
**Design:** `plans/navigation-camera-storyboard/design.md`

## Objective

Replace the current stage-preset camera and CAM micro-scenarios with:

1. A declarative viewport-intent model.
2. A shared geometry-aware framing and zoom policy.
3. Calm, UI-aware native camera application.
4. Retained connector-to-main-route seam state.
5. Local arrival behavior.
6. Deterministic journey fixtures shared by SIM, CAM, and the headless runner.
7. CAM bookmarks that replay and hold real camera transitions.

## Implementation Principles

- Preserve the user’s existing changes and migrate the current partial camera
  implementation rather than layering a second camera system beside it.
- Keep stage, geometry authority, bearing, lookahead, zoom clamps, and
  transition policy in pure core modules.
- Keep Mapbox calls, measured screen/panel insets, and screen-coordinate
  validation in the mobile adapter.
- The camera must receive explicit padding/anchor information on every applied
  frame. It must not rely on padding left by a previous camera operation.
- SIM, CAM, and headless execution must use the same route, fixes, connector
  responses, and scenario metadata.
- CAM visual acceptance runs at 1x. Accelerated SIM playback is not a
  camera-timing acceptance mode.
- All dev camera UI and diagnostics remain out of production bundles.
- Do not add a new production summary control in this work. Product arrival
  defaults to `arrived-local`; `ride-summary` is supported as a camera intent
  for an existing or future explicit overview request.

## Initial Accepted Tuning

Centralize these values in one core defaults object; do not scatter numeric
copies through `BuildScreen`:

```text
intro pitch                         55°
too-far pitch                       40°
show-leg pitch                      35°
guided approach / ride pitch        55°
maneuver pitch                      35–40°
off-route pitch                     20°
arrival pitch                       30–35°
arrived-local / summary pitch       0°

follow zoom clamp                   15.6–17.0
maneuver zoom clamp                 16.2–17.2
lookahead                           clamp(120, 400, 100 + speedMps * 30) m
behind distance                     20–40 m
post-maneuver geometry              60–120 m
rider anchor                        70–75% of usable viewport height
zoom dead band                      0.1–0.2 levels
normal zoom velocity                0.5–0.8 levels / second
normal zoom easing                  1–2 seconds
```

Exact values remain configurable and may be tuned after realistic CAM review,
but the accepted policy—corridor-derived zoom with stage-specific clamps—does
not change.

## Phase 1 — Core Viewport Contract

### Task 1: Introduce a declarative viewport intent

**Files:**

- Modify: `packages/core/src/navigation/cameraDirector.js`
- Create: `packages/core/src/navigation/cameraViewportIntent.js`
- Modify: `tests/test-camera-director.mjs`
- Create: `tests/test-camera-viewport-intent.mjs`

**Produce:**

- A normalized intent with at least:
  - `stage`
  - `viewportMode: "follow" | "overview"`
  - `geometryRole`
  - `bearingPolicy`
  - pitch target/range
  - zoom policy and clamps
  - rider anchor
  - lookahead/behind distances
  - required focus/fit kinds
  - transition metadata
- One defaults object containing the accepted tuning values.
- Compatibility mapping only where needed while `BuildScreen` is migrated.

**Steps:**

- [ ] Define and validate the viewport-intent shape in a small pure module.
- [ ] Replace stage-specific ad hoc shot objects with normalized intents.
- [ ] Keep `stage` diagnostic names but separate them from viewport mode.
- [ ] Add `arrived-local` and `ride-summary`; stop treating `arrived` as an
  automatic whole-route fit.
- [ ] Remove the fixed `APPROACH_TOO_FAR_ZOOM` policy.
- [ ] Preserve unknown fields only during the migration; remove compatibility
  fields after native integration is complete.
- [ ] Test every stage’s mode, geometry role, pitch policy, zoom policy, bearing
  policy, and transition kind.

### Task 2: Make camera stage transitions stateful and calm

**Files:**

- Modify: `packages/core/src/navigation/cameraDirector.js`
- Modify: `tests/test-camera-director.mjs`

**Produce:**

- `approach-resolving` holds the last accepted intent.
- Connector request/refresh states do not cause `55° → 20° → 55°` bounce.
- Maneuver entry and exit use distance/geometry thresholds plus hysteresis.
- Join and recovery transitions have explicit source/target stages and duration.

**Steps:**

- [ ] Track the last accepted non-request camera intent.
- [ ] Treat ownership `unknown` plus `suggestionStatus: requesting` as hold, not
  a new generic fit stage.
- [ ] Preserve the last accepted tier during show-leg connector refresh.
- [ ] Define maneuver entry distance using active cue distance and speed; do not
  enter solely because cue type is `turn`/`bend`.
- [ ] Define maneuver exit after passing the decision by a clear distance.
- [ ] Coalesce adjacent maneuver focus windows when their geometry overlaps.
- [ ] Keep off-route immediate.
- [ ] Make reacquisition transition from off-route to ride rather than snapping.
- [ ] Add tests for transient request/cue states and rapid tier refreshes.

## Phase 2 — Geometry, Zoom, and Refit Policy

### Task 3: Build pure route-corridor helpers

**Files:**

- Create: `packages/core/src/navigation/cameraViewport.js`
- Reuse: `packages/core/src/utils/geometry.js`
- Create: `tests/test-camera-viewport.mjs`

**Produce:**

- Pure helpers for:
  - usable viewport metrics;
  - speed-derived lookahead;
  - route corridor extraction before/after progress;
  - maneuver corridor including post-maneuver geometry;
  - required point and geometry roles;
  - target zoom estimation with clamps;
  - zoom dead band/rate limiting;
  - overview reframe decisions and hysteresis.

**Suggested APIs:**

```js
cameraLookaheadMeters(speedMps, options)
cameraCorridorForProgress(geometry, progressMeters, options)
cameraManeuverCorridor(geometry, riderMeters, cueMeters, options)
cameraTargetZoom({ geometry, viewport, pitch, bearing, minZoom, maxZoom })
nextAppliedZoom({ current, target, dtMs, policy, force })
shouldReframeOverview(previousFrame, nextRequirements, policy)
```

Names may change, but the separation of responsibilities should remain.

**Steps:**

- [ ] Move reusable intro distance/zoom math out of `BuildScreen` where it fits
  the shared solver.
- [ ] Implement Web Mercator/local-distance estimation suitable for phone-scale
  camera framing.
- [ ] Make viewport width/height and all insets explicit inputs.
- [ ] Make pitch and bearing explicit inputs to target zoom estimation.
- [ ] Clamp corridor distances safely at geometry ends.
- [ ] Include a bounded amount of geometry behind the rider.
- [ ] Ensure maneuver corridors include 60–120 m after the decision when route
  length permits.
- [ ] Add zoom dead-band, easing-target, and maximum-rate helpers.
- [ ] Add overview hysteresis based on geometry identity, target movement,
  viewport margins, and minimum rider movement.
- [ ] Test small/tall phones, portrait dimensions, short/long corridors, sharp
  turns, forks, route end, and degenerate geometry.

### Task 4: Upgrade heading selection to use the active corridor

**Files:**

- Modify: `packages/core/src/navigation/cameraHeading.js`
- Modify: `tests/test-camera-heading.mjs`

**Produce:**

- Guide and ride use the active route/connector corridor bearing.
- Show-leg uses a stable dominant/initial connector direction.
- Too-far remains rider-to-start.
- Join blends from retained approach bearing to main bearing.
- Off-route and arrived-local hold/north-up correctly.

**Steps:**

- [ ] Change the heading helper input from only progress/shot to viewport intent
  plus resolved active corridor where needed.
- [ ] Use a short forward corridor tangent/aggregate instead of a single dense
  geometry segment when possible.
- [ ] Add a stable connector overview heading helper.
- [ ] Keep device compass excluded from camera heading.
- [ ] Extend the governor or transition layer to interpolate join and
  reacquisition headings intentionally.
- [ ] Test hairpins, dense vertices, small wobble, sharp decisions, show-leg
  movement, join, off-route, and north-up terminal states.

## Phase 3 — Navigation State and Presentation

### Task 5: Preserve connector ownership while requests are pending

**Files:**

- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify: `tests/test-navigation-session.mjs`
- Modify: `tests/test-navigation-presentation.mjs`

**Produce:**

- A connector request has separate pending metadata and does not erase the last
  accepted ownership tier/geometry.
- Camera and line styling retain the accepted approach state through refresh.

**Steps:**

- [ ] Separate `ownershipTier` from request lifecycle state.
- [ ] Preserve ready connector geometry and classification during refresh.
- [ ] Expose `ownershipResolving`/`ownershipRefreshing` explicitly if useful.
- [ ] Ensure failure policy deliberately downgrades only after the new result is
  accepted, not at request start.
- [ ] Test initial resolution, show-leg refresh, guide stability, failure, and
  threshold crossing.

### Task 6: Carry an explicit join transition snapshot

**Files:**

- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify: `packages/core/src/navigation/scenarioRunner.js`
- Modify: `tests/test-navigation-session.mjs`
- Modify: `tests/test-navigation-presentation.mjs`

**Produce:**

- The join acquisition event carries enough immutable data to render and test:
  - connector tail geometry;
  - seam point;
  - retained approach bearing;
  - first main-route corridor reference/progress;
  - source ownership tier;
  - event/fix timestamp.
- Native camera/map code can retain this snapshot for the transition duration
  even after active approach state clears.

**Steps:**

- [ ] Capture join data before `emptyApproach()` is applied.
- [ ] Attach the snapshot to the join acquisition/transition event or an
  equivalent one-shot transition field.
- [ ] Keep persisted navigation snapshots free of stale active transitions.
- [ ] Add presentation fields for connector tail and route authority transition.
- [ ] Test guide and show-leg joins, restart/persistence boundaries, and normal
  initial acquisition without a connector.

### Task 7: Separate local arrival from route summary

**Files:**

- Modify: `packages/core/src/navigation/cameraDirector.js`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify as needed: `apps/mobile/src/planner/NavPanel.jsx`
- Modify: `tests/test-camera-director.mjs`
- Modify: `tests/test-navigation-presentation.mjs`

**Produce:**

- Completion derives `arrived-local` by default.
- Whole-route fit happens only for an explicit route overview/summary request.
- No new production control is required in this slice.

**Steps:**

- [ ] Replace the current automatic whole-route arrived shot.
- [ ] Frame rider + destination/flag locally and north-up.
- [ ] Keep a `ride-summary` viewport intent callable from CAM and any existing
  explicit route-fit action.
- [ ] Ensure ending/cancelling still resets planner pitch and bearing.

## Phase 4 — Native Camera Adapter

### Task 8: Extract navigation camera application from `BuildScreen`

**Files:**

- Create: `apps/mobile/src/navigation/useNavigationCamera.js`
- Create: `apps/mobile/src/navigation/mapboxCameraAdapter.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Produce:**

- `BuildScreen` supplies session state, map/camera refs, geometry, panel metrics,
  and dev diagnostics hooks.
- The hook/director resolves viewport intent and animation state.
- The Mapbox adapter owns imperative camera operations.

**Steps:**

- [ ] Move camera refs, director/governor lifecycle, target/applied values, and
  fit keys out of the screen component.
- [ ] Keep the puck animation independent but feed the same resolved rider point
  into the camera hook.
- [ ] Define one adapter API for follow frames, overview frames, free/stop, and
  overhead reset.
- [ ] Ensure unmount/navigation stop cancels RAF and camera animations.
- [ ] Remove obsolete camera constants and stage policy from `BuildScreen`.

### Task 9: Measure and apply the usable viewport

**Files:**

- Modify: `apps/mobile/src/screens/BuildScreen.jsx`
- Modify as needed: `apps/mobile/src/planner/NavPanel.jsx`
- Modify as needed: `apps/mobile/src/planner/ApproachPanel.jsx`
- Modify as needed: `apps/mobile/src/planner/RideIntroCard.jsx`
- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`

**Produce:**

- Explicit safe-area and measured panel insets for every camera frame.
- Rider anchored at 70–75% of usable height in follow mode.
- One intentional reframe after material panel/device size changes.

**Steps:**

- [ ] Measure the visible navigation/approach/arrival panel container through
  `onLayout` without changing its product layout.
- [ ] Combine panel height, safe areas, marker clearance, and map-control
  clearance into normalized viewport metrics.
- [ ] Pass explicit padding on every camera application.
- [ ] Ensure intro marker slots use the same viewport metrics.
- [ ] Handle orientation/Dimensions changes and large-text panel height changes.
- [ ] Add pure tests for metric construction where practical.

### Task 10: Apply geometry-aware follow behavior

**Files:**

- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`
- Modify: `apps/mobile/src/navigation/mapboxCameraAdapter.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Produce:**

- Guide and ride frame active route corridors.
- Speed changes lookahead; geometry and viewport determine zoom.
- Maneuver frames include geometry after the decision.
- Zoom is smoothed and does not pulse per fix.

**Steps:**

- [ ] Resolve active geometry from `geometryRole` (`approach` or `main`).
- [ ] Calculate corridor points from the correct progress tracker.
- [ ] Calculate target center/zoom for the usable viewport and rider anchor.
- [ ] Apply zoom dead band, rate limit, and easing.
- [ ] Force a reframe only for stage safety/terminal transitions or lost required
  visibility.
- [ ] Resolve approach/main maneuver focus through the same corridor code.
- [ ] Remove dead `focusKind` values that do not affect framing.

### Task 11: Apply stable overview behavior

**Files:**

- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`
- Modify: `apps/mobile/src/navigation/mapboxCameraAdapter.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Produce:**

- Too-far uses distance-derived rider/start fit.
- Show-leg retains most/all connector geometry without repeated fit animation.
- Off-route refits only for material rejoin changes.
- Arrived-local frames rider/destination locally.

**Steps:**

- [ ] Reuse marker-slot fitting for intro and too-far where appropriate.
- [ ] Use connector geometry plus short main-route context for show-leg.
- [ ] Replace live-point fit keys with semantic reframe conditions.
- [ ] Add viewport-margin checks before moving an accepted overview.
- [ ] Keep off-route bearing frozen while allowing position/target reframing.
- [ ] Add one post-application visibility correction only if Mapbox’s pitched fit
  leaves a required point outside the safe viewport.

### Task 12: Implement seam, recovery, free mode, and reset transitions

**Files:**

- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`
- Modify: `apps/mobile/src/navigation/mapboxCameraAdapter.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Produce:**

- Join visibly blends connector frame/heading into main-route cruise.
- Reacquisition blends from stable recovery overview into follow.
- User gesture immediately enters free mode; recenter applies the current
  derived intent.
- Stop/cancel/reset is explicitly 0° pitch and north-up.

**Steps:**

- [ ] Capture one-shot join transition snapshots from session state.
- [ ] Animate seam center, bearing, pitch, zoom, and padding as one transition.
- [ ] Prevent a subsequent fix from clearing the visual transition early.
- [ ] Add equivalent but simpler recovery-to-ride transition.
- [ ] Stop all automatic camera writes while `cameraIntent === "free"`.
- [ ] Recenter from the current stage, not a generic ride preset.
- [ ] Verify paused navigation does not move the camera.

## Phase 5 — Map Layer Authority

### Task 13: Align line and marker styling with geometry authority

**Files:**

- Modify: `apps/mobile/src/screens/BuildScreen.jsx`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify: `tests/test-navigation-presentation.mjs`

**Produce:**

- Too-far: direct line only.
- Show-leg: suggestion connector active for context, main route secondary.
- Guide: guided connector visually authoritative, main route secondary.
- Join: connector tail and main route overlap during authority transition.
- Ride: connector clears and main route becomes authoritative.
- Start/destination markers derive from session targets where possible.

**Steps:**

- [ ] Add explicit presentation roles/opacities rather than infer all styling
  from status in the screen.
- [ ] Dim/upcoming-style the main route during approach.
- [ ] Use the retained join snapshot for connector tail rendering.
- [ ] Crossfade or step line authority in sync with the camera transition.
- [ ] Derive the start marker from `approach.target.point` when no confirmed plan
  object is present.
- [ ] Test map-layer flags for every stage and tier.

## Phase 6 — Shared Journey and Connector Harness

### Task 14: Replace connector mode strings with deterministic responses

**Files:**

- Create: `packages/core/src/navigation/scenarioConnector.js`
- Modify: `packages/core/src/navigation/scenarioRunner.js`
- Modify: `packages/core/src/navigation/scenarios/resolve.js`
- Modify: `tests/test-nav-scenario-resolve.mjs`
- Modify: `tests/test-nav-scenario-runner.mjs`

**Produce:**

- A resolved journey contains deterministic connector responses.
- The same adapter can answer headless and native connector requests.
- Requests are matched deterministically and fail clearly if the fixture is
  incomplete or out of order.

**Steps:**

- [ ] Define response fixtures with geometry, distance, edge costs, snapped
  endpoints, failure, target mode, and optional request matcher.
- [ ] Create a pure stateful adapter/router over the response list.
- [ ] Return full connector results, not only geometry.
- [ ] Migrate legacy `straight-line`/`show-leg`/`guide-turn`/`fail` declarations
  or keep a temporary converter until every scenario is migrated.
- [ ] Ensure response distance and edge-cost totals are internally consistent.
- [ ] Test success, failure, repeated refresh, rejoin requests, unmatched
  requests, and exhausted fixtures.

### Task 15: Install the scenario connector in the native session

**Files:**

- Modify: `apps/mobile/src/screens/BuildScreen.jsx`
- Modify as needed: `apps/mobile/src/navigation/useNavigationSession.js`
- Reuse: `packages/core/src/navigation/scenarioConnector.js`

**Produce:**

- Selecting SIM/CAM installs both the location source and connector adapter.
- Ending the dev journey clears both overrides.
- Intro connector preview and active navigation use the declared scenario result
  when the scenario is active.

**Steps:**

- [ ] Add a stable dev connector proxy parallel to `devSourceProxy`.
- [ ] Set the resolved connector adapter before opening intro or calling
  `nav.start()`.
- [ ] Route ride-intro connector preview through the same proxy.
- [ ] Clear overrides on cancel, stop, error, route change, and unmount.
- [ ] Surface a clear dev alert/overlay error if a scenario response does not
  match the request.
- [ ] Add static/unit coverage proving BuildScreen no longer ignores resolved
  connector data where practical.

### Task 16: Add journey and camera-bookmark schema

**Files:**

- Modify: `packages/core/src/navigation/scenarios/resolve.js`
- Modify: `packages/core/src/navigation/scenarios/index.js`
- Modify: `tests/test-nav-scenario-resolve.mjs`

**Produce:**

- Journey metadata shared by SIM, CAM, and headless execution.
- Bookmark metadata with pre-roll, hold, expected stage, and expectations.

**Steps:**

- [ ] Add validated `bookmarks[]` and connector response metadata.
- [ ] Validate unique bookmark names and in-range fix/time references.
- [ ] Resolve bookmark start/pre-roll positions deterministically.
- [ ] Keep ordinary scenarios valid with zero bookmarks.
- [ ] Remove `camera: true`/`group: "camera"` once all CAM-specific fixtures are
  migrated.

### Task 17: Curate realistic shared journeys

**Files:**

- Create/modify under: `packages/core/src/navigation/scenarios/`
- Reuse route snapshots under: `packages/core/src/navigation/scenarios/routes/`
- Remove after migration: `packages/core/src/navigation/scenarios/camera-storyboard.js`
- Modify: `tests/test-nav-scenarios.mjs`

**Produce:**

1. Guided approach → approach maneuver → join → ride → maneuver → arrival.
2. Show-leg → live connector movement → acquisition.
3. Too-far intro/approach → cancel/reset.
4. Missed turn → off-route → moving rejoin → reacquisition.

**Steps:**

- [ ] Prefer real catalog route snapshots and road/path-aligned connector
  geometry visible in the bundled map.
- [ ] Sample fixes along the actual connector/route geometry at plausible
  cycling speed.
- [ ] Make timestamp displacement, `speed`, and `heading` agree.
- [ ] Include enough movement and dwell around each bookmark to observe tracking
  and transition settling.
- [ ] Add bookmarks for all stage-table entries plus pan/recenter and reset.
- [ ] Add camera bookmarks to stop/GPS-gap/parallel/wrong-way journeys where
  behavior is materially different.
- [ ] Delete the direct-line fake show-leg and teleporting CAM fix arrays.
- [ ] Keep synthetic L/grid routes for pure/headless logic tests only or label
  them clearly as non-visual.

## Phase 7 — Playback, SIM, and CAM

### Task 18: Add a controllable journey playback source

**Files:**

- Modify or replace: `apps/mobile/src/navigation/simulateRideSource.js`
- Create as needed: `apps/mobile/src/navigation/scenarioPlaybackController.js`
- Add tests under: `tests/`

**Produce:**

- Full playback for SIM.
- Bookmark pre-roll, pause/resume, replay, and step for CAM.
- Explicit completion/hold state.
- Deterministic restart when stepping backward or replaying a transition.

**Steps:**

- [ ] Separate playback controller state from the location-source interface.
- [ ] Support `start`, `pause`, `resume`, `step`, `stop`, and completion callback.
- [ ] Implement backward seek by restarting the navigation session and replaying
  the required prefix deterministically; do not mutate session internals.
- [ ] Keep original fix timestamps unchanged.
- [ ] Run CAM at 1x and hold the final bookmark state for its declared duration.
- [ ] Retain 1x/4x/8x for SIM with a note that only 1x is camera-accurate.
- [ ] Test timers with a fake clock.

### Task 19: Make SIM and CAM views of the same journeys

**Files:**

- Modify: `apps/mobile/src/planner/DevScenarioPicker.jsx`
- Create or modify: `apps/mobile/src/planner/DevCameraStoryboardPicker.jsx`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Produce:**

- SIM lists journeys and plays them end to end.
- CAM lists journey bookmarks and opens the same resolved journey.
- CAM provides replay/pause/step/restart controls.

**Steps:**

- [ ] Remove the separate camera-scenario filtering model.
- [ ] Keep separate SIM and CAM entry buttons if useful, but source both from the
  same journey registry.
- [ ] Show journey name plus bookmark stage/description in CAM.
- [ ] Start intro bookmarks through the real intro flow.
- [ ] Start active bookmarks with declared pre-roll rather than directly faking
  a camera state.
- [ ] Show explicit playback error/completion/hold state.
- [ ] Ensure product controls and map gestures remain interactive.

### Task 20: Rebuild the camera diagnostics overlay

**Files:**

- Modify: `apps/mobile/src/planner/DevCameraOverlay.jsx`
- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Produce:**

- Overlay appears only in CAM/camera-inspection mode.
- Target and applied camera values are distinguishable.
- Updates are throttled and do not affect camera performance.

**Steps:**

- [ ] Add journey/bookmark, viewport mode, geometry role, target/applied
  pitch/zoom/heading, insets, rider anchor, corridor distances, tier, connector
  response id, transition/refit reason, and refit count.
- [ ] Throttle to at most 4–5 updates per second and update immediately only on a
  stage/transition/error change.
- [ ] Keep overlay `pointerEvents="none"`.
- [ ] Ensure the overlay does not reserve production viewport space.
- [ ] Guard the module import/reference so production bundles do not include the
  component or journey UI.

## Phase 8 — Headless Camera Timeline and Expectations

### Task 21: Sample applied camera frames headlessly

**Files:**

- Modify: `packages/core/src/navigation/scenarioRunner.js`
- Create as needed: `packages/core/src/navigation/cameraReplayRunner.js`
- Modify: `tests/test-nav-scenario-runner.mjs`

**Produce:**

- Headless artifacts contain both target intent and interpolated/applied camera
  values over time.
- Stage dwell, join/recovery interpolation, and zoom smoothing are testable.

**Steps:**

- [ ] Advance a deterministic camera clock between location fixes at a bounded
  sample rate.
- [ ] Use the same director, viewport helpers, heading governor, and zoom
  smoothing as native.
- [ ] Record stage, mode, geometry role, target/applied values, transition,
  refit reason/count, and approach tier.
- [ ] Keep artifact size bounded by sampling only meaningful changes or a modest
  frame interval.
- [ ] Test clock gaps, dwell, pause, terminal hold, and accelerated functional
  playback independence.

### Task 22: Add ordered and negative camera expectations

**Files:**

- Modify: `packages/core/src/navigation/scenarioExpectations.js`
- Modify: `tests/test-nav-scenario-expectations.mjs`
- Modify: shared journey expectation lists

**Produce:**

- Expectations for:
  - ordered stage sequences;
  - stage duration/hold;
  - mode and geometry role;
  - target/applied pitch and zoom ranges;
  - maximum heading/zoom changes;
  - maximum overview refits;
  - voice/cue never occurring during show-leg;
  - connector geometry absent during too-far;
  - camera writes absent in free mode;
  - reset/arrival-local north-up state.

**Steps:**

- [ ] Add focused evaluator vocabulary rather than embedding scenario-specific
  JavaScript assertions.
- [ ] Validate all new expectation types with passing and failing unit fixtures.
- [ ] Make missing stages fail sequence/duration assertions clearly.
- [ ] Assert `guide → guide-pre-turn → join-route → ride` in one shared journey.
- [ ] Assert `arrival → arrived-local` without automatic `ride-summary`.

## Phase 9 — Validation and Cleanup

### Task 23: Focused automated validation

Run after each relevant phase and as a final group:

```bash
node tests/test-camera-director.mjs
node tests/test-camera-heading.mjs
node tests/test-camera-viewport-intent.mjs
node tests/test-camera-viewport.mjs
node tests/test-navigation-session.mjs
node tests/test-navigation-presentation.mjs
node tests/test-nav-scenario-resolve.mjs
node tests/test-nav-scenario-runner.mjs
node tests/test-nav-scenario-expectations.mjs
node tests/test-nav-scenarios.mjs
```

- [ ] Add every new test to the repository’s normal test command if tests are
  enumerated rather than discovered.
- [ ] Run existing navigation smoothing, route progress, puck anchor, voice,
  haptic, replay, and mobile static/config tests.
- [ ] Run `git diff --check`.

### Task 24: Native visual acceptance matrix

Use CAM at 1x on at least one small and one tall iPhone simulator/device.

For every stage/bookmark verify:

- [ ] Rider, required target, route corridor, cue, and markers are outside UI
  occlusion.
- [ ] Rider is anchored low during follow.
- [ ] Zoom does not pulse or restart every fix.
- [ ] High-pitch cruise shows enough route ahead.
- [ ] Maneuver frame includes useful geometry after the decision.
- [ ] Too-far shows both rider and start at short and long distances.
- [ ] Show-leg makes the connector leg obvious and stays non-narrated.
- [ ] Join shows connector tail and main route together before blending.
- [ ] Off-route bearing remains stable while puck direction stays live.
- [ ] Reacquisition is a transition, not a snap.
- [ ] Arrival remains local; whole route does not appear automatically.
- [ ] Pan/free, recenter, pause, stop, cancel, and reset behave correctly.
- [ ] Large text and changed panel heights cause one correct reframe.

### Task 25: Performance and release gates

- [ ] Diagnostics update no more than 4–5 times per second.
- [ ] No React state update is performed on every camera RAF frame.
- [ ] Steady ride does not call overview fit operations.
- [ ] Stable show-leg/off-route overviews stay within their declared refit budget.
- [ ] Camera RAF and playback timers stop on navigation end/unmount.
- [ ] Production build completes.
- [ ] Release bundle/config inspection confirms CAM picker, journey controls,
  diagnostics overlay, and dev connector/location overrides are absent.
- [ ] Privacy declarations and Mapbox telemetry behavior remain unchanged.

### Task 26: Remove superseded code and reconcile documentation

**Files:**

- Modify/remove obsolete camera scenario and helper files.
- Modify: `plans/navigation-camera-storyboard/design.md` only if implementation
  uncovers a genuine design correction.
- Modify: `plans/navigation-camera-storyboard/implementation-plan.md` checkboxes
  during implementation.

**Steps:**

- [ ] Remove `camera-storyboard.js` after bookmark migration.
- [ ] Remove unused connector mode shims after all scenarios migrate.
- [ ] Remove obsolete `fitKind`/`focusKind` branches and fixed zoom constants.
- [ ] Remove stale comments describing connector guidance as static/beeline-only.
- [ ] Confirm `plans/README.md` still has one correct topic entry.
- [ ] Record any intentionally deferred items explicitly.

## Definition of Done

- The accepted stage table is implemented through one viewport-intent/framing
  system.
- Guided approach and ride use geometry-aware corridor zoom with a low rider
  anchor and explicit insets.
- Too-far, show-leg, off-route, and arrived-local use stable stage-appropriate
  overview fitting.
- Connector resolution does not bounce the camera.
- Join and reacquisition preserve spatial continuity.
- Arrival is local first and never automatically fits the whole route.
- Native and headless journeys use byte-equivalent route/fix/connector fixtures.
- SIM plays complete journeys; CAM inspects bookmarks in those same journeys.
- Realistic journeys cover all stages and critical interaction cases.
- Ordered, negative, timing, refit, and silence expectations pass.
- Native visual acceptance passes on small and tall phone layouts.
- Dev diagnostics stay performant and are absent from production builds.

## Suggested Commit Sequence

1. `refactor(nav): define camera viewport intents and tuning`
2. `feat(nav): add geometry-aware camera corridor and zoom policy`
3. `feat(nav): preserve approach ownership and seam transition state`
4. `refactor(mobile): extract mapbox navigation camera adapter`
5. `feat(mobile): apply viewport-aware follow and overview cameras`
6. `feat(nav): align approach and join map-layer authority`
7. `refactor(nav): share deterministic journey connector responses`
8. `feat(dev): add shared SIM journeys and CAM bookmarks`
9. `test(nav): add applied camera timeline and ordered expectations`
10. `chore(nav): remove superseded camera storyboard code`
