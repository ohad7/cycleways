# iOS Turn-by-Turn Navigation Review — Implementation Plan

**Date:** 2026-07-03
**Status:** ready for implementation
**Companion design:** `plans/turn-by-turn-navigation-review/design.md`

## Objective

Turn the review findings into a safe implementation sequence. The first slices
favor pure `@cycleways/core` changes with deterministic node tests; native UX
and device-sensitive work follows after the core behavior is pinned.

## Guardrails

- Keep turn-by-turn authority limited to vetted CycleWays route geometry.
  Connector routes remain non-narrated suggestions and never seed main-route
  progress.
- Preserve stale connector geometry while a replacement request is in flight,
  so the dashed suggestion does not blink during recompute.
- Keep telemetry privacy-safe: emit coarse enums, counts, durations, and
  distance buckets only. Do not log coordinates, route tokens, or full route
  names.
- Do not start junction-vs-bend implementation until the route metadata
  contract is designed and accepted.

## Task 1 — Connector Retry, Distance, And Telemetry

**Findings:** F1, F9
**Target files:** `packages/core/src/navigation/navigationSession.js`,
`packages/core/src/navigation/navigationPresentation.js`,
`apps/mobile/src/navigation/useNavigationSession.js`,
`apps/mobile/src/screens/BuildScreen.jsx`,
`tests/test-navigation-session.mjs`,
`tests/test-navigation-presentation.mjs`,
`tests/test-navigation-replay.mjs`

Implementation steps:

1. Add explicit connector request eligibility separate from
   `suggestionStatus === "idle"`.
   - `idle`: first request as today.
   - `failed`: retry only after the existing `REQUEST_MIN_MOVE_M` movement gate.
   - `ready` + `off-route`/rejoin: recompute after the same movement gate, while
     keeping existing geometry visible until the replacement is ready.
   - `ready` + initial approach: keep current behavior unless the user retargets
     or a later design asks for periodic recompute.
2. Preserve old `suggestionGeometry` while status becomes `requesting` for a
   refresh. Clear geometry only on a failed response when there is no previous
   usable suggestion.
3. Store connector route distance from `CONNECTOR_READY` on the approach state
   as a separate field, for example `suggestionDistanceMeters`.
4. In presentation, use connector distance when `suggestionStatus === "ready"`
   and `suggestionDistanceMeters` is finite; otherwise keep beeline distance.
5. Add telemetry fields around request execution:
   - request result: `ready` / `failed`
   - failure reason enum
   - retry ordinal or `isRetry`
   - latency bucket or rounded milliseconds
   - distance source: `connector` / `beeline`
   - no coordinates or route identifiers

Test expectations:

- `CONNECTOR_FAILED`, then movement below 200 m: no new request.
- `CONNECTOR_FAILED`, then movement at/above 200 m: new request id issued.
- Off-route `ready` rejoin target, then movement at/above 200 m: new request id
  issued and old geometry remains visible while requesting.
- Stale connector responses still cannot overwrite the latest request.
- `CONNECTOR_READY` with `distanceMeters` makes presentation display connector
  distance instead of straight-line distance.
- Replay fixture covers transient failure followed by retry success.

Validation:

```bash
node --test tests/test-navigation-session.mjs
node --test tests/test-navigation-presentation.mjs
node --test tests/test-navigation-replay.mjs
node --test tests/test-compute-connector.mjs
```

## Task 2 — Core And Presentation Polish

**Findings:** F4, F5, F10
**Target files:** `packages/core/src/navigation/navigationCues.js`,
`packages/core/src/navigation/navigationPresentation.js`,
`apps/mobile/src/planner/NavPanel.jsx`,
`apps/mobile/src/navigation/useNavigationSession.js`,
`apps/mobile/src/planner/DestinationSheet.jsx`,
`tests/test-navigation-cues.mjs`,
`tests/test-navigation-presentation.mjs`,
`tests/test-navigation-session.mjs`

Implementation steps:

1. Update `selectActiveCue` so maneuver cues outrank informational cues inside
   the preview window.
   - Priority: `turn` / `arrive` first, then hazards/POIs, then
     `enter-segment`.
   - If no maneuver is within the preview window, keep selecting the nearest
     useful informational cue.
2. Make stopped-without-heading arrow behavior honest.
   - `relativeArrowDeg` should return `null` when both course and compass are
     unavailable.
   - `NavPanel` should hide the arrow icon when no finite arrow angle exists,
     leaving destination label and distance visible.
3. Clean up the dormant mid-approach retargeting surface.
   - Preferred path: remove production exposure of `setApproachTarget` /
     `setApproachCustomTarget` from `useNavigationSession`, delete or narrow
     session tests that exist only for the old destination-picker flow, and keep
     custom start selection exclusively in `RideSetupSheet`.
   - If product wants mid-approach retargeting back, stop this task and write a
     small UX design first; do not silently preserve mismatched copy.
4. Remove or quarantine unused non-app target options in `DestinationSheet` if
   they are no longer reachable from production UI.

Test expectations:

- Hazard 50 m ahead and turn 70 m ahead selects the turn, not the hazard.
- Hazard-only case still selects the hazard.
- Stationary approach with no course/compass yields no arrow angle and no
  rendered arrow.
- If retarget actions are removed, tests prove the ride-setup custom start path
  still produces the intended effective route.

Validation:

```bash
node --test tests/test-navigation-cues.mjs
node --test tests/test-navigation-presentation.mjs
node --test tests/test-navigation-session.mjs
node --test tests/test-ride-plan.mjs
```

## Task 3 — Native Lifecycle Polish

**Findings:** F6, F8, F12
**Target files:** `apps/mobile/src/navigation/useNavigationSession.js`,
`apps/mobile/src/screens/BuildScreen.jsx`,
`apps/mobile/src/planner/NavPanel.jsx`

Implementation steps:

1. Make the acquired banner visible for 3-5 seconds in the native layer.
   - Keep `navigationSession.js` pure and one-fix/event-oriented.
   - Add native state such as `showAcquiredBannerUntil` or a timer in
     `BuildScreen`/`NavPanel`.
   - Clear on stop, route change, or entering error state.
2. Stop the high-accuracy location watch on pause and restart it on resume.
   - `pause()` should dispatch `PAUSE` and tear down the watch.
   - `resume()` should restore session status and begin a fresh watch.
   - Guard against duplicate watches and the async start/stop race already
     handled by `watchActiveRef`.
3. Device-check the external handoff return heuristic.
   - Track whether the app actually opened an external navigation URL before
     treating a background/active cycle as handoff return.
   - Add a minimum elapsed time or significant-location-change guard if a quick
     message-check reopens ride setup.

Test expectations:

- Hook-level tests are optional if no harness exists; use injected location
  source if adding one is straightforward.
- Manual simulator/device checks are required:
  - pause stops location callbacks;
  - resume restarts callbacks;
  - acquired banner remains visible long enough to read;
  - quick background/active without external navigation does not nag.

Validation:

```bash
node --test tests/test-navigation-session.mjs
node --test tests/test-navigation-presentation.mjs
```

Manual validation:

- Start near a route and acquire it; confirm banner duration.
- Pause for at least 20 seconds; confirm location callbacks stop and resume
  cleanly.
- Far approach -> open external app -> return; confirm ride setup behavior.
- Far approach -> background app briefly without opening external app; confirm
  ride setup does not reopen unnecessarily.

## Task 4 — Conservative At-Route One-Tap Start

**Findings:** F2
**Target files:** `apps/mobile/src/screens/BuildScreen.jsx`,
`apps/mobile/src/planner/RideSetupSheet.jsx`,
`packages/core/src/navigation/ridePlan.js`,
`tests/test-ride-plan.mjs`

Implementation steps:

1. Define a pure eligibility helper, for example `canFastStartRidePlan(plan,
   selection)`.
2. Eligibility should require:
   - `plan.effectiveRoute.canNavigate === true`
   - `plan.locationQuality === "fresh"`
   - `plan.approachTier === "at"`
   - current/default selection is unambiguous
   - no explicit custom point is being picked
   - no pending restored external-handoff intent requiring confirmation
3. On the main "start navigation" action, if a fresh at-route plan qualifies,
   confirm and start navigation directly instead of presenting the full setup
   sheet.
4. Keep the full setup sheet available from "change settings" before or during
   navigation for direction, reverse, nearest/custom start, and stale/unknown
   location cases.
5. Track telemetry for `ride_setup_fast_started` with direction/start-mode
   enums only.

Test expectations:

- Fresh at-route official/default plan fast-starts.
- Stale, inaccurate, unknown, near, far, custom, and reverse-selected cases do
  not fast-start and still show setup.
- One-way routes keep existing reverse-disallowed behavior.

Validation:

```bash
node --test tests/test-ride-plan.mjs
node --test tests/test-navigation-session.mjs
```

Manual validation:

- At trailhead: one tap starts navigation.
- At trailhead with "change settings": full sheet still allows reverse/custom
  where valid.
- 50-100 m away: full setup/approach behavior remains unchanged.

## Task 5 — Junction Cue Data-Contract Design

**Findings:** F3
**Target:** new follow-up design under `plans/`, before implementation

Design steps:

1. Create a dedicated design topic, for example
   `plans/junction-cue-classification/`.
2. Define maneuver metadata produced from base-route traversals before cues are
   built. Candidate fields:
   - `progressMeters`
   - graph `nodeId`
   - `degree`
   - incoming/outgoing edge ids
   - incoming/outgoing bearings
   - competing branch bearings
   - before/after `cwSegmentId` and route class
   - decision confidence / suppression reason
3. Specify propagation through:
   - `route-manager.js` route info
   - `routeActions.js` snapshots
   - `routeReducer.js`
   - `navigationRoute.js`
   - `effectiveNavigationRoute.js` reverse, truncate, and loop rotation
4. Define how catalog/restored/shared routes get the same metadata or safely
   degrade.
5. Define fixture strategy for switchbacks, true junctions, out-and-back
   overlaps, and gradual forks.

Acceptance:

- No cue-generation code changes happen until this design is accepted.
- The design identifies whether metadata is precomputed into route snapshots or
  derived at navigation-route build time.

## Task 6 — Junction-Vs-Bend Cue Implementation

**Depends on:** Task 5
**Findings:** F3

Implementation steps:

1. Emit and propagate accepted maneuver metadata.
2. Update `buildRouteCues` to prefer decision-point maneuvers over raw geometry
   bends.
3. Keep conservative fallback geometry-bend cues only where metadata is absent.
4. Add suppression reasons for bends that are not decisions, so future debugging
   can explain why a cue did or did not appear.
5. Develop against route-manager fixtures and replay fixtures rather than visual
   inspection alone.

Test expectations:

- Curvy non-junction trail does not emit repeated turn cues.
- True junction with meaningful branch emits a maneuver cue.
- Gradual fork split across small geometry deltas still emits a maneuver cue.
- Reverse and effective-route custom starts preserve cue positions.
- Loop rotation preserves cue order and wrap-around behavior.

Validation:

```bash
node --test tests/test-navigation-cues.mjs
node --test tests/test-navigation-route.mjs
node --test tests/test-effective-navigation-route.mjs
node --test tests/test-navigation-replay.mjs
```

## Task 7 — Out-And-Back Progress Jump Fixture And Fix

**Findings:** F7
**Target files:** `packages/core/src/navigation/routeProgress.js`,
`packages/core/src/navigation/replayRunner.js`,
`packages/core/src/navigation/trackGenerator.js`,
`tests/test-route-progress.mjs`,
`tests/test-navigation-replay.mjs`

Implementation steps:

1. First add a failing fixture for the described global-search jump.
2. Confirm the jump is display-only and does not corrupt
   `lastConfirmedProgressMeters`.
3. Choose the smallest fix:
   - clamp global fallback to a widened window while already acquired/off-route,
     or
   - do not commit `lastProgressMeters` from global fallback while off-route,
     or
   - require recovery/on-route confidence before accepting a distant branch jump.
4. Keep acquisition behavior unchanged for the first route match.

Test expectations:

- Out-and-back off-route drift cannot jump displayed progress to the wrong leg.
- Initial acquisition from far/near route still works.
- Recovery from genuine off-route shortcut still works when the rider returns to
  the intended route.

Validation:

```bash
node --test tests/test-route-progress.mjs
node --test tests/test-navigation-replay.mjs
```

## Deferred Tasks

### Voice cues

Do not start TTS until maneuver cue trust improves. When ready, design it as a
separate topic using the existing cue-event interface and haptic cooldown model.

### `BuildScreen.jsx` extraction

Extract `useRideSetup`, `useSmoothedRiderPuck`, and `useExternalHandoff` only
after behavioral fixes land. Keep the extraction behavior-preserving and verify
with the focused navigation tests plus simulator smoke.

## Final Validation Sweep

After Tasks 1-4 land, run the focused suite:

```bash
node --test tests/test-navigation-session.mjs
node --test tests/test-navigation-presentation.mjs
node --test tests/test-navigation-cues.mjs
node --test tests/test-route-progress.mjs
node --test tests/test-navigation-replay.mjs
node --test tests/test-ride-plan.mjs
node --test tests/test-compute-connector.mjs
```

Before release, run the mobile smoke path on simulator/device:

- start navigation at route start;
- start navigation near route but not at it;
- far approach with external handoff and return;
- off-route rejoin suggestion after transient connector failure;
- pause/resume during active navigation;
- wrong-way and stopped-without-compass cases.
