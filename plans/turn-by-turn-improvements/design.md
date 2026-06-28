# Turn-by-Turn Navigation Improvements + Test Harnesses

**Date:** 2026-06-28 (revised same day after a code review of the first draft)
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

A code review of the first draft confirmed a deeper root cause behind #1–#3: the
session behaves like a route-progress demo, not dependable navigation. In
particular the tracker advances progress and reports `onRoute` from the very
first fix even when the rider is far away (`routeProgress.js` global
`findNearest` on acquisition + dwell-gated off-route), and the camera follows
Mapbox's raw GPS puck while the custom marker follows the snapped point, so they
disagree. This revision folds those corrections in.

## Scope decisions

From brainstorming (2026-06-28):

- **Testing:** build a node GPS-track replay harness **(A)** first, then an in-app
  "simulate ride" dev mode **(B)**.
- **Ride context (issue 1):** show a persistent network-aware **context line** —
  current segment + next named segment + distance to it.
- **Rider marker (issue 2):** one **adaptive** puck, smoothed; hide the raw GPS
  puck while navigating.
- **Off-route/approach guidance (issue 3):** ship **arrow + distance** guidance
  now (Phase A, never fails). Routed rejoin (Phase B) is deferred to its own
  later design — not in this slice.

From the code review (2026-06-28), additionally:

- Add an **explicit route-acquisition state** (`approaching → on-route →
  off-route`); suppress progress/cues until the route is acquired.
- The puck must be **adaptive** (snapped on-route, real GPS off-route), and the
  **camera must be smoothed too**, driven from our own position rather than
  Mapbox `followUserLocation`.
- Spans must carry road class and reconcile to the geometry's distance frame, and
  the propagation surface is broader than the first draft stated.
- Improve maneuver quality (merge turn+segment, cue priority, haptic gating), not
  only add segment context. Full junction-vs-bend classification stays out of
  scope.
- Surface the already-computed **wrong-way** state in the UI.

## Sequencing

1. Test harness A — replay runner first, then a real-ride fixture, then the
   synthetic generator (built before the fixes so each change lands with a test).
2. Route-acquisition state machine + progress/cue suppression until acquired.
3. Segment-span data plumbing (foundation for issue 1 and the cue layer).
4. Issue 1 (context line) + maneuver-quality cue improvements.
5. Issue 2 (single adaptive smoothed puck + smoothed camera).
6. Issue 3 Phase A (arrow + distance guidance) + wrong-way presentation.
7. Test harness B (in-app simulate-ride via injected location source).
8. (Later, separate design) Issue 3 Phase B — routed rejoin.

## Architecture

### Route-acquisition state machine (correctness foundation)

Today the tracker advances progress from the first fix regardless of distance,
and the session reports `navigating`/`onRoute` immediately; off-route only trips
after a dwell. A first fix hundreds of metres away therefore shows false
progress on the route. Fix this before layering UI on top.

- **`routeProgress.js`:** add an acquisition gate.
  - `hasAcquiredRoute` — false until the rider is within the on-route threshold of
    the geometry; while false, do **not** advance `progressMeters` or move the
    cursor, and expose an `approaching` posture.
  - Guidance outputs (used by issue 3A and the puck/camera):
    `guidanceTargetPoint`, `guidanceTargetProgressMeters`, `guidanceDistanceMeters`,
    `guidanceBearingDeg`. Target is the route start while `approaching`, else the
    nearest route point at/ahead of current progress.
  - Once acquired, a later sustained departure is `off-route` (existing
    hysteresis), not a return to `approaching`.
- **`navigationSession.js`:** add an `approaching` status distinct from
  `navigating`/`off-route`. Suppress route cues and progress-derived UI while
  `approaching`; emit guidance instead.

### Foundation — segment-span index

The route authority (`packages/core/route-manager.js`) already knows segment
attribution per traversal: `edge.cwSegmentIds` (and road class) with along-edge
distances, merged into the ordered route. This is **dropped at snapshot time** —
`snapshotRouteManager` keeps only bare `orderedCoordinates` plus a flat
`selectedSegments` name list with no position along the route.

Thread an ordered **segment-span index** through the pipeline:

- Shape: ordered `{ startMeters, endMeters, name | null, cwSegmentId | null,
  onNetwork, routeClass }`. Off-network stretches get `name: null`,
  `onNetwork: false`, with `routeClass` preserved (track / path / road / …).
  Contiguous, covering `[0, totalMeters]`.
- **Distance-frame reconciliation (required).** `NavigationRoute.geometry`
  recomputes `distanceFromStartMeters` by haversine over the reconstructed
  vertices (`navigationRoute.js` `buildNavigationGeometry`), which differs from
  traversal edge lengths. Span `startMeters`/`endMeters` MUST be expressed in the
  **same haversine frame as the geometry** (e.g. map span boundaries to geometry
  vertex indices, then read their `distanceFromStartMeters`) — never raw edge
  lengths — or the context-line distances drift.
- **Propagation surface (broader than it looks).** `segmentSpans` must be added
  to every place that currently enumerates route fields individually:
  - `route-manager` `getRouteInfo`
  - `snapshotRouteManager` and the empty/cleared snapshot
    (`routeActions.js`)
  - `routeStateSnapshot` (undo/redo) (`routeActions.js`)
  - reducer `route/update` and `route/clear` + `initialRouteState`
    (`routeReducer.js`)
  - `NavigationRoute` (`navigationRoute.js`)
  - any native memo dependency lists that key off route fields
- This is pure data feeding issue 1 and the cue layer.

### Issue 1 — network-aware context line + maneuver quality

Context line:

- **`routeProgress.js`:** add `currentSpanIndex` and derive (cheap lookup off the
  cursor): `currentSegmentName` (null off-network), `currentOnNetwork`,
  `currentRouteClass`, `nextSegmentName`, `distanceToNextSegmentMeters`.
- **`navigationPresentation.js`:** `contextText` (Hebrew/RTL):
  - on-network: "On *<segment>* · next: *<next>* in <dist>"
  - off-network: use the road class or neutral copy — "On a <class>" /
    "Connector section" — **not** a blanket "local roads" (it may be a track,
    path, or larger road).
  - no next named segment: drop the "next" clause.
- **`NavPanel.jsx`:** persistent context line below the maneuver banner.

Maneuver quality (this slice):

- **`navigationCues.js`:** add an `enter-segment` cue at named-segment span
  boundaries, but with cue **priority + merge/suppress** rules:
  - Merge a turn coincident with a segment boundary into one cue ("turn right onto
    *X*") instead of emitting both.
  - Explicit cue-type priority (turn/arrive > enter-segment) so a maneuver wins.
  - Suppress a standalone `enter-segment` cue when a turn cue is within the
    spacing window (reuse the existing turn-spacing gate).
- **`cueHaptics.js`:** gate haptics by cue type — do **not** vibrate on every plain
  segment transition (currently any `cue` event buzzes). Haptics fire for turns,
  arrival, off-route, and merged turn-onto-segment cues; plain `enter-segment`
  is visual-only.
- **Out of scope:** full graph-junction-vs-bend classification (distinguishing a
  real decision point from a curved road). Spans retain `cwSegmentId`/`routeClass`
  so this can be a later project; turn cues remain geometry-bend based for now.

### Issue 2 — one adaptive, smoothed rider puck + smoothed camera

- **`MapScreen.jsx`:** hide the raw RNMapbox `UserLocation` puck while navigating
  (keep it in planning mode); render a single custom puck.
- **Adaptive position:** on-route → smoothed **snapped** position; approaching /
  off-route → smoothed **real GPS** position (snapping off-route would falsely show
  the rider on the line).
- **Orientation:** rider course/heading; fall back to route bearing
  (`bearingToNextDeg`) only when course is unavailable (stopped / low speed). The
  Phase-A guidance arrow is a **separate** indicator from puck orientation.
- **Smoothed camera:** the camera currently follows Mapbox raw GPS
  (`followUserLocation`) while the marker follows snapped progress, so they
  disagree and the map stays jumpy. Drive the camera from the **same smoothed
  position** as the puck (programmatic `setCamera`), not `followUserLocation`.
- **Smoothing policy (must be specified, not "interpolate over the interval"):**
  - Add a pure `pointAndBearingAtDistance(arc, geometry, meters)` helper (extract
    the animator's currently-private interpolation; the animator and the puck both
    consume it).
  - Clock-driven tween of progress (on-route) or position (off-route) toward the
    latest fix with a **bounded duration** (cap so a delayed/missing fix doesn't
    cause a long glide; snap if the gap is too large).
  - **Small-regression suppression:** ignore tiny backward progress from jitter;
    a large implausible jump snaps rather than animates.
  - **Bearing rotation** takes the shortest path across the 0°/360° wrap.
  - **Pause/resume and off-route transition** stop/restart the tween cleanly
    (no glide while paused; switch position source on the on-route↔off-route edge).
  - The pure helper + policy decisions are node-testable; only the RAF/clock glue
    is native.

### Issue 3 — off-route / approach guidance (Phase A only here)

- Uses the acquisition state's guidance outputs (`guidanceDistanceMeters`,
  `guidanceBearingDeg`, target kind).
- **`navigationPresentation.js` + `NavPanel.jsx`:** while `approaching` or
  `off-route`, show a **rotating arrow** (oriented to `guidanceBearingDeg` relative
  to rider course) + distance + text ("Head to start · 400 m" / "Route 250 m →"),
  replacing the bare "return to route" banner.
- **Wrong-way:** surface the tracker's existing `wrongWay` output (e.g. "You're
  going the wrong way — turn around") — currently computed and ignored.
- No routing; pure bearing + distance. Honors design D5 ("guidance, not
  rerouting") and never fails.

**Phase B (routed rejoin) is deferred to a separate design** after this slice is
ride-tested. It needs a dedicated non-mutating router/session (must not reuse the
planner's mutable routing session), cancellation of stale async recomputes,
recompute generation IDs, target scoring, and handoff semantics — substantially
more than the rest of this work, and best designed once acquisition, context,
puck/camera, guidance, and the simulator are proven on a ride.

### Test harness A — node GPS-track replay (built first)

Order within the harness (per review): runner → real fixture → fix invariants →
synthetic generator.

- **Replay runner (pure):** drives the real `createNavigationSession` fix-by-fix
  and records the resulting state timeline (status, progress, segment context,
  active cue, guidance, off-route, wrong-way, cue events).
- **Real-ride fixture:** at least one anonymized recorded ride
  (`{ lat, lng, accuracy?, heading?, speed?, timestamp }[]`) with expected
  milestones. Real GPS timing, accuracy, pauses, and jumps are where the bugs
  live — synthetic tracks alone miss them.
- **Synthetic track generator (pure):** sample a fix stream from a route's
  geometry — target speed + update interval, optional jitter, off-route
  excursions, and an approach lead-in (fixes before the start). Deterministic
  from a seed.
- **Assertions (in `npm test`):**
  - acquisition: no progress/route-cues until acquired; correct approach guidance
    distance + bearing
  - monotonic progress under jitter once acquired; small-regression suppression
  - off-route enter/recover timing + accuracy inflation; wrong-way detection
  - segment-context transitions (current/next at the right distances)
  - cue ordering / scheduling / dedupe, priority, turn+segment merge, suppression
  - `pointAndBearingAtDistance` correctness incl. bearing wrap

### Test harness B — in-app "simulate ride" dev mode (built second)

- **Inject a `locationSource` into `useNavigationSession`** (the simulator
  supplies fixes through the same watch interface as `expo-location`) rather than
  branching on a dev mode inside the hook — the session cannot tell the
  difference and production code stays clean.
- Feed a generated or recorded track; watch live: acquisition/approach, camera
  follow, the adaptive smoothed puck, the context line, cue banners, the off-route
  arrow, wrong-way.
- **Dev recorder/export:** capture the live fix stream so a real on-device failure
  can be exported and replayed as a harness-A fixture.
- Gated behind a dev flag; never present in production builds.

## Data / code boundaries

Shared/core (`@cycleways/core`, node-tested):

- acquisition gate + guidance outputs in `routeProgress`; `approaching` status in
  `navigationSession`
- `segmentSpans` emission + propagation + distance-frame reconciliation
- segment-context fields in `routeProgress`
- `enter-segment` cues + priority/merge/suppression; haptic gating in `cueHaptics`
- `contextText` + guidance + wrong-way strings in `navigationPresentation`
- pure `pointAndBearingAtDistance` + smoothing policy decisions
- replay runner + synthetic track generator

Native app:

- hide raw puck while navigating; single adaptive smoothed puck
- camera driven from the smoothed position (not `followUserLocation`)
- context line + guidance arrow + wrong-way in `NavPanel`
- injected `locationSource` + simulate-ride dev source + dev recorder/export

Web: unchanged (no navigation mode).

## Out of scope

- Routed rejoin (Phase B) — separate later design.
- Graph-junction-vs-bend maneuver classification — later project.
- Voice/TTS cues (still deferred per the parent plan).
- Background/lock-screen location (still foreground-only).
- Android.

> Note: without voice and background operation this slice still requires looking
> at the screen and is not yet hands-free navigation; those remain separate
> follow-ups.

## Open questions

- Acquisition threshold/dwell for declaring the route "acquired" vs the existing
  off-route enter threshold — tune in harness A/B.
- Whether `enter-segment` cues need a minimum span length beyond the existing
  turn-spacing gate to avoid spam on short segments.
- Off-network context copy taxonomy (which `routeClass` values map to which
  Hebrew phrasing) — settle with a small fixture set.
