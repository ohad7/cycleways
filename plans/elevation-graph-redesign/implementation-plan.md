# Elevation Graph Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cosmetic elevation gradient with a slope-graded cluster fill, enforce a minimum vertical range so flat routes look flat, and surface the slope categorization through a legend and hover tooltip — porting the grade-classification system from `~/projects/elevator`.

**Architecture:** Extract two new pure-JS utility modules (`grade.js`, `slopeClustering.js`) for grade math and grade-class clustering. Extract the inline `ElevationProfile` from `src/App.jsx` into its own component file. Redesign the SVG rendering to draw one area-under-curve path per slope cluster (subtle fill opacity 0.45), apply a Y-axis floor (`MIN_VERTICAL_RANGE_M = 100`) centered on the elevation midpoint, add an inline legend, and extend the hover payload with grade information surfaced as a colored chip in App.jsx's existing hover panel.

**Tech Stack:** React 19, plain SVG, vanilla JS utilities, `node --test`-free standalone test scripts using `node:assert/strict` (matching existing `tests/test-*.mjs` convention).

**Spec:** `docs/superpowers/specs/2026-05-27-elevation-graph-redesign-design.md`

---

## File Structure

**New files:**
- `src/utils/grade.js` — `classifyGrade`, `segmentGrades`, `pointSmoothedGrades`, `GRADE_CLASSES`, `GRADE_COLORS`, `GRADE_LABELS_HE`
- `src/utils/slopeClustering.js` — `clusterByGrade`
- `src/components/ElevationProfile.jsx` — the React component (replaces inline version in App.jsx)
- `tests/test-grade.mjs` — unit tests for grade utilities
- `tests/test-slope-clustering.mjs` — unit tests for clustering

**Modified files:**
- `src/App.jsx` — remove inline `ElevationProfile` / `buildElevationProfile` / `findClosestElevationPoint`; import the new component; update `SegmentNameDisplay` to show grade chip
- `src/react-app.css` — add styles for legend and grade chip; update `.elevation-chart` background where it's React-scoped
- `styles.css` — neutralize the legacy `.elevation-profile` wrapper background and `.elevation-chart` background gradient
- `package.json` — register the two new test scripts in the `test` command

---

## Task 1: Grade utilities — TDD

**Files:**
- Create: `tests/test-grade.mjs`
- Create: `src/utils/grade.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test file**

Create `tests/test-grade.mjs`:

```js
import assert from "node:assert/strict";
import {
  GRADE_CLASSES,
  GRADE_COLORS,
  GRADE_LABELS_HE,
  classifyGrade,
  segmentGrades,
  pointSmoothedGrades,
} from "../src/utils/grade.js";

// ── GRADE_CLASSES ────────────────────────────────────────────────────────
assert.deepEqual(GRADE_CLASSES, ["downhill", "easy", "steady", "hard", "brutal"]);

// ── GRADE_COLORS ─────────────────────────────────────────────────────────
assert.equal(GRADE_COLORS.downhill, "#3e7fc8");
assert.equal(GRADE_COLORS.easy, "#2fa14f");
assert.equal(GRADE_COLORS.steady, "#c9a020");
assert.equal(GRADE_COLORS.hard, "#d97520");
assert.equal(GRADE_COLORS.brutal, "#c43030");

// ── GRADE_LABELS_HE ──────────────────────────────────────────────────────
assert.equal(GRADE_LABELS_HE.downhill, "ירידה");
assert.equal(GRADE_LABELS_HE.easy, "קל");
assert.equal(GRADE_LABELS_HE.steady, "יציב");
assert.equal(GRADE_LABELS_HE.hard, "קשה");
assert.equal(GRADE_LABELS_HE.brutal, "קשוח");

// ── classifyGrade ────────────────────────────────────────────────────────
assert.equal(classifyGrade(-5), "downhill");
assert.equal(classifyGrade(-1.01), "downhill");
assert.equal(classifyGrade(-1), "easy", "−1% is the boundary, classifies as easy");
assert.equal(classifyGrade(0), "easy");
assert.equal(classifyGrade(1.99), "easy");
assert.equal(classifyGrade(2), "steady", "2% is the boundary, classifies as steady");
assert.equal(classifyGrade(4.99), "steady");
assert.equal(classifyGrade(5), "hard", "5% is the boundary, classifies as hard");
assert.equal(classifyGrade(8.99), "hard");
assert.equal(classifyGrade(9), "brutal", "9% is the boundary, classifies as brutal");
assert.equal(classifyGrade(12), "brutal");

// ── segmentGrades ────────────────────────────────────────────────────────
{
  // cum is cumulative distance in meters; ele is elevation in meters
  // Two segments: flat 100m (0% grade), then +5m over 100m (5% grade)
  const cum = [0, 100, 200];
  const ele = [10, 10, 15];
  const grades = segmentGrades(cum, ele);
  assert.equal(grades.length, 2);
  assert.equal(grades[0], 0);
  assert.equal(grades[1], 5);
}

{
  // Zero-distance segment returns 0% grade (avoid division by zero)
  const grades = segmentGrades([0, 0, 100], [10, 20, 30]);
  assert.equal(grades[0], 0);
  assert.equal(grades[1], 10);
}

// ── pointSmoothedGrades ──────────────────────────────────────────────────
{
  // Linear climb: 1000m climbing at constant 5% — every smoothed grade ≈ 5%
  const cum = [];
  const ele = [];
  for (let i = 0; i <= 100; i++) {
    cum.push(i * 10);
    ele.push(i * 0.5); // 0.5m per 10m = 5%
  }
  const smoothed = pointSmoothedGrades(cum, ele, 200);
  assert.equal(smoothed.length, cum.length);
  for (let i = 0; i < smoothed.length; i++) {
    assert.ok(
      Math.abs(smoothed[i] - 5) < 0.001,
      `expected ~5% at index ${i}, got ${smoothed[i]}`,
    );
  }
}

{
  // Smoothing reduces noise: noisy ele values around a flat trend
  // Window covers all points; result at midpoint should average toward 0
  const cum = [0, 50, 100, 150, 200];
  const ele = [0, 10, 0, -10, 0]; // oscillates around 0
  const smoothed = pointSmoothedGrades(cum, ele, 1000);
  // Window is huge so each point sees the whole array; lo=0, hi=4
  // dx=200, dy=0 → 0% grade everywhere
  for (const g of smoothed) {
    assert.ok(Math.abs(g) < 0.001, `expected ~0% smoothed, got ${g}`);
  }
}

console.log("test-grade.mjs: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-grade.mjs`
Expected: FAIL with `Cannot find module ... src/utils/grade.js`

- [ ] **Step 3: Write the implementation**

Create `src/utils/grade.js`:

```js
// Grade classification and smoothing utilities, ported from
// ~/projects/elevator/src/lib/grade.js.

export const GRADE_CLASSES = ["downhill", "easy", "steady", "hard", "brutal"];

export const GRADE_COLORS = {
  downhill: "#3e7fc8",
  easy: "#2fa14f",
  steady: "#c9a020",
  hard: "#d97520",
  brutal: "#c43030",
};

export const GRADE_LABELS_HE = {
  downhill: "ירידה",
  easy: "קל",
  steady: "יציב",
  hard: "קשה",
  brutal: "קשוח",
};

// Returns per-segment grade in percent. Output length = cum.length - 1.
export function segmentGrades(cum, ele) {
  const n = cum.length;
  const out = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = cum[i + 1] - cum[i];
    const dy = ele[i + 1] - ele[i];
    out[i] = dx > 0 ? (dy / dx) * 100 : 0;
  }
  return out;
}

export function classifyGrade(gradePct) {
  if (gradePct < -1) return "downhill";
  if (gradePct < 2) return "easy";
  if (gradePct < 5) return "steady";
  if (gradePct < 9) return "hard";
  return "brutal";
}

// For each point, the grade over a centered distance window of ~windowM.
// The window shrinks at the route ends. Returns array length cum.length (%).
export function pointSmoothedGrades(cum, ele, windowM) {
  const n = cum.length;
  const half = windowM / 2;
  const out = new Array(n);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && cum[i] - cum[lo] > half) lo++;
    while (hi < n - 1 && cum[hi] - cum[i] < half) hi++;
    const dx = cum[hi] - cum[lo];
    const dy = ele[hi] - ele[lo];
    out[i] = dx > 0 ? (dy / dx) * 100 : 0;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-grade.mjs`
Expected: `test-grade.mjs: all assertions passed`

- [ ] **Step 5: Register the test in package.json**

In `package.json`, find the `"test"` script (currently begins with `"npm run test:osm && node tests/test-map-assets.mjs && ..."`). Insert ` && node tests/test-grade.mjs` immediately after the last existing `node tests/test-*.mjs` entry (just before `cd tests && node test-route-manager.js`).

Resulting fragment (only the changed portion shown):

```
...&& node tests/test-analytics-parity.mjs && node tests/test-gpx-parity.mjs && node tests/test-grade.mjs && cd tests && node test-route-manager.js
```

Then run the full project test command to verify it integrates:

Run: `npm test`
Expected: all tests pass, including the new `test-grade.mjs`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/grade.js tests/test-grade.mjs package.json
git commit -m "Add grade classification utility for elevation profile"
```

---

## Task 2: Slope clustering — TDD

**Files:**
- Create: `tests/test-slope-clustering.mjs`
- Create: `src/utils/slopeClustering.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test file**

Create `tests/test-slope-clustering.mjs`:

```js
import assert from "node:assert/strict";
import { clusterByGrade } from "../src/utils/slopeClustering.js";

// Build a cum/ele pair: one entry per 50m, with a per-segment elevation delta
// supplied by the caller (length n-1).
function buildRoute(segDeltas, stepM = 50) {
  const cum = [0];
  const ele = [0];
  for (let i = 0; i < segDeltas.length; i++) {
    cum.push(cum[cum.length - 1] + stepM);
    ele.push(ele[ele.length - 1] + segDeltas[i]);
  }
  return { cum, ele };
}

// ── Single-class flat route → one "easy" cluster ─────────────────────────
{
  const { cum, ele } = buildRoute(new Array(20).fill(0)); // 20 × 50m = 1000m
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].gradeClass, "easy");
  assert.equal(clusters[0].startIdx, 0);
  assert.equal(clusters[0].endIdx, 20);
  assert.equal(clusters[0].distanceM, 1000);
}

// ── Two clusters with no merging ─────────────────────────────────────────
{
  // First 10 segments flat (500m, "easy"), next 10 climbing at 8% (500m, "hard")
  const segDeltas = [
    ...new Array(10).fill(0),       // flat: 0% grade
    ...new Array(10).fill(50 * 0.08) // 8% grade: 4m per 50m
  ];
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].gradeClass, "easy");
  assert.equal(clusters[1].gradeClass, "hard");
  assert.equal(clusters[0].distanceM, 500);
  assert.equal(clusters[1].distanceM, 500);
}

// ── Short cluster (< 100m) absorbed into longer neighbor ─────────────────
{
  // 10 flat segments (500m), then ONE 8% segment (50m, "hard"),
  // then 10 more flat segments (500m). The single hard segment is only
  // 50m so should be merged into a neighbor.
  const segDeltas = [
    ...new Array(10).fill(0),
    50 * 0.08, // one short "hard" bump: 50m
    ...new Array(10).fill(0),
  ];
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  // After merging the 50m hard run into one of its neighbors and
  // coalescing same-class neighbors, we expect a single "easy" cluster.
  assert.equal(clusters.length, 1, `expected 1 cluster, got ${clusters.length}`);
  assert.equal(clusters[0].gradeClass, "easy");
  assert.equal(clusters[0].distanceM, 1050);
}

// ── avgGrade and gainM are computed per cluster ──────────────────────────
{
  // 10 segments at 8% (500m total, +40m gain)
  const segDeltas = new Array(10).fill(50 * 0.08);
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  assert.equal(clusters.length, 1);
  assert.ok(Math.abs(clusters[0].avgGrade - 8) < 0.001);
  assert.ok(Math.abs(clusters[0].gainM - 40) < 0.001);
}

// ── Empty / single-point input → empty result ────────────────────────────
assert.deepEqual(clusterByGrade([], []), []);
assert.deepEqual(clusterByGrade([0], [10]), []);

console.log("test-slope-clustering.mjs: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-slope-clustering.mjs`
Expected: FAIL with `Cannot find module ... src/utils/slopeClustering.js`

- [ ] **Step 3: Write the implementation**

Create `src/utils/slopeClustering.js`:

```js
import { segmentGrades, classifyGrade } from "./grade.js";

// Greedy: classify each segment, run-length encode into clusters, then merge
// clusters shorter than minDistanceM into the neighbor with greater length.
// Ported from ~/projects/elevator/src/lib/clustering.js.
export function clusterByGrade(cum, ele, opts = {}) {
  const minDistanceM = opts.minDistanceM ?? 100;
  const n = cum.length;
  if (n < 2) return [];

  const seg = segmentGrades(cum, ele); // length n-1
  const classes = seg.map(classifyGrade);

  // run-length encode
  let runs = [];
  let i = 0;
  while (i < classes.length) {
    let j = i;
    while (j + 1 < classes.length && classes[j + 1] === classes[i]) j++;
    runs.push({ startSeg: i, endSeg: j, cls: classes[i] });
    i = j + 1;
  }

  // merge short runs
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      const dist = cum[r.endSeg + 1] - cum[r.startSeg];
      if (dist >= minDistanceM) continue;
      const left = k > 0 ? runs[k - 1] : null;
      const right = k < runs.length - 1 ? runs[k + 1] : null;
      let mergeWith;
      if (!left) mergeWith = "right";
      else if (!right) mergeWith = "left";
      else {
        const lDist = cum[left.endSeg + 1] - cum[left.startSeg];
        const rDist = cum[right.endSeg + 1] - cum[right.startSeg];
        mergeWith = lDist >= rDist ? "left" : "right";
      }
      if (mergeWith === "left") {
        runs[k - 1] = { startSeg: left.startSeg, endSeg: r.endSeg, cls: left.cls };
        runs.splice(k, 1);
      } else {
        runs[k] = { startSeg: r.startSeg, endSeg: right.endSeg, cls: right.cls };
        runs.splice(k + 1, 1);
      }
      changed = true;
      break; // restart pass — indices shifted
    }
  }

  // Coalesce adjacent same-class runs (merging can produce e.g. hard | hard
  // after a short cluster collapses).
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.cls === r.cls) last.endSeg = r.endSeg;
    else merged.push({ ...r });
  }

  return merged.map((r) => {
    const startIdx = r.startSeg;
    const endIdx = r.endSeg + 1;
    const distanceM = cum[endIdx] - cum[startIdx];
    const dy = ele[endIdx] - ele[startIdx];
    const gainM = Math.max(0, dy);
    const avgGrade = distanceM > 0 ? (dy / distanceM) * 100 : 0;
    return {
      startIdx,
      endIdx,
      distanceM,
      avgGrade,
      gainM,
      gradeClass: classifyGrade(avgGrade),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-slope-clustering.mjs`
Expected: `test-slope-clustering.mjs: all assertions passed`

- [ ] **Step 5: Register the test in package.json**

Append ` && node tests/test-slope-clustering.mjs` immediately after the `test-grade.mjs` entry added in Task 1:

```
...&& node tests/test-grade.mjs && node tests/test-slope-clustering.mjs && cd tests && node test-route-manager.js
```

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/slopeClustering.js tests/test-slope-clustering.mjs package.json
git commit -m "Add slope clustering utility for elevation profile"
```

---

## Task 3: Extract `ElevationProfile` to its own component file (pure refactor)

Move the existing component out of App.jsx **with no behavior changes**. This isolates the refactor risk before the redesign starts.

**Files:**
- Create: `src/components/ElevationProfile.jsx`
- Modify: `src/App.jsx` (lines 44, 1633–1853)

- [ ] **Step 1: Create the new component file**

Create `src/components/ElevationProfile.jsx`. The contents are the existing `ElevationProfile`, `buildElevationProfile`, `findClosestElevationPoint`, and `formatLegacyDistance` functions copied verbatim from `src/App.jsx`, with imports added.

```jsx
import { useEffect, useMemo, useRef } from "react";
import { smoothElevations } from "../../utils/elevations.js";
import { getDistance } from "../../utils/distance.js";

export default function ElevationProfile({ animator, distance, geometry, onElevationHover }) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const markerLineRef = useRef(null);

  useEffect(() => {
    if (!animator) return undefined;
    const unsubscribe = animator.subscribe("elevation", (payload) => {
      const line = markerLineRef.current;
      if (!line) return;
      if (!payload) {
        line.setAttribute("opacity", "0");
        return;
      }
      const x = Math.max(0, Math.min(100, payload.t * 100));
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("opacity", "1");
    });
    return unsubscribe;
  }, [animator]);

  if (!profile) return null;

  const handleInteraction = (event) => {
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    if (!Number.isFinite(clientX)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const closestPoint = findClosestElevationPoint(profile.elevationData, xPercent);
    if (!closestPoint) return;

    onElevationHover?.({
      coord: closestPoint.coord,
      distance: closestPoint.distance,
      elevation: closestPoint.elevation,
    });
  };

  const clearHover = () => {
    onElevationHover?.(null);
  };

  return (
    <div className="elevation-profile">
      <h4>גרף גובה (Elevation Profile)</h4>
      <div className="elevation-chart" id="elevation-chart">
        <svg
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id="reactElevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#748873" stopOpacity="1" />
              <stop offset="33%" stopColor="#D1A980" stopOpacity="1" />
              <stop offset="66%" stopColor="#E5E0D8" stopOpacity="1" />
              <stop offset="100%" stopColor="#F8F8F8" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path
            d={profile.pathData}
            fill="url(#reactElevationGradient)"
            stroke="#748873"
            strokeWidth="0.5"
          />
          <line
            ref={markerLineRef}
            x1="0"
            x2="0"
            y1="0"
            y2="100"
            stroke="#ffd54a"
            strokeWidth="0.6"
            strokeLinecap="round"
            opacity="0"
            style={{ pointerEvents: "none" }}
          />
        </svg>
        <div
          className="elevation-hover-overlay"
          onMouseMove={handleInteraction}
          onMouseLeave={clearHover}
          onTouchStart={handleInteraction}
          onTouchMove={handleInteraction}
          onTouchEnd={clearHover}
        />
      </div>
      <div className="elevation-labels">
        <span className="distance-label">{formatLegacyDistance(distance)}</span>
        <span className="distance-label">0 ק"מ</span>
      </div>
    </div>
  );
}

function buildElevationProfile(geometry) {
  const routeWithElevation = (geometry || []).map((point) => ({
    lat: point.lat,
    lng: point.lng,
    elevation: Number(point.elevation ?? point.ele ?? point.altitude),
  }));

  if (
    routeWithElevation.length < 2 ||
    routeWithElevation.some(
      (point) =>
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng) ||
        !Number.isFinite(point.elevation),
    )
  ) {
    return null;
  }

  const smoothedRouteCoords = smoothElevations(routeWithElevation, 100);
  const totalDistance = smoothedRouteCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(smoothedRouteCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) return null;

  const coordsWithElevation = smoothedRouteCoords.map((coord, index) => {
    const pointDistance =
      index === 0
        ? 0
        : smoothedRouteCoords.slice(0, index + 1).reduce((total, candidate, idx) => {
            if (idx === 0) return 0;
            return total + getDistance(smoothedRouteCoords[idx - 1], candidate);
          }, 0);
    return { ...coord, distance: pointDistance };
  });

  const minElevation = Math.min(...coordsWithElevation.map((point) => point.elevation));
  const maxElevation = Math.max(...coordsWithElevation.map((point) => point.elevation));
  const range = maxElevation - minElevation || 100;
  const profileWidth = 300;
  const elevationData = [];

  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;
    let beforePoint = null;
    let afterPoint = null;

    for (let index = 0; index < coordsWithElevation.length - 1; index++) {
      if (
        coordsWithElevation[index].distance <= distanceAtX &&
        coordsWithElevation[index + 1].distance >= distanceAtX
      ) {
        beforePoint = coordsWithElevation[index];
        afterPoint = coordsWithElevation[index + 1];
        break;
      }
    }

    let elevation;
    let coord;
    if (beforePoint && afterPoint) {
      const ratio =
        (distanceAtX - beforePoint.distance) /
        (afterPoint.distance - beforePoint.distance || 1);
      elevation =
        beforePoint.elevation +
        (afterPoint.elevation - beforePoint.elevation) * ratio;
      coord = {
        lat: beforePoint.lat + (afterPoint.lat - beforePoint.lat) * ratio,
        lng: beforePoint.lng + (afterPoint.lng - beforePoint.lng) * ratio,
      };
    } else if (beforePoint) {
      elevation = beforePoint.elevation;
      coord = beforePoint;
    } else {
      elevation = coordsWithElevation[0].elevation;
      coord = coordsWithElevation[0];
    }

    const heightPercent = Math.max(
      5,
      ((elevation - minElevation) / range) * 80 + 10,
    );
    const distancePercent = (x / profileWidth) * 100;
    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
    });
  }

  let pathData = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent;
    pathData += `${index === 0 ? "M" : " L"} ${x} ${y}`;
  });

  return {
    elevationData,
    pathData: `${pathData} L 100 100 L 0 100 Z`,
  };
}

function findClosestElevationPoint(elevationData, xPercent) {
  if (!Array.isArray(elevationData) || elevationData.length === 0) return null;

  return elevationData.reduce((closest, point) => {
    const distanceFromPointer = Math.abs(point.distancePercent - xPercent);
    if (!closest || distanceFromPointer < closest.distanceFromPointer) {
      return { ...point, distanceFromPointer };
    }
    return closest;
  }, null);
}

function formatLegacyDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "0 ק\"מ";
  return `${(distanceMeters / 1000).toFixed(1)} ק\"מ`;
}
```

> **Note on the `utils/` import paths:** This file uses `../../utils/elevations.js` and `../../utils/distance.js` because the existing `utils/` directory sits **outside** `src/` (at the repo root — verify with `ls utils/`). The component is at `src/components/`, so two `..` are required.

- [ ] **Step 2: Replace inline component in App.jsx with the import**

Modify `src/App.jsx`:

- Replace line 44 (`import { smoothElevations } from "../utils/elevations.js";`) — this import is no longer used in App.jsx; remove it.
- Add a new import near the other component imports (e.g. just after the existing `from "./components/..."` imports near the top of the file):

```jsx
import ElevationProfile from "./components/ElevationProfile.jsx";
```

- Delete lines 1633 through 1853 (the inline `ElevationProfile`, `buildElevationProfile`, `findClosestElevationPoint`, and `formatLegacyDistance` functions). Use grep to verify nothing else in App.jsx references these names:

```bash
grep -n "buildElevationProfile\|findClosestElevationPoint\|formatLegacyDistance" src/App.jsx
```

Expected: no output (all three were only used by the inline component).

- The JSX usage at line 1593–1598 (`<ElevationProfile … />`) stays unchanged — it now resolves to the imported component.

- [ ] **Step 3: Run the dev server and verify visually**

```bash
npm run dev
```

Open the app in a browser, build a route, and confirm the elevation profile still renders identically (same gradient, same shape, same hover behavior, same animator marker). Take note: at this point nothing should look different.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass (no new tests added in this task, but nothing should break).

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/ElevationProfile.jsx
git commit -m "Extract ElevationProfile to its own component file"
```

---

## Task 4: Apply Y-range floor with centered band

This is a pure rendering tweak inside the new component. Adds the `MIN_VERTICAL_RANGE_M` floor and centers the visible band on the elevation midpoint, so flat routes look flat.

**Files:**
- Modify: `src/components/ElevationProfile.jsx`

- [ ] **Step 1: Update `buildElevationProfile` to use the new range math**

In `src/components/ElevationProfile.jsx`, modify the inner of `buildElevationProfile`. Find this section:

```js
  const minElevation = Math.min(...coordsWithElevation.map((point) => point.elevation));
  const maxElevation = Math.max(...coordsWithElevation.map((point) => point.elevation));
  const range = maxElevation - minElevation || 100;
```

Replace with:

```js
  const MIN_VERTICAL_RANGE_M = 100;
  const observedMin = Math.min(...coordsWithElevation.map((point) => point.elevation));
  const observedMax = Math.max(...coordsWithElevation.map((point) => point.elevation));
  const observedRange = observedMax - observedMin;
  const renderedRange = Math.max(observedRange, MIN_VERTICAL_RANGE_M);
  const center = (observedMin + observedMax) / 2;
  const minElevation = center - renderedRange / 2;
  const range = renderedRange;
```

Then, in the per-x-point loop, find:

```js
    const heightPercent = Math.max(
      5,
      ((elevation - minElevation) / range) * 80 + 10,
    );
```

Replace with:

```js
    const heightPercent = ((elevation - minElevation) / range) * 80 + 10;
```

The `Math.max(5, …)` floor is removed because the range floor supersedes it. (`elevation - minElevation` can never be negative now that `minElevation` is the band's true lower bound, so the y value stays in `[10, 90]`.)

- [ ] **Step 2: Run the dev server and verify visually**

```bash
npm run dev
```

Test cases to load:
1. A route with significant elevation change (e.g. anything with >300m gain) — should look very similar to before; subtle Y-axis shift.
2. A short flat route (you can pick something with ~20m of variation) — should now render as a thin band centered vertically with empty space above and below, **not** as a stretched mountain.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ElevationProfile.jsx
git commit -m "Enforce minimum vertical range on elevation profile"
```

---

## Task 5: Render area-under-curve per slope cluster with subtle colors

Replace the single gradient-filled path with one colored path per slope cluster. Also remove the legacy decorative background gradient.

**Files:**
- Modify: `src/components/ElevationProfile.jsx`
- Modify: `styles.css` (the `.elevation-profile` and `.elevation-chart` rules at lines 1395–1418)

- [ ] **Step 1: Update `buildElevationProfile` to compute clusters and per-cluster paths**

In `src/components/ElevationProfile.jsx`:

Add imports at the top (after the existing `import` lines):

```js
import { GRADE_COLORS, pointSmoothedGrades, classifyGrade } from "../utils/grade.js";
import { clusterByGrade } from "../utils/slopeClustering.js";
```

Then, inside `buildElevationProfile`, after the line that creates `coordsWithElevation` (the array of `{lat, lng, elevation, distance}` objects) and **before** the `MIN_VERTICAL_RANGE_M` block, add the cluster computation:

```js
  const cumDistances = coordsWithElevation.map((p) => p.distance);
  const elevations = coordsWithElevation.map((p) => p.elevation);
  const smoothedGrades = pointSmoothedGrades(cumDistances, elevations, 200);
  const clusters = clusterByGrade(cumDistances, elevations, { minDistanceM: 100 });
```

Then, **replace** the existing `pathData` construction and return value. Find this block:

```js
  let pathData = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent;
    pathData += `${index === 0 ? "M" : " L"} ${x} ${y}`;
  });

  return {
    elevationData,
    pathData: `${pathData} L 100 100 L 0 100 Z`,
  };
```

…and replace it with this version, which annotates each rendered point with smoothed-grade info, builds one area path per cluster, and builds an outline path (replacing the old `pathData`):

```js
  // Annotate each rendered data point with grade info from the closest
  // original geometry index (linear scan over original distances is O(n*m)
  // but n=301 and m is typically <2000; acceptable for now).
  let lastIdx = 0;
  for (const point of elevationData) {
    while (
      lastIdx < cumDistances.length - 1 &&
      cumDistances[lastIdx + 1] < point.distance
    ) {
      lastIdx++;
    }
    point.grade = smoothedGrades[lastIdx];
    point.gradeClass = classifyGrade(point.grade);
  }

  // Build one area-under-curve path per cluster. The path uses the
  // resampled elevationData points that fall within each cluster's
  // distance range, plus the cluster boundary x values for clean edges.
  const totalDistanceForClusters = cumDistances[cumDistances.length - 1];
  const clusterPaths = clusters.map((cluster) => {
    const startD = cumDistances[cluster.startIdx];
    const endD = cumDistances[cluster.endIdx];
    const startX = (startD / totalDistanceForClusters) * 100;
    const endX = (endD / totalDistanceForClusters) * 100;
    const slice = elevationData.filter(
      (p) => p.distancePercent >= startX && p.distancePercent <= endX,
    );
    if (slice.length < 2) return null;
    let d = `M ${slice[0].distancePercent} 100`;
    for (const p of slice) {
      d += ` L ${p.distancePercent} ${100 - p.heightPercent}`;
    }
    d += ` L ${slice[slice.length - 1].distancePercent} 100 Z`;
    return {
      d,
      color: GRADE_COLORS[cluster.gradeClass],
      gradeClass: cluster.gradeClass,
    };
  }).filter(Boolean);

  // Outline of the full elevation curve over the top of the cluster fills.
  let outlinePath = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent;
    outlinePath += `${index === 0 ? "M" : " L"} ${x} ${y}`;
  });

  return {
    elevationData,
    clusterPaths,
    outlinePath,
  };
```

- [ ] **Step 2: Update the JSX to render per-cluster paths and a stroke-only outline**

In the same file, replace the `<defs>...</defs>` block and the single `<path>` inside the SVG with this:

```jsx
          {profile.clusterPaths.map((cluster, index) => (
            <path
              key={`${cluster.gradeClass}-${index}`}
              d={cluster.d}
              fill={cluster.color}
              fillOpacity="0.45"
              stroke="none"
            />
          ))}
          <path
            d={profile.outlinePath}
            fill="none"
            stroke="#3d3d3d"
            strokeOpacity="0.5"
            strokeWidth="0.4"
          />
```

(The `<line ref={markerLineRef} ... />` element underneath stays exactly as it is.)

- [ ] **Step 3: Neutralize the decorative legacy background**

In `styles.css`, find the block at line 1395:

```css
.elevation-profile {
  margin-top: 8px;
  padding: 8px;
  background: linear-gradient(135deg, #E6F3E6 0%, #B8D4B8 100%);
  border-radius: 4px;
  border: 1px solid #8FBC8F;
}
```

Replace with:

```css
.elevation-profile {
  margin-top: 8px;
  padding: 8px;
  background: #f7f6f2;
  border-radius: 4px;
  border: 1px solid #d8d4cc;
}
```

Then find the block at line 1411:

```css
.elevation-chart {
  position: relative;
  height: 60px;
  background: linear-gradient(to top, #6B8E23 0%, #8FBC8F 20%, #E6F3E6 100%);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 3px;
}
```

Replace with:

```css
.elevation-chart {
  position: relative;
  height: 60px;
  background: #ffffff;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 3px;
}
```

- [ ] **Step 4: Run the dev server and verify visually**

```bash
npm run dev
```

Test cases:
1. A route with mixed grades — should show clearly colored bands (blue/green/gold/orange/red) at low opacity with a thin dark outline tracing the curve.
2. A short flat route — should render as a single green ribbon centered vertically, with most of the chart empty.
3. A pure descent — should show predominantly blue tinting.
4. Hover over the chart — the existing distance/elevation tooltip in the panel should still work (extending it is Task 7).

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ElevationProfile.jsx styles.css
git commit -m "Color elevation profile by slope grade clusters"
```

---

## Task 6: Add the inline legend

A compact single-row legend below the chart and above the existing distance labels.

**Files:**
- Modify: `src/components/ElevationProfile.jsx`
- Modify: `src/react-app.css`

- [ ] **Step 1: Add the legend JSX**

In `src/components/ElevationProfile.jsx`, import the labels at the top:

```js
import { GRADE_CLASSES, GRADE_COLORS, GRADE_LABELS_HE, pointSmoothedGrades, classifyGrade } from "../utils/grade.js";
```

(replacing the existing import line for `grade.js`).

Then, in the JSX, **between** the `</div>` closing the `.elevation-chart` div and the `<div className="elevation-labels">` block, insert:

```jsx
      <div className="react-elevation-legend" aria-label="מקרא שיפועים">
        {GRADE_CLASSES.map((cls) => (
          <span key={cls} className="react-elevation-legend__item">
            <span
              className="react-elevation-legend__swatch"
              style={{ background: GRADE_COLORS[cls] }}
            />
            <span className="react-elevation-legend__label">
              {GRADE_LABELS_HE[cls]}
            </span>
          </span>
        ))}
      </div>
```

- [ ] **Step 2: Add the legend CSS**

In `src/react-app.css`, after the existing `.react-route-description-content .elevation-hover-overlay { ... }` block (around line 1044), append:

```css
.react-elevation-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 6px;
  font-size: 11px;
  color: #666;
  direction: rtl;
}

.react-elevation-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.react-elevation-legend__swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.react-elevation-legend__label {
  line-height: 1;
}
```

- [ ] **Step 3: Run the dev server and verify visually**

```bash
npm run dev
```

Confirm:
- Legend shows below the chart and above the distance labels.
- Five colored dots with Hebrew labels: ירידה, קל, יציב, קשה, קשוח.
- Reading order is right-to-left.
- Wraps gracefully to two rows when the panel is narrow.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ElevationProfile.jsx src/react-app.css
git commit -m "Add slope legend to elevation profile"
```

---

## Task 7: Extend hover payload with grade and surface it as a chip

The hover overlay already publishes `{coord, distance, elevation}` to `onElevationHover`. We extend it with `grade` and `gradeClass`, then update `SegmentNameDisplay` in App.jsx to render a small colored chip next to the existing distance/elevation line.

**Files:**
- Modify: `src/components/ElevationProfile.jsx`
- Modify: `src/App.jsx` (`SegmentNameDisplay` function, lines ~2048–2061)
- Modify: `src/react-app.css`

- [ ] **Step 1: Extend the hover payload in the component**

In `src/components/ElevationProfile.jsx`, find the `handleInteraction` function and replace the `onElevationHover?.(...)` call:

```js
    onElevationHover?.({
      coord: closestPoint.coord,
      distance: closestPoint.distance,
      elevation: closestPoint.elevation,
    });
```

with:

```js
    onElevationHover?.({
      coord: closestPoint.coord,
      distance: closestPoint.distance,
      elevation: closestPoint.elevation,
      grade: closestPoint.grade,
      gradeClass: closestPoint.gradeClass,
    });
```

(`closestPoint.grade` and `closestPoint.gradeClass` were attached to every `elevationData` point in Task 5.)

- [ ] **Step 2: Import grade labels into App.jsx**

In `src/App.jsx`, add an import near the other utility imports at the top:

```jsx
import { GRADE_COLORS, GRADE_LABELS_HE } from "./utils/grade.js";
```

- [ ] **Step 3: Update `SegmentNameDisplay` to render the grade chip**

In `src/App.jsx`, find this block (around line 2054):

```jsx
  if (elevationHover) {
    return (
      <div className="segment-name-display react-segment-name-display--active" id="segment-name-display">
        📍 מרחק: {(elevationHover.distance / 1000).toFixed(1)} km • גובה:{" "}
        {Math.round(elevationHover.elevation)} m
      </div>
    );
  }
```

Replace with:

```jsx
  if (elevationHover) {
    const gradeClass = elevationHover.gradeClass;
    const grade = elevationHover.grade;
    const showChip = gradeClass && Number.isFinite(grade);
    return (
      <div className="segment-name-display react-segment-name-display--active" id="segment-name-display">
        📍 מרחק: {(elevationHover.distance / 1000).toFixed(1)} km • גובה:{" "}
        {Math.round(elevationHover.elevation)} m
        {showChip && (
          <span
            className="react-grade-chip"
            style={{
              background: `${GRADE_COLORS[gradeClass]}2e`, // 0x2e ≈ 0.18 alpha
              color: GRADE_COLORS[gradeClass],
              borderColor: `${GRADE_COLORS[gradeClass]}66`,
            }}
          >
            {GRADE_LABELS_HE[gradeClass]} · {grade.toFixed(1)}%
          </span>
        )}
      </div>
    );
  }
```

- [ ] **Step 4: Add the chip CSS**

In `src/react-app.css`, after the legend rules added in Task 6, append:

```css
.react-grade-chip {
  display: inline-block;
  margin-inline-start: 8px;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 999px;
  border: 1px solid;
  font-weight: 600;
}
```

- [ ] **Step 5: Run the dev server and verify visually**

```bash
npm run dev
```

Build a route with varied grades and hover the elevation chart at different x positions. Confirm:
- The existing distance / elevation line still appears.
- A small pill (e.g. `קשה · 7.2%`) appears next to it, tinted in the cluster color.
- The pill updates color and number as the hover moves between clusters.
- Hovering a flat section shows `קל` and a near-zero grade.
- Hovering a descent shows `ירידה` and a negative grade.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/ElevationProfile.jsx src/App.jsx src/react-app.css
git commit -m "Show slope grade chip in elevation hover tooltip"
```

---

## Final verification

- [ ] **Run the full test suite once more**

```bash
npm test
```

Expected: all tests pass, including `test-grade.mjs` and `test-slope-clustering.mjs`.

- [ ] **Manual smoke test in the browser**

```bash
npm run dev
```

Walk through:
1. Build a long, hilly route — verify cluster colors look proportionate to climb/descent sections, outline reads clearly, legend present.
2. Build a short, flat route — verify the elevation profile looks flat (thin band centered vertically), not stretched.
3. Hover the chart at various positions — verify the grade chip appears, matches the color under the cursor, and shows a sensible grade percentage.
4. The animator marker (yellow vertical line) still moves with the route animator.
5. Page resize / RTL layout: legend wraps cleanly, chip sits naturally next to the distance/elevation line.

- [ ] **Check git log**

```bash
git log --oneline -10
```

Expected: 7 new commits on the branch, one per task, in order.
