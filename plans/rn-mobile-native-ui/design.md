# React Native Mobile Native UI Design

**Date:** 2026-06-26
**Status:** IMPLEMENTED (2026-06-27) on `codex/iphone-turn-by-turn`. See the
implementation plan for the per-task commits and deferrals. What shipped: real
`@gorhom/bottom-sheet` (peek/half/full) hosting the Discover/Build toggle; a
full-bleed map; a top-pinned safe-area search pill + top-right circular
locate/fit/layers controls with a legend popover; Ionicons throughout; branded
Discover cards with real photo thumbnails, difficulty chips, meta + near-me;
forest/cream palette. Native chrome lives in `apps/mobile/src/planner/`.
Deferred: optional `BuildPanel` file extraction.
**Phase:** 2.8c — native-feel UI/UX reskin, between mobile-web parity (2.8b) and
turn-by-turn navigation (`rn-turn-by-turn-navigation` phases 4+).

## Problem

After the 2.8b parity re-alignment the iPhone app is functionally complete but
does not look or feel native. It reads like the website squeezed onto a phone:

- A floating road-type **legend box** pinned top-left and a web-style **search
  bar** pinned top-right — both web overlays, not native chrome.
- A flat, **bordered floating card** standing in for a bottom sheet — it does not
  drag, has no grabber, and uses web-style shadows/borders.
- **Hand-drawn SVG** glyphs instead of a real icon set; no SF-style icons.
- No **safe-area** handling (deprecated `SafeAreaView`), so spacing fights the
  notch and home indicator.
- Locate / fit-to-route handlers exist but are **unwired** (no buttons).

The mobile web planner actually feels more mobile than the app. This phase fixes
the native feel without changing planner behavior.

## Goal

A CycleWays-branded **native** reskin of the existing iPhone planner:

- Same shared `useCyclewaysApp` controller and the same planner behavior; only
  the native render layer changes.
- Approach A: **map-first single adaptive bottom sheet** (the chosen structure;
  see "Approaches considered").
- Visual language: native structure (real sheet, safe areas, icons) carrying the
  web's forest-green / cream brand palette and typography.

## Approaches considered

- **A. Map-first single adaptive sheet (chosen).** Full-bleed map; one draggable
  sheet with a grabber and snap points (peek / half / full) holding the
  Discover⇄Build segmented control. Smallest leap from today's toggle model,
  keeps the map the hero, biggest native-feel payoff, and does not pre-commit the
  bottom edge before navigation mode exists.
- **B. Bottom tab bar (Discover · Plan · Navigate).** Scales toward a future
  Navigate tab, but the tab bar and the sheet compete for the bottom edge and
  Navigate is still future work. Revisit when turn-by-turn lands.
- **C. Search-led (Apple-Maps style).** Search lives in the sheet's peek state.
  Most "native", but a search-first sheet fits poorly with tap-the-map-to-plan,
  which is core here.

## Brand palette (from web CSS)

Forest `#2f6b3c` / `#245943` / `#3f5d33` · cream `#efe8d7` / `#e7dfca` ·
paper `#f8fbfa` · ink `#172026` / `#24313a` · muted `#52615c` / `#52616f` ·
line `#c6d4cf` / `#d9e3df` · accent `#f97316` / `#d98a4f` · teal `#2c5f7a` ·
danger `#991b1b`.

## Dependencies (new)

- `@gorhom/bottom-sheet` (requires `react-native-reanimated` +
  `react-native-gesture-handler`) — the draggable sheet with snap points.
- `react-native-safe-area-context` — notch / home-indicator insets.
- `@expo/vector-icons` (Ionicons) — the same icon names the web `Icon.jsx`
  already uses (`search-outline`, `arrow-undo-outline`, `arrow-redo-outline`,
  `trash-outline`, `create-outline`, `locate-outline`, `layers-outline`,
  `share-outline`, `scan-outline`), retiring the hand-drawn `ChromeIcon` SVGs.

Config required: reanimated babel plugin; wrap the app in
`GestureHandlerRootView` + `BottomSheetModalProvider` + `SafeAreaProvider` in
`App.js`. All require a **native rebuild** (`expo prebuild` / `expo run:ios`).

### Build-risk fallback

reanimated / gesture-handler / bottom-sheet are the classic RN native-build snag
points (see `plans/HANDOFF.md` §5). The plan front-loads a "deps + empty sheet
boots on the simulator" slice. If the native build cannot be made to work in a
reasonable time, the fallback for this phase is the **lightweight-libs** path: a
hand-rolled `Animated`/`PanResponder` sheet with the same snap behavior, keeping
safe-area-context + Ionicons. This is decided at the boot slice, not late.

## Layout (Approach A)

- **Map:** full-bleed, edge-to-edge under the status bar; `expo-status-bar`
  tuned for light map content.
- **Top chrome (safe-area-aware):**
  - A rounded floating **search pill**. Focusing it expands to a text input; the
    geocode result + "add to route" affordance is restyled (same shared search
    handlers). Search stays a top overlay (not moved into the sheet).
  - The road-type **legend** collapses behind a small circular **layers button**
    (tap → popover listing paved / dirt / road). Broken-route and active-data
    **warning chips** move into the sheet (Build content), not the map.
- **Bottom sheet (`@gorhom/bottom-sheet`):** grabber handle, snap points
  **peek / half / full**, cream paper background. The sheet header holds the
  **Discover⇄Build segmented control**. Peek shows a one-line route summary;
  half/full reveal full content. Sheet respects bottom safe-area inset.
- **Floating circular map buttons** (bottom-right, above the sheet peek):
  **Locate** and **Fit-to-route**, wiring the currently-orphaned
  `handleLocatePress` / `fitRoute`. Follow-mode shows an active/stop state.

## Sheet content

- **Build** (mirrors web `BuildPanel`): eyebrow context
  (`מסלול מומלץ` / `המסלול שלי · טיוטה`) + title, an Ionicons **tool row**
  (undo / redo / clear), restyled **stat tiles** (distance, ↑, ↓, segments,
  points), route status text, **warning rows**, the elevation chart, and a
  summary/share footer (GPX stays in the summary modal).
- **Discover** (mirrors web `PanelRouteCard`): branded route cards with a
  **thumbnail**, title, **difficulty chip**, and a `distance · shape · via place`
  meta line; tapping a card loads the route and switches to Build (existing
  `handleSelectCatalogRoute`). Near-me ordering when a location fix exists.

## Assets

Bundle into native assets via the existing
`apps/mobile/scripts/sync-offline-assets.mjs` + the generated
`bundledAssets.native.js` require map:

- The **route hero thumbnails** referenced by the 8 catalog entries
  (`heroImage.thumbnail`, small webp), resolved through a native image source so
  Discover cards show real imagery.
- **`places.json`**, so cards can show the "via place" line and so
  `@cycleways/core/data/nearMe.js` can compute near-me ordering.

This closes the thumbnail / places / near-me items deferred in 2.8b.

## Components & boundaries

Keep the split: shared controller/view-model semantics in `@cycleways/core`,
native rendering in `apps/mobile`. The current 2,100-line `MapScreen.jsx` is
already too large; this phase extracts the chrome into focused native components
under `apps/mobile/src/`:

- `MapScreen.jsx` — map + sources/layers + sheet host wiring (slimmed).
- `planner/PlannerSheet.jsx` — the bottom sheet host + segmented control.
- `planner/BuildPanel.jsx` — Build content.
- `planner/DiscoverPanel.jsx` + `planner/RouteCard.jsx` — Discover content.
- `planner/TopSearch.jsx` — search pill.
- `planner/MapControls.jsx` — locate / fit / layers circular buttons + legend
  popover.
- `planner/theme.js` — palette + shared text/spacing tokens (single source).

No new shared-core forks beyond reusing existing presentation helpers
(`getRoutePlannerPresentation`, catalog/nearMe helpers, `routeImageSrc`-style
native image resolution).

## Non-goals

- No change to planner/route behavior, routing, or the shared controller logic.
- No navigation/recording mode (that is `rn-turn-by-turn-navigation`).
- No bottom tab bar (Approach B) or search-led sheet (Approach C) this phase.
- No offline Mapbox tile-pack management; no Android-specific work.
- No web changes.

## Acceptance criteria

- The app reads as a native iOS app: full-bleed map, safe-area-aware chrome, a
  real draggable bottom sheet with a grabber and peek/half/full snaps, Ionicons,
  and the forest/cream brand palette.
- The legend no longer floats as a box; it lives behind a layers control.
- Search is a native floating pill with restyled results.
- Locate and Fit-to-route are real, working circular map buttons.
- Discover cards show thumbnails + difficulty chip + meta; near-me ordering works
  when a fix is available.
- All 2.8b behavior preserved: search/add, undo/redo/clear, catalog select →
  Build, stats, warnings, elevation, summary/share/GPX, waypoint drag.
- `npm test` green; iOS export clean; Maestro smoke updated and passing on the
  iOS 17.5 iPhone 15 simulator.
