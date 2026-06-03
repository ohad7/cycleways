# Featured Desktop Overlay Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in (`?layout=overlay`) desktop featured-page layout that moves the map to a PiP on the video (like mobile) and fills the right rail with the route description, a stats block, and an interactive elevation graph synced to the video/map.

**Architecture:** A shared component tree with a CSS modifier class. `FeaturedRoute` exposes a `layout` value (from the URL param) on context; the existing map slots become layout-aware; in overlay mode the rail renders a stats block + the existing `ElevationProfile`, and CSS lifts the mobile map overlay onto the desktop video. Default (no param) is byte-for-byte today's layout. Desktop-only; mobile is unchanged.

**Tech Stack:** React 18 + react-router-dom (`useSearchParams`), existing `@cycleways/core` helpers (`buildElevationProfile`), Playwright e2e, node `assert` unit tests.

**Spec:** `plans/featured-desktop-overlay-layout/design.md`

---

## File Structure

- Create `src/components/featured/featuredLayout.js` — pure `featuredLayoutFromParam(value)` helper.
- Create `tests/test-featured-layout.mjs` — unit tests for the helper + the elevation cursor-x math.
- Create `src/components/featured/FeaturedRouteStats.jsx` — presentational stats block (reads `meta` from context).
- Create `src/components/featured/FeaturedElevation.jsx` — wires `ElevationProfile` to the featured video/map sync (reads `routeState`, `videoCursor`, sync handlers from context).
- Create `tests/e2e/featured-overlay-layout.spec.mjs` — overlay vs default rendering + elevation sync + network regression.
- Modify `src/components/featured/FeaturedRoute.jsx` — read the param, put `layout` on context.
- Modify `src/components/featured/FeaturedRouteMap.jsx` — layout-aware `shouldRender`.
- Modify `src/components/featured/FeaturedVideoRoute.jsx` — apply modifier class, branch rail content.
- Modify `src/components/ElevationProfile.jsx` — additive `cursorFraction` + `onElevationSelect` props.
- Modify `src/components/featured/featured.css` — `.fv-playback--overlay` rules.
- Modify `package.json` — add `tests/test-featured-layout.mjs` to the `test` chain.

---

## Task 1: Layout param helper

**Files:**
- Create: `src/components/featured/featuredLayout.js`
- Test: `tests/test-featured-layout.mjs`
- Modify: `package.json` (test chain)

- [ ] **Step 1: Write the failing test**

Create `tests/test-featured-layout.mjs`:

```js
import assert from "node:assert/strict";
import { featuredLayoutFromParam, OVERLAY, DEFAULT } from "../src/components/featured/featuredLayout.js";

assert.equal(featuredLayoutFromParam("overlay"), OVERLAY, "exact 'overlay' selects overlay");
assert.equal(featuredLayoutFromParam(null), DEFAULT, "missing param defaults");
assert.equal(featuredLayoutFromParam(""), DEFAULT, "empty defaults");
assert.equal(featuredLayoutFromParam("OVERLAY"), DEFAULT, "case-sensitive: not overlay");
assert.equal(featuredLayoutFromParam("anything"), DEFAULT, "unknown defaults");

console.log("test-featured-layout passed");
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node tests/test-featured-layout.mjs`
Expected: FAIL — `Cannot find module '.../featuredLayout.js'`.

- [ ] **Step 3: Implement the helper**

Create `src/components/featured/featuredLayout.js`:

```js
// Featured-page layout selector. `?layout=overlay` opts into the desktop
// map-on-video layout; anything else (incl. absent) is the current layout.
export const DEFAULT = "default";
export const OVERLAY = "overlay";

export function featuredLayoutFromParam(value) {
  return value === OVERLAY ? OVERLAY : DEFAULT;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node tests/test-featured-layout.mjs`
Expected: `test-featured-layout passed`.

- [ ] **Step 5: Wire into the npm test chain**

In `package.json`, the `test` script is a long `&&` chain. Add the new test right after `node tests/test-featured-route-snapshot-loader.mjs &&`:

```
node tests/test-featured-route-snapshot-loader.mjs && node tests/test-featured-layout.mjs && node tests/test-editor-poi-validation.mjs
```

(Only insert `node tests/test-featured-layout.mjs && ` — leave the rest of the chain intact.)

- [ ] **Step 6: Commit**

```bash
git add src/components/featured/featuredLayout.js tests/test-featured-layout.mjs package.json
git commit -m "feat(featured): add featuredLayoutFromParam helper"
```

---

## Task 2: Expose `layout` on FeaturedRoute context

**Files:**
- Modify: `src/components/featured/FeaturedRoute.jsx`

- [ ] **Step 1: Add the import**

At the top of `src/components/featured/FeaturedRoute.jsx`, alongside the other imports, add react-router and the helper:

```jsx
import { useSearchParams } from "react-router-dom";
import { featuredLayoutFromParam } from "./featuredLayout.js";
```

- [ ] **Step 2: Compute the layout inside the component**

Inside `function FeaturedRoute(...)`, near the top (after the existing `useState`/`useRef` declarations, before the effects), add:

```jsx
const [searchParams] = useSearchParams();
const layout = featuredLayoutFromParam(searchParams.get("layout"));
```

- [ ] **Step 3: Put `layout` on the context value**

In the `contextValue` `useMemo`, add `layout` to the returned object and to the dependency array. The object currently starts:

```jsx
  const contextValue = useMemo(
    () => ({
      meta,
      kicker,
```

Change it to include `layout`:

```jsx
  const contextValue = useMemo(
    () => ({
      meta,
      kicker,
      layout,
```

and add `layout` to the dependency array at the end of the `useMemo` (the array beginning `[meta, kicker, ...]`).

- [ ] **Step 4: Verify build/lint**

Run: `npm run build`
Expected: build exits 0 (no unused/import errors).

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/FeaturedRoute.jsx
git commit -m "feat(featured): expose layout (from ?layout) on FeaturedRoute context"
```

---

## Task 3: Make the map slots layout-aware

**Files:**
- Modify: `src/components/featured/FeaturedRouteMap.jsx`

Currently the slot visibility gate is `isMobile`-only (lines ~116–118):

```jsx
  if (status !== "ready" || routeState.geometry.length < 2) return null;
  if (variant === "mobile" && !isMobile) return null;
  if (variant === "desktop" && isMobile) return null;
```

Leave the first (`status`) line as-is; Step 2 replaces only the two `variant` lines.

- [ ] **Step 1: Read `layout` from context**

The `useFeaturedRoute()` destructure at the top of `FeaturedRouteMapSlot` currently lists `status, dataMarkerFeatures, activeDataPointIds, routeState, focusedCoord, requestRouteFit, routeFitRequest, videoCursor, handleRouteClick, handleDataMarkerClick, playerPauseRef`. Add `layout,` to that list (do not re-add fields that are already there):

```jsx
  const {
    status,
    dataMarkerFeatures,
    activeDataPointIds,
    routeState,
    focusedCoord,
    requestRouteFit,
    routeFitRequest,
    videoCursor,
    handleRouteClick,
    handleDataMarkerClick,
    playerPauseRef,
    layout,
  } = useFeaturedRoute();
```

- [ ] **Step 2: Replace the visibility gate with layout-aware logic**

Replace the two `variant` early-returns with:

```jsx
  // The in-shell "mobile" slot is the PiP map: shown on mobile, and on desktop
  // when the overlay layout is active. The "desktop" slot is the rail map:
  // shown only on the desktop default layout.
  const overlay = layout === "overlay";
  if (variant === "mobile" && !(isMobile || overlay)) return null;
  if (variant === "desktop" && (isMobile || overlay)) return null;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual sanity (dev) — optional but recommended**

Run dev server and confirm no console errors:
- `/featured/sovev-beit-hillel` (desktop width) → rail map present, no in-shell PiP.
- `/featured/sovev-beit-hillel?layout=overlay` (desktop width) → in-shell PiP present, rail map absent.

(Full assertions come in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/FeaturedRouteMap.jsx
git commit -m "feat(featured): make map slots layout-aware (overlay shows PiP on desktop)"
```

---

## Task 4: ElevationProfile additive sync props

**Files:**
- Modify: `src/components/ElevationProfile.jsx`
- Test: `tests/test-featured-layout.mjs` (append elevation cursor-x math test)

The planner usage (`animator`, no `cursorFraction`/`onElevationSelect`) MUST stay identical. New props are additive and only take effect when provided.

- [ ] **Step 1: Add the cursor-x clamp test (extend existing test file)**

Append to `tests/test-featured-layout.mjs` (before the final `console.log`):

```js
import { elevationCursorX } from "../src/components/ElevationProfile.jsx";

assert.equal(elevationCursorX(0), 0, "fraction 0 -> 0");
assert.equal(elevationCursorX(1), 100, "fraction 1 -> 100");
assert.equal(elevationCursorX(0.5), 50, "fraction 0.5 -> 50");
assert.equal(elevationCursorX(-1), 0, "clamps below 0");
assert.equal(elevationCursorX(2), 100, "clamps above 100");
assert.equal(elevationCursorX(NaN), null, "non-finite -> null");
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node tests/test-featured-layout.mjs`
Expected: FAIL — `elevationCursorX is not a function` / import error.

- [ ] **Step 3: Export the pure helper and use it**

In `src/components/ElevationProfile.jsx`, add near the top (after imports, before the component):

```js
// Map a 0..1 route fraction to the SVG x coordinate (0..100), or null if the
// fraction is not a finite number.
export function elevationCursorX(fraction) {
  if (!Number.isFinite(fraction)) return null;
  return Math.max(0, Math.min(100, fraction * 100));
}
```

- [ ] **Step 4: Add the new props to the signature**

Change the component signature from:

```jsx
export default function ElevationProfile({ animator, distance, geometry, onElevationHover }) {
```

to:

```jsx
export default function ElevationProfile({
  animator,
  distance,
  geometry,
  onElevationHover,
  onElevationSelect = null,
  cursorFraction = null,
}) {
```

- [ ] **Step 5: Drive the marker line from `cursorFraction` when there is no animator**

After the existing animator `useEffect` (the one that `animator.subscribe("elevation", ...)`), add a second effect:

```jsx
  // When there is no animator (e.g. featured pages), drive the marker line from
  // an external cursor fraction (the video/map position). With an animator the
  // animator owns the marker, so this effect is a no-op for the planner.
  useEffect(() => {
    if (animator) return undefined;
    const line = markerLineRef.current;
    if (!line) return undefined;
    const x = elevationCursorX(cursorFraction);
    if (x === null) {
      line.setAttribute("opacity", "0");
    } else {
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("opacity", "1");
    }
    return undefined;
  }, [animator, cursorFraction]);
```

- [ ] **Step 6: Don't hide the marker on hover when there's no animator**

In `handleInteraction`, the block that disables the animator marker currently reads:

```jsx
    if (animatorMarkerEnabledRef.current) {
      animatorMarkerEnabledRef.current = false;
      const line = markerLineRef.current;
      if (line) line.setAttribute("opacity", "0");
    }
```

Gate it on `animator` so featured (no animator) keeps the cursor line visible:

```jsx
    if (animator && animatorMarkerEnabledRef.current) {
      animatorMarkerEnabledRef.current = false;
      const line = markerLineRef.current;
      if (line) line.setAttribute("opacity", "0");
    }
```

- [ ] **Step 7: Add a click-to-select handler on the overlay**

Add a click handler next to the existing handlers and wire it on the overlay div. Add this function alongside `handleInteraction`/`clearHover`:

```jsx
  const handleSelect = (event) => {
    if (!onElevationSelect) return;
    const clientX = event.changedTouches?.[0]?.clientX ?? event.clientX;
    if (!Number.isFinite(clientX)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const closestPoint = findClosestElevationPoint(profile.elevationData, xPercent);
    if (!closestPoint) return;
    onElevationSelect(buildElevationHoverPayload(closestPoint));
  };
```

Then add `onClick={handleSelect}` to the `<div className="elevation-hover-overlay" ...>` element (keep the existing mouse/touch handlers):

```jsx
        <div
          className="elevation-hover-overlay"
          onMouseMove={handleInteraction}
          onMouseLeave={clearHover}
          onTouchStart={handleInteraction}
          onTouchMove={handleInteraction}
          onTouchEnd={clearHover}
          onClick={handleSelect}
        />
```

- [ ] **Step 8: Run unit test + existing elevation/planner tests**

Run: `node tests/test-featured-layout.mjs`
Expected: `test-featured-layout passed`.
Run: `node tests/test-elevation-profile.mjs`
Expected: PASS (unchanged core helpers).

- [ ] **Step 9: Verify planner unaffected (e2e smoke)**

Run: `npx playwright test tests/e2e/react-migration-smoke.spec.mjs --workers=1`
Expected: all pass (planner ElevationProfile usage unchanged).

- [ ] **Step 10: Commit**

```bash
git add src/components/ElevationProfile.jsx tests/test-featured-layout.mjs
git commit -m "feat(elevation): additive cursorFraction + onElevationSelect props"
```

---

## Task 5: Stats block component

**Files:**
- Create: `src/components/featured/FeaturedRouteStats.jsx`

Reads `meta` from context. Catalog meta fields: `distanceKm`, `elevationGainM`, `elevationLossM`, `difficulty`, `roadMix` ({paved, dirt, road}).

- [ ] **Step 1: Create the component**

Create `src/components/featured/FeaturedRouteStats.jsx`:

```jsx
import React from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

const DIFFICULTY_HE = {
  easy: "קל",
  moderate: "בינוני",
  hard: "מאתגר",
};

function surfaceLabel(roadMix) {
  if (!roadMix) return null;
  const { paved = 0, dirt = 0, road = 0 } = roadMix;
  if (paved >= dirt && paved >= road) return "סלול";
  if (dirt >= paved && dirt >= road) return "שביל עפר";
  return "כביש";
}

export default function FeaturedRouteStats({ className = "" }) {
  const { meta } = useFeaturedRoute();
  if (!meta) return null;

  const items = [
    Number.isFinite(meta.distanceKm) && { label: "אורך", value: `${meta.distanceKm} ק"מ` },
    Number.isFinite(meta.elevationGainM) && { label: "טיפוס", value: `${meta.elevationGainM} מ׳` },
    Number.isFinite(meta.elevationLossM) && { label: "ירידה", value: `${meta.elevationLossM} מ׳` },
    meta.difficulty && { label: "רמת קושי", value: DIFFICULTY_HE[meta.difficulty] || meta.difficulty },
    surfaceLabel(meta.roadMix) && { label: "משטח", value: surfaceLabel(meta.roadMix) },
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <dl className={["fv-route-stats", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/featured/FeaturedRouteStats.jsx
git commit -m "feat(featured): add FeaturedRouteStats block (distance/elevation/difficulty/surface)"
```

---

## Task 6: Featured elevation wrapper component

**Files:**
- Create: `src/components/featured/FeaturedElevation.jsx`

Wires `ElevationProfile` to the featured sync (reads `routeState`, `videoCursor`, `setVideoCursorFromFraction`, `seekVideoToFraction` from context). No `animator` — the marker line is driven by `cursorFraction`.

- [ ] **Step 1: Create the component**

Create `src/components/featured/FeaturedElevation.jsx`:

```jsx
import React, { useCallback } from "react";
import ElevationProfile from "../ElevationProfile.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function FeaturedElevation() {
  const {
    routeState,
    videoCursor,
    setVideoCursorFromFraction,
    seekVideoToFraction,
  } = useFeaturedRoute();

  const handleHover = useCallback(
    (payload) => {
      if (!payload) return;
      setVideoCursorFromFraction(payload.t, payload.coord || null);
    },
    [setVideoCursorFromFraction],
  );

  const handleSelect = useCallback(
    (payload) => {
      if (!payload) return;
      seekVideoToFraction(payload.t, payload.coord || null);
    },
    [seekVideoToFraction],
  );

  if (!routeState || routeState.geometry.length < 2) return null;

  return (
    <ElevationProfile
      geometry={routeState.geometry}
      distance={routeState.distance}
      cursorFraction={Number.isFinite(videoCursor?.fraction) ? videoCursor.fraction : null}
      onElevationHover={handleHover}
      onElevationSelect={handleSelect}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/featured/FeaturedElevation.jsx
git commit -m "feat(featured): FeaturedElevation wires ElevationProfile to video/map sync"
```

---

## Task 7: Overlay rail in FeaturedVideoRoute

**Files:**
- Modify: `src/components/featured/FeaturedVideoRoute.jsx`

`FeaturedVideoRoute` renders *above* the context provider, so it reads the param itself (it cannot call `useFeaturedRoute`). The stats/elevation children read context themselves.

- [ ] **Step 1: Add imports**

At the top of `src/components/featured/FeaturedVideoRoute.jsx`:

```jsx
import { useSearchParams } from "react-router-dom";
import { featuredLayoutFromParam, OVERLAY } from "./featuredLayout.js";
import FeaturedRouteStats from "./FeaturedRouteStats.jsx";
import FeaturedElevation from "./FeaturedElevation.jsx";
```

- [ ] **Step 2: Compute layout and the playback class**

Inside `FeaturedVideoRoute(...)`, at the top of the function body:

```jsx
  const [searchParams] = useSearchParams();
  const overlay = featuredLayoutFromParam(searchParams.get("layout")) === OVERLAY;
```

Change the playback section opener from:

```jsx
      <section className="fv-playback" aria-label="סרטון, תיאור ומפת המסלול">
```

to:

```jsx
      <section
        className={`fv-playback${overlay ? " fv-playback--overlay" : ""}`}
        aria-label="סרטון, תיאור ומפת המסלול"
      >
```

- [ ] **Step 3: Branch the rail's second row**

Currently the side rail's second block is the map wrap:

```jsx
          <div className="fv-side-map-wrap">
            <div className="fv-side-heading">
              <span>מרחק מההתחלה</span>
              <FeaturedRoute.ProgressDistance />
            </div>
            <FeaturedRoute.Map
              variant="desktop"
              className="fv-side-map"
              autoResetAfterInteraction
              routeFitPadding={22}
            />
          </div>
```

Replace that block with a layout branch:

```jsx
          {overlay ? (
            <div className="fv-side-elevation-wrap">
              <div className="fv-side-heading">
                <span>מרחק מההתחלה</span>
                <FeaturedRoute.ProgressDistance />
              </div>
              <FeaturedRouteStats />
              <FeaturedElevation />
            </div>
          ) : (
            <div className="fv-side-map-wrap">
              <div className="fv-side-heading">
                <span>מרחק מההתחלה</span>
                <FeaturedRoute.ProgressDistance />
              </div>
              <FeaturedRoute.Map
                variant="desktop"
                className="fv-side-map"
                autoResetAfterInteraction
                routeFitPadding={22}
              />
            </div>
          )}
```

(The in-shell `<FeaturedRoute.Map className="fv-mobile-map" .../>` already present in the video shell stays as-is — Task 3 makes it render on desktop-overlay.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/FeaturedVideoRoute.jsx
git commit -m "feat(featured): overlay rail (description + stats + elevation) in FeaturedVideoRoute"
```

---

## Task 8: Overlay CSS

**Files:**
- Modify: `src/components/featured/featured.css`

Goal: in `.fv-playback--overlay` on desktop, position the `.fv-mobile-map` PiP in the top-right corner of the video shell, lay out the rail as description/stats/elevation, and suppress the rail side-map. Mobile rules and the default desktop layout must be untouched.

- [ ] **Step 1: Add overlay desktop rules**

Append a new block to `src/components/featured/featured.css` (near the other `.fv-` desktop rules, e.g. after the `.fv-side-map.featured-map-inline` rule around line 667). These rules are scoped to `.fv-playback--overlay` so the default layout is unaffected; wrap the PiP positioning in a `min-width: 768px` media query so mobile keeps its own `.fv-mobile-map` rules:

```css
/* Overlay layout: map becomes a PiP on the video; rail becomes text + graph. */
@media (min-width: 768px) {
  .fv-playback--overlay .fv-mobile-map.featured-map-inline {
    position: absolute;
    top: 14px;
    inset-inline-end: 14px;
    width: clamp(220px, 26%, 300px);
    height: clamp(150px, 20vh, 200px);
    z-index: 5;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.4);
  }

  /* Rail second row becomes the stats + elevation column. */
  .fv-playback--overlay .fv-side-elevation-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    padding: 12px;
    border: 1px solid rgba(36, 49, 58, 0.12);
    border-radius: 8px;
    background: rgba(253, 252, 248, 0.96);
    box-shadow: 0 10px 30px rgba(16, 24, 32, 0.12);
  }

  .fv-route-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }

  .fv-route-stats div {
    padding: 8px 10px;
    border-inline-start: 3px solid var(--fv-forest);
    border-radius: 0 6px 6px 0;
    background: var(--fv-paper);
  }

  .fv-route-stats dt {
    margin: 0 0 2px;
    color: var(--fv-clay);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .fv-route-stats dd {
    margin: 0;
    color: #24313a;
    font-size: 0.98rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 2: Ensure the video shell can anchor the PiP**

`.fv-video-shell` is already `position: relative` (line ~533), so the absolutely-positioned PiP anchors to it. Confirm by reading the rule; no change expected. If it is not relative, add `position: relative;` to `.fv-video-shell`.

- [ ] **Step 3: Verify build + visually sanity check in dev**

Run: `npm run build` (exits 0).
Dev check (desktop width):
- `/featured/sovev-beit-hillel?layout=overlay` → small map pinned top-right of the video; rail shows description, a 2-col stats grid, and the elevation graph; no large rail map.
- `/featured/sovev-beit-hillel` → unchanged (rail map present, no PiP, no elevation graph).

- [ ] **Step 4: Commit**

```bash
git add src/components/featured/featured.css
git commit -m "style(featured): overlay layout CSS (desktop PiP map + stats/elevation rail)"
```

---

## Task 9: End-to-end tests

**Files:**
- Create: `tests/e2e/featured-overlay-layout.spec.mjs`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/featured-overlay-layout.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("default layout: rail map, no elevation graph", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".fv-route-panel")).toBeVisible();
    await expect(page.locator(".fv-side-map")).toBeVisible();
    await expect(page.locator(".fv-playback--overlay")).toHaveCount(0);
    await expect(page.locator(".elevation-profile")).toHaveCount(0);
  });

  test("overlay layout: PiP map on video + elevation graph, no rail map", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel?layout=overlay");
    await expect(page.locator(".fv-playback--overlay")).toBeVisible();
    // PiP map lives inside the video shell.
    await expect(page.locator(".fv-video-shell .fv-mobile-map")).toBeVisible();
    // Rail shows the elevation graph and the stats block, not the rail map.
    await expect(page.locator(".elevation-profile")).toBeVisible();
    await expect(page.locator(".fv-route-stats")).toBeVisible();
    await expect(page.locator(".fv-side-map")).toHaveCount(0);
  });

  test("overlay still renders from snapshot without planner assets", async ({ page }) => {
    const urls = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/featured/sovev-beit-hillel?layout=overlay");
    await expect(page.locator(".elevation-profile")).toBeVisible();
    for (const pattern of ["bike_roads.geojson", "segments.json", "cw-base-index.json", "base-routing-shards/"]) {
      expect(urls.filter((u) => u.includes(pattern)), pattern).toEqual([]);
    }
  });

  test("hovering the elevation graph moves the video cursor on the map", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel?layout=overlay");
    const overlay = page.locator(".elevation-hover-overlay");
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    // The hover sets a video cursor; the elevation marker line becomes visible.
    await expect(page.locator(".elevation-profile svg line")).toHaveAttribute("opacity", "1");
  });
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/e2e/featured-overlay-layout.spec.mjs --workers=1`
Expected: all tests pass on both projects.

If the elevation-hover assertion is flaky (cursor line timing), adjust to assert the marker line `x1` attribute is near `50` instead of opacity; keep the intent (hover updates the on-graph cursor).

- [ ] **Step 3: Run the existing featured suite for regressions**

Run: `npx playwright test tests/e2e/featured-route-slots.spec.mjs tests/e2e/featured-route-layout.spec.mjs tests/e2e/featured-route-snapshot-network.spec.mjs --workers=1`
Expected: all pass (default layout unchanged).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/featured-overlay-layout.spec.mjs
git commit -m "test(e2e): featured overlay layout (PiP map, elevation graph, snapshot regression)"
```

---

## Task 10: Full verification

- [ ] **Step 1: Unit suite**

Run: `npm test`
Expected: exit 0 (includes `test-featured-layout.mjs`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0. (If snapshots regenerate with only `generatedAt` changes, revert them: `git checkout -- public-data/featured-routes/`.)

- [ ] **Step 3: E2E (featured + planner smoke)**

Run: `npx playwright test tests/e2e/featured-overlay-layout.spec.mjs tests/e2e/featured-route-slots.spec.mjs tests/e2e/featured-route-layout.spec.mjs tests/e2e/featured-route-snapshot-network.spec.mjs tests/e2e/react-migration-smoke.spec.mjs --workers=1`
Expected: all pass.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(featured): overlay layout verification"
```

---

## Notes / Acceptance

- Default featured pages (no `?layout=overlay`) are visually and behaviorally unchanged.
- `?layout=overlay` on desktop: map is a PiP top-right of the video (mirroring mobile behavior — click-route-to-seek, marker→POI, expand), and the rail shows description + stats + an elevation graph synced to the video/map (hover scrubs the cursor, click seeks, playback position reflects on the graph).
- Mobile is unaffected by the param.
- Planner (`/`) `ElevationProfile` usage is unchanged (new props are additive and inert without them).
