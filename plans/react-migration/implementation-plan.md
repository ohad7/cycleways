# React Migration Implementation Plan

## Phase 0: Preparation

Status: first slice implemented.

### Scope

Prepare the current code for migration without changing behavior.

### Tasks

- [ ] Add a small browser smoke test for loading the public app.
- [ ] Add a browser smoke test for restoring a shared `route=` URL.
- [ ] Document current critical behaviors that must survive migration:
  - map loads from `map-manifest.json`;
  - route URL restores;
  - route point add/drag/remove works;
  - route geometry is clipped to route points;
  - data points trigger only near the route geometry;
  - GPX download uses ordered route geometry.
- [ ] Identify analytics events that must keep their names/payload shape.
- [ ] Decide whether old and new apps will coexist behind a feature flag or on
  a separate local route during migration.

### Acceptance Criteria

- There is a clear parity checklist for the React app.
- Existing tests pass before any React migration begins.

## Phase 1: React Shell And Asset Loading

Status: first slice implemented.

### Scope

Create the React entrypoint and move app loading state into React while keeping
Mapbox behavior minimal.

### Tasks

- [x] Add React dependencies if they are not already present:
  - `react`;
  - `react-dom`.
- [x] Add `src/main.jsx` and `src/App.jsx`.
- [x] Add `src/data/mapAssets.js` for:
  - manifest loading;
  - parallel `segments` and `bikeRoads` loading;
  - fallback to stable assets.
- [x] Render loading and error states from React.
- [x] Keep the current static assets and GitHub Pages build flow working.
- [x] Keep the existing public app available until parity is reached.
- [x] Exclude the local React preview entrypoint from the current static Pages
  deploy until the production entrypoint is switched.

### Acceptance Criteria

- React app starts locally with Vite at `/react.html`.
- It loads `map-manifest.json`, `segments...json`, and `bike_roads...geojson`.
- Loading and error states render without direct DOM mutation.
- Existing non-React app is not broken during this phase.
- GitHub Pages continues to deploy the current public app, not the local React
  preview.

## Phase 2: MapView Adapter

Status: implemented.

### Scope

Move Mapbox initialization and source/layer setup behind a React `MapView`
component.

### Tasks

- [x] Add `src/map/MapView.jsx`.
- [x] Create the Mapbox map once using `useRef`.
- [x] Move route network source/layer setup into `src/map/mapLayers.js`.
- [x] Preserve current network line styling.
- [x] Preserve hover and focus layers.
- [x] Expose callbacks for map clicks, route point dragging, segment hover, and
  data marker clicks.
- [x] Expose segment hover and focus callbacks from `MapView`.
- [x] Drive hover and focus layer filters from React state.
- [x] Add a React segment inspection panel for hovered/focused segments.
- [x] Render preview route point layers from React state.
- [x] Render data marker layers from `segments.json` metadata.
- [x] Add React preview panels for route point and data marker adapter state.
- [x] Add an explicit `onMapReady` callback.

### Acceptance Criteria

- The React app displays the CycleWays network.
- Hover/focus behavior still works for segment inspection.
- No React state stores the Mapbox map object directly.
- Map layers are updated through Mapbox sources/layers, not React-rendered line
  elements.
- Map clicks, route point dragging, and data marker clicks are exposed through
  React callbacks.

### Notes

- The first Phase 2 slice renders the CycleWays network in the React preview.
  The second slice wires segment hover/focus inspection. The final slice exposes
  map click, route point drag, and data marker click callbacks. Route
  calculation, snapping, and route geometry remain Phase 3 work.

## Phase 3: Route State Reducer

Status: implemented.

### Scope

Move route points, selected segments, route geometry, and active data points into
React-managed state while keeping `RouteManager` as the routing engine.

### Tasks

- [x] Add `src/routing/routeReducer.js`.
- [x] Add route actions:
  - `addPoint`;
  - `dragPoint`;
  - `removePoint`;
  - `clearRoute`;
  - `restoreRoute`;
  - `setHoveredSegment`;
  - `setFocusedSegment`.
- [x] Initialize `RouteManager` from loaded map assets.
- [x] Store route points and selected segments in React state.
- [x] Derive route geometry from `RouteManager`.
- [x] Derive active route data points from route geometry.
- [x] Keep URL restore using the existing compact `route=` decoding.
- [x] Keep URL share generation using the existing compact `route=` encoding.

### Acceptance Criteria

- [x] First point creates only a marker.
- [x] Second point creates route geometry.
- [x] Dragging a point recalculates route geometry.
- [x] Removing a point recalculates route geometry.
- [x] Shared route URLs restore correctly.
- [x] Existing route manager tests still pass.

### Notes

- The React preview uses the existing `RouteManager` as the routing engine.
- Route point removal is exposed through right-click/context-menu on a route
  point in the preview adapter.
- Share URL generation keeps the compact route-point payload with segment-id
  hints and applies the same middle-point compaction strategy used by the
  current app.
- Data markers are still visible globally, and markers triggered by the active
  route are emphasized based on route-geometry distance.

## Phase 4: UI Components

Status: implemented.

### Scope

Replace direct DOM mutation for route UI with React components.

### Tasks

- [x] Add `TopBar`.
- [x] Add `RoutePanel`.
- [x] Add `SegmentInfoPanel`.
- [x] Add `DataSummary`.
- [x] Add `DownloadModal`.
- [x] Add `Tutorial`.
- [x] Move route loading/error messages into React state.
- [x] Preserve current Hebrew copy unless intentionally changed in review.
- [x] Preserve current mobile layout behavior.
- [x] Preserve feature flag behavior for segment quality display.

### Acceptance Criteria

- [x] Route summary updates from React state.
- [x] Segment hover/focus details render from React state.
- [x] Download modal can generate GPX.
- [x] Share button generates the same route URL format.
- [x] Tutorial still initializes at the right time.
- [x] No critical route UI path depends on `innerHTML`.

### Notes

- Phase 4 keeps the React preview separate from the production `index.html`.
- The tutorial is a React modal for the preview path. The legacy tutorial stays
  untouched until the production entrypoint switch.
- The download modal generates GPX from `routeState.geometry`, using the same
  framework-independent GPX helper as the current app.
- Segment quality badges remain behind `segmentQualityPublicDisplay`.

## Phase 5: Interaction Parity

Status: implemented.

### Scope

Bring the React preview closer to the current public app for day-to-day route
editing and map interactions before considering a production switch.

### Tasks

- [x] Add search/location lookup with map camera movement and temporary
  highlight.
- [x] Add undo/redo/reset controls backed by React route history.
- [x] Add keyboard shortcuts for undo/redo and modal dismissal.
- [x] Add warning surfaces for broken routes and active route data issues.
- [x] Add mobile-friendly route point removal without relying on right-click.
- [x] Fit the map to restored shared routes once map sources are ready.
- [x] Keep route URL clearing behavior when a restored route is edited.
- [x] Preserve relevant analytics event names for search, route changes,
  undo/redo, reset, tutorial, and GPX download.

### Acceptance Criteria

- [x] Search can locate a result, move the map, and show a visible highlight.
- [x] Undo/redo/reset update route points, selected segments, geometry, summaries,
  and Mapbox layers.
- [x] `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, and `Escape` behave as expected.
- [x] A selected route point can be removed from an on-screen control.
- [x] Restored shared routes fit the map automatically.
- [x] Route warning/data issue surfaces render from React state.
- [x] Existing tests and build still pass.

### Notes

- Route history is kept as React route snapshots and reapplied to
  `RouteManager` through `updateInternalState`.
- Search uses the same Nominatim endpoint as the legacy app and keeps the
  highlight in the Mapbox adapter.
- Route point removal is now available by selecting a point and using the route
  panel control, while right-click/context-menu still works on desktop.
- Restored route fitting is one-shot through a `routeFitRequest` passed to
  `MapView`.

## Phase 6: Observability And Parity Tests

Status: implemented.

### Scope

Lock down parity before changing production entrypoints.

### Tasks

- [x] Add automated browser smoke test for loading the current public app.
- [x] Add automated browser smoke test for restoring a shared `route=` URL in
  React.
- [x] Add representative GPX fixture comparison.
- [x] Verify analytics event names and key payload fields.
- [x] Verify desktop and mobile viewport screenshots for core flows.
- [x] Verify old compact and legacy route URLs still restore.

### Acceptance Criteria

- [x] Browser smoke tests can run locally and in CI.
- [x] Route URL, GPX, and analytics parity risks are documented or fixed.
- [x] Mobile and desktop layouts have screenshot coverage before production switch.

### Notes

- Browser smoke tests live under `tests/e2e` and use a small Mapbox GL mock so
  they do not require a real Mapbox token or external Mapbox requests.
- Local smoke runs use the installed Chrome channel. CI installs Chromium with
  `npx playwright install --with-deps chromium`.
- `test-results/` and `playwright-report/` are ignored because screenshots,
  traces, and reports are generated artifacts.
- GPX parity is pinned with a SHA-256 fixture for a representative route.
- Analytics parity checks assert event names and key payload fields.

## Phase 7: Visual And Product Parity

Status: implemented.

### Scope

Make the React preview look and behave like the current public product before
switching production traffic. This phase is intentionally about parity, not the
production entrypoint.

### Tasks

- [x] Reuse the original public CSS and tutorial CSS on `react.html`.
- [x] Replace the migration-dashboard shell with the original fixed header,
  navigation links, and mobile menu behavior.
- [x] Restore the original map-first layout:
  - one large map card;
  - overlaid search;
  - overlaid undo/redo/reset/download controls;
  - overlaid legend and warning surfaces;
  - bottom route description panel;
  - segment hover display.
- [x] Keep React-driven route points, route warnings, data warnings, GPX modal,
  and tutorial modal wired into that layout.
- [x] Restore the public informational sections below the map.
- [x] Update smoke tests to target the parity UI instead of the temporary
  migration-dashboard UI.

### Acceptance Criteria

- React preview has the same first-screen structure as the current public app.
- Route creation, route restore, point selection/removal, download modal, and
  warnings are still React-controlled.
- The preview no longer exposes migration-only asset summary panels as user UI.
- Build, unit tests, smoke tests, and diff whitespace checks pass.

## Phase 8: Production Switch

Status: planned.

### Scope

Make React the public app while keeping rollback risk low.

### Tasks

- [ ] Switch `index.html` to the React entrypoint.
- [ ] Keep framework-independent modules in stable paths or update imports.
- [ ] Keep legacy `script.js` available but inactive for one review/deploy
  cycle.
- [ ] Verify GitHub Pages production build and deployment output.
- [ ] Verify representative old route links on the deployed site.

### Acceptance Criteria

- Public app runs through React.
- Old route links still work.
- GitHub Pages deploys the expected assets.
- There is no duplicate active implementation for core route UI.

## Phase 9: Legacy Cleanup

Status: planned.

### Scope

Remove old imperative paths only after the React production switch has been
verified.

### Tasks

- [ ] Remove or archive replaced `script.js` DOM/UI paths.
- [ ] Remove unused legacy CSS and HTML fragments.
- [ ] Keep shared utilities in framework-independent modules.
- [ ] Re-run production build, tests, and browser smoke tests.

### Acceptance Criteria

- No obsolete active UI path remains for route planning.
- Shared processing, route encoding, and GPX utilities remain reusable.

## Suggested First Implementation Slice

Start with Phase 1 only:

- add React dependencies;
- create `src/main.jsx` and `src/App.jsx`;
- move manifest + parallel asset loading into `src/data/mapAssets.js`;
- render a basic loading/error/ready shell;
- do not change the production entrypoint yet.

This gives us a low-risk branch that proves the build setup and data loading
without touching map interactions.
