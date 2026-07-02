# iPhone App Discovery & Detail Flow — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iPhone app's single-`MapScreen` model with a `react-navigation` screen stack and a map-free discovery front page, so the map only mounts when the user explicitly opens route building/editing.

**Architecture:** Introduce `@react-navigation/native` + native-stack with two screens this phase: `Discover` (initial, no map) and `Build` (today's `MapScreen` UI, refactored to drop its in-sheet Discover panel and to load a route from navigation params). `App.js` becomes a thin host: it resolves the launch deep link to an initial route and renders the navigator. Cold-start deep links keep working through the existing seeded-href path; in-app selection drives `Build` via nav params and resets the href so no stale route auto-loads.

**Tech Stack:** React Native / Expo (SDK 56, RN 0.85), `@react-navigation/native` + `@react-navigation/native-stack`, `react-native-screens`, `@rnmapbox/maps`, shared `@cycleways/core`. Tests are plain Node scripts under `tests/` run via `node tests/test-*.mjs` (there is no RN component test harness; RN screens are verified manually on device/simulator, matching the repo's established practice).

## Global Constraints

- Map data and `public-data/` are editor/pipeline-owned — do not hand-edit them. This phase touches none of them.
- All planning docs live under `plans/<topic>/`. This plan is `plans/app-discovery-detail-flow/`.
- RTL: all user-facing copy is Hebrew; text styles use `textAlign: "right"` + `writingDirection: "rtl"` as the existing components do.
- Pure logic that can be tested goes in a `tests/test-*.mjs` Node script using `node:assert/strict`, following `tests/test-native-location.mjs` as the template; register every new test in the root `package.json` `test` script.
- Do not change turn-by-turn navigation behavior — it stays a sub-mode inside `Build`.
- Phase A keeps the discovery cards close to the existing `RouteCard`; rich media cards are Phase B.
- Deep links (`cycleways://routes/:slug`, `cycleways://featured/:slug`) must still open the linked route on cold start. Phase A opens them into `Build`; repointing to `RouteDetail` is Phase C.

---

## File Structure (Phase A)

- Create `apps/mobile/src/navigation/launchTarget.js` — pure: map a launch href to `{ screen, params }`.
- Create `tests/test-app-launch-target.mjs` — tests for `launchTarget.js`.
- Create `packages/core/src/data/catalogSearch.js` — pure: filter catalog entries by a free-text query over name + nearby-place names.
- Create `tests/test-catalog-search.mjs` — tests for `catalogSearch.js`.
- Create `apps/mobile/src/navigation/RootNavigator.jsx` — `NavigationContainer` + native stack (`Discover`, `Build`) + a navigation ref for warm deep links.
- Create `apps/mobile/src/screens/DiscoverScreen.jsx` — full-screen map-free discovery (header + search + collapsible filters + list + FAB).
- Rename `apps/mobile/src/MapScreen.jsx` → `apps/mobile/src/screens/BuildScreen.jsx` and refactor (drop Discover branch/toggle, load route from params).
- Modify `apps/mobile/src/planner/PlannerSheet.jsx` — build-only (remove the Discover/Build segmented toggle).
- Modify `apps/mobile/src/planner/DiscoverPanel.jsx` — add collapsible filters + a search box driven by `catalogSearch.js`; `onSelect` stays the route-chosen callback.
- Rewrite `apps/mobile/App.js` — host `RootNavigator`, resolve the launch URL to an initial route, keep the launch-error overlay, route warm links through the nav ref.

---

### Task 1: Install navigation dependencies

**Files:**
- Modify: `apps/mobile/package.json` (via installer)

**Interfaces:**
- Produces: the `@react-navigation/native`, `@react-navigation/native-stack`, and `react-native-screens` modules available to import in later tasks.

- [ ] **Step 1: Install the navigation packages with Expo's version resolver**

Run (from `apps/mobile`):

```bash
cd apps/mobile && npx expo install @react-navigation/native @react-navigation/native-stack react-native-screens
```

`react-native-safe-area-context` is already a dependency — do not reinstall it.

- [ ] **Step 2: Verify the packages resolved**

Run:

```bash
cd apps/mobile && node -e "require.resolve('@react-navigation/native'); require.resolve('@react-navigation/native-stack'); require.resolve('react-native-screens'); console.log('ok')"
```

Expected: prints `ok`.

- [ ] **Step 3: Rebuild the native dev client (react-native-screens is a native module)**

Run:

```bash
cd apps/mobile && npm run ios
```

Expected: the app builds and launches in the simulator showing the current map screen (no behavior change yet).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json package-lock.json
git commit -m "build(mobile): add react-navigation + native-stack deps"
```

---

### Task 2: Launch-target mapper (pure)

Maps a deep-link / launch href to the initial navigation target so `App.js` can pick the first screen deterministically and a test can lock the behavior.

**Files:**
- Create: `apps/mobile/src/navigation/launchTarget.js`
- Test: `tests/test-app-launch-target.mjs`
- Modify: `package.json` (register the test)

**Interfaces:**
- Consumes: `getNativeRoutePath(href)` from `@cycleways/core/platform/location.native.js` (returns `{ collection, slug } | null`).
- Produces: `launchTargetFromHref(href) -> { screen: "Discover" | "Build", params: object | undefined }`. For a `routes`/`featured` slug it returns `{ screen: "Build", params: { slug } }`; otherwise `{ screen: "Discover", params: undefined }`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-app-launch-target.mjs`:

```javascript
import assert from "node:assert/strict";
import { launchTargetFromHref } from "../apps/mobile/src/navigation/launchTarget.js";

// A bare launch (no route) opens Discover.
assert.deepEqual(launchTargetFromHref("cycleways:///"), {
  screen: "Discover",
  params: undefined,
});
assert.deepEqual(launchTargetFromHref(null), {
  screen: "Discover",
  params: undefined,
});

// A routes/<slug> deep link opens Build with the slug.
assert.deepEqual(
  launchTargetFromHref("cycleways:///routes/sovev-beit-hillel"),
  { screen: "Build", params: { slug: "sovev-beit-hillel" } },
);

// A featured/<slug> deep link also opens Build with the slug.
assert.deepEqual(
  launchTargetFromHref("cycleways:///featured/banias-gan-hatsafon"),
  { screen: "Build", params: { slug: "banias-gan-hatsafon" } },
);

console.log("test-app-launch-target: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node tests/test-app-launch-target.mjs
```

Expected: FAIL with `Cannot find module '.../apps/mobile/src/navigation/launchTarget.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/navigation/launchTarget.js`:

```javascript
import { getNativeRoutePath } from "@cycleways/core/platform/location.native.js";

// Maps a launch / deep-link href to the initial navigation target. Catalog
// route links (routes/<slug>, featured/<slug>) open the Build screen with the
// slug; everything else opens the Discover front page.
export function launchTargetFromHref(href) {
  const routePath = getNativeRoutePath(href);
  if (routePath?.slug) {
    return { screen: "Build", params: { slug: routePath.slug } };
  }
  return { screen: "Discover", params: undefined };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node tests/test-app-launch-target.mjs
```

Expected: prints `test-app-launch-target: ok`.

- [ ] **Step 5: Register the test in the root test script**

In `package.json`, in the `"test"` script string, add ` && node tests/test-app-launch-target.mjs` immediately after `node tests/test-native-location.mjs`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/navigation/launchTarget.js tests/test-app-launch-target.mjs package.json
git commit -m "feat(mobile): launch-target mapper for nav stack"
```

---

### Task 3: Catalog free-text search filter (pure, in core)

The Discover front page gets a search box that filters the catalog by route name and nearby-place names. The filter is pure so it lives in core and is unit-tested.

**Files:**
- Create: `packages/core/src/data/catalogSearch.js`
- Test: `tests/test-catalog-search.mjs`
- Modify: `package.json` (register the test)

**Interfaces:**
- Produces: `filterCatalogBySearch(entries, query, placeById) -> entries[]`. `entries` is the catalog array; `query` is the raw search string; `placeById` is a `Map<id, place>` (place has `.name`). Empty/whitespace query returns `entries` unchanged. Matching is case-insensitive substring over `entry.name` and the names of `entry.passesNear` places resolved through `placeById`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-catalog-search.mjs`:

```javascript
import assert from "node:assert/strict";
import { filterCatalogBySearch } from "../packages/core/src/data/catalogSearch.js";

const entries = [
  { slug: "a", name: "סובב בית הלל", passesNear: ["beit-hillel"] },
  { slug: "b", name: "מסלול הבניאס", passesNear: ["banias"] },
  { slug: "c", name: "רכיבה בעמק", passesNear: ["beit-hillel", "shdeh"] },
];
const placeById = new Map([
  ["beit-hillel", { id: "beit-hillel", name: "בית הלל" }],
  ["banias", { id: "banias", name: "בניאס" }],
  ["shdeh", { id: "shdeh", name: "שדה נחמיה" }],
]);

// Empty query returns everything unchanged.
assert.equal(filterCatalogBySearch(entries, "", placeById).length, 3);
assert.equal(filterCatalogBySearch(entries, "   ", placeById).length, 3);

// Match by route name.
let r = filterCatalogBySearch(entries, "בניאס", placeById);
assert.deepEqual(r.map((e) => e.slug), ["b"]);

// Match by nearby-place name (matches the route even though its name lacks it).
r = filterCatalogBySearch(entries, "בית הלל", placeById);
assert.deepEqual(r.map((e) => e.slug).sort(), ["a", "c"]);

// Case-insensitive over latin too.
const latin = [{ slug: "x", name: "Hula Loop", passesNear: [] }];
assert.equal(filterCatalogBySearch(latin, "hula", new Map()).length, 1);

console.log("test-catalog-search: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node tests/test-catalog-search.mjs
```

Expected: FAIL with `Cannot find module '.../packages/core/src/data/catalogSearch.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/data/catalogSearch.js`:

```javascript
// Free-text catalog filter for the discovery list: case-insensitive substring
// over the route name and the names of the route's nearby places. An empty
// query returns the input array unchanged.
export function filterCatalogBySearch(entries, query, placeById) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return entries;
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((entry) => {
    const haystacks = [entry?.name];
    for (const id of entry?.passesNear || []) {
      const place = placeById?.get?.(id);
      if (place?.name) haystacks.push(place.name);
    }
    return haystacks.some(
      (text) => typeof text === "string" && text.toLowerCase().includes(needle),
    );
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node tests/test-catalog-search.mjs
```

Expected: prints `test-catalog-search: ok`.

- [ ] **Step 5: Register the test in the root test script**

In `package.json`, in the `"test"` script, add ` && node tests/test-catalog-search.mjs` immediately after `node tests/test-catalog-filter.mjs`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/data/catalogSearch.js tests/test-catalog-search.mjs package.json
git commit -m "feat(core): free-text catalog search filter"
```

---

### Task 4: Root navigator + App.js host (with temporary screens)

Stand up the stack end-to-end with placeholder screens so navigation, deep-link resolution, and the launch-error overlay all work before the real screens land. Tasks 5 and 6 replace the placeholders.

**Files:**
- Create: `apps/mobile/src/navigation/RootNavigator.jsx`
- Rewrite: `apps/mobile/App.js`

**Interfaces:**
- Consumes: `launchTargetFromHref` (Task 2); existing `resolveNativeLaunchUrl` logic moved out of `App.js`; `setNativeLocationHref`, `createNativeRouteHref`, `getNativeRoutePath`, `findRouteCatalogEntryBySlug`, `loadRouteCatalogEntries` from core.
- Produces: `RootNavigator({ initialRouteName, initialParams, navigationRef })` rendering a native stack with route names `"Discover"` and `"Build"`; a `navigationRef` (from `createNavigationContainerRef`) other code can use to navigate on warm deep links.

- [ ] **Step 1: Create the navigator with temporary placeholder screens**

Create `apps/mobile/src/navigation/RootNavigator.jsx`:

```jsx
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";

const Stack = createNativeStackNavigator();

// Temporary placeholders — replaced by DiscoverScreen (Task 6) and
// BuildScreen (Task 5). They exist so the stack, deep links, and back
// navigation can be verified now.
function DiscoverPlaceholder({ navigation }) {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>Discover (placeholder)</Text>
      <Pressable
        style={styles.btn}
        onPress={() => navigation.navigate("Build", {})}
      >
        <Text style={styles.btnText}>תכנן מסלול</Text>
      </Pressable>
    </View>
  );
}

function BuildPlaceholder({ route }) {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>
        Build (placeholder){"\n"}slug: {route?.params?.slug ?? "—"}
      </Text>
    </View>
  );
}

export default function RootNavigator({
  initialRouteName = "Discover",
  initialParams,
  navigationRef,
}) {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Discover" component={DiscoverPlaceholder} />
        <Stack.Screen
          name="Build"
          component={BuildPlaceholder}
          initialParams={initialRouteName === "Build" ? initialParams : undefined}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  text: { fontSize: 16, textAlign: "center" },
  btn: {
    backgroundColor: "#1e668c",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
```

- [ ] **Step 2: Rewrite App.js to host the navigator and resolve the launch URL**

Replace the entire contents of `apps/mobile/App.js` with:

```jsx
import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Linking, LogBox, Pressable, StyleSheet, Text, View } from "react-native";
import { createNavigationContainerRef } from "@react-navigation/native";
import {
  createNativeRouteHref,
  getNativeRoutePath,
  setNativeLocationHref,
} from "@cycleways/core/platform/location.native.js";
import {
  findRouteCatalogEntryBySlug,
  loadRouteCatalogEntries,
} from "@cycleways/core/data/catalog.js";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import RootNavigator from "./src/navigation/RootNavigator.jsx";
import { launchTargetFromHref } from "./src/navigation/launchTarget.js";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Invalid size is used for setting the map view",
]);

const navigationRef = createNavigationContainerRef();

export default function App() {
  const [ready, setReady] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const initialTargetRef = useRef({ screen: "Discover", params: undefined });

  useEffect(() => {
    let mounted = true;
    let launchRequestId = 0;

    async function applyLaunchUrl(url, { warm = false } = {}) {
      const requestId = ++launchRequestId;
      const result = await resolveNativeLaunchUrl(url);
      if (!mounted || requestId !== launchRequestId) return;
      setLaunchError(result.error);
      if (!result.error) {
        const target = launchTargetFromHref(url);
        if (warm) {
          // App already running: navigate imperatively.
          if (navigationRef.isReady() && target.screen === "Build") {
            navigationRef.navigate("Build", target.params);
          }
        } else {
          initialTargetRef.current = target;
        }
      }
      setReady(true);
    }

    Linking.getInitialURL()
      .then((url) => applyLaunchUrl(url))
      .catch((error) => {
        setNativeLocationHref(null);
        console.warn("Native initial route link failed:", error);
        if (mounted) setReady(true);
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyLaunchUrl(url, { warm: true });
    });

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <View style={styles.fill}>
            {ready ? (
              <RootNavigator
                initialRouteName={initialTargetRef.current.screen}
                initialParams={initialTargetRef.current.params}
                navigationRef={navigationRef}
              />
            ) : null}
            {launchError ? (
              <LaunchErrorOverlay
                message={launchError.message}
                onDismiss={() => setLaunchError(null)}
              />
            ) : null}
            <StatusBar style="auto" />
          </View>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Validates a launch URL: a catalog route link is looked up and its encoded
// route token seeded into the native href so the controller cold-loads it; a
// non-route link is passed through. Returns a launch error when the slug is
// unknown.
async function resolveNativeLaunchUrl(url) {
  const routePath = getNativeRoutePath(url);
  if (!routePath) {
    setNativeLocationHref(url);
    return { error: null };
  }
  try {
    const entries = await loadRouteCatalogEntries();
    const entry = findRouteCatalogEntryBySlug({ entries }, routePath.slug);
    if (!entry?.route) {
      return { error: { message: `לא נמצא מסלול בשם ${routePath.slug}` } };
    }
    setNativeLocationHref(
      createNativeRouteHref(entry.route, {
        source: "catalog",
        collection: routePath.collection,
        slug: entry.slug,
        name: entry.name,
      }),
    );
    return { error: null };
  } catch (error) {
    console.warn("Native route catalog link failed:", error);
    return { error: { message: "לא הצלחנו לפתוח את המסלול מהקטלוג" } };
  }
}

function LaunchErrorOverlay({ message, onDismiss }) {
  return (
    <View pointerEvents="box-none" style={styles.errorOverlay}>
      <View style={styles.errorPanel}>
        <Text style={styles.errorTitle}>קישור למסלול לא נפתח</Text>
        <Text style={styles.errorText}>{message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="סגור"
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.errorButton,
            pressed ? styles.errorButtonPressed : null,
          ]}
        >
          <Text style={styles.errorButtonText}>סגור</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorPanel: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    padding: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  errorTitle: {
    color: "#1c332b",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    color: "#3f514b",
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: "#1e668c",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  errorButtonPressed: { opacity: 0.75 },
  errorButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
});
```

- [ ] **Step 3: Manually verify the stack + deep links**

Run:

```bash
cd apps/mobile && npm run ios
```

Verify in the simulator:
1. App opens on the **Discover (placeholder)** screen (no map).
2. Tapping **תכנן מסלול** pushes the **Build (placeholder)** screen with `slug: —`; the back swipe/gesture returns to Discover.
3. Cold-start deep link opens Build with the slug. With the app fully closed, run:
   ```bash
   xcrun simctl openurl booted "cycleways://routes/sovev-beit-hillel"
   ```
   Expected: app launches into **Build (placeholder)** showing `slug: sovev-beit-hillel`.
4. Unknown slug shows the error overlay. Run:
   ```bash
   xcrun simctl openurl booted "cycleways://routes/does-not-exist"
   ```
   Expected: the "קישור למסלול לא נפתח" overlay appears; tapping סגור dismisses it.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/navigation/RootNavigator.jsx apps/mobile/App.js
git commit -m "feat(mobile): root nav stack + launch-url resolution (placeholders)"
```

---

### Task 5: Refactor MapScreen into BuildScreen

Move the existing map/build UI to `screens/BuildScreen.jsx`, strip the in-sheet Discover panel and the Discover/Build toggle, and load a route from navigation params (in-app selection) while preserving cold-start href loading.

**Files:**
- Rename: `apps/mobile/src/MapScreen.jsx` → `apps/mobile/src/screens/BuildScreen.jsx`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (the moved file)
- Modify: `apps/mobile/src/planner/PlannerSheet.jsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.jsx` (use the real screen)

**Interfaces:**
- Consumes: `route.params?.routeToken`, `route.params?.slug`, `route.params?.name`, and `navigation` from react-navigation; existing controller handles `handleLoadRouteParam`, `handleAddRecentRoute`, `setSelectedCatalogSlug`.
- Produces: `BuildScreen({ navigation, route })` default export rendering the map + build sheet; `PlannerSheet({ sheetRef, children })` now renders build content only (no `panelState`/`discover`/`build` props).

- [ ] **Step 1: Move the file and fix relative import depth**

Run:

```bash
cd apps/mobile && git mv src/MapScreen.jsx src/screens/BuildScreen.jsx
```

Then in `src/screens/BuildScreen.jsx`, fix the now-one-level-deeper relative imports: every import beginning with `"./` that points into `src/` must become `"../`. Specifically update these import paths:

- `"./planner/PlaybackControls.jsx"` → `"../planner/PlaybackControls.jsx"`
- `"./DataMarkerImages.jsx"` → `"../DataMarkerImages.jsx"`
- `"./ElevationProfileChart.jsx"` → `"../ElevationProfileChart.jsx"`
- `"./RichText.jsx"` → `"../RichText.jsx"`
- `"./planner/PlannerSheet.jsx"` → `"../planner/PlannerSheet.jsx"`
- `"./planner/TopSearch.jsx"` → `"../planner/TopSearch.jsx"`
- `"./planner/MapControls.jsx"` → `"../planner/MapControls.jsx"`
- `"./planner/DiscoverPanel.jsx"` → **remove this import** (no longer used here)
- `"./planner/RoutePoiList.jsx"` → `"../planner/RoutePoiList.jsx"`
- `"./planner/NavPanel.jsx"` → `"../planner/NavPanel.jsx"`
- `"./planner/DestinationSheet.jsx"` → `"../planner/DestinationSheet.jsx"`
- `"./navigation/useNavigationSession.js"` → `"../navigation/useNavigationSession.js"`
- `"./navigation/locationService.js"` → `"../navigation/locationService.js"`
- `"./navigation/simulateRideSource.js"` → `"../navigation/simulateRideSource.js"`
- `"./planner/Icon.jsx"` → `"../planner/Icon.jsx"`
- `"./planner/theme.js"` → `"../planner/theme.js"`

(Leave all `@cycleways/core/...` package imports unchanged.)

- [ ] **Step 2: Change the component signature to accept navigation props**

In `src/screens/BuildScreen.jsx`, change:

```jsx
export default function MapScreen() {
```

to:

```jsx
export default function BuildScreen({ navigation, route }) {
```

- [ ] **Step 3: Remove the Discover panel state and seed-on-mount of catalog browsing**

The screen no longer hosts discovery. Make these edits:

a. Remove the panel-state declaration:

```jsx
  const [panelState, setPanelState] = useState("discover");
```

b. The catalog still needs loading for `selectedCatalogEntry` (used by navigation/build summary). Keep the `catalogEntries` state and the `loadRouteCatalogEntries` effect. Keep `selectedCatalogSlug` / `setSelectedCatalogSlug` and `selectedCatalogEntry`.

c. `mapPresentationActive` currently depends on `panelState === "build"`. Replace its definition:

```jsx
  const mapPresentationActive = panelState === "build" && !isNavigating;
```

with:

```jsx
  const mapPresentationActive = !isNavigating;
```

d. Remove the now-unused `handleSelectCatalogRoute` callback (its logic moves to a params-driven loader in Step 4).

- [ ] **Step 4: Load the route from navigation params (in-app selection)**

Add this effect near the other effects (after `handleClearRoute` is defined). It loads a route passed from Discover and records it as a recent; `resetNativeLocationHref` is called by the Discover screen before navigating (Task 6) so a stale cold-start href never double-loads here:

```jsx
  // In-app selection: Discover navigates here with the chosen route's encoded
  // token. Load it through the same shared path used by deep links and record
  // it as a recent. Cold-start deep links instead seed the native href (read by
  // the controller on init), so this only runs for explicit in-app picks.
  const routeTokenParam = route?.params?.routeToken ?? null;
  const routeSlugParam = route?.params?.slug ?? null;
  const routeNameParam = route?.params?.name ?? null;
  useEffect(() => {
    if (!routeTokenParam) return;
    let cancelled = false;
    (async () => {
      const loaded = await handleLoadRouteParam(routeTokenParam);
      if (cancelled || !loaded) return;
      setSelectedCatalogSlug(routeSlugParam);
      handleAddRecentRoute?.({
        name: routeNameParam,
        slug: routeSlugParam,
        param: routeTokenParam,
        source: "catalog",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [routeTokenParam, routeSlugParam, routeNameParam, handleLoadRouteParam, handleAddRecentRoute]);
```

- [ ] **Step 5: Replace the PlannerSheet usage with build-only content**

In `src/screens/BuildScreen.jsx`, replace the whole `<PlannerSheet ... />` block (the `else` branch that currently passes `panelState`, `discover`, and `build` props — lines around the `PlannerSheet` element) with a build-only sheet:

```jsx
        <PlannerSheet sheetRef={plannerSheetRef}>
          <BuildPanelContent
            canDownload={canDownload}
            canRedo={canRedo}
            canShare={Boolean(shareUrl) && shareInfo.status !== "too_long"}
            canUndo={canUndo}
            catalogEntry={selectedCatalogEntry}
            locationState={locationState}
            onClear={handleClearRoute}
            onOpenSummary={handleOpenDownload}
            onRedo={handleRedo}
            onSeekToFraction={seekToFraction}
            onShare={shareRoute}
            onStartNavigation={nav.start}
            onUndo={handleUndo}
            playback={playback}
            presentation={routePresentation}
            routePoints={displayedRoutePoints}
            routeState={routeState}
          />
        </PlannerSheet>
```

- [ ] **Step 6: Make PlannerSheet build-only**

Replace the contents of `apps/mobile/src/planner/PlannerSheet.jsx` with:

```jsx
import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { palette } from "./theme.js";

// Draggable bottom sheet hosting the planner (build) content. The Discover/Build
// segmented toggle is gone — discovery is now its own screen.
export default function PlannerSheet({ sheetRef, children }) {
  const innerRef = useRef(null);
  const ref = sheetRef || innerRef;
  const snapPoints = useMemo(() => ["16%", "48%", "92%"], []);

  return (
    <BottomSheet
      ref={ref}
      index={1}
      snapPoints={snapPoints}
      handleIndicatorStyle={styles.grab}
      backgroundStyle={styles.bg}
    >
      <BottomSheetScrollView contentContainerStyle={styles.body}>
        {children}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grab: { backgroundColor: palette.line, width: 38 },
  bg: { backgroundColor: palette.paper },
  body: { paddingBottom: 24 },
});
```

- [ ] **Step 7: Point the navigator at the real BuildScreen**

In `apps/mobile/src/navigation/RootNavigator.jsx`:

a. Add the import at the top:

```jsx
import BuildScreen from "../screens/BuildScreen.jsx";
```

b. Remove the `BuildPlaceholder` function.

c. Change the Build screen registration to use `BuildScreen`:

```jsx
        <Stack.Screen
          name="Build"
          component={BuildScreen}
          initialParams={initialRouteName === "Build" ? initialParams : undefined}
        />
```

(Leave `DiscoverPlaceholder` in place — Task 6 replaces it.)

- [ ] **Step 8: Manually verify Build works as a screen**

Run:

```bash
cd apps/mobile && npm run ios
```

Verify:
1. From the Discover placeholder, tap **תכנן מסלול** → the real **map + build sheet** appears (empty planner). Tapping the map adds route points as before; undo/redo, playback, and "start navigation" still work.
2. The Discover/Build toggle is **gone** from the sheet (build content only).
3. Cold-start deep link still loads the route:
   ```bash
   xcrun simctl openurl booted "cycleways://routes/sovev-beit-hillel"
   ```
   Expected: app opens into Build with the Sovev Beit Hillel route drawn and framed.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/screens/BuildScreen.jsx apps/mobile/src/planner/PlannerSheet.jsx apps/mobile/src/navigation/RootNavigator.jsx
git commit -m "refactor(mobile): MapScreen -> BuildScreen, build-only sheet"
```

---

### Task 6: Discover front page screen

Replace the placeholder with the real map-free discovery screen: header, search box (uses `filterCatalogBySearch`), collapsible filters + list (reusing `DiscoverPanel`), and a "תכנן מסלול" FAB. Selecting a route navigates to `Build` via params after resetting the native href.

**Files:**
- Modify: `apps/mobile/src/planner/DiscoverPanel.jsx` (collapsible filters + search + accept controlled query)
- Create: `apps/mobile/src/screens/DiscoverScreen.jsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.jsx` (use the real screen)

**Interfaces:**
- Consumes: `filterCatalogBySearch` (Task 3); `loadRouteCatalogEntries`, `getJsonAsset`, `resetNativeLocationHref` from core; `navigation` from react-navigation; existing `RouteCard`, `selectDiscoverRoutes`, `sortByDistanceFromUser`, `FILTER_GROUPS`, `emptyFilters`.
- Produces: `DiscoverScreen({ navigation })` default export; `DiscoverPanel` gains props `query` (string) and `onQueryChange` (fn) and renders a collapsible filter block.

- [ ] **Step 1: Add collapsible filters + search to DiscoverPanel**

Edit `apps/mobile/src/planner/DiscoverPanel.jsx`:

a. Update imports at the top to add `TextInput` and the search helper:

```jsx
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getJsonAsset } from "@cycleways/core/platform/assets.js";
import { sortByDistanceFromUser } from "@cycleways/core/data/nearMe.js";
import {
  FILTER_GROUPS,
  emptyFilters,
  selectDiscoverRoutes,
} from "@cycleways/core/data/discoverFilters.js";
import { filterCatalogBySearch } from "@cycleways/core/data/catalogSearch.js";
import RouteCard from "./RouteCard.jsx";
import { palette, radius, space } from "./theme.js";
```

b. Change the component signature and add the collapse + search state:

```jsx
export default function DiscoverPanel({ entries, onSelect, fix, query, onQueryChange }) {
  const [places, setPlaces] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [nearMeSort, setNearMeSort] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
```

c. Compute the active-filter count and apply the search filter. Replace the existing `filtered` / `ordered` memos with:

```jsx
  const activeFilterCount = useMemo(
    () =>
      FILTER_GROUPS.reduce((sum, g) => sum + filters[g.axis].size, 0) +
      (nearMeSort ? 1 : 0),
    [filters, nearMeSort],
  );

  const searched = useMemo(
    () => filterCatalogBySearch(entries, query, placeById),
    [entries, query, placeById],
  );
  const filtered = useMemo(
    () => selectDiscoverRoutes(searched, filters).routes,
    [searched, filters],
  );
  const ordered = useMemo(
    () =>
      nearMeSort && fix
        ? sortByDistanceFromUser(filtered, placeById, fix)
        : filtered,
    [filtered, nearMeSort, fix, placeById],
  );
```

d. Replace the returned `filters` `<View>` block (the one rendering `FILTER_GROUPS`) with a search row + a collapsible filter block:

```jsx
  return (
    <View style={styles.root}>
      <TextInput
        style={styles.search}
        placeholder="חפש מסלול..."
        placeholderTextColor={palette.muted}
        value={query}
        onChangeText={onQueryChange}
        textAlign="right"
        accessibilityLabel="חיפוש מסלול"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="סינון"
        onPress={() => setFiltersOpen((v) => !v)}
        style={styles.filterToggle}
      >
        <Text style={styles.filterToggleText}>
          {`סינון${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
        </Text>
        <Text style={styles.filterChevron}>{filtersOpen ? "▴" : "▾"}</Text>
      </Pressable>

      {filtersOpen ? (
        <View style={styles.filters}>
          {FILTER_GROUPS.map((group) => (
            <View key={group.axis} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <View style={styles.chipRow}>
                {group.options.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    active={filters[group.axis].has(opt.value)}
                    onPress={() => toggleAxis(group.axis, opt.value)}
                  />
                ))}
              </View>
            </View>
          ))}
          {fix ? (
            <Chip
              label="קרוב אליי"
              icon
              active={nearMeSort}
              onPress={() => setNearMeSort((v) => !v)}
            />
          ) : null}
        </View>
      ) : null}

      <Text style={styles.count}>{`${ordered.length} מסלולים`}</Text>

      <View style={styles.list}>
        {ordered.map((entry, index) => (
          <RouteCard
            key={entry.slug || entry.name}
            entry={entry}
            index={index}
            placeById={placeById}
            fix={fix}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}
```

e. Add styles for the new elements to the `StyleSheet.create({...})` (keep all existing keys):

```jsx
  search: {
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    color: palette.ink,
    fontSize: 14,
    writingDirection: "rtl",
  },
  filterToggle: {
    marginHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: palette.cream,
  },
  filterToggleText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  filterChevron: { color: palette.muted, fontSize: 12 },
```

- [ ] **Step 2: Create the DiscoverScreen**

Create `apps/mobile/src/screens/DiscoverScreen.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { loadRouteCatalogEntries } from "@cycleways/core/data/catalog.js";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import DiscoverPanel from "../planner/DiscoverPanel.jsx";
import { palette } from "../planner/theme.js";

export default function DiscoverScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [fix, setFix] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadRouteCatalogEntries()
      .then((list) => {
        if (!cancelled) setEntries(Array.isArray(list) ? list : []);
      })
      .catch((error) => console.warn("Discover catalog load failed:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  // Best-effort last-known location for the "near me" sort; no prompt here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getLastKnownPositionAsync();
        if (!cancelled && pos?.coords) {
          setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // ignore — near-me is optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRoute = (entry) => {
    if (!entry?.route) return;
    resetNativeLocationHref();
    navigation.navigate("Build", {
      routeToken: entry.route,
      slug: entry.slug ?? null,
      name: entry.name ?? null,
    });
  };

  const planFromScratch = () => {
    resetNativeLocationHref();
    navigation.navigate("Build", {});
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>גלה מסלול</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <DiscoverPanel
          entries={entries}
          onSelect={openRoute}
          fix={fix}
          query={query}
          onQueryChange={setQuery}
        />
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="תכנן מסלול"
        onPress={planFromScratch}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 20 },
          pressed ? styles.fabPressed : null,
        ]}
      >
        <Text style={styles.fabText}>＋ תכנן מסלול</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  scroll: { paddingTop: 8, paddingBottom: 120 },
  fab: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row-reverse",
    alignItems: "center",
    backgroundColor: palette.forest,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { color: palette.white, fontSize: 16, fontWeight: "800", writingDirection: "rtl" },
});
```

- [ ] **Step 3: Point the navigator at the real DiscoverScreen**

In `apps/mobile/src/navigation/RootNavigator.jsx`:

a. Add the import:

```jsx
import DiscoverScreen from "../screens/DiscoverScreen.jsx";
```

b. Remove the `DiscoverPlaceholder` function and its now-unused imports (`Pressable`, `Text`, `View`, `StyleSheet` — remove only those that become unused; keep what BuildScreen registration needs). The file should end up importing only `NavigationContainer`, `createNativeStackNavigator`, `DiscoverScreen`, and `BuildScreen`.

c. Use the real component:

```jsx
        <Stack.Screen name="Discover" component={DiscoverScreen} />
```

- [ ] **Step 4: Manually verify the discovery front page end-to-end**

Run:

```bash
cd apps/mobile && npm run ios
```

Verify:
1. App opens on the **map-free discovery screen**: title "גלה מסלול", a search box, a collapsed "סינון" button, the route count, and the route cards. **No map is visible.**
2. Typing in the search box filters the list (e.g. "בניאס" narrows to the Banias route).
3. Tapping **סינון** expands the chip groups; selecting a difficulty filters the list and the button shows a count (e.g. "סינון (1)").
4. Tapping a **route card** opens Build with that route loaded and framed.
5. Tapping the **＋ תכנן מסלול** FAB opens Build with an **empty** planner (no route) — even right after having opened a route via deep link (confirms `resetNativeLocationHref`).
6. The back gesture from Build returns to the discovery screen with its scroll/filters intact.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/planner/DiscoverPanel.jsx apps/mobile/src/screens/DiscoverScreen.jsx apps/mobile/src/navigation/RootNavigator.jsx
git commit -m "feat(mobile): map-free discovery screen with search, filters, FAB"
```

---

### Task 7: Full regression pass + cleanup

**Files:**
- Modify: none expected (verification + any small fixes surfaced)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the full Node test suite**

Run (from repo root):

```bash
npm test
```

Expected: all tests pass, including the new `test-app-launch-target.mjs` and `test-catalog-search.mjs`. (If unrelated pre-existing tests fail, note them but do not fix in this phase.)

- [ ] **Step 2: Confirm no dangling references to the old module**

Run:

```bash
grep -rn "MapScreen" apps/mobile/src apps/mobile/App.js
```

Expected: no results (the file is now `BuildScreen.jsx` and nothing imports `MapScreen`). Fix any straggler import if found.

- [ ] **Step 3: Manual smoke of the four flows**

Run `cd apps/mobile && npm run ios` and confirm, in one session:
1. Discover → tap card → Build (route loaded) → back → Discover.
2. Discover → FAB → Build (empty) → build a route by tapping the map → back → Discover.
3. Cold-start `xcrun simctl openurl booted "cycleways://routes/banias-gan-hatsafon"` → Build with the route.
4. Warm link: with the app on Discover, run the same `openurl` → it navigates to Build with the route.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(mobile): phase A cleanup + regression pass"
```

(If Step 2/3 surfaced no changes, skip this commit.)

---

## Self-Review

**Spec coverage (Phase A scope):**
- Map-free discovery front page — Task 6 (DiscoverScreen, no map). ✓
- Collapsible filters — Task 6 Step 1 (`filtersOpen`). ✓
- Search-as-list-filter (not geocode) — Task 3 + Task 6. ✓
- "תכנן מסלול" FAB → empty Build — Task 6 (`planFromScratch`). ✓
- `react-navigation` stack, map mounts only on Build — Tasks 1, 4, 5. ✓
- `useCyclewaysApp` lifts into Build only — Task 5 (controller stays inside `BuildScreen`; Discover loads its own catalog). ✓
- Deep links via launch resolution; cold-start route still loads — Tasks 2, 4 (href seeding preserved), Task 5 Step 8 verify. ✓
- In-app selection via params + stale-href reset — Task 5 Step 4 + Task 6 (`resetNativeLocationHref`). ✓
- Cards stay close to today's `RouteCard` (rich cards deferred to Phase B) — Task 6 reuses `RouteCard`. ✓
- Turn-by-turn untouched — `BuildScreen` keeps the nav sub-mode as-is. ✓
- RouteDetail screen — intentionally **not** in Phase A (Phase C); cards/deep links open Build for now, per the design's phasing. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" placeholders; every code step shows full code. The temporary `DiscoverPlaceholder`/`BuildPlaceholder` are intentional scaffolding removed in Tasks 5–6.

**Type consistency:** `launchTargetFromHref(href) -> { screen, params }` consumed identically in `App.js`. `filterCatalogBySearch(entries, query, placeById)` signature matches between Task 3, its test, and `DiscoverPanel`. `BuildScreen({ navigation, route })` reads `route.params.{routeToken,slug,name}`, exactly the keys `DiscoverScreen.openRoute` sets. `PlannerSheet({ sheetRef, children })` matches the new usage in `BuildScreen` Step 5.
