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
  via a `data-route-fit-obstruct` attribute (optionally naming a side).
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

## A. Measurement model — `computeOverlayFitPadding`

New pure helper, `src/map/routeFitPadding.js`:

```
computeOverlayFitPadding({ mapEl, obstructions, gap = 16, base = 24 })
  -> { top, right, bottom, left }
```

1. `mapRect = mapEl.getBoundingClientRect()`. Seed each edge with `base` (a
   small uniform minimum so even un-obstructed edges get breathing room).
2. For each obstruction element:
   - Skip if hidden — zero-size rect, `display:none` / `visibility:hidden`
     (via `getComputedStyle`), or `aria-hidden="true"`.
   - Skip if its rect does not overlap `mapRect`.
   - **Side**: if `data-route-fit-obstruct` names one of
     `top|right|bottom|left`, use it; otherwise infer the *nearest* map edge by
     smallest gap (`rect.top - mapRect.top`, `mapRect.bottom - rect.bottom`,
     etc.).
   - **Inset** = intrusion depth from that edge (e.g. bottom →
     `mapRect.bottom - rect.top`), clamped `>= 0`, plus `gap`.
   - `result[side] = max(result[side], inset)`.
3. Clamp each edge so the combined padding can't exceed ~80% of the map's
   width/height (Mapbox `fitBounds` throws if padding leaves no room).
4. Return the padding object.

This is a rectangular-inset approximation (Mapbox padding is rectangular) that
assigns each overlay to a single edge, so a corner box pads one edge rather
than two. That keeps the whole route visible without over-shrinking it. A
small top-left box may push the top edge down slightly — acceptable, since
over-padding keeps the route fully visible while under-padding would hide it.

## B. Trigger hook — `useFitRouteOnPlay`

New hook, `src/components/routePlayback/useFitRouteOnPlay.js`:

```
useFitRouteOnPlay({
  isPlaying, currentTime, geometry,
  getMapEl,         // () => map container element to measure against
  getObstructions,  // () => iterable of [data-route-fit-obstruct] elements
  onRequestFit,     // ({ id, geometry, padding }) => void
  gap = 16,
  freshStartSec = 0.25,
})
```

- Tracks the `isPlaying` false→true transition with a `wasPlaying` ref.
- Reads the latest `currentTime` from a ref (kept current each render) so the
  transition effect — which depends only on `isPlaying` — sees the real time.
- If `currentTime > freshStartSec`, it's a resume → **skip** (covers
  resume-after-pause and scrub auto-resume, which start at `t > 0`).
- On a fresh start with valid geometry (`length >= 2`): measure padding via
  `computeOverlayFitPadding` and call
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
- Mark on-map overlays with `data-route-fit-obstruct`:
  `search-container`, `MapLegend`, `DataMarkerCard`, the POI preview, and
  `planner-route-playback` (`="bottom"`).
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
- In `RouteMapPlayback`: mark its `RoutePlaybackControls` (`="bottom"`) and the
  POI video preview with `data-route-fit-obstruct`; add a section ref to scope
  obstruction queries (the controls are siblings of the map element, so the
  scope is the `.fv-route-map-playback` section and overlap is computed against
  the inline map rect). Call `useFitRouteOnPlay`, with
  `onRequestFit = (req) => requestRouteFit('play-fit', { padding: req.padding })`.
- Expanded portal: keeps its existing `48` fit. Opening the expanded map
  already issues `requestRouteFit('featured-map-expand')`, which supersedes the
  play-fit token, so the computed play padding only tunes the inline map.

## E. Testing

- Unit-test `computeOverlayFitPadding` with mocked rects:
  - bottom full-width bar → only `bottom` grows by its height + gap;
  - top-left box → `top` (or nearest edge) grows, others stay at `base`;
  - hidden / non-overlapping overlays ignored;
  - oversized padding clamped below the map dimension.
- Unit-test the fresh-start gate in `useFitRouteOnPlay`:
  - play at `t = 0` → emits a fit request;
  - play at `t > freshStartSec` (resume) → no request;
  - scrub auto-resume (starts at `t > 0`) → no request.

## Out of scope

- "Already visible" detection (we always fit on a qualifying play).
- Re-fitting on resume, scrub auto-resume, window resize, or mid-playback
  overlay changes.
- The video-backed companion map's play behavior.
