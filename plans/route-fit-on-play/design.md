# Route fit-on-play — design

Date: 2026-06-09

## Goal

When the user starts playing a route on the map (presses the play button in
`RoutePlaybackControls`), fit the camera to the whole route so it sits fully
inside the visible map — and keep it clear of the on-map overlays (most
importantly the play controls themselves) so nothing hides the route.

## Decisions

- **Scope:** every surface where `RoutePlaybackControls` overlay a route map:
  - the planner front page (`src/App.jsx`), and
  - the featured map-stage playback (`RouteMapPlayback` →
    `FeaturedRouteMap`, inline + expanded).

  The video-backed companion map (`media="video"`, `fv-mobile-map`) keeps its
  existing auto-reset / `requestRouteFit` behavior. Its controls overlay the
  *video*, not the map, so the "don't hide the route" rationale does not apply
  there; it is out of scope.
- **Obstructions:** all on-map overlays that are present at play time, opt-in
  via a per-surface **selector registry** (`{ selector, side? }[]`). A registry
  (rather than a DOM attribute) is used because the overlay components
  (`RoutePlaybackControls`, `MapLegend`, `DataMarkerCard`, the POI preview)
  render their own roots and do not forward arbitrary attributes; the registry
  curates obstructions without editing any child component, and still carries
  the optional `side` hint.
- **Trigger:** fresh start only. Fit when playback starts from `t ≈ 0`.
  Resume-after-pause and scrub auto-resume do **not** re-fit.
- **Always fit** on a qualifying play — no "already visible" short-circuit.

## Existing seams this builds on

- `MapSurface` already fits to a `routeFitRequest` token (identity change =
  fit) and feeds `routeFitPadding` straight into Mapbox `fitBounds`, which
  accepts an asymmetric `{ top, right, bottom, left }` object. The featured
  pages already pass such an object (`MAP_PLAYBACK_ROUTE_FIT_PADDING`, whose
  `bottom: 108` clears the controls).
- The playback hooks (`useRoutePlayback` / `useSyntheticRoutePlayback`) expose
  `isPlaying` and `currentTime`, the signals the fresh-start trigger needs.
- The planner only ever fits on URL-restore today; it passes no
  `routeFitPadding` (defaults to the uniform `72`).
- The featured context exposes `requestRouteFit(reason)` which builds the
  token; `FeaturedRouteMap` owns the `.featured-map-inline` element and the
  expanded portal.

## A. Measurement model — `src/map/routeFitPadding.js`

Two functions, split so the math is DOM-free and unit-testable:

### `resolveOverlayInsets({ mapRect, overlays, gap = 16, base = 24 })` (pure)

`overlays` is an array of `{ rect, side? }` where `rect` is a plain
`{ top, right, bottom, left }` (DOMRect-shaped). Returns
`{ top, right, bottom, left }`:

1. Seed each edge with `base` (a small uniform minimum so even un-obstructed
   edges get breathing room).
2. For each overlay:
   - Skip if its `rect` does not overlap `mapRect`.
   - **Side**: use `overlay.side` if it is one of `top|right|bottom|left`;
     otherwise infer the *nearest* map edge by smallest gap
     (`rect.top - mapRect.top`, `mapRect.bottom - rect.bottom`, etc.).
   - **Inset** = intrusion depth from that edge (e.g. bottom →
     `mapRect.bottom - rect.top`), clamped `>= 0`, plus `gap`.
   - `result[side] = max(result[side], inset)`.
3. Clamp each edge so it can't exceed ~80% of the map's width/height (Mapbox
   `fitBounds` throws if padding leaves no room): `top`/`bottom` ≤
   `0.8 * mapHeight`, `left`/`right` ≤ `0.8 * mapWidth`.
4. Return the padding object.

### `computeOverlayFitPadding({ mapEl, registry, gap, base })` (DOM glue)

Thin wrapper, verified manually:
1. `mapRect = mapEl.getBoundingClientRect()`.
2. For each `{ selector, side }` in `registry`, for each element matching
   `mapEl`-scoped `querySelectorAll(selector)` (or a provided scope element):
   skip if hidden (zero-size rect, `display:none`/`visibility:hidden` via
   `getComputedStyle`, or `aria-hidden="true"`); otherwise push
   `{ rect: el.getBoundingClientRect(), side }`.
3. Return `resolveOverlayInsets({ mapRect, overlays, gap, base })`.

This is a rectangular-inset approximation (Mapbox padding is rectangular) that
assigns each overlay to a single edge, so a corner box pads one edge rather
than two. That keeps the whole route visible without over-shrinking it. A
small top-left box may push the top edge down slightly — acceptable, since
over-padding keeps the route fully visible while under-padding would hide it.

## B. Trigger hook — `useFitRouteOnPlay`

New hook, `src/components/routePlayback/useFitRouteOnPlay.js`. The decision is
factored into a pure, exported predicate so it is unit-testable:

```
shouldFitOnPlayStart({ wasPlaying, isPlaying, currentTime, geometryLength, freshStartSec = 0.25 })
  -> boolean   // true only on a false→true transition at t<=freshStartSec with geometryLength>=2

useFitRouteOnPlay({
  isPlaying, currentTime, geometry,
  getMapEl,         // () => map container element to measure against
  registry,         // { selector, side? }[] of obstruction overlays
  scopeEl,          // optional element to scope selector queries (defaults to getMapEl())
  onRequestFit,     // ({ id, geometry, padding }) => void
  gap = 16,
  freshStartSec = 0.25,
})
```

- Tracks the `isPlaying` false→true transition with a `wasPlaying` ref.
- Reads the latest `currentTime` from a ref (kept current each render) so the
  transition effect — which depends only on `isPlaying` — sees the real time.
- Calls `shouldFitOnPlayStart(...)`; `currentTime > freshStartSec` is a resume
  → **skip** (covers resume-after-pause and scrub auto-resume, which start at
  `t > 0`).
- On a fresh start: measure padding via `computeOverlayFitPadding({ mapEl:
  getMapEl(), registry, scopeEl, gap })` and call
  `onRequestFit({ id: 'play-fit-' + Date.now(), geometry, padding })`.

## C. `MapSurface` change

In the existing route-fit effect, prefer padding carried on the request token,
falling back to the prop:

```js
padding: routeFitRequest.padding ?? routeFitPadding,
```

Fully backward-compatible: existing tokens (URL-restore, featured
expand/auto-reset) carry no `.padding` and keep their current behavior. This
avoids threading a separate dynamic-padding prop through every surface.

## D. Per-surface wiring

### Planner (`src/App.jsx`)

- Add a ref on `.map-container` (serves as both the map element to measure
  against and the obstruction query scope).
- Registry of overlay selectors (scoped to `.map-container`):
  `{ selector: '.planner-route-playback', side: 'bottom' }`,
  `{ selector: '.search-container', side: 'top' }`,
  `{ selector: '.legend-container' }`,
  `{ selector: '.data-marker-card' }`,
  `{ selector: '.planner-route-poi-preview' }`.
- Hold a local `playFitRequest` state; `onRequestFit = setPlayFitRequest`.
- Call `useFitRouteOnPlay` with `plannerPlayback.isPlaying`,
  `plannerPlayback.currentTime`, and `routeState.geometry`.
- Pass `routeFitRequest={playFitRequest ?? mapUi.routeFitRequest}` to
  `MapView`. No `routeFitPadding` prop needed — padding rides in the token; the
  restore token keeps the default uniform padding.

### Featured (`RouteMapPlayback` / `FeaturedRouteMap` / `FeaturedRouteContext`)

- Add a `mapContainerRef` to the featured context, set on `.featured-map-inline`
  by `FeaturedRouteMap`.
- Extend `requestRouteFit(reason, { padding } = {})` to stash `padding` in the
  token.
- In `RouteMapPlayback`: add a section ref (`.fv-route-map-playback`) used as
  the `scopeEl` for obstruction queries (the controls are siblings of the map
  element, so overlap is computed against the inline map rect). Registry:
  `{ selector: '.fv-video-controls', side: 'bottom' }`,
  `{ selector: '.fv-video-poi-preview' }`. Call `useFitRouteOnPlay` with
  `getMapEl = () => mapContainerRef.current` and
  `onRequestFit = (req) => requestRouteFit('play-fit', { padding: req.padding })`.
- Expanded portal: keeps its existing `48` fit. Opening the expanded map
  already issues `requestRouteFit('featured-map-expand')`, which supersedes the
  play-fit token, so the computed play padding only tunes the inline map.

## E. Testing

Tests are plain Node scripts run via the `test` npm script (no test framework);
use `node:assert/strict` and mock rects as plain objects.

- `tests/test-route-fit-padding.mjs` — `resolveOverlayInsets` with mocked rects:
  - bottom full-width bar (`side: 'bottom'`) → only `bottom` grows by its
    height + gap; other edges stay at `base`;
  - top-left box with no `side` → nearest edge grows, others stay at `base`;
  - non-overlapping overlay → ignored (all edges stay at `base`);
  - oversized overlay → that edge clamped to `0.8 * map dimension`.
- `tests/test-fit-route-on-play.mjs` — `shouldFitOnPlayStart`:
  - `wasPlaying:false, isPlaying:true, currentTime:0, geometryLength:5` → true;
  - same but `currentTime:30` (resume) → false;
  - `wasPlaying:true, isPlaying:true` (already playing) → false;
  - `geometryLength:1` → false.

## Out of scope

- "Already visible" detection (we always fit on a qualifying play).
- Re-fitting on resume, scrub auto-resume, window resize, or mid-playback
  overlay changes.
- The video-backed companion map's play behavior.
