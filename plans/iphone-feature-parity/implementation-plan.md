# iPhone Feature Parity Implementation Plan

Date: 2026-06-11

## Goal

Ship route discovery, recommended route content, and standalone installed-build
support in the iPhone app while preserving the existing shared-controller
architecture and current web behavior.

## Phase 0: Verification Baseline

- Confirm current native planner still works after asset sync:
  `npm run mobile:assets`, `npm test`, `npm run build`, and iOS export/build.
- Capture current iPhone screenshots for the planner, empty route state, and
  loaded shared-route state.
- Capture current mobile web screenshots for Discover, Build, `/routes`, and a
  generic `/routes/:slug` page.
- Record a parity checklist with `done / partial / missing` states.

Expected result: no behavior change, clear before/after reference.

## Phase 1: Shared Catalog and Content Loaders

- Move place loading behind a core helper instead of web-only `fetch`.
- Change `loadCatalog()` to use `getJsonAsset()` so native can resolve the
  bundled catalog through `assets.native.js`.
- Add native-safe helpers for:
  - all route catalog entries;
  - featured/promoted entries;
  - route story availability metadata that does not import web JSX;
  - route card image selection;
  - route filter option derivation.
- Move or duplicate `catalogFilter` into `@cycleways/core` so native does not
  import from `src/components`.

Validation:

- Existing web `/routes` and front-page Discover behavior unchanged.
- Unit tests cover catalog load, filter behavior, place option derivation, and
  image fallback.

## Phase 2: Extend Native Offline Assets

- Update `apps/mobile/scripts/sync-offline-assets.mjs` to copy:
  - `public-data/route-catalog.json`;
  - `data/places.json`;
  - `public-data/featured-routes/*.json`;
  - route-map thumbnails and required POI thumbnails;
  - detail/full images only where needed for native route detail.
- Generate native asset maps for JSON, binary shards, and images.
- Add a native image resolver, for example
  `resolveBundledImageSource("public-data/route-map-images/...webp")`.
- Keep full planner data sync unchanged.

Validation:

- `npm run mobile:assets` reports catalog, places, snapshots, images, and 115
  routing shards.
- A native script/test can resolve every image path referenced by
  `route-catalog.json` and every bundled snapshot.
- iOS export includes the new content assets.

## Phase 3: Native Discover Sheet

- Add a Discover/Build sheet state to `apps/mobile/src/MapScreen.jsx` or split
  it into focused native components.
- Build native route cards using shared catalog helpers:
  route map thumbnail, title, summary, distance, elevation, difficulty, surface,
  shape, and nearby place labels.
- Add featured/promoted section at the top for entries currently marked
  `featured`, followed by all recommended routes.
- Add filters matching mobile web:
  start location, passes-through place, difficulty, surface, distance.
- Add near-me ranking using the existing native location fix and
  `@cycleways/core/data/nearMe.js`.
- Selecting a route calls `handleLoadRouteParam(entry.route)`, switches to
  Build, fits the route, and records it in recents.
- Render selected/visible recommended route geometries on the native map using
  generated snapshots and shared discover colors.

Validation:

- Native screen lists all 8 current catalog entries.
- The 3 current featured entries appear as promoted routes.
- Selecting each catalog route loads a route without network or app remount.
- Filters match web results for representative combinations.
- Recents strip accepts a selected catalog route.

## Phase 4: Native Route Detail

- Add a route detail modal/screen reachable from Discover cards.
- Start with generic structured content for every catalog route:
  hero/route-map image, summary/description, stats, warnings, POIs, and open in
  planner.
- Use generated route snapshots for geometry/stats/POIs instead of recalculating
  route detail client-side.
- Add optional video/story indicators only as metadata. Do not import web route
  story modules.

Validation:

- Every `/routes` catalog entry has a native detail view.
- Generic entries such as `historic-jordan` work as well as rich web-story
  entries.
- Detail view works offline after the standalone build is installed.

## Phase 5: Standalone Installed iPhone Build

- Add an explicit script for a no-Metro iPhone build:
  `npm run ios:offline -w @cycleways/mobile`.
- Initial script added as `apps/mobile/scripts/run-offline-ios.sh`; it should:
  - run asset sync;
  - build Release with `expo run:ios --configuration Release --no-bundler` so
    `AppDelegate.swift` loads bundled `main.jsbundle`;
  - install it on the selected simulator/device;
  - avoid requiring `expo start`.
- Physical-device helper supports the same path through
  `apps/mobile/scripts/run-on-device.sh --build-offline`, after it has ensured
  the signing certificate, device registration, provisioning profile, and manual
  signing settings.
- If Release builds are too slow for iteration, add an `OfflineDebug` Xcode
  configuration/scheme:
  - development signing;
  - no `DEBUG` bundle URL branch;
  - no `SKIP_BUNDLING=1`;
  - optional dev menu disabled.
- Document the difference between:
  - `npm run mobile` / `expo start`: fast Metro development;
  - `npm run mobile:ios`: normal local native dev;
  - `npm run ios:offline`: installed app that works away from the dev server.

Validation:

- Kill Metro/Expo server.
- Put the Mac/phone offline except for Mapbox tile networking if needed.
- Launch the installed app.
- Confirm JS loads, bundled planner data loads, Discover list loads, route
  selection loads, and route summary/share opens.

## Phase 6: Hardening

- Add native Maestro smoke coverage for Discover:
  open app, switch to Discover, filter, open a featured route, open a generic
  route, return to Build, share summary.
- Add a static asset audit test for all bundled catalog/snapshot image paths.
- Add bundle-size reporting for native content assets.
- Update `plans/HANDOFF.md` with the verified standalone-build workflow and
  remaining known gaps.

## Recommended Order

1. Shared catalog loaders.
2. Native asset sync for catalog/snapshots/images.
3. Discover sheet that opens routes.
4. Standalone iPhone build script.
5. Native route detail.
6. Map/list sync polish and route-story metadata.

The key sequencing point is that route discovery can ship before native route
detail. A native route card that opens the route in the existing planner closes
the biggest product gap immediately.
