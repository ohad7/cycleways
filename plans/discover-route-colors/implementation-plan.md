# Discover route colors + visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Discover/recommended route lines render above the CW network in distinct per-route colors (thick/opaque enough to read), with a matching color swatch on each Discover list card.

**Architecture:** A shared `discoverRouteColor(index)` helper + palette (in `@cycleways/core`) assigns a color by list position. `App.jsx` bakes the color onto each `recommendedRoutes` entry → the map layer paints `["get","color"]` and is re-stacked above the CW network; `PanelRouteCard` renders a swatch via the same helper so list and map match.

**Tech Stack:** React, Mapbox GL line layers, plain ESM. Tests are standalone Node scripts using `node:assert/strict`, run via the `test` npm script. `@cycleways/core/*` resolves in node (workspace export `"./*": "./src/*"`).

**Spec:** `plans/discover-route-colors/design.md`.

---

### Task 1: Shared color helper + palette

**Files:**
- Create: `packages/core/src/map/discoverRouteColors.js`
- Create: `tests/test-discover-route-colors.mjs`

- [ ] **Step 1: Write the failing test.** Create `tests/test-discover-route-colors.mjs`:

```js
import assert from "node:assert/strict";
import {
  DISCOVER_ROUTE_PALETTE,
  discoverRouteColor,
} from "@cycleways/core/map/discoverRouteColors.js";

// Palette is non-empty and has no duplicates.
assert.ok(DISCOVER_ROUTE_PALETTE.length >= 6, "palette has enough colors");
assert.equal(
  new Set(DISCOVER_ROUTE_PALETTE).size,
  DISCOVER_ROUTE_PALETTE.length,
  "no duplicate colors",
);

// Index 0 -> first color.
assert.equal(discoverRouteColor(0), DISCOVER_ROUTE_PALETTE[0], "index 0 is first");

// Cycles modulo palette length.
const n = DISCOVER_ROUTE_PALETTE.length;
assert.equal(discoverRouteColor(n), DISCOVER_ROUTE_PALETTE[0], "wraps at n");
assert.equal(discoverRouteColor(n + 2), DISCOVER_ROUTE_PALETTE[2], "wraps at n+2");

// Non-integer / negative -> first color.
assert.equal(discoverRouteColor(-1), DISCOVER_ROUTE_PALETTE[0], "negative -> first");
assert.equal(discoverRouteColor(undefined), DISCOVER_ROUTE_PALETTE[0], "undefined -> first");
assert.equal(discoverRouteColor(1.5), DISCOVER_ROUTE_PALETTE[0], "non-integer -> first");

console.log("test-discover-route-colors.mjs passed");
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `node tests/test-discover-route-colors.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `packages/core/src/map/discoverRouteColors.js`:**

```js
// Distinct, saturated colors for Discover/recommended route lines and their
// matching list swatches. Deliberately avoids the CW network's earth tones
// (teal-green / gray-blue / tan), the built-route blue, and the red/green
// waypoint dots. Assigned by list position (see plans/discover-route-colors).

export const DISCOVER_ROUTE_PALETTE = [
  "#e8590c", // orange
  "#ae3ec9", // magenta
  "#7048e8", // violet
  "#f59f00", // amber
  "#d6336c", // raspberry
  "#5f3dc4", // deep indigo
  "#f06595", // pink
  "#9c36b5", // purple
];

// Color for a route at the given list position; cycles the palette. Any
// non-integer or negative index falls back to the first color.
export function discoverRouteColor(index) {
  const n = DISCOVER_ROUTE_PALETTE.length;
  const i = Number.isInteger(index) && index >= 0 ? index % n : 0;
  return DISCOVER_ROUTE_PALETTE[i];
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `node tests/test-discover-route-colors.mjs`
Expected: prints `test-discover-route-colors.mjs passed`.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/map/discoverRouteColors.js tests/test-discover-route-colors.mjs
git commit -m "feat(discover-colors): shared route color palette + discoverRouteColor"
```

---

### Task 2: Map layer — stack above network + per-route color paint

**Files:**
- Modify: `src/map/mapLayers.product.js`

Browser-verified (Mapbox layer behavior). `buildRecommendedRoutesFeatureCollection` is a private function, so no Node unit test; verified visually.

- [ ] **Step 1: Import the palette (for the feature-color fallback).** Add this import alongside the other `@cycleways/core/...` imports near the top of `src/map/mapLayers.product.js`:

```js
import { DISCOVER_ROUTE_PALETTE } from "@cycleways/core/map/discoverRouteColors.js";
```

- [ ] **Step 2: Re-stack the layer above the network.** Find this block in `syncRecommendedRoutesLayer`:

```js
  // Draw BELOW the main route geometry/points layers so a built route and
  // waypoint circles always stay on top.
  const beforeLayer = map.getLayer(ROUTE_GEOMETRY_LAYER_ID)
    ? ROUTE_GEOMETRY_LAYER_ID
    : map.getLayer(ROUTE_NETWORK_LINE_LAYER_ID)
      ? ROUTE_NETWORK_LINE_LAYER_ID
      : undefined;
```

Replace it with:

```js
  // Draw ABOVE the CW network but below the built route, waypoints, and data
  // markers (so those stay on top / tappable). Insert before the first of these
  // that exists; if none exist, append on top (still above the network).
  const beforeLayer = [
    ROUTE_GEOMETRY_LAYER_ID,
    ROUTE_POINTS_LAYER_ID,
    DATA_MARKERS_CIRCLE_LAYER_ID,
    DATA_MARKERS_LAYER_ID,
  ].find((id) => map.getLayer(id));
```

(`ROUTE_POINTS_LAYER_ID`, `DATA_MARKERS_CIRCLE_LAYER_ID`, `DATA_MARKERS_LAYER_ID` are already imported in this file. `map.addLayer(spec, undefined)` appends on top, which is the desired fallback.)

- [ ] **Step 3: Paint each line with its own color and make it readable.** Find the `paint:` block of the recommended layer:

```js
      paint: {
        "line-color": [
          "case",
          ["get", "hovered"],
          "#1c6fb0",
          "#9bb1c2",
        ],
        "line-width": [
          "case",
          ["get", "hovered"],
          5,
          2.5,
        ],
        "line-opacity": [
          "case",
          ["get", "hovered"],
          0.95,
          0.5,
        ],
      },
```

Replace it with:

```js
      paint: {
        "line-color": ["get", "color"],
        "line-width": [
          "case",
          ["get", "hovered"],
          6,
          3.5,
        ],
        "line-opacity": [
          "case",
          ["get", "hovered"],
          1,
          0.9,
        ],
      },
```

- [ ] **Step 4: Carry the color into the feature properties.** Find this in `buildRecommendedRoutesFeatureCollection`:

```js
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: { hovered: Boolean(route.hovered) },
    });
```

Replace it with:

```js
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {
        hovered: Boolean(route.hovered),
        color: route.color || DISCOVER_ROUTE_PALETTE[0],
      },
    });
```

- [ ] **Step 5: Syntax check.**

Run: `npx esbuild src/map/mapLayers.product.js > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK` (no parse errors).

- [ ] **Step 6: Commit.**

```bash
git add src/map/mapLayers.product.js
git commit -m "feat(discover-colors): recommended routes above network, per-route color"
```

---

### Task 3: `App.jsx` assigns each recommended route a color

**Files:**
- Modify: `src/App.jsx`

Browser-verified.

- [ ] **Step 1: Import the helper.** Add near the other imports (e.g. after the `./map/routeFitPadding.js` import added earlier):

```jsx
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";
```

- [ ] **Step 2: Add a color per route, keyed on the `discoverSlugs` index.** Find the `recommendedRoutes` memo:

```jsx
  const recommendedRoutes = useMemo(() => {
    if (panel.state !== "discover") return null;
    return discoverSlugs
      .map((slug) => {
        const geometry = recommendedGeoms[slug];
        if (!Array.isArray(geometry) || geometry.length < 2) return null;
        return { slug, geometry, hovered: slug === hoveredRouteSlug };
      })
      .filter(Boolean);
  }, [panel.state, discoverSlugs, recommendedGeoms, hoveredRouteSlug]);
```

Replace it with (note: color is keyed on the index within `discoverSlugs` — the full ordered list — so it matches the panel's card index even when some geometries haven't loaded yet):

```jsx
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

- [ ] **Step 3: Syntax check.**

Run: `npx esbuild src/App.jsx --loader:.jsx=jsx > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK`.

- [ ] **Step 4: Commit.**

```bash
git add src/App.jsx
git commit -m "feat(discover-colors): assign each recommended route a palette color"
```

---

### Task 4: Discover list color swatches

**Files:**
- Modify: `src/components/frontPanel/DiscoverPanel.jsx`
- Modify: `src/components/frontPanel/PanelRouteCard.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

Browser-verified.

- [ ] **Step 1: Pass the card index from `DiscoverPanel`.** Find:

```jsx
        {routes.map((entry) => (
          <PanelRouteCard
            key={entry.slug}
            entry={entry}
            places={places}
            onSelect={onSelectRoute}
            onHover={onHoverRoute}
          />
        ))}
```

Replace with:

```jsx
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
```

- [ ] **Step 2: Render the swatch in `PanelRouteCard`.** Add the import after the existing `routeImageSrc` import:

```jsx
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";
```

Change the component signature from:

```jsx
export default function PanelRouteCard({ entry, places, onSelect, onHover }) {
```

to:

```jsx
export default function PanelRouteCard({ entry, places, onSelect, onHover, index = 0 }) {
```

Then change the title span from:

```jsx
          <span className="panel-route-card__title">{entry.name}</span>
```

to:

```jsx
          <span className="panel-route-card__title">
            <span
              className="panel-route-card__swatch"
              style={{ backgroundColor: discoverRouteColor(index) }}
              aria-hidden="true"
            />
            {entry.name}
          </span>
```

- [ ] **Step 3: Add swatch CSS.** Append to `src/components/frontPanel/front-panel.css`:

```css
.panel-route-card__swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-inline-end: 6px;
  vertical-align: middle;
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Syntax check.**

Run: `npx esbuild src/components/frontPanel/PanelRouteCard.jsx --loader:.jsx=jsx > /dev/null && npx esbuild src/components/frontPanel/DiscoverPanel.jsx --loader:.jsx=jsx > /dev/null && echo "esbuild OK"`
Expected: `esbuild OK`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/frontPanel/DiscoverPanel.jsx src/components/frontPanel/PanelRouteCard.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(discover-colors): matching color swatch on Discover list cards"
```

---

### Task 5: Register the new test in the suite

**Files:**
- Modify: `package.json` (the `test` script)

- [ ] **Step 1: Register `test-discover-route-colors.mjs`.** In the `"test"` script string, insert it immediately AFTER `node tests/test-combine-route-geometries.mjs && ` so the route-fit/discover tests run together:

```
node tests/test-combine-route-geometries.mjs && node tests/test-discover-route-colors.mjs &&
```

- [ ] **Step 2: Verify.**

Run:
```bash
node tests/test-discover-route-colors.mjs
node -e "const s=require('./package.json').scripts.test; console.log(s.includes('test-discover-route-colors.mjs') ? 'registered' : 'MISSING')"
node -e "require('./package.json'); console.log('package.json valid')"
```
Expected: test passes; prints `registered`; prints `package.json valid`.

- [ ] **Step 3: Commit.**

```bash
git add package.json
git commit -m "test(discover-colors): register discover-route-colors test"
```

---

## Browser verification (after all tasks)

Run `npm run dev`, open the Discover panel:
1. Recommended route lines are visible **above** the CW network, each a distinct saturated color.
2. Each Discover list card shows a colored dot matching its line on the map.
3. Hovering a card emphasizes its line (thicker/opaque) while keeping its own color.
4. Markers and (if a route is built) the built route still draw on top of the recommended lines.

## Self-review notes

- **Spec coverage:** §A1 helper → Task 1; §A2 ordering+paint+feature color → Task 2; §A3 App color → Task 3; §A4 swatch → Task 4; §Testing → Tasks 1, 5.
- **Color match:** Task 3 keys color on the index within `discoverSlugs`; Task 4 keys the swatch on the card index within the panel's `routes`. Since `discoverSlugs === routes.map((r) => r.slug)` in the same order, both indices refer to the same route → swatch matches line.
- **Type consistency:** `discoverRouteColor(index)` / `DISCOVER_ROUTE_PALETTE` are used identically across Tasks 1–4; the feature carries `properties.color` (Task 2) which the paint reads via `["get","color"]` (Task 2) and `App` supplies via `recommendedRoutes[].color` (Task 3).
