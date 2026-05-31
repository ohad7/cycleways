# React Native Mobile Web Parity Implementation Plan

## Phase 0: Audit

- [x] Capture the current mobile web planner at an iPhone-sized viewport.
- [x] Capture the current React Native screen on the iPhone simulator.
- [x] Build a parity checklist from the web planner:
  search, undo, redo, reset, summary/share/download, route status, route stats,
  selected waypoint removal, warnings, elevation, and search errors.
- [x] Identify which web helpers are pure presentation logic and should move
  into `@cycleways/core`.

## Phase 1: Shared Planner View Model

- [x] Move or duplicate behind a shared API the pure route message and formatting
  helpers currently used by the web route panel.
- [x] Add a small shared planner view-model helper if it reduces duplication:
  enabled/disabled states, selected point, route stats, and status messages.
- [x] Keep DOM/event-specific code in the web renderer and native press/input
  code in the RN renderer.
- [x] Verify web with `npm test` and `npm run build`.

## Phase 2: Native Layout Parity

- [x] Replace the current dark top status overlay in `apps/mobile/src/MapScreen.jsx`
  with a light CycleWays planner chrome.
- [x] Use Hebrew route-planning copy from the shared helpers.
- [x] Keep search at the top or top-sheet area with the web placeholder/copy.
- [x] Move route description, point chips, selected-point removal, and route
  stats into a bottom panel/sheet.
- [x] Convert text-heavy action buttons to the closest web-equivalent icon/button
  treatment where practical.
- [x] Keep Locate as an iPhone-native affordance, visually grouped with planner
  controls instead of as a separate feature mode.

## Phase 3: Feature Parity Fill

- [x] Add route summary/share/download entry behavior for native, using the
  existing shared route/download semantics where available.
- [x] Add route warnings and active-data warning display.
- [x] Decide whether the first pass includes the elevation profile or a compact
  stats-only summary; document any deferred elevation-profile work.
- [x] Preserve search-result Add behavior or replace it with the web-equivalent
  interaction if the audit shows a better parity target.

## Phase 4: Verification

- [x] `npm test`
- [x] `npm run build`
- [x] iOS export from `apps/mobile`
- [ ] iPhone simulator smoke:
  search a place, add two points, see route ready, undo, redo, reset, select a
  waypoint, remove it, locate current position.
- [x] Native iPhone screenshot/render check.
- [x] Visual comparison against the mobile web planner screenshot.
- [x] Update `plans/HANDOFF.md` with verified behavior and any remaining parity
  gaps.

## Slice 1 Verification

- `npm test` passed.
- `npm run build` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-slice` passed and bundled the 115
  routing shards.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` rebuilt and
  opened the app on the iOS 17.5 iPhone 15 simulator.
- Simulator screenshot at `/tmp/isravelo-parity-slice.png` confirmed the light
  Hebrew top search/control chrome and bottom route sheet render on iPhone.
- Interactive simulator smoke is still pending because the Computer Use bridge
  could not access the Simulator window for clicks during this slice.

## Slice 2 Verification

- Native `סיכום` now opens a bottom route-summary modal with the same core
  sections as the web modal: route point count, route way, active-data warnings,
  route description, GPX, and share.
- Native GPX export now uses the platform download adapter to write a GPX file
  to the Expo cache directory and open the iOS share sheet; it falls back to
  sharing GPX text if the cache directory is unavailable.
- `npm test` passed.
- `npm run build` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-summary` passed and bundled the 115
  routing shards plus RNMapbox assets.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` rebuilt and
  opened the app on the iOS 17.5 iPhone 15 simulator. Metro loaded the viewport
  routing shards without runtime errors.
- Simulator screenshot at `/tmp/isravelo-parity-summary.png` confirmed the map,
  light Hebrew top search/control chrome, and bottom route sheet render after
  the summary/share/GPX wiring.
- First-pass elevation scope is compact stats only: distance, climbing, and
  descending remain in the bottom route sheet and summary text. A native
  elevation profile chart is deferred until after the mobile-web planner chrome
  and interaction parity are stable.

## Slice 3 Plan: Mobile Web Control Rail

- Captured the current mobile web planner at an iPhone-sized viewport:
  `/tmp/isravelo-mobile-web-parity.png`.
- The biggest visual mismatch after slice 2 is the control placement: mobile web
  keeps undo/redo/delete/summary in a compact vertical rail on the right side of
  the map, while native still has a broad horizontal control bar under search.
- Next native adjustment: move the planning actions into a right-side vertical
  rail under the search row, keep the same shared handlers, and retain Locate as
  the one native-only rail action. Use compact symbol labels where no icon
  library exists, with accessibility labels preserving the full Hebrew action
  names.

## Slice 3 Verification

- Native planner controls now render as a compact right-side rail under search,
  closer to the mobile web planner control placement. Shared undo/redo/reset,
  fit, summary, and locate handlers are unchanged.
- Simulator screenshot at `/tmp/isravelo-parity-rail.png` confirms the rail
  layout on the iOS 17.5 iPhone 15 simulator.
- `npm test` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-rail` passed.

## Slice 4 Verification

- Native rail buttons now use a fixed compact footprint instead of stretching to
  the widest Hebrew label, while retaining the full Hebrew accessibility labels.
- Simulator screenshot at `/tmp/isravelo-parity-rail-tight.png` confirms the
  tighter rail layout on the iOS 17.5 iPhone 15 simulator.
- `npm test` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-rail-tight` passed.

## Slice 5 Verification

- Native search and rail controls now use compact symbolic visible labels where
  they map to familiar route-planning commands, with the full Hebrew action
  names preserved as accessibility labels.
- Simulator screenshot at `/tmp/isravelo-parity-symbol-controls.png` confirms
  the search control and rail symbols render cleanly on the iOS 17.5 iPhone 15
  simulator.
- `npm test` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-symbol-controls` passed.

## Slice 6 Plan: Native Map Legend

- Mobile web shows a compact `סוגי דרכים` legend over the map with three swatches:
  paved trail, dirt trail, and road.
- Native currently renders the same route-network colors but does not explain
  them on screen.
- Add a compact native legend overlay with the same labels and colors. Include
  compact route/data warning chips below it when the shared route presentation
  reports a broken route or active data points.

## Slice 6 Verification

- Native now renders a compact `סוגי דרכים` legend over the map with the same
  labels and route-network colors as the mobile web planner.
- The native legend also has compact chips for a broken route and active data
  points, driven by the existing shared route presentation/route state.
- Simulator screenshot at `/tmp/isravelo-parity-legend.png` confirms the legend
  sits below search on the left without colliding with the right rail or bottom
  route sheet.
- `npm test` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-legend` passed.

## Slice 7 Plan: Rail Command Grouping

- Mobile web rail is focused on route-planning commands: undo, redo, reset, and
  summary.
- Native has two iPhone-specific helper commands in the same rail: fit and
  locate.
- Split the visible native rail into a route-command group and a smaller helper
  group while keeping all shared handlers unchanged.

## Slice 7 Verification

- Native rail commands are now visually grouped: web-parity route commands
  (undo, redo, reset, summary) stay together, while native helper commands (fit
  and locate) sit in a separated group below.
- Shared handlers and enabled/disabled states are unchanged.

## Slice 8 Plan: Bottom Sheet Density

- The native bottom route sheet currently shows a full five-stat grid even when
  the route is empty.
- Mobile web keeps route details focused on an active route; the iPhone empty
  state should be lighter.
- Hide the stats grid until the route has points, and use a shorter empty-sheet
  style so the map remains the primary surface before planning starts.

## Slice 8 Verification

- Empty native route sheet is now shorter and no longer shows the zero-value
  stats grid before the user starts planning.
- Simulator screenshot at `/tmp/isravelo-parity-rail-sheet-density.png`
  confirms the grouped rail and lighter empty route sheet render together on the
  iOS 17.5 iPhone 15 simulator.
- `npm test` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-rail-sheet-density` passed.

## Slice 9 Plan: Warning Toggle Parity

- Mobile web groups active route data warnings behind the `⚠️ מידע חשוב`
  legend chip, with warning labels, colors, and icons derived from shared POI
  metadata.
- Native currently shows only a static `מידע חשוב` chip on the legend and puts
  detailed data in the summary modal.
- Move the pure warning grouping/label/color/icon presentation into
  `@cycleways/core`, update web to consume that helper with no behavior change,
  and make the native legend warning chip expandable using the same grouped
  presentation data.

## Slice 9 Verification

- `packages/core/src/ui/routePlannerPresentation.js` now owns route warning
  grouping, label, color, icon, count, and toggle-label presentation derived
  from shared POI metadata.
- Web `MapLegend` now consumes that shared warning presentation helper while
  preserving the existing legend DOM/classes and selected-marker fallback.
- Native `MapLegendOverlay` now uses the same warning presentation and renders
  the `⚠️ מידע חשוב` chip as an expandable control with grouped warning rows.
- `tests/test-poi-types.mjs` covers grouped warning labels, priority color
  selection, icons, route counts, and selected-marker fallback.
- `npm test` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-web-parity-warning-toggle` passed.
- `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B` rebuilt and
  opened the app on the iOS 17.5 iPhone 15 simulator; screenshot
  `/tmp/isravelo-parity-warning-toggle.png` confirms the native planner still
  renders cleanly after the warning-control change.

## Implementation Notes

- The current Phase 2.4-2.7 native overlay should be treated as a functional
  proof, not the final UI target.
- Avoid route-following/navigation work until this parity pass is complete.
- Avoid broad refactors of `useCyclewaysApp`; introduce shared view-model
  helpers only when they remove actual renderer duplication.
