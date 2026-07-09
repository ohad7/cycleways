# Navigation Camera and Scenario Harness — Implementation Plan

**Date:** 2026-07-09
**Updated:** 2026-07-10
**Status:** Implemented; automated/native build validation complete
**Design:** `plans/navigation-camera-storyboard/design.md`

## Objective

Deliver a calm, viewport-aware navigation camera and a deterministic journey
harness without committing the project to an unproven pitched-camera solver.
The work is split into vertical phases so the most visible defects are fixed
early and each phase leaves the application in a usable, testable state.

The intended end state includes:

1. A declarative viewport-intent model shared by navigation stages.
2. Geometry-aware pitch, zoom, fit, bearing, and transition policies.
3. Measured panel insets and an explicit rider screen anchor.
4. Spatial continuity across connector refresh, join, off-route, recovery, and
   arrival.
5. Deterministic journeys shared by SIM, CAM, and the headless runner.
6. Native visual validation for perspective-dependent screen placement.

## Completion Record — 2026-07-09

- **Phase 0:** selected RNMapbox native bounds/CameraOptions with
  `getPointInView` validation; implemented a single-owner camera adapter and
  interruption state machine. No custom Web Mercator model or native bridge was
  needed.
- **Phase 1:** introduced normalized viewport intents, measured navigation
  occlusions, a 72% rider anchor, retained resolving/refresh frames, local-first
  arrival, and fail-closed semantic connector injection in native and headless
  execution.
- **Phase 2:** added corridor and maneuver framing, derived/smoothed zoom,
  corridor heading, regional pitch flattening, overview hysteresis, and retained
  join/reacquisition snapshots. All navigation writes now pass through the
  adapter.
- **Phase 3:** replaced the camera micro-scenarios with four shared journeys,
  controllable SIM/CAM playback, 1x bookmark pre-roll/hold, ordered semantic
  camera expectations, and throttled applied-state diagnostics. Visual journeys
  use real catalog/routing geometry and physically checked fixes.
- **Phase 4:** removed superseded camera fixtures/source paths and the temporary
  compatibility fields, added focused coverage, excluded the dev harness from
  production Metro graphs, and completed repository, production-export, and
  native simulator-build validation.

Lifecycle hardening completed on 2026-07-10:

- upgraded shared journeys to schema v2 with an explicit `ride-intro` entry and
  `pre-start/hold` versus `post-start/require-confirm` bookmark contracts;
- routed both SIM and CAM through the real Ride Intro and real Start action,
  with no watcher or connector consumption before confirmation;
- changed Replay to re-arm Ride Intro, made cancel/end clear all harness state,
  and restored the pre-harness setup fix/location after cleanup;
- added visible lifecycle and expected-stage labels, aligned intro diagnostics
  with `intro-start-facing`/`intro-overhead`, and added schema, playback, and
  lifecycle regression coverage.

Validation completed:

- `npm run test:navigation-camera`
- full `npm test`
- clean production `expo export --platform ios`
- Xcode Debug build for the generic iOS Simulator with code signing disabled
- production Hermes bundle inspection confirming journey names and CAM UI copy
  are absent

The CAM bookmark matrix remains the intended human visual-tuning surface across
device sizes, panel expansion, and accessibility text. Runtime screen-coordinate
validation and diagnostics are implemented so that review is observable; tuning
changes found there should stay within the accepted envelope above.

## Planning Decisions From the Design Review

The review feedback changes sequencing and technical boundaries, not the
accepted product behavior.

- Pitched fitting is a Phase 0 feasibility gate. Mapbox remains the projection
  authority; a hand-built projection model is not the default implementation.
- Camera properties have exactly one interpolation owner at a time. Continuous
  navigation frames and native camera animations must never compete.
- Early delivery prioritizes the rider anchor, measured insets, local arrival,
  retained resolving frames, and deterministic connector parity.
- Headless tests assert semantic camera intent and transition ordering. Exact
  pixel placement is validated on the native map with coordinate-to-screen
  projection.
- Scenario connector matching is semantic and fail-closed. A running scenario
  must never silently fall through to the live routing network.
- The complete corridor camera and CAM bookmark tooling remain part of the
  accepted scope, but follow the early stabilization release.

## Delivery Rules

- Preserve unrelated user changes and migrate the current implementation; do
  not create a second camera path that survives the migration.
- Keep stage selection, geometry authority, bearing policy, corridor selection,
  zoom clamps, and transition policy in pure core modules.
- Keep exact Mapbox fitting, measured screen geometry, screen-coordinate
  validation, and camera application in the mobile adapter.
- Do not modify generated Pods or `node_modules`. If the feasibility spike
  requires native Mapbox capability that `@rnmapbox/maps` does not expose, add
  the smallest maintainable local native/config-plugin bridge.
- Apply explicit padding/anchor information on every relevant frame; never rely
  on camera state left behind by an earlier operation.
- Use the real navigation session and real map in SIM and CAM. Only location,
  time, and connector responses are substituted by the harness.
- CAM visual acceptance runs at 1x. Faster SIM playback is useful for state
  coverage but is not camera-timing acceptance.
- All diagnostics and scenario controls remain development-only and contain no
  precise live-location logging by default.
- Do not add a new production summary control. Arrival defaults to
  `arrived-local`; `ride-summary` is available only for an explicit overview.

## Initial Tuning Envelope

Centralize these values in one defaults object. They are starting values for
native CAM tuning, not scattered constants or fixture-specific expectations.

```text
intro pitch                         55°
too-far pitch                       up to 40°; flatten toward 20°/0° regionally
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

If 55° cannot keep the required corridor visible on a supported viewport, the
runtime lowers pitch within the stage’s accepted range before discarding
required geometry. A custom projection implementation requires an explicit
design amendment and evidence that native fitting plus bounded correction is
insufficient.

## Phase 0 — Fitting and Animation Feasibility Gate

**User-visible result:** none by design. This short spike prevents the rest of
the implementation from being built on an unreliable fitting assumption.

**Implementation result (2026-07-09):** use the installed RNMapbox camera's
native pitched bounds calculation, followed by native `getPointInView`
validation. Follow anchoring is expressed through native CameraOptions padding.
The adapter allows a 28 px initial rider-anchor tolerance and requires all
declared points to remain inside the measured safe viewport (which includes a
12 px clearance). No custom projection or native dependency patch is needed.
Continuous follow uses app-clocked zero-duration frames; a keyed overview owns
one native animation until it settles or is explicitly interrupted.

### Task 0.1: Prove the pitched fitting path on the native map

**Inspect or modify:**

- `apps/mobile/src/screens/BuildScreen.jsx`
- the existing ride-intro marker-slot framing helpers
- `@rnmapbox/maps` camera and map-view APIs
- a small local iOS bridge/config plugin only if the wrapper cannot expose the
  required native Mapbox camera calculation

**Prototype matrix:**

- straight corridor, L-turn, curved connector, and regional too-far geometry;
- pitches 0°, 35°, 40°, and 55°;
- small and tall supported iPhone viewports;
- collapsed and expanded navigation panels;
- portrait safe-area changes;
- both follow anchors and overview target slots.

**Steps:**

- [ ] Measure current `fitBounds` behavior with bearing, pitch, and asymmetric
  padding instead of assuming it is either sufficient or broken.
- [ ] Prototype the smallest native Mapbox calculation that can fit all
  required coordinates into a usable screen rectangle and, where needed,
  respect a rider/target slot.
- [ ] Project rider, maneuver, and corridor sample coordinates back to screen
  space using the map view’s coordinate-to-screen API.
- [ ] Allow at most one bounded correction pass for residual placement error;
  record when correction is required.
- [ ] Verify behavior while the bottom panel height changes.
- [ ] Check tile/horizon behavior at regional zoom and determine the pitch
  flattening threshold for `approach-too-far`.
- [ ] Record the selected production method and rejected alternatives in the
  implementation notes in this document before Phase 1 begins.

**Exit gate:**

- [ ] One maintainable fitting path has been selected: native full-coordinate
  fit, existing wrapper fit with native validation, or native fit plus one
  bounded screen-space correction.
- [ ] Pixel tolerances for rider anchor, panel occlusion, and maneuver/corridor
  visibility are defined for native acceptance tests.
- [ ] The pitch-degradation policy is proven for cases that cannot satisfy all
  constraints at 55°.
- [ ] No custom JavaScript Web Mercator perspective model is required unless
  this gate documents why all native options failed.

### Task 0.2: Choose and prove one animation owner

**Produce:**

- A small camera application state machine with explicit owner, transition ID,
  interruption, completion, and reset semantics.
- A documented decision for discrete overview transitions:
  - application-clocked immediate frames, or
  - native Mapbox animation while application frame writes are suspended.

**Steps:**

- [ ] Verify cancellation and completion behavior of the candidate Mapbox
  animation API on iOS.
- [ ] Prove that continuous follow/join/reacquisition frames do not write while
  a native-owned overview transition is active.
- [ ] Define interruption rules for off-route, free mode, scenario seek, user
  gesture, stage replacement, and component unmount.
- [ ] Use one monotonic clock for transition timing and CAM bookmark holds.
- [ ] Add fake-clock tests for acquire, replace, cancel, complete, and reset.

**Exit gate:**

- [ ] Every camera property has one owner at any instant.
- [ ] A transition can be deterministically observed as started, settled, or
  interrupted.
- [ ] The chosen mechanism can be driven identically at normal runtime and by
  the CAM playback clock.

## Phase 1 — High-Value Stabilization and Deterministic Parity

**User-visible result:** the rider is no longer hidden by the navigation UI,
arrival stays local, connector refresh no longer causes a pitch bounce, and a
credible scenario behaves the same in SIM, CAM, and headless execution.

### Task 1.1: Establish the camera application boundary

**Files:**

- Modify: `apps/mobile/src/screens/BuildScreen.jsx`
- Create: `apps/mobile/src/navigation/useNavigationCamera.js`
- Create: `apps/mobile/src/navigation/navigationCameraAdapter.js`
- Create: `packages/core/src/navigation/cameraViewportIntent.js`
- Create or modify focused tests under `tests/`

**Steps:**

- [ ] Extract navigation-camera refs, timing, interruption, and Mapbox writes
  from `BuildScreen` behind one adapter/hook boundary.
- [ ] Implement the Phase 0 animation-owner contract before moving behavior.
- [ ] Introduce the normalized intent fields needed by this phase: stage,
  viewport mode, geometry role, pitch, bearing policy, fit/focus role,
  transition, and anchor/padding policy.
- [ ] Keep a temporary compatibility mapper for current director output; mark
  it for removal in Phase 4.
- [ ] Centralize the initial tuning envelope.
- [ ] Emit an applied-frame diagnostic record from the adapter rather than
  inferring camera state from requested intent.

### Task 1.2: Apply measured insets and a real rider anchor

**Files:**

- Modify: `apps/mobile/src/screens/BuildScreen.jsx`
- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`
- Modify: `apps/mobile/src/navigation/navigationCameraAdapter.js`
- Reuse: existing panel/card measurement and safe-area values

**Steps:**

- [ ] Build one usable-viewport model from map bounds, safe areas, top UI,
  bottom panel height, and horizontal margins.
- [ ] Feed the current viewport explicitly to every navigation camera frame.
- [ ] Place the rider at 70–75% of usable viewport height in follow mode using
  the fitting method selected in Phase 0.
- [ ] Reframe only when measured layout changes materially; debounce layout
  noise and avoid feedback loops.
- [ ] Validate collapsed/expanded panels and small/tall phones on native iOS.
- [ ] Remove the near-maneuver `centerBias` proxy once the real anchor owns
  placement.

### Task 1.3: Fix resolving and arrival discontinuities

**Files:**

- Modify: `packages/core/src/navigation/cameraDirector.js`
- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify: corresponding core tests

**Steps:**

- [ ] Preserve the last accepted ownership tier, connector geometry, and camera
  intent while a connector request or refresh is pending.
- [ ] Make initial resolving hold a deliberate stable frame rather than a
  generic 20° `approach-start` fit.
- [ ] Prevent the `55° → 20° → 55°` refresh bounce.
- [ ] Split `arrived-local` from `ride-summary`.
- [ ] Make normal arrival a short local north-up frame around rider and route
  end; never automatically fit the whole route.
- [ ] Keep an explicit summary intent for an existing/future explicit action.
- [ ] Add regression tests for refresh, failed refresh, arrival on short and
  long routes, and stale camera state after exit.

### Task 1.4: Add fail-closed deterministic connector injection

**Files:**

- Modify: `packages/core/src/navigation/scenarioRunner.js`
- Modify: `packages/core/src/navigation/navigationSession.js` only through its
  connector dependency seam
- Modify: native dev-scenario setup in `BuildScreen.jsx` or extracted module
- Modify: scenario resolver/runner tests

**Matcher contract:**

Each recorded connector response identifies the semantic request with:

- journey and response ID;
- target mode and selected target identity/progress;
- origin and target geometry within declared coordinate tolerances;
- request purpose (`initial`, `retry`, or `refresh`);
- attempt/refresh ordinal as an assertion, not as the sole identity.

**Steps:**

- [ ] Replace broad connector mode strings with explicit response records.
- [ ] Install the same scenario connector adapter in native, CAM, SIM, and the
  headless runner.
- [ ] Fail immediately on no match, ambiguous match, duplicate consumption, or
  an unexpected request.
- [ ] Never fall through to the live connector/router while a scenario is
  active.
- [ ] Report unused expected responses at journey completion.
- [ ] Include request and candidate IDs in development errors without logging
  live precise coordinates in production.
- [ ] Add negative tests for changed request order, retry count, geometry,
  target, and missing response.

### Task 1.5: Prove one honest end-to-end journey

**Files:**

- Create the baseline in the shared camera journey fixture module.
- Modify scenario expectations and tests

**Steps:**

- [ ] Express the baseline as the minimal compatible subset of the shared
  journey schema planned for Phase 3 so this fixture is extended, not rewritten.
- [ ] Use plausible timestamp, distance, speed, and accuracy relationships.
- [ ] Use a route/connector pair that visibly demonstrates the claimed stage.
- [ ] Run the same fixture through the real session in SIM, CAM, native dev
  mode, and headless execution.
- [ ] Replace stale expectations that pin the old values such as 55° too-far or
  20° show-leg.
- [ ] Assert identical connector consumption, stage sequence, geometry
  authority, and terminal state across all runners.

**Phase 1 gate:**

- [ ] The four visible defects above are demonstrated fixed on native iOS.
- [ ] The baseline journey has exact state parity in every runner.
- [ ] Existing navigation tests remain green and the adapter has one writer.

## Phase 2 — Complete Viewport Camera and Spatial Continuity

**User-visible result:** pitch, zoom, fit, and bearing respond consistently to
the current geometry and viewport across all navigation cases, including
maneuvers and connector-to-route transitions.

### Task 2.1: Complete the declarative viewport contract

**Files:**

- Modify: `packages/core/src/navigation/cameraViewportIntent.js`
- Modify: `packages/core/src/navigation/cameraDirector.js`
- Modify: `tests/test-camera-director.mjs`
- Create: `tests/test-camera-viewport-intent.mjs`

**Steps:**

- [ ] Normalize stage, `follow | overview` mode, geometry role, required
  points/corridor, bearing policy, pitch target/range, zoom clamps, rider slot,
  transition kind, and reframe policy.
- [ ] Keep diagnostic stage names separate from viewport mode.
- [ ] Make maneuver entry/exit use distance and geometry thresholds with
  hysteresis, not cue type alone.
- [ ] Coalesce overlapping maneuver windows.
- [ ] Keep off-route immediate and recovery intentionally eased.
- [ ] Test every stage row in the design table, including transient and rapidly
  replacing states.

### Task 2.2: Build semantic corridor and zoom helpers

**Files:**

- Create: `packages/core/src/navigation/cameraViewport.js`
- Reuse: `packages/core/src/utils/geometry.js`
- Create: `tests/test-camera-viewport.mjs`

**Pure responsibilities:**

- speed-derived lookahead;
- route/connector corridor extraction around progress;
- maneuver corridor with post-decision geometry;
- required point roles and geometry identity;
- stage clamps and pitch-feasibility envelope;
- zoom target smoothing, dead band, and velocity limit;
- overview reframe and hysteresis decisions.

**Steps:**

- [ ] Move reusable ride-intro distance/slot math into the shared semantic
  layer where appropriate.
- [ ] Make viewport dimensions, insets, pitch, and bearing explicit inputs.
- [ ] Include 20–40 m behind the rider and speed-derived forward geometry.
- [ ] Include 60–120 m beyond the maneuver when available.
- [ ] Safely handle short, degenerate, reversed, and route-end geometry.
- [ ] Keep exact perspective projection out of this pure module unless Phase 0
  explicitly selected and justified that fallback.
- [ ] Test phone aspect ratios, sharp turns, hairpins, forks, long straights,
  route ends, and noisy progress.

### Task 2.3: Use the active corridor for heading

**Files:**

- Modify: `packages/core/src/navigation/cameraHeading.js`
- Modify: `tests/test-camera-heading.mjs`

**Steps:**

- [ ] Derive guide/ride bearing from a stable forward corridor tangent or
  aggregate, not a single dense segment.
- [ ] Give show-leg a stable connector-dominant direction.
- [ ] Keep too-far target-facing with regional pitch flattening.
- [ ] Blend the retained connector bearing into the main-route bearing at join.
- [ ] Keep off-route hold and terminal north-up behavior explicit.
- [ ] Preserve the existing persist/snap governor where it remains appropriate.
- [ ] Test wobble, hairpins, sharp decisions, join, recovery, and north-up reset.

### Task 2.4: Retain and apply seam transition state

**Files:**

- Modify: `packages/core/src/navigation/navigationSession.js`
- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify: session/presentation tests
- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`

**Steps:**

- [ ] Capture the accepted approach frame/geometry before ownership changes to
  main route.
- [ ] Expose a bounded transition snapshot with source/target geometry roles,
  progress, bearing, and transition identity.
- [ ] Blend center/anchor, pitch, zoom, and bearing without refitting a broad
  union of connector and route.
- [ ] Expire the snapshot on completion, interruption, reset, and new journey.
- [ ] Make line/marker authority change at the same semantic boundary as the
  camera, without hiding valid geometry prematurely.
- [ ] Add tests for guide join, show-leg join, too-far resolution, route change,
  connector refresh during join, and reset.

### Task 2.5: Apply every stage through one native adapter

**Files:**

- Modify: `apps/mobile/src/navigation/navigationCameraAdapter.js`
- Modify: `apps/mobile/src/navigation/useNavigationCamera.js`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Steps:**

- [ ] Apply guide and ride follow corridors with explicit rider slots.
- [ ] Apply maneuver corridors and lower pitch only when visibility requires it.
- [ ] Apply show-leg as a stable connector overview without chasing every fix.
- [ ] Apply too-far as target-facing overview, flattening as regional scale
  grows.
- [ ] Apply off-route hold, reacquisition, arrived-local, and explicit summary.
- [ ] Give free mode/user gestures ownership and resume only through an explicit
  reacquire transition.
- [ ] Refit overview only for material geometry/viewport changes or margin
  violations.
- [ ] Validate required points with coordinate-to-screen projection after
  transition settlement; correct only within the Phase 0 contract.

**Phase 2 gate:**

- [ ] Every design stage is reachable and uses the normalized intent path.
- [ ] No stage-specific Mapbox write remains in `BuildScreen`.
- [ ] Native acceptance confirms rider, maneuver, and connector visibility
  outside occluded regions on the supported viewport matrix.
- [ ] No competing animation or recurring overview refit is visible.

## Phase 3 — Shared Journeys, SIM/CAM, and Diagnostics

**User-visible result:** developers can replay believable full journeys in SIM
or inspect the same journeys at meaningful CAM bookmarks, with deterministic
state and camera diagnostics.

### Task 3.1: Define one shared journey schema

**Files:**

- Create: `packages/core/src/navigation/scenarios/journeySchema.js`
- Modify: scenario resolver/index modules
- Modify: scenario validation tests

**Journey contents:**

- route and connector geometry;
- physically plausible timestamped fixes and accuracy;
- deterministic semantic connector responses;
- expected session milestones;
- camera bookmarks with pre-roll, transition trigger, settle condition, hold,
  and human-readable purpose;
- optional negative expectations such as “must not fit the whole route.”

**Steps:**

- [ ] Validate monotonic time, plausible distance/speed, geometry proximity,
  response uniqueness, bookmark ordering, and referenced IDs.
- [ ] Reject underspecified connector fallbacks.
- [ ] Keep expected camera intent semantic; do not store device-specific zoom or
  center snapshots as golden truth.
- [ ] Version the schema so fixture changes are deliberate.

### Task 3.2: Curate the initial realistic journey set

**Files:**

- Create or replace fixtures under
  `packages/core/src/navigation/scenarios/`
- Remove the retired camera-only storyboard scaffolding after migration

**Required journeys:**

1. Guided connector into a route, including refresh and seam join.
2. Show-leg connector with real visible leg movement and join.
3. Too-far approach resolving into navigation at plausible cycling speed.
4. Main-route ride with maneuver, off-route excursion, reacquisition, and
   local arrival.

**Steps:**

- [ ] Derive routes from coherent recorded or deliberately constructed local
  geometry; do not pair unrelated impossible paths.
- [ ] Check fix-to-fix speed against declared speed and timestamp.
- [ ] Ensure every bookmark has enough pre-roll to establish its state.
- [ ] Ensure show-leg actually shows a connector leg and movement along it.
- [ ] Include deliberate connector retry/refresh only where the journey tests
  that behavior.
- [ ] Add fixture lint tests that fail on physical or semantic inconsistencies.

### Task 3.3: Use one controllable playback source

**Files:**

- Create or modify the scenario playback/location source in core/mobile
- Modify native dev-scenario selection in `BuildScreen.jsx` or extracted UI
- Modify playback and runner tests

**Steps:**

- [ ] Drive fixes, connector responses, and bookmark time from one monotonic
  journey clock.
- [ ] Support play, pause, seek with deterministic state rebuild, step, and
  restart.
- [ ] Let SIM run the full journey at supported speeds.
- [ ] Let CAM select the same journey and bookmark, run pre-roll at 1x, replay
  the transition, wait for settlement, then hold.
- [ ] Define whether a seek rebuilds from journey start or a serialized
  checkpoint; it must never mutate only the visible camera.
- [ ] Test pause/resume, seek, repeated bookmark replay, completion, and switch
  between journeys.

### Task 3.4: Add ordered headless expectations and native bookmarks

**Files:**

- Modify: `packages/core/src/navigation/scenarioRunner.js`
- Modify: `packages/core/src/navigation/scenarioExpectations.js`
- Modify corresponding scenario tests

**Steps:**

- [ ] Sample normalized camera intents and applied-frame lifecycle events on the
  journey clock.
- [ ] Assert ordered stages, geometry authority, transition start/settle,
  connector consumption, and negative events.
- [ ] Assert semantic requirements such as rider-anchor policy and required
  maneuver role, not projected pixels.
- [ ] At CAM bookmarks, validate exact screen placement on the native map after
  settlement.
- [ ] Make failures report the journey time, bookmark, expected event, actual
  event, and last stable intent.

### Task 3.5: Rebuild diagnostics around applied state

**Files:**

- Modify or extract the development camera overlay from `BuildScreen.jsx`
- Add dev-only diagnostics selectors/formatters and tests

**Display at a throttled 4–5 Hz:**

- journey/bookmark/time and session stage;
- viewport mode and geometry authority;
- requested versus applied pitch, zoom, bearing, and anchor;
- viewport insets and screen validation result;
- transition ID, owner, state, and interruption reason;
- connector response ID/match status;
- refit reason and fit/correction count.

**Steps:**

- [ ] Update diagnostics from refs without causing navigation-screen rerenders
  at camera-frame frequency.
- [ ] Keep precise coordinates out of normal logs and production bundles.
- [ ] Add a clear failed-fit or unmatched-connector state rather than silently
  continuing.

**Phase 3 gate:**

- [ ] All four journeys pass with identical semantic timelines in SIM, CAM,
  native scenario mode, and headless execution.
- [ ] CAM bookmarks visibly replay and settle transitions at 1x.
- [ ] The old contradictory camera micro-scenarios and expectations are gone.
- [ ] Diagnostics describe applied state without material performance impact.

## Phase 4 — Hardening, Release Gates, and Cleanup

**User-visible result:** the camera is production-ready, old paths are removed,
and future tuning can be done with reliable fixtures and observability.

### Task 4.1: Complete automated coverage

- [ ] Run focused camera, heading, navigation-session, presentation, scenario,
  and replay tests after every phase.
- [ ] Add pure tests for intent normalization, corridor selection, hysteresis,
  zoom smoothing, transition interruption, and reset.
- [ ] Add matcher mutation tests proving connector fixtures fail closed.
- [ ] Add regression tests for stage thrash, repeated fits, arrival zoom-out,
  stale seam state, scenario switching, and unmount/remount.
- [ ] Run the full repository test suite before release.

### Task 4.2: Run the native visual acceptance matrix

For every required journey/bookmark, inspect at minimum:

- a small and tall supported iPhone viewport;
- collapsed and expanded panels;
- 35–55° active pitch cases and flattened regional overview;
- maneuver before/at/after decision;
- connector refresh and seam join;
- off-route/recovery and local arrival.

**Acceptance checks:**

- [ ] Rider falls within the agreed anchor tolerance.
- [ ] Required maneuver/connector geometry is outside all occlusion rectangles.
- [ ] No broad regional zoom-out occurs at arrival.
- [ ] No camera jump occurs while resolving or refreshing.
- [ ] No owner conflict, fit loop, horizon-dominant shot, or visible tile shock
  occurs.
- [ ] Accessibility text sizes/panel growth trigger a calm, correct reframe.

### Task 4.3: Verify performance, release behavior, and privacy

- [ ] Confirm camera writes are bounded and diagnostics refresh at no more than
  their configured rate.
- [ ] Confirm overview fits do not repeat for stationary/noisy fixes.
- [ ] Profile the four journeys for JS/UI stalls and map tile churn.
- [ ] Verify scenario fixtures, CAM controls, and diagnostics are excluded from
  production behavior/bundles as intended.
- [ ] Verify no new precise-location logging or analytics were introduced.

### Task 4.4: Remove superseded code and close the migration

- [ ] Remove the compatibility mapper and old stage-specific Mapbox writes.
- [ ] Remove hardcoded fit padding, `centerBias`, stale camera constants, and
  obsolete RAF/native animation combinations.
- [ ] Remove retired CAM micro-fixtures only after shared journeys cover their
  useful state cases.
- [ ] Remove unused connector mode routing and any live fallback from scenario
  execution.
- [ ] Reconcile design defaults, implementation defaults, diagnostics labels,
  and test expectations.
- [ ] Record any deliberate tuning changes and native-fitting constraints in
  the design rather than hiding them in fixture assertions.

**Phase 4 gate / definition of done:**

- [ ] The product behaviors and stage table in the design are implemented.
- [ ] Phase 0 native fit and animation contracts still hold after cleanup.
- [ ] SIM, CAM, native scenario mode, and headless runner share journeys and
  deterministic connector results.
- [ ] Exact pixel acceptance passes natively; semantic headless tests pass.
- [ ] All focused and full-suite tests pass.
- [ ] No obsolete navigation-camera path or contradictory scenario remains.

## Suggested Commit Boundaries

Keep commits independently reviewable and do not combine fixture churn with
unrelated camera behavior:

1. Pitched-fit and animation-owner feasibility result.
2. Camera adapter boundary plus measured viewport/rider anchor.
3. Resolving/local-arrival fixes plus deterministic connector adapter.
4. Full intent, corridor, zoom, and heading behavior.
5. Seam state and complete native stage application.
6. Journey schema and realistic fixtures.
7. Shared playback, CAM bookmarks, and diagnostics.
8. Validation, performance hardening, and obsolete-code removal.
