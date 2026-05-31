# CycleWays → React Native transition — Handoff

**For:** the next agent continuing this work. **Date:** 2026-05-30.
**Updated:** 2026-05-31 for the revised mobile-web parity objective.
**Branch:** current continuation branch is `codex/iphone-app-handoff` (prior
handoff text referred to `claude/iphone-app`; do not assume this is merged to
`main`).

> Also read: the project memory `iphone-app-direction` (auto-loaded; the most
> detailed running record), `CLAUDE.md` (repo conventions — all design/plan docs
> live under `plans/<topic>/`), and the per-topic specs in `plans/`.

## 1. Goal & strategy

Build a **React Native iPhone app** whose route-planning experience feels like
the existing **mobile web planner**, while using native rendering where iPhone
ergonomics require it. The underlying structure should stay shared: route/search
state and behavior live behind `useCyclewaysApp` and shared core helpers; web and
iPhone differ mainly in rendering and native-device integrations.

The current objective is **mobile-web route-planner parity**, not a new
navigation-mode product pass. The iPhone app should keep the web planner's core
look, Hebrew copy, route-planning controls, route summary/share/download
semantics, map legend, warning behavior, and planner feedback. Small iPhone
adjustments are expected only where the platform needs them: the irrelevant web
content below the map is omitted, route details live in a bottom sheet, and
native affordances such as current-location follow and iOS share sheets are
visually integrated without changing the shared planner state model.

Strategy locked earlier: **npm-workspaces monorepo + `@cycleways/core` package**,
**Expo + `@rnmapbox/maps`**, native UI on the shared `useCyclewaysApp` hook,
built as a **thin vertical slice first**. The technical vertical slices are now
working, but the native route-planning UI must be realigned with the mobile web
look/copy/control model before adding more native-only feature depth. Every
web-side step is **zero-behavior-change**, verified against a fixed guard
(below).

### Current parity architecture

- Shared state/behavior: `packages/core/src/app/useCyclewaysApp.js` remains the
  shared controller for web and native route planning.
- Shared presentation: `packages/core/src/ui/routePlannerPresentation.js` now
  owns pure planner copy/formatting for route messages, stats, download
  eligibility, selected-point state, warnings, and route-warning grouping.
- Web rendering: `src/App.jsx` and `src/components/RoutePanel.jsx` consume the
  shared presentation helpers while keeping web DOM/classes and behavior stable.
- Native rendering: `apps/mobile/src/MapScreen.jsx` renders the iPhone-specific
  map, top search chrome, control rail, legend, bottom route sheet, summary
  modal, location follow control, and native share/GPX behavior on top of the
  same shared controller.

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

The platform-agnostic shared layer is complete:
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
  smoke was rerun after restoring workspace symlinks and shows the 40/12/2
  baseline.**
- **Phase 2.3b DONE (verified)** (`plans/rn-offline-assets/`): mobile offline
  data sync/codegen now copies the required `public-data` subset into
  `apps/mobile/assets/data/public-data`, generates
  `packages/core/src/platform/bundledAssets.native.js`, adds `.cwb` Metro asset
  support, and provides native `assets/location/storage/analytics/download`
  platform adapters. `MapScreen` now loads its network from `loadMapAssets()`
  through the native asset transport. Verified with `npm test`, `npm run build`,
  dev-probe, `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-native` (115 `.cwb` shards bundled), and
  `npm run test:smoke` = **40 pass / 12 fail / 2 skipped**.
- **Phase 2.4 DONE + RUNS ON SIMULATOR** (`plans/rn-controller-ui/`):
  `apps/mobile/src/MapScreen.jsx` now renders from the shared
  `useCyclewaysApp` controller. The native map renders the offline network,
  route geometry, route points, a compact status/clear overlay, viewport shard
  prefetch, and tap-to-add routing via `handleMapClick({ lng, lat })`. A local
  gitignored `apps/mobile/.env` was populated from the existing publishable
  root `mapbox-token.js` token so the simulator opens the map instead of the
  token hint. Verified with `npm test`, `npm run build`,
  `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-controller-final` (115 `.cwb` shards bundled),
  `npm run test:smoke` = **40 pass / 12 fail / 2 skipped**, and
  `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` on the booted
  iOS 17.5 iPhone 15 simulator. Manual simulator check: two taps produced a
  `Route ready` native route line with 2 points and 3.2 km distance.
- **Phase 2.5 DONE + RUNS ON SIMULATOR** (`plans/rn-mobile-planning-controls/`):
  the native overlay now exposes Undo, Redo, Fit, Remove, and Clear controls.
  Route points are tappable via native `ShapeSource.onPress`, selection is
  reflected in the shared `mapUi.selectedRoutePointIndex`, Remove calls
  `handleRoutePointRemove(index)`, Undo/Redo call the shared history handlers,
  and Fit drives the native `Camera` to route bounds while also honoring restored
  route fit requests. Verified with `npm test`, `npm run build`,
  `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-planning-controls`, and simulator smoke on
  `961E0C3E-338F-4311-BD0B-72C2BF47C03B`: add 2 points, select a waypoint,
  remove it, undo restore, fit camera, redo back to 1 point.
- **Phase 2.6 DONE + RUNS ON SIMULATOR** (`plans/rn-mobile-search/`):
  the native overlay now includes a `TextInput` search row wired to shared
  `mapUi.searchQuery`/`handleSearchSubmit`, renders `mapUi.searchHighlight` as
  native Mapbox circle layers, moves the native camera to successful results,
  and adds the active result through the existing `handleMapClick({ lng, lat })`
  routing path. Verified with `npm test`, `npm run build`,
  `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-search` (115 `.cwb` shards bundled), and simulator
  smoke on `961E0C3E-338F-4311-BD0B-72C2BF47C03B`: search `Kfar Blum`, Add first
  point, search `HaGoshrim`, Add second point, route renders as `Route ready`
  with 2 points and 7.6 km.
- **Phase 2.7 DONE + RUNS ON SIMULATOR** (`plans/rn-mobile-location/`):
  the native app now has an iOS when-in-use location permission string, renders
  RNMapbox native user location through `UserLocation`, normalizes location
  updates locally in `MapScreen`, and exposes a compact Locate/Stop overlay
  control that toggles native camera follow mode. Verified with `npm test`,
  `npm run build`, `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-location-final` (115 `.cwb` shards plus the
  RNMapbox heading asset bundled), and simulator smoke on
  `961E0C3E-338F-4311-BD0B-72C2BF47C03B`: set simulator location to
  `33.1669,35.6079`, granted location permission to `app.cycleways.mobile`,
  tapped Locate, saw the map center on the blue user-location puck with Stop /
  Following location visible, tapped Stop, and confirmed it returned to Locate.
  Also verified the Locate/Clear header fits after adding a searched `Kfar Blum`
  route point.
- **Phase 2.8 IN PROGRESS** (`plans/rn-mobile-web-parity/`):
  first two parity slices are implemented. Pure route message/distance/stats
  helpers moved to `packages/core/src/ui/routePlannerPresentation.js`, the web
  `RoutePanel` now consumes that shared presentation helper, and native
  `MapScreen` now uses the same Hebrew route-planning copy in a light top search
  / control chrome plus bottom route sheet. Native `סיכום` now opens a
  route-summary modal with route points, selected route way, active-data
  warnings, route description, GPX, and share actions. Native GPX export uses the
  platform download adapter to write a GPX file into the Expo cache and open the
  iOS share sheet. Verified with `npm test`, `npm run build`,
  `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-slice`,
  `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-summary`, and an iPhone simulator
  screenshot at `/tmp/isravelo-parity-slice.png`. The app was also rebuilt and
  opened on the iOS 17.5 iPhone 15 simulator after the summary slice; Metro
  loaded viewport routing shards without runtime errors, and screenshot
  `/tmp/isravelo-parity-summary.png` confirmed the light Hebrew chrome and
  bottom route sheet still render. A mobile web screenshot was captured at
  `/tmp/isravelo-mobile-web-parity.png`; the native controls were then moved
  from a broad horizontal row into a compact right-side rail, closer to the
  mobile web planner, and verified with screenshot
  `/tmp/isravelo-parity-rail.png`, `npm test`, `npm run build`,
  `git diff --check`, and `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-rail`. A follow-up tightened those rail
  buttons to a fixed compact footprint so they no longer stretch to the widest
  Hebrew label; verified with screenshot `/tmp/isravelo-parity-rail-tight.png`,
  `npm test`, `npm run build`, `git diff --check`, and
  `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-rail-tight`. The search and rail
  controls were then switched to compact symbolic visible labels where the action
  maps to a familiar planning command, with full Hebrew action names retained as
  accessibility labels; verified with screenshot
  `/tmp/isravelo-parity-symbol-controls.png`, `npm test`, `npm run build`,
  `git diff --check`, and `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-symbol-controls`. Native now also
  renders the mobile-web `סוגי דרכים` legend over the map with the same route
  type labels/colors plus compact broken-route/data-warning chips; verified with
  screenshot `/tmp/isravelo-parity-legend.png`, `npm test`, `npm run build`,
  `git diff --check`, and `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-legend`. The rail now groups web-parity
  route commands separately from native helper commands, and the empty route
  sheet is shorter without the zero-value stats grid; verified with screenshot
  `/tmp/isravelo-parity-rail-sheet-density.png`, `npm test`, `npm run build`,
  `git diff --check`, and `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-rail-sheet-density`. The web and native
  legend warning controls now share route warning presentation helpers from
  `packages/core/src/ui/routePlannerPresentation.js`; web keeps the same
  warning-toggle DOM/classes, and native renders an expandable `⚠️ מידע חשוב`
  chip with grouped labels/colors/icons. This is covered by
  `tests/test-poi-types.mjs` and was verified with `npm test`, `npm run build`,
  `git diff --check`, `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-warning-toggle`, and simulator
  screenshot `/tmp/isravelo-parity-warning-toggle.png`.
- **Phase 2.8 interactive simulator smoke DONE + VERIFIED** (Slice 10,
  `plans/rn-mobile-web-parity/`): the previously-blocked interactive smoke now
  runs. **Maestro 2.6.0** drives the Simulator by `accessibilityLabel` (no more
  Computer Use click blocker). Reusable flows live in `apps/mobile/.maestro/`
  (`connectivity-check.yaml`, `parity-smoke.yaml`, `gpx-share-check.yaml`).
  `maestro --device 961E0C3E-… test .maestro/parity-smoke.yaml` passed end-to-end
  against the live dev-client over Metro: search `Kfar Blum`→add, search
  `HaGoshrim`→add, **route ready 7.6 ק"מ / 2 points / 9 CW segments / ↑54 ↓23**,
  undo, redo, select waypoint (`נקודה 2 נבחרה` + `הסר נקודה`), open `סיכום`
  (points + 9 named segments + `מידע חשוב` + description + GPX/share), reset,
  locate (native follow puck). `gpx-share-check.yaml` confirmed GPX export opens
  the iOS share sheet with a real `route_….gpx` (18 KB). Screenshots:
  `/tmp/maestro-route-ready.png`, `/tmp/maestro-waypoint-selected.png`,
  `/tmp/maestro-summary.png`, `/tmp/maestro-locate.png`,
  `/tmp/maestro-gpx-share2.png`.
- **Phase 2.8 expand-route-warnings smoke DONE + VERIFIED** (Slice 11,
  `plans/rn-mobile-web-parity/`): the last parity-smoke gap is closed.
  `apps/mobile/.maestro/warning-expand-smoke.yaml` builds a deterministic
  2-warning route via two map taps onto known warning-segment vertices (geocoded
  search points land off-network, so search can't force a warning route), then
  taps the legend `⚠️ מידע חשוב (2)` chip and asserts it expands into grouped
  rows `🚧 שער` (gate) + `⚠️ בוץ` (mud). Route = 5.4 ק"מ / 2 points / 2 CW
  segments, `יש 2 נקודות מידע חשובות במסלול`. Screenshots
  `/tmp/maestro-warning-route.png`, `/tmp/maestro-warning-expanded.png`. The taps
  assume the fixed launch camera (`GALILEE_CENTER`, zoom 11.5, iPhone 15) and
  must wait for the camera to settle after `launchApp`; run only one Maestro
  instance at a time (concurrent runners crash the XCTest driver).

## 4A. Mobile-web parity implementation details

Treat this as the source of truth for what has already been implemented in the
current parity pass:

- **Shared route planner presentation**:
  `packages/core/src/ui/routePlannerPresentation.js` exports
  `ROUTE_SEARCH_PLACEHOLDER`, `formatDistance`, `getRouteMessage`,
  `getRoutePlannerPresentation`, and warning helpers
  `getRouteWarningPresentation`, `getWarningGroups`, `getWarningTypes`,
  `getWarningLabel`, and `getWarningBackgroundColor`.
- **Web parity consumption**: `src/components/RoutePanel.jsx` now consumes the
  shared route planner helper and re-exports the formatting/message helpers for
  existing web callers. `src/App.jsx` consumes the shared warning presentation
  helper for the mobile-web legend warning toggle while preserving existing
  classes and DOM structure.
- **Native shared controller use**: `apps/mobile/src/MapScreen.jsx` uses
  `useCyclewaysApp()` for route state, search state, undo/redo availability,
  download/share state, map click routing, selected waypoint state, viewport
  shard prefetch, and route clear/remove/select handlers.
- **Native map rendering**: the iPhone app renders the offline cycleway network,
  calculated route geometry, route points, selected/pending point styling,
  search highlight circles, RNMapbox user location, and camera fit/follow
  behavior.
- **Top planner chrome**: native renders a light, mobile-web-like Hebrew search
  row with the shared placeholder `ישוב/עיר, לדוגמא: דפנה`, search submit,
  search error text, and an `הוסף` action for the active search result.
- **Right-side control rail**: native route commands are a compact right-side
  rail matching the mobile web mental model: undo, redo, reset, and summary.
  iPhone-only helper controls, fit route and locate/follow current location, are
  visually separated below the route commands. Visible labels are compact
  symbols where appropriate, with Hebrew accessibility labels retained.
- **Bottom route sheet**: native route description, route warnings, location
  status, route point chips, selected-point removal, and stats are in a bottom
  sheet. The empty state is intentionally short and hides zero-value stats until
  route points exist.
- **Route summary/share/download**: native `סיכום` opens a bottom modal with
  route point count, selected route way/segments, active-data warnings, route
  description, GPX action, and native share action.
  `packages/core/src/platform/download.native.js` writes GPX into Expo cache
  through `expo-file-system/legacy` and opens the iOS share sheet, with
  text-share fallback if cache is unavailable.
- **Map legend**: native renders the same mobile-web `סוגי דרכים` legend labels
  and route colors: paved trail, dirt trail, and road. Broken-route and active
  route-data warning chips sit under the legend.
- **Warning toggle parity**: native warning chips now use the shared warning
  presentation helper and expand into grouped warning rows with shared labels,
  colors, icons, and priority rules. Web uses the same helper for its existing
  warning toggle.
- **Elevation scope**: first-pass parity is compact stats only: distance,
  climbing, and descending appear in the bottom sheet and route summary. A native
  elevation profile chart is intentionally deferred until planner chrome and
  interaction parity are stable.
- **Tests/verification for the latest parity state**: `npm test`, `npm run
  build`, `git diff --check`, and the iOS export
  `/tmp/isravelo-mobile-export-web-parity-warning-toggle` pass. The app also
  rebuilt and rendered on the iOS 17.5 iPhone 15 simulator with screenshot
  `/tmp/isravelo-parity-warning-toggle.png`. Earlier parity screenshots are:
  `/tmp/isravelo-mobile-web-parity.png`, `/tmp/isravelo-parity-slice.png`,
  `/tmp/isravelo-parity-summary.png`, `/tmp/isravelo-parity-rail.png`,
  `/tmp/isravelo-parity-rail-tight.png`,
  `/tmp/isravelo-parity-symbol-controls.png`,
  `/tmp/isravelo-parity-legend.png`, and
  `/tmp/isravelo-parity-rail-sheet-density.png`.
- **Known verification gap**: full interactive simulator smoke for the parity
  pass is still pending because the available Computer Use bridge could not
  reliably access Simulator clicks. Earlier pre-parity native simulator smokes
  did verify search/add route points, remove/undo/redo/fit, and location follow.

## 5. RN build gotchas (all hit + resolved — important!)

- **Tokens:** `pk` (publishable) in `apps/mobile/.env` as `EXPO_PUBLIC_MAPBOX_TOKEN`
  (gitignored); `sk` (secret, scope `DOWNLOADS:READ`) in `~/.netrc`
  (`machine api.mapbox.com / login mapbox / password sk…`). The pk token MUST be
  the **full ~90-char** token (a truncated one → 401); the working one is in the
  repo-root `mapbox-token.js`.
- **`EXPO_PUBLIC_*` is inlined at transform time and CACHED** → after editing
  `.env` you MUST restart Metro with `--clear` (`expo start --dev-client -c`).
- **Simulator:** Xcode hung "verifying iOS 26.2 simruntime" → **build against the
  iOS 17.5 iPhone 15**. Current booted simulator UDID is
  `961E0C3E-338F-4311-BD0B-72C2BF47C03B`. The older handoff UDID no longer
  exists on this machine.
- `apps/mobile/ios/` is gitignored (CNG); regenerate with `npx expo prebuild -p ios`.
- The `MapScreen` shows a "set token" hint if `EXPO_PUBLIC_MAPBOX_TOKEN` is empty.
- RNMapbox 10.3.1 logs `UserLocationUpdate is not supported` if the callback is
  attached directly to `MapView`; use `UserLocation.onUpdate` for native
  location updates.

## 6. What's NEXT

### Phase 2.9 — native elevation profile chart (IN PROGRESS, ~90% done)

Spec/plan: `plans/rn-mobile-elevation-profile/{design.md,implementation-plan.md}`
(subagent-driven). Approach: shared core builder + grade utils, `react-native-svg`
render, touch-scrub → synced map marker, expandable bottom sheet.

**Committed & verified (Tasks 1–4 + most of 5):**
- `4a9eee5` move `grade.js`/`slopeClustering.js` → `@cycleways/core/utils/`.
- `e74c5c0` extract `buildElevationProfile`+`findClosestElevationPoint` →
  `@cycleways/core/ui/elevationProfile.js`; web consumes it; new
  `tests/test-elevation-profile.mjs` in the chain. **`npm test` green, build OK.**
- `a6f3126` add `react-native-svg@15.15.4`; dev client rebuilt (native module).
- `f12a423` `apps/mobile/src/ElevationProfileChart.jsx` + MapScreen expandable
  sheet (`▴/▾ גובה` toggle, a11y `הצג/הסתר גרף גובה`).
- `c5f9e66` scrub→map marker (`scrubPoint` state + `elevation-scrub` CircleLayer
  in MapScreen).
- **Verified on sim:** chart + grade legend render correctly
  (`/tmp/maestro-elevation-chart.png`). Maestro flow
  `apps/mobile/.maestro/elevation-profile-smoke.yaml` passes through the chart
  assertions.

**UNCOMMITTED working-tree changes (made during review, NOT yet committed):**
- `apps/mobile/src/MapScreen.jsx` — added `routeSheetExpanded {maxHeight:560}`
  style + applied it; fixes the expanded sheet overflowing below screen.
- `apps/mobile/src/ElevationProfileChart.jsx` — marker now **persists** after
  finger-lift (removed `clear` on PanResponder release; cleared on route change
  via MapScreen effect). This is a deliberate refinement of the spec's
  "clear on release" — better touch UX + screenshot-verifiable. **Flag for user.**
- `apps/mobile/.maestro/elevation-profile-smoke.yaml` — new flow (untracked).

**REMAINING to finish the slice:**
1. Tune the scrub step in `elevation-profile-smoke.yaml`: the chart sits ~89–96%
   screen height; `tapOn point "55%,93%"` then `assertVisible "📍 מרחק.*"` was
   still failing — adjust the tap y until the tooltip + cyan map marker appear,
   screenshot `/tmp/maestro-elevation-scrub.png`. (Run ONE Maestro at a time;
   `pkill -9 -f maestro.cli.AppKt` to recover the XCTest driver.)
2. Commit the three uncommitted items (stage specific files, NOT `git add -A`):
   the layout fix + marker-persist refinement as
   `fix(mobile): keep elevation scrub marker on release; cap expanded sheet height`,
   and the smoke flow under `test(mobile): elevation profile iOS smoke`.
3. Run the full web guard (`npm test`, `npm run build`, `npm run test:smoke`
   baseline 40/12) — the web extraction is zero-behavior-change but smoke hasn't
   been re-run since.
4. Add a Phase 2.9 DONE entry to §4 here and mark the plan's verification.
5. (Skill flow) optional final code-review pass, then
   `superpowers:finishing-a-development-branch`.

**Env:** Metro running (dev-client, `/tmp/metro2.log`); sim iPhone 15/iOS 17.5
`961E0C3E-338F-4311-BD0B-72C2BF47C03B`; app installed; Maestro `~/.maestro/bin`.
Drive controls by `accessibilityLabel`; map taps assume default camera
(`GALILEE_CENTER`, zoom 11.5) and need `waitForAnimationToEnd` after `launchApp`.


- **Phase 2.8 is now SMOKE-COMPLETE:** the end-to-end interactive simulator smoke
  (Slice 10) and the expand-route-warnings smoke (Slice 11) are both DONE and
  verified (see §4). The full mobile-web parity acceptance surface is exercised
  on the simulator. Reusable Maestro flows live in `apps/mobile/.maestro/` (drive
  controls by `accessibilityLabel`, not the visible glyph; run one Maestro
  instance at a time). Do not pivot to route-following/navigation mode yet.
- **Likely remaining parity polish:** tighten any spacing/interaction mismatch
  found during that smoke; consider native route restore/deep-link support if the
  web `?route=` flow is required on iPhone; keep elevation as compact stats
  unless the product explicitly prioritizes a native elevation profile chart.
- **After parity:** route-following/navigation mode on top of the current-location
  puck, offline Mapbox tile-pack polish, release hardening, and optional
  splitting of `useCyclewaysApp` into focused hooks.

## 7. Useful commands / map

- Web: `npm run dev` / `npm run build` / `npm test` / `npm run test:smoke`.
- Mobile: `npm run mobile:ios` (= `expo run:ios` in apps/mobile); rebuild native
  via `npx expo prebuild -p ios` then
  `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` from
  `apps/mobile`.
- Shared code: `packages/core/src/{routing,utils,data,app,domain,config,platform,map}`
  + `packages/core/route-manager.js`. Web entry: `src/App.jsx` (thin) + `src/map/*`
  + `src/components/*` (web-only UI). RN: `apps/mobile/`.
- Editor server (`editor/server.mjs`) + `scripts/*` still `require` the CJS engine
  at `packages/core/route-manager.js` — don't break that path.

## 8. Process notes

- Use a superpowers-like process of **brainstorming → writing-plans → subagent-driven/executing**
  flow for each phase (the user expects design specs in `plans/<topic>/` before
  code). The user is fine with autonomous execution but wants designs written
  down and verified. Keep changes web-neutral until the RN `.native` impls exist.
