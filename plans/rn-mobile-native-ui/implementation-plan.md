# Mobile Native UI (Phase 2.8c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the iPhone planner into a CycleWays-branded native UI — a real
draggable bottom sheet, safe-area chrome, Ionicons, floating map controls, and
branded Discover cards — without changing planner behavior.

**Architecture:** Keep the shared `useCyclewaysApp` controller and all 2.8b
behavior; change only the native render layer. Replace the floating card with
`@gorhom/bottom-sheet`, extract `apps/mobile/src/MapScreen.jsx`'s chrome into
focused `apps/mobile/src/planner/*` components, and bundle catalog thumbnails +
`places.json` so Discover looks real. Approach A (map-first single adaptive
sheet) from `design.md`.

**Tech Stack:** Expo SDK 56 / RN 0.85 / React 19, `@rnmapbox/maps`,
`@gorhom/bottom-sheet` (+ `react-native-reanimated` +
`react-native-gesture-handler`), `react-native-safe-area-context`,
`@expo/vector-icons` (Ionicons), `react-native-svg`.

**Verification model (this repo has no RN component-test harness):** pure logic
is tested via the root `npm test` chain (`tests/*.mjs`); native rendering is
verified by `npx expo export --platform ios` (compile) and Maestro flows under
`apps/mobile/.maestro/` on the booted iOS 17.5 iPhone 15 simulator
(UDID `961E0C3E-338F-4311-BD0B-72C2BF47C03B`). Maestro is at
`~/.maestro/bin/maestro` and needs
`JAVA_HOME=/Users/ohad/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2/jdk-21.0.9+10/Contents/Home`.
Run one Maestro instance at a time. Pressable inner-`Text` collapses into the
parent a11y node — target `accessibilityLabel`s in flows.

---

## File Structure

Created:
- `apps/mobile/src/planner/theme.js` — palette + text/spacing tokens.
- `apps/mobile/src/planner/PlannerSheet.jsx` — `@gorhom/bottom-sheet` host +
  Discover/Build segmented control.
- `apps/mobile/src/planner/BuildPanel.jsx` — Build content.
- `apps/mobile/src/planner/DiscoverPanel.jsx` — Discover list.
- `apps/mobile/src/planner/RouteCard.jsx` — one Discover card.
- `apps/mobile/src/planner/TopSearch.jsx` — floating search pill.
- `apps/mobile/src/planner/MapControls.jsx` — locate/fit/layers buttons + legend
  popover.
- `apps/mobile/src/planner/Icon.jsx` — thin Ionicons wrapper.
- `apps/mobile/.maestro/native-ui-smoke.yaml` — updated smoke.

Modified:
- `apps/mobile/package.json`, `apps/mobile/babel.config.js`,
  `apps/mobile/App.js` — deps + providers.
- `apps/mobile/src/MapScreen.jsx` — slimmed to map + sources/layers + sheet host.
- `apps/mobile/scripts/sync-offline-assets.mjs` +
  `packages/core/src/platform/bundledAssets.native.js` +
  `packages/core/src/platform/assets.native.js` — bundle thumbnails + places.
- `packages/core/src/data/catalog.js` — pure thumbnail-path helper (tested).
- `plans/HANDOFF.md`, this plan, `design.md` — status.

---

## Task 0: Baseline commit

**Files:** working tree (2.8b changes from `plans/rn-mobile-web-parity` Phase
2.8b are currently uncommitted).

- [ ] **Step 1: Confirm tests green**

Run: `cd /Users/ohad/projects/isravelo && npm test`
Expected: route-manager suite `Success Rate: 100.0%`.

- [ ] **Step 2: Commit the 2.8b baseline so this phase builds on a clean tree**

```bash
git add apps/mobile/src/MapScreen.jsx apps/mobile/.maestro/discover-build-smoke.yaml \
  plans/rn-mobile-web-parity plans/rn-turn-by-turn-navigation plans/HANDOFF.md \
  plans/rn-mobile-native-ui plans/README.md
git commit -m "feat(mobile): 2.8b front-panel Discover/Build parity + 2.8c plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: one commit on `codex/iphone-turn-by-turn`.

---

## Task 1: Add native UI deps + boot an empty sheet (RISK SLICE)

Front-loads the classic RN native-build snag points. If this slice cannot be
made to build, switch to the lightweight-libs fallback (see `design.md`) before
investing in UI.

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/babel.config.js`
- Modify: `apps/mobile/App.js`
- Modify: `apps/mobile/src/MapScreen.jsx` (temporary smoke sheet)

- [ ] **Step 1: Install the dependencies (Expo-pinned versions)**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile
npx expo install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context @gorhom/bottom-sheet @expo/vector-icons
```

Expected: versions written to `package.json` compatible with SDK 56.

- [ ] **Step 2: Enable the reanimated babel plugin**

Edit `apps/mobile/babel.config.js` so the plugin is LAST in `plugins`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"],
  };
};
```

(If `babel.config.js` already has plugins, append `react-native-reanimated/plugin`
as the final entry — it must be last.)

- [ ] **Step 3: Wrap the app in the required providers**

In `apps/mobile/App.js`, wrap the rendered tree (the `MapScreen` return path)
with, outermost-first: `GestureHandlerRootView` (style `{ flex: 1 }`) →
`SafeAreaProvider` → `BottomSheetModalProvider`. Imports:

```jsx
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
```

Keep the existing `SafeAreaView`/launch logic for now; only add the providers
around the output.

- [ ] **Step 4: Drop a throwaway bottom sheet into MapScreen**

Temporarily render, just above the closing tag of the root `View` in
`apps/mobile/src/MapScreen.jsx`:

```jsx
<BottomSheet snapPoints={["18%", "92%"]} index={0}>
  <BottomSheetView>
    <Text accessibilityLabel="sheet-boot-probe" style={{ padding: 16 }}>
      sheet-boot-probe
    </Text>
  </BottomSheetView>
</BottomSheet>
```

with `import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";`.

- [ ] **Step 5: Native rebuild + run on the simulator**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile
npx expo prebuild -p ios
xcrun simctl boot 961E0C3E-338F-4311-BD0B-72C2BF47C03B || true
npm run ios -- --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B
```

Expected: `Build Succeeded`, app installs, Metro serves, no redbox.

- [ ] **Step 6: Verify the sheet renders and drags**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile
export JAVA_HOME=/Users/ohad/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2/jdk-21.0.9+10/Contents/Home
~/.maestro/bin/maestro --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B test - <<'YAML'
appId: app.cycleways.mobile
---
- assertVisible: "sheet-boot-probe"
- swipe: { direction: UP }
- takeScreenshot: /tmp/native-ui-sheet-boot
YAML
```

Expected: flow passes; screenshot shows the sheet expanded.

**DECISION GATE:** if Steps 5-6 cannot be made to pass in a reasonable effort
(reanimated/gesture-handler/bottom-sheet build or runtime errors), stop and
switch this phase to the lightweight-libs fallback (`design.md`): keep
`react-native-safe-area-context` + `@expo/vector-icons`, drop the gorhom/
reanimated deps, and implement `PlannerSheet` (Task 3) as an `Animated` +
`PanResponder` sheet with the same snap points. Record the decision in the plan.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json \
  apps/mobile/babel.config.js apps/mobile/App.js apps/mobile/src/MapScreen.jsx \
  apps/mobile/ios apps/mobile/app.json
git commit -m "build(mobile): add bottom-sheet/reanimated/safe-area/icons; boot sheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Theme tokens + Icon wrapper

**Files:**
- Create: `apps/mobile/src/planner/theme.js`
- Create: `apps/mobile/src/planner/Icon.jsx`

- [ ] **Step 1: Create the palette/token module**

`apps/mobile/src/planner/theme.js`:

```js
// Single source of truth for the CycleWays-branded native palette + tokens.
// Mirrors the web CSS brand colors (see plans/rn-mobile-native-ui/design.md).
export const palette = {
  forest: "#2f6b3c",
  forestDk: "#245943",
  ink: "#172026",
  muted: "#52615c",
  cream: "#efe8d7",
  cream2: "#e7dfca",
  paper: "#f8fbfa",
  line: "#c6d4cf",
  accent: "#f97316",
  teal: "#2c5f7a",
  danger: "#991b1b",
  white: "#ffffff",
};

export const radius = { sm: 9, md: 13, lg: 18, pill: 21 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16 };
```

- [ ] **Step 2: Create the Ionicons wrapper**

`apps/mobile/src/planner/Icon.jsx`:

```jsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { palette } from "./theme.js";

// Thin wrapper so the rest of the app references Ionicons by the same names the
// web Icon.jsx uses (search-outline, arrow-undo-outline, ...).
export default function Icon({ name, size = 20, color = palette.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-theme`
Expected: `Exported:` line, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/theme.js apps/mobile/src/planner/Icon.jsx
git commit -m "feat(mobile): native theme tokens + Ionicons wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: PlannerSheet host + segmented control

Move the bottom-sheet container and the Discover/Build toggle out of
`MapScreen`'s `RoutePlannerChrome` into a real gorhom sheet. Keep the EXISTING
Build/Discover content components from 2.8b for now (rehouse, don't restyle yet)
so this task isolates the sheet swap.

**Files:**
- Create: `apps/mobile/src/planner/PlannerSheet.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx`

- [ ] **Step 1: Create PlannerSheet**

`apps/mobile/src/planner/PlannerSheet.jsx` — a `BottomSheet` with
`snapPoints={["16%", "48%", "92%"]}`, `index={1}`, a `handleIndicatorStyle`
grabber, `backgroundStyle` using `palette.paper`. Render a header with the
segmented control (the `PanelStateToggle` from 2.8b, moved here verbatim) and a
`BottomSheetScrollView` body that shows `discover` or `build` children via props:

```jsx
import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useMemo, useRef } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { palette, radius } from "./theme.js";

export default function PlannerSheet({ panelState, onPanelStateChange, discover, build }) {
  const ref = useRef(null);
  const snapPoints = useMemo(() => ["16%", "48%", "92%"], []);
  return (
    <BottomSheet
      ref={ref}
      index={1}
      snapPoints={snapPoints}
      handleIndicatorStyle={styles.grab}
      backgroundStyle={styles.bg}
    >
      <View style={styles.head}>
        <SegToggle state={panelState} onChange={onPanelStateChange} />
      </View>
      <BottomSheetScrollView contentContainerStyle={styles.body}>
        {panelState === "discover" ? discover : build}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
```

Move the `PanelStateToggle` JSX from `MapScreen.jsx` into a local `SegToggle`
here (labels `חפש מסלול` / `בניית מסלול`, a11y labels preserved), styled with
`palette.cream`/`palette.white`. `styles.grab` = `{ backgroundColor: palette.line, width: 38 }`,
`styles.bg` = `{ backgroundColor: palette.paper }`.

- [ ] **Step 2: Mount PlannerSheet in MapScreen, remove the old bottom card**

In `apps/mobile/src/MapScreen.jsx`: delete the throwaway probe sheet (Task 1
Step 4) and the `bottomSheetWrap`/front-panel block inside `RoutePlannerChrome`;
render `<PlannerSheet panelState={panelState} onPanelStateChange={setPanelState}
discover={<DiscoverPanelContent .../>} build={<BuildPanelContent .../>} />` at
the `MapScreen` root level (sibling of the map). Keep passing the same props the
2.8b `DiscoverPanelContent` / `BuildPanelContent` already take. Keep
`RoutePlannerChrome` only for the top search row for now.

- [ ] **Step 3: Compile + behavior check**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-sheet
```
Expected: clean export.

Then run the existing flow against a fresh `run:ios` build (sheet now draggable):

```bash
export JAVA_HOME=/Users/ohad/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2/jdk-21.0.9+10/Contents/Home
~/.maestro/bin/maestro --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B test .maestro/discover-build-smoke.yaml
```
Expected: passes (toggle + catalog select + clear still work inside the sheet).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/PlannerSheet.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): real draggable bottom sheet hosts Discover/Build

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Replace SVG glyphs with Ionicons

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx` (and the planner components that draw
  icons)

- [ ] **Step 1: Swap the tool-row + search glyphs**

Replace `ChromeIcon`/SVG usages in the undo/redo/clear tool row and the search
button with `<Icon name="arrow-undo-outline" />`, `arrow-redo-outline`,
`trash-outline`, `search-outline` (sizes ~20). Use `palette.muted` for disabled,
`palette.forestDk` for active.

- [ ] **Step 2: Delete the dead `ChromeIcon` SVG component**

Remove the `ChromeIcon` function and the `Svg`/`Path` import if now unused in
`MapScreen.jsx`.

- [ ] **Step 3: Compile + screenshot**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-icons
```
Expected: clean export. Then on a `run:ios` build, `xcrun simctl io <UDID>
screenshot /tmp/native-ui-icons.png` and confirm Ionicons render.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): use Ionicons for planner controls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: TopSearch pill + safe-area chrome

**Files:**
- Create: `apps/mobile/src/planner/TopSearch.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx`

- [ ] **Step 1: Build the search pill**

`apps/mobile/src/planner/TopSearch.jsx` — a rounded pill (`radius.pill`,
`palette.white` 0.94, shadow) positioned with `useSafeAreaInsets().top`. Props:
`query`, `onChange`, `onSubmit`, `busy`, `error`. Collapsed shows a search icon +
placeholder `חיפוש יישוב/עיר`; on focus shows the `TextInput` (RTL, the same
shared handlers). Below the pill, render `error` as a small card when present.

- [ ] **Step 2: Replace the old top chrome**

In `MapScreen.jsx`, remove `RoutePlannerChrome`'s `topChrome` search block and
render `<TopSearch ... />` directly, wired to `handleSearchQueryChange`,
`submitSearch`, `mapUi.searchQuery`, `mapUi.searchStatus`, `mapUi.searchError`.
`RoutePlannerChrome` can now be deleted entirely (its remaining job is gone).

- [ ] **Step 3: Compile + Maestro search check**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-search
```
Then on `run:ios`, drive: tap `חיפוש יישוב/עיר` → input `Kfar Blum` → tap search
icon (a11y `חיפוש`) → assert `הוסף` appears. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/TopSearch.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): native floating search pill with safe-area chrome

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: MapControls — locate / fit / layers + legend popover

**Files:**
- Create: `apps/mobile/src/planner/MapControls.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx`

- [ ] **Step 1: Build the control cluster**

`apps/mobile/src/planner/MapControls.jsx` — a column of circular buttons
(bottom-right, offset above the sheet peek + bottom safe-area inset):
`locate-outline` (active/`stop` state when following), `scan-outline` (fit), and
`layers-outline` (toggles a small legend popover listing paved/dirt/road
swatches — the labels/colors from the current `MapLegendOverlay`). Props:
`onLocate`, `onFit`, `following`, plus the legend data. Move the broken-route /
warning chips OUT of the map legend and into the Build panel (Task 7).

- [ ] **Step 2: Wire the orphaned handlers**

In `MapScreen.jsx`, render `<MapControls onLocate={handleLocatePress}
onFit={fitRoute} following={locationState.following} />` and delete the old
`MapLegendOverlay` map-corner box (its legend now lives in the popover; its
warning chips move to Build).

- [ ] **Step 3: Compile + Maestro locate/fit check**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-controls
```
Then on `run:ios`: tap a11y `מיקום נוכחי` (locate) → assert follow/stop state;
tap `התאם מסלול` (fit). Expected: pass; screenshot `/tmp/native-ui-controls.png`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/MapControls.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): floating locate/fit/layers map controls + legend popover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: BuildPanel restyle

**Files:**
- Create: `apps/mobile/src/planner/BuildPanel.jsx` (move 2.8b `BuildPanelContent`
  here and restyle)
- Modify: `apps/mobile/src/MapScreen.jsx`

- [ ] **Step 1: Move + restyle**

Move `BuildPanelContent` into `apps/mobile/src/planner/BuildPanel.jsx`. Restyle
with `theme.js`: branded eyebrow (`palette.forest`), title (`palette.ink`),
Ionicons tool row, `cream` **stat tiles** (distance, ↑, ↓, segments, points),
route status text, **warning rows** (moved here from the map legend, using the
existing `getRouteWarningPresentation` groups with colors/icons), the elevation
chart, and a footer with `summary` + `share` (Ionicons + forest primary).

- [ ] **Step 2: Compile + screenshot parity check**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-build
```
On `run:ios`: load catalog route `בניאס וגן הצפון`, screenshot
`/tmp/native-ui-build.png`; confirm eyebrow/title/stat tiles/elevation/warnings
render in brand colors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/planner/BuildPanel.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): branded native Build panel (stat tiles, warnings, footer)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Bundle catalog thumbnails + places.json

**Files:**
- Modify: `apps/mobile/scripts/sync-offline-assets.mjs`
- Modify (generated): `packages/core/src/platform/bundledAssets.native.js`
- Modify: `packages/core/src/platform/assets.native.js`
- Modify: `packages/core/src/data/catalog.js`
- Create: `tests/test-catalog-thumbnail.mjs`

- [ ] **Step 1: Add a pure thumbnail-path helper + failing test**

In `packages/core/src/data/catalog.js` add:

```js
// Returns the bundled thumbnail asset path for a catalog entry, or null.
export function routeThumbnailPath(entry) {
  const t = entry?.heroImage?.thumbnail || entry?.heroImage?.photo;
  return typeof t === "string" && t.length > 0 ? t : null;
}
```

`tests/test-catalog-thumbnail.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { routeThumbnailPath } from "../packages/core/src/data/catalog.js";

test("routeThumbnailPath prefers thumbnail", () => {
  assert.equal(
    routeThumbnailPath({ heroImage: { thumbnail: "a.webp", photo: "b.webp" } }),
    "a.webp",
  );
});
test("routeThumbnailPath null when absent", () => {
  assert.equal(routeThumbnailPath({}), null);
});
```

- [ ] **Step 2: Run the test — expect FAIL then PASS**

Run: `cd /Users/ohad/projects/isravelo && node --test tests/test-catalog-thumbnail.mjs`
Expected: PASS after the helper exists (add the file to the `npm test` chain if
that chain enumerates `tests/*.mjs` explicitly — check `package.json`).

- [ ] **Step 3: Extend the asset sync to copy thumbnails + places.json**

In `apps/mobile/scripts/sync-offline-assets.mjs`, add `public-data/places.json`
(if present at repo root `public-data/`) and the 8 catalog
`heroImage.thumbnail` webp files (read from `public-data/route-catalog.json`) to
the copy + generated require lists. Regenerate `bundledAssets.native.js`:

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npm run assets:sync
```
Expected: `JSON_ASSETS` gains `places.json`; a new `IMAGE_ASSETS` map holds the
thumbnail `require()`s.

- [ ] **Step 4: Add a native image resolver**

In `packages/core/src/platform/assets.native.js` add `getImageAsset(path)`
returning the bundled `require` module id from `IMAGE_ASSETS` (or `null`). Add a
web no-op `getImageAsset` in `assets.js` that returns `{ uri: routeImageSrc(path) }`
shape so callers are uniform.

- [ ] **Step 5: Verify export bundles the images**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-assets 2>&1 | grep -c "poi-images"
```
Expected: non-zero (thumbnails bundled).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/scripts/sync-offline-assets.mjs \
  packages/core/src/platform/bundledAssets.native.js \
  packages/core/src/platform/assets.native.js packages/core/src/platform/assets.js \
  packages/core/src/data/catalog.js tests/test-catalog-thumbnail.mjs \
  apps/mobile/assets/data/public-data
git commit -m "feat(mobile): bundle catalog thumbnails + places.json for Discover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: DiscoverPanel + RouteCard restyle

**Files:**
- Create: `apps/mobile/src/planner/DiscoverPanel.jsx`,
  `apps/mobile/src/planner/RouteCard.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx`

- [ ] **Step 1: Build the branded card**

`RouteCard.jsx` — row layout: `Image` thumbnail (`getImageAsset(routeThumbnailPath(entry))`,
rounded, fallback forest gradient `View`), title, a difficulty **chip**
(`routeDifficultyLabel`, color by difficulty: easy=forest, medium=accent,
hard=danger), and a meta line `distance · shape · via place`
(`places` lookup for `passesNear`). Keep the card `accessibilityLabel`
`פתח את ${name} במפה`.

- [ ] **Step 2: Build the list + near-me**

`DiscoverPanel.jsx` — load `places.json` via `getJsonAsset`, render cards.
When `mapUi.locationFix` exists, order with
`sortByDistanceFromUser(entries, placeById, fix)` and show
`formatDistanceFromUser(...)` on each card; otherwise catalog order.

- [ ] **Step 3: Wire into the sheet**

In `MapScreen.jsx`, pass `<DiscoverPanel .../>` as the sheet's `discover` child;
remove the inline 2.8b `DiscoverPanelContent`/`PanelRouteCardNative`.

- [ ] **Step 4: Compile + Maestro Discover check**

```bash
cd /Users/ohad/projects/isravelo/apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-discover
```
On `run:ios`: open Discover, screenshot `/tmp/native-ui-discover.png` (cards show
thumbnails + chips), tap `פתח את בניאס וגן הצפון במפה`, assert Build loads.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/planner/DiscoverPanel.jsx apps/mobile/src/planner/RouteCard.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): branded Discover cards with thumbnails, chips, near-me

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Full smoke + docs

**Files:**
- Create: `apps/mobile/.maestro/native-ui-smoke.yaml`
- Modify: `plans/HANDOFF.md`, `plans/rn-mobile-native-ui/*`

- [ ] **Step 1: Write the end-to-end smoke**

`apps/mobile/.maestro/native-ui-smoke.yaml`: assert search pill + segmented
control render; drag sheet up (`swipe UP`); Discover → assert a card a11y label
→ select → Build eyebrow `מסלול מומלץ` + stat (`נקודות`) → tap locate
(`מיקום נוכחי`) → tap fit (`התאם מסלול`) → clear (`איפוס מסלול`) →
assert `המסלול שלי · טיוטה`. Screenshots at each step.

- [ ] **Step 2: Run the full chain**

```bash
cd /Users/ohad/projects/isravelo && npm test
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/cw-x-final
export JAVA_HOME=/Users/ohad/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2/jdk-21.0.9+10/Contents/Home
~/.maestro/bin/maestro --device 961E0C3E-338F-4311-BD0B-72C2BF47C03B test .maestro/native-ui-smoke.yaml
```
Expected: `npm test` green; export clean; smoke passes end-to-end.

- [ ] **Step 3: Update docs**

Mark this plan's tasks done; add a "Phase 2.8c DONE + VERIFIED" entry to
`plans/HANDOFF.md` §6 with the screenshot paths and any deferred follow-ups.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/.maestro/native-ui-smoke.yaml plans/HANDOFF.md plans/rn-mobile-native-ui
git commit -m "test(mobile): native-UI end-to-end smoke; Phase 2.8c docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** sheet overhaul (Tasks 1,3), top overlays + safe area
  (Task 5), map controls + legend popover (Task 6), Build polish (Tasks 4,7),
  Discover polish + thumbnails + places + near-me (Tasks 8,9), brand palette
  (Task 2 + throughout), testing (Task 10). All design sections map to a task.
- **Risk:** Task 1 is the explicit gate with a documented fallback.
- **Behavior preserved:** every native task re-verifies the existing
  Discover→Build→clear flow via Maestro, never changing `useCyclewaysApp`.
- **Naming consistency:** `getImageAsset` / `routeThumbnailPath` /
  `PlannerSheet` / `MapControls` / `TopSearch` used consistently across tasks.
