# Locate-Me Implementation Plan (discovery-surface D1, roadmap step 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-11
**Design:** [design.md](design.md) — D1: one-shot "locate me", scoped to discovery. No tracking, no follow camera, nothing navigation-like.

**Goal:** A locate button on the planner map that resolves the device position once, drops a fix marker with an accuracy ring, flies the camera to it when inside the map area, and powers "X ק"מ ממך" distance labels plus a "קרוב אליי" sort in the Discover panel.

**Architecture:** A new `geolocation` platform service in `@cycleways/core` (web + native stub, mirroring `location.js`/`location.native.js`) feeds a `handleLocateMe` handler in `useCyclewaysApp`, which stores a `locationFix` in `mapUi`. `MapSurface` renders the fix (marker + accuracy-ring polygon from a pure `circlePolygon` helper) behind a new capability flag. Discover distances come from pure helpers joining `routeStartPlaceIds(entry)` with `places.json` coordinates. Permission is requested only on explicit button tap; all failures degrade to today's behavior.

**Tech Stack:** browser `navigator.geolocation` (one-shot), Mapbox GL marker + GeoJSON fill layer, node test files (`tests/test-*.mjs`, plain `node:assert`), Playwright e2e with `context.setGeolocation`.

**Execution note:** Run on a worktree branch (e.g. `step-2-locate-and-touch`) off the current `claude/fable-ux-planning` HEAD — the same branch also hosts the sibling plan `plans/planning-surface/implementation-plan.md`; execute this plan first. Known pre-existing e2e failures (NOT yours to fix): `routes-index.spec.mjs:8`, `routes-index.spec.mjs:114`, `featured-index.spec.mjs:37`, `react-migration-smoke.spec.mjs:81`.

---

### Task 1: Geolocation platform service

**Files:**
- Create: `packages/core/src/platform/geolocation.js`
- Create: `packages/core/src/platform/geolocation.native.js`
- Test: `tests/test-geolocation-platform.mjs`
- Modify: `package.json` (append test to the `test` script chain)

- [ ] **Step 1: Write the failing test**

Create `tests/test-geolocation-platform.mjs`:

```js
import assert from "node:assert/strict";
import { getCurrentPosition } from "@cycleways/core/platform/geolocation.js";

// Resolves a one-shot fix mapped to {lat, lng, accuracy}.
{
  globalThis.navigator = {
    geolocation: {
      getCurrentPosition(success) {
        success({ coords: { latitude: 33.2, longitude: 35.6, accuracy: 25 } });
      },
    },
  };
  const fix = await getCurrentPosition();
  assert.deepEqual(fix, { lat: 33.2, lng: 35.6, accuracy: 25 });
}

// Rejects when the device denies/fails.
{
  globalThis.navigator = {
    geolocation: {
      getCurrentPosition(_success, error) {
        error(new Error("denied"));
      },
    },
  };
  await assert.rejects(() => getCurrentPosition(), /denied/);
}

// Rejects when the API is missing entirely.
{
  globalThis.navigator = {};
  await assert.rejects(() => getCurrentPosition(), /geolocation-unsupported/);
}

delete globalThis.navigator;
console.log("geolocation platform tests passed");
```

(Import style matches `tests/test-react-route-actions.mjs`, which imports `@cycleways/core/...` via workspaces. If the subpath fails to resolve, check `packages/core/package.json` `exports` — other `platform/` modules are consumed only internally, so you may need to import via a relative path `../packages/core/src/platform/geolocation.js` instead, matching whichever pattern existing tests use for unexported files.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-geolocation-platform.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the web service**

Create `packages/core/src/platform/geolocation.js`:

```js
// One-shot device location for discovery features ("near me" labels, locate
// button). Wraps the browser geolocation API in a promise. Deliberately NOT a
// tracking/watch API: mobile-web location is unreliable for navigation, which
// is app-only (see plans/navigation-handoff/design.md).
export function getCurrentPosition({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const geo = globalThis.navigator?.geolocation;
    if (!geo || typeof geo.getCurrentPosition !== "function") {
      reject(new Error("geolocation-unsupported"));
      return;
    }
    geo.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
```

Create `packages/core/src/platform/geolocation.native.js`:

```js
// Native sibling resolved by Metro. The iPhone app has its own location stack
// (plans/rn-mobile-location); core callers on native should not reach this.
export function getCurrentPosition() {
  return Promise.reject(new Error("geolocation-unsupported"));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-geolocation-platform.mjs`
Expected: `geolocation platform tests passed`, exit 0.

- [ ] **Step 5: Register the test and commit**

In root `package.json`, add `node tests/test-geolocation-platform.mjs && ` into the `test` script chain (insert before `node tests/test-vs-time.mjs`, matching the existing `&&` style).

```bash
git add packages/core/src/platform/geolocation.js packages/core/src/platform/geolocation.native.js tests/test-geolocation-platform.mjs package.json
git commit -m "feat(core): one-shot geolocation platform service (web + native stub)"
```

---

### Task 2: Near-me distance helpers

**Files:**
- Create: `packages/core/src/data/nearMe.js`
- Test: `tests/test-near-me.mjs`
- Modify: `package.json` (test chain)

- [ ] **Step 1: Write the failing test**

Create `tests/test-near-me.mjs`:

```js
import assert from "node:assert/strict";
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
  sortByDistanceFromUser,
} from "@cycleways/core/data/nearMe.js";

const placeById = new Map([
  ["near", { id: "near", name: "קרוב", lat: 33.2, lng: 35.6 }],
  ["far", { id: "far", name: "רחוק", lat: 33.0, lng: 35.6 }],
]);
const fix = { lat: 33.2, lng: 35.6 };

// Distance is the minimum over the entry's start places.
{
  const entry = { slug: "a", startPlaceIds: ["far", "near"] };
  const d = distanceToRouteStartMeters(entry, placeById, fix);
  assert.ok(d !== null && d < 50, `expected ~0m, got ${d}`);
}

// Circular routes fall back to passesNear (routeStartPlaceIds behavior).
{
  const entry = { slug: "b", routeShape: { type: "circular" }, passesNear: ["far"] };
  const d = distanceToRouteStartMeters(entry, placeById, fix);
  assert.ok(d > 20000 && d < 25000, `expected ~22km, got ${d}`);
}

// Unresolvable start → null; bad fix → null.
{
  assert.equal(distanceToRouteStartMeters({ slug: "c" }, placeById, fix), null);
  assert.equal(
    distanceToRouteStartMeters({ slug: "a", startPlaceIds: ["near"] }, placeById, null),
    null,
  );
}

// Labels: meters under 1km, one-decimal km above.
{
  assert.equal(formatDistanceFromUser(320), 'כ-320 מ׳ ממך');
  assert.equal(formatDistanceFromUser(22300), 'כ-22.3 ק"מ ממך');
  assert.equal(formatDistanceFromUser(null), "");
}

// Sort: nearest first, unresolvable last, original order otherwise stable.
{
  const entries = [
    { slug: "no-start" },
    { slug: "far-route", startPlaceIds: ["far"] },
    { slug: "near-route", startPlaceIds: ["near"] },
  ];
  const sorted = sortByDistanceFromUser(entries, placeById, fix);
  assert.deepEqual(sorted.map((e) => e.slug), ["near-route", "far-route", "no-start"]);
  // Without a fix the list is returned unchanged (same reference is fine).
  assert.deepEqual(
    sortByDistanceFromUser(entries, placeById, null).map((e) => e.slug),
    ["no-start", "far-route", "near-route"],
  );
}

console.log("near-me helper tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-near-me.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `packages/core/src/data/nearMe.js`:

```js
// Pure "near me" helpers for Discover: distance from a one-shot location fix
// to a route's start, derived from the route's start places (places.json
// coordinates). Routes without a resolvable start place get null / sort last.
import { getDistance } from "../utils/distance.js";
import { routeStartPlaceIds } from "./catalog.js";

export function distanceToRouteStartMeters(entry, placeById, fix) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  let best = null;
  for (const id of routeStartPlaceIds(entry)) {
    const place = placeById?.get?.(id);
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
    const d = getDistance({ lat: fix.lat, lng: fix.lng }, { lat: place.lat, lng: place.lng });
    if (best === null || d < best) best = d;
  }
  return best;
}

export function formatDistanceFromUser(meters) {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return `כ-${Math.round(meters)} מ׳ ממך`;
  return `כ-${(meters / 1000).toFixed(1)} ק"מ ממך`;
}

export function sortByDistanceFromUser(entries, placeById, fix) {
  const list = Array.isArray(entries) ? entries : [];
  if (!fix) return list;
  return list
    .map((entry, index) => ({
      entry,
      index,
      d: distanceToRouteStartMeters(entry, placeById, fix),
    }))
    .sort((a, b) => {
      if (a.d === null && b.d === null) return a.index - b.index;
      if (a.d === null) return 1;
      if (b.d === null) return -1;
      return a.d - b.d || a.index - b.index;
    })
    .map((item) => item.entry);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-near-me.mjs`
Expected: `near-me helper tests passed`.

- [ ] **Step 5: Register the test and commit**

Add `node tests/test-near-me.mjs && ` to the `test` chain in `package.json` next to the Task 1 entry.

```bash
git add packages/core/src/data/nearMe.js tests/test-near-me.mjs package.json
git commit -m "feat(core): near-me distance helpers for Discover"
```

---

### Task 3: Accuracy-ring polygon helper

**Files:**
- Create: `packages/core/src/utils/geoCircle.js`
- Test: `tests/test-geo-circle.mjs`
- Modify: `package.json` (test chain)

- [ ] **Step 1: Write the failing test**

Create `tests/test-geo-circle.mjs`:

```js
import assert from "node:assert/strict";
import { circlePolygon } from "@cycleways/core/utils/geoCircle.js";
import { getDistance } from "@cycleways/core/utils/distance.js";

// A closed GeoJSON polygon whose ring points sit ~radius meters from center.
{
  const center = { lat: 33.2, lng: 35.6 };
  const poly = circlePolygon(center.lat, center.lng, 250, 32);
  assert.equal(poly.type, "Polygon");
  const ring = poly.coordinates[0];
  assert.equal(ring.length, 33, "32 steps + closing point");
  assert.deepEqual(ring[0], ring[ring.length - 1], "ring is closed");
  for (const [lng, lat] of ring.slice(0, -1)) {
    const d = getDistance(center, { lat, lng });
    assert.ok(Math.abs(d - 250) < 5, `ring point ${d}m from center, expected ~250m`);
  }
}

console.log("geo circle tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-geo-circle.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/utils/geoCircle.js`:

```js
// Builds a GeoJSON Polygon approximating a circle of `radiusMeters` around a
// lat/lng — used to draw a location-accuracy ring as a plain fill layer
// (radius stays meter-accurate at every zoom, unlike a circle paint radius).
const EARTH_RADIUS_M = 6371e3;

export function circlePolygon(lat, lng, radiusMeters, steps = 64) {
  const ring = [];
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);
  for (let i = 0; i < steps; i += 1) {
    const theta = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-geo-circle.mjs`
Expected: `geo circle tests passed`.

- [ ] **Step 5: Register the test and commit**

Add `node tests/test-geo-circle.mjs && ` to the `test` chain.

```bash
git add packages/core/src/utils/geoCircle.js tests/test-geo-circle.mjs package.json
git commit -m "feat(core): circlePolygon helper for location accuracy ring"
```

---

### Task 4: `handleLocateMe` in the core controller

**Files:**
- Modify: `packages/core/src/app/useCyclewaysApp.js` (imports; `mapUi` initial state ~line 74; new handler after `handleRoutePointSelect` ~line 853; return block)

- [ ] **Step 1: Add the import**

Next to the other platform imports (~line 27):

```js
import { getCurrentPosition } from "../platform/geolocation.js";
```

- [ ] **Step 2: Extend the initial mapUi state**

In the `useState` for `mapUi` (~line 74), add two fields after `tutorialOpen: false,`:

```js
    locationFix: null,
    locateStatus: "idle",
```

- [ ] **Step 3: Add the handler**

Insert after `handleRoutePointSelect` (~line 853):

```js
  // One-shot locate-me: resolves the device position (permission is requested
  // by the browser only at this tap), stores a fix for the map marker and the
  // Discover near-me labels, and flags whether it's inside the map area so the
  // camera only flies to in-bounds fixes. Never watches/tracks position.
  const handleLocateMe = useCallback(async () => {
    setMapUi((current) => ({
      ...current,
      locateStatus: "locating",
      searchError: null,
    }));
    try {
      const fix = await getCurrentPosition();
      const bounds = getGeoJsonCoordinateBounds(state.assets.geoJsonData);
      const withinBounds = isPointWithinBounds(
        { lat: fix.lat, lng: fix.lng },
        bounds,
      );
      setMapUi((current) => ({
        ...current,
        locateStatus: "idle",
        locationFix: { id: `locate-${Date.now()}`, ...fix, withinBounds },
        searchError: withinBounds ? null : "המיקום שלך מחוץ לאזור המפה",
      }));
    } catch {
      setMapUi((current) => ({
        ...current,
        locateStatus: "error",
        searchError: "לא הצלחנו לאתר את המיקום שלך",
      }));
    }
  }, [state.assets]);
```

(`getGeoJsonCoordinateBounds` and `isPointWithinBounds` are already imported/used by `handleSearchSubmit` ~line 900 — verify the import names at the top of the file and reuse them as-is.)

- [ ] **Step 4: Export from the hook**

In the return block, after `handleSearchQueryChange,` add:

```js
    handleLocateMe,
```

- [ ] **Step 5: Sanity-check + commit**

Run: `node tests/test-react-route-actions.mjs && node tests/test-route-reducer.mjs && echo OK`
Expected: OK.

```bash
git add packages/core/src/app/useCyclewaysApp.js
git commit -m "feat(core): handleLocateMe — one-shot location fix in mapUi"
```

---

### Task 5: Render the fix on the map

**Files:**
- Modify: `src/map/mapCapabilities.js` (both capability sets)
- Modify: `src/map/MapSurface.jsx` (new prop + effect; helper functions near `syncSearchHighlightCircle` ~line 1103)
- Modify: `src/react-app.css` (marker style)

- [ ] **Step 1: Add the capability flag**

In `src/map/mapCapabilities.js`: add `locationFix: true,` next to `searchHighlight: true` in the planner set, and `locationFix: false,` next to `searchHighlight: false` in the featured/read-only set.

- [ ] **Step 2: Add the prop and effect in MapSurface**

Add `locationFix = null,` to the component props (next to `searchHighlight`, ~line 106). Add a ref next to `searchMarkerRef`:

```js
  const locationMarkerRef = useRef(null);
```

Add this effect after the `searchHighlight` effect (~line 949):

```js
  // Locate-me fix: persistent marker + meter-accurate accuracy ring. Replaced
  // wholesale when a new fix arrives; camera flies only to in-bounds fixes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.locationFix || !locationFix) {
      return undefined;
    }

    locationMarkerRef.current?.remove();
    const mapboxgl = getMapboxGl();
    const el = document.createElement("div");
    el.className = "react-locate-marker";
    locationMarkerRef.current = new mapboxgl.Marker(el)
      .setLngLat([locationFix.lng, locationFix.lat])
      .addTo(map);

    syncLocationAccuracyRing(map, locationFix);
    if (locationFix.withinBounds) {
      map.flyTo({
        center: [locationFix.lng, locationFix.lat],
        zoom: Math.max(typeof map.getZoom === "function" ? map.getZoom() : 13, 13),
        duration: 1000,
      });
    }
    return undefined;
  }, [locationFix, status, caps.locationFix]);
```

Add the ring helper near `syncSearchHighlightCircle` (~line 1103), importing `circlePolygon` at the top of the file:

```js
import { circlePolygon } from "@cycleways/core/utils/geoCircle.js";
```

```js
const LOCATION_RING_SOURCE_ID = "locate-accuracy-ring";
const LOCATION_RING_LAYER_ID = "locate-accuracy-ring-fill";

function syncLocationAccuracyRing(map, locationFix) {
  const radius = Number.isFinite(locationFix.accuracy)
    ? Math.max(locationFix.accuracy, 15)
    : 15;
  const data = {
    type: "Feature",
    properties: {},
    geometry: circlePolygon(locationFix.lat, locationFix.lng, radius),
  };
  const source = map.getSource(LOCATION_RING_SOURCE_ID);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(LOCATION_RING_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: LOCATION_RING_LAYER_ID,
    type: "fill",
    source: LOCATION_RING_SOURCE_ID,
    paint: { "fill-color": "#1d6ee8", "fill-opacity": 0.15 },
  });
}
```

(Study how `syncSearchHighlightCircle` guards source/layer existence and follow the same conventions if they differ from the above.)

- [ ] **Step 3: Pass the prop from App.jsx**

In `src/App.jsx`, add to the `<MapView>` props: `locationFix={mapUi.locationFix}`. (MapView spreads props through to MapSurface — no MapView change.)

- [ ] **Step 4: Marker CSS**

Append to `src/react-app.css` (near `.react-search-marker`, search for it):

```css
.react-locate-marker {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #1d6ee8;
  border: 3px solid #fff;
  box-shadow: 0 1px 6px rgb(29 110 232 / 55%);
}
```

- [ ] **Step 5: Verify nothing broke + commit**

Run: `npx playwright test tests/e2e/front-panel.spec.mjs tests/e2e/react-migration-smoke.spec.mjs --project=desktop 2>&1 | tail -4`
Expected: same results as before this task (react-migration-smoke:81 is a known pre-existing failure; front-panel all green).

```bash
git add src/map/mapCapabilities.js src/map/MapSurface.jsx src/App.jsx src/react-app.css
git commit -m "feat(map): render locate-me fix marker + accuracy ring"
```

---

### Task 6: Locate button UI

**Files:**
- Modify: `src/components/Icon.jsx` (new glyph)
- Modify: `src/App.jsx` (button inside `.search-container`, next to the search form)
- Modify: `src/react-app.css` (button style)

- [ ] **Step 1: Add the icon glyph**

In `src/components/Icon.jsx`, add to the `ICONS` map (ionicons v7 `locate-outline`, same conventions as the existing entries):

```jsx
  "locate-outline": (
    <>
      <line x1="256" y1="48" x2="256" y2="96" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <line x1="256" y1="416" x2="256" y2="464" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <line x1="464" y1="256" x2="416" y2="256" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <line x1="96" y1="256" x2="48" y2="256" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <circle cx="256" cy="256" r="160" fill="none" stroke="currentColor" strokeWidth="32" />
    </>
  ),
```

- [ ] **Step 2: Add the button in App.jsx**

Destructure `handleLocateMe` from `useCyclewaysApp` (after `handleSearchQueryChange,`). Inside the `.search-container` div, after the `</form>`:

```jsx
                  <button
                    type="button"
                    className="locate-btn"
                    title="מצא את המיקום שלי"
                    aria-label="מצא את המיקום שלי"
                    disabled={mapUi.locateStatus === "locating"}
                    onClick={handleLocateMe}
                  >
                    <Icon name="locate-outline" />
                  </button>
```

- [ ] **Step 3: Button CSS**

Append to `src/react-app.css` (match the search button's look — read the `.search-input-group` / `#search-btn` rules and reuse their colors/radius):

```css
.search-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.locate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border: 1px solid #d5ddd8;
  border-radius: 10px;
  background: #fff;
  color: #2f4533;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(40 48 38 / 12%);
}

.locate-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}
```

**Caution:** `.search-container` already has positioning rules in `react-app.css`/`styles.css` — read them first; if it's already a flex container or absolutely positioned, only add what's missing rather than overriding (the button must not break the existing search layout on mobile, where `.search-container` spans the map top). Verify visually in Step 5 of Task 8.

- [ ] **Step 4: Quick check + commit**

Run: `npx playwright test tests/e2e/front-panel.spec.mjs --project=desktop --project=mobile 2>&1 | tail -3`
Expected: all green.

```bash
git add src/components/Icon.jsx src/App.jsx src/react-app.css
git commit -m "feat(discover): locate-me button on the planner map"
```

---

### Task 7: Near-me labels + sort in Discover

**Files:**
- Modify: `src/App.jsx` (pass `locationFix` to DiscoverPanel)
- Modify: `src/components/frontPanel/DiscoverPanel.jsx`
- Modify: `src/components/frontPanel/PanelRouteCard.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: Thread the fix into DiscoverPanel**

In `src/App.jsx`, pass `locationFix={mapUi.locationFix}` to `<DiscoverPanel ... />`.

- [ ] **Step 2: Compute distances + sort toggle in DiscoverPanel**

In `src/components/frontPanel/DiscoverPanel.jsx`:

Imports:

```js
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
  sortByDistanceFromUser,
} from "@cycleways/core/data/nearMe.js";
```

Add `locationFix` to the component props. Add local state and derive the final list — replace the current `const { routes } = useMemo(...)` block with:

```js
  const [nearMeSort, setNearMeSort] = useState(false);
  const { routes: filteredRoutes } = useMemo(
    () => selectDiscoverRoutes(entries, filters),
    [entries, filters],
  );
  const routes = useMemo(
    () =>
      nearMeSort && locationFix
        ? sortByDistanceFromUser(filteredRoutes, placeById, locationFix)
        : filteredRoutes,
    [filteredRoutes, nearMeSort, locationFix, placeById],
  );
```

Render the sort toggle only when a fix exists — insert between the `discover-panel__places` div and the `discover-panel__filters` div:

```jsx
      {locationFix && (
        <div className="discover-panel__near-me">
          <FilterChip active={nearMeSort} onClick={() => setNearMeSort((v) => !v)}>
            קרוב אליי
          </FilterChip>
        </div>
      )}
```

Where the route cards are rendered (`<PanelRouteCard ... />` — find the map over `routes`), pass:

```jsx
            distanceFromUserLabel={
              locationFix
                ? formatDistanceFromUser(
                    distanceToRouteStartMeters(entry, placeById, locationFix),
                  )
                : ""
            }
```

(The cards' map uses whatever loop variable the file already has — match its name, likely `entry` or `r`; keep `index` usage intact since it drives the color swatch.)

- [ ] **Step 3: Show the label on the card**

In `src/components/frontPanel/PanelRouteCard.jsx`, add `distanceFromUserLabel = ""` to the props and render it at the end of the meta line:

```jsx
        <span className="panel-route-card__meta">
          <b>{entry.distanceKm} ק״מ</b>
          <span>· {routeDifficultyLabel(entry.difficulty)}</span>
          {placeNames.length > 0 && <span>· {placeNames.join(" · ")}</span>}
          {distanceFromUserLabel && (
            <span className="panel-route-card__near"> · {distanceFromUserLabel}</span>
          )}
        </span>
```

- [ ] **Step 4: CSS**

Append to `src/components/frontPanel/front-panel.css`:

```css
.discover-panel__near-me {
  margin: 8px 0 2px;
}

.panel-route-card__near {
  color: #1d6ee8;
  font-weight: 700;
}
```

- [ ] **Step 5: Verify + commit**

Run: `node tests/test-discover-route-list.mjs && npx playwright test tests/e2e/front-panel.spec.mjs tests/e2e/discover-route-select.spec.mjs --project=desktop 2>&1 | tail -3`
Expected: all green.

```bash
git add src/App.jsx src/components/frontPanel/DiscoverPanel.jsx src/components/frontPanel/PanelRouteCard.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(discover): near-me distance labels and sort from the location fix"
```

---

### Task 8: Locate-me e2e

**Files:**
- Test: `tests/e2e/locate-me.spec.mjs` (create)

- [ ] **Step 1: Write the spec**

Create `tests/e2e/locate-me.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

// A fix next to Beit Hillel (inside the Upper-Galilee map area).
test.use({
  geolocation: { latitude: 33.2177, longitude: 35.6097 },
  permissions: ["geolocation"],
});

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("locate button surfaces near-me labels and sort in Discover", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  const locate = page.getByRole("button", { name: "מצא את המיקום שלי" });
  await expect(locate).toBeVisible();
  await locate.click();
  // Distance labels appear on the cards.
  await expect(panel.locator(".panel-route-card__near").first()).toContainText("ממך");
  // The near-me sort chip appears and re-orders by distance: the fix sits in
  // Beit Hillel, so sovev-beit-hillel must come first.
  await panel.getByRole("button", { name: "קרוב אליי" }).click();
  await expect(panel.locator(".panel-route-card").first()).toContainText("סובב בית הלל");
});

test("denied geolocation degrades to an error message", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await page.getByRole("button", { name: "מצא את המיקום שלי" }).click();
  await expect(page.locator("#search-error")).toContainText("לא הצלחנו לאתר את המיקום שלך");
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/locate-me.spec.mjs --project=desktop --project=mobile`
Expected: PASS on both. If the denied-path test hangs, check that `clearPermissions` actually causes `getCurrentPosition` to reject in headless Chromium; if it prompts instead, use `context.setGeolocation(null)` or grant-then-block via `permissions: []` in a second `test.use` block — adapt the mechanics, keep the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/locate-me.spec.mjs
git commit -m "test(discover): e2e for locate-me labels, sort, and denied fallback"
```

---

### Task 9: Verification for this plan

- [ ] Run `npm test` → all green (includes the three new node tests).
- [ ] Run `npx playwright test --project=desktop --project=mobile 2>&1 | tail -12` → no NEW failures beyond the four known pre-existing ones listed in the header.
- [ ] Continue to `plans/planning-surface/implementation-plan.md` on the same branch.
