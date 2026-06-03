# React Native Controller UI Design

## Goal

Phase 2.4 makes the Expo iPhone app use the shared `useCyclewaysApp`
controller instead of a one-off mobile asset loader. The app should render the
offline cycleway network, show calculated route geometry and waypoints, let a
user tap the native map to add route points, and expose enough route status UI
to prove the shared routing path works on iOS.

**Status:** Implemented and simulator-verified on 2026-05-30.

## Scope

- Replace the mobile-only `loadMapAssets` state in `apps/mobile/src/MapScreen.jsx`
  with `useCyclewaysApp` from `@cycleways/core`.
- Render the route network from `app.state.assets.geoJsonData` with the shared
  `prepareRouteNetworkFeatures` appearance logic.
- Render `app.routeState.geometry` as a native Mapbox `LineLayer`.
- Render `app.displayedRoutePoints` as native Mapbox `CircleLayer` features.
- Convert native `MapView.onPress` point features into `{ lng, lat }` and call
  `app.handleMapClick`.
- Provide a compact native overlay for loading/error/routing state, distance,
  point count, and route clearing.

## Non-Goals

- Dragging route points or route-line insertion on mobile.
- Search, GPX download, welcome wizard UI, elevation graph, featured routes, or
  OSM debug/review overlays.
- Pixel-perfect parity with the web map controls.
- Full simulator automation; this phase was manually verified on the iOS 17.5
  iPhone 15 simulator.

## Design Notes

`useCyclewaysApp` is the controller boundary. The React Native screen should be
a thin renderer and should avoid constructing its own routing/session state.

Native Mapbox style props use camelCase keys, so the screen keeps small RN style
objects that mirror the shared Mapbox paint choices. GeoJSON builders are local
to the mobile renderer for now because the existing web helpers are bundled with
web Mapbox-GL side effects.

The overlay intentionally stays small: this is a working app slice, not the
final mobile product chrome.
