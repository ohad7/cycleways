# Route fit — more triggers

Date: 2026-06-09

## Goal

Reuse the overlay-aware route-fit mechanism (built in `plans/route-fit-on-play/`)
for more situations, so the relevant geometry is always framed clear of the
on-map overlays:

1. **Opening a route** — fit overlay-aware when:
   - the planner restores a route from the `route=xxx` URL parameter, and
   - a featured **non-video** (map-stage) route page opens.
2. **Discover list (front page)** — fit the map to show **all** currently
   relevant (filtered) routes, and re-fit whenever the filtered list changes.
3. **Hovering a route in the Discover list** — fit to the hovered route's
   bounds; when the pointer leaves, restore the all-routes (Discover) fit.

## Decisions

- Hover: fit the hovered route, and on hover-end **restore** the previous
  all-routes Discover fit. Debounced to avoid jitter while scanning.
- Opening a route: **both** the planner `route=xxx` restore and the featured
  non-video open become overlay-aware (the planner restore currently uses a
  uniform `72` padding; featured currently uses a static `bottom: 108`).
- All new triggers reuse `computeOverlayFitPadding` and the existing
  `routeFitRequest = { id, geometry, padding }` token consumed by `MapSurface`
  (which already prefers `routeFitRequest.padding ?? routeFitPadding`).

## Background (existing seams)

- `src/map/routeFitPadding.js` exports `computeOverlayFitPadding({ mapEl,
  registry, scopeEl, gap, base })`.
- `MapSurface` fits to a `routeFitRequest` token (identity change = fit) and its
  `fitMapToCoordinates` extends a `LngLatBounds` over `geometry` points that
  expose `.lng`/`.lat`.
- Recommended-route geometries (loaded via `loadFeaturedRouteSnapshot` into
  `recommendedGeoms`) use the **same** `{ lng, lat }` shape as
  `routeState.geometry`, so multiple routes can be fit by concatenating their
  geometry arrays.
- Planner (`App.jsx`):
  - `mapContainerRef` + `plannerFitRegistry` already exist (from the play work).
  - `mapUi.routeFitRequest` is set once by core (`useCyclewaysApp.js`) on
    `route=xxx` restore, with no `.padding` (so it fits with the uniform default).
  - Discover: `DiscoverPanel` reports its filtered list via
    `onVisibleRoutesChange={setDiscoverSlugs}` and hover via
    `onHoverRoute={setHoveredRouteSlug}`; `recommendedRoutes` (a memo of
    `{ slug, geometry, hovered }[]`) is drawn on the map.
- Featured: `FeaturedRoute` provides `requestRouteFit(reason, { padding } = {})`
  (padding-aware after the play work) and a `mapContainerRef` on
  `.featured-map-inline`; `RouteMapPlayback` owns `sectionRef`,
  `featuredFitRegistry`, and the play wiring.

## Architecture

### A. Shared helper — `buildRouteFitRequest`

Add to `src/map/routeFitPadding.js`:

```
buildRouteFitRequest(geometry, { mapEl, registry, scopeEl, gap, base })
  -> { id, geometry, padding } | null   // null when geometry has < 2 points
```

Thin: validates geometry length, calls `computeOverlayFitPadding`, returns the
token (`id = 'fit-' + Date.now()`). One place that mints a padded token; reused
by the planner controller. (The play hook may also be migrated to it, but that
is optional and not required by this spec.)

Also add a tiny pure helper `combineRouteGeometries(routes)`:

```
combineRouteGeometries(routes) -> Array<{ lng, lat }>
  // flattens route.geometry arrays; skips routes whose geometry has < 2 points
```

### B. Planner unified fit controller (`App.jsx`)

Single source of truth for fit requests, so the four triggers serialize cleanly
("latest call wins" by token id):

- `const [fitRequest, setFitRequest] = useState(null)`.
- Pass `routeFitRequest={fitRequest ?? mapUi.routeFitRequest}` to `MapView`
  (the raw core token is only a one-frame fallback before the restore effect
  re-emits it overlay-aware).
- `const requestFit = useCallback((geometry) => { const req =
  buildRouteFitRequest(geometry, { mapEl: mapContainerRef.current, registry:
  plannerFitRegistry }); if (req) setFitRequest(req); }, [plannerFitRegistry])`.
- A `discoverFitGeometryRef` holds the current combined Discover geometry (for
  hover-restore).

Triggers:

1. **Play** — `useFitRouteOnPlay({ … onRequestFit: setFitRequest })`. (The hook
   already mints `{ id, geometry, padding }`; behavior unchanged.)
2. **Restore (`route=xxx`)** — effect depending on `mapUi.routeFitRequest`:
   when it has geometry, `requestAnimationFrame(() => requestFit(geometry))`.
   The rAF defers measurement one frame so the just-rendered play controls are
   in the DOM and get cleared.
3. **Discover all-routes** — effect depending on `panel.state` and
   `recommendedRoutes`. When in `discover` with ≥1 loaded geometry, debounce
   ~150ms, then `const combined = combineRouteGeometries(recommendedRoutes)`,
   store it in `discoverFitGeometryRef`, and `requestFit(combined)`. Fires on
   entering Discover and on every filter change; as geometries stream in it
   re-fits and converges.
4. **Hover** — effect depending on `hoveredRouteSlug`, debounced ~120ms:
   - slug set + geometry available → `requestFit(hoveredGeometry)`;
   - slug cleared → `requestFit(discoverFitGeometryRef.current)` (restore the
     all-routes view).

The planner registry already includes `.search-container`/`.legend-container`
etc.; `computeOverlayFitPadding` skips absent/hidden selectors, so the same
registry works in Discover mode (where the play bar isn't rendered).

### C. Featured non-video overlay-aware open

Route the initial-open fit through the **existing** `requestRouteFit` rather than
adding a competing trigger (avoids parent/child effect-ordering fights):

- `RouteMapPlayback` registers its overlay context once on mount: store
  `featuredFitRegistry` and a `getFitScopeEl` (→ `sectionRef.current`) into the
  featured context (e.g. `registerRouteFitOverlays({ registry, getScopeEl })`).
- Extend `requestRouteFit(reason, { padding } = {})`: when **no** explicit
  `padding` is passed AND a registry + scope + `mapContainerRef.current` are
  available, compute overlay-aware padding via `computeOverlayFitPadding` and
  attach it. Otherwise behave exactly as today (the video companion map, which
  registers no overlays, keeps its default `routeFitPadding` prop).

Net effect: the existing on-ready `requestRouteFit("featured")` (and
`featured-video-resume`, etc.) become overlay-aware automatically on the
map-stage, with no new trigger and no ordering fight. Play keeps passing explicit
padding, which short-circuits the auto-measure (unchanged).

## Interaction / precedence

All planner triggers funnel into `setFitRequest`; all featured fits funnel into
`requestRouteFit`. Each new token has a fresh `id`, and `MapSurface` re-fits on
id change, so the most recent request always wins. No explicit priority chain is
needed.

## Testing

Tests are plain Node scripts (`node:assert/strict`, no framework), run via the
`test` npm script.

- `tests/test-route-fit-padding.mjs` (extend): `buildRouteFitRequest` returns a
  token with a string `id`, the passed `geometry`, and a `{top,right,bottom,left}`
  `padding`; returns `null` for geometry with < 2 points. (DOM is stubbed:
  pass a fake `mapEl` with `getBoundingClientRect`/`querySelectorAll` or an empty
  registry so it falls through to base padding.)
- `tests/test-combine-route-geometries.mjs` (new): `combineRouteGeometries`
  flattens multiple `{lng,lat}` arrays in order; skips routes with < 2 points;
  returns `[]` for empty input.
- Debounce timing, effect wiring, and DOM measurement are browser-verified
  (consistent with the route-fit-on-play feature).

## Out of scope

- Fitting on route **build** (waypoint edits) — unchanged (no auto-fit).
- Changing hover highlight styling.
- The video companion map's fit (stays on its existing default padding).
- "Already visible" short-circuits — every qualifying trigger fits.
