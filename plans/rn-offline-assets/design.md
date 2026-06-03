# RN Mobile - Phase 2.3b: bundled offline data and native platform adapters

**Date:** 2026-05-30
**Status:** Implemented
**Branch:** `codex/iphone-app-handoff`

## Purpose

Make the Expo iPhone app independent of web-hosted data for the routing/map data
slice. The mobile app should bundle the same stable `public-data` assets the web
app loads at runtime: map manifest, network GeoJSON, segments, cw-base index,
routing-shard manifest, and all compact `.cwb` routing shards.

This phase does not wire the full `useCyclewaysApp` planner UI into React Native;
it provides the native asset and platform services needed for that next phase.

## Scope

In:

- Copy the required `public-data` subset into `apps/mobile/assets/data/public-data`.
- Generate a static Metro-compatible require map for bundled JSON and `.cwb`
  files.
- Add `.cwb` to Metro asset extensions.
- Add native platform service siblings in `packages/core/src/platform/*.native.js`.
- Keep the web asset transport and web behavior unchanged.

Out:

- Full native route-planning UI.
- Native GPS/navigation mode.
- Offline Mapbox tile packs.
- Refactoring `useCyclewaysApp` beyond small native compatibility follow-ups.

## Asset Layout

The app stores bundled data under:

```text
apps/mobile/assets/data/public-data/
  map-manifest.json
  bike_roads.geojson.json
  segments.json
  cw-base-index.json
  base-routing-shards/
    manifest.json
    shards/*.cwb
```

The generated file lives in core so platform imports remain inside
`@cycleways/core`:

```text
packages/core/src/platform/bundledAssets.native.js
```

It exports two maps:

- `JSON_ASSETS`: logical path -> literal `require(...)` JSON module.
- `BINARY_ASSETS`: logical path -> literal `require(...)` Metro asset module.

Metro requires literal paths to include assets in the bundle, so a generated
static map is safer than dynamic `require()` or filesystem globbing.
The logical key remains `public-data/bike_roads.geojson`; only the bundled copy
uses a `.json` suffix because Metro treats `.json` as parseable JSON by default.

Core uses explicit `.js` ESM imports so Node and Vite can run the same source.
Metro does not substitute `.native.js` for those explicit relative imports, so
the mobile Metro config aliases the core platform service files to their native
siblings for iOS/Android bundles.

## Native Asset Transport

`packages/core/src/platform/assets.native.js` implements the same public
interface as `assets.js`:

- `resolveAssetPath(filePath, basePath)`
- `getJsonAsset(filePath, { basePath })`
- `getBinaryAsset(relativePath, { baseHref, sha256 })`

JSON assets are loaded directly from the generated `JSON_ASSETS` map. Query
strings such as `?t=` and `?v=` are stripped for lookup because they are cache
busters on web, not separate mobile assets.

Binary shard assets are loaded from the generated `BINARY_ASSETS` map via
`expo-asset` and `expo-file-system`. The module is resolved with
`Asset.fromModule(...).downloadAsync()`, then read as an `ArrayBuffer` using the
Expo file API. The existing shard decoder receives the same bytes it receives
from `fetch(...).arrayBuffer()` on web.

## Native Platform Adapters

The minimal native adapters are intentionally conservative:

- `location.native.js`: no-op query params and a synthetic `cycleways:///` base
  href for shard URL resolution.
- `storage.native.js`: synchronous in-memory storage for the current thin slice.
  A later UI phase can introduce async persistence deliberately if the hook API
  changes.
- `analytics.native.js`: no-op tracking with the same exported function names.
- `download.native.js`: no-op GPX download placeholder.

These let shared imports resolve on React Native without pulling browser globals
into the bundle.

## Verification

- `npm test` passed.
- `npm run build` passed.
- Dev probe passed on
  `/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un`: non-empty `#root`, `4.5 ק"מ`
  route text, and no captured browser errors.
- `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-native`
  passed and listed all 115 `.cwb` routing shards as bundled iOS assets.
- `npm run test:smoke` returned the recorded stale-spec baseline:
  40 passed / 12 failed / 2 skipped.

The key invariant is that web tests remain unchanged and the mobile bundle can
resolve every logical asset path used by `loadMapAssets()` and
`createBaseRoutingShardFetchLoader()`.
