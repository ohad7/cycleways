# CycleWays → React Native transition — Handoff

**For:** the next agent continuing this work. **Date:** 2026-05-30.
**Branch:** `claude/iphone-app` (all work below lives here, NOT merged to `main`).

> Also read: the project memory `iphone-app-direction` (auto-loaded; the most
> detailed running record), `CLAUDE.md` (repo conventions — all design/plan docs
> live under `plans/<topic>/`), and the per-topic specs in `plans/`.

## 1. Goal & strategy

Build a **React Native iPhone app** (route planning + live GPS nav + offline maps)
that **shares most of the React/JS code** with the existing Vite web app. Strategy
locked earlier: **npm-workspaces monorepo + `@cycleways/core` package**, **Expo +
`@rnmapbox/maps`**, native UI on the shared `useCyclewaysApp` hook, built as a
**thin vertical slice first**. Every web-side step is **zero-behavior-change**,
verified against a fixed guard (below).

## 2. The verification guard (run after any change touching shared/web code)

- `npm test` → **9/9 route-manager + all JS green** (hard gate).
- `npm run build` → succeeds.
- web dev-probe: start `npm run dev -- --port 51xx`, load
  `/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un`, assert `#root` non-empty + the
  route-description shows a `ק"מ` distance + no page errors (catches blank-page
  crashes the build misses).
- `npm run test:smoke` → **baseline = 40 pass / 12 fail / 1–2 skipped**. The 12
  failures are PRE-EXISTING stale specs (reworked discover panel, a nav link, a
  `3.8→3.9` km value, the `.route-inline-warning` selector) — **unrelated**; the
  bar is "no NEW failures." CI runs `test:smoke`, so those 12 are red in CI too.

## 3. What's DONE and verified (web-side shared core)

All committed on `claude/iphone-app`. The platform-agnostic shared layer is
complete:
- **Map-surface abstraction** (`plans/map-surface-abstraction/`): `src/map/` split
  into `MapSurface.jsx` (portable contract — see `src/map/MapSurface.contract.md`)
  + web-only `OsmDebugOverlay.jsx` + thin `MapView.jsx`; `mapStyles`,
  `mapInteractions`, `mapboxProvider`, `mapLayers.product/debug` extracted.
- **Engine importable** (`plans/engine-importable-module/`): `route-manager.js`
  is no longer a `window.RouteManager` `<script>` global — it's imported. Kept
  CommonJS (editor server, scripts, ~25 tests `require` it); a Vite plugin
  `routeManagerEsmPlugin` (in `vite.config.mjs`) rewrites `module.exports`→
  `export default` for the web bundle; Metro consumes the CJS natively.
- **App platform seams** (`plans/app-platform-services/`): `src/platform/`
  location + storage adapters; App stopped touching `window`/`localStorage`
  directly.
- **App controller hook** (`plans/app-controller-hook/`): all of App.jsx's
  orchestration moved verbatim into `packages/core/src/app/useCyclewaysApp.js`
  (a ~54-key `{state + handlers}` hook); `src/App.jsx` is a thin web view.
- **Monorepo + `@cycleways/core`** (`plans/monorepo-core-package/`): npm
  workspaces; web stays at repo root; `packages/core` holds engine + routing +
  utils + data + `app/useCyclewaysApp` + `domain/` + `config/` + `platform/`
  (web impls: location, storage, analytics, download, and now **assets**).
  **CRITICAL invariant** (`packages/core/README.md`): `packages/core/package.json`
  has **no `"type"`** (so the CJS engine is `require`-able); `packages/core/src/
  package.json` is `{"type":"module"}`. Do NOT add `type:module` to the core root.

## 4. RN app progress (`apps/mobile`, Expo SDK 56 / RN 0.85 / React 19.2.3)

- **Phase 2.1 DONE** (`plans/rn-mobile-scaffold/`): Expo app added to the
  workspace; `metro.config.js` (watchFolders + nodeModulesPaths +
  `unstable_enablePackageExports`) resolves `@cycleways/core`. Run with
  **`npm run mobile:ios`** / `npm run mobile` (root scripts). NB: running
  `npx expo start` at the **repo root** fails (AppEntry fallback) — always use the
  workspace scripts / run from `apps/mobile`.
- **Phase 2.2 DONE + RUNS ON SIMULATOR** (`plans/rn-map-surface/`): native
  `@rnmapbox/maps@10.3.1` renders the cycleway network colored by shared core
  logic (`core/domain/routeNetwork.js` `prepareRouteNetworkFeatures` /
  `getRouteFeatureColor`; `core/map/mapStyles.js`). Network bundled at
  `apps/mobile/assets/data/network.json`. `apps/mobile/src/MapScreen.jsx`.
  Built new-arch on RN 0.85. **Verified visually on the iOS 17.5 simulator.**
- **Phase 2.3a DONE (web-verified)** (`plans/rn-asset-transport/`, commit
  `9a722f6`): `core/src/platform/assets.js` transport (`getJsonAsset`,
  `getBinaryAsset`, `resolveAssetPath`); `mapAssets.js` + `baseRoutingShards.js`
  route through it (no direct `fetch`/`import.meta`/`window.location`). Web impl
  only; zero behavior change. **npm test 9/9, build, dev-probe clean. The full
  smoke was running at handoff — FIRST ACTION: confirm it shows the 40/12
  baseline** (output: the last `npm run test:smoke`; re-run if unsure).

## 5. RN build gotchas (all hit + resolved — important!)

- **Tokens:** `pk` (publishable) in `apps/mobile/.env` as `EXPO_PUBLIC_MAPBOX_TOKEN`
  (gitignored); `sk` (secret, scope `DOWNLOADS:READ`) in `~/.netrc`
  (`machine api.mapbox.com / login mapbox / password sk…`). The pk token MUST be
  the **full ~90-char** token (a truncated one → 401); the working one is in the
  repo-root `mapbox-token.js`.
- **`EXPO_PUBLIC_*` is inlined at transform time and CACHED** → after editing
  `.env` you MUST restart Metro with `--clear` (`expo start --dev-client -c`).
- **Simulator:** Xcode hung "verifying iOS 26.2 simruntime" → **build against the
  iOS 17.5 iPhone 15**: `npx expo run:ios --device 961E0C3E-618E-4B0E-BF07-6E223BB67F51`.
- `apps/mobile/ios/` is gitignored (CNG); regenerate with `npx expo prebuild -p ios`.
- The `MapScreen` shows a "set token" hint if `EXPO_PUBLIC_MAPBOX_TOKEN` is empty.

## 6. What's NEXT

- **Phase 2.3b** (next): RN offline data + adapters. User chose **bundle
  everything (offline)**. Bundle the `public-data` subset (segments/network/
  cw-base-index/manifests ≈550KB + the **115 `.cwb` routing shards** ≈4.9MB) into
  `apps/mobile`; a codegen script generates a static shard require-map (Metro
  needs literal `require()` paths); add `cwb` to Metro `assetExts`; write
  `core/src/platform/assets.native.js` (bundled JSON via require; shard bytes via
  `expo-asset` + `expo-file-system`) implementing the SAME `getJsonAsset`/
  `getBinaryAsset` interface as the web `assets.js`. Plus the simple `.native.js`
  adapters: `location` (deep-link/no-op + `getShardLoaderLocation` returns the
  bundled base), `storage` (AsyncStorage), `analytics` (no-op), `download`
  (share/no-op). **Verify on device with airplane mode on.**
  NB: `core/src/config/featureFlags.js` still reads `window` directly — route it
  through `platform/storage` if RN needs flags (tracked low-risk follow-up).
- **Phase 2.4:** wire `useCyclewaysApp` into the RN UI — render a decoded route
  (`routeState.geometry`) on `MapScreen`, one interaction (tap → add point →
  recalc). Proves the full shared controller runs offline on device.
- **Then:** (4) full planning UI, (5) GPS nav, (6) offline maps polish, (7)
  release. Optional: split `useCyclewaysApp` into focused hooks.

## 7. Useful commands / map

- Web: `npm run dev` / `npm run build` / `npm test` / `npm run test:smoke`.
- Mobile: `npm run mobile:ios` (= `expo run:ios` in apps/mobile); rebuild native
  via `npx expo prebuild -p ios` then `npx expo run:ios --device <iOS-17.5-udid>`.
- Shared code: `packages/core/src/{routing,utils,data,app,domain,config,platform,map}`
  + `packages/core/route-manager.js`. Web entry: `src/App.jsx` (thin) + `src/map/*`
  + `src/components/*` (web-only UI). RN: `apps/mobile/`.
- Editor server (`editor/server.mjs`) + `scripts/*` still `require` the CJS engine
  at `packages/core/route-manager.js` — don't break that path.

## 8. Process notes

- Use the superpowers **brainstorming → writing-plans → subagent-driven/executing**
  flow for each phase (the user expects design specs in `plans/<topic>/` before
  code). The user is fine with autonomous execution but wants designs written
  down and verified. Keep changes web-neutral until the RN `.native` impls exist.
