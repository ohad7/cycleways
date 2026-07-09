# Navigation Camera and Scenario Harness — Design

**Date:** 2026-07-09
**Status:** Accepted for implementation
**Topic dir:** `plans/navigation-camera-storyboard/`
**Builds on:** `plans/nav-ui-redesign/`, `plans/navigation-intro-rethink/`,
`plans/approach-ownership/`, and `plans/nav-scenario-harness/`

## Problem

The navigation camera is no longer a five-stage collection of pitch and zoom
presets. It must frame different route authorities, decision points, UI
overlays, recovery states, and transitions:

- Before navigation, the rider needs to understand where the selected start is.
- A `too-far` approach is regional context and external handoff, not guidance.
- A `show-leg` approach displays a connector but does not promise narration.
- A `guide` approach is an active turn-by-turn leg.
- At the seam, the connector must hand off visibly and calmly to the main route.
- During the ride, the camera must show an appropriate amount of the route ahead
  without hiding the rider behind the navigation UI.
- Near a maneuver, the junction and enough geometry after it must be readable.
- Off-route, the camera must provide a stable spatial reference and a useful
  rejoin view.
- Arrival and post-navigation reset require intentional, different views.

The current camera contract describes only `{ stage, mode, pitch, zoom,
centerBias, focusKind, fitKind }`. That is not enough to guarantee a useful
viewport. It does not explicitly describe the usable screen area, rider screen
anchor, active geometry, route corridor, lookahead, refit hysteresis, or
transition behavior.

The current visual harness also does not establish trustworthy camera behavior:

- SIM and the headless runner share location fixtures, but the app does not
  inject the scenario connector response. A visual scenario can therefore
  classify differently from its headless version.
- CAM contains short state-triggering fix arrays rather than believable moving
  journeys. Several fixtures contain impossible speed and geometry.
- CAM duplicates a subset of SIM instead of giving a camera-focused view into
  the same end-to-end journeys.
- The current entries do not cover the complete camera lifecycle.

## Goals

1. Define a first-class camera viewport contract that includes framing, not
   only pitch and zoom constants.
2. Keep a small number of understandable viewport modes while allowing
   stage-specific intent and parameters.
3. Make approach guidance, seam transition, main-route guidance, recovery,
   arrival, and reset spatially coherent.
4. Use one deterministic journey fixture for both the headless runner and the
   native visual runner, including connector responses.
5. Make SIM and CAM complementary views of the same journeys:
   - SIM plays the complete product journey.
   - CAM inspects and replays camera bookmarks within that journey.
6. Keep production camera policy in pure core modules where practical, with
   native code limited to resolving geometry, screen insets, and Mapbox calls.

## Non-goals

- No production camera controls beyond the existing pan/free and recenter
  behavior.
- No separate fake map renderer. Visual review must use the real native map,
  navigation panels, route layers, session, and camera application path.
- No connector + main-route geometry with negative progress. The connector
  remains a separate approach leg for navigation tracking.
- No editor changes. Curating scenario geometry may use existing route snapshots
  or recorded fixtures without adding a scenario editor.
- No claim that one fixed pitch or zoom is correct for every device, speed,
  route, and stage. The design defines a coherent policy and initial tuning
  bounds; CAM is used to tune them.

## Product Decisions

### 1. Separate viewport mode from camera stage

There are three user-visible viewport modes:

- **Follow:** the camera continuously frames the rider and an active route
  corridor.
- **Overview:** the camera frames a set of spatial facts and changes only when
  those facts materially change.
- **Free:** the user has panned, zoomed, or rotated the map. Automatic camera
  application stops until recenter.

Camera **stage** explains why a particular follow or overview intent was chosen,
for example `ride`, `pre-turn`, `approach-show-leg`, or `off-route`. Stages are
diagnostic and policy inputs; they are not independent camera implementations.

`cameraIntent === "free"` overrides the derived stage for application purposes.
The underlying stage may continue to update for UI and diagnostics, but no
automatic camera move is applied until recenter.

### 2. Use one universal framing engine, not one universal shot

Pitch, zoom, and fit are interdependent. The camera should use common framing
primitives and visibility guarantees across all stages, but each stage supplies
different geometry and tuning parameters.

The universal parts are:

- usable viewport rectangle after safe-area and navigation-panel insets;
- geometry-to-screen fitting;
- rider anchor convention;
- route-corridor sampling;
- bearing governor;
- animation and transition system;
- refit and update hysteresis;
- minimum visibility guarantees.

The stage-specific parts are:

- active geometry and focus points;
- follow versus overview;
- pitch target and allowed range;
- lookahead/behind distances;
- zoom clamps;
- bearing policy;
- transition policy.

This produces visual consistency without forcing a regional overview, a normal
ride, and a turn junction into the same pitch or zoom.

### 3. Use high pitch as the active-guidance style, not as a universal value

CycleWays uses a high, forward-looking camera for active riding. The initial
cruise target remains 55 degrees for guided approach and main-route riding.

Lower pitch is intentional when the rider needs plan readability rather than a
forward horizon:

- maneuver geometry must be readable;
- an overview must preserve scale and lateral relationships;
- rejoin context must remain stable;
- arrived/reset views are map-oriented rather than guidance-oriented.

### 4. Keep the rider low in the usable viewport during guidance

Follow mode must not place the rider at the geographic center by default. After
subtracting top and bottom UI insets, the rider should appear at approximately
70–75% of the usable viewport height, leaving most of the map for route ahead.

The exact anchor is a parameter of the viewport solver and may vary slightly by
stage, but it must be explicit and tested. Follow calls must explicitly apply
padding/anchor state rather than inherit padding from a previous fit operation.

### 5. Preserve spatial continuity across transitions

The camera should not expose short-lived internal states such as connector
classification requests. While ownership is `unknown` or a refresh is pending,
the current accepted camera intent is held.

The connector-to-main-route seam is a real transition with retained state:

- preserve the final connector tail long enough to render the handoff;
- preserve the last governed approach bearing;
- frame the seam and first main-route segment;
- blend bearing, pitch, zoom, route authority, and line styling into the main
  route over a bounded transition;
- only then clear the connector transition snapshot.

### 6. Arrival is local first, summary second

Reaching the destination should not immediately zoom from local guidance to an
entire long route.

- `arrival`: continue following toward the destination with a lower-pitch
  destination-focused frame.
- `arrived-local`: show rider + destination in a local north-up overhead view.
- `ride-summary`: fit the entire traveled route only after an explicit user
  action or a deliberate delayed summary transition.
- `planner-reset`: return to normal planner north-up overhead behavior.

## Camera Viewport Contract

The pure camera director should return a declarative viewport intent similar to:

```js
{
  stage,
  viewportMode: "follow" | "overview",
  geometryRole: "direct" | "approach" | "main" | "rejoin" | "arrival" | "summary",
  bearingPolicy: "target" | "route" | "hold" | "north-up",
  pitch: { target, min, max },
  zoomPolicy: {
    kind: "corridor-fit" | "points-fit" | "local" | "summary",
    minZoom,
    maxZoom,
  },
  riderAnchorY,
  lookaheadMeters,
  behindMeters,
  focusKind,
  fitKind,
  transition,
}
```

This is illustrative rather than a required literal API. The important change
is that core describes the spatial intent and native code applies it using real
screen dimensions, UI insets, and Mapbox camera operations.

### Usable viewport and padding

Every automatic camera operation receives explicit viewport insets:

- top safe area plus any top overlay;
- left/right safe area and map-control clearance;
- measured navigation/approach/arrival panel height plus marker clearance;
- additional CAM overlay clearance only in the dev harness if the overlay would
  otherwise obscure a required point.

Changing panel height or device orientation invalidates the current viewport
solution and causes one intentional reframe.

### Follow corridor

Follow mode frames a route corridor rather than a single rider coordinate.

The corridor contains:

- a small distance behind the rider so recent geometry and lateral motion remain
  understandable;
- the rider at the explicit screen anchor;
- a speed-dependent lookahead along the active geometry;
- the active maneuver and a short portion after it when a maneuver is near.

Initial tuning:

- behind distance: 20–40 m;
- cruise lookahead: `clamp(120, 400, 100 + speedMps * 30)` metres;
- approach to maneuver: always include the maneuver plus 60–120 m after it;
- follow zoom clamps: approximately 15.6–17.0 on a phone, subject to corridor
  visibility and measured viewport size.

The formula is a starting point for CAM review, not a hard product invariant.
The invariant is that a faster rider sees farther ahead and that zoom is derived
from visible geometry rather than speed alone.

The corridor solver produces a target zoom on every meaningful navigation
update, but the applied zoom is calm:

- ignore small target changes inside an initial 0.1–0.2 zoom-level dead band;
- ease accepted changes over approximately 1–2 seconds;
- limit normal zoom velocity to approximately 0.5–0.8 zoom levels per second;
- bypass the dead band only when a required point is leaving the safe viewport
  or an immediate safety/terminal stage requires a new frame.

A maneuver does not inherently mean “zoom in.” The solver includes rider,
junction, and post-maneuver geometry, then chooses the closest zoom that keeps
that corridor readable. A compact junction may zoom in; a broad turn, fork, or
closely spaced sequence may need to zoom out.

### Overview fit

Overview mode uses the same geometry-to-screen solver with stage-specific
points and geometry:

- fit results are calculated inside the usable viewport, not the full screen;
- heading and pitch participate in the fit calculation;
- overview does not restart on every one-second GPS fix;
- refit occurs only when geometry/target changes materially, the rider crosses a
  viewport margin, the rider moves a meaningful distance, or the panel/device
  viewport changes;
- hysteresis prevents repeated fit animations near a boundary.

Generic pitched bounds fitting is acceptable only if it meets screen-space
visibility assertions. Marker-slot or corridor-specific fitting is used when
generic bounds produce unstable or misleading centers.

### Bearing

- Device compass controls the puck and directional UI, not the route-following
  camera.
- Guided approach and main ride use the tangent/bearing of the active route
  corridor, governed against small changes.
- The route corridor, not just the next raw geometry segment, may influence the
  bearing so dense vertices do not cause needless rotation.
- `show-leg` uses the dominant/initial connector direction chosen by the
  viewport solver, not a continuously changing rider-to-target beeline.
- `too-far` uses rider-to-selected-start orientation when target-facing.
- Off-route holds the last accepted bearing.
- Arrived/reset views are north-up.

## Stage-by-Stage Behavior

| Stage | Mode | Geometry / framing | Initial pitch | Zoom / fit policy | Bearing |
|---|---|---|---:|---|---|
| `intro-start-facing` | overview | rider bottom slot + selected start top slot | 55 | marker-slot fit, distance-derived zoom | rider → start |
| `intro-overhead` | overview | selected start + useful local route context | 0 | local/points fit | north-up |
| `approach-resolving` | retain accepted mode | retain the accepted intro/approach frame | unchanged | no reframe for request state | unchanged |
| `approach-too-far` | overview | rider + start + direct line; no connector | 40 initial | marker-slot/points fit with distance-derived zoom | rider → start |
| `approach-show-leg` | overview | full or mostly-full connector + rider + start + short main-route context | 35 initial | corridor/geometry fit; stable between material changes | dominant connector direction |
| `approach-guide` | follow | rider low + guided connector corridor ahead | 55 | active corridor fit, approx. 15.6–17.0 | approach route-up |
| `approach-guide-pre-turn` | follow | rider + connector junction + geometry after turn | 35–40 | maneuver corridor fit, approx. 16.2–17.2 | approach route-up |
| `join-route` | follow | connector tail + seam + first main-route corridor | 40–45 → 55 | seam corridor, then blend into cruise | approach bearing → main bearing |
| `ride` | follow | rider low + speed-dependent main-route corridor | 55 | active corridor fit, approx. 15.6–17.0 | main route-up |
| `pre-turn` | follow | rider + junction + geometry after turn | 35–40 | maneuver corridor fit, approx. 16.2–17.2 | main route-up |
| `off-route` | overview | rider + rejoin target + suggestion when available | 20 | stable rejoin fit with hysteresis | held |
| `arrival` | follow | rider + destination + final route corridor | 30–35 | destination corridor/local fit | main route-up |
| `arrived-local` | overview | rider + destination/flag | 0 | local fit, not whole route | north-up |
| `ride-summary` | overview | full traveled/main route | 0 | whole-route fit | north-up |
| `planner-reset` | overview | normal planner route/map | 0 | planner policy | north-up |

Pitch and zoom values in this table are accepted implementation starting points.
Visibility, continuity, and stage meaning are requirements; the centralized
numeric values remain tunable through CAM review.

## Detailed Stage Semantics

### Intro and approach resolving

The intro camera already has the right conceptual language: it assigns explicit
screen slots to rider and selected start. Active navigation should not discard
that frame merely because the first connector request is pending.

When the rider confirms:

1. Keep the intro frame while permission and connector ownership resolve.
2. If the main route is immediately acquired, transition once into `ride`.
3. If classified `guide`, transition once into guided approach follow.
4. If classified `show-leg`, transition once into connector overview.
5. If classified `too-far`, retain/reframe the rider-to-start overview without
   suggesting that in-app turn-by-turn guidance is active.

Connector refreshes should keep the last accepted tier/camera while a new result
is pending. A request state must not flip the camera back to a generic approach
stage.

### Guided approach and ride

`guide` makes the connector the active camera geometry. Main-route progress must
not drive connector heading, lookahead, or maneuver focus before the seam.

The main route remains visible as upcoming context but is visually secondary.
After the seam, the main route becomes active and the connector becomes a short
transition tail before clearing.

### Show-leg

`show-leg` is not a static screenshot and not narrated guidance. It is a stable
overview that lets the rider understand the offered connector while their live
position advances.

The camera should retain most of the leg, refitting only when needed. The route
line and live puck may move without restarting a full bounds animation every
fix. No connector cue voice or cue-focused camera transition is permitted.

### Maneuvers

Maneuver behavior is driven by distance and geometry, not merely by the
existence of a `turn`/`bend` cue. The camera should:

- enter maneuver framing only when the decision is near enough to matter;
- include a useful portion of the geometry after the maneuver;
- avoid toggling if cue phases or adjacent cues change briefly;
- exit after the maneuver has been passed by a clear distance;
- coalesce closely spaced decisions into one readable corridor where possible.

### Off-route and recovery

Off-route is an immediate safety transition. The camera holds its accepted
bearing and frames rider, rejoin target, and suggestion. The puck continues to
show live device/course direction.

The overview is recomputed only when the rejoin target or suggestion changes
materially, the rider approaches the viewport edge, or a minimum movement
threshold is crossed. Reacquisition blends back to main-route follow; it does
not snap bearing and zoom on the same frame.

### Arrival

Arrival uses a two-step visual sequence:

1. Lower-pitch follow toward the destination.
2. Local north-up arrival frame after completion.

Whole-route summary is separate. This avoids an abrupt regional zoom-out at the
moment the rider arrives.

## Map Layer Authority

The camera and line styling must agree about which geometry currently owns the
ride:

- `too-far`: direct line and start marker only; no connector leg.
- `show-leg`: connector in visual-suggestion style; main route visible but
  secondary.
- `guide`: connector in active-guidance style; main route visible but secondary.
- `join-route`: retained connector tail and first main-route segment are both
  visible; authority crossfades to the main route.
- `ride` and later: main route is active; connector transition state is cleared.
- `off-route`: main route remains the authority; rejoin suggestion is visually
  distinct and never replaces it.

Start and destination markers must derive from navigation/session targets when
available, not only from product-flow objects such as `confirmedRidePlan`. This
keeps production and dev scenarios on the same rendering path.

## Shared Journey Harness

### One fixture, two views

SIM and CAM consume the same resolved journey object.

- **SIM:** plays the journey from its normal entry point to completion.
- **CAM:** presents named bookmarks within the journey. Selecting a bookmark
  starts with a short pre-roll, plays the camera transition at 1x, then holds the
  resulting state for inspection.

CAM is therefore a camera inspection tool, not a second scenario library.

### Journey contents

A journey contains:

```js
{
  name,
  route,
  fixes,
  connectorResponses,
  bookmarks: [
    {
      name,
      preRollMs,
      holdMs,
      expectedStage,
      expectations,
    },
  ],
}
```

`connectorResponses` are deterministic snapshots containing the same geometry,
distance, edge costs, snapped endpoints, and failure metadata that production
connector computation would return. Both the headless runner and the native dev
session receive them through the same scenario connector adapter.

### Initial journey set

Use a small set of credible journeys rather than one tiny fixture per stage:

1. **Guided approach journey:** intro → guided connector → connector maneuver →
   seam → main ride → main maneuver → arrival → arrived-local.
2. **Show-leg journey:** intro → low-confidence but plausible connector → live
   movement along it → main-route acquisition.
3. **Too-far journey:** regional intro → too-far approach/handoff state → cancel
   or reset.
4. **Missed-turn journey:** ride → missed turn → off-route → moving rejoin
   target → reacquisition.

Additional existing journeys cover stop-and-stand, GPS gap, parallel path,
wrong-way, and recorded real rides. They gain camera bookmarks where useful
instead of being copied into CAM-specific scenarios.

### Fixture realism

- Visual fixtures must follow roads, paths, or cycleways visible on the bundled
  map. Real catalog route snapshots and recorded/sampled tracks are preferred.
- Connector geometry must be a believable route, not a direct line classified
  as `show-leg` only through metadata.
- Coordinate displacement, timestamps, declared speed, and heading must agree.
- A stage-focused bookmark includes enough actual movement before and after the
  target state to evaluate tracking and transition behavior.
- Arbitrary L/grid geometry remains useful for pure unit tests but should not be
  the primary visual acceptance fixture.

### Playback time

Production camera dwell and animation use a monotonic real-time clock. The
headless runner must simulate the same logical timing between fixes and, for
transition assertions, intermediate camera frames.

CAM runs at 1x for visual acceptance. It may pause and hold by design. SIM may
retain 4x/8x playback for functional review, but accelerated playback is not a
camera-timing acceptance mode unless dwell and transition clocks are explicitly
scaled.

### CAM controls

CAM should provide:

- journey and bookmark selection;
- replay transition;
- pause/resume;
- previous/next fix or camera frame;
- return to journey start;
- optional toggles for target versus applied camera diagnostics.

The existing production pan and recenter controls remain real and must be usable
inside CAM.

### Diagnostics overlay

The overlay is shown only when camera inspection is enabled. It must not render
during every ordinary dev navigation session.

It shows, at a throttled rate:

- journey and bookmark;
- camera stage and viewport mode;
- geometry role;
- target and applied pitch;
- target and applied zoom;
- target and applied heading;
- fit/focus kind;
- rider anchor and viewport insets;
- lookahead/behind metres;
- approach ownership tier;
- connector source/response id;
- camera intent (`follow`/`free`);
- last transition and refit reason;
- fit/refit count.

Dev diagnostics must not update React state at display-frame frequency and must
not be included in production bundles.

## Testing Strategy

### Pure camera tests

- stage/viewport intent selection for all stages;
- ownership-resolving holds the previous intent;
- pitch and zoom clamps;
- lookahead increases with speed within bounds;
- maneuver corridor includes geometry after the decision;
- off-route bearing holds;
- guided approach uses approach geometry and progress;
- join transition preserves the approach bearing/geometry before blending;
- arrival-local and ride-summary remain distinct;
- viewport solver respects rider anchor and UI insets on small and tall phones;
- overview refit hysteresis prevents one-fix animation loops.

### Journey expectations

Expectations must assert ordered behavior, not just that a label appeared once:

- `guide → guide-pre-turn → join-route → ride` occurs in order;
- join persists for the intended transition window and then becomes ride;
- show-leg stays overview and emits no approach cue voice;
- too-far has no connector geometry and no guided-camera state;
- pre-turn includes the maneuver focus and exits after the maneuver;
- off-route holds heading and limits refits;
- reacquisition blends back to ride;
- arrival becomes arrived-local, not immediate whole-route summary;
- pan changes camera intent to free and prevents automatic camera writes;
- recenter restores the current derived camera intent;
- cancel/end resets to north-up overhead.

The headless camera timeline includes target intent, applied/interpolated camera
values at sampled frames, transition reason, and geometry role.

### Native visual acceptance

For every bookmark:

- required rider, route, target, cue, and marker points are visible outside UI
  occlusion;
- route authority styling matches camera geometry authority;
- heading changes are calm and understandable;
- zoom does not pulse or restart every fix;
- high pitch still leaves useful route geometry visible;
- camera transitions settle before the bookmark hold;
- user gestures and recenter work;
- small/tall phone and large-text panel heights remain valid.

## Observability and Privacy

Camera inspection is dev-only and local. It does not introduce production
analytics or location collection.

The scenario artifact records deterministic camera decisions and visibility
inputs so failures can be diagnosed without a device. Useful local counters
include stage changes, refits, refit reasons, time in free mode, and recenter
events.

## Risks

- A corridor/viewport solver is more work than fixed zoom constants, but it
  centralizes behavior currently duplicated across stage-specific branches.
- Pitched screen-space fitting may require iteration because geographic bounds
  alone do not guarantee marker placement after perspective and padding.
- Retaining connector seam geometry requires an explicit transition snapshot in
  session/presentation state; the current approach state clears too early.
- Realistic connector fixtures need curation and must be refreshed deliberately
  if their source route changes.
- Excessive camera responsiveness creates motion sickness and map instability;
  excessive hysteresis hides relevant changes. CAM bookmarks must tune both.

## Accepted Initial Tuning

These values are accepted as implementation starting points. They remain
centrally configurable and are tuned through CAM against realistic journeys;
changing a number within the documented bounds does not require a new product
design decision.

1. `intro-start-facing` uses the existing 55-degree directional style and
   distance-derived marker-slot zoom.
2. `approach-too-far` starts at 40 degrees with rider/start marker-slot or points
   fitting. It does not use a fixed regional zoom.
3. `approach-show-leg` starts at 35 degrees and fits most or all of the
   connector. It does not use 55 degrees by default.
4. Guided approach and main ride use a 55-degree cruise pitch with
   corridor-derived zoom initially clamped to 15.6–17.0.
5. Maneuver framing uses 35–40 degrees and fits rider + decision +
   post-maneuver geometry, initially clamped to 16.2–17.2. It may zoom in or out
   according to geometry.
6. Off-route starts at 20 degrees with held bearing and stable rejoin fit.
7. Arrival is local first; whole-route summary is explicit or deliberately
   delayed.
8. Recenter remains explicit. Timed automatic recenter is out of scope.
