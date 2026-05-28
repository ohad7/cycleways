# Elevation Graph Redesign

## Background

The current elevation graph (rendered by `ElevationProfile` in `src/App.jsx:1633`) has three usability problems:

1. **Color scheme is purely cosmetic.** A vertical 4-stop gradient (`#748873 → #D1A980 → #E5E0D8 → #F8F8F8`) is drawn behind every route regardless of its actual profile. Colors convey no information.
2. **Flat routes look mountainous.** The Y axis uses pure normalization `((elevation - minE) / (maxE - minE)) * 80 + 10`. A route with 20m of variation fills the chart vertically just as much as one with 1000m. Users misread short, flat rides as significant climbs.
3. **No slope effort signal.** Riders cannot see at a glance where the climbs and descents are or how hard each segment is. The sibling project at `~/projects/elevator` already implements a grade-classification system that solves this; reusing it gives consistency across the two apps.

This spec describes a redesign that addresses all three.

## Goals

- Color the chart by **slope grade class** so effort is visible at a glance.
- Make flat routes **look flat** by enforcing a minimum vertical range.
- Make the slope categorization **discoverable** through an inline legend and an extended hover tooltip.
- Keep the chart subtle — colors at low opacity so the panel still reads as a calm overview rather than a data dashboard.

## Non-goals

- Hardest-spot markers (the elevator app shows these inside selected segments — out of scope here).
- User-configurable smoothing.
- Map-side coloring of the route by grade. This spec touches only the elevation profile component.
- Changes to elevation gain / loss totals or any other elevation statistics.

## Architecture

The current `ElevationProfile` component and its `buildElevationProfile` helper live inline in `src/App.jsx` (lines 1633–1836). App.jsx is already 2217 lines. Adding clustering logic, classification, color decisions, and a legend would push it further and bury reusable code. We extract:

| New file | Purpose |
|---|---|
| `src/utils/grade.js` | `classifyGrade`, `segmentGrades`, `pointSmoothedGrades` (ported from elevator) |
| `src/utils/slopeClustering.js` | `clusterByGrade` (ported from elevator) |
| `src/components/ElevationProfile.jsx` | The React component, including `buildElevationProfile` |

Styles live in the existing `src/react-app.css` (following current scoping conventions).

`App.jsx` imports `ElevationProfile` and passes the same props it does today: `animator`, `distance`, `geometry`, `onElevationHover`. The component contract from App.jsx's perspective is unchanged except for the extended hover payload (see "Hover tooltip" below).

## Slope categorization

### Grade thresholds

Reused verbatim from elevator (`src/lib/grade.js`):

| Class | Range | Color | Hebrew label |
|---|---|---|---|
| downhill | < −1% | `#3e7fc8` blue | ירידה |
| easy | −1% to 2% | `#2fa14f` green | קל |
| steady | 2% to 5% | `#c9a020` gold | יציב |
| hard | 5% to 9% | `#d97520` orange | קשה |
| brutal | ≥ 9% | `#c43030` red | קשוח |

### Smoothing

Per-segment grades from raw GPS points are noisy. We use a centered distance-window smoother (`pointSmoothedGrades` from elevator) with `windowM = 200`. This is larger than elevator's default because:

- cycleways has no user-tunable smoothing UI;
- inputs come straight from routing services (not user-uploaded GPX), so noise characteristics differ.

### Clustering

`clusterByGrade(cum, ele, { minDistanceM: 100 })`:

1. Classify each segment's grade.
2. Run-length encode adjacent same-class segments into clusters.
3. Merge clusters shorter than 100m into their longer neighbor (greedy, restart on each merge).
4. Coalesce adjacent same-class clusters after merging.

This is the elevator algorithm verbatim.

### Mapping clusters into resample space

`buildElevationProfile` resamples the smoothed route to 300 evenly-spaced x positions for rendering. Clusters must be computed on the **full smoothed geometry** with real cumulative distances, *then* mapped into resample-space x positions for drawing. The mapping is straightforward: each cluster's `startKm / totalKm` and `endKm / totalKm` become the cluster's x boundaries in chart space (0–100 in the existing SVG viewBox).

## Rendering changes

### Area fill by cluster

The current single `<path fill="url(#reactElevationGradient)">` is replaced with one `<path>` per cluster, each an area-under-curve clipped to that cluster's x range and filled with its class color at `fill-opacity="0.45"` (slightly lower than elevator's 0.55, to match the requested subtle feel).

A thin outline `stroke="#3d3d3d"` at `stroke-width="0.4"` and `stroke-opacity="0.5"` traces the full elevation curve over the top so the shape reads clearly even where fill opacity is low.

The `<defs><linearGradient id="reactElevationGradient">` block is removed.

### Background tone

The `.elevation-chart` CSS background gradient (`#6B8E23 → #8FBC8F → #E6F3E6`) and the panel wrapper's green gradient background (`#E6F3E6 → #B8D4B8`) compete with the new cluster colors. Both become a flat neutral (`#f7f6f2`). The panel border softens accordingly (`1px solid #d8d4cc`).

### Fixed minimum Y range

Introduce `MIN_VERTICAL_RANGE_M = 100`.

```js
const observedRange = maxE - minE;
const renderedRange = Math.max(observedRange, MIN_VERTICAL_RANGE_M);
const center = (maxE + minE) / 2;
const renderedMin = center - renderedRange / 2;
const renderedMax = center + renderedRange / 2;
```

The visible band is **centered on the elevation midpoint** rather than anchored at `minE`. A 20m-variation route renders as a thin ribbon in the middle of the chart with empty space above and below — visually unmistakably flat.

The existing `Math.max(5, …)` height floor is removed; the new range floor supersedes it.

## Legend

A compact single row below the chart and above the existing distance labels:

```
● ירידה   ● קל   ● יציב   ● קשה   ● קשוח
```

- 8–10px circular swatches in the class color.
- 11px label text, muted color (`#666`).
- Wraps to two rows on narrow widths.
- The existing hidden `h4` title stays hidden.

The legend renders in RTL order (matching the panel's `dir="rtl"` parent).

## Hover tooltip

The existing `onElevationHover` payload is `{coord, distance, elevation}`. It gains two fields:

- `grade` — smoothed grade % at the hovered point (from `pointSmoothedGrades`)
- `gradeClass` — one of the 5 class strings

In App.jsx, the `inspectedSegment` rendering (the panel that shows distance / elevation on hover) gains a small colored chip showing the class label and signed grade %, e.g. `קשה · 7.2%`. Chip background uses the class color at `0.18` opacity; text uses a darker shade of the same hue for legibility.

The chip is placed near the existing distance/elevation lines. Visual integration details (exact placement, spacing) follow whatever conventions the inspected-segment block already uses.

## Edge cases

| Situation | Behavior |
|---|---|
| All-flat route | Single cluster (likely "easy"), rendered as one green ribbon in the middle of the chart. Looks visibly flat. |
| No elevation data / NaN / fewer than 2 points | Component returns `null` (current behavior preserved). |
| Very short route (< 100m total) | `clusterByGrade` still produces at least one cluster; no special handling. |
| Sparse-point routes | 200m grade smoothing window handles GPS noise. |
| Routes that dip below sea level | Negative `minE` is fine — math is unchanged. |
| Single huge climb (one cluster covers entire route) | Renders as one full-width colored area, which is correct. |

## Testing

Tests follow the existing project convention: standalone Node scripts under `tests/` invoked from the `test` npm script (see other `tests/test-*.mjs` examples in the repo). Two new files:

- `tests/test-grade.mjs`
  - `classifyGrade` returns expected class at threshold boundaries (exactly 2%, 5%, 9%, −1%, and just outside each).
  - `segmentGrades` computes correct grades from a fabricated `cum`/`ele` pair.
  - `pointSmoothedGrades` matches a hand-computed expected value at the midpoint of a known input.
- `tests/test-slope-clustering.mjs`
  - Single-class input produces one cluster.
  - Multi-class input with no merges produces the expected cluster sequence.
  - Short cluster (< 100m) is absorbed into its longer neighbor.
  - Adjacent same-class clusters coalesce after a merge.

A test for `buildElevationProfile` itself is not added: the resampling math is unchanged, the new logic (cluster mapping, Y-range floor) is covered by the underlying utility tests, and the project does not currently render React components in tests. Visual correctness is verified manually in the browser during implementation.

The new test files are added to the `test` script in `package.json`.

## Open questions

None at time of writing. Threshold values, color palette, opacity (0.45), smoothing window (200m), cluster minimum (100m), and `MIN_VERTICAL_RANGE_M` (100m) are tunable during implementation if visual review reveals issues; they are not architectural decisions.
