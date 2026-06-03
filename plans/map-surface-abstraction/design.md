# Map Surface Abstraction + Mobile-Web Pass — Design

**Date:** 2026-05-28
**Status:** Approved (design), pending implementation plan
**Branch context:** work began from `codex/remove-points-from-route`

## Purpose

CycleWays is a Vite + React web app for cycling-route planning. We intend to
eventually build a **React Native** iPhone app that reuses the platform-independent
routing engine and data, while rebuilding the UI and map layers natively.

This spec covers an **intermediate step taken entirely on the web app** that
reduces the future RN transition cost without yet writing any RN code: harden the
seam between the app and the map so the map sits behind a documented,
platform-agnostic contract. A second, deliberately-changing workstream folds in a
mobile-web quality pass on recent feature work.

Two workstreams, **sequenced A then B**:

- **A — Map-surface abstraction (zero behavior change).** Internal recomposition
  of the web map code so the end-user map becomes a narrow, documented component
  contract that an RN `MapSurface` can later re-implement as a drop-in second
  implementation.
- **B — Mobile-web pass (intended changes).** A touch/responsive audit and fixes
  of recent feature work (elevation profile slope tooltip, route-point editing,
  slope legend), layered on top of A's cleaner interaction layer.

A lands and is verified as zero-behavior-change *first*; B builds on top. Keeping
them ordered means A's "nothing changed" verification is not muddied by B's
deliberate changes.

## Scope

**In scope:**
- Web-only refactor of `src/map/` to split the end-user map (`MapSurface`) from
  web-only OSM debug/review tooling (`OsmDebugOverlay`).
- Extracting Mapbox style specs into a pure data module.
- Removing the `window.mapboxgl` global behind a single accessor.
- Extracting pixel/interaction helpers into a dedicated module, with the pure
  geometry kept reusable.
- Documenting the portable map contract, including documented (not implemented)
  RN input mechanics.
- A mobile-web touch/responsive pass over recent features.

**Out of scope (explicitly deferred):**
- Any React Native code or `@rnmapbox/maps` integration.
- Extracting a shared monorepo `core` package (a later, larger move).
- Moving the routing engine, GPX, encoding, or elevation logic — already
  platform-independent, untouched here.
- Live GPS navigation and offline-map features (future RN-era work).

## Key architectural finding

The app already has a clean seam:

- `App.jsx` never touches Mapbox directly (zero GL references). It talks to the
  map **only** through `MapView`'s props (data + view state in) and callbacks
  (geographic results out).
- `MapView.jsx` is the imperative bridge: a stack of ~12 `useEffect` blocks, each
  owning one layer group (add layers + wire events + clean up).
- `mapLayers.js` tangles two different things: ~89 `paint`/`layout` **style
  specs** (which transfer to `@rnmapbox/maps` as data, since both consume the GL
  style-spec format) and **imperative GL plumbing** (`addLayer`/`addSource`/
  `getSource().setData()`/pixel hit-testing/DOM markers).
- Roughly half of `mapLayers.js` is OSM debug/review tooling — developer tooling,
  not an end-user feature.

`@rnmapbox/maps` is **declarative** (render `<ShapeSource>`/`<LineLayer>` JSX),
so the natural shared abstraction is the **React component contract**
(props in, callbacks out) — not an imperative driver interface. The design draws
the boundary there.

## Workstream A — Map-surface abstraction

### Module layout (under `src/map/`)

```
src/map/
  MapSurface.jsx        NEW  the portable contract — product layers only.
                             Owns map init + product useEffects.
  OsmDebugOverlay.jsx   NEW  web-only debug/review layers + popups.
                             Receives the live map instance from MapSurface.
  MapView.jsx           THIN composition root:
                             <MapSurface .../> + (debug ? <OsmDebugOverlay/> : null)
                             App.jsx keeps importing MapView; its props unchanged.
  mapStyles.js          NEW  pure data: ~89 paint/layout specs + layer/source IDs.
                             No mapbox calls.
  mapLayers.product.js  split: product sync/add functions.
  mapLayers.debug.js    split: osm/graph/match/review functions (web-only).
  mapInteractions.js    NEW  snapping/hit-test/click-stamp helpers extracted
                             from MapView. Pure geometry kept reusable; thin
                             "read pixels from a GL event" wrapper is web-only.
  mapboxProvider.js     NEW  single accessor replacing window.mapboxgl.
  routeDirectionAnimator.js   unchanged.
```

**Product effects → `MapSurface`:** route network + hover/click, route geometry,
route points + drag, drag preview, direction pulse, data markers, search
highlight, viewport-idle, route-fit, video cursor.

**Debug effects → `OsmDebugOverlay` (web-only):** osm-debug ways, graph edges,
intersections, cw-osm-match, cw-osm-review — including their popups and
`mapboxgl.Popup` usage.

**Map instance hand-off:** `MapSurface` exposes the ready map via its existing
`onMapReady(map)` callback; `MapView` passes it to `OsmDebugOverlay`. The debug
overlay layers onto the same map without `MapSurface` knowing debug exists.

### The `MapSurface` contract

The contract is expressed in **geographic / domain terms** (lng/lat, segment
names, indices) — never pixels or DOM events. The existing callbacks already are
in these terms; pixel math is already internal to `MapView`.

**Inputs — data (what to render):**

| Prop | Type | Meaning |
|---|---|---|
| `geoJsonData` | FeatureCollection | the cycleway network |
| `routeGeometry` | `[lng,lat][]` | the computed route line |
| `routePoints` | waypoint[] | user-placed waypoints |
| `routePointDragPreview` | preview \| null | transient drag ghost |
| `dataMarkerFeatures` | feature[] | POIs / markers |
| `activeDataPointIds` | id[] | which markers are "active" |

**Inputs — view state (how it looks right now):**
`focusedSegment`, `hoveredSegment`, `selectedRoutePointIndex`, `elevationHover`,
`searchHighlight`, `videoCursor`, `animator` (the direction-pulse driver).

**Inputs — commands (imperative intent as a changing prop):**
`routeFitRequest` — a token object; when its identity changes, the surface fits
bounds to the route. This "command-as-prop" pattern is portable (RN does the same
with a changing prop).

**Outputs — callbacks (all geographic):**
`onMapClick({lng,lat})`, `onSegmentFocus(segmentName)`,
`onRoutePointSelect(index)`, `onRoutePointRemove(index)`,
`onRoutePointDragStart/Drag/DragEnd(...)`,
`onRouteLineDragStart/Drag/DragEnd(...)`, `onDataMarkerClick(id)`,
`onViewportIdle(bounds)`.

**Fenced as desktop/web-only (optional, not part of the portable core):**
- **Hover** — `onSegmentHover` + the ghost "hover-preview" point that trails the
  cursor. No hover on touch; on RN these simply do not fire.
- **`onMapReady(map)`** — hands out the raw Mapbox-GL `Map`. A web-only escape
  hatch used solely so `MapView` can pass the live instance to
  `OsmDebugOverlay`. RN's `MapSurface` will not expose a GL map at all.
- **Debug props** — all `osm*`/`cwOsm*` props and their hover callbacks live on
  `OsmDebugOverlay`, outside the portable surface.

**Portable core, in one line:** data in → declarative render; user gesture →
geographic callback out.

### Interaction handling

Web/pixel-specific mechanics that stay inside the web `MapSurface` /
`mapInteractions.js`:
- `findClosestRouteSegment(map, event, segments)` — cursor→pixel projection,
  nearest segment via `distanceToLineSegmentPixels`.
- `isPointTooCloseToRouteUi(...)` — pixel-threshold suppression of the ghost point.
- Route-point drag — `mousedown`/`touchstart` → move → up/end, reading `lngLat`.
- Route-line drag — grab the route line to spawn/move a waypoint.
- `createClickStamp` / click-vs-drag debounce.

**Principle:** each helper *consumes* pixels/DOM events and *emits* a geographic
result. The contract boundary is drawn at the emit point, so callbacks receive
only `{lng,lat}` / `segmentName`. Nothing in `App.jsx` or the route engine ever
sees a pixel.

**Refactor it forces (healthy):** the snapping helpers move out of `MapView.jsx`
into `mapInteractions.js`. The pure geometry parts are already shareable (e.g.
`utils/distance.js`); only the thin GL-event wrapper is web-only.

**RN equivalents — documented, NOT implemented here:**
- snapping/hit-test → `@rnmapbox/maps` `queryRenderedFeaturesAtPoint` + the same
  `distanceToLineSegmentPixels` math.
- drag → RN gesture handler reading `getCoordinateFromView()`.
- The geographic output contract is identical; only the input mechanism changes.

### Style-spec extraction & global removal

- Move the ~89 `paint`/`layout` objects + layer/source ID constants out of
  `mapLayers.js` into a pure `mapStyles.js` (no mapbox calls); `mapLayers.*`
  imports them.
- Replace every `window.mapboxgl` read with a single `mapboxProvider.js` accessor
  (web returns `window.mapboxgl`). Keeps the contract free of globals.
- No visual change.

### Zero-behavior-change guarantee

Workstream A is purely an internal recomposition. `App.jsx` keeps importing
`MapView` with identical props. Web composes `MapSurface` + `OsmDebugOverlay`
exactly as `MapView` behaves today, including the OSM debug tooling and popups.

## Workstream B — Mobile-web pass

A deliberate touch/responsive audit + fixes of recent feature work, layered on
top of A.

### Grounded findings (current state)

Corrected after reading the code (an earlier finding that the elevation profile
was "hover-only, no touch" was wrong — caused by a truncated grep):

- **Elevation profile** interactions (slope-chip tooltip + elevation hover)
  **already handle touch**: `ElevationProfile.jsx` reads
  `event.touches?.[0]?.clientX ?? event.clientX` and wires
  `onTouchStart/onTouchMove/onTouchEnd` (lines ~38–63, 134–136). No missing touch
  support here.
- **Route-point drag editing** already handles touch (`MapView` wires
  `touchstart/touchmove/touchend` alongside mouse, lines ~970–999).
- **Network segment hover + ghost-preview point** are mouse-only by design;
  tap-to-place still works via `click`.
- **Responsive layout of recent additions is unverified.** The mobile
  `@media (max-width: 768px)` block (react-app.css:1164) caps the route
  description panel at 170px tall and shrinks font, but has **no rules** for the
  new `.react-elevation-legend`, `.react-grade-chip`, or
  `.react-elevation-hover-info`. These plausibly crowd/overflow within the short
  mobile panel (incl. RTL), but this must be observed, not assumed.
- `useIsMobile` exists but is used only in `featured/`; the main planning UI has
  no JS-level mobile awareness, only CSS media queries.

### Approach: verification-led, fix only what is observed

B is **not** "add missing touch support" (that exists). It is a **mobile-web
verification pass** of the recent features on a real mobile viewport, fixing only
issues that are actually observed.

### Tasks

1. **Observe on a mobile viewport** — drive the app at a phone-sized viewport
   (Playwright / device emulation) through: elevation touch-scrub showing the
   tooltip + slope chip; route-point touch add/move/remove with the
   chevron/direction animation; the slope legend + grade chip rendering. Record
   concrete defects (screenshots).
2. **Fix observed responsive-layout issues only** — most likely candidates: the
   slope legend / grade chip / hover-info overflowing or crowding inside the
   170px mobile route-description panel, and RTL alignment. Add targeted rules to
   the existing `@media (max-width: 768px)` block. Scope strictly to observed
   defects.
3. **Fix observed touch-interaction issues only** — only if step 1 surfaces real
   problems (e.g. tap targets too small, scrub jitter). No speculative changes.
4. **Optional, YAGNI-gated** — promote `useIsMobile` into the main app only if a
   fix genuinely requires JS-level touch awareness rather than CSS.

If step 1 surfaces no real defects, B closes as "verified, no changes needed" —
that is a valid outcome.

## Testing & verification

**Workstream A (zero behavior change):**
- Keep/extend existing unit tests: `tests/test-map-layers.mjs`,
  `tests/test-route-manager-snap.js`, `tests/test-route-direction-animator.mjs`,
  and the broader `npm test` suite must stay green.
- Add tests around the extracted `mapInteractions.js` pure-geometry helpers.
- Playwright smoke (`npm run test:smoke`) on **desktop and a mobile viewport** to
  confirm route planning, route-point drag, debug overlay, and popups behave
  identically before/after.
- Manual parity check: desktop hover/ghost-point, OSM debug modes, popups.

**Workstream B (intended changes):**
- Playwright smoke on a mobile viewport covering: elevation-profile touch
  scrubbing shows the tooltip + slope chip; route-point touch editing; slope
  legend/tooltip layout + RTL on small screens.
- Manual check on a real iOS Safari viewport.

## Risks & mitigations

- **Silent behavior change during A's split** → pin Playwright smoke on both
  viewports before refactoring; diff behavior after.
- **`onMapReady` escape hatch leaking into "portable" thinking** → it is
  explicitly documented as web-only; RN does not expose a GL map.
- **Scope creep from B into a general redesign** → B is limited to recent feature
  work (elevation slope tooltip, route-point editing, slope legend); no unrelated
  UI changes.
