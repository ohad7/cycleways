# iPhone Feature Parity Implementation Plan

Date: 2026-06-13

## Goal

Make the iPhone app useful as a native mobile version of the current mobile web
planner: route discovery, recommended route preview, route loading, route
playback, elevation, POIs, and custom route building should all be present.

This plan is intentionally approval-oriented. It identifies the parity gaps and
orders implementation so we can reuse shared logic before adding more native UI.

## Current Status

Done or mostly done:

- Shared controller: native uses `useCyclewaysApp`.
- Native map rendering: network, planned route, points, data markers, location,
  route direction pulse, elevation scrub marker.
- Native Build basics: search, add points, drag waypoints, undo/redo, clear,
  locate, summary, GPX, native share.
- Native content assets: catalog, places, route snapshots, route images, POI
  images, routing shards.
- Native Discover first slice: route cards, featured routes, filters, recents,
  details modal, open route in map.
- No-Metro installed build path: `npm run mobile:ios:offline`.

Partial or missing:

- Native bottom sheet does not match mobile web peek/half/full model.
- Discover has no near-me sorting.
- Discover has no route overlay/map-sync while browsing.
- Native place filters are short chip rows, not scalable autocomplete filters.
- Build lacks route playback controls.
- Build lacks the mobile-web POI list and cue preview.
- Elevation graph lacks the richer panel interactions from mobile web.
- Native route detail cannot play the route.
- Visible waypoint removal and route-line insertion are not exposed natively.
- `MapScreen.jsx` is too monolithic for the next parity slice.

## Phase 0: Approval Checklist

Before coding, confirm these product choices:

- Native should use a real bottom sheet with peek/half/full states.
- Native Discover should draw recommended route overlays on the map.
- Native Build should include route playback as a first-class feature.
- Native route details should be structured native views, not embedded web
  route pages.
- Send-to-phone is lower priority in the native app because the user is already
  on the phone.

Validation:

- This design and plan are approved.
- Any change in priority is recorded here before implementation starts.

## Phase 1: Extract Shared View Models

Create shared, platform-neutral helpers before expanding native UI.

Recommended modules:

- `packages/core/src/discovery/discoverySurfaceModel.js`
  - normalize catalog entries;
  - apply filters;
  - derive start/through place options;
  - derive featured/promoted entries;
  - apply near-me sort;
  - create route card view models;
  - create map overlay descriptors with stable color indices.
- `packages/core/src/build/buildSurfaceModel.js`
  - route stat cards;
  - active POI list ordered by route progress;
  - distance labels for POIs;
  - selected catalog route display state.
- `packages/core/src/playback/routePlaybackModel.js`
  - move route cursor/playback math out of web-only code;
  - provide a controller that web and native can render differently.

Refactor web to keep behavior unchanged while using these shared helpers where
reasonable. Do not block native work on moving every web component at once.

Validation:

- `npm test`
- Existing Discover/Build E2E specs pass.
- New unit tests cover discovery card models, near-me sorting, POI list order,
  and playback cursor math.

## Phase 2: Split Native MapScreen Into Surfaces

Keep behavior unchanged while reducing file size.

Create:

- `apps/mobile/src/NativeBottomSheet.jsx`
- `apps/mobile/src/DiscoverSurface.jsx`
- `apps/mobile/src/BuildSurface.jsx`
- `apps/mobile/src/RouteDetailModal.jsx`
- `apps/mobile/src/RouteCard.jsx`
- `apps/mobile/src/PoiList.jsx`

Move styles with the components or into focused style modules. Keep
`MapScreen.jsx` responsible for map layers, shared-controller wiring, and
surface composition.

Validation:

- Expo iOS export still passes.
- Existing native Discover and Build behavior is unchanged.
- No new product behavior in this phase except clean component boundaries.

## Phase 3: Native Bottom Sheet Parity

Implement a native snap sheet matching mobile web semantics:

- `peek`: mode switch and short content.
- `half`: primary route browsing/building surface.
- `full`: full list/detail interaction.

Discover peek:

- mode switch tabs;
- recommended route chips using shared discovery route card/chip model;
- chip tap loads route and switches to Build peek.

Build peek:

- selected route/new route label;
- point count and distance;
- Details chip for selected catalog route.

Technical notes:

- Use `Animated` and `PanResponder` or a focused gesture dependency already
  accepted in the app.
- Make map fit account for sheet height.
- Keep map gestures usable when the sheet is collapsed.

Validation:

- Native app opens with useful peek content.
- Drag/tap transitions between peek/half/full.
- Discover filters and scroll position survive mode changes.
- Route selection drops to Build peek, matching mobile web.

## Phase 4: Native Discover Parity

Build on shared discovery view models.

Implement:

- near-me toggle using native location fix and shared near-me helpers;
- scalable start/through place filter search, not fixed chip truncation;
- stable color swatches on route cards/chips;
- recommended route overlays on native map from bundled snapshots;
- lazy snapshot loading/prefetch comparable to web;
- bright/ghost overlay tiers for visible/nearby routes where practical;
- route card details/open actions preserved.

Validation:

- Filter result counts match mobile web for representative combinations.
- Near-me ordering matches shared helper output.
- Discover route overlays appear without loading the selected route.
- Selecting each catalog route still loads the planner route offline.
- Expo iOS export includes required assets.

## Phase 5: Native Build Parity

Build should become the route cockpit, not just a compact status sheet.

Implement:

- stat cards for distance, climb, descent;
- route playback controls rendered natively;
- interactive elevation graph wired to playback cursor and map marker;
- active POI list with route-distance labels;
- POI item tap focuses marker/card on map;
- playback cue preview equivalent to mobile web;
- visible selected-waypoint remove action;
- route clear/undo/redo continue to clear selected catalog identity.

Technical notes:

- Use shared playback model from Phase 1.
- Keep `ElevationProfileChart` if it can be extended; replace only if the web
  panel graph behavior cannot be matched cleanly.
- Continue using native share sheet for sharing.

Validation:

- Loading a catalog route shows stats, playback, elevation, and POIs.
- Manually built routes show the same Build controls where data exists.
- Scrubbing elevation/playback moves the native map cursor.
- POI list order and distances match web.

## Phase 6: Native Route Detail and Route Playback

Upgrade the existing native detail modal:

- play route from detail;
- show route-map/hero media consistently;
- include all active POIs, not only the first eight, with progressive disclosure
  if needed;
- show warnings/route caveats from snapshot data;
- preserve open-in-planner as the primary action.

Non-goal:

- Do not render web story JSX. Use structured catalog/snapshot content.

Validation:

- Every catalog entry has a useful native detail surface.
- Route detail works with Metro off in an offline iOS export.
- Detail playback and Build playback use the same shared model.

## Phase 7: Offline and Device QA

Hardening tasks:

- Add an asset audit test for every catalog/snapshot image path in native
  `IMAGE_ASSETS`.
- Add native bundle-size reporting for route images and snapshots.
- Run `npm run mobile:ios:offline` on a physical device.
- Kill Metro and verify:
  - app launches;
  - Discover loads;
  - route details load images/text;
  - selected route loads;
  - Build playback/elevation/POIs work.

Validation:

- Physical iPhone smoke test recorded in this plan.
- Any Mapbox network limitation is documented separately from bundled app-data
  offline behavior.

## Suggested First Implementation Slice

The next approved coding slice should be:

1. Extract shared discovery/build view models.
2. Split native `MapScreen.jsx` into `DiscoverSurface`, `BuildSurface`, and
   `RouteDetailModal` without behavior change.
3. Add native bottom sheet peek/half/full and route chips.

This creates the structure needed for near-me, map overlays, and playback
without making the current monolithic native screen harder to change.

## Validation Commands

Run after each implementation phase:

```bash
npm test
npm run build
npx --no-install expo export --platform ios --output-dir /tmp/isravelo-mobile-export-parity
npx playwright test tests/e2e/discover-route-page-cta.spec.mjs tests/e2e/mobile-sheet.spec.mjs
```

Run for offline/device phases:

```bash
npm run mobile:assets
npm run mobile:ios:offline -- --device
```
