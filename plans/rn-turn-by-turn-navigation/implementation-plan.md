# React Native Turn-by-Turn Navigation Implementation Plan

**Date:** 2026-06-26 (Phases 4-8 landed 2026-06-27; Phases 6+8 need device verification)
**Status:** in progress — the full first-pass turn-by-turn slice is implemented.
Phases 0-5 + Phase 7 core are node-tested; **Phases 6 (native location) and 8
(navigation UI) are scaffolded and parse/bundle cleanly but are NOT yet verified
on a simulator/device.** Phase 8 polish (progress-line + snapped rider marker)
and **Phase 9 haptics** are also implemented (haptics scaffolded; voice
deferred). Parity dependency CLEARED. **Next task: build + verify the slice in
the simulator** — `cd apps/mobile && npx expo install expo-location
expo-haptics`, prebuild, then exercise Start→navigate→off-route→stop on a built
and a catalog route with a simulated GPX (confirm haptics + mute toggle). Then
Phase 10 (universal/app links).

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

- **Phase 4 done (2026-06-27):** `packages/core/src/navigation/routeProgress.js`
  (`createRouteProgressTracker`) — metric-frame projection, windowed forward
  cursor (loop/out-and-back safe), accuracy-aware off-route hysteresis with
  enter/confirm/recover dwell, wrong-way detection (low-speed safe),
  `bearingToNextDeg` + `distanceToRouteStart`. Shared arc-length/bearing helpers
  extracted to `packages/core/src/utils/geometry.js` (animator re-exports them).
  Tests: `tests/test-route-progress.mjs` (in the `npm test` chain).
- **Phase 5 done (2026-06-27):** `packages/core/src/navigation/navigationCues.js`
  — static `buildRouteCues(navigationRoute)` (start/turn/hazard/arrive cues,
  deterministic + sorted, distance-gated turn dedupe) and per-fix
  `selectActiveCue(cues, progress)` (preview ≤120 m / final ≤35 m scheduling).
  Tests: `tests/test-navigation-cues.mjs` (in the `npm test` chain).
- **>>> NEXT TASK: Phase 6 (Native Location Service) <<<** — first native phase;
  `expo-location` (+ `expo-task-manager` for background), iOS permission
  strings, foreground watch first, feeding a native `useNavigationSession` hook.

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

## Phase 4 - Route Progress Engine ✅ (done — 2026-06-27)

**Reuse, don't reinvent.** `routeDirectionAnimator.js` already exports
`precomputeArcLength(geometry) → {cumDist, totalDistMeters}` and
`computeBearing(from, to)`, and `navigationRoute.geometry` already carries
`distanceFromStartMeters` per vertex. Extract the arc-length + bearing helpers
into a shared `packages/core/src/utils/geometry.js` consumed by both the
animator and the progress engine — do not write a third copy. Build the engine's
index **once per NavigationRoute**, not per GPS fix.

1. Create `packages/core/src/utils/geometry.js` (shared arc-length + bearing;
   migrate the animator's copies) and `packages/core/src/navigation/routeProgress.js`.
2. **Metric-frame projection (critical).** Do NOT reuse
   `distanceToLineSegment` from `utils/distance.js` for progress — its
   along-segment fraction is computed in raw lat/lng degrees and is biased
   (lng is compressed ~cos(lat)). Write `projectToSegment` that scales lng by
   `cos(lat)` (local equirectangular) and returns
   `{ crossTrackMeters, t, snapped }` in a consistent metric frame.
3. **Windowed forward cursor (not global min).** Keep a progress cursor and
   search a forward window (±N meters / ±k segments) around last-known
   progress; only fall back to a global nearest search on (re)acquisition or
   confirmed off-route. This is what keeps progress monotonic and resolves
   loop / out-and-back / circular-start "arrived at the start" failures.
4. **Pure stateful updater with injected time.**
   `createRouteProgressTracker(navigationRoute, options) → { update(fix), reset() }`
   where `fix = { lat, lng, accuracy, heading, speed, timestamp }`. No
   `Date.now`/RAF inside — feed timestamps in (mirror the animator's injectable
   clock) so the engine is fixture-testable and reusable by the Phase 7 hook.
5. **Off-route state machine (accuracy-aware, two thresholds + dwell).**
   States: on-route → candidate → off-route → recovered.
   - enter candidate when `crossTrack > enter` AND heading disagrees;
   - `enter = 30 m + k·accuracy` (accuracy-inflated), `exit = 15 m`;
   - confirm off-route after a sustained dwell (time or distance);
   - recover when `crossTrack < exit` for a dwell.
   Two thresholds (enter > exit) + dwell prevents flapping.
6. **Low-speed heading.** Derive course from displacement between consecutive
   fixes when `speed > ~1 m/s`; fall back to reported heading otherwise; do not
   let heading drive off-route near zero speed (stopped ≠ wrong-way).
7. Output model (per `design.md` D4): nearest point, progress meters + fraction,
   cross-track, heading agreement, remaining distance, next geometry bearing,
   passed/upcoming cue index, off-route status. **Plus** `onRoute` +
   `distanceToRouteStart` so the UI can show a "head to route start" approach
   state before progress begins (resolves the start-approach open question).
8. Add fixture tests (`tests/test-route-progress.mjs`, appended to the `npm test`
   `&&` chain) for:
   - start/middle/end progress
   - wrong-direction movement
   - noisy GPS near route (progress stays monotonic-ish; no off-route flap)
   - off-route enter/confirm/recover with accuracy inflation
   - loop / out-and-back route near overlapping start/end (cursor stays local)
   - start-away-from-route approach state
   Use a real slice of a catalog route's geometry as a fixture, not only
   synthetic straight lines, so projection + loop behavior is exercised.

Acceptance criteria:

- Progress is stable and monotonic under realistic GPS jitter.
- Off-route does not flap around the threshold; accuracy inflates it.
- Loop/circular routes do not snap progress backward across the overlap.
- Engine is pure (no wall-clock/RAF); fixtures fully drive it.

## Phase 5 - Maneuver/Cue Generation ✅ (done — 2026-06-27)

Split into a pure static builder and a cheap per-fix selector:

- `buildRouteCues(navigationRoute)` — precomputed **once** from geometry +
  segment boundaries + on-route hazards/POIs; deterministic ordered cue list.
- `selectActiveCue(cues, progress)` — light per-fix selector driven by the
  Phase 4 progress fraction/cursor.

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

## Phase 6 - Native Location Service ⚠️ (scaffolded 2026-06-27 — needs simulator verification)

**Landed (unverified on device):**
- Pure mapper `packages/core/src/navigation/locationFix.js`
  (`toNavigationFix`: Expo `LocationObject` → progress fix; -1/null heading &
  speed → null). Tested: `tests/test-location-fix.mjs`.
- Native `apps/mobile/src/navigation/locationService.js` — `expo-location`
  wrapper: `requestNavigationPermissions({background})` + a high-accuracy
  (`BestForNavigation`) foreground `watchPositionAsync` with leak-safe `stop()`.
- Native `apps/mobile/src/navigation/useNavigationSession.js` — the thin hook
  wrapping the core session: START → permission request → PERMISSION_GRANTED/
  DENIED → foreground watch feeding `LOCATION`; `stop/pause/resume/recenter/
  userPanned`; watch teardown on stop/unmount (race-guarded).
- `app.json`: `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `UIBackgroundModes:["location"]`, and the `expo-location` config plugin.
- `apps/mobile/package.json`: `expo-location` dep.

**Before this can be trusted (do on a machine that can build):**
- Run `cd apps/mobile && npx expo install expo-location` to pin the exact
  SDK-56-aligned version (the `~56.0.0` placeholder is a guess), then `npm i`.
- `npx expo prebuild` / `expo run:ios`; confirm the permission prompt copy and
  that a foreground watch advances progress in the simulator (Features → custom
  GPX route works well).
- **Background/lock-screen is config-ready but RUNTIME-DISABLED for v1**: the
  hook defaults `background:false` (foreground-only). Enabling it needs
  `expo-task-manager` + a defined background task and physical-device testing.

Original plan (for reference):

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

**Split landed (2026-06-27):** the pure session state machine is implemented and
tested in core — `packages/core/src/navigation/navigationSession.js`
(`createNavigationSession` → `{ getState, dispatch }`, owning the Phase 4 tracker
+ Phase 5 cues). States idle/requesting-permission/navigating/off-route/paused/
ended/error; outputs progress, activeCue, offRoute, cameraIntent, and a
deduped `cueEvent` (cue / off-route) for the voice/haptic layer; a non-navigable
route cannot start; the NavigationRoute is never mutated. Tests:
`tests/test-navigation-session.mjs`. **Remaining:** the thin native
`apps/mobile/src/navigation/useNavigationSession.js` wrapper that wires the
Phase 6 location stream + permission prompts into `dispatch` and re-renders
`getState()` — do this together with Phase 6.

1. ✅ Pure state machine in `@cycleways/core/navigation/navigationSession.js`.
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

## Phase 8 - Navigation UI In `MapScreen` ⚠️ (scaffolded 2026-06-27 — needs simulator verification)

**Landed (unverified on device):**
- Pure presenter `packages/core/src/navigation/navigationPresentation.js`
  (`getNavigationPresentation` → Hebrew cue/status/distance strings + icons;
  `formatDistanceMeters`). Tested: `tests/test-navigation-presentation.mjs`.
- `apps/mobile/src/planner/NavPanel.jsx` — active-nav overlay: top cue banner
  (or red off-route banner) + remaining distance + a recenter / pause-resume /
  stop control row (safe-area aware).
- `MapScreen` wiring: builds the `NavigationRoute` from the loaded route, runs
  `useNavigationSession`, shows a primary **"התחל ניווט" (Start navigation)**
  button in the Build panel actions (when `canDownload`), and while navigating:
  swaps `PlannerSheet` → `NavPanel`, hides `TopSearch`/`MapControls`, **locks
  route edits** (map-press, point-drag, and data-marker taps all gated via
  `isNavigatingRef`), and follows the user with heading (zoom 16.5,
  `cameraIntent`-aware) with a recenter control.
- **Progress-line styling + rider marker (added 2026-06-27):** the progress
  engine now emits `snappedPoint`/`snappedIndex` and a pure `traveledCoordinates`
  helper (both tested in `tests/test-route-progress.mjs`); `MapScreen` draws the
  completed portion muted over the route line and a snapped rider dot while
  navigating.

**Deferred (not in this cut):**
- A route-overview/fit button while navigating (recenter only for v1).

**Verify in the simulator:** Start navigation from a built and a catalog route →
permission prompt → overlay shows cue/remaining → simulated GPX advances
progress, off-route banner appears when you diverge, stop returns to the planner
with the route intact, and taps cannot add points while navigating.

> Original plan (depends on `rn-mobile-web-parity` Phase 2.8b): build this
> navigation chrome on the re-aligned Build/Discover front-panel. "Start
> navigation" lives in the Build panel; the Discover list is the route picker.

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

## Phase 9 - Voice, Haptics, And Settings ⚠️ (haptics scaffolded 2026-06-27 — needs device verification; voice deferred)

**Landed (unverified on device):**
- Pure planner `packages/core/src/navigation/cueHaptics.js`
  (`createCueHapticPlanner`): maps a session cue event to intensity
  (off-route → heavy, final cue → medium, preview → light) with a global
  cooldown so a ride never buzzes constantly. Tested:
  `tests/test-cue-haptics.mjs`. (Builds on the session's existing cue/off-route
  event dedupe.)
- Native adapter `apps/mobile/src/navigation/cueHapticsAdapter.js` (`fireHaptic`
  → expo-haptics) + `expo-haptics` dep.
- `useNavigationSession` runs the planner on each cue event when haptics are on,
  exposes `hapticsEnabled` + `setHapticsEnabled`; `NavPanel` has a mute toggle.

**Verify in the simulator/device:** turn/off-route events vibrate at distinct
intensities, the same event does not buzz repeatedly, and the mute toggle
silences haptics without affecting the visual overlay. **Voice/TTS deferred** to
a follow-up behind the same cue-event interface.

> v1 scope decision (2026-06-27): ship **visual + haptic** cues first; voice/TTS
> is a follow-up. Keep the cue-output interface voice-ready (Phase 5 emits cue
> events) but do not block v1 on TTS tuning.

1. Add cue output adapters:
   - haptic warnings (v1)
   - voice/text-to-speech (follow-up, behind the same cue-event interface)
2. Add per-session toggles for haptics (and voice once added).
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

