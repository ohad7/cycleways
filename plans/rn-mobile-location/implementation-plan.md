# React Native Location Implementation Plan

## Tasks

- [x] Add Phase 2.7 plan entry to `plans/README.md`.
- [x] Add the iOS location permission string to `apps/mobile/app.json`.
- [x] Render native user location on the Mapbox map.
- [x] Capture `UserLocation.onUpdate` and normalize it to `{ lng, lat }`.
- [x] Add a native Locate/Stop overlay control.
- [x] Wire Locate to camera follow/current-location centering.
- [x] Verify tests, build, iOS export, and simulator behavior.

## Verification

- `npm test` passed.
- `npm run build` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-location-final` passed and bundled the 115 routing
  shards plus the RNMapbox heading asset.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` rebuilt and
  opened the app on the iOS 17.5 iPhone 15 simulator.
- Simulator smoke: set simulated location to `33.1669,35.6079`, granted
  location permission to `app.cycleways.mobile`, tapped Locate, verified the
  camera centered on the blue user-location puck and the overlay changed to
  Stop/Following location, tapped Stop, and verified it returned to Locate.
- Route overlay smoke: added a searched `Kfar Blum` point and verified Locate
  and Clear fit beside the one-point route controls.

## Notes

RNMapbox 10.3.1 logs `UserLocationUpdate is not supported` if the callback is
attached directly to `MapView`. Use `UserLocation.onUpdate` for this version.
