# React Native Controller UI Implementation Plan

## Tasks

- [x] Add Phase 2.4 plan entry to `plans/README.md`.
- [x] Import `useCyclewaysApp` into the Expo `MapScreen`.
- [x] Build native GeoJSON feature collections for network, route geometry, and
  route points from controller state.
- [x] Render route layers on top of the network with `@rnmapbox/maps`.
- [x] Wire `MapView.onPress` to `handleMapClick({ lng, lat })`.
- [x] Add compact loading/error/routing overlay and clear route action.
- [x] Run web/core tests and build.
- [x] Run Expo iOS export to verify Metro can bundle the controller-driven app
  and all offline routing shards.
- [x] Build and launch on the iOS 17.5 iPhone 15 simulator.

## Verification

- `npm test` passed.
- `npm run build` passed.
- `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-controller-final`
  passed with `apps/mobile/.env` loaded and all 115 `.cwb` shards bundled.
- `npm run test:smoke` returned the known stale baseline:
  40 passed / 12 failed / 2 skipped.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` built and
  launched on the booted iOS 17.5 iPhone 15 simulator.
- Simulator tap test: first tap added a start point; second nearby network tap
  loaded routing shards and rendered a 2-point route line with `Route ready`
  and a 3.2 km distance.
