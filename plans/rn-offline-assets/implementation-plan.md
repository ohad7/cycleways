# Phase 2.3b Implementation Plan - bundled offline data and native adapters

**Goal:** Bundle the `public-data` route/map subset into `apps/mobile`, generate
Metro static requires, and add native `@cycleways/core` platform adapters.

**Gate:** web behavior unchanged (`npm test`, `npm run build`, dev probe);
mobile bundle can resolve the native asset transport and `.cwb` assets.

## Tasks

- [x] Add a mobile asset sync/codegen script that copies the stable `public-data`
      subset into `apps/mobile/assets/data/public-data` and generates
      `packages/core/src/platform/bundledAssets.native.js`.
- [x] Add npm scripts so mobile start/build commands run the sync before Expo.
- [x] Extend `apps/mobile/metro.config.js` with `cwb` in `assetExts`.
- [x] Add `packages/core/src/platform/assets.native.js` implementing the same
      asset transport interface as the web transport.
- [x] Add native siblings for location, storage, analytics, and download.
- [x] Run the sync script and inspect generated assets.
- [x] Verify `npm test` and `npm run build`.
- [x] Verify the mobile bundling path with Expo/Metro.
- [x] Re-run `npm run test:smoke`; accept only the known stale-spec baseline or
      document a pre-existing setup issue clearly.

## Result

Implemented on 2026-05-30. Expo iOS export includes the bundled offline shard
assets, and the web guard remains at the expected baseline.
