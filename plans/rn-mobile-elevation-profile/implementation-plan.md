# Native Elevation Profile Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iPhone app a native, grade-colored elevation profile chart with touch-scrub tooltip and a synced map marker, in an expandable bottom sheet, sharing all computation with the web planner via `@cycleways/core`.

**Architecture:** Extract the pure `buildElevationProfile`/`findClosestElevationPoint` and the grade/cluster utils into `@cycleways/core`; web refactors to consume them (zero behavior change). Native renders the same `viewBox="0 0 100 100"` SVG path strings via `react-native-svg`, scrubs with a `PanResponder`, and lifts the scrubbed coordinate to `MapScreen` which draws a marker layer.

**Tech Stack:** `@cycleways/core` (shared JS), React (web), React Native / Expo SDK 56, `react-native-svg`, `@rnmapbox/maps`, Maestro (iOS smoke).

Design spec: `plans/rn-mobile-elevation-profile/design.md`.

---

## Verification guard (run after web/shared changes)

- `npm test` → all green (the chain already includes `test-grade.mjs` and `test-slope-clustering.mjs`).
- `npm run build` → succeeds.
- dev-probe: `npm run dev -- --port 51xx`, load `/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un`, assert `#root` non-empty + a `ק"מ` distance + no errors.
- `npm run test:smoke` → baseline 40 pass / 12 fail / 1–2 skipped (no NEW failures).

Native simulator: booted iPhone 15 / iOS 17.5, UDID `961E0C3E-338F-4311-BD0B-72C2BF47C03B`; Metro via `npm run mobile`; Maestro at `~/.maestro/bin/maestro`. Target controls by `accessibilityLabel`.

---

## File Structure

- Move `src/utils/grade.js` → `packages/core/src/utils/grade.js` (pure grade math/constants).
- Move `src/utils/slopeClustering.js` → `packages/core/src/utils/slopeClustering.js` (pure clustering).
- Create `packages/core/src/ui/elevationProfile.js` — pure `buildElevationProfile(geometry)` + `findClosestElevationPoint(elevationData, xPercent)`.
- Modify `src/components/ElevationProfile.jsx` — import builder + grade helpers from core; drop local copies; keep DOM/SVG/animator/hover code and `formatLegacyDistance`.
- Modify `tests/test-grade.mjs`, `tests/test-slope-clustering.mjs` — import from `@cycleways/core/utils/...`.
- Create `tests/test-elevation-profile.mjs` — unit test for `buildElevationProfile`.
- Modify `package.json` — add the new test to the `test` chain.
- Modify `apps/mobile/package.json` — add `react-native-svg` (via `expo install`).
- Create `apps/mobile/src/ElevationProfileChart.jsx` — native chart + scrub.
- Modify `apps/mobile/src/MapScreen.jsx` — `scrubPoint` state + marker layer (in `MapScreen`), expandable sheet + chart render (in `RoutePlannerChrome`), styles.
- Create `apps/mobile/.maestro/elevation-profile-smoke.yaml` — iOS smoke.

---

## Task 1: Move grade + slope-clustering utils into `@cycleways/core`

**Files:**
- Move: `src/utils/grade.js` → `packages/core/src/utils/grade.js`
- Move: `src/utils/slopeClustering.js` → `packages/core/src/utils/slopeClustering.js`
- Modify: `src/components/ElevationProfile.jsx:4-5`
- Modify: `tests/test-grade.mjs:9`
- Modify: `tests/test-slope-clustering.mjs:2-3`

- [ ] **Step 1: Move the two files (verbatim) with git mv**

```bash
git mv src/utils/grade.js packages/core/src/utils/grade.js
git mv src/utils/slopeClustering.js packages/core/src/utils/slopeClustering.js
```

The internal import in `slopeClustering.js` (`import { segmentGrades, classifyGrade } from "./grade.js";`) stays correct — both files move together.

- [ ] **Step 2: Update the three importers**

In `src/components/ElevationProfile.jsx` replace lines 4-5:

```jsx
import { GRADE_CLASSES, GRADE_COLORS, GRADE_LABELS_HE, pointSmoothedGrades, classifyGrade } from "@cycleways/core/utils/grade.js";
import { clusterByGrade } from "@cycleways/core/utils/slopeClustering.js";
```

In `tests/test-grade.mjs` line 9, change `} from "../src/utils/grade.js";` to:

```js
} from "@cycleways/core/utils/grade.js";
```

In `tests/test-slope-clustering.mjs` lines 2-3:

```js
import { clusterByGrade } from "@cycleways/core/utils/slopeClustering.js";
import { classifyGrade } from "@cycleways/core/utils/grade.js";
```

- [ ] **Step 3: Run the moved unit tests**

Run: `node tests/test-grade.mjs && node tests/test-slope-clustering.mjs`
Expected: both print their pass output, exit 0.

- [ ] **Step 4: Run the full guard**

Run: `npm test` (expect all green), `npm run build` (succeeds), dev-probe (clean).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): move grade + slope-clustering utils into @cycleways/core"
```

---

## Task 2: Extract `buildElevationProfile` into `@cycleways/core` (TDD)

**Files:**
- Test: `tests/test-elevation-profile.mjs`
- Create: `packages/core/src/ui/elevationProfile.js`
- Modify: `src/components/ElevationProfile.jsx` (remove local `buildElevationProfile`/`findClosestElevationPoint`, import from core)
- Modify: `package.json` (test chain)

- [ ] **Step 1: Write the failing test**

Create `tests/test-elevation-profile.mjs`:

```js
import assert from "node:assert/strict";
import {
  buildElevationProfile,
  findClosestElevationPoint,
} from "@cycleways/core/ui/elevationProfile.js";

// A short climbing-then-descending route with elevation on each point.
const geometry = [
  { lat: 33.10, lng: 35.58, elevation: 80 },
  { lat: 33.11, lng: 35.585, elevation: 120 },
  { lat: 33.12, lng: 35.59, elevation: 160 },
  { lat: 33.13, lng: 35.595, elevation: 110 },
  { lat: 33.14, lng: 35.60, elevation: 90 },
];

const profile = buildElevationProfile(geometry);
assert.ok(profile, "profile should be built for valid geometry");
assert.ok(Array.isArray(profile.elevationData) && profile.elevationData.length > 0, "elevationData present");
assert.ok(Array.isArray(profile.clusterPaths) && profile.clusterPaths.length > 0, "clusterPaths present");
assert.ok(typeof profile.outlinePath === "string" && profile.outlinePath.startsWith("M"), "outlinePath is an SVG path");
for (const p of profile.elevationData) {
  assert.ok(p.distancePercent >= 0 && p.distancePercent <= 100, "distancePercent in [0,100]");
  assert.ok(Number.isFinite(p.elevation), "elevation finite");
  assert.ok(p.coord && Number.isFinite(p.coord.lat) && Number.isFinite(p.coord.lng), "coord present");
}
for (const c of profile.clusterPaths) {
  assert.ok(typeof c.d === "string" && c.d.includes("Z"), "cluster path closed");
  assert.ok(typeof c.color === "string" && c.color.startsWith("#"), "cluster has color");
}

// findClosestElevationPoint picks a point near the requested x%.
const mid = findClosestElevationPoint(profile.elevationData, 50);
assert.ok(mid && Math.abs(mid.distancePercent - 50) < 5, "closest point near 50%");

// Degenerate inputs return null (no crash).
assert.equal(buildElevationProfile([]), null, "empty geometry -> null");
assert.equal(buildElevationProfile([{ lat: 1, lng: 1, elevation: 10 }]), null, "single point -> null");
assert.equal(buildElevationProfile([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]), null, "missing elevation -> null");
assert.equal(findClosestElevationPoint([], 50), null, "empty elevationData -> null");

console.log("✅ test-elevation-profile passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-elevation-profile.mjs`
Expected: FAIL — `Cannot find module '.../packages/core/src/ui/elevationProfile.js'`.

- [ ] **Step 3: Create the core module**

Create `packages/core/src/ui/elevationProfile.js`. Move the `buildElevationProfile` and `findClosestElevationPoint` function bodies **verbatim** from `src/components/ElevationProfile.jsx` (currently lines 160-331), with these import lines at the top (the bodies already reference `smoothElevations`, `getDistance`, `pointSmoothedGrades`, `classifyGrade`, `clusterByGrade`, `computeBearing`, `GRADE_COLORS`):

```js
import { smoothElevations } from "../utils/elevations.js";
import { getDistance } from "../utils/distance.js";
import {
  GRADE_COLORS,
  classifyGrade,
  pointSmoothedGrades,
} from "../utils/grade.js";
import { clusterByGrade } from "../utils/slopeClustering.js";
import { computeBearing } from "../domain/routeDirectionAnimator.js";

export function buildElevationProfile(geometry) {
  // ... verbatim body from ElevationProfile.jsx lines 160-319 ...
}

export function findClosestElevationPoint(elevationData, xPercent) {
  // ... verbatim body from ElevationProfile.jsx lines 321-331 ...
}
```

Do not change the bodies — only the import sources. (`smoothElevations`/`getDistance` already came from `@cycleways/core/utils/...`; here they are sibling relative imports inside core.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-elevation-profile.mjs`
Expected: `✅ test-elevation-profile passed`.

- [ ] **Step 5: Refactor web to consume the core module**

In `src/components/ElevationProfile.jsx`:
- Add near the other imports:

```jsx
import { buildElevationProfile, findClosestElevationPoint } from "@cycleways/core/ui/elevationProfile.js";
```

- Delete the local `function buildElevationProfile(geometry) { ... }` (lines ~160-319) and `function findClosestElevationPoint(...) { ... }` (lines ~321-331). Keep `export function formatLegacyDistance(...)` (still imported by `src/App.jsx`). Keep all JSX/animator/hover code unchanged.
- The now-unused imports that moved into core (`smoothElevations`, `getDistance`, `pointSmoothedGrades`, `classifyGrade`, `clusterByGrade`, `computeBearing`) should be removed from `ElevationProfile.jsx` **only if** no remaining code in the file references them. `GRADE_CLASSES`, `GRADE_COLORS`, `GRADE_LABELS_HE` are still used by the JSX legend/tooltip — keep those.

- [ ] **Step 6: Add the new test to the chain**

In `package.json`, in the `test` script, insert ` && node tests/test-elevation-profile.mjs` immediately after `node tests/test-slope-clustering.mjs`.

- [ ] **Step 7: Run the full guard**

Run: `npm test` (all green, including the new test), `npm run build` (succeeds), dev-probe (the web elevation profile still renders on a route — zero behavior change), `npm run test:smoke` (baseline).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(core): extract buildElevationProfile into @cycleways/core; web consumes it"
```

---

## Task 3: Add `react-native-svg` to the mobile app

**Files:**
- Modify: `apps/mobile/package.json` (+ root lockfile)

- [ ] **Step 1: Install the Expo-pinned version**

Run: `cd apps/mobile && npx expo install react-native-svg`
Expected: adds `react-native-svg` at the SDK-56-compatible version to `apps/mobile/package.json` dependencies.

- [ ] **Step 2: Rebuild the dev client (native module)**

`react-native-svg` ships native code, so the existing dev-client build must be rebuilt.
Run (from `apps/mobile`): `npx expo prebuild -p ios` then `npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B`
Expected: app rebuilds and launches on the simulator; existing planner still renders.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json package-lock.json
git commit -m "build(mobile): add react-native-svg for the elevation chart"
```

---

## Task 4: Native elevation chart (static render) + expandable sheet

**Files:**
- Create: `apps/mobile/src/ElevationProfileChart.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx` (`RoutePlannerChrome` sheet: expand state + render chart; new styles)

- [ ] **Step 1: Create the chart component (static first; scrub added in Task 5)**

Create `apps/mobile/src/ElevationProfileChart.jsx`:

```jsx
import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import {
  buildElevationProfile,
  findClosestElevationPoint,
} from "@cycleways/core/ui/elevationProfile.js";
import {
  GRADE_CLASSES,
  GRADE_COLORS,
  GRADE_LABELS_HE,
} from "@cycleways/core/utils/grade.js";

export default function ElevationProfileChart({ geometry, onScrub }) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const [hover, setHover] = useState(null);
  const widthRef = useRef(0);

  const panResponder = useMemo(() => {
    function update(evt) {
      if (!profile) return;
      const width = widthRef.current || 1;
      const xPercent = Math.max(
        0,
        Math.min(100, (evt.nativeEvent.locationX / width) * 100),
      );
      const point = findClosestElevationPoint(profile.elevationData, xPercent);
      if (!point) return;
      setHover(point);
      onScrub?.(point);
    }
    function clear() {
      setHover(null);
      onScrub?.(null);
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: update,
      onPanResponderMove: update,
      onPanResponderRelease: clear,
      onPanResponderTerminate: clear,
    });
  }, [profile, onScrub]);

  if (!profile) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>גרף גובה</Text>
      {hover ? (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>
            📍 מרחק: {(hover.distance / 1000).toFixed(1)} ק"מ • גובה:{" "}
            {Math.round(hover.elevation)} מ׳
          </Text>
          {hover.gradeClass && Number.isFinite(hover.grade) ? (
            <Text
              style={[styles.gradeChip, { color: GRADE_COLORS[hover.gradeClass] }]}
            >
              {GRADE_LABELS_HE[hover.gradeClass]} · {hover.grade.toFixed(1)}%
            </Text>
          ) : null}
        </View>
      ) : null}
      <View
        style={styles.chart}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {profile.clusterPaths.map((cluster, index) => (
            <Path
              key={`${cluster.gradeClass}-${index}`}
              d={cluster.d}
              fill={cluster.color}
              fillOpacity={0.45}
            />
          ))}
          <Path
            d={profile.outlinePath}
            fill="none"
            stroke="#3d3d3d"
            strokeOpacity={0.5}
            strokeWidth={0.4}
          />
          {hover ? (
            <Line
              x1={hover.distancePercent}
              x2={hover.distancePercent}
              y1={0}
              y2={100}
              stroke="#74b8c8"
              strokeOpacity={0.72}
              strokeWidth={0.45}
            />
          ) : null}
        </Svg>
      </View>
      <View style={styles.legend}>
        {GRADE_CLASSES.map((cls) => (
          <View key={cls} style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { backgroundColor: GRADE_COLORS[cls] }]}
            />
            <Text style={styles.legendLabel}>{GRADE_LABELS_HE[cls]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 10 },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1f2a33",
    textAlign: "right",
    marginBottom: 6,
  },
  tooltip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  tooltipText: { fontSize: 12, color: "#1f2a33" },
  gradeChip: { fontSize: 12, fontWeight: "600" },
  chart: {
    height: 120,
    width: "100%",
    backgroundColor: "#f4f6f8",
    borderRadius: 8,
    overflow: "hidden",
  },
  legend: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  legendItem: { flexDirection: "row-reverse", alignItems: "center", gap: 4 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendLabel: { fontSize: 11, color: "#42525d" },
});
```

- [ ] **Step 2: Import the chart and add expand state in `RoutePlannerChrome`**

In `apps/mobile/src/MapScreen.jsx`, add to the imports near the top:

```jsx
import ElevationProfileChart from "./ElevationProfileChart.jsx";
```

In `RoutePlannerChrome` (the function starting at line 492), add a local state near its other hooks:

```jsx
const [sheetExpanded, setSheetExpanded] = useState(false);
```

(Confirm `useState` is already imported in `MapScreen.jsx` — it is.)

- [ ] **Step 3: Add an expand handle + chart to the sheet**

In the sheet header `View style={styles.routeSheetHeader}` (around line 619), add a toggle Pressable after the title (only when there are points). Replace the header block with:

```jsx
<View style={styles.routeSheetHeader}>
  <Text style={styles.routeSheetTitle}>מסלול</Text>
  <View style={styles.routeSheetHeaderActions}>
    {hasPoints ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sheetExpanded ? "הסתר גרף גובה" : "הצג גרף גובה"}
        onPress={() => setSheetExpanded((v) => !v)}
        style={styles.routeSheetBadge}
      >
        <Text style={styles.routeSheetBadgeText}>{sheetExpanded ? "▾ גובה" : "▴ גובה"}</Text>
      </Pressable>
    ) : null}
    {presentation.canDownload ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="סיכום ושיתוף המסלול"
        onPress={onOpenSummary}
        style={styles.routeSheetBadge}
      >
        <Text style={styles.routeSheetBadgeText}>סיכום</Text>
      </Pressable>
    ) : null}
  </View>
</View>
```

Then, immediately after the `statsGrid` block (the `{hasPoints ? (<View style={styles.statsGrid}>...</View>) : null}` ending around line 683), add:

```jsx
{hasPoints && sheetExpanded ? (
  <ElevationProfileChart
    geometry={routeState.geometry}
    onScrub={onScrub}
  />
) : null}
```

Add `onScrub` to the `RoutePlannerChrome` parameter destructuring now and forward it to the chart as shown. It stays `undefined` (so the chart's `onScrub?.(...)` is a no-op) until Task 5 passes `setScrubPoint` from the parent — no other change needed here.

- [ ] **Step 4: Add the new styles**

In the `StyleSheet.create({...})` in `MapScreen.jsx`, add:

```jsx
routeSheetHeaderActions: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
```

- [ ] **Step 5: Verify on the simulator**

Run (from `apps/mobile`): `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-elevation-static` (succeeds), then rebuild/run on the sim. Build a route (two taps on the warning corridor: `74%,50%` then `49%,68%`), tap `▴ גובה`, confirm the grade-colored chart + legend render. Screenshot `/tmp/isravelo-elevation-static.png`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/ElevationProfileChart.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): render native elevation chart in an expandable route sheet"
```

---

## Task 5: Scrub interaction synced to a native map marker

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx` (`MapScreen`: `scrubPoint` state + marker layer; pass `onScrub` to `RoutePlannerChrome`)

The chart already calls `onScrub(point | null)` (Task 4). This task renders the marker.

- [ ] **Step 1: Add `scrubPoint` state + a marker feature in `MapScreen`**

In `MapScreen()` (line 106), near the other `useState`/`useMemo` hooks, add:

```jsx
const [scrubPoint, setScrubPoint] = useState(null);

const scrubMarker = useMemo(() => {
  const coord = scrubPoint?.coord;
  if (!coord || !Number.isFinite(coord.lng) || !Number.isFinite(coord.lat)) {
    return EMPTY_FEATURE_COLLECTION;
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [coord.lng, coord.lat] },
      },
    ],
  };
}, [scrubPoint]);
```

(`EMPTY_FEATURE_COLLECTION` is already defined in this file.)

- [ ] **Step 2: Clear the scrub point when the route is cleared**

Add an effect in `MapScreen` (next to the other effects):

```jsx
useEffect(() => {
  if (!routeState.points || routeState.points.length === 0) {
    setScrubPoint(null);
  }
}, [routeState.points]);
```

- [ ] **Step 3: Render the scrub marker layer**

Immediately after the `search-highlight` `ShapeSource` block (lines 361-370), add:

```jsx
<ShapeSource id="elevation-scrub" shape={scrubMarker}>
  <CircleLayer id="elevation-scrub-core" style={ELEVATION_SCRUB_STYLE} />
</ShapeSource>
```

Add the style constant near the other layer-style constants (e.g. next to `SEARCH_HIGHLIGHT_CORE_STYLE`):

```jsx
const ELEVATION_SCRUB_STYLE = {
  circleRadius: 7,
  circleColor: "#74b8c8",
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
  circlePitchAlignment: "map",
};
```

- [ ] **Step 4: Pass `onScrub` down to the chart**

At the `<RoutePlannerChrome ... />` render site in `MapScreen`, add the prop:

```jsx
onScrub={setScrubPoint}
```

Confirm `RoutePlannerChrome`'s signature destructures `onScrub` (added in Task 4) and forwards it to `<ElevationProfileChart onScrub={onScrub} />`.

- [ ] **Step 5: Verify on the simulator**

Rebuild/run. Build a route, expand `▴ גובה`, drag across the chart: a tooltip
shows distance/elevation/grade and a cyan marker moves along the route on the
map. The marker now persists after finger release so the user can inspect the
map position; it clears when the route is cleared or changed. Screenshot
`/tmp/isravelo-elevation-scrub.png`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): sync elevation scrub to a native map marker"
```

---

## Task 6: iOS smoke flow + full verification + docs

**Files:**
- Create: `apps/mobile/.maestro/elevation-profile-smoke.yaml`
- Modify: `plans/rn-mobile-elevation-profile/implementation-plan.md` (verification notes), `plans/HANDOFF.md`

- [ ] **Step 1: Write the Maestro smoke flow**

Create `apps/mobile/.maestro/elevation-profile-smoke.yaml`.

The committed flow builds the route through search/add instead of fixed map
coordinates. The original coordinate route was camera-fragile once the simulator
state changed; the search route still exercises the chart, tooltip, and synced
marker while remaining independent of current camera position.

```yaml
# Phase 2.9: native elevation profile chart smoke.
# Builds a route via the shared search/add path, expands the sheet, asserts the
# chart + legend, and scrubs it.
appId: app.cycleways.mobile
---
- launchApp
- assertVisible: "חיפוש מיקום"
- waitForAnimationToEnd:
    timeout: 6000

- tapOn: "חיפוש מיקום"
- inputText: "Kfar Blum"
- tapOn: "חיפוש"
- assertVisible: "הוסף"
- tapOn: "הוסף"
- tapOn: "חיפוש מיקום"
- eraseText
- inputText: "HaGoshrim"
- tapOn: "חיפוש"
- assertVisible: "הוסף"
- tapOn: "הוסף"

- tapOn: "הצג גרף גובה"
- assertVisible: "גרף גובה"
- assertVisible: "יציב"      # a grade legend label (GRADE_LABELS_HE.steady)
- takeScreenshot: /tmp/maestro-elevation-chart
# scrub across the chart (swipe within the chart area, mid-sheet)
- swipe:
    start: "30%,88%"
    end: "75%,88%"
- takeScreenshot: /tmp/maestro-elevation-scrub
```

(If the chart's on-screen y-band differs, adjust the swipe `start`/`end` y to sit within the chart; confirm from `/tmp/maestro-elevation-chart.png`.)

- [ ] **Step 2: Run the smoke flow (one Maestro instance only)**

Run: `cd apps/mobile && ~/.maestro/bin/maestro --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B test .maestro/elevation-profile-smoke.yaml`
Expected: all steps COMPLETED; `/tmp/maestro-elevation-chart.png` shows the grade-colored chart + legend; `/tmp/maestro-elevation-scrub.png` shows the tooltip + map marker.

- [ ] **Step 3: Run the full web guard**

Run: `npm test` (green), `npm run build` (succeeds), `npm run test:smoke` (baseline), and `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-elevation` (succeeds).

- [ ] **Step 4: Update docs**

Append a "Verification" section to this plan recording the commands run + screenshots. In `plans/HANDOFF.md` add a Phase 2.9 entry under §4 (native elevation chart DONE + verified) and update §6.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/.maestro/elevation-profile-smoke.yaml plans/
git commit -m "test(mobile): elevation profile iOS smoke + Phase 2.9 docs"
```

---

## Notes & Risks

- **Zero-behavior-change web:** Tasks 1-2 only move/extract pure functions and rewire imports; the web `ElevationProfile.jsx` JSX/animator/hover code is untouched. The existing `test-grade.mjs`/`test-slope-clustering.mjs` plus the new `test-elevation-profile.mjs` guard the move.
- **`react-native-svg` is a native module** — Task 3 must rebuild the dev client, not just reload JS.
- **SVG coordinate parity:** the core builder emits `viewBox 0 0 100 100` paths with y growing downward and higher elevation = smaller y; `react-native-svg` uses the same convention, so `clusterPaths`/`outlinePath` render identically to web.
- **Scrub math:** native uses `locationX` relative to the chart `View` width (captured via `onLayout`), mirroring the web `getBoundingClientRect` ratio.
- **One Maestro instance at a time** — concurrent runners crash the shared XCTest driver.
- `useCyclewaysApp` and all routing/elevation computation are untouched throughout.

## Phase 2.9 Verification

- Native elevation chart renders in the expanded bottom route sheet with shared
  grade colors and Hebrew labels.
- Scrubbing the chart shows the distance/elevation/grade tooltip and a synced
  cyan map marker; the marker persists after release and clears when the route
  changes.
- `apps/mobile/.maestro/elevation-profile-smoke.yaml` now builds a deterministic
  route via search (`Kfar Blum` -> `HaGoshrim`), expands `גרף גובה`, swipes the
  chart, asserts `📍 מרחק.*`, and writes screenshots:
  `/tmp/maestro-elevation-chart.png` and `/tmp/maestro-elevation-scrub.png`.
- Maestro command used in this environment:
  `JAVA_HOME=/Users/ohad/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2/jdk-21.0.9+10/Contents/Home PATH=/Users/ohad/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2/jdk-21.0.9+10/Contents/Home/bin:$PATH /Users/ohad/.maestro/bin/maestro --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B test .maestro/elevation-profile-smoke.yaml`
  passed.
- `npm test` passed, including `tests/test-elevation-profile.mjs`.
- `npm run build` passed.
- `npm run test:smoke` completed at the documented stale baseline:
  **40 passed / 12 failed / 2 skipped**.
- `npx expo export --platform ios --output-dir
  /tmp/isravelo-mobile-export-elevation` passed after running `npm install` to
  materialize the already-locked `react-native-svg@15.15.4` dependency in local
  `node_modules`.
- `git diff --check` passed.
