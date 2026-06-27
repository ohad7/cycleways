# React Native Turn-by-Turn Navigation Design

**Date:** 2026-06-26
**Status:** in progress — foundation landed (catalog bundling, native link
routing, `NavigationRoute` model + tests; Phases 1-3) and the **route-progress
engine (Phase 4) is DONE** (2026-06-27): `routeProgress.js`
(`createRouteProgressTracker`) with metric-frame projection, a windowed forward
cursor (loop/out-and-back safe), accuracy-aware off-route hysteresis, wrong-way
detection, and start-approach output. The **cue layer (Phase 5) is also DONE**
(2026-06-27): `navigationCues.js` with a static `buildRouteCues` (start/turn/
hazard/arrive, deterministic, dedup-gated) and a per-fix `selectActiveCue`
(preview/final scheduling). **Both UI prerequisites are also DONE** (2026-06-27):
the mobile-web parity re-align (`rn-mobile-web-parity` Phase 2.8b) and the
native-UI reskin (`rn-mobile-native-ui` Phase 2.8c), so the navigation chrome
(Phase 8) has a current native planner to build on. All pure-core navigation
logic is now in place. **Next task: Phase 6 (native location service)** — the
first native-app phase — then the session hook (Phase 7) and navigation UI.

### Current native UI the nav mode builds on (read before Phase 8)
`apps/mobile/src/MapScreen.jsx` renders a full-bleed `@rnmapbox/maps` map with
the shared `useCyclewaysApp` state, plus chrome in `apps/mobile/src/planner/`:
`PlannerSheet` (`@gorhom/bottom-sheet`, snap points peek/half/full, hosts a
Discover/Build segmented toggle), `TopSearch` (top-pinned search pill),
`MapControls` (top-right circular locate/fit/layers + legend popover),
`DiscoverPanel`/`RouteCard` (catalog browser → loads a route via
`handleSelectCatalogRoute`), `Icon` (Ionicons), `theme.js` (forest/cream
palette). The map is full-bleed (no `SafeAreaView` wrapper — overlays use
`useSafeAreaInsets`). Navigation mode should be a new sheet/overlay state in this
structure (e.g. a `NavPanel` in `planner/`), reusing `theme.js`/`Icon`, and a
"Start navigation" entry from the Build panel + a catalog route's context.
Note: `@gorhom/bottom-sheet` groups its body as one a11y node — Maestro can only
see the sheet header + non-sheet chrome; drive in-sheet content via coordinate
taps + screenshots.

## Goal

Add in-app turn-by-turn navigation for both:

- routes the rider builds in the iPhone planner
- featured/recommended routes loaded from the public route catalog

Navigation is an iPhone-app feature. The web remains a planning, discovery,
preview, sharing, and GPX surface.

## Current App Review

The iPhone app already has most of the route-following foundation:

- `apps/mobile/App.js` gates startup on React Native `Linking`, stores the
  incoming URL through `location.native.js`, and remounts `MapScreen` for warm
  links.
- `apps/mobile/src/MapScreen.jsx` renders the shared planner state on native
  Mapbox, including route geometry, route points, route direction pulse,
  active POI/hazard markers, current-location puck, and follow-with-heading
  camera.
- `useCyclewaysApp` in `packages/core/src/app/useCyclewaysApp.js` owns route
  creation, route restore from `?route=`, route sharing, route recents,
  elevation, warnings, and GPX export.
- Bundled routing assets already live under
  `apps/mobile/assets/data/public-data/`, and `.cwb` shards are loaded through
  `assets.native.js`.
- `public-data/route-catalog.json` stores featured/recommended route metadata
  and the same encoded `route` token used by shared route links.

The main gaps are:

- no explicit navigation session or ride mode
- no background location permission/service path
- no route-progress/off-route engine
- no instruction/maneuver model
- no voice/haptic cue layer
- no mobile-bundled route catalog or catalog-entry route launcher
- no universal-link handling for `/routes/:slug` and `/featured/:slug`

## Product Decisions

### D1. Build a CycleWays navigation engine, not Mapbox Navigation UI first

The route authority is the CycleWays offline routing graph and route encoder,
not Mapbox Directions. The first implementation should keep route progress,
off-route checks, instructions, and recovery prompts in shared/core code and
render them with the existing React Native Mapbox map.

Mapbox remains the map renderer. Mapbox Navigation SDK can be revisited later
only if it can consume CycleWays routes without replacing the route authority or
forcing a large native-only fork.

### D2. One navigation route model for built and catalog routes

Both entry types must normalize into the same `NavigationRoute` object:

- `source: "built"` uses the live `routeState`, `shareInfo.param`, and current
  route geometry.
- `source: "catalog"` uses catalog metadata plus the catalog entry's encoded
  `route` token, restored through the same `handleLoadRouteParam` /
  sharded-session path.

The session should retain route metadata when available: `slug`, `name`,
`distanceKm`, `difficulty`, `surfaceType`, start/end copy, and whether the
route is featured. Built routes get a generated title such as "My route".

### D3. Navigation mode is a separate app state, not planner chrome

`MapScreen` should keep planning mode as-is and add a separate navigation mode
that:

- locks accidental route edits while riding
- follows the rider by default
- shows progress, next cue, distance to next cue, off-route state, and ride
  controls
- leaves the existing planner summary/share/GPX UI available before starting
  navigation

Stopping navigation returns to the loaded route in planning mode; it should not
clear the route.

### D4. Route progress is geometry-first with segment-aware enrichment

The MVP should snap the rider to the loaded route geometry, compute cumulative
progress, and derive cues from the route's geometry plus segment metadata.

Minimum route-progress model:

- nearest point on route geometry
- progress meters and fraction
- cross-track distance
- heading agreement with upcoming geometry
- remaining distance
- passed/upcoming cue index
- off-route status with hysteresis
- `onRoute` + `distanceToRouteStart` for the start-approach state

Engine implementation constraints (see implementation-plan Phase 4):

- Project to segments in a local **metric frame** (scale lng by `cos(lat)`),
  not raw lat/lng degrees — the along-segment fraction drives cumulative
  progress and must be unbiased. Do not reuse `utils/distance.js`
  `distanceToLineSegment` for progress.
- Nearest-point search uses a **windowed forward cursor**, not a global min, so
  loop / out-and-back / circular routes that pass near themselves keep progress
  monotonic and never snap back across the start/end overlap.
- The engine is a **pure stateful updater** (`createRouteProgressTracker`) with
  timestamps fed in — no wall clock / RAF — reusing the shared arc-length +
  bearing helpers (extracted from `routeDirectionAnimator.js`).
- Off-route is **accuracy-aware** with two thresholds + dwell (enter
  `30 m + k·accuracy`, exit `15 m`); heading degrades gracefully at low speed
  (use displacement course above ~1 m/s, never flag wrong-way while stopped).

Instruction quality should start conservative. Segment-boundary and sharp-turn
cues are acceptable; false precision is not. If a route has weak cue data, the
UI can say "continue on route" and rely on the map line.

### D5. Off-route recovery starts as guidance, not automatic rerouting

For the first version, off-route detection should warn and offer actions:

- "Return to route" with map recentering on the nearest route point
- "Recalculate from here" only after the existing route manager can safely
  insert the current location as a new first point and preserve the destination

Automatic rerouting while moving is a later phase. It is easy to make worse
than a clear warning.

### D6. Background location and audio are native app concerns

Navigation must continue when the screen locks. The React Native app needs
native-capable location support instead of relying only on RNMapbox
`UserLocation`.

The current `UserLocation` puck can remain for visual display, but navigation
state should be driven by a dedicated native location service so the app can
control update cadence, background behavior, accuracy, battery tradeoffs,
permissions, and tests.

### D7. Voice and haptics are cue outputs, not route logic

Cue scheduling should live behind a small output interface:

- visual cue in the navigation panel
- haptic cue near turns/off-route
- voice cue through text-to-speech or precomposed strings

The route-progress engine emits cue events; the output layer decides whether to
speak, vibrate, or remain silent based on user settings and platform state.

### D8. Web hand-off remains additive

Follow `plans/navigation-handoff/design.md`:

- `?route=` is the universal currency for built routes.
- `/routes/:slug` and `/featured/:slug` should open the app when installed,
  with web fallback.
- No web navigation mode.
- GPX remains available.

## Entry Flows

### Built Route

1. Rider builds or opens a shared route in the app.
2. App derives `NavigationRoute` from `routeState` and `shareInfo.param`.
3. Rider taps a native "Start navigation" action in the route summary or bottom
   sheet.
4. App requests needed location permissions if not already granted.
5. Navigation session starts from current location against the loaded geometry.

### Featured/Recommended Route

1. Rider opens a catalog card, `/routes/:slug`, `/featured/:slug`, or a
   universal link.
2. App resolves `slug` to a bundled catalog entry.
3. App restores `entry.route` using the existing route restore path.
4. App displays the route in planner/preview state with catalog metadata.
5. Rider starts navigation from the same native action.

## Data And Code Boundaries

Shared/core:

- route catalog loading through platform assets
- `NavigationRoute` construction from `routeState` and catalog metadata
- route geometry indexing and nearest-point/progress math
- cue generation from geometry/segments
- off-route state machine
- pure tests for progress, cue thresholds, and route-source normalization

Native app:

- location watch and background permission path
- navigation session lifecycle hook
- map camera behavior while navigating
- navigation chrome
- voice/haptic output adapters
- app/universal link routing for route slugs

Web:

- no navigation mode
- app-launch CTAs after app production launch
- existing route preview/share/GPX behavior unchanged

## Permissions

The current app config only declares `NSLocationWhenInUseUsageDescription`.
Navigation will require an explicit background-location decision and copy before
shipping. The plan should evaluate Expo Location/TaskManager against bare native
Core Location needs during implementation.

Minimum permission UX:

- planning/preview: when-in-use location is enough
- active navigation: request the stronger permission only when the rider starts
  navigation
- disabled/denied background permission: allow foreground-only navigation but
  state clearly that lock-screen navigation will stop

## Open Questions

Resolved (2026-06-27):

- **Voice cues in v1?** No — ship visual + haptic first; voice/TTS is a
  follow-up behind the same cue-event interface.
- **Off-route threshold?** Accuracy-aware: enter `30 m + k·accuracy`, exit
  `15 m`, with dwell. Speed-adaptive tuning deferred.
- **Route-start approach cue?** Yes, minimal — the progress engine exposes
  `onRoute` + `distanceToRouteStart` so the UI can prompt "head to route start".

Still open:

- Should catalog routes expose a preferred start direction for circular routes?
- Is Android in scope for the first navigation implementation, or iPhone only?
  (Does not gate Phase 4; revisit before Phase 6 location work.)

## References Checked

- Apple Core Location background updates:
  https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background
- Expo Location SDK:
  https://docs.expo.dev/versions/latest/sdk/location/
- Mapbox iOS Navigation SDK guides:
  https://docs.mapbox.com/ios/navigation/guides/

