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
- [x] iPhone simulator smoke:
  search a place, add two points, see route ready, undo, redo, reset, select a
  waypoint, remove it, locate current position. (See Slice 10.)
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

## Slice 10 Plan: End-to-End Interactive Simulator Smoke

- Close the long-standing verification gap: prior parity slices could not run an
  interactive simulator smoke because no UI-automation tool could drive Simulator
  clicks.
- Install Maestro and drive the native planner by `accessibilityLabel` selectors
  (the `Pressable` controls collapse their inner glyph `<Text>` into the parent
  a11y node, so visible-glyph selectors fail — target the accessibility labels).
- Add reusable flows under `apps/mobile/.maestro/` and exercise the full HANDOFF
  §6 sequence end-to-end on the booted iOS 17.5 iPhone 15 simulator.

## Slice 10 Verification

- Installed Maestro 2.6.0 (`~/.maestro/bin/maestro`); resolves the prior blocker
  where Computer Use could not click the Simulator (no `idb`/`cliclick`).
- Added `apps/mobile/.maestro/connectivity-check.yaml`,
  `apps/mobile/.maestro/parity-smoke.yaml`, and
  `apps/mobile/.maestro/gpx-share-check.yaml`.
- `maestro --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B test
  .maestro/parity-smoke.yaml` passed every step end-to-end against the live
  dev-client build over Metro. Visually confirmed via screenshots:
  - `/tmp/maestro-route-ready.png`: search `Kfar Blum` → add, search `HaGoshrim`
    → add, route ready at **7.6 ק"מ, 2 points, 9 CW segments, ↑54מ ↓23מ**.
  - undo (`ביטול`) + redo (`חזרה`) completed.
  - `/tmp/maestro-waypoint-selected.png`: tapping waypoint chip
    `נקודת מסלול 2` selects it (`נקודה 2 נבחרה`) and reveals `הסר נקודה`.
  - `/tmp/maestro-summary.png`: `סיכום` modal shows route point count, the 9
    named route-way segments, `מידע חשוב` (`אין מידע מיוחד` for this no-warning
    route), `תיאור המסלול` (7.6 ק"מ ↑54 ↓23), and GPX/share buttons.
  - reset (`איפוס מסלול`) returns the bottom sheet to the empty state.
  - `/tmp/maestro-locate.png`: locate (`מיקום נוכחי`) activates native follow
    mode (blue user-location puck, Stop control).
- `gpx-share-check.yaml` passed and `/tmp/maestro-gpx-share2.png` confirms the
  GPX action writes a real GPX file and opens the iOS share sheet
  (`route_…​.gpx`, 18 KB, with Copy / Save to Files). No Metro errors.
- **Remaining gap (closed in Slice 11):** the expand-route-warnings step was not
  exercised here because the Kfar Blum→HaGoshrim route reports no warnings
  (`אין מידע מיוחד`). Closed by Slice 11 below.

## Slice 11 Plan: Expand-Route-Warnings Smoke

- Close the last parity-smoke gap: drive the native expand-route-warnings
  interaction on a route that actually crosses active-data warnings.
- Geocoded search points land off-network for many places (e.g. `Neot Mordechai`
  → broken route), so this smoke builds the route deterministically via two map
  taps onto known network vertices of the warning segments, using the fixed
  launch camera (`GALILEE_CENTER`, zoom 11.5) on the iPhone 15.
- Derivation: the warning corridor along the Jordan near Kfar Blum carries
  `gate`/`mud` data points (`segments.json` data + `network.json` geometry). Two
  taps on the `ירדן מערב כפר בלום` (gate) → `הירדן ההיסטורי` (mud) corridor
  produce a 2-warning route.

## Slice 11 Verification

- Added `apps/mobile/.maestro/warning-expand-smoke.yaml`.
- `maestro --device 961E0C3E-… test .maestro/warning-expand-smoke.yaml` passed
  end-to-end: two map taps (`74%,50%` then `49%,68%`) build a **5.4 ק"מ /
  2-point / 2 CW-segment** route reported as `יש 2 נקודות מידע חשובות במסלול`.
- `/tmp/maestro-warning-route.png`: legend shows the expandable
  `⚠️ מידע חשוב (2)` chip; bottom sheet shows the 2-warning route.
- The flow taps the chip and asserts the grouped warning rows appear; both
  `שער` (gate) and `בוץ` (mud) group labels assert visible.
- `/tmp/maestro-warning-expanded.png`: the chip expands into two grouped rows —
  `🚧 שער` (gate, `#FF5722`) and `⚠️ בוץ` (mud, `#9d744d`) — matching the shared
  `routePlannerPresentation`/`poiTypes` label/icon/color metadata.
- The route summary (verified during discovery) lists the same two warnings under
  `מידע חשוב`: the gate text `שער יציאה מכפר בלום…` and the mud text
  `קטע בוצי אחרי גשם`.
- **Camera-settle note:** `launchApp` returns before the RNMapbox camera settles
  to `GALILEE_CENTER`; map taps must wait for it (the flow asserts the chrome and
  uses `waitForAnimationToEnd`) or they land off-map. Run only one Maestro
  instance at a time — concurrent runners crash the shared XCTest driver.

## Phase 2.8b — Web-Drift Re-Alignment (2026-06-26 re-audit)

Slices 1-11 above are **done** and reached parity with the 2026-06-03 mobile web
planner. The mobile web planner has since been rebuilt into a bottom-sheet
front panel (`src/components/frontPanel/`: `FrontPanel`, `PanelStateToggle`,
`BuildPanel`, `DiscoverPanel`, `RecentRoutesStrip`, `PanelElevationGraph`), so
the app drifted out of parity again. This phase re-aligns the native planner to
the current web shape. Scope per the design re-audit: **Build panel parity + a
Discover/catalog entry; defer website chrome.** This is the active work and
**must land before turn-by-turn phases 4+** (see
`plans/rn-turn-by-turn-navigation/implementation-plan.md`).

### Phase 2.8b.0: Re-Audit

- [x] Capture the current mobile web planner (Build + Discover) at an
  iPhone-sized viewport. (Code-level audit of `src/components/frontPanel/`.)
- [x] Capture the current native screen on the iPhone simulator. (Code-level
  audit of `apps/mobile/src/MapScreen.jsx` — old top-search + right-rail +
  fixed bottom route sheet; 0 references to Discover/recents/catalog.)
- [x] Diff against the new web panel structure and confirm the gap list below.

### Phase 2.8b.1: Bottom-Sheet Front-Panel Shell ✅

- [x] Replace the fixed bottom route sheet in `MapScreen.jsx` with a
  front-panel sheet that has a Discover/Build mode toggle (native equivalent of
  `FrontPanel` + `PanelStateToggle`), collapsible like the web sheet. New
  `PanelStateToggle` (`חפש מסלול` / `בניית מסלול`) + collapse chevron.
- [x] Keep the map as the primary surface; the sheet expands/collapses over it.
- [x] Move pure panel view-model bits into `@cycleways/core` only where they
  remove real duplication (reused `getRoutePlannerPresentation.stats`; no new
  forks of `BuildPanel` DOM).

### Phase 2.8b.2: Build Panel Parity ✅ (POI cards deferred)

- [x] Restyle the native planner content to the `BuildPanel` model: eyebrow
  context (`מסלול מומלץ` / `המסלול שלי · טיוטה`), icon undo/redo/clear tools,
  stats block, elevation graph, share, and the recommended-route context header
  (`selectedCatalogEntry`) when a catalog entry is loaded. GPX stays in the
  summary modal; `PanelPoiCard`-style POI cards in the build panel are
  **deferred**.
- [x] Reconcile the right-side rail with the new in-panel tool row: removed the
  old top control rail; undo/redo/clear now live in the Build panel head (web
  parity).
- [x] Preserve all shared `useCyclewaysApp` handlers; this is a re-skin, not a
  behavior change.

### Phase 2.8b.3: Native Discover / Catalog Entry ✅ (thumbnails/near-me deferred)

- [x] Add a native Discover mode that lists bundled `route-catalog.json`
  entries via `loadRouteCatalogEntries()` (already native-loadable).
- [x] Render route cards (native `PanelRouteCardNative`: name + distance ·
  difficulty · shape); selecting a card restores the entry's `route` token via
  `handleLoadRouteParam`, records a recent, and switches to Build.
- [ ] Basic near-me sort using `@cycleways/core/data/nearMe.js` — **deferred**:
  needs `places.json` bundled on native (route start coords come from
  `placeById`). Cards currently render in catalog order.
- [x] This Discover list is also the route picker that feeds turn-by-turn
  navigation (catalog source in `navigationRoute.js`).

### Phase 2.8b Verification

- [x] `npm test` (9/9 route-manager + core suites pass).
- [ ] `npm run build` (web unchanged by this slice; not re-run).
- [x] iOS export from `apps/mobile`
  (`/tmp/isravelo-mobile-export-parity-2-8b-clean`, bundle compiles).
- [x] iPhone simulator/Maestro smoke: `apps/mobile/.maestro/discover-build-smoke.yaml`
  passed end-to-end on the iOS 17.5 iPhone 15 sim — chrome + both toggle tabs,
  Discover lists the bundled catalog, selecting `בניאס וגן הצפון` loads it and
  switches to Build (eyebrow `מסלול מומלץ`, title, 5-tile stats grid,
  9-warning notice, elevation chart), clear returns to `המסלול שלי · טיוטה`.
  Screenshots: `/tmp/maestro-2-8b-discover.png`,
  `/tmp/build-loaded-now.png`, `/tmp/maestro-2-8b-after-clear.png`.
  (Note: Pressable inner-Text collapses into the parent a11y node — target card
  `accessibilityLabel`s, per the Slice 10 note.)
- [x] Visual comparison against the current mobile web Build + Discover panel:
  native Build panel matches the web `BuildPanel` (eyebrow/title/tool-row/stats/
  elevation) and Discover matches the `PanelRouteCard` list (name + distance ·
  difficulty · shape).
- [x] Update `plans/HANDOFF.md` and `design.md` Status with remaining gaps.

### Phase 2.8b Deferred Follow-Ups

- Bundle `public-data/places.json` (and hero thumbnails) into native assets to
  unlock route-card thumbnails, the "via …" place line, and near-me sort.
- `PanelPoiCard`-style POI cards inside the native Build panel.
- Re-wire the orphaned `handleLocatePress` / `fitRoute` as floating native map
  controls (currently defined but unrendered).
- Recents strip + draft-restore + send-to-phone (intentionally deferred chrome).

## Implementation Notes

- The current Phase 2.4-2.7 native overlay should be treated as a functional
  proof, not the final UI target.
- Slices 1-11 are done; Phase 2.8b is the active re-alignment to the rebuilt
  mobile web planner. Finish 2.8b before turn-by-turn phases 4+ so navigation
  chrome is built on the current panel, not the stale 2026-06-03 chrome.
- Avoid broad refactors of `useCyclewaysApp`; introduce shared view-model
  helpers only when they remove actual renderer duplication.
