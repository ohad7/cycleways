# React Native Search Design

## Goal

Phase 2.6 adds a native location-search affordance to the iPhone planner. A
rider should be able to search for a place in the existing CycleWays region,
see the result on the map, jump the camera to it, and add that result as a route
point.

Status: implemented and simulator-verified on 2026-05-30.

## Scope

- Reuse `useCyclewaysApp` search state and handlers.
- Add a compact native `TextInput` search row in `MapScreen`.
- Render `mapUi.searchHighlight` on the native Mapbox map.
- Fit/fly the native camera to a successful search result.
- Add the current search result to the route via the existing `handleMapClick`
  path.

## Non-Goals

- Offline geocoding.
- GPS/current-location permissions.
- Native autocomplete or search history.
- Replacing the shared Nominatim-backed search implementation.

## Design Notes

The search row stays inside the existing top overlay so it remains visible
without introducing new navigation. The shared controller still owns search
query, loading, validation, and error state.

The mobile renderer does not need the web DOM marker timeout. Keeping the search
result visible is useful on touch devices because it gives the rider a stable
target for the `Add` action.
