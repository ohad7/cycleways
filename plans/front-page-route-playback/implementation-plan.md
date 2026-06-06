# Front Page Route Playback Implementation Plan

Date: 2026-06-06

## Goal

Add featured-style route playback to the front-page planner while sharing route
timing, cursor, control, and POI-preview logic with existing featured route
playback.

## Phase 1: Extract Context-Free Playback Core

Files likely involved:

- `src/components/featured/RouteMapPlayback.jsx`
- `src/components/featured/routePlaybackDuration.js`
- `src/components/featured/routePlaybackSync.js`
- new `src/components/routePlayback/useRoutePlayback.js`

Tasks:

1. Extract the route ticker, play/pause/scrub state, cursor emission, and
   end-of-playback behavior from `RouteMapPlayback` into a context-free hook.
2. Keep `computeMapPlaybackDuration` and
   `createVariableSpeedRoutePlaybackSync` as the shared sync primitives.
3. Have `RouteMapPlayback` call the new hook and preserve all existing featured
   route behavior.
4. Keep the default cursor variant as `VIDEO_CURSOR_DEFAULT_VARIANT`, which is
   currently `progress-head-pulse`.

Acceptance criteria:

- `/routes/historic-jordan` still plays the route exactly as before.
- `/routes/kovshey-hagolan` still renders the map-only playback controls and
  POI preview.
- Existing route playback unit tests continue to pass.

## Phase 2: Make Playback Controls Context-Free

Files likely involved:

- `src/components/featured/RoutePlaybackControls.jsx`
- `src/components/featured/RouteProgressDistance.jsx`
- new or updated shared control helper in `src/components/routePlayback/`

Tasks:

1. Remove the hard dependency from `RoutePlaybackControls` to
   `FeaturedRouteContext`.
2. Pass distance/progress values into controls as props:
   - `progressFraction`;
   - `distanceMeters`;
   - optional `showTime`.
3. Keep existing featured CSS class names for visual consistency.
4. Update featured routes to pass the same values they currently derive from
   context.

Acceptance criteria:

- Featured video and map route controls look unchanged.
- The control component can render in the planner without
  `FeaturedRouteContext`.

## Phase 3: Make POI Preview Context-Free

Files likely involved:

- `src/components/featured/RoutePoiVideoPreview.jsx`
- `src/components/featured/routePoiStoryData.js`
- new `src/components/routePlayback/RoutePoiPlaybackPreview.jsx`

Tasks:

1. Extract a presentational/context-free POI preview component that accepts:
   - `cueSlides`;
   - `cursorFraction`;
   - `routeDistanceMeters`;
   - `previewMaxFraction`;
   - `previewMaxMeters`;
   - `onCueClick`.
2. Keep `nearestPreviewForCursor` as the shared selection logic.
3. Update featured `RoutePoiVideoPreview` to become a thin adapter around the
   shared component.
4. For the front page, build cue slides from:
   - `routeState.activeDataPoints`;
   - optional simple route start/end cues in a later step;
   - no catalog `meta` required for the first version.
5. On cue click in the planner:
   - pause playback;
   - focus the data marker if it has a valid location/id;
   - show the existing `DataMarkerCard` or warning focus behavior where
     applicable.

Acceptance criteria:

- Featured route POI preview behavior remains unchanged.
- Planner preview uses the same cue proximity behavior and visual states.
- Text-only warnings show icon fallback.

## Phase 4: Wire Planner Playback State

Files likely involved:

- `src/App.jsx`
- `packages/core/src/app/useCyclewaysApp.js`
- `src/map/MapView.jsx`
- `src/map/MapSurface.jsx`
- `src/components/ElevationProfile.jsx`

Tasks:

1. Add front-page playback state through the new shared hook.
2. Enable playback only when:
   - `routeState.geometry.length >= 2`;
   - no route calculation is pending;
   - route is not broken beyond what the current planner already allows for
     display.
3. Stop playback on:
   - route clear;
   - route point add/remove/drag;
   - route line drag;
   - undo/redo;
   - geometry recalculation.
4. Pass playback cursor to `MapView`:

   ```jsx
   videoCursor={plannerPlayback.cursor}
   videoCursorVariant="progress-head-pulse"
   ```

5. Keep existing elevation hover behavior when playback is inactive.
6. Pass playback cursor into `ElevationProfile` while playing or scrubbing:
   - `cursorFraction={plannerPlayback.cursor?.fraction}`;
   - `cursorPlaying={plannerPlayback.isPlaying}`;
   - add a prop if needed so external cursor can override animator mode during
     playback.
7. Clear playback cursor when the route becomes invalid or empty.

Acceptance criteria:

- Creating a route reveals playback controls.
- Pressing play moves the map cursor along the route.
- Scrubbing moves the map cursor and elevation marker immediately.
- Editing the route stops playback and clears/rebuilds playback state.

## Phase 5: Desktop UI Integration

Files likely involved:

- `src/App.jsx`
- `styles.css`
- `src/react-app.css`
- shared playback/preview components

Tasks:

1. Render planner playback controls inside `route-description-panel`.
2. Place controls below the route summary/warning row and above the elevation
   graph.
3. Use compact route-control styling:
   - one row;
   - physical-left play button;
   - scrubber as the main element;
   - time and distance readout on the remaining side.
4. If necessary, widen the route-description panel to
   `min(560px, calc(100% - 50px))`.
5. Render the POI preview over the map above the route-description panel:
   - physical left;
   - compact by default;
   - expanded near cues.
6. Ensure the preview does not cover search, undo/redo/reset/download buttons,
   or map warning modals.

Acceptance criteria:

- Controls are visible when a route exists.
- Controls do not overlap the top search/tooling.
- POI preview does not obscure route-control buttons.
- Route-description panel remains readable.

## Phase 6: Mobile UI Integration

Files likely involved:

- `styles.css`
- `src/react-app.css`
- shared playback/preview components

Tasks:

1. Render a compact playback dock in the bottom map area.
2. On mobile, prioritize:
   - play/pause;
   - scrubber;
   - distance;
   - time only if space allows.
3. Keep touch targets at least 36px tall.
4. Position the dock above or inside the top of the route-description panel.
5. Render POI preview as a compact card/pill above the dock.
6. Hide or move the POI preview when `DataMarkerCard` is open so two bottom
   cards do not compete.
7. Test portrait mobile viewport for:
   - no horizontal overflow;
   - no overlap with search;
   - route controls reachable by touch;
   - map remains usable.

Acceptance criteria:

- Mobile playback controls fit within the viewport.
- Scrubber is usable by touch.
- POI preview is visible but not dominant.
- Existing mobile route-description/elevation panel still works.

## Phase 7: Tests

Unit tests:

- Add or update route playback hook tests if the hook is pure enough to test
  outside React.
- Keep existing duration/sync tests passing.
- Add tests for cue-slide derivation when `meta` is absent.

Playwright tests:

1. Front-page route playback appears after creating/restoring a route.
2. Pressing play creates a `videoCursor` map layer update or visible cursor.
3. Scrubbing updates:
   - map cursor position;
   - elevation progress marker;
   - displayed distance.
4. Editing a route stops playback.
5. A route with warnings/POIs shows a POI preview during playback.
6. Mobile viewport:
   - controls visible;
   - no horizontal overflow;
   - controls do not overlap top search controls.

Suggested focused commands:

```bash
npx playwright test tests/e2e/routes-index.spec.mjs --workers=1
npx playwright test tests/e2e/mobile-regression-check.spec.mjs --workers=1
npm run build
```

Add a dedicated E2E file if the existing smoke tests become too broad, for
example:

```text
tests/e2e/front-page-route-playback.spec.mjs
```

## Phase 8: Manual Browser Verification

Desktop:

1. Open `/`.
2. Create a route with at least two points.
3. Confirm controls appear in the bottom route panel.
4. Press play.
5. Confirm the map cursor uses `progress-head-pulse`.
6. Confirm elevation graph progresses with the same cursor.
7. Confirm a warning/POI cue appears when the cursor approaches it.
8. Drag a route point and confirm playback stops.

Mobile:

1. Use a narrow viewport.
2. Create or restore a route.
3. Confirm the playback dock fits above/inside the route panel.
4. Scrub with touch.
5. Confirm no horizontal overflow and no overlap with search.

## Risks

- `videoCursor` naming is legacy and may confuse future work. Keep the map prop
  for now, but new shared code should use route-oriented names.
- The front-page `ElevationProfile` currently lets `animator` own the marker.
  Playback must override that mode only while active/scrubbing.
- Planner routes are mutable, unlike featured routes. Playback must stop on
  edits to avoid showing stale cursor positions.
- POI preview can compete with existing mobile bottom surfaces. Mobile layout
  should be verified visually, not only by DOM assertions.
