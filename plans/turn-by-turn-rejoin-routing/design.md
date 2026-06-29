# Turn-by-Turn Rejoin Routing (Phase B)

**Date:** 2026-06-29 (revised same day after a code review of the first plan)
**Status:** implementation in progress; automated core/native-source validation
complete, simulator/device acceptance pending
**Builds on:** `plans/turn-by-turn-improvements/` (Phase A shipped: acquisition
state, segment context, smoothed puck/camera, off-route/approach **arrow +
distance** guidance, and the node replay + in-app simulate-ride harnesses). This
is the deferred **Phase B — routed rejoin** from that design.

## Review revisions (2026-06-29) — binding

A code review of the first plan surfaced correctness blockers, verified against
the code. These override the original prose below where they conflict:

1. **Router primitive:** compute connectors via a new non-mutating
   `previewBaseRoute([from,to])` that reuses `previewRouteInfo`'s snapping
   (`_snapRoutePoints` → `_calculateBaseRoute`) — NOT `_calculateBaseRoute`
   directly (it needs already-snapped points carrying `baseEdgeId`; raw GPS
   fails). Returns `{ geometry, distanceMeters, failure, snappedEndpoints }`.
2. **No planner mutation:** `ensureCoverage` → `mergeBaseRoutingNetwork` nulls
   `baseRouteInfo` (route-manager.js:877), which would silently recompute the
   planner route. The connector capability MUST preserve `baseRouteInfo` +
   `lastRouteFailure` across coverage extension. Exposed as a narrow
   `computeConnector(from, to)` capability from `useCyclewaysApp` (MapScreen
   can't reach the private session). A mutation-regression test asserts the
   planner route snapshot is identical before/after a connector that loads a
   shard.
3. **Orthogonal state:** `status` ∈ `approaching | navigating | off-route |
   on-connector | paused | …`; connector lifecycle is a SEPARATE field
   `connector: { status: "idle"|"requesting"|"active"|"failed", requestId,
   pendingTarget }`. While computing, `status` stays `approaching`/`off-route`
   so the Phase A arrow keeps showing — there is NO top-level "routing" status.
4. **Session is authoritative** for request ids, throttle, pending target, and
   stale-result acceptance. The hook only runs the async compute and returns a
   result. `CONNECTOR_READY { requestId, geometry, distanceMeters,
   snappedEndpoints }` — the session already holds the pending target (no
   round-trip).
5. **Seeded handoff:** add `tracker.seed({ progressMeters, acquired })` +
   windowed search; never `reset()`+global-reacquire (wrong branch on
   loops/out-and-back). Hand off only on accuracy-aware physical proximity to
   the main-route target OR genuine main-route reacquisition — never on connector
   `remainingMeters` alone (a rider far laterally can project onto the final
   segment and look "complete").
6. **Continuous target projection:** project onto the polyline (reuse
   `projectToSegment`) and return the interpolated point + progress, not the
   nearest vertex. Mid-ride rejoin uses the **last confirmed on-route progress**
   (the tracker keeps updating progress while off-route — routeProgress.js:281 —
   and can jump branches on loops). Return null when there is no acceptable
   forward candidate; never target behind the rider.
7. **Detour acceptance, not ratio rejection:** a large straight-line ratio
   usually means a barrier (river/highway) — exactly where routed guidance beats
   an arrow across it. Accept by an **absolute distance/time cap** only; do not
   reject a valid connector for routing around a barrier. (Multi-candidate
   routing + cost comparison is a deferred future refinement, not v1.)
8. **Differentiated retry:** transient I/O failure → time-based backoff (retries
   even while stationary); off-graph/no-path → retry after meaningful movement;
   rejected target → retry after movement. A time-AND-movement gate alone strands
   a stationary rider after a transient load failure.
9. **Lifecycle completeness:** off-connector recompute; early main-route
   reacquisition; stop-while-requesting; pause/resume **restores the prior
   phase** (RESUME currently hardcodes `navigating`, navigationSession.js:135);
   connector cue dedupe namespaced by `requestId` and reset on handoff.
10. **Single rider-position source:** store `latestFix` in session state and use
    it as the sole rider position (the adaptive puck currently reads Mapbox
    `UserLocation`, so simulated fixes don't move the off-route puck — a latent
    Phase A coupling). On switching active geometry (main↔connector) reset
    smoothed progress / traveled-line / bearing, keyed by `requestId`.
11. **Acceptance gate:** a clean iOS bundle export is NOT sufficient to call this
    implemented — a real simulator/device acceptance pass is required (approach
    connector, off-route connector, failed route, recompute, early reacquire,
    pause/stop, loop-route handoff).

## Motivation

After Phase A, the rider can *see* the route (the approach camera fits rider +
route) and gets a direction arrow + distance, but must find their own way to the
route — there is no routed, turn-by-turn guidance to it. Phase B adds an on-device
**connector route**: actual turn-by-turn guidance from the rider's position to the
route (the start when approaching, the nearest point ahead when rejoining
mid-ride), with a clean handoff back to the main route, recompute-while-moving,
and a guaranteed fallback to the Phase A arrow when routing isn't possible.

The CycleWays offline routing graph is already on-device (`ShardedRouteSession`),
so the connector is computed locally — the same path-finding the planner uses.

## Scope decisions (brainstorming, 2026-06-29)

- **Both cases in scope:** approach-to-route (before reaching it) AND mid-ride
  off-route rejoin.
- **Mid-ride behavior: auto-reroute, throttled** — reroute on *confirmed*
  off-route (existing dwell, not a single GPS blip), then recompute at most once
  per time-and-movement gate. Hands-free; the throttle prevents instruction
  thrash (the risk D5 of the parent design flagged).
- **Approach target: scored start-vs-nearest** — bias to the route start; join
  the nearest point on the route only if it saves a meaningful detour margin.
- **Mid-ride target: nearest projected point ahead** of the last confirmed
  on-route progress (never backtrack), accepted under an absolute distance cap.
- **Architecture: pure connector-compute in core + a connector phase in the nav
  session.** No second routing session (no duplicate graph); the route-manager
  computes a path without committing it as the active route. The session's
  connector logic is pure and node-testable; the native hook only executes the
  async routing request emitted by the session.
- **Always falls back to Phase A** (arrow + distance) when routing fails / is
  unavailable / in flight.

## Architecture

### Components

**`ShardedRouteSession.computeConnector(from, to)` — core routing capability
(non-mutating).** It:
1. ensures shard coverage for both `from` and `to` (`ensureCoverage`),
2. restores the planner's cached `baseRouteInfo` and `lastRouteFailure` after
   coverage extension,
3. calls `previewBaseRoute([from, to])`, which snaps raw coordinates before
   invoking the base-graph path-finder, and
4. returns `{ geometry, distanceMeters, failure, snappedEndpoints }`.

`useCyclewaysApp` exposes this as a narrow bound capability. Connector routing
does not commit or replace the planner's active route.

**Navigation session — connector phase (pure).** `navigationSession.js` owns the
request sequence, target, throttle, retry policy, stale-result acceptance,
connector tracker, and connector cues. Connector lifecycle is orthogonal state:
`connector.status` is `idle|requesting|active|failed`. While a request is in
flight the top-level status remains `approaching` or `off-route`; `on-connector`
is entered only after a route is accepted. The emitted `routeRequest` contains
`{ requestId, from, to, toProgressMeters, mode }`.

**Native hook (`useNavigationSession`).** Watches for `routeRequest`, calls the
injected `computeConnector` capability, and dispatches the tagged result. It does
not own throttling, target selection, ids, or stale-result policy.

### Data flow

GPS fix → session decides whether a connector is needed (approaching, or
confirmed off-route, or drifted off the active connector) → emits
`routeRequest{requestId,from,to}` → hook computes (async) → tagged
`CONNECTOR_READY` → session enters `on-connector`, advances the connector tracker
+ cues per fix → on physical target arrival or genuine main-route recovery →
**handoff**: drop connector, seed the main tracker's cursor at the intended main
progress, status → `navigating`.

## Target selection

**Approach (not yet acquired).** Scored choice:
- `dStart` = distance(rider, route start); `dNearest` = cross-track distance to
  the nearest continuous projection on the route polyline.
- Choose **nearest** iff `dNearest < dStart − APPROACH_NEAREST_MARGIN_M`
  (≈ a few hundred metres, tunable); otherwise the **start**.
- `target.mainProgressMeters` = that point's progress along the main route (0 for
  the start), so the handoff resumes the main route there; any skipped portion is
  simply behind the rider.

**Mid-ride rejoin (already acquired, confirmed off-route).** Nearest projected
point **ahead** of `lastConfirmedProgressMeters` within a forward search window;
never a point behind and never based on progress that drifted while off-route.

**Distance cap (both).** Accept a valid connector up to
`CONNECTOR_MAX_DISTANCE_M`. Do not use a straight-line ratio: a large ratio often
means a river, highway, or other barrier where routed guidance is most valuable.

Thresholds (`APPROACH_NEAREST_MARGIN_M`, the forward window, and
`CONNECTOR_MAX_DISTANCE_M`) are exported constants tuned in the simulate-ride
harness.

## Recompute-while-moving & handoff

**(Re)compute triggers:**
- Approach: once when navigation starts while not acquired; again only if the
  rider strays far from the active connector.
- Mid-ride: on **confirmed** off-route (existing hysteresis/dwell).
- While `on-connector`: only when the rider drifts off the connector beyond a
  threshold, **double-gated** — at most once per `RECOMPUTE_MIN_MS` (≈5 s) **and**
  after moving `RECOMPUTE_MIN_MOVE_M` (≈30 m). The AND-gate is what prevents
  instruction thrash on GPS jitter.

**Stale-request safety.** Each `routeRequest` carries a monotonic `requestId`.
The hook returns that id unchanged; the session accepts a result only when it
matches the currently requesting connector. Slow superseded results are dropped.

**Handoff (connector → main).** The connector tracker runs while `on-connector`.
When the rider is within the accuracy-aware handoff radius of `target.point`,
drop the connector, seed the main tracker's cursor at
`target.mainProgressMeters`, and enter `navigating`. Reported accuracy is capped
at 30 m for this test. Connector remaining distance alone never triggers a
handoff. If the rider reaches the main route elsewhere, genuine main-tracker
recovery abandons the connector early.

**Pause/stop.** Pause freezes connector computation + timers; stop clears the
connector slot. Recenter behaves as on the main route.

## Failure & offline fallback

The connector is best-effort and never strands the rider. Fall back to the
**Phase A arrow + distance** (already implemented, never fails) when:
- `computeConnector` returns `failure` (no connected path / off-graph spot),
- the shard for the rider's current location isn't bundled (`ensureCoverage`
  can't load it),
- the absolute connector cap rejects the result, or
- a compute is still in flight — the top-level `approaching`/`off-route` status
  keeps the arrow visible, so guidance is never blank.

In fallback the session exposes the Phase A `guidanceBearingDeg` /
`guidanceDistanceMeters` and retries compute on the normal throttle (transient
coverage gaps self-heal as the rider moves into covered area). A failure is logged
once, not spammed.

## UI

- **Connector line:** rendered as a **dashed** line, visually distinct from the
  solid main route and the muted traveled portion — reads as "the way to the
  route," not part of it.
- **Cues:** while `on-connector`, connector maneuvers reuse the existing
  cue/haptic/voice-ready pipeline; the NavPanel cue banner shows connector turns +
  distance like main-route cues, with a context line indicating it leads to the
  route (Hebrew/RTL, e.g. "מסלול חיבור — לכיוון המסלול").
- **Camera:** `on-connector` uses the same tight heading-up follow as main-route
  riding; the approach fit-to-(route+rider) view applies while no connector is
  active. Gestures disengage follow; recenter re-engages
  (unchanged from Phase A).
- **Fallback:** the Phase A rotating arrow + distance (unchanged).

## Testing

**Node replay harness (primary).** The connector state machine is pure and driven
through the existing `replaySession` with a synchronous **stub connector router**
(no shard I/O in tests). Controlled mode exposes the session and requests so
tests can deliver results out of order.
Assertions:
- approach → `routeRequest` with the scored target (start vs nearest) →
  `on-connector` progress + cues → handoff resumes the main route at the offset;
- confirmed mid-ride off-route → rejoin to nearest-ahead → handoff;
- absolute-cap rejection → Phase A fallback;
- routing `failure` → Phase A fallback + retry on the throttle;
- stale `CONNECTOR_READY` (superseded request id) ignored;
- normal recompute observes time AND movement; transient retry is time-only and
  route failures retry after movement.
Plus pure unit tests for **target selection** (scored approach; nearest-ahead
window; absolute cap), non-mutating route preview, coverage preservation, and
seeded handoff behavior.

**In-app simulate-ride (tuning loop).** The dev simulate-ride source feeds tracks
that start far from the route and deliberately diverge mid-route, so the developer
watches the dashed connector appear, cues fire, recompute behave (no thrash), and
the handoff feel — where `APPROACH_NEAREST_MARGIN_M`, the recompute gates,
`CONNECTOR_MAX_DISTANCE_M`, and `HANDOFF_RADIUS_M` get tuned. The real
`computeConnector` capability runs here against bundled shards.

**Boundary.** Pure logic (connector phase, target selection, handoff, fallback,
request-id cancellation, and recompute policy) is node-tested. The native async
routing call and dashed-line render are verified in the simulator/device.

## Data / code boundaries

Shared/core (`@cycleways/core`, node-tested):
- `previewBaseRoute` + `ShardedRouteSession.computeConnector` (the only shard-I/O
  path; thin, async, planner-state preserving).
- connector phase in `navigationSession.js` (orthogonal state, `routeRequest`,
  `CONNECTOR_READY`/`CONNECTOR_FAILED`, connector tracker + cues, handoff).
- target-selection + absolute-cap helpers (pure).
- replay-harness stub support.

Native app:
- hook wiring: react to `routeRequest`, call `computeConnector`, dispatch tagged
  results.
- dashed connector line render; connector cue/camera reuse.

Web: unchanged (no navigation).

## Out of scope

- Voice/TTS (still deferred; the connector cues are voice-ready behind the same
  interface).
- Background/lock-screen location; Android.
- Junction-vs-bend maneuver classification (separate future work).
- Multi-waypoint connector optimization — a connector is always a single
  from→to path.

## Open questions

- Final production tuning for the exported targeting, retry, and handoff
  constants after the required simulator/device acceptance pass.
- Whether to surface delayed-compute text while `connector.status` is
  `requesting`; the Phase A arrow remains the default feedback.
