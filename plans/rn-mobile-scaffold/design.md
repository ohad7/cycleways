# RN Mobile — Phase 2.1: Expo scaffold + Metro resolves `@cycleways/core`

**Date:** 2026-05-29
**Status:** Approved (design); scaffolding in progress
**Branch:** `claude/iphone-app`

## Purpose

First phase of sub-project 2 (RN vertical slice). Stand up an Expo app
(`apps/mobile`) in the monorepo that imports from `@cycleways/core` and runs,
proving **Metro resolves and bundles the shared package** (CommonJS engine + ESM
modules) on iOS. No map, no native modules yet — so it runs in **Expo Go** (no
custom dev-client build needed; `@rnmapbox` is Phase 2.2).

This isolates the riskiest unknown — does the workspace `core` resolve under
Metro (package `exports`, CJS/ESM split, symlink) — before any native-build
complexity.

## Scope

**In:** `apps/mobile` Expo app; add `apps/*` to root workspaces; monorepo-aware
`metro.config.js`; a proof screen importing the CJS engine + an ESM util from
`@cycleways/core` and rendering the result. **Out:** `@rnmapbox`/map, native
platform adapters, bundled map data, `useCyclewaysApp` (Phases 2.2–2.4).

## Architecture

```
/package.json            # workspaces: ["packages/*", "apps/*"]
apps/mobile/
  package.json           # @cycleways/mobile; expo + react + react-native; "@cycleways/core": "*"
  app.json               # name/slug/ios.bundleIdentifier
  babel.config.js        # babel-preset-expo
  metro.config.js        # workspace-aware (watchFolders + nodeModulesPaths + package exports)
  index.js               # registerRootComponent(App)
  App.js                 # proof screen
```

**Metro config (the crux):** start from `expo/metro-config` `getDefaultConfig`,
then:
- `config.watchFolders = [workspaceRoot]` (so Metro watches `packages/core`).
- `config.resolver.nodeModulesPaths = [<app>/node_modules, <root>/node_modules]`.
- `config.resolver.unstable_enablePackageExports = true` so `@cycleways/core`'s
  `exports` map (`"./*": "./src/*"`, `"./route-manager.js"`) resolves.
Metro consumes the CommonJS engine natively (no Vite-style transform needed).

**Proof screen (`App.js`):** import `RouteManager` (CJS) from
`@cycleways/core/route-manager.js` and `getDistance` (ESM) from
`@cycleways/core/utils/distance.js`; render a `<Text>` showing
`typeof RouteManager` and a computed distance between two coords. Rendering both
proves CJS + ESM core modules resolve through the workspace on device.

**Version note (monorepo React):** the web app uses React 19; the Expo app
declares its own Expo-compatible React/React Native. Metro is configured to
resolve the app's own copies. If npm hoisting causes a React version conflict,
pin/align versions so React Native gets a compatible React. (This is part of what
Phase 2.1 flushes out.)

## Verification

- `npx expo export --platform ios` (run inside `apps/mobile`) → Metro bundles
  with no unresolved `@cycleways/core` imports. Automatable proof.
- Run in **Expo Go** on the iOS Simulator: `npx expo start` then press `i`;
  confirm the screen renders the engine type + computed distance. Screenshot.
- Web app unaffected: `npm test` + `npm run build` at root still green (adding a
  workspace + app must not change web behavior).

## Risks

- **Metro package-`exports` resolution** of `@cycleways/core` subpaths — the main
  unknown; `unstable_enablePackageExports` addresses it; verified by `expo export`.
- **React version hoisting** between web (React 19.2.x) and Expo's React — resolve
  by aligning/pinning if it surfaces.
- **Heavy install** (expo + react-native) — expected; one-time.
