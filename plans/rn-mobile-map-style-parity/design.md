# iPhone ↔ mobile-web map parity via shared specs

**Date:** 2026-06-27
**Topic:** `rn-mobile-map-style-parity`
**Status:** Design approved, pending implementation plan

## Problem

The iPhone app (`apps/mobile`) and the mobile web planner have drifted in how
they draw the map and the route-building UI, even though most of the underlying
logic already lives in the shared `@cycleways/core` package. The app looks less
polished than the mobile web, and the two surfaces are free to diverge further
because nothing structurally forces them to agree.

Concrete divergences found:

1. **Network colors.** Web bakes network features with a presentation variant
   (`typed-cased` while building) → cased blue/gray/brown lines with casing +
   shadow. The mobile app calls the same `prepareRouteNetworkFeatures(geoJsonData)`
   **with no options**, falling back to the `current` / `current-muted` scheme
   (muted teal/gray/brown) and rendering a **single flat line** — no casing, no
   shadow. Same function, different inputs → different look.

2. **Active route line.** Web uses the shared
   `routeGeometryLineStyleForPresentation` (default `dark`: `#102a43` core +
   white casing + dimming of "affected" segments). Mobile **hardcodes**
   `ROUTE_LINE_STYLE = { lineColor: "#006699", lineWidth: 5 }` with no casing and
   no variant (`apps/mobile/src/MapScreen.jsx:78`).

3. **"CW segments" in the build summary.** Mobile renders `presentation.stats`
   from the shared `getRoutePlannerPresentation`, a 5-stat array including
   `מקטעי CW` and `נקודות`. The mobile-web `BuildPanel` **ignores `.stats`** and
   hardcodes 3 stats (length / gain / loss). The shared 5-stat array is correct
   for the *desktop* `RoutePanel`; mobile picked the wrong consumer
   (`packages/core/src/ui/routePlannerPresentation.js:60`,
   `src/components/frontPanel/BuildPanel.jsx:59`).

4. **Playback controls.** Web's `BuildPanel` has an `elevation` slot **and** a
   `playback` slot (`RoutePlaybackControls` + `useSyntheticRoutePlayback`) that
   animates a marker along the route. Mobile has the elevation chart and even a
   `routeDirectionAnimator` in core, but **no transport UI** — it shows
   "התחל ניווט" (Start navigation) instead. Playback exists as engine, with no
   controls.

**Root cause:** the shared layer is *data/logic* (presentation specs,
feature-baking, stats), but each platform hand-writes its own *view* — web with
Mapbox-GL paint expressions, mobile with hardcoded `@rnmapbox` style objects —
and they pass different inputs. Nothing forces them to agree.

## Surface-role context

Per the project's surface roles: mobile web = discovery, desktop web =
planning, native app = navigation/recording. This design aligns the app's *map
and build UI* with the more-polished mobile web **without** demoting the app's
navigation role: playback is added **alongside** the "Start navigation" CTA, not
in place of it.

## Decisions taken during brainstorming

- **Playback:** Add the route-playback transport (play/pause/scrub marker
  animation) to the build sheet **and keep "התחל ניווט" as the primary CTA.**
- **Sharing depth:** Shared specs + view-model. Both platforms consume one
  shared planner view-model (which stats/actions/summary to show) and the
  existing shared layer-style specs, with thin platform translators. Mobile
  stops hardcoding. View layers stay separate (no react-native-web shared
  components).
- **Target appearance:** match web's build state exactly — network variant
  `typed-cased`, route-geometry variant `dark`, `routeBuilding` true while
  building. No new color schemes.

## Design

### A. Shared planner build-model (kills the "CW segments" drift)

Add a shared `getPlannerBuildModel(routeState)` in
`packages/core/src/ui/` returning the *polished planner* view-model:

- `stats`: the 3 planner stats — length / gain / loss (no `מקטעי CW`, no
  `נקודות`).
- `hasRoute`, `canDownload`, `canShare`.
- POI / warning summary fields the panels need.

Web's `BuildPanel` and the mobile build sheet both consume this model. Desktop
`RoutePanel` keeps using the existing detailed `getRoutePlannerPresentation`
(the 5-stat surface is correct *there*). The planner stats can no longer
diverge — one function owns them.

This is intentionally a **new** function, not a change to
`getRoutePlannerPresentation`, so the desktop detailed surface is untouched.

### B. Shared layer-style specs + thin platform translators (network + route line)

The style logic already lives in core (`routeNetworkPresentation`,
`routeNetwork{Line,Casing,Shadow}StyleForPresentation`,
`routeGeometry{Line,Casing}StyleForPresentation`). The only gap is that mobile
hardcodes instead of calling them.

- Add a small shared helper `paintToRNStyle(spec)` in `packages/core/src/map/`
  that maps a Mapbox-GL `{ layout, paint }` spec → `@rnmapbox` camelCase style
  props (e.g. `paint["line-color"]` → `lineColor`, `paint["line-width"]` →
  `lineWidth`, `paint["line-opacity"]` → `lineOpacity`, `layout["line-join"]` →
  `lineJoin`). `@rnmapbox` accepts the same Mapbox expression arrays the specs
  already emit (the mobile code already relies on this for the direction-pulse
  layers at `MapScreen.jsx:104`), so the translator is a pure key rename.
- Mobile passes the **same presentation options as web's build state** —
  network variant `typed-cased`, route-geometry variant `dark`, `routeBuilding`
  true while building — to **both** `prepareRouteNetworkFeatures(...)` (so
  casing/shadow props get baked into the features) and the layer-style helpers.
- Mobile renders the network as **3 layers** (shadow → casing → core) like web,
  and the active route line as **casing + core**, all from translated shared
  specs. Delete the `NETWORK_LINE_STYLE` / `ROUTE_LINE_STYLE` hardcodes.

Result: identical colors, casing, widths, and "affected-segment" dimming, driven
by one source of truth.

### C. Playback transport on the build sheet (keep nav CTA)

Mobile already has `routeDirectionAnimator` (core) + `RouteDirectionPulseLayer`
+ elevation scrub. What's missing is transport UI.

- Extract the playback **state machine** that web's `useSyntheticRoutePlayback`
  wraps — timing, play/pause/seek/duration, cursor fraction — into a shared core
  hook/util. Web keeps its DOM control bound to it; behavior is unchanged.
- Mobile gets a native `PlaybackControls` (play/pause + scrub) bound to the same
  core state and the existing `routeDirectionAnimator`.
- The "התחל ניווט" button stays as the primary CTA below the playback row.

### D. Guardrail against future drift

- Add `tests/test-planner-build-model.mjs` asserting the shared model shape both
  panels rely on.
- Extend the existing parity test / note so that both surfaces consuming the
  shared model + specs is checked — a future hardcode that re-introduces a 5th
  stat or a flat route line gets caught.

## Scope boundary (YAGNI)

- No react-native-web shared components; view layers stay separate.
- No change to desktop `RoutePanel`'s 5-stat presentation.
- No new color schemes — reuse `typed-cased` + `dark` exactly as web's build
  state uses them.
- Navigation remains the app's primary build-panel CTA.

## Affected files (anticipated)

Shared (`packages/core`):

- `src/ui/routePlannerPresentation.js` — add `getPlannerBuildModel`.
- `src/map/` — add `paintToRNStyle` helper.
- new shared playback state util/hook (extracted from web `useRoutePlayback.js`).

Web (`src/`):

- `components/frontPanel/BuildPanel.jsx` — consume `getPlannerBuildModel`.
- `components/routePlayback/useRoutePlayback.js` — wrap the extracted core state.

Mobile (`apps/mobile/src`):

- `MapScreen.jsx` — pass presentation options to feature baking + layer styles,
  render 3 network layers + cased route line, drop hardcoded styles, consume
  `getPlannerBuildModel`.
- new native `PlaybackControls` component in `src/planner/`.

Tests:

- `tests/test-planner-build-model.mjs` (new) + parity-test note.
