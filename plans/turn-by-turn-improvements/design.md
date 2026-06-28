# Turn-by-Turn Navigation Improvements + Test Harnesses

**Date:** 2026-06-28
**Status:** design approved; implementation plan next
**Builds on:** `plans/rn-turn-by-turn-navigation/` (first-pass slice now runs on
device). This is the follow-up that addresses concrete issues seen while riding
and establishes a way to test navigation properly.

## Motivation

The first turn-by-turn slice runs on a real iPhone. Riding it surfaced three
concrete problems, and the whole native slice still has no repeatable test path
beyond node-level unit tests of the pure logic:

1. **No ride context.** While riding a CW network segment the app does not tell
   the rider which segment they are on or what the next segment is.
2. **Redundant + jumpy rider marker.** Two markers render — the raw GPS puck and
   the route-snapped point. The raw one is redundant, and the snapped one jumps
   abruptly per GPS fix instead of moving smoothly.
3. **No guidance to the route when far from it.** When the rider is away from the
   route (before reaching the start, or after drifting off) there is no
   instruction for how to get to it — only a bare "return to route" banner.

This design covers fixes for all three plus the groundwork for routed off-route
recovery, and two test harnesses so navigation can be exercised deterministically
and watched live.

## Scope decisions (from brainstorming, 2026-06-28)

- **Testing:** build a node GPS-track replay harness **(A)** first, then an in-app
  "simulate ride" dev mode **(B)**.
- **Ride context (issue 1):** show a persistent network-aware **context line** —
  current segment + next named segment + distance to it (option A).
- **Rider marker (issue 2):** one **directional puck**, smoothed along the route
  between fixes; hide the raw GPS puck while navigating (option A).
- **Off-route/approach guidance (issue 3):** ship the **arrow + distance**
  guidance now (Phase A, never fails), then layer **rejoin routing** on top
  (Phase B) using the existing on-device router, with Phase A as its fallback.

## Sequencing

1. Test harness A (node GPS-track replay) — built first so every later change
   lands with a deterministic regression test.
2. Segment-span data plumbing (foundation for issues 1 and 3B and the cue layer).
3. Issue 1 (context line), Issue 2 (single smooth directional puck), Issue 3
   Phase A (arrow + distance guidance).
4. Test harness B (in-app simulate-ride dev mode).
5. Issue 3 Phase B (rejoin routing), tuned in harness B.

## Architecture

### Foundation — segment-span index

The route authority (`packages/core/route-manager.js`) already knows segment
attribution per traversal: `edge.cwSegmentIds` with along-edge distances, merged
into the ordered route. This is **dropped at snapshot time** —
`snapshotRouteManager` only keeps bare `orderedCoordinates` plus a flat
`selectedSegments` name list with no position along the route.

Thread it through as an ordered **segment-span index**:

- **`route-manager` / `snapshotRouteManager` (`routeActions.js`):** emit
  `segmentSpans` alongside `geometry` — an ordered array of
  `{ startMeters, endMeters, name | null, cwSegmentId | null, onNetwork }`.
  Off-network stretches (regular roads / connectors) get `name: null`,
  `onNetwork: false`. Derived from the existing `traversals` + cumulative
  distance; no new routing math.
- **`navigationRoute.js`:** carry `segmentSpans` onto the `NavigationRoute`
  (immutable input, same as `geometry`).

This is pure data feeding issues 1, 3B, and the cue layer. Spans are contiguous
and cover `[0, totalMeters]`.

### Issue 1 — network-aware context line

- **`routeProgress.js`:** add `currentSpanIndex` and derive, from `segmentSpans`
  + `progressMeters` (cheap lookup off the existing forward cursor):
  - `currentSegmentName` (null when off-network)
  - `currentOnNetwork`
  - `nextSegmentName` (next span with a name)
  - `distanceToNextSegmentMeters` (to that span's `startMeters`)
- **`navigationCues.js`:** add an `enter-segment` cue type at named-segment span
  boundaries, scheduled like other cues (preview + final), deterministic and
  deduped. Falls out of `segmentSpans` directly.
- **`navigationPresentation.js`:** new `contextText` (Hebrew/RTL):
  - on-network: "On *<segment>* · next: *<next>* in <dist>"
  - off-network: "On local roads · next: *<next>* in <dist>"
  - no next named segment: drop the "next" clause.
- **`NavPanel.jsx`:** a persistent context line below the maneuver banner.
  Maneuver cues (turn/arrive/enter-segment) stay on the primary banner.

### Issue 2 — single, smooth, directional rider puck

- **`MapScreen.jsx`:** hide the raw RNMapbox `UserLocation` puck while navigating
  (keep it in planning mode); render only the snapped marker.
- The snapped marker becomes a **directional puck** oriented to
  `progress.bearingToNextDeg`.
- **Smooth motion:** instead of teleporting to `snappedPoint` per fix, interpolate
  `progressMeters` from the previous snapped value to the new one over the fix
  interval and place the puck by arc-length along the geometry, reusing the
  existing `routeDirectionAnimator` / `utils/geometry.js` arc-length helpers. The
  traveled (completed) line advances with the same interpolated value.
- This is native render/animation glue; the pure interpolation helper (progress →
  point + bearing along geometry) is node-testable.

### Issue 3 — off-route / approach guidance

**Phase A (now — arrow + distance):**

- **`routeProgress.js`:** alongside the existing `distanceToRouteStart` and
  snapped point, expose:
  - `bearingToRouteDeg` — bearing from the current fix to the target route point.
  - `targetKind` — `"start"` before on-route progress has begun, else
    `"nearest-ahead"` (nearest route point at or ahead of current progress).
- **`navigationPresentation.js` + `NavPanel.jsx`:** when off-route or approaching,
  replace the bare "return to route" banner with a **rotating arrow** (oriented to
  `bearingToRouteDeg` relative to rider heading/course) + distance + text
  ("Head to start · 400 m" / "Route 250 m →"). Hebrew/RTL.
- No routing — pure bearing + distance. Honors design D5 ("guidance, not
  rerouting") and never fails.

**Phase B (later — rejoin routing, layered on Phase A):**

The on-device router already routes between arbitrary points and lazily loads the
shards covering them (`ShardedRouteSession.ensureCoverage` → `addPoint` /
`recalculatePoints`). Rejoin routing reuses it:

- **Target-point selection:** rejoin at the nearest route point that is *ahead* of
  current progress, sanity-checked against detour length (reject when the by-road
  detour is implausibly larger than the crosstrack — avoids backtracking and
  across-barrier targets).
- **Nested connector session:** the connector is its own mini-route with its own
  progress tracking, its own turn cues, a distinct visual style (dashed line), and
  a **handoff** — on reaching the rejoin point, drop the connector and resume the
  main route's progress at the right offset.
- **Recompute-while-moving:** throttled + hysteresis-gated so instructions do not
  thrash on GPS jitter (this is the "auto-rerouting while moving" D5 flagged as
  risky; gate it carefully).
- **Fallback:** when routing fails (no path, off-graph location, missing offline
  shard for the current area), fall back to Phase A's arrow + distance.

Phase B's hardest parts (target selection, handoff, recompute thrash) are tuned in
harness B; the pure pieces (target selection, handoff offset) are tested in
harness A.

### Test harness A — node GPS-track replay (built first)

- **Track generator (pure):** synthesize a fix stream from a route's geometry —
  sample at a target speed + update interval, optional positional jitter, optional
  off-route excursions, and an optional start-approach lead-in (fixes before the
  route start). Deterministic from a seed. Also accepts a real recorded track
  (`{ lat, lng, accuracy?, heading?, speed?, timestamp }[]`).
- **Replay runner (pure):** drives the real `createNavigationSession` fix-by-fix
  and records the resulting state timeline (progress, segment context, active cue,
  off-route, guidance, cue events).
- **Assertions (in `npm test`):**
  - monotonic progress under jitter
  - off-route enter/recover timing and accuracy inflation
  - segment-context transitions (current/next at the right distances)
  - cue ordering / scheduling / dedupe, including `enter-segment`
  - approach-state numbers (distance + bearing to start)
  - Phase B: connector target selection + handoff offset

### Test harness B — in-app "simulate ride" dev mode (built second)

- A dev-only toggle that feeds a generated/recorded track into
  `useNavigationSession` in place of `expo-location`, swapping the location source
  behind the existing watch interface so the session cannot tell the difference.
- Lets the developer watch live: camera follow, the smooth directional puck, the
  context line, cue banners, the off-route arrow, and (later) rejoin routing.
- This is where issues 2, 3A, and 3B are visually tuned.
- Gated behind a dev flag; never present in production builds.

## Data / code boundaries

Shared/core (`@cycleways/core`, node-tested):

- `segmentSpans` emission in route snapshot + `NavigationRoute`
- segment-context fields in `routeProgress`
- `enter-segment` cues
- `contextText` + guidance fields in `navigationPresentation`
- Phase A guidance fields (`bearingToRouteDeg`, `targetKind`) in `routeProgress`
- the arc-length progress→point+bearing interpolation helper
- Phase B target-selection + handoff logic (pure parts)
- track generator + replay runner

Native app:

- hide raw puck while navigating; directional smoothed puck render
- context line + guidance arrow in `NavPanel`
- simulate-ride dev source behind the location watch interface
- Phase B connector rendering (dashed line) + recompute throttling glue

Web: unchanged (no navigation mode).

## Out of scope

- Voice/TTS cues (still deferred per the parent plan).
- Background/lock-screen location (still foreground-only for now).
- Android.
- Automatic rerouting beyond the scoped Phase B rejoin routing.

## Open questions

- Phase B detour-sanity threshold (ratio of by-road detour to crosstrack) — tune
  in harness B with real tracks.
- Whether `enter-segment` cues need a minimum span length to avoid spam on short
  segments (likely reuse the existing turn-spacing gate).
