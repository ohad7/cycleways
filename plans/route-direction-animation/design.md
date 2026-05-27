# Route Direction Animation Design

## Goal

Give users a fast, unmistakable visual cue for the **direction of travel**
along a route — and reinforce the mental link between the route shown on the
map and the elevation graph below it (left = start, right = end).

The cue should:

- play on initial load of a shared `?route=…` URL;
- play whenever the user composes or edits a route that has ≥ 2 points;
- be **subtle** — bounded in time, never running while the user is reading
  or planning;
- be **cheap** — no perceptible jank on the map, no continuous CPU cost
  after the cue finishes;
- visually couple the map and the elevation graph so that "start → end" on
  the map and "left → right" on the graph become one motion in the user's
  perception;
- handle routes whose travel direction reverses mid-route (out-and-back
  loops, segments traversed in their "reverse" direction) without any
  special-casing in the trigger.

## Current Shape

The public React app stores the active route in a reducer-backed
`routeState`:

- `routeState.geometry` — array of `{lng, lat, elevation}` points,
  assembled in **user-travel order** by `routeActions.js`. When a cycleway
  segment is traversed in its reverse natural direction, its coordinates
  are flipped before being concatenated, so iterating `geometry[0..N]`
  always walks the path the user will ride.
- `routePoints` — the user-defined waypoints (1-based to the user, 0-based
  in code).
- `routeState.elevationGain` / `Loss` — summary numbers shown in the
  route panel.

The map (`src/map/MapView.jsx` + `src/map/mapLayers.js`) renders the route
geometry as a Mapbox `line` layer (`#006699`, width 5) and route points as
a Mapbox `circle` layer (`#ff4444`, radius 4–5, white stroke).

The elevation graph (`ElevationProfile` inside
`src/components/RoutePanel.jsx`) is a small SVG that the user can hover to
drop a marker on the map (`mapUi.elevationHover`). The graph already
implicitly runs start (left) → end (right).

The route enters the app either via `?route=<encoded>` (decoded in App's
init effect and committed via `dispatchRoute({type: "route/update", …})`)
or via clicks on the map during compose, which `dispatchRoute(...)` after
each successful routing call.

## UX Decisions

**Animation style — single chevron-trio pulse.** One group of three
triangles (leading triangle at 0.95 opacity, trailing two at 0.55 and
0.25) slides from start to end along the route. No continuous chevron
stream, no per-edge arrows on the line itself. The pulse is visible only
during the burst — never permanent.

**Per-point cue — stationary dot with brief glow and tiny number.** Each
route-point dot stays at its normal size and position. When the chevron
pulse reaches a point, the dot glows gold (`#ffd54a` halo) for ~500 ms
and a tiny 1-based number fades in inside the dot for the same window.
After the burst, every dot returns to its baseline red appearance with no
number — nothing clutters the map.

**Lifecycle — bounded burst of two cycles.** A trigger plays cycle 1,
pauses for 1.2 s, then plays cycle 2, then stops completely. Total burst
length depends on route length (see *Cycle timing* below); for typical
routes the whole burst is ~10 s.

**Elevation graph coupling — synced moving marker.** A thin gold
vertical line slides across the elevation graph SVG left → right in
lockstep with the chevron's progress. Same clock, same `t`, no
independent timeline. During the 1.2 s gap and after `done`, the marker
is hidden.

**Triggers.** A burst starts on:

- initial load of a `?route=…` URL once the geometry is restored;
- any commit to `routeState.geometry` after composition that leaves
  `routePoints.length ≥ 2` — adds, removes, undo/redo, and drag-end all
  qualify;
- emphatically *not* during an active drag.

If a new trigger fires while a burst is in flight, the in-flight burst is
cancelled and a fresh burst starts from cycle 1 using the new geometry.
There is no queueing; rapid clicks during compose just keep restarting.

**Reduced motion.** When `window.matchMedia('(prefers-reduced-motion:
reduce)').matches`, the chevron and elevation marker are skipped
entirely. Instead, each route-point dot lights up sequentially (200 ms
each, ~500 ms glow window each) to convey order without movement.

## Architecture

One new module plus targeted edits to three existing files.

### New: `src/map/routeDirectionAnimator.js`

A small framework-free factory:

```js
const animator = createRouteDirectionAnimator();
animator.trigger(geometry, routePointIndices);
const unsubscribe = animator.subscribe("chevron", ({lng, lat, bearing}) => …);
animator.dispose();
```

Exposed surface:

- `trigger(geometry, routePointIndices)` — cancels any in-flight burst,
  precomputes arc-length and per-route-point `t`, schedules `cycle1 →
  gap → cycle2 → done`, kicks off RAF. `routePointIndices` is an array
  of indices into `geometry` (already-snapped — see *Triggering* below).
- `subscribe(channel, cb)` — `channel ∈ {"chevron", "litPoint",
  "elevation"}`. Returns an unsubscribe function.
- `cancel()` — stops RAF, fires each channel once with the "hidden"
  payload (`null` for chevron and elevation, `null` for litPoint) so
  consumers can clear overlays. Idempotent.
- `dispose()` — `cancel()` plus drop all subscribers. Called on App
  unmount.

The animator has zero dependencies on React, Mapbox, or the DOM beyond
`requestAnimationFrame` and `performance.now`. This makes it cheap to
unit-test with an injected fake clock.

### Modified: `src/App.jsx`

- Create the animator once with
  `const animatorRef = useRef(); if (!animatorRef.current)
  animatorRef.current = createRouteDirectionAnimator();`
- Add a single `useEffect` keyed on
  `[routeState.geometry, routePoints, isDragging]` that:
  - short-circuits while `isDragging === true`;
  - short-circuits when `routeState.geometry.length < 2` or
    `routePoints.length < 2` (and additionally calls
    `animator.cancel()` if a burst was in flight, so overlays clear);
  - otherwise computes `routePointIndices` by snapping each
    route-point's lng/lat to the nearest geometry vertex (reuses the
    haversine-distance helper used by elevation hover) and calls
    `animator.trigger(geometry, routePointIndices)`.
- Pass `animator` down to `MapView` and through `RouteDescription` to
  `ElevationProfile`. (Both already receive other shared state via
  props, so this is consistent with the surrounding style.)
- On unmount, the existing top-level cleanup effect calls
  `animator.dispose()`.

### Modified: `src/map/MapView.jsx`

Two new `useEffect`s, both gated on `status === "ready"`:

1. **Chevron subscription.** Creates a single `mapboxgl.Marker` whose
   element is a tiny inline SVG of the three triangles (~24 × 16 px),
   `pointer-events: none`, `mix-blend-mode: screen`. On each callback,
   either `marker.setLngLat([lng,lat])` and rotate via
   `element.style.transform = 'rotate(<bearing>deg)'`, or
   `element.style.display = 'none'` for the hidden payload. Marker is
   created on the first non-null payload and reused for the map's
   lifetime. On effect cleanup, `marker.remove()`.

2. **Lit-point subscription.** Receives `{lng, lat, index}` (where
   `index` is 0-based) or `null` from the animator. Calls
   `syncRouteDirectionLitPointLayer(map, {...point, displayIndex: index + 1})`
   from `mapLayers.js`. The helper stores `displayIndex` as the
   feature's `index` property so the text layer's `["get", "index"]`
   renders the 1-based number the user expects. Layer registration is
   idempotent and lazy (created on first invocation, after the map is
   ready).

Both effects unsubscribe on cleanup.

### Modified: `src/map/mapLayers.js`

Add:

- `ROUTE_DIRECTION_LIT_POINT_SOURCE_ID = "route-direction-lit-point"`
- `ROUTE_DIRECTION_LIT_POINT_CIRCLE_LAYER_ID = "route-direction-lit-point-circle"`
- `ROUTE_DIRECTION_LIT_POINT_TEXT_LAYER_ID = "route-direction-lit-point-text"`
- `syncRouteDirectionLitPointLayer(map, point)` — creates the source and
  both layers on first call, updates `setData` on subsequent calls.
- `clearRouteDirectionLitPointLayer(map)` — symmetric teardown.

Layer styles:

- Circle: `circle-radius: 5`, `circle-color: "#ff4444"`,
  `circle-stroke-color: "#ffd54a"`, `circle-stroke-width: 3`,
  `circle-blur: 0.4`. Stacked just above `ROUTE_POINTS_LAYER_ID` in the
  layer order so it visually replaces the normal dot while lit.
- Text: `text-field: ["get", "index"]`, `text-font: ["Open Sans Bold"]`,
  `text-size: 9`, `text-color: "#ffffff"`, `text-allow-overlap: true`,
  `text-ignore-placement: true`.

### Modified: `src/components/RoutePanel.jsx` (`ElevationProfile`)

- Accepts a new `animator` prop.
- Adds a `<line>` element inside the existing `<svg>`, ref'd, with
  `stroke: #ffd54a`, `stroke-width: 0.6`, `stroke-linecap: round`,
  `pointer-events: none`, initial `opacity: 0`. Vertical: `y1=0`,
  `y2=100`.
- A `useEffect` subscribes to the `"elevation"` channel. The callback
  imperatively sets `x1`/`x2`/`opacity` on the line via the ref — no
  React state changes, no re-render of the elevation profile. On
  unsubscribe, reset `opacity` to 0.

## Animator Internals

### Burst state machine

```
        trigger()              t == 1            elapsed gap
idle ──────────────► cycle1 ────────────► gap ──────────────► cycle2 ──┐
                       ▲                                                │
                       └──────── trigger() (cancel-and-restart) ────────┘
                                                                        │
                                                              t == 1   ▼
                                                        done ◄───────  (last frame fires hidden payload)
```

| State    | Duration                 | Behavior                                              |
|----------|--------------------------|-------------------------------------------------------|
| `cycle1` | `cycleDuration` (3–7 s)  | Chevron traverses 0 → 1; elevation marker tracks it.  |
| `gap`    | 1.2 s fixed              | All overlays hidden via `null` payload.               |
| `cycle2` | `cycleDuration` (same)   | Repeat cycle 1.                                       |
| `done`   | ∞                        | All overlays hidden; RAF stops.                       |

`cycleDuration` is computed **once at `trigger()` time** as:

```
cycleDuration = clamp(totalDistanceKm * 0.25 + 2.0, 3.0, 7.0)  // seconds
```

The duration is captured at trigger time so cycle 2 always matches
cycle 1's rhythm even if a brand-new trigger would have produced a
different duration (the new geometry's duration applies to the *next*
burst, not the in-flight one). `totalDistanceKm` is the cumulative
arc-length of the geometry.

`trigger()` always resets the state machine to the start of `cycle1` and
re-arms RAF.

### Arc-length parameterization

At `trigger()`, precompute:

- `cumDist[i]` — cumulative haversine distance from `geom[0]` to `geom[i]`,
  for `i ∈ [0, N-1]`.
- `totalDist` = `cumDist[N-1]`.
- `routePointTs[k]` = `cumDist[routePointIndices[k]] / totalDist`.

On each RAF frame in `cycle1` or `cycle2`:

- `t = elapsedInCycle / cycleDuration`, clamped to `[0, 1]`.
- `targetDist = t * totalDist`.
- Binary-search `cumDist` to find `i` such that
  `cumDist[i] ≤ targetDist < cumDist[i+1]`.
- `localFrac = (targetDist - cumDist[i]) / (cumDist[i+1] - cumDist[i])`.
- Chevron position: lerp lng/lat between `geom[i]` and `geom[i+1]` by
  `localFrac`.
- Chevron bearing: bearing of `(geom[i] → geom[i+1])`, computed once per
  segment.

This gives constant *visual* speed regardless of how densely the
geometry is sampled, which matters because the routing engine produces
non-uniform sampling (more vertices around turns).

### Lit-point detection

A point at `routePointTs[k]` is considered "lit" during
`abs(t - routePointTs[k]) < 0.5 / cycleDuration` (i.e., within a
~500 ms window centered on the chevron's pass). At any frame, the lit
point is the *highest-index k* satisfying that condition (so overlapping
windows on tightly-spaced points still resolve to one lit dot).

The animator tracks the previously-lit index and only fires the
`"litPoint"` callback when it changes — so the GeoJSON `setData` runs ~4
times per cycle, not per frame.

The hidden payload for `"litPoint"` is `null` and is fired exactly once
per state transition into `gap` or `done`.

### Direction changes within a route

Because `geometry` is in user-travel order, no special handling is
needed. As the chevron walks the indices in order:

- A **forward/reverse segment mix** is invisible to the animation —
  segment coordinates were already flipped during route assembly.
- An **out-and-back loop** (point A → far point B → back near A) causes
  the chevron to physically reverse course because the geometry doubles
  back on itself; bearing flips ~180° at the U-turn.
- A **sharp hairpin** causes a fast bearing rotation through one frame.
  v1 does no bearing smoothing — the hook is in place
  (`bearing` is computed per segment) to add interpolation later if it
  proves visually jarring in practice.

### Reduced-motion mode

`createRouteDirectionAnimator()` reads
`window.matchMedia('(prefers-reduced-motion: reduce)').matches` once
during construction. If true, `trigger()` behaves as follows:

- The chevron and elevation channels are never invoked (consumers see
  no payloads, neither showing nor hiding).
- The litPoint channel fires sequentially: index 0 for 500 ms, then index
  1 for 500 ms, etc., with a 200 ms dark gap between each. After the
  last point, fires `null` and stops.
- Total duration ≈ `routePoints.length * 0.7 s`. Still bounded, no
  cycle 2.

## Triggering: App-level effect

```js
useEffect(() => {
  const animator = animatorRef.current;
  if (!animator) return;
  if (isDragging) return;

  const { geometry } = routeState;
  if (!Array.isArray(geometry) || geometry.length < 2 || routePoints.length < 2) {
    animator.cancel();
    return;
  }

  const routePointIndices = snapRoutePointsToGeometry(routePoints, geometry);
  animator.trigger(geometry, routePointIndices);
}, [routeState.geometry, routePoints, isDragging]);
```

`snapRoutePointsToGeometry` is a small helper added in App alongside
the existing `buildElevationProfile`. It uses
`haversineDistance` from `utils/distance.js` to find, for each
route-point, the index of the geometry vertex with minimal great-circle
distance. No existing helper in the repo does this — `findClosestElevationPoint`
in App operates on a precomputed `xPercent` axis, not lng/lat — so this
is new code (~10 lines). We do not factor it into `utils/` until a
second consumer appears.

`isDragging` is tracked via the existing
`onRoutePointDragStart` / `onRoutePointDragEnd` callbacks, lifted into
local state. Drag-end naturally re-triggers because the route geometry
is recomputed and committed at the end of the drag.

## Edge Cases

| Case | Behavior |
|------|----------|
| `geometry.length < 2` | App effect calls `animator.cancel()`; overlays cleared; nothing animates. |
| `routePoints.length < 2` | Same as above — direction is undefined with a single point. |
| Trigger mid-burst | In-flight burst cancels; fresh burst starts at `cycle1` against new geometry. |
| Route cleared (geometry → `[]`) | App effect short-circuits, calls `cancel()`; layers and marker cleared. |
| Component unmount during burst | App's cleanup calls `animator.dispose()`; `MapView`'s cleanups remove marker and clear layers; `ElevationProfile`'s cleanup resets the line opacity. |
| Map not yet `ready` when geometry arrives | `MapView`'s subscriptions register only after `status === "ready"`. The animator only invokes callbacks on currently-subscribed channels — if no subscriber exists at trigger time, frames advance silently. The first frame after `MapView` subscribes renders at the correct position. The lit-point GeoJSON layer is registered lazily by `syncRouteDirectionLitPointLayer` on first invocation, so it cannot be created before the map is ready. |
| `prefers-reduced-motion` toggled mid-session | We capture the value at animator construction (App mount). Live toggling won't switch modes until reload. Acceptable for v1. |
| Tab backgrounded mid-burst | RAF naturally pauses. On resume, the animator checks `now - burstStartTime`; if elapsed exceeds total burst duration, transitions immediately to `done` and fires hidden payloads. Avoids a "catch-up jump". |
| Geometry with zero-length segments (duplicate consecutive points) | Skipped during arc-length precomputation (`cumDist[i+1] === cumDist[i]`); bearing falls back to previous segment. |

## Performance

- One RAF loop, active only during the bounded burst. Total burst time = `2 × cycleDuration + 1.2 s` gap, so ≈ 7.2 s for tiny routes and ≈ 15.2 s for routes ≥ 20 km. After `done`, zero ongoing cost.
- Per-frame work: one binary search into `cumDist` (O(log N)), one
  `marker.setLngLat` + CSS rotate, one SVG attribute write on the
  elevation line. No Mapbox `setData` calls per frame.
- LitPoint updates: ~4 GeoJSON `setData` calls per cycle × 2 cycles +
  one clear on `gap` and on `done` ≈ 10 small calls per burst.
- Marker DOM created once per map instance; reused across bursts; hidden
  via `display: none` between bursts.
- Memory at trigger: `cumDist` is a `Float64Array(N)`, `routePointTs` is
  a `Float32Array(routePoints.length)`. Trivial for the routes typical
  to this app (hundreds to a few thousand geometry vertices).
- After `done`, the animator holds onto the geometry until the next
  `trigger()` overwrites it. No resource leak.

## Testing

A new `tests/test-route-direction-animator.mjs` exercises the animator
with an injected fake clock and fake RAF. It is added to the `test`
script chain in `package.json`. The animator is pure JS, so all the
heavy logic is testable without React or Mapbox.

Test cases:

- State machine progression: `cycle1 → gap → cycle2 → done` boundaries
  fire on the expected elapsed times for known cycle durations.
- Arc-length parameterization: chevron at `t = 0.5` lands at the
  midpoint of a non-uniformly sampled geometry (geometry constructed
  with most vertices clustered near one end).
- Cycle-duration formula:
  `clamp(distance × 0.25 + 2, 3, 7)` boundaries (0.5 km → 3, 10 km →
  4.5, 20 km → 7, 50 km → 7).
- LitPoint transitions: callbacks fire exactly once per index change;
  no duplicates inside the ±500 ms window for tightly-spaced points;
  `null` fires on entering `gap` and `done`.
- Cancel-and-restart: a `trigger()` mid-cycle stops prior callbacks
  cleanly (no leftover invocations after the new burst's first frame)
  and resets to `cycle1`.
- Direction reversal: an out-and-back geometry produces bearings that
  flip ~180° at the U-turn vertex.
- Reduced motion: chevron and elevation channels never fire; litPoint
  steps through indices with the documented 200 ms gap.
- Edge case: `geometry.length < 2` and zero-length consecutive segments
  do not throw.

The React glue (subscriptions in `MapView` and `ElevationProfile`) is
thin and is verified manually. The existing Playwright smoke
(`npm run test:smoke`) is extended **only if** it already exercises an
animation-bearing flow we can hook into without timing flakiness; if
expressing "marker moved after 5 s" cleanly is awkward, smoke is not
extended for this feature. The decision is documented in the
implementation plan, not deferred to the implementer at coding time.

## Files Touched

| File | Action |
|------|--------|
| `src/map/routeDirectionAnimator.js` | New, ~200 lines |
| `tests/test-route-direction-animator.mjs` | New, ~150 lines |
| `src/map/MapView.jsx` | Add animator prop, two subscription effects, marker management (~60 lines) |
| `src/map/mapLayers.js` | Add `syncRouteDirectionLitPointLayer` + `clearRouteDirectionLitPointLayer` + layer IDs (~40 lines) |
| `src/components/RoutePanel.jsx` | `ElevationProfile` accepts animator prop, renders synced `<line>`, subscribes (~20 lines) |
| `src/App.jsx` | Create animator ref, trigger effect, plumb to `MapView` and `RouteDescription` (~30 lines) |
| `package.json` | Add new test file to the `test` script chain |

Nothing else changes. No new dependencies. No schema or routing changes.
