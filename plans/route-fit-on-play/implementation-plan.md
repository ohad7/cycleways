# Route fit-on-play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user starts playing a route from the beginning, fit the map camera to the whole route with overlay-aware padding so the play controls (and other on-map overlays) never hide the route.

**Architecture:** A pure padding-math module (`resolveOverlayInsets`) plus a thin DOM wrapper (`computeOverlayFitPadding`) measure how far each marked overlay intrudes on the map and return an asymmetric `{top,right,bottom,left}` padding. A pure predicate (`shouldFitOnPlayStart`) gates the trigger to fresh starts (`t≈0`); a small React hook (`useFitRouteOnPlay`) wires the two together and emits a `routeFitRequest` token carrying the computed padding. `MapSurface` already fits to that token — it just learns to prefer a `padding` carried on the token. Each playback surface (planner, featured map-stage) supplies a selector registry of its overlays.

**Tech Stack:** React (function components + hooks), Mapbox GL (`fitBounds` with object padding), plain ESM modules. Tests are standalone Node scripts using `node:assert/strict` (no test framework), run via the `test` npm script.

**Spec:** `plans/route-fit-on-play/design.md`

---

### Task 1: `resolveOverlayInsets` — pure padding math

**Files:**
- Create: `src/map/routeFitPadding.js`
- Test: `tests/test-route-fit-padding.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test-route-fit-padding.mjs`:

```js
import assert from "node:assert/strict";
import { resolveOverlayInsets } from "../src/map/routeFitPadding.js";

// A 1000x800 map at the origin.
const mapRect = { top: 0, left: 0, right: 1000, bottom: 800 };

// 1. A full-width bottom bar with an explicit side grows only `bottom`.
{
  const overlays = [
    { rect: { top: 740, left: 25, right: 975, bottom: 775 }, side: "bottom" },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  // intrusion from bottom edge = mapRect.bottom - rect.top = 800 - 740 = 60, + gap 16 = 76
  assert.equal(p.bottom, 76, "bottom grows by intrusion + gap");
  assert.equal(p.top, 24, "top stays at base");
  assert.equal(p.left, 24, "left stays at base");
  assert.equal(p.right, 24, "right stays at base");
}

// 2. A top-left box with no side snaps to its nearest edge (top here).
{
  const overlays = [
    { rect: { top: 10, left: 10, right: 210, bottom: 60 } },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  // nearest edge: top gap=10 < left gap=10? tie -> top wins (first edge). intrusion top = rect.bottom - mapRect.top = 60, + gap = 76
  assert.equal(p.top, 76, "nearest top edge grows");
  assert.equal(p.bottom, 24, "bottom stays at base");
}

// 3. A non-overlapping overlay is ignored.
{
  const overlays = [
    { rect: { top: 2000, left: 2000, right: 2100, bottom: 2100 }, side: "bottom" },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  assert.deepEqual(p, { top: 24, right: 24, bottom: 24, left: 24 }, "off-map overlay ignored");
}

// 4. An oversized overlay is clamped to 0.8 * map dimension.
{
  const overlays = [
    { rect: { top: 50, left: 0, right: 1000, bottom: 800 }, side: "bottom" },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  assert.equal(p.bottom, 640, "bottom clamped to 0.8 * 800");
}

console.log("test-route-fit-padding.mjs passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-route-fit-padding.mjs`
Expected: FAIL — `Cannot find module '.../src/map/routeFitPadding.js'` (or `resolveOverlayInsets is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `src/map/routeFitPadding.js`:

```js
// Overlay-aware route-fit padding.
//
// Mapbox fitBounds takes a rectangular { top, right, bottom, left } padding, so
// each obstructing overlay is assigned to a single map edge and contributes the
// depth it intrudes from that edge (plus a gap). Per edge we keep the largest
// intrusion. See plans/route-fit-on-play/design.md.

const EDGES = ["top", "right", "bottom", "left"];

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function nearestEdge(mapRect, rect) {
  const gaps = {
    top: rect.top - mapRect.top,
    bottom: mapRect.bottom - rect.bottom,
    left: rect.left - mapRect.left,
    right: mapRect.right - rect.right,
  };
  let best = "top";
  let bestGap = Infinity;
  for (const edge of EDGES) {
    if (gaps[edge] < bestGap) {
      bestGap = gaps[edge];
      best = edge;
    }
  }
  return best;
}

function insetForEdge(edge, mapRect, rect) {
  switch (edge) {
    case "top": return rect.bottom - mapRect.top;
    case "bottom": return mapRect.bottom - rect.top;
    case "left": return rect.right - mapRect.left;
    case "right": return mapRect.right - rect.left;
    default: return 0;
  }
}

export function resolveOverlayInsets({ mapRect, overlays = [], gap = 16, base = 24 }) {
  const result = { top: base, right: base, bottom: base, left: base };
  for (const overlay of overlays) {
    const rect = overlay?.rect;
    if (!rect || !rectsOverlap(mapRect, rect)) continue;
    const side = EDGES.includes(overlay.side) ? overlay.side : nearestEdge(mapRect, rect);
    const inset = Math.max(0, insetForEdge(side, mapRect, rect)) + gap;
    result[side] = Math.max(result[side], inset);
  }
  const maxV = (mapRect.bottom - mapRect.top) * 0.8;
  const maxH = (mapRect.right - mapRect.left) * 0.8;
  result.top = Math.min(result.top, maxV);
  result.bottom = Math.min(result.bottom, maxV);
  result.left = Math.min(result.left, maxH);
  result.right = Math.min(result.right, maxH);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-route-fit-padding.mjs`
Expected: PASS — prints `test-route-fit-padding.mjs passed`.

- [ ] **Step 5: Commit**

```bash
git add src/map/routeFitPadding.js tests/test-route-fit-padding.mjs
git commit -m "feat(route-fit): overlay-aware padding math (resolveOverlayInsets)"
```

---

### Task 2: `computeOverlayFitPadding` — DOM glue

**Files:**
- Modify: `src/map/routeFitPadding.js`

This is DOM glue (reads `getBoundingClientRect` / `getComputedStyle`), so it has no Node unit test — it is exercised in the browser by Tasks 6 and 8. Verify only that the module still parses and existing tests pass.

- [ ] **Step 1: Append the DOM helper**

Add to the end of `src/map/routeFitPadding.js`:

```js
function isHidden(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true;
  if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
  const view = el.ownerDocument?.defaultView || window;
  const style = view.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

// Measure obstruction overlays (resolved from a per-surface selector registry)
// against the map element and return overlay-aware fit padding.
//   mapEl   - element whose rect Mapbox pads against (the map container)
//   registry - [{ selector, side? }] of overlays to clear
//   scopeEl  - optional element to run selector queries within (default: mapEl)
export function computeOverlayFitPadding({ mapEl, registry = [], scopeEl, gap = 16, base = 24 }) {
  if (!mapEl) return { top: base, right: base, bottom: base, left: base };
  const mapRect = mapEl.getBoundingClientRect();
  const root = scopeEl || mapEl;
  const overlays = [];
  for (const entry of registry) {
    if (!entry?.selector || !root.querySelectorAll) continue;
    root.querySelectorAll(entry.selector).forEach((el) => {
      if (isHidden(el)) return;
      overlays.push({ rect: el.getBoundingClientRect(), side: entry.side });
    });
  }
  return resolveOverlayInsets({ mapRect, overlays, gap, base });
}
```

- [ ] **Step 2: Verify the module still parses and prior tests pass**

Run: `node tests/test-route-fit-padding.mjs`
Expected: PASS (the import of the now-larger module still resolves; `resolveOverlayInsets` behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/map/routeFitPadding.js
git commit -m "feat(route-fit): DOM glue computeOverlayFitPadding from selector registry"
```

---

### Task 3: `shouldFitOnPlayStart` — fresh-start predicate

**Files:**
- Create: `src/components/routePlayback/useFitRouteOnPlay.js`
- Test: `tests/test-fit-route-on-play.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test-fit-route-on-play.mjs`:

```js
import assert from "node:assert/strict";
import { shouldFitOnPlayStart } from "../src/components/routePlayback/useFitRouteOnPlay.js";

// Fresh start from the beginning -> fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: false, isPlaying: true, currentTime: 0, geometryLength: 5 }),
  true,
  "fresh start at t=0 fits",
);

// Resume from mid-route -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: false, isPlaying: true, currentTime: 30, geometryLength: 5 }),
  false,
  "resume at t>threshold does not fit",
);

// Already playing (no transition) -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: true, isPlaying: true, currentTime: 0, geometryLength: 5 }),
  false,
  "no false->true transition does not fit",
);

// Not enough geometry -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: false, isPlaying: true, currentTime: 0, geometryLength: 1 }),
  false,
  "too-short geometry does not fit",
);

// Pausing (isPlaying false) -> no fit.
assert.equal(
  shouldFitOnPlayStart({ wasPlaying: true, isPlaying: false, currentTime: 0, geometryLength: 5 }),
  false,
  "pausing does not fit",
);

console.log("test-fit-route-on-play.mjs passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-fit-route-on-play.mjs`
Expected: FAIL — module not found / `shouldFitOnPlayStart is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/routePlayback/useFitRouteOnPlay.js` (predicate only for now; the hook is added in Task 4):

```js
import { useEffect, useRef } from "react";
import { computeOverlayFitPadding } from "../../map/routeFitPadding.js";

// True only on a false->true play transition that starts at the beginning of a
// real route. Resumes (currentTime past the threshold) and non-transitions are
// excluded. See plans/route-fit-on-play/design.md.
export function shouldFitOnPlayStart({
  wasPlaying,
  isPlaying,
  currentTime,
  geometryLength,
  freshStartSec = 0.25,
}) {
  if (!isPlaying || wasPlaying) return false;
  if (!(geometryLength >= 2)) return false;
  return Number(currentTime) <= freshStartSec;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-fit-route-on-play.mjs`
Expected: PASS — prints `test-fit-route-on-play.mjs passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/routePlayback/useFitRouteOnPlay.js tests/test-fit-route-on-play.mjs
git commit -m "feat(route-fit): fresh-start predicate shouldFitOnPlayStart"
```

---

### Task 4: `useFitRouteOnPlay` hook

**Files:**
- Modify: `src/components/routePlayback/useFitRouteOnPlay.js`

React hook with DOM/effect behavior — no Node unit test; exercised by Tasks 6 and 8 in the browser. Verify the predicate test still passes (import is unchanged for it).

- [ ] **Step 1: Append the hook**

Add to `src/components/routePlayback/useFitRouteOnPlay.js`:

```js
// Fires onRequestFit({ id, geometry, padding }) when playback starts fresh.
//   getMapEl   - () => element whose rect Mapbox pads against
//   getScopeEl - optional () => element to scope selector queries within
//   registry   - [{ selector, side? }] of obstruction overlays
export function useFitRouteOnPlay({
  isPlaying,
  currentTime,
  geometry,
  getMapEl,
  getScopeEl,
  registry,
  onRequestFit,
  gap = 16,
  freshStartSec = 0.25,
}) {
  const wasPlayingRef = useRef(false);
  const latestRef = useRef(null);
  latestRef.current = {
    currentTime,
    geometry,
    getMapEl,
    getScopeEl,
    registry,
    onRequestFit,
    gap,
    freshStartSec,
  };

  useEffect(() => {
    const latest = latestRef.current;
    const geometryLength = Array.isArray(latest.geometry) ? latest.geometry.length : 0;
    const fit = shouldFitOnPlayStart({
      wasPlaying: wasPlayingRef.current,
      isPlaying,
      currentTime: latest.currentTime,
      geometryLength,
      freshStartSec: latest.freshStartSec,
    });
    wasPlayingRef.current = isPlaying;
    if (!fit) return;
    const mapEl = latest.getMapEl?.();
    if (!mapEl) return;
    const padding = computeOverlayFitPadding({
      mapEl,
      registry: latest.registry,
      scopeEl: latest.getScopeEl?.(),
      gap: latest.gap,
    });
    latest.onRequestFit?.({
      id: `play-fit-${Date.now()}`,
      geometry: latest.geometry,
      padding,
    });
  }, [isPlaying]);
}
```

- [ ] **Step 2: Verify the predicate test still passes**

Run: `node tests/test-fit-route-on-play.mjs`
Expected: PASS (the hook export does not affect the predicate; note the file now imports `react`, which is fine for the partial import used by the test under Node's ESM since only `shouldFitOnPlayStart` is referenced — if Node errors on the `react` import, see Step 3 fallback).

> If `node` fails to resolve the `react` import when running the test, that means the test process is loading the module graph eagerly. In that case, move `shouldFitOnPlayStart` into its own file `src/components/routePlayback/playStartGate.js`, import it into both `useFitRouteOnPlay.js` and the test, and re-run. (Resolve only if the error actually occurs.)

- [ ] **Step 3: Commit**

```bash
git add src/components/routePlayback/useFitRouteOnPlay.js
git commit -m "feat(route-fit): useFitRouteOnPlay hook (measure + emit fit request)"
```

---

### Task 5: `MapSurface` prefers token padding

**Files:**
- Modify: `src/map/MapSurface.jsx:871-873`

- [ ] **Step 1: Apply the change**

In the route-fit effect (around line 871), replace:

```js
    fitMapToCoordinates(map, routeFitRequest.geometry, {
      maxZoom: 14,
      padding: routeFitPadding,
    });
```

with:

```js
    fitMapToCoordinates(map, routeFitRequest.geometry, {
      maxZoom: 14,
      padding: routeFitRequest.padding ?? routeFitPadding,
    });
```

This is backward-compatible: existing tokens (URL-restore, featured expand /
auto-reset) carry no `.padding` and keep using the `routeFitPadding` prop.

- [ ] **Step 2: Verify existing map-surface tests pass**

Run: `node tests/test-map-interactions.mjs && node tests/test-map-styles.mjs && node tests/test-map-mode.mjs`
Expected: PASS (no behavior change for padding-less tokens).

- [ ] **Step 3: Commit**

```bash
git add src/map/MapSurface.jsx
git commit -m "feat(route-fit): MapSurface prefers padding carried on the fit token"
```

---

### Task 6: Wire the planner (front page)

**Files:**
- Modify: `src/App.jsx`

Browser-verified (no Node unit test for this wiring).

- [ ] **Step 1: Import the hook**

At the top of `src/App.jsx`, near the other `routePlayback` imports (line 15 imports `useSyntheticRoutePlayback` from `./components/routePlayback/useRoutePlayback.js`), add:

```jsx
import { useFitRouteOnPlay } from "./components/routePlayback/useFitRouteOnPlay.js";
```

- [ ] **Step 2: Add the container ref, fit state, registry, and hook**

Inside `App()`, after `plannerPlayback` is created (around line 195), add:

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

(`useRef`, `useState`, `useMemo` are already imported in `App.jsx`.)

- [ ] **Step 3: Attach the ref to the map container**

On the `.map-container` `<div>` (around line 329, the one with the className array including `"map-container"`), add `ref={mapContainerRef}`:

```jsx
            <div
              ref={mapContainerRef}
              className={[
                "map-container",
                plannerRouteReady ? "map-container--route-ready" : "",
                plannerPoiPreviewVisible ? "map-container--has-planner-poi" : "",
                plannerPlayback.isPlaying ? "map-container--planner-playing" : "",
              ].filter(Boolean).join(" ")}
            >
```

- [ ] **Step 4: Feed the play-fit token to the map**

On the `<MapView ...>` element (around line 405), change:

```jsx
                  routeFitRequest={mapUi.routeFitRequest}
```

to:

```jsx
                  routeFitRequest={playFitRequest ?? mapUi.routeFitRequest}
```

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`
Then in the browser:
1. Build or restore a route on the front page.
2. Press the play button (the bottom `planner-route-playback` bar). Expect the camera to fit the whole route, with the route clearly **above** the play bar (not hidden behind it) and clear of the top search box.
3. Press pause, manually pan/zoom away, then press play again (cursor mid-route). Expect **no** re-fit (camera stays where you left it).
4. Let playback finish, then press play again. Expect a fresh fit (cursor reset to start).

Expected: behaviors 2–4 as described. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(route-fit): planner fits route to map on fresh play"
```

---

### Task 7: Featured context — container ref + padding-carrying requestRouteFit

**Files:**
- Modify: `src/components/featured/FeaturedRoute.jsx`
- Modify: `src/components/featured/FeaturedRouteMap.jsx`

- [ ] **Step 1: Add a map-container ref and extend `requestRouteFit`**

In `src/components/featured/FeaturedRoute.jsx`:

Add a ref near the other refs (after `const [routeFitRequest, setRouteFitRequest] = useState(null);`, line 34):

```jsx
  const mapContainerRef = useRef(null);
```

(`useRef` is already imported, line 1.)

Replace `requestRouteFit` (lines 94-100) with:

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

- [ ] **Step 2: Expose `mapContainerRef` on the context**

In the `contextValue` `useMemo` object (around line 191-219), add `mapContainerRef,` to the returned object and add `mapContainerRef` to the dependency array (a ref identity is stable, but include it to satisfy lint). For example, add the property alongside `requestRouteFit,` (line 205) and append `mapContainerRef` to the deps list (line 219).

- [ ] **Step 3: Attach the ref to `.featured-map-inline`**

In `src/components/featured/FeaturedRouteMap.jsx`:

Add `mapContainerRef` to the `useFeaturedRoute()` destructure (around line 30-43):

```jsx
    mapContainerRef,
```

Attach it to the outer `.featured-map-inline` `<div>` (the `return (` block, around line 166-173):

```jsx
    <div
      ref={mapContainerRef}
      className={[
        "featured-map-inline",
        expanded ? "featured-map-inline--expanded" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
```

- [ ] **Step 4: Verify featured tests still pass**

Run: `node tests/test-featured-route-snapshots.mjs && node tests/test-featured-route-snapshot-loader.mjs`
Expected: PASS (no behavioral change yet; `requestRouteFit` callers without padding are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/FeaturedRoute.jsx src/components/featured/FeaturedRouteMap.jsx
git commit -m "feat(route-fit): featured context exposes map ref + padding-aware requestRouteFit"
```

---

### Task 8: Wire the featured map-stage playback

**Files:**
- Modify: `src/components/featured/RouteMapPlayback.jsx`

Browser-verified.

- [ ] **Step 1: Import the hook and pull context values**

In `src/components/featured/RouteMapPlayback.jsx`, add the import near the other `routePlayback` import (line 10-16):

```jsx
import { useFitRouteOnPlay } from "../routePlayback/useFitRouteOnPlay.js";
```

Add `useRef` to the React import (line 1 currently `import React, { useEffect, useMemo } from "react";`):

```jsx
import React, { useEffect, useMemo, useRef } from "react";
```

Add `mapContainerRef` and `requestRouteFit` to the `useFeaturedRoute()` destructure (lines 25-34):

```jsx
    mapContainerRef,
    requestRouteFit,
```

- [ ] **Step 2: Add the section ref, registry, and hook**

Inside `RouteMapPlayback`, after `playback` is created (line 50), add:

```jsx
  const sectionRef = useRef(null);
  const featuredFitRegistry = useMemo(() => ([
    { selector: ".fv-video-controls", side: "bottom" },
    { selector: ".fv-video-poi-preview" },
  ]), []);

  useFitRouteOnPlay({
    isPlaying: playback.isPlaying,
    currentTime: playback.currentTime,
    geometry: routeState.geometry,
    getMapEl: () => mapContainerRef.current,
    getScopeEl: () => sectionRef.current,
    registry: featuredFitRegistry,
    onRequestFit: (req) => requestRouteFit("play-fit", { padding: req.padding }),
  });
```

- [ ] **Step 3: Attach the section ref**

On the root `<section className={["fv-route-map-playback", className]...}>` (around line 82), add `ref={sectionRef}`:

```jsx
    <section
      ref={sectionRef}
      className={["fv-route-map-playback", className].filter(Boolean).join(" ")}
      aria-label="מפת מסלול ניתנת לניגון"
    >
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`
Then open a featured route that uses the map stage (`media="map"`, e.g. a recommended/non-video route-story page). 
1. Press the route play button. Expect the map to fit the route with the route clear of the bottom playback controls.
2. Press pause, pan away, press play again mid-route → no re-fit.
3. Open the expanded (fullscreen) map → it still fits with its own padding (unchanged).

Expected: behaviors as described. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/RouteMapPlayback.jsx
git commit -m "feat(route-fit): featured map-stage fits route to map on fresh play"
```

---

### Task 9: Register new tests in the suite

**Files:**
- Modify: `package.json` (the `test` script)

- [ ] **Step 1: Add the two new test files to the `test` script**

In `package.json`, in the `"test"` script string, insert the two new test invocations alongside the other `node tests/...` entries (e.g. right after `node tests/test-route-playback-sync.mjs &&`):

```
node tests/test-route-fit-padding.mjs && node tests/test-fit-route-on-play.mjs &&
```

- [ ] **Step 2: Run both new tests via the registered commands**

Run: `node tests/test-route-fit-padding.mjs && node tests/test-fit-route-on-play.mjs`
Expected: both print their `... passed` line and exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(route-fit): register route-fit unit tests in the suite"
```

---

## Self-review notes

- **Spec coverage:** A (math) → Tasks 1–2; B (predicate + hook) → Tasks 3–4; C (MapSurface token padding) → Task 5; D planner wiring → Task 6; D featured wiring → Tasks 7–8; E tests → Tasks 1, 3, 9.
- **Type consistency:** `resolveOverlayInsets({ mapRect, overlays, gap, base })`, `computeOverlayFitPadding({ mapEl, registry, scopeEl, gap, base })`, `shouldFitOnPlayStart({ wasPlaying, isPlaying, currentTime, geometryLength, freshStartSec })`, `useFitRouteOnPlay({ ..., getMapEl, getScopeEl, registry, onRequestFit })`, and the token shape `{ id, geometry, padding }` are used identically across tasks and match `MapSurface`'s `routeFitRequest.padding` read.
- **Out of scope (per spec):** video-backed companion map, "already visible" detection, resize/mid-playback re-fits.
