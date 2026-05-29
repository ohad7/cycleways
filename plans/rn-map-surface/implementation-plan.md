# RN Mobile — Phase 2.2 Implementation Plan

**Goal:** Render the cycleway network on a native `@rnmapbox/maps` map in
`apps/mobile`, using shared appearance logic from `@cycleways/core`. See
`plans/rn-map-surface/design.md`.

**Branch** `claude/iphone-app`, no branch ops. Web stays green; the mobile build
is the new gate.

---

### Task 1 — Move network appearance + mapStyles into core (web-neutral)
- [ ] `git mv src/map/mapStyles.js packages/core/src/map/mapStyles.js`.
- [ ] Move `getRouteFeatureColor` + `prepareRouteNetworkFeatures` from
      `src/map/mapLayers.product.js` into new `packages/core/src/domain/routeNetwork.js`
      (verbatim; `getRouteFeatureColor` is pure, `prepareRouteNetworkFeatures` calls it).
- [ ] Repoint web: `src/map/mapLayers.product.js` + any other `src/map/*` and
      `src/map/mapLayers.js` barrel → import `mapStyles` symbols from
      `@cycleways/core/map/mapStyles.js`, and `getRouteFeatureColor`/
      `prepareRouteNetworkFeatures` from `@cycleways/core/domain/routeNetwork.js`
      (re-export from `mapLayers.product.js` for back-compat). Fix intra-core
      relative imports inside the moved files.
- [ ] Update `tests/test-map-layers.mjs` import of `getRouteFeatureColor` →
      `@cycleways/core/domain/routeNetwork.js`.
- [ ] Verify: `npm test` 9/9 + all JS; `npm run build` green; web dev-probe
      (route loads) clean.
- [ ] Commit: `refactor(core): move network appearance logic + mapStyles into core`.

### Task 2 — Bundle the network snapshot
- [ ] Copy `public-data/bike_roads.geojson` → `apps/mobile/assets/data/network.json`.
- [ ] Commit: `chore(mobile): bundle cycleway network snapshot`.

### Task 3 — Add @rnmapbox/maps + tokens config
- [ ] In `apps/mobile`: `npm install @rnmapbox/maps@^10.3.1 -w @cycleways/mobile` (or add to its package.json + root install).
- [ ] `app.json`: add to `expo.plugins` the entry
      `["@rnmapbox/maps", { "RNMapboxMapsDownloadToken": "${RNMAPBOX_MAPS_DOWNLOAD_TOKEN}" }]`
      (token from env at build) and add `expo.extra.mapboxPublicToken` (the pk; can be
      a placeholder committed, real value supplied locally).
- [ ] `.gitignore` (root or apps/mobile): ignore `apps/mobile/ios/` and
      `apps/mobile/android/` (prebuild output — CNG, reproducible from config).
- [ ] Commit: `feat(mobile): add @rnmapbox/maps + config plugin`.

### Task 4 — RN MapScreen renders the network
- [ ] Create `apps/mobile/src/MapScreen.jsx`: at module load
      `Mapbox.setAccessToken(Constants.expoConfig.extra.mapboxPublicToken)`; render
      `Mapbox.MapView` (style flex:1) + `Mapbox.Camera` (centerCoordinate
      `[35.5876, 33.17]`, zoomLevel 11.5) + `Mapbox.ShapeSource` id="network"
      shape `{type:"FeatureCollection", features: prepareRouteNetworkFeatures(require("../assets/data/network.json"))}`
      (import `prepareRouteNetworkFeatures` from `@cycleways/core/domain/routeNetwork.js`)
      + `Mapbox.LineLayer` id="network-line" style
      `{ lineColor:["get","routeColor"], lineWidth:["get","routeWidth"], lineOpacity:["get","routeOpacity"], lineJoin:"round", lineCap:"round" }`.
- [ ] `App.js`: render `<MapScreen/>` (full-screen).
- [ ] Verify JS bundles: `cd apps/mobile && npx expo export -p ios` → no unresolved imports.
- [ ] Commit: `feat(mobile): render cycleway network with @rnmapbox MapScreen`.

### Task 5 — Native dev-client build + simulator (needs sk token)
- [ ] User: add `sk` token to `~/.netrc` (machine api.mapbox.com / login mapbox /
      password sk…) and real `pk` to `app.json extra.mapboxPublicToken`.
- [ ] `cd apps/mobile && RNMAPBOX_MAPS_DOWNLOAD_TOKEN=sk… npx expo prebuild -p ios`.
- [ ] `npx expo run:ios` → builds dev client, launches simulator.
- [ ] Confirm the colored network renders; screenshot. If new-arch build fails,
      fallback: set `expo.newArchEnabled:false` in app.json and rebuild.

### Task 6 — Verify web unaffected + wrap
- [ ] `npm test` + `npm run build` green; smoke = baseline (the core moves are
      web-neutral; run smoke once).
