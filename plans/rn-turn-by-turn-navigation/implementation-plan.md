# React Native Turn-by-Turn Navigation Implementation Plan

**Date:** 2026-06-26
**Status:** in progress — Phases 0-3 landed; Phases 4+ blocked on parity re-align.

## Progress Snapshot (2026-06-26)

- **Phases 0-3 done and committed** (`6d6535f` "making slight progress…",
  `2d4c134` "turn by turn phase 2-3"):
  - Phase 1: `route-catalog.json` bundled into `apps/mobile/assets/` via
    `sync-offline-assets.mjs`; `catalog.js` loads through the native asset
    adapter; `tests/test-route-catalog-loading.mjs`.
  - Phase 2: native slug/pathname parsing in
    `packages/core/src/platform/location.native.js` + `App.js` link routing;
    `tests/test-native-location.mjs`.
  - Phase 3: `packages/core/src/navigation/navigationRoute.js` builders for
    built + catalog routes; `tests/test-navigation-route.mjs`.
- **Phases 4-10 not started:** route progress engine, cue generation, native
  location service, navigation session hook, navigation UI, voice/haptics,
  universal links.
- **Sequencing dependency — now CLEARED (2026-06-27):** the UI prerequisites are
  done — `plans/rn-mobile-web-parity` **Phase 2.8b** (Discover/Build front panel)
  and `plans/rn-mobile-native-ui` **Phase 2.8c** (native reskin: real gorhom
  bottom sheet, full-bleed map, top-pinned search pill + map controls, Ionicons,
  branded Discover cards with photos). The Phase 8 navigation UI builds on the
  native chrome in `apps/mobile/src/planner/` (see the design doc's "Current
  native UI" section). The Discover/catalog list is the route picker that selects
  a catalog route to navigate.

- **>>> NEXT TASK: Phase 4 (Route Progress Engine) <<<** — pure core logic in
  `packages/core/src/navigation/`, TDD with `tests/*.mjs` in the `npm test`
  chain, no native rebuild required. Start here.

## Phase 0 - Baseline Verification ✅ (done)

1. [x] Verify current mobile route restore still works for `cycleways:///?route=...`.
2. [x] Verify route sharing still produces a valid `shareInfo.param` for hand-built
   routes.
3. [x] Run the existing pure tests that cover native location, route encoding,
   route restore, route geometry, distance, and catalog helpers.
4. [x] Confirm `apps/mobile/scripts/sync-offline-assets.mjs` output before adding
   catalog assets.

Expected validation:

- `node --test` or the repo's current JS test command
- `cd apps/mobile && npm run assets:sync`
- `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-nav`

## Phase 1 - Bundle And Load Catalog Routes On Native ✅ (done — `6d6535f`)

1. Add `public-data/route-catalog.json` to the mobile asset sync list and
   generated native JSON asset map.
2. Update `packages/core/src/data/catalog.js` to load through
   `getJsonAsset("public-data/route-catalog.json")` instead of direct web-only
   `fetch`, while preserving web behavior through `assets.js`.
3. Add pure tests proving `loadRouteCatalogEntries()` works with the native
   asset adapter.
4. Add a small native catalog loader hook for `MapScreen` or a future route
   browser screen.

Acceptance criteria:

- Mobile bundle includes `route-catalog.json`.
- Web catalog pages still load unchanged.
- A catalog entry's `route` token can be restored by `handleLoadRouteParam`.

## Phase 2 - Native Route Launch Sources ✅ (done — `2d4c134`)

1. Extend native URL parsing to expose pathname and route slug helpers in
   `location.native.js`.
2. Support incoming links:
   - `cycleways:///?route=...`
   - `cycleways:///routes/:slug`
   - `cycleways:///featured/:slug`
   - `https://www.cycleways.app/?route=...`
   - `https://www.cycleways.app/routes/:slug`
   - `https://www.cycleways.app/featured/:slug`
3. Add app startup logic that resolves slug links through the bundled catalog,
   then restores the entry's route token.
4. Preserve the existing warm-link remount behavior until a cleaner native
   navigation-router layer exists.
5. Record catalog routes in recents with their real name/slug.

Acceptance criteria:

- A route-token deep link restores a built/shared route.
- A route-slug deep link restores the matching catalog route.
- Unknown slugs show a recoverable native error state, not a blank map.

## Phase 3 - Navigation Route View Model ✅ (done — `2d4c134`)

1. Create `packages/core/src/navigation/navigationRoute.js`.
2. Add builders:
   - `navigationRouteFromRouteState(routeState, shareInfo, metadata)`
   - `navigationRouteFromCatalogEntry(entry, restoredRouteState)`
3. Normalize:
   - id
   - source
   - route param
   - name
   - geometry with cumulative distance
   - selected segment ids/names
   - active data points/warnings
   - loop/one-way metadata
4. Add tests for built route, catalog route, empty route, broken route, and
   circular route metadata.

Acceptance criteria:

- Both built and catalog routes produce the same `NavigationRoute` shape.
- Broken/empty routes cannot start navigation.

## Phase 4 - Route Progress Engine

1. Create `packages/core/src/navigation/routeProgress.js`.
2. Implement nearest-point-on-polyline projection with cumulative progress.
3. Include GPS accuracy, heading, and speed inputs.
4. Add hysteresis for off-route state:
   - candidate off-route
   - confirmed off-route
   - recovered
5. Compute remaining distance and next geometry bearing.
6. Add fixture tests for:
   - start/middle/end progress
   - wrong-direction movement
   - noisy GPS near route
   - off-route threshold crossing
   - loop route near overlapping start/end

Acceptance criteria:

- Progress is stable under realistic GPS jitter.
- Off-route does not flap around the threshold.

## Phase 5 - Maneuver/Cue Generation

1. Create `packages/core/src/navigation/navigationCues.js`.
2. Generate conservative cues from:
   - segment changes
   - sharp heading deltas
   - active hazards/POIs on route
   - route start/end
3. Store cue distance along route and cue type.
4. Add cue scheduling thresholds:
   - preview cue around 80-120 m before turn
   - final cue around 20-35 m before turn
   - arrived cue at route end
5. Add tests for cue ordering, deduping, and short-segment suppression.

Acceptance criteria:

- Cue list is deterministic for the same route.
- Cues do not spam tight geometry noise.
- Segment and hazard cue metadata is available to UI.

## Phase 6 - Native Location Service

1. Add `expo-location` and `expo-task-manager` only if Expo can satisfy iOS
   background needs; otherwise document the need to prebuild/bare-module the
   location layer.
2. Add iOS permission strings:
   - when-in-use location
   - always/background location if enabled
3. Implement a foreground watch for development first.
4. Add background update support and lifecycle cleanup.
5. Feed updates into a native `useNavigationSession` hook.
6. Keep RNMapbox `UserLocation` as visual puck rendering, but do not make it
   the source of navigation state.

Acceptance criteria:

- Foreground navigation progresses while moving in simulator/device tests.
- Background/lock-screen behavior is either verified or explicitly disabled in
  the first release.
- Location watch stops reliably when navigation stops.

## Phase 7 - Navigation Session Hook

1. Add `apps/mobile/src/navigation/useNavigationSession.js`.
2. Session states:
   - idle
   - requesting-permission
   - navigating
   - off-route
   - paused
   - ended
   - error
3. Inputs:
   - `NavigationRoute`
   - location updates
   - cue settings
4. Outputs:
   - progress
   - next cue
   - active off-route warning
   - map camera intent
   - cue events for voice/haptics
5. Add unit tests around reducer/state-machine behavior.

Acceptance criteria:

- Starting/stopping navigation does not mutate planner route state.
- Returning to planner mode leaves the loaded route intact.

## Phase 8 - Navigation UI In `MapScreen`

> Depends on `rn-mobile-web-parity` Phase 2.8b: build this navigation chrome on
> the re-aligned Build/Discover front-panel. "Start navigation" should live in
> the Build panel (and/or a catalog route's context header), and the Discover
> list is the catalog route picker.

1. Add a "Start navigation" action when `canDownload` and route geometry are
   available.
2. When navigating, replace planner editing controls with a navigation overlay:
   - next cue
   - distance to cue
   - remaining distance
   - off-route warning
   - pause/stop controls
3. Disable route-edit gestures while navigating.
4. Add route-progress line styling:
   - completed section muted
   - remaining route emphasized
   - rider snapped marker optional
5. Camera:
   - follow with heading by default
   - recenter button after manual pan
   - route overview button

Acceptance criteria:

- Navigation mode is clearly distinct from planning mode.
- Accidental taps do not add route points during navigation.
- The map remains usable if the rider pans away and recenters.

## Phase 9 - Voice, Haptics, And Settings

1. Add cue output adapters:
   - haptic warnings
   - voice/text-to-speech if in first release
2. Add per-session toggles for voice/haptics.
3. Ensure off-route alerts are rate-limited.
4. Add tests for cue-event dedupe and cooldown.

Acceptance criteria:

- The same cue is not spoken/vibrated repeatedly.
- Settings can mute outputs without affecting visual navigation.

## Phase 10 - Universal/App Links

1. Add associated-domain configuration for `cycleways.app` when production app
   launch is real.
2. Update web route CTAs per `navigation-handoff/design.md`.
3. Keep fallback web pages functional when the app is not installed.
4. Add analytics for app-link route source, start-navigation taps, off-route
   events, and navigation completion.

Acceptance criteria:

- Installed app opens compatible route links.
- Uninstalled app falls back to web route pages.
- No web page becomes an app-only dead end.

## Test Plan

Pure tests:

- catalog native asset loading
- route-source normalization
- route progress projection
- off-route hysteresis
- cue generation/scheduling
- navigation session reducer

Mobile build checks:

- `apps/mobile` asset sync
- iOS Expo export
- simulator smoke for:
  - built route deep link
  - catalog slug deep link
  - start/stop navigation foreground mode
  - denied location permission state

Manual device checks:

- start navigation on a built route
- start navigation on a featured route
- lock screen/background behavior
- wrong-way/off-route behavior
- poor GPS accuracy behavior
- voice/haptic settings
- battery and heat sanity on a 30+ minute ride

## Release Cut

Do not ship as production navigation until:

- background-location behavior is verified on a physical iPhone
- route progress and off-route thresholds are tuned on real rides
- there is a clear no-service/offline story for catalog routes
- stopping navigation reliably tears down native watchers
- the web hand-off remains additive and GPX still works

