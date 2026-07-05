# iOS Turn-by-Turn Navigation — Review Findings and Improvement Proposals

**Date:** 2026-07-03
**Status:** review complete; feedback incorporated; implementation plan ready
**Reviews:** `plans/rn-turn-by-turn-navigation/`, `plans/turn-by-turn-improvements/`,
`plans/turn-by-turn-rejoin-routing/`, `plans/approach-destination-picker/`,
`plans/navigation-ride-setup/`, and the shipped implementation in
`packages/core/src/navigation/` + `apps/mobile/src/` (BuildScreen, NavPanel,
RideSetupSheet, DestinationSheet, useNavigationSession, pendingRidePlanStore).

## Purpose of this document

A full design + implementation review of the iPhone turn-by-turn navigation
feature, written so other agents can verify the findings, challenge the
assessments, and pick up the proposed work items. Each finding cites the file
and mechanism so it can be re-verified against the code.

The ordered implementation sequence and validation expectations live in
`implementation-plan.md`.

## Overall assessment

The concept and architecture are strong. The defining product decision —
**confidence matched to role** (authoritative turn-by-turn only on vetted
CycleWays geometry; the approach to the route is a non-narrated *suggestion*
plus an external-app handoff) — is correct for a discovery/planning product and
was reached by explicitly walking back an already-implemented navigation-grade
connector (see the superseded Phase B in `turn-by-turn-rejoin-routing`).

Implementation quality is high: pure node-tested core (`@cycleways/core`)
with native code reduced to glue; ~15 dedicated navigation test files including
a session replay runner and synthetic track generator; named/exported policy
constants; the superseded connector code actually deleted. The effective-route
layer (`effectiveNavigationRoute.js`: reverse, linear truncate, loop rotation
with span wrap-around and seam validation) handles the hard cases carefully and
keeps the session engine ignorant of ride plans.

The two weakest areas:

1. **Approach UX friction** — the common case (rider standing at the trailhead)
   pays the full ride-setup ceremony every ride.
2. **Cue quality** — turns are detected from raw geometry bends, so winding
   trails produce decision-free "turn" cues; junction-vs-bend classification is
   deferred in both design docs but is now the highest-value guidance
   improvement.

## Accepted reviewer amendments

Follow-up review on 2026-07-03 agreed with the findings and accepted these
modifications to the proposed work:

- **Junction-vs-bend is a data-contract change, not just cue logic.**
  `segmentSpans` carry useful `cwSegmentId`/`routeClass` metadata but do not
  currently carry graph-node degree, competing branch bearings, or incoming /
  outgoing edge identity. The route manager has topology and traversal context,
  but `NavigationRoute` only receives merged spans. P3 therefore needs a short
  dedicated design pass before implementation.
- **The at-route fast path must be conservative.** One-tap start should only
  apply when the setup location is fresh, `approachTier === "at"`, the route is
  navigable, and the current/default selection is unambiguous. Direction,
  custom-start, or stale-location cases keep the full setup sheet.
- **The polish batch should be split by test surface.** Core/presentation fixes
  (cue priority, stopped arrow, connector distance, legacy target-label cleanup)
  are separate from native lifecycle/device fixes (acquired banner timer, GPS
  watch pause/resume, external-handoff background heuristic).
- **Connector retry should add observability.** Current telemetry records only
  final `ready`/`failed` connector result, and the sink is optional/no-op by
  default. Retry count, failure reason, latency, and beeline-vs-connector
  distance quality should be emitted as privacy-safe coarse fields.
- **F10 is legacy cleanup.** The non-app target picker remains in
  `DestinationSheet`, but `BuildScreen` now opens it with `appsOnly`; the
  session retarget actions are exposed by the hook but appear dormant in
  production UI. Treat this as cleanup unless a new mid-approach retargeting UX
  is explicitly designed.

## Findings

Ordered by severity within each group. "Verified" = confirmed by reading the
code path; none of these were run on a device as part of this review.

### F1. Connector suggestion never retries after a failure (bug — contradicts design)

`packages/core/src/navigation/navigationSession.js`: `suggestionStatus` moves
`idle → requesting → ready | failed`. The LOCATION handler only issues a new
`routeRequest` when `suggestionStatus === "idle"`, and nothing returns the
status to `idle` except an explicit retarget (`retargetApproach`) or session
reset. The rejoin design (`turn-by-turn-rejoin-routing/design.md`, "Fallback")
requires: *"the connector is retried best-effort as the rider moves into
covered area."*

Consequence: one `CONNECTOR_FAILED` (e.g., a moment outside shard coverage)
permanently removes the dashed suggestion for the rest of the approach, and
likewise for mid-ride off-route rejoin suggestions. The existing
`shouldRequest` 200 m movement gate (`REQUEST_MIN_MOVE_M`) is unreachable from
the `failed` state.

Also related: once `ready`, the rejoin target is never re-projected as the
rider moves, so `distanceToRouteMeters` is computed against a target that can
fall behind a rider riding parallel to the route. Low impact, same root cause
(the status gate doubles as a recompute gate).

### F2. Ride setup has no true fast path for the at-route case (UX)

`navigation-ride-setup/design.md` lists "preserve a fast path when the rider is
already on or very near the route" as a goal. The implementation
(`BuildScreen.jsx` `openRideSetup` → `RideSetupSheet`) always presents the full
sheet — direction, start mode, consequence summary, confirm — and the fast path
is only a different primary-button label (`התחל ניווט במסלול`). A rider at the
trailhead pays the full ceremony every ride and will learn to blind-confirm,
eroding the value of the choices the sheet exists to present.

### F3. Turn cues are geometry bends, not junctions (guidance quality)

`packages/core/src/navigation/navigationCues.js`: a turn cue is any heading
delta ≥ `TURN_THRESHOLD_DEG` (40°) between consecutive vertices, spaced
≥ `MIN_TURN_SPACING_M` (20 m). On curvy singletrack/switchbacks this emits
cues at bends where no decision exists; conversely a gradual junction approach
split across small deltas emits nothing. Riders quickly learn the cues carry no
information, which poisons trust at real junctions. Both
`rn-turn-by-turn-navigation` (D4) and `turn-by-turn-improvements` explicitly
deferred junction-vs-bend classification; the segment spans already retain
`cwSegmentId`/`routeClass` to enable part of it, and the network graph can
supply vertex degree. However, that topology is not currently propagated onto
`NavigationRoute`; merged spans are necessary but not sufficient. A proper fix
should define maneuver metadata at the route-manager / snapshot boundary before
changing `navigationCues.js`.

### F4. Cue selection is nearest-first, so informational cues mask maneuvers

`navigationCues.js` `selectActiveCue` returns the single nearest upcoming cue
within `PREVIEW_MAX_M` (120 m). Cue *generation* has tie-priorities, but
*selection* has none: a POI/hazard cue 50 m ahead hides a turn cue 70 m ahead
until the POI is passed, potentially compressing the turn warning to under
`FINAL_MAX_M` (35 m). Maneuvers should win selection, or hazards should render
on a separate line in `NavPanel`.

### F5. Approach arrow is misleading when stopped without a compass (UX)

`NavPanel.jsx`: the arrow falls back to `p.guidanceArrowDeg ?? 0` when
`compassHeading` is unavailable, and `navigationPresentation.js`
`relativeArrowDeg` substitutes course 0 when the rider is stationary
(`courseDeg === null`). Net effect: a stopped rider (exactly the person
studying the arrow to decide which way to set off) sees the absolute bearing
rendered as if they were facing north. Degrade to hiding the arrow (distance +
label only) when neither compass nor course is available.

### F6. `justAcquired` banner lives for one GPS fix (~1 s) (UX)

`navigationSession.js` sets `justAcquired: true` on the acquiring LOCATION
dispatch and it is cleared by the next fix. The design
(`navigation-ride-setup`, "Transition to route guidance") calls for a brief but
*noticeable* transition. The confirmation haptic fires, but the visual
`הגעת למסלול` banner at 1 Hz fix cadence is near-subliminal. A 3–5 s
presentation timer in the native layer (not the pure session) would match
intent.

### F7. Global-search fallback can jump progress across route overlaps (correctness, contained)

`routeProgress.js` `update()`: when the windowed nearest-segment match exceeds
the enter threshold, the tracker falls back to a **global** `findNearest` and
commits `lastProgressMeters` to whatever it finds. On out-and-back or
self-crossing routes, a rider drifting off near the outbound leg can be snapped
to the return leg — jumping progress, remaining distance, and the traveled
line. Blast radius is display-only: rejoin targeting keys off
`lastConfirmedProgressMeters`, which only updates while confirmed on-route.
The replay harness (`replayRunner.js` + `trackGenerator.js` off-route
excursions) can reproduce this with an out-and-back fixture.

### F8. Pause does not stop the GPS watch (battery)

`useNavigationSession.js`: `pause()` dispatches `PAUSE` (the session then
ignores LOCATION), but the high-accuracy `expo-location` watch keeps running.
A long café stop burns battery in a mode labeled "paused." Foreground-only
today so the impact is bounded, but this should be fixed before background
location ships. Note the resume path must handle the stale `prevFix` in the
tracker's course computation (it already tolerates it, but a test should pin
it).

### F9. Beeline distance shown beside a road-shaped suggestion (honesty)

The approach banner distance is straight-line (`getDistance` to the target)
while the dashed connector may be 2–3× longer around a barrier. When
`suggestionStatus === "ready"`, the connector's own `distanceMeters` (already
returned by `computeConnector` but currently discarded by the session) is the
more honest number to display.

### F10. Residual multi-target complexity in presentation (hygiene)

Effective routes make the chosen start progress-zero, so during `approaching`
the tracker's guidance always points at `geometry[0]` and `guidanceText`
hardcodes "לכיוון תחילת המסלול". Yet `destinationLabelFor` still supports
`nearest`/`custom` labels from the superseded pre-ride destination-picker flow,
and `SET_APPROACH_TARGET`/`SET_APPROACH_CUSTOM_TARGET` are still dispatchable
while approaching. The non-app target picker also remains in `DestinationSheet`,
but `BuildScreen` now opens that sheet with `appsOnly`, so the production UI
appears to have moved target selection into `RideSetupSheet`. Either restore a
designed mid-approach retargeting affordance and align the guidance copy, or
remove the dormant session/hook/presentation surface.

### F11. `BuildScreen.jsx` is 3,000 lines (structure)

The ride-setup state cluster (~15 `useState`/`useRef` hooks), the RAF
puck/camera smoothing block, and the external-handoff/AppState logic would each
extract cleanly (`useRideSetup`, `useSmoothedRiderPuck`, `useExternalHandoff`).
Hygiene, not danger — but it is the file every navigation change touches.

### F12. Backgrounding heuristic on external handoff (device-verify)

`BuildScreen.jsx`: while `pendingExternalPlan` is set, *any*
background→active transition reopens ride setup — including a rider who merely
checked a message and never left for the trailhead. Acceptable v1 behavior,
but device-test whether it feels naggy; a minimum-elapsed-time or
significant-location-change guard is the likely fix.

## What was checked and found sound (no action)

- **Start-acquisition contract:** `requiresStartAcquisition` +
  `startAcquisitionWindowMeters` (150 m) restricts first acquisition to the
  effective start; passing another leg cannot acquire, and a loop's colocated
  finish cannot instantly complete. (`routeProgress.js`, set by
  `effectiveNavigationRoute.js`.)
- **Off-route hysteresis:** accuracy-inflated enter threshold
  (30 m + accuracy), 15 m exit, dwell timers on injected timestamps; a single
  GPS spike cannot flip state.
- **Wrong-way detection:** displacement-course above 1 m/s only, 120°
  threshold, never flags while stopped.
- **Effective-route transforms:** reverse remaps spans/POIs/elevation
  gain-loss/endpoints; loop rotation preserves the full loop with span
  wrap-around; seam validated against `LOOP_SEAM_TOLERANCE_M` before loop
  semantics are applied; source route never mutated.
- **External handoff persistence:** pending ride intent validated
  (`pendingRidePlan.js`), 12 h TTL, cold-start restore wired in `App.js`,
  cleared on cancel/confirm.
- **Haptic gating:** per-type intensity, `enter-segment` visual-only, global
  1.2 s cooldown (`cueHaptics.js`).
- **Non-mutating connector:** `computeConnector` preserves planner
  `baseRouteInfo`/`lastRouteFailure`; suggestion never narrated.

## Proposed work items (prioritized)

| # | Item | Findings | Size | Kind |
|---|------|----------|------|------|
| P1 | Connector retry + connector distance + telemetry: `failed` and stale `ready` rejoin targets become eligible for recompute behind the existing 200 m movement gate; preserve old suggestion until replacement; record privacy-safe retry/result fields | F1, F9 | S | Bug fix, node-testable |
| P2 | Core/presentation polish: maneuver-priority cue selection, hide approach arrow when stopped without compass/course, and remove or align dormant mid-approach target-label surface | F4, F5, F10 | S | Core/UI polish, mostly node-testable |
| P3 | Native lifecycle polish: 3–5 s acquired banner, stop/restart GPS watch on pause/resume, and device-check the external-handoff background heuristic | F6, F8, F12 | M | Native + device |
| P4 | Conservative one-tap start when `approachTier === "at"` with fresh location and unambiguous default selection; full setup remains behind "change settings" and for all ambiguous cases | F2 | M | UX, native + device |
| P5 | Junction cue data-contract design: define route-level maneuver metadata from traversal topology before changing cue generation | F3 | M | Design + routing contract |
| P6 | Junction-vs-bend cue implementation using the new maneuver metadata; develop against replay fixtures | F3 | L | Guidance quality, core |
| P7 | Out-and-back replay fixture pinning the off-route global-search progress jump; then decide fix (e.g., clamp fallback search to a widened window while off-route) | F7 | M | Correctness, core |
| P8 | Voice cues (TTS) behind the existing cue-event interface — the step from "glanceable route follower" to hands-free navigation; pairs with the deferred background-location decision | — | L | Feature, separate design |
| P9 | Extract `useRideSetup` / smoothing / handoff hooks from `BuildScreen.jsx` | F11 | M | Hygiene |

P1 and P2 are the safest immediate wins with existing test harnesses. P3 and
P4 need simulator/device acceptance. P5 should happen before any P6 code.
P8 remains intentionally deferred until cue trust improves.

## Open questions for reviewers

1. For P4: should direction choice (רגיל/הפוך) ever block one-tap start, or is
   the fast path strictly "current default selection only" with all changes
   behind the full setup sheet?
2. For P5: what exact maneuver metadata should cross the route-manager /
   snapshot / `NavigationRoute` boundary: graph node id, node degree, incoming
   and outgoing edge ids, incoming/outgoing bearings, competing branch bearings,
   or a precomputed "decision point" flag?
3. F10: are mid-approach retargeting actions (`SET_APPROACH_TARGET`,
   `SET_APPROACH_CUSTOM_TARGET`) still a supported affordance after the ride-
   setup redesign, or should they be removed from the session/hook tests?
4. Should P7's fix wait for a real recorded off-route ride fixture (the Task 18
   follow-up from `turn-by-turn-improvements` is still open)?
