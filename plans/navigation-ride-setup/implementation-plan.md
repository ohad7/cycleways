# Navigation Ride Setup and Approach UX — Implementation Plan

**Date:** 2026-07-01  
**Goal:** Add an explicit ride-setup step, preserve nearby approach suggestions,
promote external navigation for distant approaches, and support navigation-only
alternate starts and reverse traversal without mutating source routes.

**Implementation status (2026-07-01):** Core and native implementation complete.
Automated core tests, the full repository suite, 14 targeted Playwright cases,
the production web build, and Expo iOS export pass. The physical-iPhone matrix
in Task 16 remains pending and must be completed before declaring ride-level
acceptance.

Implemented modules include `ridePlan.js`, `effectiveNavigationRoute.js`, the
start-only acquisition gate, `RideSetupSheet`, one-shot setup location,
near/far handoff behavior, reverse/linear/loop derivation, pending-plan restore,
coarse telemetry, and the featured-route setup intent.

## Constraints

- Product and architecture decisions are defined in `design.md` in this
  directory.
- Keep `CONNECTOR_NEAR_RADIUS_M = 1000` as the single initial near/far policy
  constant.
- Turn-by-turn cues remain limited to the effective curated route. The approach
  connector is never narrated.
- Transformations must be pure and must not mutate `routeState`, catalog data,
  share tokens, or a previously built `NavigationRoute`.
- Core behavior is covered by standalone Node tests in the existing test suite.
- Native UI remains Hebrew/RTL and must be verified on an iPhone-sized target.
- Run Expo commands from `apps/mobile`, never the repository root.
- Preserve the mobile iOS project's existing manual signing configuration when
  regenerating native files.

## Delivery strategy

Deliver in four independently testable slices:

1. Setup and near/far UX using the published direction and official start.
2. Nearest/custom starts for linear and circular routes.
3. Reverse traversal.
4. Restore, observability, and full device acceptance.

Do not ship reverse as a geometry-only shortcut. If all progress-indexed route
data is not transformed and tested, keep the reverse control disabled until the
slice is complete.

## Task 1: Lock current behavior with characterization tests

Before restructuring, add tests that capture the existing contracts:

- `approachTargetChoices` returns official start, nearest projection, and skipped
  progress.
- A confirmed session outside the route enters `approaching` and suppresses
  route cues.
- At or below 1 km, connector suggestion state can be requested and rendered.
- Connector failure retains a direct target/distance fallback.
- Acquiring the main route is the only transition to normal route guidance.
- The featured WebView Navigate bridge supplies a route token to Build.

Run the targeted navigation tests and the featured-route shell Playwright test.
This establishes a baseline so moving target choice out of the active banner
does not regress the existing connector.

## Task 2: Add pure ride-plan types and policy helpers

Create a core module such as
`packages/core/src/navigation/ridePlan.js` containing plain-data contracts:

```js
{
  direction: "forward" | "reverse",
  startMode: "official" | "nearest" | "custom",
  startProgressMeters: number,
  selectedPoint: { lat, lng } | null
}
```

Add pure helpers for:

- location-fix quality (`fresh`, `stale`, `inaccurate`, `unavailable`);
- start/nearest candidates after the selected direction is applied;
- skipped and guided distance;
- meaningful-skip confirmation using `JOIN_SKIP_PROMPT_M`;
- approach classification (`at`, `near`, `far`, `unknown`) using the target
  distance and `CONNECTOR_NEAR_RADIUS_M`;
- setup copy/presentation values, kept separate from React Native rendering.

Tests must cover threshold boundaries, missing/invalid fixes, stale timestamps,
poor accuracy, reverse candidate coordinates, and meaningful versus trivial
skips.

## Task 3: Implement effective-route geometry primitives

Create a pure module such as
`packages/core/src/navigation/effectiveNavigationRoute.js`.

### Shared primitives

- Project a selected point onto a known segment and insert an interpolated
  geometry vertex (including elevation when both adjacent samples have it).
- Slice geometry at a continuous progress value.
- Rebuild `index` and `distanceFromStartMeters` with
  `buildNavigationGeometry`.
- Clip/remap segment spans to a new distance origin.
- Filter/remap `activeDataPoints[].routeProgressMeters`.
- Generate a derived route id containing a stable direction/start signature so
  the session is recreated whenever setup changes.

### Reverse transformation

- Reverse geometry and waypoints.
- Rebuild cumulative distances.
- Map each progress value to `totalMeters - oldProgress`.
- Reverse/remap segment spans:
  `newStart = total - oldEnd`, `newEnd = total - oldStart`.
- Swap start/end metadata and elevation gain/loss.
- Preserve non-directional route metadata.
- Regenerate cues from the resulting normal `NavigationRoute`; do not transform
  cached cues.

### Tests

- Input objects remain deeply equal to pre-call snapshots.
- Double reverse yields an equivalent route.
- Total distance is preserved within floating-point tolerance.
- A known left turn becomes the correct right turn when cues are rebuilt.
- POI order/progress, spans, start/end, and elevation totals are correct.
- Invalid geometry returns a non-navigable result with a stable reason.

## Task 4: Implement alternate starts

### Linear routes

- Split at selected progress and retain the suffix through the effective finish.
- Reset progress at the selected point.
- Clip spans and POIs before the new start; remap retained progress values.
- Compute skipped distance, guided distance, effective start, and finish.

### Circular routes

- Classify using catalog `routeShape.type === "circular"` first.
- Independently validate a safe geometry seam; never invent a long straight
  closure solely because metadata says circular.
- Add one conservative, documented endpoint closure tolerance for routes lacking
  metadata; keep uncertain or unsafe-seam routes linear.
- Split at selected progress, concatenate suffix + prefix, and avoid duplicating
  or introducing a straight jump at the seam.
- Preserve exactly one complete loop and rotate spans/POIs into the new order.
- Make the chosen point the effective start and finish.

### Tests

Use small deterministic routes to verify:

- linear midpoint selection shortens the route and drops prior cues/POIs;
- circular midpoint selection preserves total distance and all POIs once;
- selection at zero is equivalent to the official start;
- selection near a loop seam does not create a zero-length or cross-map leg;
- out-and-back/crossing projection selects the requested leg when segment
  context is supplied;
- alternate start composes correctly with reverse (direction first, start
  second).

## Task 5: Gate acquisition at the confirmed effective start

Extend the route-progress/session contract so the first acquisition cannot snap
to an arbitrary leg of the effective route:

- approach target is always `effectiveRoute.geometry[0]`;
- require the fix to enter the accuracy-aware start radius;
- restrict the first projection to a bounded progress window near zero;
- seed/latch progress at zero (or the small projected value within that window)
  before enabling the existing forward-window tracker;
- ensure the colocated end of a loop cannot win the initial projection;
- retain current global recovery behavior only after acquisition.

Tests must include a crossing route where the rider passes a later leg before
the selected start, an out-and-back with nearby parallel legs, and a closed loop
whose first and last coordinates coincide. None may acquire early or report
immediate arrival.

## Task 6: Add one-shot setup location acquisition

Extend the native location service with a bounded one-shot operation:

- request foreground permission;
- prefer a sufficiently fresh/accurate cached fix when available;
- otherwise request a current fix with a timeout;
- return a typed outcome rather than throwing UI-specific strings;
- never leave a watch active after setup acquisition.

Keep active-session `startNavigationWatch` unchanged. Add unit coverage around
the adapter boundaries where practical and a manual device check for permission
allowed, denied, and unavailable states.

## Task 7: Replace automatic start with setup intent

Change both native entry paths:

- Featured route: replace `autoStartNavigation` with an explicit parameter such
  as `openRideSetup` after the route token loads.
- Build panel: `התחל ניווט` opens setup rather than calling `nav.start()`.

In `BuildScreen`:

- keep the immutable source navigation route;
- hold draft ride-plan selection separately;
- derive a preview/effective route only after source route readiness;
- prevent setup from opening against a stale route token;
- remove the current pending auto-start effect after all callers migrate.

Update the embedded featured-route test to prove that Navigate opens the native
setup intent and does not immediately start an active GPS navigation session.

## Task 8: Build `RideSetupSheet`

Add a native bottom sheet/modal with:

- title `הכנת הרכיבה`;
- accessible forward/reverse direction control;
- official/nearest/custom start choices;
- location quality or distance status;
- skipped distance, guided distance, and finish summary;
- recommendation explanation;
- context-sensitive primary action;
- retry location and cancel actions.

Use selected-state accessibility properties and full text labels. Do not make a
map tap the only way to leave custom-point mode.

While setup is open, render:

- source route in a subdued style;
- effective-route preview prominently;
- official start, selected start, and finish markers with distinct accessible
  labels.

Custom selection enters a temporary map-pick mode, projects the tap onto the
source route, updates the preview and consequence summary, and returns to the
sheet. Reuse projection helpers; do not edit planner waypoints.

Native validation: iPhone SE-sized and current large iPhone layouts, RTL,
Dynamic Type at one larger setting, VoiceOver focus order, rotation disabled or
supported consistently with the rest of the app.

## Task 9: Start the correct next state

On setup confirmation:

- **At route:** pass the effective route to the session and start normal
  acquisition/navigation.
- **Near:** start the existing foreground watch, target effective progress zero,
  and retain the direct + dashed connector behavior.
- **Far/unknown:** keep the ride plan pending and open the existing installed-app
  chooser; do not start a continuous high-accuracy CycleWays watch.

Refactor the session boundary so `useNavigationSession` is recreated against
the effective route id, not the source route id. Guard against changing the
effective route while status is active.

Keep `computeConnector` non-mutating. Request it only for the current near
target and preserve the direct-line fallback on failure.

## Task 10: Clarify approach and acquisition UI

Update `NavPanel`/presentation for the near approach:

- heading `בדרך למסלול`;
- target line `דרך מוצעת לתחילת המסלול · <distance>`;
- support line `הניווט במסלול יתחיל כשתגיע`;
- actions `פתח באפליקציית ניווט` and `שנה הגדרות רכיבה`;
- dashed connector visually subordinate to the curated route;
- no route maneuver cue while approaching.

Replace the ambiguous `יעד` action with the ride-settings action. Destination
app detection and URL creation remain reusable from `DestinationSheet` or a
smaller app chooser component.

Add an acquisition transition presentation (`הגעת למסלול` /
`הניווט במסלול התחיל`) with one haptic and a short bounded display duration.
Ensure repeated GPS fixes cannot retrigger it.

Tests:

- presentation strings/modes for near, connector failure, acquisition, and
  off-route states;
- one-shot transition event;
- route cues remain absent before acquisition and appear afterward.

## Task 11: Far handoff and return

- Promote the external app chooser for `far` and `unknown` states.
- Build the destination from effective-route progress zero.
- Keep Apple Maps available and filter other apps using the current registry.
- Stop/avoid the CycleWays high-accuracy watch before external handoff.
- On app foreground, obtain a fresh one-shot fix and reclassify the approach.
- If now near, offer/start the near approach; if at route, start route guidance;
  otherwise keep the far summary.
- Handle `Linking.openURL` rejection with an actionable fallback rather than
  dismissing setup silently.

Device-check Apple Maps and every installed third-party app available on the
test phone. Confirm the destination coordinate matches the effective start for
forward, reverse, and alternate-start plans.

## Task 12: Persist a pending ride plan safely

Persist only the minimum needed to resume an external handoff:

- source slug or route token reference;
- source route identity/version signature;
- direction;
- start mode and selected progress/coordinate;
- timestamp.

On restore, reload the source route, validate identity and projection, rebuild
the effective route, and then obtain a fresh location. Expire old entries and
discard any plan that cannot be validated. Never persist live GPS history.

Tests cover valid restore, expiration, changed source identity, corrupt data,
and custom-point reprojection.

## Task 13: Reverse eligibility and metadata

- Define an optional catalog flag/reason for direction-sensitive routes.
- Hide or disable reverse with explanatory copy when prohibited.
- For existing routes without the flag, allow reverse only after the effective
  route transformation validates.
- Ensure featured-route snapshots/bundled catalog transport preserve the flag.
- Add catalog parsing tests and at least one fixture for each eligible/ineligible
  case.

Content review remains required before asserting that every published route is
equally suitable in reverse.

## Task 14: Observability

Add coarse events described in the design without coordinates or full route
tokens. At minimum capture setup outcome, chosen direction/start mode, approach
tier, connector result, external app, acquisition, and restore/discard result.

If no production analytics sink is enabled in the native app, define a narrow
adapter and keep it a no-op in production rather than coupling navigation core
to a vendor.

## Task 15: Automated validation gates

Run and record:

1. Core navigation, progress, connector, presentation, route-transform, and
   persistence tests.
2. Full repository test suite.
3. Targeted featured-route Playwright tests proving the bridge opens setup.
4. Web build, ensuring shared-core changes do not regress the public app.
5. Expo iOS export from `apps/mobile`.
6. `git diff --check` and a review that generated timestamp-only changes are not
   included.

Add regression assertions that the source route and share token are unchanged
after every ride-plan transformation.

## Task 16: Device acceptance matrix

Test at least one linear and one circular featured route on a physical iPhone:

| Scenario | Expected result |
| --- | --- |
| At official start, forward | Setup confirms quickly; route guidance starts |
| 200–900 m from start | Direct + dashed suggestion; no connector cues |
| More than 1 km away | External app promoted; no lingering CycleWays watch |
| Connector unavailable | Direct line/distance remain; external fallback works |
| Linear nearest join | Skip and guided distance match; earlier POIs omitted |
| Circular custom start | Full loop distance and all POIs preserved once |
| Reverse | Start/end, elevation, turns, POIs, and context are correct |
| Poor GPS | No automatic nearest recommendation |
| Permission denied | Manual setup/retry/cancel remain usable |
| Return from external app | Fresh location reclassifies far/near/at correctly |
| Leave route after acquisition | Existing off-route rejoin behavior remains |
| Change settings during approach | Watch stops; setup reopens safely |

Record discrepancies in an acceptance note under this plan topic before
declaring the work complete. Threshold changes must be justified by observed
behavior and reflected in both design and tests.

## Completion criteria

- All acceptance criteria in `design.md` pass.
- No entry path automatically starts active navigation before ride setup.
- Near connector behavior is preserved and clearly labelled as a suggestion.
- Far handoff does not maintain unnecessary high-accuracy tracking.
- Linear, circular, reverse, and composed transformations are covered by pure
  tests and physical-device scenarios.
- Source routes remain immutable.
- Plans, tests, and user-visible Hebrew copy agree on the final behavior.
