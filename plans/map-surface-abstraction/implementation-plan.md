# Map Surface Abstraction + Mobile-Web Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the web map code so the end-user map sits behind a narrow, documented, platform-agnostic component contract (`MapSurface`) separated from web-only OSM debug tooling (`OsmDebugOverlay`) — with **zero behavior change** — then run a verification-led mobile-web pass that fixes only observed defects.

**Architecture:** `App.jsx` already drives the map solely through `MapView` props/callbacks expressed in geographic terms (no direct Mapbox access). This plan splits `MapView.jsx` (1,748 lines) into `MapSurface` (product layers) + `OsmDebugOverlay` (debug layers), extracts the ~89 Mapbox style specs into pure data (`mapStyles.js`), extracts pixel/interaction helpers into `mapInteractions.js` (pure geometry kept reusable), and removes the `window.mapboxgl` global behind `mapboxProvider.js`. `MapView` remains a thin composition root so `App.jsx` is untouched. No React Native code is written here.

**Tech Stack:** Vite, React 19, Mapbox GL JS v3, plain-Node assertion tests (`node tests/test-*.mjs`, chained in `package.json`'s `test` script), Playwright (`tests/e2e/*.spec.mjs`, desktop + Pixel-5 mobile projects).

**Reference:** design spec at `plans/map-surface-abstraction/design.md`.

---

## Phase 0 — Safety net

The refactor's correctness guarantee is "existing tests + Playwright smoke stay green before and after each move." Establish the baseline first.

### Task 0: Confirm baseline — DONE

**Outcome (recorded 2026-05-28/29):**
- **Unit suite (`npm test`): 9/9 green.** This is the hard gate — any unit failure means STOP.
- **Playwright smoke (`npm run test:smoke`): 39 passed / 12 failed / 1 skipped** after a required mock repair (see Task 0.5). The 12 remaining failures are **pre-existing stale specs for reworked, map-unrelated features** (welcome/discover panel chips + dismiss + skip-on-`?route=`; the home→/featured nav link behind the welcome overlay; the `.route-inline-warning` selector; a `3.8`→`3.9` km route-distance drift). They are NOT regressions and do NOT exercise the map-surface code being refactored.

**Refactor guard (use this, not "all green"):** after each structural task, the suite must show **no NEW failures beyond the 12-failure baseline**, and **all map-rendering tests must stay green** (`react-migration-smoke` map-load tests, `featured-routes-routing` planner-loads-map, `mobile-regression-check`). Fixing the 12 stale specs is explicitly out of scope for this plan (separate maintenance).

### Task 0.5: Repair the stale Mapbox mock — DONE

The `tests/e2e/mapbox-mock.mjs` MockMap predated current map code and lacked `isStyleLoaded`/`getBounds`/`getZoom`/`easeTo` and a `Popup` class. The missing `isStyleLoaded` (called by `syncVideoCursorLayer`, `mapLayers.js:1753`) threw on load, blanking `#root` and failing 21 map-dependent smoke tests. Mock updated to the current Map API; committed as `12f5bd9` (smoke 33→12 failures).

---

## Phase A — Map-surface abstraction (zero behavior change)

### Task A1: Extract the Mapbox-GL global behind `mapboxProvider.js`

**Files:**
- Create: `src/map/mapboxProvider.js`
- Create: `tests/test-mapbox-provider.mjs`
- Modify: `src/map/MapView.jsx` (replace `window.mapboxgl` reads at ~161, ~337, ~407)
- Modify: `package.json` (add the new test to the `test` script)

- [ ] **Step 1: Write the failing test**

Create `tests/test-mapbox-provider.mjs`:

```js
import assert from "node:assert/strict";
import { getMapboxGl, setMapboxGlForTesting } from "../src/map/mapboxProvider.js";

// Returns the injected instance when present.
const fake = { Map: function () {}, Popup: function () {} };
setMapboxGlForTesting(fake);
assert.equal(getMapboxGl(), fake, "returns the injected mapbox-gl instance");

// Throws a clear error when no instance is available.
setMapboxGlForTesting(null);
assert.throws(
  () => getMapboxGl(),
  /Mapbox GL is not loaded/,
  "throws a clear error when mapbox-gl is absent",
);

console.log("test-mapbox-provider OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-mapbox-provider.mjs`
Expected: FAIL — `Cannot find module ... mapboxProvider.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/map/mapboxProvider.js`:

```js
// Single accessor for the Mapbox GL JS global. Keeps the rest of the map code
// free of `window.mapboxgl` reads so the MapSurface contract has no browser
// global dependency. `setMapboxGlForTesting` exists only for unit tests.
let testOverride;

export function setMapboxGlForTesting(value) {
  testOverride = value === null ? null : value;
}

export function getMapboxGl() {
  const instance =
    testOverride !== undefined
      ? testOverride
      : typeof window !== "undefined"
        ? window.mapboxgl
        : undefined;
  if (!instance) {
    throw new Error("Mapbox GL is not loaded");
  }
  return instance;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-mapbox-provider.mjs`
Expected: `test-mapbox-provider OK`.

- [ ] **Step 5: Replace `window.mapboxgl` reads in MapView**

In `src/map/MapView.jsx`:
- Add to the imports near line 39: `import { getMapboxGl } from "./mapboxProvider.js";`
- Line ~161: replace `const mapboxgl = window.mapboxgl;` with `let mapboxgl; try { mapboxgl = getMapboxGl(); } catch (err) { setStatus("error"); setError(err); return undefined; }` — preserving the existing error path (the current code sets status/error when `mapboxgl` is missing).
- Lines ~337 and ~407 (`new window.mapboxgl.Popup(...)`): replace `window.mapboxgl` with `getMapboxGl()`.

- [ ] **Step 6: Add the test to the suite**

In `package.json`, append ` && node tests/test-mapbox-provider.mjs` to the `test` script (after `test-map-layers` is fine).

- [ ] **Step 7: Verify nothing broke**

Run: `npm test`
Expected: all pass, including the new test.

- [ ] **Step 8: Commit**

```bash
git add src/map/mapboxProvider.js tests/test-mapbox-provider.mjs src/map/MapView.jsx package.json
git commit -m "refactor(map): route mapbox-gl global through mapboxProvider"
```

---

### Task A2: Extract interaction helpers into `mapInteractions.js`

Move the pixel/geometry helpers out of `MapView.jsx`. The pure-geometry parts get unit tests; the thin "read pixels via `map.project`" wrappers stay web-only but live in the same module.

**Files:**
- Create: `src/map/mapInteractions.js`
- Create: `tests/test-map-interactions.mjs`
- Modify: `src/map/MapView.jsx` (remove the moved fns, import them instead)
- Modify: `package.json` (add the new test)

Functions to move (current `MapView.jsx` line numbers): `buildNetworkSegments` (1561), `findClosestRouteSegment` (1580), `projectPoint` (1622), `getClosestPointOnLineSegment` (1627), `isPointTooCloseToRouteUi` (1651), `pixelDistance` (1680), `createClickStamp` (1686), `isDuplicateRouteClick` (1696). `isPointTooCloseToRouteUi` references `DATA_MARKERS_LAYER_ID` — import it from `./mapLayers.js` inside `mapInteractions.js`. `findClosestRouteSegment`/`projectPoint`/`isPointTooCloseToRouteUi` import `distanceToLineSegmentPixels` from `../../utils/distance.js`.

- [ ] **Step 1: Write the failing test (pure geometry only)**

Create `tests/test-map-interactions.mjs`:

```js
import assert from "node:assert/strict";
import {
  buildNetworkSegments,
  getClosestPointOnLineSegment,
  pixelDistance,
  createClickStamp,
  isDuplicateRouteClick,
} from "../src/map/mapInteractions.js";

// buildNetworkSegments keeps only named segments with >= 2 finite coords.
{
  const segs = buildNetworkSegments([
    { properties: { name: "A" }, geometry: { coordinates: [[0, 0], [1, 1]] } },
    { properties: { name: "B" }, geometry: { coordinates: [[0, 0]] } }, // too short
    { properties: {}, geometry: { coordinates: [[0, 0], [1, 1]] } }, // unnamed
  ]);
  assert.equal(segs.length, 1, "only the valid named multi-point segment survives");
  assert.equal(segs[0].segmentName, "A");
  assert.equal(segs[0].coordinates.length, 2);
}

// getClosestPointOnLineSegment projects onto, and clamps to, the segment.
{
  const mid = getClosestPointOnLineSegment({ lng: 0.5, lat: 1 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 });
  assert.equal(mid.lng, 0.5, "perpendicular foot lands at the midpoint x");
  assert.equal(mid.lat, 0, "perpendicular foot lands on the line");
  const before = getClosestPointOnLineSegment({ lng: -5, lat: 0 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 });
  assert.deepEqual(before, { lat: 0, lng: 0 }, "clamps to the start when param < 0");
  const after = getClosestPointOnLineSegment({ lng: 5, lat: 0 }, { lng: 0, lat: 0 }, { lng: 1, lat: 0 });
  assert.deepEqual(after, { lat: 0, lng: 1 }, "clamps to the end when param > 1");
}

// pixelDistance is Euclidean.
assert.equal(pixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);

// createClickStamp reads point + lngLat + a time; isDuplicateRouteClick
// treats near-identical, recent clicks as duplicates.
{
  const evt = { point: { x: 10, y: 20 }, lngLat: { lng: 1, lat: 2 } };
  const stamp = createClickStamp(evt, () => 1000);
  assert.equal(stamp.x, 10);
  assert.equal(stamp.lng, 1);
  assert.equal(stamp.time, 1000);
  // same coords, 50ms later -> duplicate
  assert.equal(isDuplicateRouteClick(stamp, evt, () => 1050), true);
  // same coords, 400ms later -> not a duplicate (stale)
  assert.equal(isDuplicateRouteClick(stamp, evt, () => 1400), false);
}

console.log("test-map-interactions OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-map-interactions.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `mapInteractions.js` by moving the functions**

Create `src/map/mapInteractions.js`. Move the eight functions listed above verbatim from `MapView.jsx`, adding `export` to each. Add at the top:

```js
import { distanceToLineSegmentPixels } from "../../utils/distance.js";
import { DATA_MARKERS_LAYER_ID } from "./mapLayers.js";
```

Make the two time-dependent functions injectable (default to `Date.now`) so they are deterministically testable — this is the only behavioral edit, and it preserves runtime behavior:

```js
export function createClickStamp(event, now = Date.now) {
  return {
    x: Number(event?.point?.x),
    y: Number(event?.point?.y),
    lng: Number(event?.lngLat?.lng),
    lat: Number(event?.lngLat?.lat),
    time: now(),
  };
}

export function isDuplicateRouteClick(previousClick, event, now = Date.now) {
  if (!previousClick) return false;
  if (now() - previousClick.time > 250) return false;
  const nextClick = createClickStamp(event, now);
  // ...rest unchanged from the original...
}
```

- [ ] **Step 4: Remove the moved functions from MapView and import them**

In `src/map/MapView.jsx`, delete the eight moved function definitions and the now-redundant `distanceToLineSegmentPixels` import (line 40), and add:

```js
import {
  buildNetworkSegments,
  findClosestRouteSegment,
  isPointTooCloseToRouteUi,
  createClickStamp,
  isDuplicateRouteClick,
} from "./mapInteractions.js";
```

(`projectPoint`, `getClosestPointOnLineSegment`, `pixelDistance` are internal to `mapInteractions.js` and need not be imported by MapView.)

- [ ] **Step 5: Add the test to the suite**

In `package.json`, append ` && node tests/test-map-interactions.mjs` to the `test` script.

- [ ] **Step 6: Run the full suite**

Run: `node tests/test-map-interactions.mjs && npm test`
Expected: new test prints OK; full suite passes.

- [ ] **Step 7: Commit**

```bash
git add src/map/mapInteractions.js tests/test-map-interactions.mjs src/map/MapView.jsx package.json
git commit -m "refactor(map): extract interaction helpers into mapInteractions"
```

---

### Task A3: Extract style specs + layer IDs into `mapStyles.js`

**Files:**
- Create: `src/map/mapStyles.js`
- Create: `tests/test-map-styles.mjs`
- Modify: `src/map/mapLayers.js` (import the IDs/specs from `mapStyles.js`, re-export the IDs so existing importers keep working)
- Modify: `package.json` (add the new test)

- [ ] **Step 1: Write the failing test**

Create `tests/test-map-styles.mjs`:

```js
import assert from "node:assert/strict";
import * as styles from "../src/map/mapStyles.js";
import { ROUTE_NETWORK_LINE_LAYER_ID } from "../src/map/mapLayers.js";

// IDs live in mapStyles and are re-exported by mapLayers (back-compat).
assert.equal(typeof styles.ROUTE_NETWORK_LINE_LAYER_ID, "string");
assert.equal(
  styles.ROUTE_NETWORK_LINE_LAYER_ID,
  ROUTE_NETWORK_LINE_LAYER_ID,
  "mapLayers re-exports the same ID value as mapStyles",
);

// Style specs are plain data: no functions, JSON-serializable.
const spec = styles.ROUTE_NETWORK_LINE_STYLE;
assert.ok(spec && typeof spec === "object", "route network line style is an object");
assert.doesNotThrow(() => JSON.parse(JSON.stringify(spec)), "style spec is pure data");

console.log("test-map-styles OK");
```

(Use whatever the actual exported style constant is named when you create it; keep the name referenced here in sync.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-map-styles.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `mapStyles.js`**

Move the layer/source `export const ... = "..."` ID constants (currently `mapLayers.js` lines 3–53) and the `paint`/`layout` object literals into `src/map/mapStyles.js` as named exports (e.g. `ROUTE_NETWORK_LINE_STYLE = { paint: {...}, layout: {...} }`). This module must contain **no** mapbox calls and **no** imports from `mapLayers.js` — pure data only.

- [ ] **Step 4: Rewire `mapLayers.js`**

At the top of `src/map/mapLayers.js`, import the IDs and style specs from `./mapStyles.js`, and **re-export the IDs** so existing importers (`MapView.jsx`, `tests/test-map-layers.mjs`) are unaffected:

```js
export * from "./mapStyles.js";
```

Replace inline `paint`/`layout` literals in the `add*`/`sync*` functions with references to the imported style constants.

- [ ] **Step 5: Add the test to the suite**

In `package.json`, append ` && node tests/test-map-styles.mjs` to the `test` script.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass — crucially `tests/test-map-layers.mjs` still passes unchanged (proves the re-export back-compat holds).

- [ ] **Step 7: Commit**

```bash
git add src/map/mapStyles.js tests/test-map-styles.mjs src/map/mapLayers.js package.json
git commit -m "refactor(map): extract layer IDs and style specs into mapStyles"
```

---

### Task A4: Split `mapLayers.js` into product + debug modules behind a barrel

**Files:**
- Create: `src/map/mapLayers.product.js`
- Create: `src/map/mapLayers.debug.js`
- Modify: `src/map/mapLayers.js` (becomes a re-export barrel)

Guarded by the existing `tests/test-map-layers.mjs` (imports stay via the barrel) — no new test needed; this is a pure move.

- [ ] **Step 1: Move product functions**

Move the end-user layer functions into `src/map/mapLayers.product.js`: `prepareRouteNetworkFeatures`, `addRouteNetworkLayers`, `clearRouteNetworkLayers`, `getRouteNetworkLayerIds`, `setRouteNetworkHover`, `setRouteNetworkFocus`, `getRouteFeatureColor`, `syncRoutePointLayers`, `clearRoutePointLayers`, `syncRouteGeometryLayer`, `clearRouteGeometryLayers`, `buildRouteGeometryFeatureCollection`, `syncRoutePointDragPreviewLayer`, `clearRoutePointDragPreviewLayer`, `buildRoutePointDragPreviewFeatureCollection`, `syncRouteDirectionPulseLayer`, `clearRouteDirectionPulseLayer`, `buildRouteDirectionPulseFeatureCollection`, `syncRouteDirectionLitPointLayer`, `clearRouteDirectionLitPointLayer`, `syncDataMarkerLayers`, `clearDataMarkerLayers`, `dataMarkerFeaturesFromSegments`, `loadDataMarkerIcons`, `syncVideoCursorLayer`, `getGeoJsonBounds`. Import shared IDs/styles from `./mapStyles.js`.

- [ ] **Step 2: Move debug functions**

Move the OSM debug/review functions into `src/map/mapLayers.debug.js`: `addOsmDebugLayers`, `clearOsmDebugLayers`, `clearOsmRawLayers`, `setOsmDebugHover`, `syncOsmIntersectionLayers`, `clearOsmIntersectionLayers`, `syncOsmGraphLayers`, `clearOsmGraphLayers`, `setOsmGraphEdgeHover`, `syncCwOsmMatchLayers`, `clearCwOsmMatchLayers`, `setCwOsmMatchHover`, `setCwOsmMatchFocus`, `syncCwOsmReviewLayers`, `clearCwOsmReviewLayers`. Import shared IDs/styles from `./mapStyles.js`.

- [ ] **Step 3: Turn `mapLayers.js` into a barrel**

Replace the body of `src/map/mapLayers.js` with:

```js
export * from "./mapStyles.js";
export * from "./mapLayers.product.js";
export * from "./mapLayers.debug.js";
```

- [ ] **Step 4: Verify imports still resolve**

Run: `npm test`
Expected: all pass — `tests/test-map-layers.mjs` imports unchanged.

- [ ] **Step 5: Smoke check the app builds**

Run: `npm run build`
Expected: build succeeds (no unresolved imports from the split).

- [ ] **Step 6: Commit**

```bash
git add src/map/mapLayers.js src/map/mapLayers.product.js src/map/mapLayers.debug.js
git commit -m "refactor(map): split mapLayers into product and debug modules"
```

---

### Task A5: Extract `OsmDebugOverlay.jsx` from `MapView.jsx`

Move the debug-only `useEffect` blocks and their helpers out of `MapView` into a component that receives the ready `map` instance plus the debug props.

**Files:**
- Create: `src/map/OsmDebugOverlay.jsx`
- Modify: `src/map/MapView.jsx`

Guarded by Playwright smoke (debug overlay toggle) + the build. This is a behavior-preserving move; do not change what the effects do.

- [ ] **Step 1: Identify the debug effects to move**

In `src/map/MapView.jsx`, the debug `useEffect` blocks are the ones keyed on `osmDebugMode`/`osmDebugLayerMode`/`osmDebugGeoJson`/`osmGraphEdgesGeoJson`/`osmGraphNodesGeoJson`/`cwOsmMatchGeoJson`/`osmIntersectionsGeoJson`/`selectedCwOsmReview*` (the blocks starting at ~299, ~375, and the intersections/match/review blocks that follow). Their popup HTML/normalizer helpers (`osmPopupHtml`, `osmIntersectionPopupHtml`, `osmGraphEdgePopupHtml`, `cwOsmMatchPopupHtml`, `normalizeOsm*`, `findOsm*FeatureAtClick`, `formatPercent`, `formatMeters`, `parseJsonProperty`, `escapeHtml`) move too.

- [ ] **Step 2: Create `OsmDebugOverlay.jsx`**

Create a component `function OsmDebugOverlay({ map, status, osmDebugMode, osmDebugLayerMode, osmDebugGeoJson, osmGraphEdgesGeoJson, osmGraphNodesGeoJson, cwOsmMatchGeoJson, osmIntersectionsGeoJson, selectedCwOsmReviewFeature, selectedCwOsmReviewSegmentId, onOsmDebugHover, onOsmGraphEdgeHover, onCwOsmMatchHover })`. Paste the moved effects verbatim, replacing `mapRef.current` with the `map` prop and `window.mapboxgl` with `getMapboxGl()` (already available from Task A1). It renders `null` (it only manages map layers). Import the debug layer fns from `./mapLayers.debug.js` (or the barrel).

- [ ] **Step 3: Verify the new module builds in isolation**

Run: `npm run build`
Expected: build succeeds. (`OsmDebugOverlay` is not yet wired in; this confirms it has no unresolved references.)

- [ ] **Step 4: Commit the extraction (not yet wired)**

```bash
git add src/map/OsmDebugOverlay.jsx
git commit -m "refactor(map): add OsmDebugOverlay component (debug effects extracted)"
```

---

### Task A6: Reduce `MapView` to `MapSurface` + composition root

**Files:**
- Create: `src/map/MapSurface.jsx`
- Modify: `src/map/MapView.jsx` (becomes the thin composition root)

- [ ] **Step 1: Create `MapSurface.jsx` from the remaining MapView**

Copy the current (post-A5) `MapView.jsx` to `src/map/MapSurface.jsx` and rename the component to `MapSurface`. Remove all debug props from its signature and delete the debug effects already relocated in A5 (they now live in `OsmDebugOverlay`). `MapSurface` keeps: map init, the product effects (network, geometry, points, drag preview, direction pulse, data markers, search highlight, viewport idle, route fit, video cursor), and calls `onMapReady(map)` once the map's `load` fires.

- [ ] **Step 2: Rewrite `MapView.jsx` as the composition root**

Replace `src/map/MapView.jsx` with a thin wrapper that holds the ready map in state and composes both children. The product props pass straight through to `MapSurface`; the debug props go to `OsmDebugOverlay`:

```jsx
import React, { useState } from "react";
import MapSurface from "./MapSurface.jsx";
import OsmDebugOverlay from "./OsmDebugOverlay.jsx";

export default function MapView({ onMapReady, ...props }) {
  const [map, setMap] = useState(null);
  const [status, setStatus] = useState("initializing");

  const handleReady = (readyMap) => {
    setMap(readyMap);
    setStatus("ready");
    onMapReady?.(readyMap);
  };

  // Product props -> MapSurface; debug props -> OsmDebugOverlay.
  const {
    osmDebugGeoJson, osmGraphEdgesGeoJson, osmGraphNodesGeoJson,
    cwOsmMatchGeoJson, osmIntersectionsGeoJson, osmDebugMode, osmDebugLayerMode,
    onOsmDebugHover, onOsmGraphEdgeHover, onCwOsmMatchHover,
    selectedCwOsmReviewFeature, selectedCwOsmReviewSegmentId,
    ...surfaceProps
  } = props;

  return (
    <>
      <MapSurface {...surfaceProps} onMapReady={handleReady} />
      {map && (
        <OsmDebugOverlay
          map={map}
          status={status}
          osmDebugMode={osmDebugMode}
          osmDebugLayerMode={osmDebugLayerMode}
          osmDebugGeoJson={osmDebugGeoJson}
          osmGraphEdgesGeoJson={osmGraphEdgesGeoJson}
          osmGraphNodesGeoJson={osmGraphNodesGeoJson}
          cwOsmMatchGeoJson={cwOsmMatchGeoJson}
          osmIntersectionsGeoJson={osmIntersectionsGeoJson}
          selectedCwOsmReviewFeature={selectedCwOsmReviewFeature}
          selectedCwOsmReviewSegmentId={selectedCwOsmReviewSegmentId}
          onOsmDebugHover={onOsmDebugHover}
          onOsmGraphEdgeHover={onOsmGraphEdgeHover}
          onCwOsmMatchHover={onCwOsmMatchHover}
        />
      )}
    </>
  );
}
```

Note: `MapSurface` must continue to render the map container `div`; `OsmDebugOverlay` only attaches layers to the existing `map`. Confirm `App.jsx`'s `<MapView .../>` call site (line ~1296) is unchanged.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Run Playwright smoke on both viewports**

Run: `npm run test:smoke`
Expected: desktop + mobile pass, matching the Task 0 baseline (no new failures).

- [ ] **Step 6: Manual parity check**

Run: `npm run dev`, then in the browser verify against the baseline: place/drag/remove route points; desktop hover ghost-point; toggle each OSM debug layer mode (ways/graph) and confirm popups + hover highlights still work; search highlight; elevation hover drives the map pulse. Note any discrepancy as a defect to fix before committing.

- [ ] **Step 7: Commit**

```bash
git add src/map/MapSurface.jsx src/map/MapView.jsx
git commit -m "refactor(map): split MapView into MapSurface + composition root"
```

---

### Task A7: Document the `MapSurface` contract

**Files:**
- Create: `src/map/MapSurface.contract.md`

- [ ] **Step 1: Write the contract document**

Create `src/map/MapSurface.contract.md` documenting the portable contract exactly as the design spec defines it: the data inputs table, view-state inputs, the `routeFitRequest` command-as-prop, the geographic output callbacks, and the explicitly **web-only** parts (`onSegmentHover` + ghost-preview point; the `onMapReady(map)` escape hatch; all debug props on `OsmDebugOverlay`). Include the "RN equivalents — documented, not implemented" notes: snapping via `@rnmapbox/maps` `queryRenderedFeaturesAtPoint` + the shared `distanceToLineSegmentPixels`; drag via `getCoordinateFromView()`; identical geographic output contract.

- [ ] **Step 2: Commit**

```bash
git add src/map/MapSurface.contract.md
git commit -m "docs(map): document the platform-agnostic MapSurface contract"
```

---

### Task A8: Phase A final verification

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Playwright smoke, both viewports**

Run: `npm run test:smoke`
Expected: matches the Task 0 baseline.

- [ ] **Step 3: Confirm `App.jsx` is unchanged**

Run: `git diff --stat main -- src/App.jsx`
Expected: no changes to `src/App.jsx` from this branch's Phase A work (the composition root preserved the prop interface). If `App.jsx` changed, investigate — Phase A must be transparent to it.

- [ ] **Step 4: Confirm the line-count split landed**

Run: `wc -l src/map/MapSurface.jsx src/map/OsmDebugOverlay.jsx src/map/MapView.jsx`
Expected: `MapView.jsx` is now small (composition root); `MapSurface.jsx` holds the product layers; `OsmDebugOverlay.jsx` holds the debug layers.

---

## Phase B — Verification-led mobile-web pass

B fixes only defects actually observed on a mobile viewport. It may legitimately close with no source changes.

### Task B1: Observe the recent features on a mobile viewport

**Files:**
- Create or extend: `tests/e2e/mobile-elevation-check.spec.mjs`

- [ ] **Step 1: Write a mobile observation spec**

Create `tests/e2e/mobile-elevation-check.spec.mjs` that, under the `mobile` project, loads a route with elevation, opens the route description panel, and captures screenshots of: the elevation profile + slope legend, the grade chip / hover-info during a touch scrub, and route-point editing handles. Use `page.screenshot(...)` into `test-results/`. The spec asserts the elements are visible and not zero-size; its primary purpose is producing artifacts to inspect.

```js
import { test, expect } from "@playwright/test";

test("mobile: elevation panel, legend, and grade chip render within the panel", async ({ page }) => {
  await page.goto("/");
  // Load a route via the app's normal flow (reuse selectors from existing
  // tests/e2e/react-migration-smoke.spec.mjs for placing points), then:
  const legend = page.locator(".react-elevation-legend");
  await expect(legend).toBeVisible();
  const box = await legend.boundingBox();
  expect(box && box.width).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/mobile-elevation-panel.png", fullPage: false });
});
```

(Reuse the route-loading selectors/steps from `tests/e2e/react-migration-smoke.spec.mjs` so this spec drives the real planning flow.)

- [ ] **Step 2: Run it (mobile project only) and inspect artifacts**

Run: `npx playwright test tests/e2e/mobile-elevation-check.spec.mjs --project=mobile`
Expected: passes and writes screenshots to `test-results/`.

- [ ] **Step 3: Record observed defects**

Inspect the screenshots. Write the concrete defects (if any) into the execution notes — e.g. "slope legend overflows the 170px panel", "grade chip overlaps distance label", "RTL: hover-info clipped on the right". If there are no real defects, record "verified, no changes needed" and skip Tasks B2–B4.

- [ ] **Step 4: Commit the observation spec**

```bash
git add tests/e2e/mobile-elevation-check.spec.mjs
git commit -m "test(e2e): add mobile observation spec for elevation panel"
```

---

### Task B2: Fix observed responsive-layout defects (conditional)

**Only run if Task B1 recorded real layout defects.**

**Files:**
- Modify: `src/react-app.css` (the `@media (max-width: 768px)` block at ~1164)

- [ ] **Step 1: Add targeted rules for the observed defect(s)**

Inside the existing `@media (max-width: 768px)` block, add rules scoped to the observed elements only — e.g. allow the legend to wrap/scroll, shrink the grade chip, fix RTL alignment of `.react-elevation-hover-info`. Do not touch desktop styles or unrelated rules.

- [ ] **Step 2: Re-run the observation spec**

Run: `npx playwright test tests/e2e/mobile-elevation-check.spec.mjs --project=mobile`
Expected: passes; re-inspect screenshots to confirm the defect is resolved.

- [ ] **Step 3: Confirm desktop is unaffected**

Run: `npm run test:smoke -- --project=desktop`
Expected: desktop smoke still passes (the rules are mobile-only).

- [ ] **Step 4: Commit**

```bash
git add src/react-app.css
git commit -m "fix(mobile): tighten elevation legend/chip layout in the mobile panel"
```

---

### Task B3: Fix observed touch-interaction defects (conditional)

**Only run if Task B1 surfaced real touch problems** (e.g. tap targets too small, scrub jitter). Touch handling already exists, so changes here are corrective, not additive.

**Files:**
- Modify: `src/components/ElevationProfile.jsx` and/or `src/map/MapSurface.jsx` as the observed defect requires.

- [ ] **Step 1: Make the minimal corrective change**

Address only the observed defect (e.g. enlarge a touch target, debounce a jittery scrub). No speculative changes.

- [ ] **Step 2: Re-run the mobile spec**

Run: `npx playwright test tests/e2e/mobile-elevation-check.spec.mjs --project=mobile`
Expected: passes; behavior confirmed in artifacts.

- [ ] **Step 3: Full unit suite (guards the interaction logic)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(mobile): correct observed touch interaction on <component>"
```

---

### Task B4: Phase B close-out

**Files:** none (verification only).

- [ ] **Step 1: Final smoke on both viewports**

Run: `npm run test:smoke`
Expected: desktop + mobile pass.

- [ ] **Step 2: Summarize outcome**

Record in the execution notes whether B made changes or closed as "verified, no changes needed." Both are valid outcomes.

---

## Self-review notes (author)

- **Spec coverage:** A1 (global removal), A2 (interaction helpers + shared geometry), A3 (style specs as data), A4 (product/debug module split), A5–A6 (MapSurface/OsmDebugOverlay split + thin MapView), A7 (contract doc incl. RN mechanics), A8 (zero-change verification incl. `App.jsx` diff guard). Phase B is the verification-led mobile pass with conditional fixes. All design sections map to tasks.
- **Zero-behavior-change guard:** existing `npm test` + Playwright smoke (desktop + mobile) before (Task 0) and after each structural task; explicit `App.jsx` diff check in A8.
- **Type/name consistency:** `getMapboxGl`/`setMapboxGlForTesting` (A1) reused in A5/A6; `mapStyles.js` IDs re-exported through the `mapLayers.js` barrel so `tests/test-map-layers.mjs` and `MapView` imports stay valid across A3/A4.
- **No placeholders:** new modules (mapboxProvider, mapInteractions pure helpers, mapStyles test) include real code/tests; large component moves are characterization-guarded with exact function lists and line references rather than fabricated inline bodies.
