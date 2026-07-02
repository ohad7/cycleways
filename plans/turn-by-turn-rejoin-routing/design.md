# Approach-to-Route Guidance (Rejoin Routing, redesigned)

**Date:** 2026-06-30
**Status:** design approved; supersedes the previously implemented Phase B
turn-by-turn connector. No live behaviour is lost — Phase B device acceptance
was still pending when this redesign was approved.
**Builds on:** `plans/turn-by-turn-improvements/` (Phase A shipped: acquisition
state, segment context, smoothed puck/camera, off-route/approach arrow +
distance, replay + simulate-ride harnesses).

## Why this redesign

The previous Phase B added **turn-by-turn rejoin navigation**: an on-device
connector route from the rider to the route, narrated with maneuver cues, voice,
follow-camera, a seeded-progress handoff, and recompute-thrash protection (see
"Superseded design" below).

On reflection this projected **navigation-grade confidence over an uncurated
path**. CycleWays is a *discovery / planning* product; the native app's
navigation role is *along* curated CycleWays routes, which we have vetted metre
by metre. The connector that gets a rider *to* a route is improvised on the OSM
base graph, which we have **not** vetted. Narrating authoritative "turn left"
over that path is the worst quadrant: high projected confidence, low actual
confidence.

The redesign keeps the value (help the rider reach the route) but matches
**confidence to role**: narrate only the vetted route; for the approach, *show*
a suggestion and offer a real navigation app, never *assert* it.

## Core principle

**Getting to a route is guidance, not navigation.** Turn-by-turn cues are
reserved for vetted CycleWays geometry. The approach is a spatial picture (a
line + distance + progress) plus an escape hatch to a dedicated navigation app.

## Tiered ladder

One coherent affordance with three presentations, selected by distance to the
target and shard coverage:

1. **On / at route** — turn-by-turn over CycleWays geometry (unchanged Phase A
   navigation).
2. **≤ 1 km from the target, within shard coverage** — the *approach view*:
   - a **direct line** from the current location to the target (thin/faint) —
     the persistent spatial anchor: "the route is over *there*";
   - a **dashed suggested connector** (heavier) computed on the base graph,
     weighted to **prefer high-class public roads** — "a way you might take";
   - **distance + live progress** ("X m to route, getting closer");
   - a **disclaimer**: navigating outside the CycleWays network;
   - a one-tap **"Open in Waze / Google Maps"** button.
3. **> 1 km, or off shard coverage** — same view with the suggested connector
   **suppressed** and the external-app button promoted to the primary action.
   The direct line + distance + disclaimer remain.

Tier 3 is tier 2 with the connector hidden and the external button emphasized —
not a separate code path. `CONNECTOR_NEAR_RADIUS_M = 1000` is an exported,
tunable constant.

## Target selection — ask the rider

Replaces the previous silent start-vs-nearest scoring with an explicit choice,
consistent with "give the rider the picture and let them decide."

- **Target candidates:** the route **start**, and the **nearest point along the
  route** (the nearest continuous projection onto the route polyline — *not* the
  geographic midpoint; the rider joins wherever they are closest, skipping the
  earlier portion).
- **Prompt only when meaningful.** On starting navigation while away from the
  route, if joining at the nearest point would skip more than
  `JOIN_SKIP_PROMPT_M` of route, prompt:
  - *"Start from the beginning"* (target = start), or
  - *"Join the route here (skip ~X km)"* (target = nearest point).
  Each option shows its own approach distance so the choice is concrete.
- If skipping is trivial (nearest point ≈ start), **don't prompt** — target the
  start.
- **Mid-ride rejoin** (already navigating, confirmed off-route) is not prompted:
  target the nearest projected point **ahead** of last-confirmed on-route
  progress (never backtrack), as before.

The chosen target drives everything downstream: the direct line, the suggested
connector, the external-app destination, and the progress readout.

## Suggested connector

Reuses the connector-compute core already built in the superseded Phase B,
because that part is sound and non-mutating:

- `ShardedRouteSession.computeConnector(from, to)` → `previewBaseRoute([from,
  to])` (snaps raw GPS before path-finding) → `{ geometry, distanceMeters,
  failure, snappedEndpoints }`.
- Non-mutating: preserves the planner's `baseRouteInfo` / `lastRouteFailure`
  across `ensureCoverage`; never commits or replaces the planner's active route.
- Exposed as a narrow bound capability from `useCyclewaysApp`.

**High-fidelity weighting (new).** Weight the base-graph edge cost to **strongly
prefer high-class public roads** (`highway`, `accessStatus`, `routeClass`),
falling back to paths/tracks only when no road option exists — rather than a
strict car-roads-only filter, which can fail to reach a path-only trailhead or
shove a cyclist onto an unsuitable highway. The disclaimer covers residual
uncertainty. A pure straight-line distance cap is not used to *reject* a
connector (a long detour usually means a real barrier).

The connector is a **suggestion only**: drawn dashed, never narrated. There are
no maneuver cues, no voice, no follow-camera, and no navigation-grade handoff —
"handoff" is simply: when the rider physically reaches the route, normal Phase A
turn-by-turn begins at that point.

## External-app handoff

Offer **both** apps so we need not decide ride-from-home vs drive-to-trailhead;
the rider picks the app matching their mode:

- **Google Maps** defaulting to **cycling** mode.
- **Waze** as the **car** option.

Use universal `https` deep links so the OS opens the installed app and falls back
to web / App Store otherwise. The destination is the selected target point
(start or nearest join point). This is the primary action in tier 3 and an
always-available secondary action in tier 2.

## What is cut vs. kept

**Cut from the implemented Phase B** (the navigation-grade connector):
- connector maneuver cue pipeline + haptics/voice-ready cues;
- follow-camera on the connector;
- seeded-progress handoff (`tracker.seed`, windowed search, accuracy-aware
  handoff radius);
- recompute-while-moving throttle/hysteresis and `requestId` cancellation churn
  for connectors (a single best-effort compute per target is enough for a
  suggestion);
- the orthogonal `on-connector` navigation status and connector tracker.

**Kept / reused:**
- `computeConnector`, `previewBaseRoute`, coverage preservation (non-mutating);
- target selection helpers (start vs nearest projection; nearest-ahead mid-ride);
- shard-coverage detection (drives the ≤1 km vs >1 km tier and tier-3 fallback);
- the Phase A direction sense (now expressed as the direct line + distance).

## Fallback

The approach view never strands the rider. If `computeConnector` fails (no path,
off-graph) or the rider is off shard coverage, that **is** tier 3: the suggested
connector is simply absent and the external-app handoff is primary. The direct
line + distance + disclaimer always render. A failure is logged once, not
spammed; the connector is retried best-effort as the rider moves into covered
area.

## UI summary

- **Direct line:** thin/faint current-location → target.
- **Suggested connector:** dashed, heavier, road-preferring; tier 2 only.
- **Readout:** distance to target + live progress; disclaimer line ("outside the
  CycleWays network").
- **Buttons:** "Open in Waze" / "Open in Google Maps" (primary in tier 3).
- **Start-vs-join prompt:** shown once at navigation start when joining partway
  skips a meaningful distance.
- If the two lines read as cluttered in device testing, fall back to the direct
  line alone; start with both.

## Testing

Node-tested pure logic:
- tier selection (distance + coverage → tier 1/2/3);
- target selection (start vs nearest projection; the skip-distance prompt
  threshold; nearest-ahead mid-ride window; never-backtrack);
- road-preference edge weighting (prefers high-class public roads; falls back to
  paths when no road path exists);
- non-mutating route preview + coverage preservation (planner snapshot identical
  before/after a connector that loads a shard);
- external-link construction (correct destination + per-app travel mode).

Device-verified:
- dashed suggested connector + direct line render and differentiate;
- the start-vs-join prompt and the chosen target;
- "Open in Waze / Google Maps" launches the right app at the right destination;
- tier transitions as the rider approaches/crosses 1 km and coverage edges;
- reaching the route begins Phase A turn-by-turn cleanly.

## Out of scope

- Voice/TTS for the approach (the connector is never narrated by design).
- Multi-candidate connector cost comparison (single from→to suggestion).
- Background/lock-screen location; Android.
- A second routing session / duplicate graph (the planner graph computes the
  connector without committing it).

## Open questions

- Final tuning of `CONNECTOR_NEAR_RADIUS_M` (≈1 km), `JOIN_SKIP_PROMPT_M`, and
  the road-preference weights, in the simulate-ride harness and on device.
- Whether both lines (direct + dashed) stay, or the direct line alone, after
  device readability testing.

---

## Superseded design (historical — implemented Phase B turn-by-turn connector)

The text below is the prior Phase B design (turn-by-turn rejoin navigation). It
is retained for context and to guide which already-written code is reused vs.
removed. It is **not** the current direction.

### Review revisions (2026-06-29) — Phase B

A code review of the first Phase B plan surfaced correctness blockers, verified
against the code:

1. **Router primitive:** compute connectors via a non-mutating
   `previewBaseRoute([from,to])` reusing `previewRouteInfo`'s snapping
   (`_snapRoutePoints` → `_calculateBaseRoute`) — NOT `_calculateBaseRoute`
   directly. Returns `{ geometry, distanceMeters, failure, snappedEndpoints }`.
   **(Reused.)**
2. **No planner mutation:** `ensureCoverage` → `mergeBaseRoutingNetwork` nulls
   `baseRouteInfo`; the connector capability preserves `baseRouteInfo` +
   `lastRouteFailure` across coverage extension. **(Reused.)**
3. **Orthogonal state:** `connector: { status, requestId, pendingTarget }`
   separate from `status`. **(Cut — no `on-connector` navigation state now.)**
4. **Session authoritative** for request ids, throttle, pending target, stale
   results. **(Cut — a suggestion needs a single best-effort compute.)**
5. **Seeded handoff:** `tracker.seed({ progressMeters, acquired })` + windowed
   search; hand off on accuracy-aware physical proximity. **(Cut — handoff is
   just physical arrival → Phase A.)**
6. **Continuous target projection** onto the polyline (reuse `projectToSegment`);
   mid-ride uses last-confirmed on-route progress; never target behind the rider.
   **(Reused for target selection.)**
7. **Detour acceptance, not ratio rejection:** accept by an absolute distance/time
   cap; do not reject a connector for routing around a barrier. **(Reused as the
   road-preference + no straight-line-ratio rejection rule.)**
8. **Differentiated retry** (transient I/O vs off-graph vs rejected target).
   **(Cut — best-effort retry on movement only.)**
9. **Lifecycle completeness** (off-connector recompute, early reacquire,
   stop-while-requesting, pause/resume restores prior phase, cue dedupe).
   **(Cut with the connector navigation phase.)**
10. **Single rider-position source** (`latestFix` in session state). **(Kept as a
    Phase A correctness fix regardless.)**
11. **Acceptance gate:** real simulator/device acceptance required. **(Still true
    for the redesigned approach view.)**

### Phase B motivation (historical)

After Phase A the rider could *see* the route and got an arrow + distance but had
to find their own way. Phase B added an on-device connector route with
turn-by-turn guidance to the route, a clean handoff back to the main route,
recompute-while-moving, and an arrow fallback. The redesign above retains the
connector *computation* but removes the turn-by-turn narration, recompute
machinery, and seeded handoff in favour of a suggestion + external-app handoff.
