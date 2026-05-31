# React Native Planning Controls Implementation Plan

## Tasks

- [x] Add Phase 2.5 plan entry to `plans/README.md`.
- [x] Add a `Camera` ref and route-fit helper to `MapScreen`.
- [x] Honor controller `routeFitRequest` for restored routes.
- [x] Add a `ShapeSource.onPress` handler for route-point selection.
- [x] Add selected-point UI and remove action.
- [x] Add undo, redo, and fit controls to the native overlay.
- [x] Verify unit/build/export and simulator behavior.

## Verification

- `npm test` passed.
- `npm run build` passed.
- `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-planning-controls`
  passed with `apps/mobile/.env` loaded and all 115 `.cwb` shards bundled.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` built and
  launched on the booted iOS 17.5 iPhone 15 simulator.
- Simulator smoke: added two route points, selected a waypoint, removed it,
  used undo to restore the route, used fit to camera-fit the full route, and
  used redo to return to the one-point state.
