# React Migration Design

## Goal

Move the public CycleWays application from one large imperative `script.js` file
to a maintainable React application, without rewriting the routing engine or the
map-processing pipeline.

The migration should improve:

- maintainability of route UI, panels, modals, and loading states;
- ability to add future route-planning features;
- separation between app state, map rendering, and domain logic;
- testability of user-facing workflows.

## Current Shape

The public app currently mixes several responsibilities in `script.js`:

- Mapbox map initialization and layer management;
- generated map asset loading;
- route point state;
- selected segment state;
- route summaries and descriptions;
- route URL decoding/encoding;
- GPX download;
- data marker rendering;
- segment hover/focus UI;
- tutorial and modal behavior;
- analytics calls.

Some of the current logic is already modular and should be preserved:

- `route-manager.js`;
- `spatial-index.js`;
- `utils/distance.js`;
- `utils/elevations.js`;
- `utils/gpx-generator.js`;
- `utils/route-encoding.js`;
- `utils/route-data.js`;
- map processing outputs: `map-manifest.json`, `bike_roads...geojson`,
  `segments...json`.

## Product And Architecture Decision

Use React for application state and UI, but keep Mapbox GL as an imperative map
adapter.

React should own:

- loading/error state;
- route points;
- selected segment metadata;
- route geometry state;
- active data points;
- segment hover/focus state;
- panels, buttons, modals, and tutorial UI;
- feature flags;
- URL restore/share state.

Mapbox should own:

- base map rendering;
- line layers and GeoJSON sources;
- route geometry source;
- data marker source/layer;
- pointer/touch map events;
- camera movement.

Routing/domain modules should stay mostly plain JavaScript:

- `RouteManager` remains a class, not a React component;
- spatial indexing remains a utility;
- route encoding and GPX generation stay framework-independent.

This avoids turning Mapbox layers into hundreds of React elements and keeps the
geospatial code portable.

## Proposed Structure

```text
src/
  main.jsx
  App.jsx

  data/
    mapAssets.js

  map/
    MapView.jsx
    mapLayers.js
    mapMarkers.js
    mapInteractions.js

  routing/
    routeReducer.js
    routeActions.js
    routeSelectors.js

  components/
    TopBar.jsx
    RoutePanel.jsx
    SegmentInfoPanel.jsx
    DownloadModal.jsx
    DataSummary.jsx
    Tutorial.jsx

  domain/
    route-manager.js
    spatial-index.js

  utils/
    distance.js
    elevations.js
    gpx-generator.js
    route-encoding.js
    route-data.js
    analytics.js
```

The exact folder names can change during implementation, but the ownership
boundary should stay clear:

- `components/` renders UI;
- `map/` translates React state to Mapbox mutations;
- `routing/` owns app route state transitions;
- `domain/` and `utils/` are framework-independent.

## State Model

The main route state should be explicit rather than inferred from DOM updates.

```js
{
  status: "loading" | "ready" | "error",
  mapAssets: {
    geoJsonData,
    segmentsData,
    manifest
  },
  route: {
    points: [],
    selectedSegments: [],
    geometry: [],
    activeDataPoints: []
  },
  ui: {
    hoveredSegment: null,
    focusedSegment: null,
    selectedDataPoint: null,
    downloadModalOpen: false,
    routeLoadError: null
  }
}
```

`RouteManager` can produce selected segments and route geometry, but React should
store the resulting state so UI components render from one source of truth.

## Mapbox Integration

`MapView` should create the Mapbox map once with `useRef`.

Map updates should happen through effects:

- when map assets load, set the network GeoJSON source/layers;
- when route geometry changes, update the route source;
- when active data points change, update marker opacity;
- when hovered/focused segment changes, update layer filters;
- when route is restored from a URL, fit bounds after the source is ready.

Map event handlers should call React callbacks:

- `onRoutePointRequested(point)`;
- `onRoutePointDragged(index, point)`;
- `onRoutePointRemoved(index)`;
- `onSegmentHover(segmentName)`;
- `onSegmentFocus(segmentName)`;
- `onDataPointClick(dataPointId)`.

Because Mapbox event handlers can close over stale React state, callbacks used
inside map handlers should read current state through refs or stable dispatch
functions.

## Migration Strategy

Use an incremental migration, not a full rewrite.

The first React version should preserve current behavior and consume the same
generated assets. The processing pipeline, editor, route encoding, and GPX
format are out of scope for the initial React migration.

The migration should keep the old app runnable until the React app has parity,
then switch `index.html` to the React entrypoint.

## Non-Goals

- Do not rewrite `RouteManager` as React state in the first pass.
- Do not change route URL encoding.
- Do not change generated map artifact formats.
- Do not introduce external routing / Phase 2 routing as part of migration.
- Do not convert every Mapbox marker or layer to React components.
- Do not redesign the product UI beyond what is needed to preserve behavior.

## Risks

- Mapbox event handlers may use stale state if callback refs are not handled
  carefully.
- Route restore timing can regress if map/source readiness is not explicit.
- Mobile drag/touch behavior can break during event migration.
- Existing analytics events can change unintentionally.
- Duplicate old and new UI paths can drift if the migration lasts too long.

## Review Checkpoints

The migration should have reviewable checkpoints:

1. React shell loads current map assets and renders the map.
2. React route state can restore a shared route URL.
3. Clicking/dragging/removing route points works.
4. Route panel, data summaries, and GPX download match current behavior.
5. Old DOM mutation code is removed.
6. Old `script.js` entrypoint is retired.

Each checkpoint should be verified before moving to the next one.
