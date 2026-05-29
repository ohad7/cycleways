# RN Mobile — Phase 2.2: RN MapSurface renders the network (@rnmapbox/maps)

**Date:** 2026-05-29
**Status:** Approved (design)
**Branch:** `claude/iphone-app`

## Purpose

Second phase of the RN vertical slice. Render the **cycleway network** on a
native Mapbox map in `apps/mobile`, using the **shared** appearance logic from
`@cycleways/core`, on a custom dev-client build in the iOS Simulator. Proves
native Mapbox + shared styling on device. Builds on Phase 2.1 (Expo app + Metro
resolves core).

## Scope

**In:** move network appearance logic + `mapStyles` into `core`; add
`@rnmapbox/maps`; bundle a network GeoJSON snapshot; an RN `MapScreen` rendering
the colored network; dev-client build + simulator run. **Out:** route geometry /
points / interactions / `useCyclewaysApp` (Phase 2.4), native platform adapters
(Phase 2.3), routing shards.

## A. Boundary moves into `core` (pure, behavior-neutral on web)

- `src/map/mapStyles.js` → `packages/core/src/map/mapStyles.js`; the web
  `mapLayers*` import it from `@cycleways/core/map/mapStyles.js`.
- `getRouteFeatureColor` + `prepareRouteNetworkFeatures` (currently in web
  `src/map/mapLayers.product.js`, pure) → `packages/core/src/domain/routeNetwork.js`;
  web `mapLayers.product.js` imports/re-exports them from core. These set
  `feature.properties.routeColor/routeWidth/routeOpacity`, so web and RN color
  the network identically from the same code.

Guard: `npm test` + `npm run build` stay green; the `tests/test-map-layers.mjs`
suite (which imports `getRouteFeatureColor`) still passes (now via core).

## B. Bundled network data

Copy a snapshot of `public-data/bike_roads.geojson` (≈398 KB) to
`apps/mobile/assets/data/network.json` and `require()` it (Metro inlines JSON;
`.json` is a default source ext). No runtime network needed for the map.
(A later phase wires the live/offline data pipeline; for 2.2 a committed snapshot
is fine.)

## C. The RN map (`apps/mobile`)

- Dependency: `@rnmapbox/maps@^10.3.1` (peers `react-native >=0.79`, `expo >=47`
  — compatible with our RN 0.85 / Expo 56).
- `app.json`: register the `@rnmapbox/maps` Expo **config plugin**
  (`RNMapboxMaps`), with the iOS SDK download token taken from the
  `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` env var at prebuild/build time. Add
  `expo.extra.mapboxPublicToken` for the runtime `pk` token.
- Tokens: `sk` (secret, `DOWNLOADS:READ`) lives only in `~/.netrc` (never
  committed); `pk` (publishable) in `app.json extra` → `Mapbox.setAccessToken(pk)`
  at app startup.
- `apps/mobile/src/MapScreen.jsx`: `Mapbox.MapView` + `Mapbox.Camera`
  (centerCoordinate ≈ `[35.5876, 33.17]`, zoomLevel ≈ 11.5) + `Mapbox.ShapeSource`
  whose `shape` is `{ type:"FeatureCollection", features: prepareRouteNetworkFeatures(network) }`
  (import from `@cycleways/core/domain/routeNetwork.js`) + `Mapbox.LineLayer`
  styled `{ lineColor:["get","routeColor"], lineWidth:["get","routeWidth"], lineOpacity:["get","routeOpacity"], lineJoin:"round", lineCap:"round" }`.
- `App.js` renders `MapScreen`.

The LineLayer style is the camelCase `@rnmapbox` form of the shared
`ROUTE_NETWORK_LINE_STYLE` paint, reading the same feature properties core bakes
in — so appearance matches web without duplicating the color logic.

## D. Build / run (attempted locally)

1. User adds `sk` to `~/.netrc`:
   ```
   machine api.mapbox.com
     login mapbox
     password sk.<...>
   ```
   and their `pk` into `app.json extra.mapboxPublicToken`.
2. `cd apps/mobile && npx expo prebuild -p ios` (generates `ios/`).
3. `npx expo run:ios` — CocoaPods pulls the Mapbox SDK (via the netrc token),
   Xcode builds the dev client, launches on the iOS Simulator. (Expo Go no longer
   applies — custom native module.)

## E. Verification

- `npm test` + `npm run build` (web) green after the `core` moves.
- `cd apps/mobile && npx expo export -p ios` bundles the JS (incl. `@rnmapbox`)
  with no unresolved imports.
- **Primary gate:** the dev client builds and runs in the iOS Simulator showing
  the colored cycleway network. Screenshot.

## Risks

- Native build is slow + requires the `sk`/`~/.netrc`.
- `@rnmapbox` on RN 0.85 New Architecture — peer range says OK; the first native
  build is the real test. If it fails on new-arch, options: pin a compatible
  `@rnmapbox`, or set `newArchEnabled:false` in `app.json` as a fallback.
- `prebuild` generates `ios/` (a large native project) — gitignore it (keep the
  repo CNG/"managed"); the build is reproducible from config.
