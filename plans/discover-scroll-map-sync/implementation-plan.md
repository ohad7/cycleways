# Discover scroll ↔ map sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all catalog routes in the Discover list (catalog order) and couple list scroll to the map — in-viewport routes drawn bright, the cards just above/below drawn as faint ghosts, off-screen routes hidden, with lazy geometry loading near the viewport and a settle-debounced camera fit to the visible set.

**Architecture:** A pure derivation function turns the ordered slug list + the set of intersecting cards into `visibleSlugs` / `ghostSlugs` / `prefetchSlugs`. A thin React hook (`useCardViewport`) runs an `IntersectionObserver` (rooted on the scrolling `.front-panel__body`) and feeds that function. `DiscoverPanel` emits the full ordered slug list (for stable colors) and the three derived sets up to `App.jsx`, which lazy-loads geometry for the prefetch set, draws bright+ghost routes with a tier-aware Mapbox paint, and debounce-fits the camera to the bright set.

**Tech Stack:** React 19, Mapbox GL, plain Node `.mjs` assertion tests (no React test harness — pure logic is extracted to testable modules; React wiring is verified by build + full suite + a manual checklist).

**Design spec:** `plans/discover-scroll-map-sync/design.md`

---

## File structure

- **Modify** `src/components/frontPanel/discoverRouteList.js` — default (no-filter) selection returns *all* entries in catalog order (mode `"all"`).
- **Modify** `tests/test-discover-route-list.mjs` — assert the new all-routes default.
- **Create** `src/components/frontPanel/discoverViewport.js` — pure `deriveViewportSets(orderedSlugs, intersecting, opts)`.
- **Create** `tests/test-discover-viewport.mjs` — unit tests for the derivation (incl. list-edge and empty cases).
- **Create** `src/components/frontPanel/useCardViewport.js` — `IntersectionObserver` hook wrapping the pure function.
- **Modify** `src/components/frontPanel/PanelRouteCard.jsx` — accept a `cardRef` for observation.
- **Modify** `src/components/frontPanel/DiscoverPanel.jsx` — plain count label, wire the hook, emit `onSlugsChange` + `onRouteViewport`.
- **Modify** `src/map/mapLayers.product.js` — export the feature-collection builder, carry `tier`, three-step paint.
- **Modify** `tests/test-map-layers.mjs` — assert `tier`/`hovered` properties.
- **Modify** `src/App.jsx` — viewport state, lazy prefetch loading, tier-tagged `recommendedRoutes`, fit to bright set on settle.
- **Modify** `package.json` — register `test-discover-viewport.mjs` and the (currently unregistered) `test-map-layers.mjs` in the `test` script.

---

## Task 1: Default Discover list = all routes, catalog order

**Files:**
- Modify: `src/components/frontPanel/discoverRouteList.js:13-19`
- Test: `tests/test-discover-route-list.mjs:21-24`

- [ ] **Step 1: Update the failing test first**

Replace lines 21-24 of `tests/test-discover-route-list.mjs`:

```js
// No active filters → all mode = every entry in catalog order.
const all = selectDiscoverRoutes(entries, {});
assert.equal(all.mode, "all");
assert.deepEqual(all.routes.map((r) => r.slug), ["a", "b", "c"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-discover-route-list.mjs`
Expected: FAIL — `all.mode` is `"recommended"` and routes are `["a","c"]`.

- [ ] **Step 3: Update `selectDiscoverRoutes`**

Replace the body of `selectDiscoverRoutes` in `src/components/frontPanel/discoverRouteList.js` (lines 13-19) with:

```js
// No active filters → "all" = the full catalog in its natural order.
// Any active filter → "results" = the catalog finder.
export function selectDiscoverRoutes(entries, filters) {
  const list = Array.isArray(entries) ? entries : [];
  if (!hasActiveDiscoverFilters(filters)) {
    return { mode: "all", routes: list };
  }
  return { mode: "results", routes: catalogFilter(list, filters) };
}
```

Also update the comment block on lines 11-12 to:

```js
// No active filters → "all" = the full catalog, catalog order.
// Any active filter → "results" = the full catalog finder.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-discover-route-list.mjs`
Expected: PASS — prints `discover-route-list ok`.

- [ ] **Step 5: Commit**

```bash
git add src/components/frontPanel/discoverRouteList.js tests/test-discover-route-list.mjs
git commit -m "feat(discover): default list shows all catalog routes in order"
```

---

## Task 2: Pure viewport-set derivation

**Files:**
- Create: `src/components/frontPanel/discoverViewport.js`
- Test: `tests/test-discover-viewport.mjs`
- Modify: `package.json` (register the new test)

- [ ] **Step 1: Write the failing test**

Create `tests/test-discover-viewport.mjs`:

```js
import assert from "node:assert/strict";
import { deriveViewportSets } from "../src/components/frontPanel/discoverViewport.js";

const order = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"];

// Mid-list block: bright = intersecting, ghost = one each side, prefetch widens.
{
  const sets = deriveViewportSets(order, new Set(["r4", "r5"]));
  assert.deepEqual(sets.visibleSlugs, ["r4", "r5"]);
  assert.deepEqual(sets.ghostSlugs, ["r3", "r6"]);
  assert.deepEqual(sets.prefetchSlugs, ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
}

// Top of list: no ghost above; prefetch clamps at index 0.
{
  const sets = deriveViewportSets(order, new Set(["r0", "r1"]));
  assert.deepEqual(sets.visibleSlugs, ["r0", "r1"]);
  assert.deepEqual(sets.ghostSlugs, ["r2"]);
  assert.deepEqual(sets.prefetchSlugs, ["r0", "r1", "r2", "r3", "r4"]);
}

// Bottom of list: no ghost below; prefetch clamps at the last index.
{
  const sets = deriveViewportSets(order, new Set(["r8", "r9"]));
  assert.deepEqual(sets.visibleSlugs, ["r8", "r9"]);
  assert.deepEqual(sets.ghostSlugs, ["r7"]);
  assert.deepEqual(sets.prefetchSlugs, ["r5", "r6", "r7", "r8", "r9"]);
}

// Nothing intersecting → all empty.
{
  const sets = deriveViewportSets(order, new Set());
  assert.deepEqual(sets, { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] });
}

// Accepts an array (not just a Set) for the intersecting arg.
{
  const sets = deriveViewportSets(order, ["r4", "r5"]);
  assert.deepEqual(sets.visibleSlugs, ["r4", "r5"]);
}

// Defensive: non-array ordered list → all empty.
{
  const sets = deriveViewportSets(null, new Set(["r4"]));
  assert.deepEqual(sets, { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] });
}

console.log("discover-viewport ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-discover-viewport.mjs`
Expected: FAIL — `Cannot find module .../discoverViewport.js`.

- [ ] **Step 3: Create the implementation**

Create `src/components/frontPanel/discoverViewport.js`:

```js
// Derive the three slug sets that drive the Discover map from the list's scroll
// viewport. Pure: given the catalog-ordered slug list and the set of slugs whose
// cards currently intersect the viewport, return:
//
//   visibleSlugs  – cards intersecting the viewport (drawn bright)
//   ghostSlugs    – the slug just before the first visible and just after the
//                   last visible (drawn faint; 0–2 entries, none at list ends)
//   prefetchSlugs – visibleSlugs ∪ ghostSlugs ∪ up to `lookahead` slugs beyond
//                   each ghost (drives lazy geometry loading)
//
// All three preserve catalog order.
export function deriveViewportSets(orderedSlugs, intersecting, { lookahead = 2 } = {}) {
  const order = Array.isArray(orderedSlugs) ? orderedSlugs : [];
  const hit = intersecting instanceof Set ? intersecting : new Set(intersecting || []);

  const visibleSlugs = order.filter((slug) => hit.has(slug));
  if (visibleSlugs.length === 0) {
    return { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] };
  }

  const first = order.indexOf(visibleSlugs[0]);
  const last = order.indexOf(visibleSlugs[visibleSlugs.length - 1]);

  const ghostSlugs = [];
  if (first - 1 >= 0) ghostSlugs.push(order[first - 1]);
  if (last + 1 < order.length) ghostSlugs.push(order[last + 1]);

  const start = Math.max(0, first - 1 - lookahead);
  const end = Math.min(order.length - 1, last + 1 + lookahead);
  const prefetchSlugs = order.slice(start, end + 1);

  return { visibleSlugs, ghostSlugs, prefetchSlugs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-discover-viewport.mjs`
Expected: PASS — prints `discover-viewport ok`.

- [ ] **Step 5: Register the test in `package.json`**

In the `"test"` script, find `node tests/test-discover-route-list.mjs` and insert the new test immediately after it, so the segment reads:

```
node tests/test-discover-route-list.mjs && node tests/test-discover-viewport.mjs && node tests/test-route-slice.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/components/frontPanel/discoverViewport.js tests/test-discover-viewport.mjs package.json
git commit -m "feat(discover): pure viewport-set derivation (visible/ghost/prefetch)"
```

---

## Task 3: `useCardViewport` hook + card ref

**Files:**
- Create: `src/components/frontPanel/useCardViewport.js`
- Modify: `src/components/frontPanel/PanelRouteCard.jsx:12,19`

This task is React/DOM wiring with no Node test harness; it is verified by `npm run build` (the React build compiles JSX) and exercised end-to-end in Task 6's manual checklist. Keep all branching logic in the already-tested `deriveViewportSets`; the hook stays a thin observer shell.

- [ ] **Step 1: Create the hook**

Create `src/components/frontPanel/useCardViewport.js`:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { deriveViewportSets } from "./discoverViewport.js";

const EMPTY = { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] };

// Observe the Discover cards against their scrolling ancestor and report the
// bright / ghost / prefetch slug sets. `orderedSlugs` is the catalog-ordered
// list of every card's slug.
//
// Returns:
//   containerRef – attach to the element that wraps the cards; the observer
//                  root is resolved by climbing to the scrolling
//                  `.front-panel__body` ancestor (falls back to the viewport).
//   registerCard – `registerCard(slug)` returns a ref callback for that card.
//   sets         – { visibleSlugs, ghostSlugs, prefetchSlugs }, recomputed on scroll.
export function useCardViewport(orderedSlugs) {
  const containerRef = useRef(null);
  const cardEls = useRef(new Map());       // slug -> element
  const intersecting = useRef(new Set());  // slugs currently intersecting
  const observerRef = useRef(null);
  const rafRef = useRef(0);
  const [sets, setSets] = useState(EMPTY);

  const recompute = useCallback(() => {
    setSets(deriveViewportSets(orderedSlugs, intersecting.current));
  }, [orderedSlugs]);

  // Coalesce bursts of observer callbacks into one recompute per frame.
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      recompute();
    });
  }, [recompute]);

  // (Re)build the observer whenever the slug list changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return undefined;
    const root = container.closest(".front-panel__body") || null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slug = entry.target.dataset.discoverSlug;
          if (!slug) continue;
          if (entry.isIntersecting) intersecting.current.add(slug);
          else intersecting.current.delete(slug);
        }
        schedule();
      },
      { root, threshold: 0 },
    );
    observerRef.current = observer;
    for (const el of cardEls.current.values()) observer.observe(el);
    schedule();
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [orderedSlugs, schedule]);

  // Ref-callback factory: registers/unregisters a card element by slug.
  const registerCard = useCallback(
    (slug) => (el) => {
      const prev = cardEls.current.get(slug);
      if (prev && observerRef.current) observerRef.current.unobserve(prev);
      if (el) {
        el.dataset.discoverSlug = slug;
        cardEls.current.set(slug, el);
        if (observerRef.current) observerRef.current.observe(el);
      } else {
        cardEls.current.delete(slug);
        intersecting.current.delete(slug);
      }
    },
    [],
  );

  return { containerRef, registerCard, sets };
}
```

- [ ] **Step 2: Let `PanelRouteCard` accept a `cardRef`**

In `src/components/frontPanel/PanelRouteCard.jsx`, change the function signature (line 12) to add `cardRef`:

```jsx
export default function PanelRouteCard({ entry, places, onSelect, onHover, index = 0, cardRef }) {
```

And add the ref to the root `<button>` (line 19), so it begins:

```jsx
    <button
      ref={cardRef}
      type="button"
      className="panel-route-card"
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds (no JSX/import errors). (This also regenerates `dist/`; do **not** `git add` build output.)

- [ ] **Step 4: Commit**

```bash
git add src/components/frontPanel/useCardViewport.js src/components/frontPanel/PanelRouteCard.jsx
git commit -m "feat(discover): useCardViewport IntersectionObserver hook + card ref"
```

---

## Task 4: Wire the hook into `DiscoverPanel`

**Files:**
- Modify: `src/components/frontPanel/DiscoverPanel.jsx:1-2,16,54-61,113-127`

Replace the old single `onVisibleRoutesChange` emission with the full ordered slug list (`onSlugsChange`, for stable colors) plus the derived sets (`onRouteViewport`). Also switch the list label to a plain count.

- [ ] **Step 1: Update imports**

At the top of `src/components/frontPanel/DiscoverPanel.jsx`, after the existing import of `selectDiscoverRoutes` (line 14), add:

```jsx
import { useCardViewport } from "./useCardViewport.js";
```

- [ ] **Step 2: Update the component signature**

Change line 16 from:

```jsx
export default function DiscoverPanel({ catalog, places, onSelectRoute, onBuild, onVisibleRoutesChange, onHoverRoute }) {
```

to:

```jsx
export default function DiscoverPanel({ catalog, places, onSelectRoute, onBuild, onSlugsChange, onRouteViewport, onHoverRoute }) {
```

- [ ] **Step 3: Replace the emit effect with the hook + two emits**

Replace the `selectDiscoverRoutes` memo and the old effect (lines 54-61):

```jsx
  const { mode, routes } = useMemo(
    () => selectDiscoverRoutes(entries, filters),
    [entries, filters],
  );

  useEffect(() => {
    onVisibleRoutesChange?.(routes.map((r) => r.slug));
  }, [routes, onVisibleRoutesChange]);
```

with:

```jsx
  const { routes } = useMemo(
    () => selectDiscoverRoutes(entries, filters),
    [entries, filters],
  );

  const orderedSlugs = useMemo(() => routes.map((r) => r.slug), [routes]);
  const { containerRef, registerCard, sets } = useCardViewport(orderedSlugs);

  // Full ordered list drives stable per-route colors; the derived sets drive the
  // map's bright/ghost tiers and lazy geometry loading.
  useEffect(() => {
    onSlugsChange?.(orderedSlugs);
  }, [orderedSlugs, onSlugsChange]);
  useEffect(() => {
    onRouteViewport?.(sets);
  }, [sets, onRouteViewport]);
```

(`mode` is no longer used — it is removed by this replacement.)

- [ ] **Step 4: Update the list region (ref + plain count + cardRef)**

Replace the list block (lines 113-127):

```jsx
      <div className="discover-panel__list">
        <div className="dlabel">
          {mode === "recommended" ? "מומלצים" : `${routes.length} מסלולים`}
        </div>
        {routes.map((entry, index) => (
          <PanelRouteCard
            key={entry.slug}
            index={index}
            entry={entry}
            places={places}
            onSelect={onSelectRoute}
            onHover={onHoverRoute}
          />
        ))}
      </div>
```

with:

```jsx
      <div className="discover-panel__list" ref={containerRef}>
        <div className="dlabel">{`${routes.length} מסלולים`}</div>
        {routes.map((entry, index) => (
          <PanelRouteCard
            key={entry.slug}
            index={index}
            entry={entry}
            places={places}
            onSelect={onSelectRoute}
            onHover={onHoverRoute}
            cardRef={registerCard(entry.slug)}
          />
        ))}
      </div>
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. (Ignore `dist/` changes.)

- [ ] **Step 6: Commit**

```bash
git add src/components/frontPanel/DiscoverPanel.jsx
git commit -m "feat(discover): emit ordered slugs + viewport sets, plain count label"
```

---

## Task 5: Tier-aware recommended-routes map paint

**Files:**
- Modify: `src/map/mapLayers.product.js:467,502-519,545-568`
- Test: `tests/test-map-layers.mjs`
- Modify: `package.json` (register `test-map-layers.mjs`)

- [ ] **Step 1: Add the failing test**

At the end of `tests/test-map-layers.mjs`, first add `buildRecommendedRoutesFeatureCollection` to the import block at the top (the `from "../src/map/mapLayers.js"` import), then append:

```js
{
  const routes = [
    {
      slug: "bright-one",
      geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }],
      color: "#e8590c",
      tier: "bright",
      hovered: false,
    },
    {
      slug: "ghost-one",
      geometry: [{ lng: 2, lat: 2 }, { lng: 3, lat: 3 }],
      color: "#ae3ec9",
      tier: "ghost",
      hovered: false,
    },
    {
      slug: "hovered-one",
      geometry: [{ lng: 4, lat: 4 }, { lng: 5, lat: 5 }],
      color: "#7048e8",
      tier: "bright",
      hovered: true,
    },
  ];
  const fc = buildRecommendedRoutesFeatureCollection(routes);
  assert.equal(fc.features.length, 3, "one feature per valid route");
  assert.equal(fc.features[0].properties.tier, "bright");
  assert.equal(fc.features[0].properties.hovered, false);
  assert.equal(fc.features[1].properties.tier, "ghost");
  assert.equal(fc.features[2].properties.hovered, true);

  // Missing tier defaults to "bright"; too-short geometry is dropped.
  const fallback = buildRecommendedRoutesFeatureCollection([
    { geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }], color: "#000" },
    { geometry: [{ lng: 0, lat: 0 }], color: "#000", tier: "ghost" },
  ]);
  assert.equal(fallback.features.length, 1, "drops <2-point geometry");
  assert.equal(fallback.features[0].properties.tier, "bright", "tier defaults to bright");
}

console.log("test-map-layers.mjs passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-map-layers.mjs`
Expected: FAIL — `buildRecommendedRoutesFeatureCollection` is not an export (import is `undefined`).

- [ ] **Step 3: Export the builder and carry `tier`**

In `src/map/mapLayers.product.js`, change the builder declaration (line 545) from:

```js
function buildRecommendedRoutesFeatureCollection(routes) {
```

to:

```js
export function buildRecommendedRoutesFeatureCollection(routes) {
```

Then in that function's `features.push({...})` `properties` block (lines 560-563), add `tier`:

```js
      properties: {
        hovered: Boolean(route.hovered),
        tier: route.tier === "ghost" ? "ghost" : "bright",
        color: route.color || DISCOVER_ROUTE_PALETTE[0],
      },
```

- [ ] **Step 4: Make the paint three-step**

In `syncRecommendedRoutesLayer`, replace the `line-width` and `line-opacity` paint properties (lines 504-515) with:

```js
        "line-width": [
          "case",
          ["get", "hovered"], 6,
          ["==", ["get", "tier"], "ghost"], 2,
          3.5,
        ],
        "line-opacity": [
          "case",
          ["get", "hovered"], 1,
          ["==", ["get", "tier"], "ghost"], 0.25,
          0.9,
        ],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test-map-layers.mjs`
Expected: PASS — prints `test-map-layers.mjs passed`.

- [ ] **Step 6: Register `test-map-layers.mjs` in `package.json`**

In the `"test"` script, find `node tests/test-map-mode.mjs` and insert the map-layers test immediately after it, so the segment reads:

```
node tests/test-map-mode.mjs && node tests/test-map-layers.mjs && node tests/test-panel-state.mjs
```

- [ ] **Step 7: Commit**

```bash
git add src/map/mapLayers.product.js tests/test-map-layers.mjs package.json
git commit -m "feat(discover): tier-aware recommended-route paint (bright/ghost/hover)"
```

---

## Task 6: Wire viewport into `App.jsx` (lazy load, tiers, settle-fit)

**Files:**
- Modify: `src/App.jsx:95,112-147,239-262,266-273,551-557`

No Node test harness covers `App.jsx`; verify with `npm run build`, the full `npm test` suite, and the manual checklist below.

- [ ] **Step 1: Add viewport state**

In `src/App.jsx`, immediately after the `discoverSlugs` state (line 95):

```js
  const [discoverSlugs, setDiscoverSlugs] = useState([]);
```

add:

```js
  const [discoverViewport, setDiscoverViewport] = useState({
    visibleSlugs: [],
    ghostSlugs: [],
    prefetchSlugs: [],
  });
```

- [ ] **Step 2: Lazy-load geometry for the prefetch set**

Replace the geometry-loading effect's guard and `slugsToLoad` (lines 112-118):

```js
  useEffect(() => {
    if (panel.state !== "discover" || discoverSlugs.length === 0) return;
    let cancelled = false;
    const slugsToLoad = discoverSlugs.filter(
      (slug) => !recommendedGeomCacheRef.current.has(slug),
    );
    if (slugsToLoad.length === 0) return;
```

with:

```js
  useEffect(() => {
    const prefetch = discoverViewport.prefetchSlugs;
    if (panel.state !== "discover" || prefetch.length === 0) return;
    let cancelled = false;
    const slugsToLoad = prefetch.filter(
      (slug) => !recommendedGeomCacheRef.current.has(slug),
    );
    if (slugsToLoad.length === 0) return;
```

Then update that effect's dependency array (line 147) from:

```js
  }, [discoverSlugs, panel.state]);
```

to:

```js
  }, [discoverViewport.prefetchSlugs, panel.state]);
```

- [ ] **Step 3: Build tier-tagged `recommendedRoutes`**

Replace the `recommendedRoutes` memo (lines 239-253):

```js
  const recommendedRoutes = useMemo(() => {
    if (panel.state !== "discover") return null;
    return discoverSlugs
      .map((slug, index) => {
        const geometry = recommendedGeoms[slug];
        if (!Array.isArray(geometry) || geometry.length < 2) return null;
        return {
          slug,
          geometry,
          hovered: slug === hoveredRouteSlug,
          color: discoverRouteColor(index),
        };
      })
      .filter(Boolean);
  }, [panel.state, discoverSlugs, recommendedGeoms, hoveredRouteSlug]);
```

with:

```js
  const recommendedRoutes = useMemo(() => {
    if (panel.state !== "discover") return null;
    const bright = new Set(discoverViewport.visibleSlugs);
    const drawSlugs = [
      ...discoverViewport.visibleSlugs,
      ...discoverViewport.ghostSlugs,
    ];
    return drawSlugs
      .map((slug) => {
        const geometry = recommendedGeoms[slug];
        if (!Array.isArray(geometry) || geometry.length < 2) return null;
        // Color is keyed to the route's position in the full ordered list so it
        // stays stable regardless of which routes are currently drawn.
        const index = discoverSlugs.indexOf(slug);
        return {
          slug,
          geometry,
          hovered: slug === hoveredRouteSlug,
          tier: bright.has(slug) ? "bright" : "ghost",
          color: discoverRouteColor(index),
        };
      })
      .filter(Boolean);
  }, [
    panel.state,
    discoverViewport,
    discoverSlugs,
    recommendedGeoms,
    hoveredRouteSlug,
  ]);
```

- [ ] **Step 4: Fit only to the bright (visible) set**

Replace the `discoverFitRoutes` memo (lines 257-262):

```js
  const discoverFitRoutes = useMemo(() => {
    if (panel.state !== "discover") return null;
    return discoverSlugs
      .map((slug) => ({ geometry: recommendedGeoms[slug] }))
      .filter((r) => Array.isArray(r.geometry) && r.geometry.length >= 2);
  }, [panel.state, discoverSlugs, recommendedGeoms]);
```

with:

```js
  // Fit only the bright (in-viewport) routes — ghosts are drawn but excluded so
  // the camera frames what the user is actually reading.
  const discoverFitRoutes = useMemo(() => {
    if (panel.state !== "discover") return null;
    return discoverViewport.visibleSlugs
      .map((slug) => ({ geometry: recommendedGeoms[slug] }))
      .filter((r) => Array.isArray(r.geometry) && r.geometry.length >= 2);
  }, [panel.state, discoverViewport.visibleSlugs, recommendedGeoms]);
```

- [ ] **Step 5: Lengthen the fit debounce to settle on scroll-stop**

In the fit effect (line 271), change the debounce delay from `150` to `200`:

```js
    const timer = window.setTimeout(() => requestFit(combined), 200);
```

(The hover-to-fit effect on lines 276-287 stays unchanged — it still flies to a hovered route and restores `discoverFitGeometryRef.current` on leave.)

- [ ] **Step 6: Update the `DiscoverPanel` props**

In the JSX (lines 556-557), replace:

```jsx
                    onVisibleRoutesChange={setDiscoverSlugs}
                    onHoverRoute={setHoveredRouteSlug}
```

with:

```jsx
                    onSlugsChange={setDiscoverSlugs}
                    onRouteViewport={setDiscoverViewport}
                    onHoverRoute={setHoveredRouteSlug}
```

- [ ] **Step 7: Verify build + full suite**

Run: `npm run build && npm test`
Expected: build succeeds; the test suite passes, including `test-discover-route-list.mjs`, `test-discover-viewport.mjs`, and `test-map-layers.mjs`. (Do **not** `git add` regenerated `dist/`/`public-data/`.)

- [ ] **Step 8: Manual verification checklist**

Run `npm run dev`, open the app, open the Discover panel, and confirm:
- The list shows all catalog routes (7+), in catalog order, with the `N מסלולים` count.
- On load, only the routes whose cards are on-screen are drawn bright on the map; the cards just above/below the visible block draw as faint ghost lines.
- Scrolling updates the bright/ghost/hidden lines live; routes scrolled far away disappear from the map.
- When scrolling stops, the camera eases to fit the currently-visible routes.
- Hovering a card still bolds that one route and flies the camera to it; mouse-out returns to the visible-set fit.

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx
git commit -m "feat(discover): scroll-coupled map — lazy load, tiers, settle-fit"
```

---

## Self-review notes

- **Spec coverage:** all-routes default (Task 1) · pure visible/ghost/prefetch derivation + edges (Task 2) · IntersectionObserver hook rooted on `.front-panel__body` (Task 3) · panel emits ordered slugs + sets, plain count label (Task 4) · three-tier paint hidden/ghost/bright/hover (Task 5) · lazy prefetch load, tier tagging, fit-to-bright-on-settle, hover unchanged (Task 6). Every design section maps to a task.
- **Type/name consistency:** `deriveViewportSets(orderedSlugs, intersecting, { lookahead })` returns `{ visibleSlugs, ghostSlugs, prefetchSlugs }` — used verbatim in the hook, App memos, and the load effect. `tier` values are exactly `"bright" | "ghost"`, matched by the paint expressions and the builder's default. Panel props `onSlugsChange` / `onRouteViewport` match App's `setDiscoverSlugs` / `setDiscoverViewport`. `cardRef` prop matches `registerCard(slug)`'s returned ref callback.
- **No placeholders:** every code-changing step shows the full replacement code and exact run/expected lines.
```
