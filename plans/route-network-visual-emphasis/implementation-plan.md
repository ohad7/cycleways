# Route Network Visual Emphasis Implementation Plan

**Date:** 2026-06-25.

> **For agentic workers:** Steps use `- [ ]` checkboxes. Keep experiments behind
> flags until a default is selected.

**Goal:** Add feature-flagged, zoom-aware route-network presentation variants
that make segments more pronounced while preserving segment-type colors and
supporting adaptive palettes for the current base map.

**Design:** `plans/route-network-visual-emphasis/design.md`.

---

## Verification Guard

- `npm test` passes, or at minimum the focused tests below pass while broader
  failures are documented.
- `npm run build` succeeds.
- Visual comparison screenshots are captured for:
  - default empty planner;
  - manual build with 2-3 route points;
  - route-point drag/insert preview if practical;
  - Discover hover/preview state.
- Compare at least three zoom levels: overview, mid, and detailed local planning
  zoom.

---

## Task 1: Add Variant Flag Plumbing

**Files:** `packages/core/src/config/featureFlags.js`,
`packages/core/src/app/useCyclewaysApp.js`, `src/App.jsx`, `src/map/MapSurface.jsx`,
`src/map/MapSurface.contract.md`.

- [x] Add a string flag helper, e.g. `featureFlagStringValue(key, allowed,
  defaultValue)`, using query params, globals, then defaults.
- [x] Add query-param aliases (`networkStyle`, `routeStyle`, `networkScheme`,
  `baseMapProfile`) that override global flags for shareable experiment URLs.
- [x] Remove localStorage as a control path for string presentation flags; query
  params are the temporary interactive control surface.
- [x] Add `routeNetworkPresentation` with default `"current"` and allowed values:
  `"current"`, `"typed-bold"`, `"typed-cased"`, `"build-focus"`, `"single-blue"`.
- [x] Optionally add `routeGeometryPresentation` with allowed values `"current"`
  and `"cased"`.
- [x] Return these values from `useCyclewaysApp` with the existing
  `featureFlags` object or a small `mapPresentation` object.
- [x] Pass explicit props into `MapView` / `MapSurface`; do not let layer code
  read globals directly.
- [x] Document the new props in `MapSurface.contract.md`.
- [x] Add unit coverage for string flag parsing, unknown value fallback, and
  default behavior.

## Task 2: Extract Shared Network Presentation Helpers

**Files:** `packages/core/src/domain/routeNetwork.js`,
`packages/core/src/map/networkPresentation.js` (new), tests.

- [x] Keep current segment bucket classification, but separate bucket selection
  from concrete color values.
- [x] Add named color schemes:
  - `current-muted`
  - `outdoors-balanced`
  - `topo-high-contrast`
  - `gray-map-saturated`
  - `aerial-bright`
- [x] Add `routeNetworkPresentation({ variant, baseMapProfile, routeBuilding })`
  that returns core colors, casing color, opacity, and width profiles.
- [x] Update `prepareRouteNetworkFeatures` to accept optional presentation
  context and bake stable properties such as `routeColor`, `routeWidth`,
  `routeOpacity`, and `routeBucket`.
- [x] Preserve current output exactly when variant is `"current"`.
- [x] Add unit tests for bucket color output under each scheme.

## Task 3: Implement Zoom-Aware Network Widths

**Files:** `packages/core/src/map/mapStyles.js`, `src/map/mapLayers.product.js`,
mobile style equivalents if shared immediately.

- [x] Replace fixed network `line-width` for experiment variants with a Mapbox
  expression based on `["zoom"]`.
- [x] Start with these profiles:
  - `current`: existing `["get", "routeWidth"]`.
  - `typed-bold`: `8 => 3.2`, `11 => 4.2`, `14 => 5.6`.
  - `typed-cased`: core `8 => 3.0`, `11 => 4.0`, `14 => 5.2`; casing +2px.
  - `build-focus`: current/soft when not building; cased profile while building.
- [x] Keep hit-layer width separate and generous (`18-24px`) so visual width
  changes do not reduce click/tap tolerance.
- [x] Add focused tests that inspect generated Mapbox paint expressions.

## Task 4: Add Cased Web Network Layers

**Files:** `src/map/mapLayers.product.js`, `packages/core/src/map/mapStyles.js`,
tests.

- [x] Add stable layer IDs for network casing/shadow, preserving current layer
  cleanup order.
- [x] Insert casing below the network core and above the base map.
- [x] Keep hit, hover, and focus behavior working. Hover/focus may need their
  own casing or width adjustment so selected segments do not look thinner than
  the base network.
- [x] Ensure recommended route overlays and built-route layers still render
  above the network.
- [x] Add tests around layer creation order and cleanup.

## Task 5: Add Active Route Casing

**Files:** `src/map/mapLayers.product.js`, `packages/core/src/map/mapStyles.js`,
`apps/mobile/src/MapScreen.jsx` if included in the same slice.

- [x] Add a route-geometry casing layer below `ROUTE_GEOMETRY_LAYER_ID`.
- [x] Keep affected drag-preview spans readable; the dimmed affected route slice
  should not disappear under the casing.
- [x] Keep route hit-layer behavior unchanged.
- [x] Test `routeGeometryPresentation=current`, `cased`, and emphasized color
  variants separately from network variants.

## Task 6: Build-Focus State

**Files:** `src/App.jsx`, `src/map/MapSurface.jsx`, presentation helper tests.

- [x] Derive `routeBuilding` from planner state: route points, pending points,
  routing phase, or drag preview.
- [x] Pass `routeBuilding` into the presentation helper.
- [x] Avoid abrupt visual jumps: if needed, only switch after the first point is
  placed and keep the style until route clear.
- [x] Verify Discover panel states, recommended route hover, and route playback
  still have clear visual hierarchy.

## Task 7: Adaptive Color Scheme Controls

**Files:** presentation helper, optional base-map config.

- [x] Add `baseMapProfile`, defaulting to `"mapbox-outdoors"`.
- [x] Map each profile to a color scheme and casing choice.
- [x] Keep the implementation profile-driven rather than sampling map tiles.
- [x] Add a developer override through query params/global flags for comparing
  schemes without changing the actual base map.

## Task 8: Native Parity Decision

**Files:** `apps/mobile/src/MapScreen.jsx`, shared presentation helpers.

- [x] Decide whether experiments are web-only for the first comparison or shared
  with native immediately.
- [ ] If shared immediately, mirror casing/core network layers in RNMapbox.
- [x] If web-only initially, document that the selected final style must be
  ported to native before release parity is claimed.

## Task 9: Visual Comparison And Decision

**Files:** screenshots/artifacts, follow-up decision note in this plan or a
short `plans/route-network-visual-emphasis/decision.md`.

- [ ] Capture screenshots for each variant at matched camera positions and zooms.
- [ ] Compare:
  - segment visibility over green terrain, towns, water, and dense road areas;
  - typed-color distinguishability;
  - active-route clarity while building;
  - Discover route overlay clarity;
  - clutter at overview zoom.
- [ ] Choose a default variant and keep at least one fallback flag for rollback.
- [ ] Remove or mark rejected variants after the decision so the code does not
  accumulate permanent experiments.

---

## Suggested Rollout

1. Ship the flag plumbing and `current` no-op path.
2. Add `typed-bold` and `typed-cased` for desktop web only.
3. Add active-route casing.
4. Run screenshot comparison and choose whether `build-focus` is necessary.
5. Port the selected style to native.
6. Flip the default only after web and native behavior are understood.

---

## Implementation Status (2026-06-25)

- Implemented the shared/web experiment harness with default `current` behavior:
  `routeNetworkPresentation`, `routeGeometryPresentation`,
  `routeNetworkColorScheme`, and `routeNetworkBaseMapProfile`.
- Implemented typed color schemes, zoom-aware widths, cased network layers, and
  cased built-route geometry for the web MapSurface.
- Added focused tests for flag parsing, presentation fallback, layer creation,
  query-param aliases, and default style compatibility.
- Verification run:
  - `node tests/test-map-styles.mjs && node tests/test-map-layers.mjs`
  - `npx playwright test tests/e2e/react-migration-smoke.spec.mjs --workers=1`
  - `npm run build`
- Remaining work: visual screenshot comparison across variants and zoom levels,
  final default selection, and native RNMapbox parity for the selected style.
