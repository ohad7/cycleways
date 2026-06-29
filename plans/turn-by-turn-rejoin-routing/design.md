# Turn-by-Turn Rejoin Routing (Phase B)

**Date:** 2026-06-29
**Status:** design approved; implementation plan next
**Builds on:** `plans/turn-by-turn-improvements/` (Phase A shipped: acquisition
state, segment context, smoothed puck/camera, off-route/approach **arrow +
distance** guidance, and the node replay + in-app simulate-ride harnesses). This
is the deferred **Phase B — routed rejoin** from that design.

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
- **Mid-ride target: nearest point ahead** of current progress (never backtrack),
  with a detour-sanity check.
- **Architecture: pure connector-compute in core + a connector phase in the nav
  session.** No second routing session (no duplicate graph); the route-manager
  computes a path without committing it as the active route. The session's
  connector logic is pure and node-testable; the native hook does only the async
  routing call + recompute timers.
- **Always falls back to Phase A** (arrow + distance) when routing fails / is
  unavailable / in flight.

## Architecture

### Components

**`computeConnectorRoute(from, to)` — core routing layer (non-mutating).**
An async function next to `ShardedRouteSession` that:
1. ensures shard coverage for both `from` and `to` (`ensureCoverage`),
2. runs the base-graph path-finder for `[from, to]` **without committing it as
   the active route** (the route-manager can compute a path and return it without
   mutating `selectedSegments`/`baseRouteInfo`), and
3. returns `{ geometry, distanceMeters, failure }` (geometry is a vertex list in
   the same `{lat,lng}` shape as route geometry; `failure` non-null when no
   connected path).

It never touches the planner's loaded route. This is the only piece that does
shard I/O.

**Navigation session — connector phase (pure).** `navigationSession.js` gains:
- a connector slot: `{ geometry, tracker, cues, target }` where `tracker` is a
  `createRouteProgressTracker` over the connector geometry, `cues` is
  `buildRouteCues` for it, and `target` is `{ point, mainProgressMeters }` — the
  point on the **main** route the connector rejoins and its main-route progress
  offset.
- new statuses: `routing` (a connector is being computed) and `on-connector`
  (following one). Existing: `approaching`, `navigating`, `off-route`, `paused`.
- a transient `routeRequest { from, to, generationId, targetKind }` output the
  session emits when it needs a (re)route; the session performs **no** async work.
- new actions: `CONNECTOR_READY { generationId, geometry, target }` and
  `CONNECTOR_FAILED { generationId, reason }`.

**Native hook (`useNavigationSession`).** Watches for `routeRequest`; calls
`computeConnectorRoute`; dispatches `CONNECTOR_READY`/`CONNECTOR_FAILED`. Owns the
recompute **debounce timer** and **generation-id** bookkeeping (a result whose id
isn't the latest is dropped). All injected behind the existing `locationSource`-
style seam so the replay harness can stub the router.

### Data flow

GPS fix → session decides whether a connector is needed (approaching, or
confirmed off-route, or drifted off the active connector) → emits
`routeRequest{from,to,generationId}` → hook computes (async) → `CONNECTOR_READY` →
session enters `on-connector`, advances the connector tracker + cues per fix → on
reaching `target` (or connector completion) → **handoff**: drop connector, seed
the main tracker's cursor at `target.mainProgressMeters`, status → `navigating`.

## Target selection

**Approach (not yet acquired).** Scored choice:
- `dStart` = distance(rider, route start); `dNearest` = distance(rider, nearest
  route geometry vertex).
- Choose **nearest** iff `dNearest < dStart − APPROACH_NEAREST_MARGIN_M`
  (≈ a few hundred metres, tunable); otherwise the **start**.
- `target.mainProgressMeters` = that point's progress along the main route (0 for
  the start), so the handoff resumes the main route there; any skipped portion is
  simply behind the rider.

**Mid-ride rejoin (already acquired, confirmed off-route).** Nearest point
**ahead** of current `progressMeters` within a forward search window; never a
point behind (no backtracking).

**Detour sanity (both).** After computing the connector, reject it (→ Phase A
fallback) when `distanceMeters` is implausibly large versus the straight-line gap
(`> DETOUR_RATIO × straightLineMeters`, or over `DETOUR_ABS_CAP_M`) — indicates a
barrier (river/highway) between rider and target; guiding a giant detour is worse
than the arrow.

Thresholds (`APPROACH_NEAREST_MARGIN_M`, forward window, `DETOUR_RATIO`,
`DETOUR_ABS_CAP_M`) are constants tuned in the simulate-ride harness.

## Recompute-while-moving & handoff

**(Re)compute triggers:**
- Approach: once when navigation starts while not acquired; again only if the
  rider strays far from the active connector.
- Mid-ride: on **confirmed** off-route (existing hysteresis/dwell).
- While `on-connector`: only when the rider drifts off the connector beyond a
  threshold, **double-gated** — at most once per `RECOMPUTE_MIN_MS` (≈5 s) **and**
  after moving `RECOMPUTE_MIN_MOVE_M` (≈30 m). The AND-gate is what prevents
  instruction thrash on GPS jitter.

**Stale-request safety.** Each `routeRequest` carries a monotonic
`generationId`. The hook tags its async result with that id; the session applies
`CONNECTOR_READY`/`CONNECTOR_FAILED` only when `generationId` is the latest
outstanding. Slow results for superseded requests are dropped.

**Handoff (connector → main).** The connector tracker runs while `on-connector`.
When the rider is within `HANDOFF_RADIUS_M` (≈20 m) of `target.point` (or the
connector tracker reports completion), drop the connector, seed the main tracker's
cursor at `target.mainProgressMeters`, status → `navigating`. If the rider reaches
the main route elsewhere (cuts across early), the normal main-route
acquisition/off-route logic re-acquires — the connector is abandoned on the next
recompute/handoff check.

**Pause/stop.** Pause freezes connector computation + timers; stop clears the
connector slot. Recenter behaves as on the main route.

## Failure & offline fallback

The connector is best-effort and never strands the rider. Fall back to the
**Phase A arrow + distance** (already implemented, never fails) when:
- `computeConnectorRoute` returns `failure` (no connected path / off-graph spot),
- the shard for the rider's current location isn't bundled (`ensureCoverage`
  can't load it),
- the detour-sanity check rejects the result, or
- a compute is still in flight (status `routing`) — show the arrow meanwhile so
  guidance is never blank.

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
  riding; the approach fit-to-(route+rider) view applies only before a connector
  exists / while `routing`. Gestures disengage follow; recenter re-engages
  (unchanged from Phase A).
- **Fallback:** the Phase A rotating arrow + distance (unchanged).

## Testing

**Node replay harness (primary).** The connector state machine is pure and driven
through the existing `replaySession` with a **stubbed `computeConnectorRoute`**
injected (no shard I/O in tests). The stub can return canned connector geometry, a
`failure`, or a slow/out-of-order result (to exercise generation-id cancellation).
Assertions:
- approach → `routeRequest` with the scored target (start vs nearest) →
  `on-connector` progress + cues → handoff resumes the main route at the offset;
- confirmed mid-ride off-route → rejoin to nearest-ahead → handoff;
- detour-sanity rejection → Phase A fallback;
- routing `failure` → Phase A fallback + retry on the throttle;
- stale `CONNECTOR_READY` (superseded generation id) ignored;
- recompute double-gate (time AND movement) does not fire early.
Plus pure unit tests for **target selection** (scored approach; nearest-ahead
window; detour ratio/cap) and **handoff offset** math, using a real catalog-route
geometry slice as a fixture.

**In-app simulate-ride (tuning loop).** The dev simulate-ride source feeds tracks
that start far from the route and deliberately diverge mid-route, so the developer
watches the dashed connector appear, cues fire, recompute behave (no thrash), and
the handoff feel — where `APPROACH_NEAREST_MARGIN_M`, the recompute gates,
`DETOUR_RATIO`/cap, and `HANDOFF_RADIUS_M` get tuned. The real
`computeConnectorRoute` runs here against bundled shards.

**Boundary.** Pure logic (connector phase, target selection, handoff, fallback,
generation-id cancellation) is node-tested. The native async routing call +
recompute timers + dashed-line render are verified in the simulator/device (same
deferred-manual boundary as the rest of the native nav work).

## Data / code boundaries

Shared/core (`@cycleways/core`, node-tested):
- `computeConnectorRoute` (the only shard-I/O piece; thin, async).
- connector phase in `navigationSession.js` (statuses, `routeRequest`,
  `CONNECTOR_READY`/`CONNECTOR_FAILED`, connector tracker + cues, handoff).
- target-selection + detour-sanity helpers (pure).
- replay-harness stub support.

Native app:
- hook wiring: react to `routeRequest`, call `computeConnectorRoute`, dispatch
  results; recompute debounce + generation-id bookkeeping.
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

- Exact default values for `APPROACH_NEAREST_MARGIN_M`, `DETOUR_RATIO`,
  `DETOUR_ABS_CAP_M`, `RECOMPUTE_MIN_MS`, `RECOMPUTE_MIN_MOVE_M`,
  `HANDOFF_RADIUS_M` — start from the values noted here and tune in the
  simulate-ride harness on real-ish tracks.
- Whether to surface "rerouting…" text during the `routing` status or rely on the
  Phase A arrow alone (lean: brief "מחשב מסלול…" only if compute exceeds ~1 s).
