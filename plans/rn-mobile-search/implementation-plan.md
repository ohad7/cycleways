# React Native Search Implementation Plan

## Tasks

- [x] Add Phase 2.6 plan entry to `plans/README.md`.
- [x] Render a native search row bound to `mapUi.searchQuery`.
- [x] Submit search through `handleSearchSubmit` with a native-safe synthetic
  event.
- [x] Render `mapUi.searchHighlight` as a native Mapbox layer.
- [x] Fit the camera to a new search result.
- [x] Add an `Add` action that routes through `handleMapClick`.
- [x] Verify tests, build, iOS export, and simulator behavior.

## Verification

- `npm test` passed.
- `npm run build` passed.
- `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-search`
  passed and bundled the 115 routing shards.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` rebuilt and
  opened the app on the iOS 17.5 iPhone 15 simulator.
- Simulator smoke: searched `Kfar Blum`, tapped Add to create the first route
  point, searched `HaGoshrim`, tapped Add again, and the app rendered a native
  route line with `Route ready` and `2 points - 7.6 km`.
