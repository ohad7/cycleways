# Route fit — more triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the overlay-aware route-fit mechanism for four more triggers — planner `route=xxx` restore, the Discover all-routes fit (re-fitting on filter changes), Discover hover-to-fit (restore on leave), and featured non-video open.

**Architecture:** A shared `buildRouteFitRequest` helper mints a `{ id, geometry, padding }` token (overlay-aware via the existing `computeOverlayFitPadding`). In the planner, a single `fitRequest` state is fed by all triggers (play, restore, discover, hover) so the latest request wins. In featured, the existing `requestRouteFit` learns to auto-measure padding when the map-stage has registered its overlays.

**Tech Stack:** React (hooks/effects), Mapbox GL `fitBounds`, plain ESM. Tests are standalone Node scripts using `node:assert/strict` run via the `test` npm script.

**Spec:** `plans/route-fit-more-triggers/design.md`. Builds on `plans/route-fit-on-play/`.

---

### Task 1: Shared helpers — `buildRouteFitRequest` + `combineRouteGeometries`

**Files:**
- Modify: `src/map/routeFitPadding.js`
- Modify (extend): `tests/test-route-fit-padding.mjs`
- Create: `tests/test-combine-route-geometries.mjs`

- [ ] **Step 1: Write the failing tests.**

Append to `tests/test-route-fit-padding.mjs`, BEFORE the final `console.log("test-route-fit-padding.mjs passed");` line:

```js
// 7. buildRouteFitRequest mints a token with id, geometry, and base padding
//    when there are no overlays.
{
  const mapEl = {
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 1000, bottom: 800 }),
    querySelectorAll: () => [],
  };
  const geometry = [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }];
  const req = buildRouteFitRequest(geometry, { mapEl, registry: [] });
  assert.ok(typeof req.id === "string" && req.id.startsWith("fit-"), "id present");
  assert.equal(req.geometry, geometry, "geometry passed through");
  assert.deepEqual(req.padding, { top: 24, right: 24, bottom: 24, left: 24 }, "base padding");
}

// 8. buildRouteFitRequest returns null for too-short geometry.
{
  const mapEl = { getBoundingClientRect: () => ({ top: 0, left: 0, right: 1000, bottom: 800 }), querySelectorAll: () => [] };
  assert.equal(buildRouteFitRequest([{ lng: 0, lat: 0 }], { mapEl, registry: [] }), null, "null for 1 point");
  assert.equal(buildRouteFitRequest(null, { mapEl, registry: [] }), null, "null for null geometry");
}
```

Also change the existing import line at the TOP of `tests/test-route-fit-padding.mjs` from:
```js
import { resolveOverlayInsets } from "../src/map/routeFitPadding.js";
```
to:
```js
import { resolveOverlayInsets, buildRouteFitRequest } from "../src/map/routeFitPadding.js";
```

Create `tests/test-combine-route-geometries.mjs`:

```js
import assert from "node:assert/strict";
import { combineRouteGeometries } from "../src/map/routeFitPadding.js";

// Flattens multiple geometries in order.
{
  const routes = [
    { geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }] },
    { geometry: [{ lng: 2, lat: 2 }, { lng: 3, lat: 3 }] },
  ];
  const combined = combineRouteGeometries(routes);
  assert.equal(combined.length, 4, "all points kept");
  assert.deepEqual(combined[0], { lng: 0, lat: 0 }, "order preserved (first)");
  assert.deepEqual(combined[3], { lng: 3, lat: 3 }, "order preserved (last)");
}

// Skips routes with fewer than 2 points or missing geometry.
{
  const routes = [
    { geometry: [{ lng: 0, lat: 0 }] },          // too short
    { geometry: null },                           // missing
    { geometry: [{ lng: 5, lat: 5 }, { lng: 6, lat: 6 }] },
  ];
  const combined = combineRouteGeometries(routes);
  assert.equal(combined.length, 2, "only the valid route contributes");
  assert.deepEqual(combined[0], { lng: 5, lat: 5 });
}

// Empty / non-array input -> [].
assert.deepEqual(combineRouteGeometries([]), [], "empty input");
assert.deepEqual(combineRouteGeometries(null), [], "null input");

console.log("test-combine-route-geometries.mjs passed");
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `node tests/test-route-fit-padding.mjs; node tests/test-combine-route-geometries.mjs`
Expected: both FAIL (`buildRouteFitRequest`/`combineRouteGeometries` not exported).

- [ ] **Step 3: Add both helpers** to the end of `src/map/routeFitPadding.js`:

```js
// Flatten multiple route geometries ({ lng, lat }[]) into one point list,
// skipping routes whose geometry has fewer than 2 points.
export function combineRouteGeometries(routes) {
  if (!Array.isArray(routes)) return [];
  const points = [];
  for (const route of routes) {
    const geometry = route?.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) continue;
    for (const point of geometry) points.push(point);
  }
  return points;
}

// Build an overlay-aware route-fit token for MapSurface. Returns null when the
// geometry is too short to fit.
export function buildRouteFitRequest(geometry, { mapEl, registry, scopeEl, gap, base } = {}) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const padding = computeOverlayFitPadding({ mapEl, registry, scopeEl, gap, base });
  return { id: `fit-${Date.now()}`, geometry, padding };
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `node tests/test-route-fit-padding.mjs && node tests/test-combine-route-geometries.mjs`
Expected: both print their `... passed` line.

- [ ] **Step 5: Commit.**

```bash
git add src/map/routeFitPadding.js tests/test-route-fit-padding.mjs tests/test-combine-route-geometries.mjs
git commit -m "feat(route-fit): buildRouteFitRequest + combineRouteGeometries helpers"
```

---

### Task 2: Planner unified fit controller (rename + requestFit)

**Files:**
- Modify: `src/App.jsx`

Browser-verified (no Node unit test). This task is a pure refactor that must keep the play fit working.

- [ ] **Step 1: Import the helper.** On the existing import from `./map/routeFitPadding.js`? There is none yet in `App.jsx`. Add a new import near the top (after line 17, the `useFitRouteOnPlay` import):

```jsx
import { buildRouteFitRequest, combineRouteGeometries } from "./map/routeFitPadding.js";
```

- [ ] **Step 2: Rename the fit state and add the `requestFit` helper + discover ref.** Replace this block (currently around line 198):

```jsx
  const mapContainerRef = useRef(null);
  const [playFitRequest, setPlayFitRequest] = useState(null);
  const plannerFitRegistry = useMemo(() => ([
    { selector: ".planner-route-playback", side: "bottom" },
    { selector: ".search-container", side: "top" },
    { selector: ".legend-container" },
    { selector: ".data-marker-card" },
    { selector: ".planner-route-poi-preview" },
  ]), []);

  useFitRouteOnPlay({
    isPlaying: plannerPlayback.isPlaying,
    currentTime: plannerPlayback.currentTime,
    geometry: routeState.geometry,
    getMapEl: () => mapContainerRef.current,
    registry: plannerFitRegistry,
    onRequestFit: setPlayFitRequest,
  });
```

with:

```jsx
  const mapContainerRef = useRef(null);
  const [fitRequest, setFitRequest] = useState(null);
  const discoverFitGeometryRef = useRef([]);
  const plannerFitRegistry = useMemo(() => ([
    { selector: ".planner-route-playback", side: "bottom" },
    { selector: ".search-container", side: "top" },
    { selector: ".legend-container" },
    { selector: ".data-marker-card" },
    { selector: ".planner-route-poi-preview" },
  ]), []);
  const requestFit = useCallback((geometry) => {
    const req = buildRouteFitRequest(geometry, {
      mapEl: mapContainerRef.current,
      registry: plannerFitRegistry,
    });
    if (req) setFitRequest(req);
  }, [plannerFitRegistry]);

  useFitRouteOnPlay({
    isPlaying: plannerPlayback.isPlaying,
    currentTime: plannerPlayback.currentTime,
    geometry: routeState.geometry,
    getMapEl: () => mapContainerRef.current,
    registry: plannerFitRegistry,
    onRequestFit: setFitRequest,
  });
```

(`useCallback` is already imported in `App.jsx`.)

- [ ] **Step 3: Update the MapView prop.** Change (around line 425):

```jsx
                  routeFitRequest={playFitRequest ?? mapUi.routeFitRequest}
```

to:

```jsx
                  routeFitRequest={fitRequest ?? mapUi.routeFitRequest}
```

- [ ] **Step 4: Syntax check.**

Run: `npx esbuild src/App.jsx --loader:.jsx=jsx > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK`.

- [ ] **Step 5: Commit.**

```bash
git add src/App.jsx
git commit -m "refactor(route-fit): unified planner fitRequest controller + requestFit"
```

---

### Task 3: Planner `route=xxx` restore fit (overlay-aware)

**Files:**
- Modify: `src/App.jsx`

Browser-verified.

- [ ] **Step 1: Add the restore effect.** Immediately AFTER the `useFitRouteOnPlay({...})` call from Task 2, add:

```jsx
  // Restoring a route from the ?route= URL param: re-fit overlay-aware. Defer
  // one frame so the just-rendered play controls are in the DOM and measured.
  useEffect(() => {
    const geometry = mapUi.routeFitRequest?.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) return undefined;
    const raf = window.requestAnimationFrame(() => requestFit(geometry));
    return () => window.cancelAnimationFrame(raf);
  }, [mapUi.routeFitRequest, requestFit]);
```

(`useEffect` is already imported.)

- [ ] **Step 2: Syntax check.**

Run: `npx esbuild src/App.jsx --loader:.jsx=jsx > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK`.

- [ ] **Step 3: Commit.**

```bash
git add src/App.jsx
git commit -m "feat(route-fit): planner ?route= restore fits overlay-aware"
```

---

### Task 4: Planner Discover all-routes fit

**Files:**
- Modify: `src/App.jsx`

Browser-verified.

- [ ] **Step 1: Add a hover-independent discover-geometries memo.** AFTER the existing `recommendedRoutes` memo (around line 224), add:

```jsx
  // Combined geometry of the currently-visible (filtered) Discover routes, kept
  // independent of hover so hovering does not re-trigger the all-routes fit.
  const discoverFitRoutes = useMemo(() => {
    if (panel.state !== "discover") return null;
    return discoverSlugs
      .map((slug) => ({ geometry: recommendedGeoms[slug] }))
      .filter((r) => Array.isArray(r.geometry) && r.geometry.length >= 2);
  }, [panel.state, discoverSlugs, recommendedGeoms]);
```

- [ ] **Step 2: Add the debounced discover-fit effect.** Immediately after the memo from Step 1, add:

```jsx
  // Fit the map to all relevant Discover routes; re-fit when the filtered list
  // (or its loaded geometries) changes. Debounced so streaming loads converge.
  useEffect(() => {
    if (!discoverFitRoutes || discoverFitRoutes.length === 0) return undefined;
    const combined = combineRouteGeometries(discoverFitRoutes);
    if (combined.length < 2) return undefined;
    discoverFitGeometryRef.current = combined;
    const timer = window.setTimeout(() => requestFit(combined), 150);
    return () => window.clearTimeout(timer);
  }, [discoverFitRoutes, requestFit]);
```

- [ ] **Step 3: Syntax check.**

Run: `npx esbuild src/App.jsx --loader:.jsx=jsx > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK`.

- [ ] **Step 4: Commit.**

```bash
git add src/App.jsx
git commit -m "feat(route-fit): Discover fits to all relevant routes on filter change"
```

---

### Task 5: Planner Discover hover fit + restore

**Files:**
- Modify: `src/App.jsx`

Browser-verified.

- [ ] **Step 1: Add the debounced hover-fit effect.** Immediately after the discover-fit effect from Task 4, add:

```jsx
  // Hovering a Discover route fits to it; leaving restores the all-routes fit.
  useEffect(() => {
    if (panel.state !== "discover") return undefined;
    const hoveredGeometry = hoveredRouteSlug ? recommendedGeoms[hoveredRouteSlug] : null;
    const timer = window.setTimeout(() => {
      if (Array.isArray(hoveredGeometry) && hoveredGeometry.length >= 2) {
        requestFit(hoveredGeometry);
      } else if (discoverFitGeometryRef.current.length >= 2) {
        requestFit(discoverFitGeometryRef.current);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hoveredRouteSlug, recommendedGeoms, panel.state, requestFit]);
```

- [ ] **Step 2: Syntax check.**

Run: `npx esbuild src/App.jsx --loader:.jsx=jsx > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK`.

- [ ] **Step 3: Commit.**

```bash
git add src/App.jsx
git commit -m "feat(route-fit): Discover hover fits to route, restores on leave"
```

---

### Task 6: Featured context — auto-measuring `requestRouteFit`

**Files:**
- Modify: `src/components/featured/FeaturedRoute.jsx`

- [ ] **Step 1: Import the padding helper.** Add to the imports (e.g. after the `MapView` import on line 9):

```jsx
import { computeOverlayFitPadding } from "../../map/routeFitPadding.js";
```

- [ ] **Step 2: Add an overlay registration ref + callback.** After the `const mapContainerRef = useRef(null);` line (around line 35), add:

```jsx
  const routeFitOverlaysRef = useRef(null);
  const registerRouteFitOverlays = useCallback((config) => {
    routeFitOverlaysRef.current = config;
  }, []);
```

- [ ] **Step 3: Make `requestRouteFit` auto-measure.** Replace the current callback (lines 95-102):

```jsx
  const requestRouteFit = useCallback((reason = "featured-route-fit", { padding } = {}) => {
    if (!meta || routeState.geometry.length < 2) return;
    setRouteFitRequest({
      id: `${reason}-${meta.slug}-${Date.now()}`,
      geometry: routeState.geometry,
      ...(padding ? { padding } : {}),
    });
  }, [meta, routeState.geometry]);
```

with:

```jsx
  const requestRouteFit = useCallback((reason = "featured-route-fit", { padding } = {}) => {
    if (!meta || routeState.geometry.length < 2) return;
    let resolvedPadding = padding;
    if (!resolvedPadding && routeFitOverlaysRef.current && mapContainerRef.current) {
      const { registry, getScopeEl } = routeFitOverlaysRef.current;
      resolvedPadding = computeOverlayFitPadding({
        mapEl: mapContainerRef.current,
        registry,
        scopeEl: getScopeEl?.(),
      });
    }
    setRouteFitRequest({
      id: `${reason}-${meta.slug}-${Date.now()}`,
      geometry: routeState.geometry,
      ...(resolvedPadding ? { padding: resolvedPadding } : {}),
    });
  }, [meta, routeState.geometry]);
```

- [ ] **Step 4: Expose `registerRouteFitOverlays` on the context.** In the `contextValue` `useMemo` object (around line 207, next to `requestRouteFit,`), add `registerRouteFitOverlays,`. Add `registerRouteFitOverlays` to that `useMemo`'s dependency array (around line 222), next to `requestRouteFit`.

- [ ] **Step 5: Verify featured tests + syntax.**

Run:
```bash
node tests/test-featured-route-snapshots.mjs && node tests/test-featured-route-snapshot-loader.mjs
npx esbuild src/components/featured/FeaturedRoute.jsx --loader:.jsx=jsx > /dev/null && echo "FeaturedRoute OK"
```
Expected: featured tests pass; `FeaturedRoute OK`.

- [ ] **Step 6: Commit.**

```bash
git add src/components/featured/FeaturedRoute.jsx
git commit -m "feat(route-fit): featured requestRouteFit auto-measures overlay padding"
```

---

### Task 7: `RouteMapPlayback` registers its overlays

**Files:**
- Modify: `src/components/featured/RouteMapPlayback.jsx`

Browser-verified.

- [ ] **Step 1: Pull `registerRouteFitOverlays` from context.** Add `registerRouteFitOverlays,` to the `useFeaturedRoute()` destructure (alongside `mapContainerRef`, `requestRouteFit`).

- [ ] **Step 2: Register on mount.** Immediately after the existing `useFitRouteOnPlay({...})` call, add:

```jsx
  useEffect(() => {
    registerRouteFitOverlays({
      registry: featuredFitRegistry,
      getScopeEl: () => sectionRef.current,
    });
    return () => registerRouteFitOverlays(null);
  }, [registerRouteFitOverlays, featuredFitRegistry]);
```

(`useEffect` is already imported in `RouteMapPlayback.jsx`.)

- [ ] **Step 3: Verify syntax + featured tests.**

Run:
```bash
npx esbuild src/components/featured/RouteMapPlayback.jsx --loader:.jsx=jsx > /dev/null && echo "RouteMapPlayback OK"
node tests/test-featured-route-snapshots.mjs && node tests/test-featured-route-snapshot-loader.mjs
```
Expected: `RouteMapPlayback OK`; featured tests pass.

- [ ] **Step 4: Commit.**

```bash
git add src/components/featured/RouteMapPlayback.jsx
git commit -m "feat(route-fit): featured map-stage registers overlays for open fit"
```

---

### Task 8: Register the new test in the suite

**Files:**
- Modify: `package.json` (the `test` script)

- [ ] **Step 1: Register `test-combine-route-geometries.mjs`.** In the `"test"` script string, insert it immediately AFTER `node tests/test-fit-route-on-play.mjs && ` (the route-fit tests run together):

```
node tests/test-fit-route-on-play.mjs && node tests/test-combine-route-geometries.mjs &&
```

(`test-route-fit-padding.mjs` is already registered; it now also covers `buildRouteFitRequest`.)

- [ ] **Step 2: Verify.**

Run:
```bash
node tests/test-route-fit-padding.mjs && node tests/test-combine-route-geometries.mjs
node -e "const s=require('./package.json').scripts.test; console.log(s.includes('test-combine-route-geometries.mjs') ? 'registered' : 'MISSING')"
node -e "require('./package.json'); console.log('package.json valid')"
```
Expected: both tests pass; prints `registered`; prints `package.json valid`.

- [ ] **Step 3: Commit.**

```bash
git add package.json
git commit -m "test(route-fit): register combine-route-geometries test"
```

---

## Browser verification (after all tasks)

Run `npm run dev`, then:
1. **Restore:** open the planner with a `?route=…` URL → the route fits with clearance below the play bar.
2. **Discover all-routes:** open the Discover panel → map fits all listed routes; change a filter → it re-fits to the new set.
3. **Hover:** hover a route in the Discover list → map zooms to it; move the pointer off → it returns to the all-routes view.
4. **Featured non-video:** open a map-stage route-story page → the route fits clear of the controls on load.

## Self-review notes

- **Spec coverage:** §A helpers → Task 1; §B.2 restore → Task 3; §B.3 discover → Task 4; §B.4 hover → Task 5; §B controller → Task 2; §C featured → Tasks 6–7; §Testing → Tasks 1, 8.
- **Hover/discover decoupling:** Task 4's `discoverFitRoutes` memo deliberately excludes `hoveredRouteSlug`, so hover (Task 5) does not re-trigger the all-routes fit. `discoverFitGeometryRef` is written by Task 4 and read by Task 5's restore branch.
- **Type consistency:** `buildRouteFitRequest(geometry, { mapEl, registry, scopeEl, gap, base })` and `combineRouteGeometries(routes)` (routes = `[{ geometry }]`) are used identically in Tasks 2, 4; the token `{ id, geometry, padding }` matches `MapSurface`'s `routeFitRequest.padding` read; `registerRouteFitOverlays({ registry, getScopeEl })` is defined in Task 6 and called with that exact shape in Task 7.
