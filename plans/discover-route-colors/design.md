# Discover route colors + visibility

Date: 2026-06-09

## Goal

On the front-page Discover panel, the recommended/discover route lines are
effectively invisible on the map — they render **below** the CycleWays (CW)
network and are thin/semi-transparent. Make them:

1. Render **above** the CW network (but below markers and the built route).
2. Each a **distinct, saturated color** that differs from the CW network's
   colors, and thick/opaque enough to read.
3. Show a matching **color swatch** on each Discover list item, so the list and
   map are visually linked.

## Decisions

- **Color assignment (approach A): by list position via a shared helper.** Both
  the panel (index in its filtered `routes`) and `App.jsx` (index in
  `discoverSlugs`) call the same `discoverRouteColor(index)`. Because
  `discoverSlugs` is `routes.map((r) => r.slug)` in the same order, index *i*
  refers to the same route on both sides, so the swatch matches the line with no
  new prop plumbing. Distinct within the visible set (up to palette length); a
  route's color may change when filters change the list — acceptable.
- **Stacking target:** above the CW network, below the data markers and the
  built route + waypoints (markers stay on top / tappable).

## Background (current state)

- `src/map/mapLayers.product.js`:
  - `syncRecommendedRoutesLayer` adds `RECOMMENDED_ROUTES_LAYER_ID` with
    `beforeLayer = ROUTE_GEOMETRY_LAYER_ID` **or** `ROUTE_NETWORK_LINE_LAYER_ID`
    — the fallback puts the layer *below* the CW network (the bug).
  - Current paint: `line-color` is blue `#1c6fb0` when hovered else light
    gray-blue `#9bb1c2`; `line-width` 5/2.5; `line-opacity` 0.95/0.5.
  - `buildRecommendedRoutesFeatureCollection` sets only
    `properties: { hovered }`.
  - Layer-id constants available in this file: `ROUTE_GEOMETRY_LAYER_ID`,
    `ROUTE_POINTS_LAYER_ID`, `DATA_MARKERS_CIRCLE_LAYER_ID`,
    `DATA_MARKERS_LAYER_ID`, `ROUTE_NETWORK_LINE_LAYER_ID`.
- CW network colors (`packages/core/src/domain/routeNetwork.js`,
  `getRouteFeatureColor`): teal-green `rgb(101,170,162)`, gray-blue
  `rgb(138,147,158)`, tan `rgb(174,144,103)`. Built route is `#006699`; waypoint
  dots green `#18a957` / red `#c84c45`; segment hover `#666633`.
- `src/App.jsx`: `recommendedRoutes` memo builds `{ slug, geometry, hovered }[]`
  from `discoverSlugs` + `recommendedGeoms`, passed to `MapView`.
- `src/components/frontPanel/DiscoverPanel.jsx`: builds the filtered `routes`
  list, reports `routes.map((r) => r.slug)` via `onVisibleRoutesChange`, and
  renders a `PanelRouteCard` per `entry`.

## Architecture

### 1. Shared color module — `packages/core/src/map/discoverRouteColors.js`

```
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

export function discoverRouteColor(index) {
  // cycles the palette; non-finite/negative -> first color
  const n = DISCOVER_ROUTE_PALETTE.length;
  const i = Number.isInteger(index) && index >= 0 ? index % n : 0;
  return DISCOVER_ROUTE_PALETTE[i];
}
```

Placed in core so both web and a future RN client can share it. The palette
deliberately avoids the network earth tones, the built-route blue, and the
red/green waypoint hues.

### 2. Map layer (`src/map/mapLayers.product.js`)

- **Ordering:** compute the insertion anchor as the first existing of
  `[ROUTE_GEOMETRY_LAYER_ID, ROUTE_POINTS_LAYER_ID, DATA_MARKERS_CIRCLE_LAYER_ID,
  DATA_MARKERS_LAYER_ID]`; pass that as `beforeLayer` (so the layer lands above
  the network, below markers/route). If none exist, pass `undefined` (append on
  top — still above the network).
- **Feature property:** `buildRecommendedRoutesFeatureCollection` adds
  `color: route.color` to each feature's `properties` (falling back to
  `DISCOVER_ROUTE_PALETTE[0]` when absent, so the layer is never colorless).
- **Paint:**
  - `"line-color": ["get", "color"]` (no more hovered blue override).
  - `"line-width": ["case", ["get", "hovered"], 6, 3.5]`.
  - `"line-opacity": ["case", ["get", "hovered"], 1, 0.9]`.

### 3. `App.jsx`

In the `recommendedRoutes` memo, add `color: discoverRouteColor(index)` to each
entry (using the map index). The color flows through `MapView` →
`syncRecommendedRoutesLayer` → feature `properties.color`.

### 4. Discover list swatch

- `DiscoverPanel` passes the card's list index to `PanelRouteCard`.
- `PanelRouteCard` renders a small color swatch (a colored dot/bar) using
  `discoverRouteColor(index)`, matching the map line.
- Add minimal CSS for the swatch (e.g. a `.panel-route-card__swatch` rule).

## Testing

Tests are plain Node scripts (`node:assert/strict`, no framework), run via the
`test` npm script.

- `tests/test-discover-route-colors.mjs` (new):
  - `discoverRouteColor(0)` is the first palette entry;
  - it cycles modulo palette length (`discoverRouteColor(n)` ===
    `discoverRouteColor(0)`);
  - non-integer / negative index → first color;
  - the palette has no duplicate entries.
- Layer ordering, paint, and the swatch rendering are browser-verified (Mapbox
  runtime + DOM).

## Out of scope

- Changing the CW network appearance or the built-route styling.
- Persisting a stable per-route color across filter changes (we use list-position
  assignment).
- Re-styling the Discover cards beyond adding the swatch.
