# iPhone ↔ mobile-web map style parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iPhone app's map and route-building UI match the more-polished mobile web by having both surfaces consume the same shared presentation specs, planner view-model, and playback engine.

**Architecture:** All visual *logic* already lives in `@cycleways/core`; each platform hand-writes its *view* and the mobile app passes wrong/missing inputs, so they drift. We (A) add a shared planner build-model so the build summary can't diverge, (B) wire mobile's `@rnmapbox` layers to the existing shared style specs via a thin paint→style translator, and (C) extract the web playback engine into a clock-injected core module that both a web hook and a native control bind to.

**Tech Stack:** React 19 (web), React Native / Expo + `@rnmapbox/maps` (mobile), Mapbox-GL style expressions (shared), Node `assert`-based unit tests run via `npm test`.

## Global Constraints

- Shared code lives in `packages/core/src`; import via `@cycleways/core/<subpath>.js` (the package `exports` map is `"./*": "./src/*"`).
- Mobile is React Native: **no** `window`, `document`, DOM events, or `<input>`/`<div>` in mobile or in shared core modules consumed by mobile. Inject a clock (`{ now, requestFrame, cancelFrame }`) where animation timing is needed, mirroring `packages/core/src/domain/routeDirectionAnimator.js`.
- `@rnmapbox` `LineLayer`/`CircleLayer` `style` props accept the **same** Mapbox-GL expression arrays the shared specs emit (the mobile code already relies on this at `apps/mobile/src/MapScreen.jsx:104`). The translator only renames `kebab-case` paint/layout keys to `camelCase`.
- Target appearance copied verbatim from web build state: network variant `"typed-cased"`, route-geometry variant `"dark"`, `routeBuilding: true` while the build panel is active; `"current"` / `"auto"` / `"mapbox-outdoors"` otherwise (see `src/App.jsx:460-474`).
- All Hebrew UI copy must match the mobile-web strings exactly (e.g. stats `אורך` / `טיפוס` / `ירידה`).
- New tests must be appended to the `"test"` script chain in the root `package.json` so `npm test` runs them.
- Do not hand-edit `public-data/` or `data/map-source.geojson`; not touched by this plan.

---

## File Structure

Shared (`packages/core/src`):
- `ui/routePlannerPresentation.js` — **add** `getPlannerBuildModel(routeState)` (Phase A).
- `map/paintToRNStyle.js` — **new**, paint/layout → `@rnmapbox` style translator (Phase B).
- `domain/routeGeometryMath.js` — **new** home for the pure polyline math currently in `src/components/featured/routeGeometry.js` (Phase C).
- `ui/routePlaybackDuration.js`, `ui/routePlaybackSync.js` — **new** homes for the pure playback math (Phase C).
- `ui/routePlaybackEngine.js` — **new** clock-injected playback state machine + `useRoutePlaybackEngine` / `useSyntheticRoutePlaybackEngine` hooks (Phase C).

Web (`src`):
- `components/frontPanel/BuildPanel.jsx` — consume `getPlannerBuildModel` (Phase A).
- `components/featured/routeGeometry.js`, `routePlaybackDuration.js`, `routePlaybackSync.js` — become thin re-exports from core (Phase C).
- `components/routePlayback/useRoutePlayback.js` — wrap the core engine, keep DOM scrub handlers (Phase C).

Mobile (`apps/mobile/src`):
- `MapScreen.jsx` — pass presentation options to baking + layers, render 3 network layers + cased route line, drop hardcoded styles, consume `getPlannerBuildModel`, host playback (Phases A/B/C).
- `planner/PlaybackControls.jsx` — **new** native transport row (Phase C).

Tests (`tests/`):
- `test-planner-build-model.mjs` (A), `test-paint-to-rn-style.mjs` (B), `test-route-playback-engine.mjs` (C).

---

# Phase A — Shared planner build-model

### Task A1: Add `getPlannerBuildModel` to core

**Files:**
- Modify: `packages/core/src/ui/routePlannerPresentation.js`
- Test: `tests/test-planner-build-model.mjs` (create)
- Modify: `package.json` (append test to the `test` script)

**Interfaces:**
- Produces: `getPlannerBuildModel(routeState) -> { hasRoute: boolean, canDownload: boolean, stats: Array<[label: string, value: string]>, poiCount: number, warningCount: number }` where `stats` is exactly the 3 planner stats `אורך` / `טיפוס` / `ירידה` (length / elevation gain / elevation loss). Reuses the existing `formatDistance`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-planner-build-model.mjs`:

```js
import assert from "node:assert/strict";
import { getPlannerBuildModel } from "@cycleways/core/ui/routePlannerPresentation.js";

// Empty route: no stats, nothing downloadable.
const empty = getPlannerBuildModel({
  points: [],
  geometry: [],
  distance: 0,
  elevationGain: 0,
  elevationLoss: 0,
  selectedSegments: [],
  activeDataPoints: [],
});
assert.equal(empty.hasRoute, false);
assert.equal(empty.canDownload, false);
assert.deepEqual(empty.stats, []);

// Built route: exactly 3 stats, in order, no "CW segments" or "points".
const built = getPlannerBuildModel({
  points: [{}, {}],
  geometry: [{}, {}, {}],
  distance: 5230,
  elevationGain: 142,
  elevationLoss: 87,
  selectedSegments: ["a", "b", "c"],
  activeDataPoints: [{ id: "x" }],
});
assert.equal(built.hasRoute, true);
assert.equal(built.canDownload, true);
assert.equal(built.stats.length, 3);
assert.deepEqual(
  built.stats.map(([label]) => label),
  ["אורך", "טיפוס", "ירידה"],
);
assert.deepEqual(built.stats[0], ["אורך", "5.2 ק״מ"]);
assert.deepEqual(built.stats[1], ["טיפוס", "142 מ׳"]);
assert.deepEqual(built.stats[2], ["ירידה", "87 מ׳"]);
// No stat mentions CW segments.
assert.ok(!built.stats.some(([label]) => label.includes("CW")));
assert.equal(built.poiCount, 1);

console.log("test-planner-build-model: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-planner-build-model.mjs`
Expected: FAIL — `getPlannerBuildModel is not a function` / not exported.

- [ ] **Step 3: Implement `getPlannerBuildModel`**

In `packages/core/src/ui/routePlannerPresentation.js`, after `getRoutePlannerPresentation`, add:

```js
export function getPlannerBuildModel(routeState) {
  const hasRoute = routeState.geometry.length >= 2;
  const activeDataPoints = Array.isArray(routeState.activeDataPoints)
    ? routeState.activeDataPoints
    : [];
  return {
    hasRoute,
    canDownload: hasRoute,
    stats: hasRoute
      ? [
          ["אורך", formatDistance(routeState.distance)],
          ["טיפוס", `${Math.round(routeState.elevationGain || 0)} מ׳`],
          ["ירידה", `${Math.round(routeState.elevationLoss || 0)} מ׳`],
        ]
      : [],
    poiCount: activeDataPoints.length,
    warningCount: activeDataPoints.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-planner-build-model.mjs`
Expected: `test-planner-build-model: OK`

- [ ] **Step 5: Register the test in `npm test`**

In root `package.json`, in the `"test"` script string, append ` && node tests/test-planner-build-model.mjs` immediately after `node tests/test-route-poi-list.mjs`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ui/routePlannerPresentation.js tests/test-planner-build-model.mjs package.json
git commit -m "feat(core): shared getPlannerBuildModel for the planner build summary"
```

---

### Task A2: Mobile build sheet consumes the 3-stat model

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `getPlannerBuildModel(routeState)` from Task A1.

Context: the mobile build sheet currently renders `presentation.stats` (the 5-stat array with `מקטעי CW` and `נקודות`) at `apps/mobile/src/MapScreen.jsx:1106`. `BuildPanelContent` receives `routeState` already (`MapScreen.jsx:985`).

- [ ] **Step 1: Import the model**

Add to the `@cycleways/core/ui/routePlannerPresentation.js` import line (`MapScreen.jsx:53`):

```js
import {
  getPlannerBuildModel,
  getRoutePlannerPresentation,
} from "@cycleways/core/ui/routePlannerPresentation.js";
```

- [ ] **Step 2: Compute the model inside `BuildPanelContent`**

In `BuildPanelContent`, near where it reads `routeState`, add:

```js
const buildModel = getPlannerBuildModel(routeState);
```

- [ ] **Step 3: Render the 3-stat model instead of `presentation.stats`**

Replace the stat grid block (currently mapping `presentation.stats`, `MapScreen.jsx:1103-1112`):

```jsx
{buildModel.hasRoute ? (
  <View testID="route-stats" style={styles.statGrid}>
    {buildModel.stats.map(([label, value]) => (
      <View key={label} style={styles.statTile}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    ))}
  </View>
) : null}
```

(Leave `presentation.warnings`, `presentation.message`, and the summary modal untouched — those still use `getRoutePlannerPresentation`.)

- [ ] **Step 4: Verify the parity smoke test still passes**

Run: `cd apps/mobile && npx maestro test .maestro/discover-build-smoke.yaml` (or, if a device/emulator is unavailable, manually confirm the build sheet now shows only 3 tiles: אורך / טיפוס / ירידה).
Expected: build sheet shows length / gain / loss only; no "מקטעי CW" tile.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): build summary uses shared 3-stat planner model (drops CW segments)"
```

---

### Task A3: Web BuildPanel consumes the shared model (single source)

**Files:**
- Modify: `src/components/frontPanel/BuildPanel.jsx`

**Interfaces:**
- Consumes: `getPlannerBuildModel(routeState)` from Task A1.

Context: web already shows the correct 3 stats but computes them inline (`BuildPanel.jsx:58-66`). Point it at the shared model so web and mobile share one source of truth.

- [ ] **Step 1: Import the model**

At the top of `src/components/frontPanel/BuildPanel.jsx`:

```js
import { getPlannerBuildModel } from "@cycleways/core/ui/routePlannerPresentation.js";
```

- [ ] **Step 2: Replace the inline stats**

Replace the `hasRoute` derivation and the inline `build-panel__stats` block. Change `const hasRoute = routeState.geometry.length >= 2;` to:

```js
const buildModel = getPlannerBuildModel(routeState);
const hasRoute = buildModel.hasRoute;
```

and replace the stats `<div>` (`BuildPanel.jsx:58-66`) with:

```jsx
{hasRoute ? (
  <div className="build-panel__stats">
    {buildModel.stats.map(([k, v]) => (
      <Stat key={k} k={k} v={v} />
    ))}
  </div>
) : (
  <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
)}
```

- [ ] **Step 3: Run the related unit tests**

Run: `node tests/test-planner-build-model.mjs`
Expected: `test-planner-build-model: OK` (the model contract web now depends on).

- [ ] **Step 4: Verify the web planner renders 3 stats**

Run: `npm run dev`, open the planner, build a 2+ point route, confirm the build panel still shows אורך / טיפוס / ירידה with the same values as before.
Expected: unchanged appearance.

- [ ] **Step 5: Commit**

```bash
git add src/components/frontPanel/BuildPanel.jsx
git commit -m "refactor(web): BuildPanel stats from shared getPlannerBuildModel"
```

---

# Phase B — Shared layer styling parity

### Task B1: Add the `paintToRNStyle` translator to core

**Files:**
- Create: `packages/core/src/map/paintToRNStyle.js`
- Test: `tests/test-paint-to-rn-style.mjs` (create)
- Modify: `package.json` (append test)

**Interfaces:**
- Produces: `paintToRNStyle(spec) -> object` mapping a Mapbox-GL `{ layout?, paint? }` spec to `@rnmapbox` camelCase style props. Converts every `kebab-case` key under `layout` and `paint` to `camelCase` (`line-color` → `lineColor`, `line-join` → `lineJoin`, `line-opacity` → `lineOpacity`, `line-blur` → `lineBlur`, etc.), preserving values (including expression arrays) untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/test-paint-to-rn-style.mjs`:

```js
import assert from "node:assert/strict";
import { paintToRNStyle } from "@cycleways/core/map/paintToRNStyle.js";
import {
  routeNetworkLineStyleForPresentation,
} from "@cycleways/core/map/networkPresentation.js";

// Renames keys, preserves expression-array values.
const out = paintToRNStyle({
  layout: { "line-join": "round", "line-cap": "round" },
  paint: {
    "line-color": ["get", "routeColor"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5],
    "line-opacity": ["get", "routeOpacity"],
  },
});
assert.equal(out.lineJoin, "round");
assert.equal(out.lineCap, "round");
assert.deepEqual(out.lineColor, ["get", "routeColor"]);
assert.deepEqual(out.lineWidth, ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5]);
assert.deepEqual(out.lineOpacity, ["get", "routeOpacity"]);

// Works on a real shared spec without throwing and yields camelCase keys only.
const styled = paintToRNStyle(routeNetworkLineStyleForPresentation({ variant: "typed-cased" }));
assert.ok("lineColor" in styled);
assert.ok(!Object.keys(styled).some((key) => key.includes("-")));

// Tolerates missing layout/paint.
assert.deepEqual(paintToRNStyle({}), {});

console.log("test-paint-to-rn-style: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-paint-to-rn-style.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the translator**

Create `packages/core/src/map/paintToRNStyle.js`:

```js
function kebabToCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Maps a Mapbox-GL { layout, paint } spec to @rnmapbox camelCase style props.
// Values (including expression arrays) are passed through untouched; @rnmapbox
// accepts the same expression dialect the shared specs emit.
export function paintToRNStyle(spec = {}) {
  const out = {};
  for (const group of ["layout", "paint"]) {
    const section = spec[group];
    if (!section) continue;
    for (const [key, value] of Object.entries(section)) {
      out[kebabToCamel(key)] = value;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-paint-to-rn-style.mjs`
Expected: `test-paint-to-rn-style: OK`

- [ ] **Step 5: Register the test**

In root `package.json` `"test"` script, append ` && node tests/test-paint-to-rn-style.mjs` after the Task A1 entry.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/map/paintToRNStyle.js tests/test-paint-to-rn-style.mjs package.json
git commit -m "feat(core): paintToRNStyle translator for @rnmapbox layer specs"
```

---

### Task B2: Mobile derives build presentation options + bakes casing/shadow

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `routeNetworkPresentation`, `prepareRouteNetworkFeatures` (core), `panelState`/`isNavigating` (already in `MapScreen`).
- Produces: `networkPresentation` object + presentation-baked `networkFeatures` that later tasks' layers read.

Context: `prepareRouteNetworkFeatures(state.assets.geoJsonData)` is called with no options (`MapScreen.jsx:286`), so casing/shadow props are never baked. We pass the build variant when the build panel is active, matching web (`src/App.jsx:460-474`).

- [ ] **Step 1: Import the presentation helpers**

Add near the other core map imports (after `MapScreen.jsx:52`):

```js
import { routeNetworkPresentation } from "@cycleways/core/map/networkPresentation.js";
import { paintToRNStyle } from "@cycleways/core/map/paintToRNStyle.js";
import {
  routeNetworkLineStyleForPresentation,
  routeNetworkCasingStyleForPresentation,
  routeNetworkShadowStyleForPresentation,
  routeGeometryLineStyleForPresentation,
  routeGeometryCasingStyleForPresentation,
} from "@cycleways/core/map/networkPresentation.js";
```

- [ ] **Step 2: Derive the active presentation options**

Inside the component, after `panelState` and `isNavigating` are available, add:

```js
const mapPresentationActive = panelState === "build" && !isNavigating;
const networkPresentationOptions = useMemo(
  () => ({
    variant: mapPresentationActive ? "typed-cased" : "current",
    routeBuilding: mapPresentationActive,
    baseMapProfile: "mapbox-outdoors",
    colorScheme: "auto",
  }),
  [mapPresentationActive],
);
const networkPresentation = useMemo(
  () => routeNetworkPresentation(networkPresentationOptions),
  [networkPresentationOptions],
);
```

- [ ] **Step 3: Bake casing/shadow into the network features**

Replace the `networkFeatures` memo (`MapScreen.jsx:282-289`):

```js
const networkFeatures = useMemo(() => {
  if (state.status !== "ready") return EMPTY_FEATURE_COLLECTION;
  return {
    type: "FeatureCollection",
    features: prepareRouteNetworkFeatures(
      state.assets.geoJsonData,
      networkPresentationOptions,
    ),
  };
}, [state.assets, state.status, networkPresentationOptions]);
```

- [ ] **Step 4: Verify the app still builds**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/rn-parity-check >/dev/null` (or start Metro: `npm run mobile`). Confirm no bundling/import errors.
Expected: bundles cleanly; map still renders (layers updated in B3/B4).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): bake network casing/shadow via shared build presentation options"
```

---

### Task B3: Mobile renders the network as shadow → casing → core

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `networkPresentation` (B2), `paintToRNStyle`, the three `routeNetwork*StyleForPresentation` helpers, baked feature props `routeCasingColor` / `routeCasingOpacity` / `routeShadowColor` / `routeShadowOpacity` / `routeColor` / `routeOpacity`.

Context: the network currently renders a single hardcoded `NETWORK_LINE_STYLE` line (`MapScreen.jsx:838-840`). Web draws shadow → casing → core (`src/map/mapLayers.product.js:247-261`).

- [ ] **Step 1: Build the three translated layer styles**

Inside the component (after `networkPresentation`), add:

```js
const networkLayerStyles = useMemo(
  () => ({
    shadow: paintToRNStyle(
      routeNetworkShadowStyleForPresentation(networkPresentation),
    ),
    casing: paintToRNStyle(
      routeNetworkCasingStyleForPresentation(networkPresentation),
    ),
    core: paintToRNStyle(
      routeNetworkLineStyleForPresentation(networkPresentation),
    ),
  }),
  [networkPresentation],
);
```

- [ ] **Step 2: Render three layers in the network source**

Replace the network `ShapeSource` block (`MapScreen.jsx:838-840`):

```jsx
<ShapeSource id="network" shape={networkFeatures}>
  <LineLayer id="network-shadow" style={networkLayerStyles.shadow} />
  <LineLayer id="network-casing" style={networkLayerStyles.casing} />
  <LineLayer id="network-line" style={networkLayerStyles.core} />
</ShapeSource>
```

- [ ] **Step 3: Delete the dead `NETWORK_LINE_STYLE` constant**

Remove the `NETWORK_LINE_STYLE` definition (`MapScreen.jsx:69-75`) and its comment — it is no longer referenced.

- [ ] **Step 4: Verify on device/simulator**

Run: `npm run mobile`, open the build panel, confirm the network draws as cased blue/gray/brown lines (matching web build state) with a soft shadow, instead of flat muted single lines. Switch to discover: network reverts to the muted `current` single-look (casing/shadow opacity 0).
Expected: build-state network matches web.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): render network as shadow/casing/core from shared specs"
```

---

### Task B4: Mobile active route line uses the `dark` cased geometry style

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `routeGeometryLineStyleForPresentation("dark")`, `routeGeometryCasingStyleForPresentation("dark")`, `paintToRNStyle`.

Context: the route line is hardcoded flat `#006699` width 5 (`ROUTE_LINE_STYLE`, `MapScreen.jsx:77-83`; rendered at `MapScreen.jsx:841-843`). Web uses the `dark` variant with casing + affected-opacity dimming.

- [ ] **Step 1: Build the translated route line styles**

Add inside the component:

```js
const routeLineStyles = useMemo(
  () => ({
    casing: paintToRNStyle(routeGeometryCasingStyleForPresentation("dark")),
    core: paintToRNStyle(routeGeometryLineStyleForPresentation("dark")),
  }),
  [],
);
```

- [ ] **Step 2: Render casing + core for the route geometry**

Replace the route-geometry `ShapeSource` block (`MapScreen.jsx:841-843`):

```jsx
<ShapeSource id="route-geometry" shape={routeGeometry}>
  <LineLayer id="route-casing" style={routeLineStyles.casing} />
  <LineLayer id="route-line" style={routeLineStyles.core} />
</ShapeSource>
```

- [ ] **Step 3: Delete the dead `ROUTE_LINE_STYLE` constant**

Remove the `ROUTE_LINE_STYLE` definition (`MapScreen.jsx:77-83`). Keep `ROUTE_TRAVELED_LINE_STYLE` and `RIDER_MARKER_STYLE` — navigation still uses them.

- [ ] **Step 4: Confirm the route-geometry features carry `affected`**

The `dark` style's opacity expression reads `["get", "affected"]`. Verify `buildRouteGeometryFeatureCollection` (`MapScreen.jsx:1396`) emits an `affected` property per feature; if it emits a single feature without `affected`, the `case` expression falls through to the non-affected opacity, which is correct (full opacity). No change required unless features are split by affected state.
Expected: route renders at full opacity when nothing is "affected".

- [ ] **Step 5: Verify on device/simulator**

Run: `npm run mobile`, build a route, confirm the active line is the dark `#102a43` core with a white casing (matching web), not flat teal-blue.
Expected: route line matches web `dark` variant.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): active route line uses shared dark cased geometry style"
```

---

# Phase C — Playback transport on the build sheet

> Phase C is the largest. C1–C2 relocate pure math to core (web keeps working via re-exports). C3 extracts a clock-injected engine. C4 adds the native control and wires it on mobile. Each task is independently shippable.

### Task C1: Move route geometry math to core

**Files:**
- Create: `packages/core/src/domain/routeGeometryMath.js`
- Modify: `src/components/featured/routeGeometry.js` (becomes a re-export)

**Interfaces:**
- Produces (core): `buildCumulativeDistances`, `nearestPointOnPolyline`, `pointAtFraction`, `projectPointToRouteCandidates`, `snapPointToRouteWithinWindow`, `haversineMeters`, `EARTH_RADIUS_M`, `DEG` — identical signatures to the current `src/components/featured/routeGeometry.js`.

- [ ] **Step 1: Copy the module into core verbatim**

Copy the entire current contents of `src/components/featured/routeGeometry.js` into a new file `packages/core/src/domain/routeGeometryMath.js` (it is pure — no DOM). No code changes.

- [ ] **Step 2: Replace the web module with a re-export**

Overwrite `src/components/featured/routeGeometry.js` with:

```js
export * from "@cycleways/core/domain/routeGeometryMath.js";
```

- [ ] **Step 3: Run the geometry-dependent tests**

Run: `node tests/test-route-geometry.mjs && node tests/test-route-playback-sync.mjs`
Expected: both PASS (same math, new location).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/domain/routeGeometryMath.js src/components/featured/routeGeometry.js
git commit -m "refactor(core): move route geometry math into core (web re-exports)"
```

---

### Task C2: Move playback duration + sync math to core

**Files:**
- Create: `packages/core/src/ui/routePlaybackDuration.js`
- Create: `packages/core/src/ui/routePlaybackSync.js`
- Modify: `src/components/featured/routePlaybackDuration.js` (re-export)
- Modify: `src/components/featured/routePlaybackSync.js` (re-export)

**Interfaces:**
- Produces (core): `computeMapPlaybackDuration(...)`, `MIN_MAP_PLAYBACK_SECONDS`, `MAX_MAP_PLAYBACK_SECONDS`; `createLinearRoutePlaybackSync(...)`, `createVariableSpeedRoutePlaybackSync(...)` — identical signatures to the current web modules. `routePlaybackSync` in core imports geometry from `../domain/routeGeometryMath.js`.

- [ ] **Step 1: Copy duration math to core**

Copy `src/components/featured/routePlaybackDuration.js` verbatim into `packages/core/src/ui/routePlaybackDuration.js` (pure, no imports).

- [ ] **Step 2: Copy sync math to core, repoint its geometry import**

Copy `src/components/featured/routePlaybackSync.js` into `packages/core/src/ui/routePlaybackSync.js`, changing only its first import from `./routeGeometry.js` to `../domain/routeGeometryMath.js`.

- [ ] **Step 3: Replace both web modules with re-exports**

`src/components/featured/routePlaybackDuration.js`:

```js
export * from "@cycleways/core/ui/routePlaybackDuration.js";
```

`src/components/featured/routePlaybackSync.js`:

```js
export * from "@cycleways/core/ui/routePlaybackSync.js";
```

- [ ] **Step 4: Run the playback math tests**

Run: `node tests/test-route-playback-duration.mjs && node tests/test-route-playback-sync.mjs`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ui/routePlaybackDuration.js packages/core/src/ui/routePlaybackSync.js src/components/featured/routePlaybackDuration.js src/components/featured/routePlaybackSync.js
git commit -m "refactor(core): move playback duration+sync math into core (web re-exports)"
```

---

### Task C3: Extract a clock-injected playback engine into core

**Files:**
- Create: `packages/core/src/ui/routePlaybackEngine.js`
- Test: `tests/test-route-playback-engine.mjs` (create)
- Modify: `package.json` (append test)
- Modify: `src/components/routePlayback/useRoutePlayback.js` (wrap the core engine)

**Interfaces:**
- Produces:
  - `createRoutePlaybackEngine({ sync, fallbackDuration, clock, onCursorChange, onPlayingChange }) -> { getState(): { currentTime, cursor, duration, isPlaying, isReady }, play(), pause(), togglePlayback(), seekToTime(t), seekToFraction(f), reset(), subscribe(cb): unsubscribe, dispose() }`. `clock` is `{ now(), requestFrame(cb), cancelFrame(id) }`, defaulting to `requestAnimationFrame`/`cancelAnimationFrame`/`Date.now`-based timing usable on web **and** React Native (no `window.`).
  - `useRoutePlaybackEngine({ sync, fallbackDuration, onCursorChange, onPlayingChange, clock? })` — a React hook (works in both renderers) returning `{ currentTime, cursor, duration, isPlaying, isReady, isScrubbing, play, pause, togglePlayback, seekToTime, seekToFraction, reset }`. No DOM scrub handlers here.
  - `useSyntheticRoutePlaybackEngine({ enabled, routeState, cueSlides, onCursorChange, onPlayingChange, clock? })` — builds the variable-speed `sync` (moved logic from web `useSyntheticRoutePlayback`) and delegates to `useRoutePlaybackEngine`.
- Consumes: `createVariableSpeedRoutePlaybackSync`, `computeMapPlaybackDuration` from core (Task C2).

Note: the existing web `useRoutePlayback` keeps the DOM-specific scrub handlers (`onScrubStart/Change/End`, pointer capture). Those stay web-only and wrap the engine's `play`/`pause`/`seekToTime`.

- [ ] **Step 1: Write the failing test (framework-agnostic engine, fake clock)**

Create `tests/test-route-playback-engine.mjs`:

```js
import assert from "node:assert/strict";
import { createRoutePlaybackEngine } from "@cycleways/core/ui/routePlaybackEngine.js";

// Minimal fake sync: 10s duration, linear cursor along a 2-point route.
const sync = {
  durationSeconds: 10,
  timeToPosition: (t) => ({ lat: t / 10, lng: 0, fraction: t / 10 }),
  positionToTime: (f) => f * 10,
};

// Controllable fake clock.
let nowMs = 0;
let queued = null;
const clock = {
  now: () => nowMs,
  requestFrame: (cb) => { queued = cb; return 1; },
  cancelFrame: () => { queued = null; },
};
function advance(ms) {
  nowMs += ms;
  const cb = queued;
  queued = null;
  if (cb) cb(nowMs);
}

const cursors = [];
const engine = createRoutePlaybackEngine({
  sync,
  fallbackDuration: 10,
  clock,
  onCursorChange: (c) => cursors.push(c),
});

assert.equal(engine.getState().duration, 10);
assert.equal(engine.getState().isPlaying, false);

// Seek to a fraction → cursor emitted at the right place.
engine.seekToFraction(0.5);
assert.equal(Math.round(engine.getState().currentTime), 5);
assert.equal(engine.getState().cursor.fraction, 0.5);

// Play advances the cursor over time.
engine.seekToTime(0);
engine.play();
assert.equal(engine.getState().isPlaying, true);
advance(2000); // 2s
assert.ok(engine.getState().currentTime >= 2 - 0.001);

// Reaching the end stops playback.
advance(20000);
assert.equal(engine.getState().isPlaying, false);
assert.equal(Math.round(engine.getState().currentTime), 10);

engine.dispose();
console.log("test-route-playback-engine: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-route-playback-engine.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine + hooks**

Create `packages/core/src/ui/routePlaybackEngine.js`. Port the timing/cursor logic from `src/components/routePlayback/useRoutePlayback.js` into a plain object driven by an injected `clock`, then add thin React-hook wrappers. Full module:

```js
import { useEffect, useMemo, useRef, useState } from "react";
import { computeMapPlaybackDuration } from "./routePlaybackDuration.js";
import { createVariableSpeedRoutePlaybackSync } from "./routePlaybackSync.js";

const MAP_PLAYBACK_PREVIEW_MAX_FRACTION = 0.06;
const MAP_PLAYBACK_PREVIEW_MAX_METERS = 1200;
const MAP_PLAYBACK_BORING_RATE = 4;
const MAP_PLAYBACK_DURATION_SCALE = 0.55;

function defaultClock() {
  // requestAnimationFrame / cancelAnimationFrame exist globally on web and RN.
  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(Date.now()), 16);
  const caf =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : (id) => clearTimeout(id);
  const now =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();
  return { now, requestFrame: (cb) => raf(cb), cancelFrame: (id) => caf(id) };
}

function clampTime(time, duration) {
  const value = Number(time);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(duration, value));
}

export function createRoutePlaybackEngine({
  sync,
  fallbackDuration = 0,
  clock = defaultClock(),
  onCursorChange,
  onPlayingChange,
}) {
  const duration = sync?.durationSeconds ?? fallbackDuration;
  let currentTime = 0;
  let cursor = null;
  let isPlaying = false;
  let frameId = null;
  let lastFrameTime = null;
  const subscribers = new Set();

  function getState() {
    return { currentTime, cursor, duration, isPlaying, isReady: Boolean(sync) };
  }
  function notify() {
    const state = getState();
    subscribers.forEach((cb) => cb(state));
  }
  function subscribe(cb) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }
  function setPlaying(next) {
    isPlaying = next;
    onPlayingChange?.(next);
  }
  function stopTicker() {
    if (frameId !== null) {
      clock.cancelFrame(frameId);
      frameId = null;
    }
    lastFrameTime = null;
  }
  function emitCursorForTime(time) {
    if (!sync) return null;
    const t = clampTime(time, duration);
    currentTime = t;
    const position = sync.timeToPosition(t);
    cursor = { t, lat: position.lat, lng: position.lng, fraction: position.fraction };
    onCursorChange?.(cursor);
    notify();
    return cursor;
  }
  function tick(now) {
    if (!isPlaying) { frameId = null; lastFrameTime = null; return; }
    const last = Number.isFinite(lastFrameTime) ? lastFrameTime : now;
    lastFrameTime = now;
    const elapsed = Math.max(0, (now - last) / 1000);
    const nextTime = Math.min(duration, currentTime + elapsed);
    emitCursorForTime(nextTime);
    if (nextTime >= duration) {
      setPlaying(false);
      frameId = null;
      lastFrameTime = null;
      notify();
      return;
    }
    frameId = clock.requestFrame(tick);
  }
  function startTicker() {
    if (!sync || frameId !== null) return;
    lastFrameTime = clock.now();
    frameId = clock.requestFrame(tick);
  }
  function play() {
    if (!sync) return;
    if (currentTime >= duration - 0.05) emitCursorForTime(0);
    setPlaying(true);
    notify();
    startTicker();
  }
  function pause() {
    setPlaying(false);
    stopTicker();
    notify();
  }
  function seekToTime(time) {
    const next = emitCursorForTime(time);
    if (currentTime >= duration && isPlaying) pause();
    return next;
  }
  function seekToFraction(fraction) {
    if (!sync || typeof sync.positionToTime !== "function") return null;
    return seekToTime(sync.positionToTime(fraction));
  }
  function togglePlayback() {
    if (isPlaying) pause();
    else play();
  }
  function reset() {
    stopTicker();
    currentTime = 0;
    cursor = null;
    setPlaying(false);
    onCursorChange?.(null);
    notify();
  }
  function dispose() {
    stopTicker();
    subscribers.clear();
  }

  if (sync) emitCursorForTime(0);

  return {
    getState, subscribe,
    play, pause, togglePlayback,
    seekToTime, seekToFraction, reset, dispose,
  };
}

export function useRoutePlaybackEngine({
  sync,
  fallbackDuration = 0,
  onCursorChange,
  onPlayingChange,
  clock,
}) {
  const onCursorChangeRef = useRef(onCursorChange);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => { onCursorChangeRef.current = onCursorChange; }, [onCursorChange]);
  useEffect(() => { onPlayingChangeRef.current = onPlayingChange; }, [onPlayingChange]);

  const engine = useMemo(
    () => createRoutePlaybackEngine({
      sync,
      fallbackDuration,
      clock,
      onCursorChange: (c) => onCursorChangeRef.current?.(c),
      onPlayingChange: (p) => onPlayingChangeRef.current?.(p),
    }),
    [sync, fallbackDuration, clock],
  );

  const [state, setState] = useState(() => engine.getState());
  useEffect(() => {
    setState(engine.getState());
    const unsubscribe = engine.subscribe(setState);
    return () => { unsubscribe(); engine.dispose(); };
  }, [engine]);

  return {
    currentTime: state.currentTime,
    cursor: state.cursor,
    duration: state.duration,
    isPlaying: state.isPlaying,
    isReady: state.isReady,
    hasCursor: Boolean(state.cursor),
    play: engine.play,
    pause: engine.pause,
    togglePlayback: engine.togglePlayback,
    seekToTime: engine.seekToTime,
    seekToFraction: engine.seekToFraction,
    reset: engine.reset,
  };
}

export function useSyntheticRoutePlaybackEngine({
  enabled = true,
  routeState,
  cueSlides,
  onCursorChange,
  onPlayingChange,
  clock,
}) {
  const safeCueSlides = Array.isArray(cueSlides) ? cueSlides : [];
  const cueCount = useMemo(
    () => safeCueSlides.filter((s) => s.kind !== "start" && s.kind !== "end").length,
    [safeCueSlides],
  );
  const baseDuration = useMemo(
    () => computeMapPlaybackDuration({
      distanceMeters: routeState?.distance,
      elevationGainMeters: routeState?.elevationGain,
      cueCount,
    }),
    [cueCount, routeState?.distance, routeState?.elevationGain],
  );
  const sync = useMemo(() => {
    if (!enabled || !Array.isArray(routeState?.geometry) || routeState.geometry.length < 2) {
      return null;
    }
    return createVariableSpeedRoutePlaybackSync({
      baseDurationSeconds: baseDuration * MAP_PLAYBACK_DURATION_SCALE,
      routeGeometry: routeState.geometry,
      routeDistanceMeters: routeState.distance,
      cueSlides: safeCueSlides,
      cueMaxFraction: MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
      cueMaxMeters: MAP_PLAYBACK_PREVIEW_MAX_METERS,
      fastRate: MAP_PLAYBACK_BORING_RATE,
    });
  }, [baseDuration, enabled, routeState?.distance, routeState?.geometry, safeCueSlides]);

  return useRoutePlaybackEngine({
    sync,
    fallbackDuration: baseDuration,
    onCursorChange,
    onPlayingChange,
    clock,
  });
}

export {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-route-playback-engine.mjs`
Expected: `test-route-playback-engine: OK`

- [ ] **Step 5: Rewire web `useRoutePlayback` onto the engine (behavior unchanged)**

In `src/components/routePlayback/useRoutePlayback.js`, replace the hand-rolled timing internals so the hook delegates to `useRoutePlaybackEngine` and only adds the DOM scrub handlers. Keep the existing public return shape (`onScrubStart/Change/End`, `isScrubbing`, `sync`, etc.). Concretely:
  - Import `{ useRoutePlaybackEngine, useSyntheticRoutePlaybackEngine, MAP_PLAYBACK_ROUTE_FIT_PADDING? }` from `@cycleways/core/ui/routePlaybackEngine.js` (re-export `MAP_PLAYBACK_ROUTE_FIT_PADDING` from web since it is DOM-padding config; keep it defined in the web file).
  - Replace the body of `useSyntheticRoutePlayback` with a call to `useSyntheticRoutePlaybackEngine(...)` plus the web-only scrub state (`isScrubbing`, `onScrubStart/Change/End`, pointer capture) implemented locally on top of the engine's `play`/`pause`/`seekToTime`.

**Export-preservation requirement:** `App.jsx` imports `MAP_PLAYBACK_PREVIEW_MAX_FRACTION` / `MAP_PLAYBACK_PREVIEW_MAX_METERS` / `useSyntheticRoutePlayback`; `src/components/featured/RouteMapPlayback.jsx` imports `MAP_PLAYBACK_BORING_RATE` / `MAP_PLAYBACK_PREVIEW_MAX_FRACTION` / `MAP_PLAYBACK_PREVIEW_MAX_METERS` / `MAP_PLAYBACK_ROUTE_FIT_PADDING` / `useSyntheticRoutePlayback`; `src/components/featured/VideoEmbed.jsx` imports `useSyntheticRoutePlayback`. The rewritten `useRoutePlayback.js` MUST keep all of these as exports (re-export the constants from the core engine; keep `MAP_PLAYBACK_ROUTE_FIT_PADDING` defined locally since it is DOM padding config).

```js
import { useCallback, useRef, useState } from "react";
import {
  useSyntheticRoutePlaybackEngine,
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
} from "@cycleways/core/ui/routePlaybackEngine.js";

export const MAP_PLAYBACK_ROUTE_FIT_PADDING = Object.freeze({
  top: 24, right: 24, bottom: 108, left: 24,
});

export function useSyntheticRoutePlayback(options) {
  const engine = useSyntheticRoutePlaybackEngine(options);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);

  const onScrubStart = useCallback((event) => {
    if (event?.currentTarget?.setPointerCapture && Number.isFinite(event.pointerId)) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    }
    scrubbingRef.current = true;
    setIsScrubbing(true);
    wasPlayingRef.current = engine.isPlaying;
    if (engine.isPlaying) engine.pause();
  }, [engine]);

  const onScrubChange = useCallback((event) => {
    engine.seekToTime(event.currentTarget.value);
  }, [engine]);

  const onScrubEnd = useCallback((event) => {
    if (event?.currentTarget?.releasePointerCapture && Number.isFinite(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    }
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setIsScrubbing(false);
    if (wasPlayingRef.current) engine.play();
    wasPlayingRef.current = false;
  }, [engine]);

  return { ...engine, isScrubbing, onScrubStart, onScrubChange, onScrubEnd };
}

export {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
};
```

Verify after this step: `grep -rn "from \"\\.\\./routePlayback/useRoutePlayback\\|from \"\\./components/routePlayback/useRoutePlayback" src` — every imported name (`useSyntheticRoutePlayback`, the four `MAP_PLAYBACK_*` constants, `MAP_PLAYBACK_ROUTE_FIT_PADDING`) must still resolve.

- [ ] **Step 6: Run the full web-side playback tests + planner playback smoke**

Run: `node tests/test-route-playback-duration.mjs && node tests/test-route-playback-sync.mjs && node tests/test-route-playback-engine.mjs`
Then `npm run dev`, build a route, press play in the planner: marker animates, scrub works, pause/resume works.
Expected: tests PASS; web planner playback behaves exactly as before.

- [ ] **Step 7: Register the engine test + commit**

In root `package.json` `"test"` script, append ` && node tests/test-route-playback-engine.mjs` after the Task B1 entry.

```bash
git add packages/core/src/ui/routePlaybackEngine.js tests/test-route-playback-engine.mjs package.json src/components/routePlayback/useRoutePlayback.js
git commit -m "feat(core): clock-injected route playback engine shared by web and mobile"
```

---

### Task C4: Native PlaybackControls + wire into the mobile build sheet

**Files:**
- Create: `apps/mobile/src/planner/PlaybackControls.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx`
- Possibly add dependency: `@react-native-community/slider` (check `apps/mobile/package.json` first; if absent, `npm install @react-native-community/slider -w @cycleways/mobile`)

**Interfaces:**
- Consumes: `useSyntheticRoutePlaybackEngine` from `@cycleways/core/ui/routePlaybackEngine.js`; the existing `RouteDirectionPulseLayer` / scrub marker for drawing the moving cursor.
- Produces: `<PlaybackControls isPlaying duration currentTime isReady onTogglePlayback onSeekToFraction />` — a native row with a play/pause button and a scrub slider, mirroring the web `RoutePlaybackControls` (play glyph `▶`, pause glyph `❚❚`, time readout `m:ss / m:ss`).

- [ ] **Step 1: Confirm the slider dependency**

Run: `grep -n "slider" apps/mobile/package.json`
If missing: `npm install @react-native-community/slider -w @cycleways/mobile` (Expo-compatible). Expected: dependency present before Step 2.

- [ ] **Step 2: Create the native control**

Create `apps/mobile/src/planner/PlaybackControls.jsx`:

```jsx
import { View, Pressable, Text, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";
import { palette, radius } from "./theme.js";

function formatTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Native equivalent of the web RoutePlaybackControls: play/pause + scrub the
// route-preview marker. Bound to the shared playback engine.
export default function PlaybackControls({
  isPlaying,
  isReady,
  currentTime,
  duration,
  onTogglePlayback,
  onSeekToFraction,
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const fraction = safeDuration > 0 ? currentTime / safeDuration : 0;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "השהה מסלול" : "נגן מסלול"}
        testID="playback-toggle"
        disabled={!isReady}
        onPress={onTogglePlayback}
        style={[styles.toggle, !isReady ? styles.disabled : null]}
      >
        <Text style={styles.glyph}>{isPlaying ? "❚❚" : "▶"}</Text>
      </Pressable>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={1}
        value={fraction}
        onValueChange={onSeekToFraction}
        disabled={!isReady || safeDuration <= 0}
        minimumTrackTintColor={palette.accent ?? "#1976c9"}
        maximumTrackTintColor={palette.line}
      />
      <Text style={styles.time}>
        {formatTime(currentTime)} / {formatTime(safeDuration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingVertical: 8 },
  toggle: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center", backgroundColor: palette.cream,
  },
  disabled: { opacity: 0.4 },
  glyph: { fontSize: 15, color: palette.ink },
  slider: { flex: 1, height: 40 },
  time: { fontSize: 12, color: palette.muted, minWidth: 72, textAlign: "left" },
});
```

(Confirm `palette` keys exist in `apps/mobile/src/planner/theme.js`; if `accent` is absent, use the literal `"#1976c9"` already in the fallback.)

- [ ] **Step 3: Wire the playback engine + cursor into MapScreen**

In `MapScreen`, drive the existing scrub marker (`setScrubPoint`) from the engine cursor so the marker rides the route during playback:

```js
import { useSyntheticRoutePlaybackEngine } from "@cycleways/core/ui/routePlaybackEngine.js";

// ...inside the component:
const playback = useSyntheticRoutePlaybackEngine({
  enabled: mapPresentationActive,
  routeState,
  cueSlides: [],
  onCursorChange: (cursor) => {
    setScrubPoint(cursor ? { coord: { lng: cursor.lng, lat: cursor.lat } } : null);
  },
});
const seekToFraction = useCallback(
  (fraction) => { playback.seekToFraction(fraction); },
  [playback],
);
```

- [ ] **Step 4: Render the control inside the build sheet (above the nav CTA)**

In `BuildPanelContent` (passed the `playback`/`seekToFraction` props from MapScreen's `build={<BuildPanelContent ... />}`), render the control between the elevation chart and the actions, keeping `התחל ניווט` as the primary CTA:

```jsx
{buildModel.canDownload ? (
  <PlaybackControls
    isPlaying={playback.isPlaying}
    isReady={playback.isReady}
    currentTime={playback.currentTime}
    duration={playback.duration}
    onTogglePlayback={playback.togglePlayback}
    onSeekToFraction={onSeekToFraction}
  />
) : null}
```

Thread `playback` and `onSeekToFraction={seekToFraction}` through the `<BuildPanelContent ... />` props (`MapScreen.jsx:968-986`) and import `PlaybackControls` at the top of `MapScreen.jsx`.

- [ ] **Step 5: Verify on device/simulator**

Run: `npm run mobile`, build a route, open the build sheet. Confirm: a play/pause + scrub row appears above "התחל ניווט"; pressing play animates the marker along the route; scrubbing moves it; "התחל ניווט" still starts navigation.
Expected: playback transport works; navigation CTA intact.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/planner/PlaybackControls.jsx apps/mobile/src/MapScreen.jsx apps/mobile/package.json
git commit -m "feat(mobile): route playback transport on the build sheet (nav CTA kept)"
```

---

# Phase D — Drift guardrail

### Task D1: Document the shared-source rule in the parity test

**Files:**
- Modify: `tests/test-analytics-parity.mjs` **or** the nearest existing parity test (pick the one that already asserts web/mobile share a core source); if none fits, create `tests/test-planner-surface-parity.mjs`.
- Modify: `package.json` if a new test file is created.

**Interfaces:**
- Consumes: `getPlannerBuildModel`.

- [ ] **Step 1: Add an assertion that the planner stat labels are owned by core**

Add (new file `tests/test-planner-surface-parity.mjs` if needed):

```js
import assert from "node:assert/strict";
import { getPlannerBuildModel } from "@cycleways/core/ui/routePlannerPresentation.js";

// Guardrail: the planner build summary is exactly 3 stats and never the
// detailed desktop set. If someone re-introduces a "CW segments"/"points"
// stat into the shared planner model, this fails.
const model = getPlannerBuildModel({
  points: [{}, {}], geometry: [{}, {}], distance: 1000,
  elevationGain: 10, elevationLoss: 5, selectedSegments: ["a"], activeDataPoints: [],
});
assert.equal(model.stats.length, 3);
assert.ok(!model.stats.some(([label]) => label.includes("CW") || label.includes("נקודות")));
console.log("test-planner-surface-parity: OK");
```

- [ ] **Step 2: Run it**

Run: `node tests/test-planner-surface-parity.mjs`
Expected: `test-planner-surface-parity: OK`

- [ ] **Step 3: Register (if new) + commit**

Append ` && node tests/test-planner-surface-parity.mjs` to the `"test"` script if the file is new.

```bash
git add tests/test-planner-surface-parity.mjs package.json
git commit -m "test: guardrail that the shared planner summary stays 3 stats"
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: entire suite PASS, including the four new tests.

---

## Self-Review

**Spec coverage:**
- Design §A (shared planner build-model, drop "CW segments") → Tasks A1–A3, D1. ✓
- Design §B (shared layer specs + translator; match `typed-cased` network + `dark` route line; 3 network layers + cased route) → Tasks B1–B4. ✓
- Design §C (extract playback state machine to shared core; native transport; keep nav CTA) → Tasks C1–C4. ✓
- Design §D (guardrail test) → Task D1. ✓
- Scope boundaries (no RN-web components; desktop `RoutePanel` untouched; no new color schemes) → respected; desktop `RoutePanel` keeps `getRoutePlannerPresentation`. ✓

**Placeholder scan:** No "TBD/TODO". Two conditional checks are explicit (slider dependency presence in C4 Step 1; `palette.accent` fallback to a literal). No "similar to Task N" — engine code is given in full. ✓

**Type consistency:** `getPlannerBuildModel` returns `{ hasRoute, canDownload, stats, poiCount, warningCount }` — consumed consistently in A2/A3/D1. `createRoutePlaybackEngine` returns `{ getState, subscribe, play, pause, togglePlayback, seekToTime, seekToFraction, reset, dispose }`; `useRoutePlaybackEngine`/`useSyntheticRoutePlaybackEngine` return `{ currentTime, cursor, duration, isPlaying, isReady, hasCursor, play, pause, togglePlayback, seekToTime, seekToFraction, reset }` — `PlaybackControls` (C4) consumes exactly `isPlaying/isReady/currentTime/duration/togglePlayback` + `onSeekToFraction`. `paintToRNStyle(spec)` consumed in B3/B4 against the `routeNetwork*StyleForPresentation` / `routeGeometry*StyleForPresentation` specs that return `{ layout, paint }`. ✓
