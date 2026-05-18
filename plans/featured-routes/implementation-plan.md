# Featured Routes Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver curated featured-route landing pages (`/featured/<slug>`) with rich content, an index gallery (`/featured`), and POI extensions to `segments.json`, while leaving the existing planner at `/` unchanged.

**Architecture:** Add `react-router-dom`, author each featured route as a JSX module under `src/featured/`, render through a `<FeaturedRoute>` shell that reuses the existing `RouteManager`, `MapView`, and data-marker plumbing. Extend `segments.json` `data` entries with new POI types and stable ids.

**Tech Stack:** React 19, Vite 7, Mapbox GL, `react-router-dom` (new), node test runner, Playwright.

---

## Phase 0: Preparation

### Scope

Set up tooling and confirm scope without changing user-visible behavior. No new routes wired yet.

### Tasks

- [ ] Verify all existing tests pass before starting any work.
  - Run: `npm test`
  - Run: `npm run test:smoke -- --project=desktop`
  - Expected: all pass. If anything fails, stop and resolve before continuing.

- [ ] Document the parity contract this feature must preserve:
  - the existing planner at `/` keeps current behavior (route param decoding, planning, GPX download, share URL);
  - `segments.json` consumers in the existing app (`getActiveRouteDataPoints`, data marker rendering, warning legend) keep working with new POI types added.

- [ ] Decide which existing hardcoded recommended route in `src/components/ContentSections.jsx` becomes the first migrated featured route. The current candidate is the link `route=AQByAAcABAAFAFgAYABeAAoAeAAZAHIA` ("שדה נחמיה -> בניאס -> גן הצפון -> שדה נחמיה"). Choose a slug, e.g. `shdeh-nehemia-baniyas`.

- [ ] Decide whether `id` migration of existing `segments.json` warning entries is **lazy** (add an id only when a featured route excludes it) or **eager** (add ids to all entries in this PR). Default: **lazy** — change `getActiveRouteDataPoints` to honor an existing `id` if present, otherwise fall back to the current `${segmentName}-${index}` runtime id. This keeps the diff to `segments.json` minimal.

### Acceptance Criteria

- `npm test` and Playwright smoke pass on a clean checkout.
- The migration target route and `id` migration strategy are written down (in PR description or here).

---

## Phase 1: Client-Side Routing

### Scope

Install `react-router-dom` and route `/`, `/featured`, `/featured/:slug` through it. The two new routes render placeholders; the existing planner at `/` is unchanged. Add the GitHub Pages SPA fallback.

### Tasks

- [ ] Install `react-router-dom`.
  - Run: `npm install react-router-dom@^6`
  - Expected: `package.json` and `package-lock.json` updated.

- [ ] Wire the router in `src/main.jsx`. Wrap the existing `<App />` so it only mounts on `/`:

```jsx
// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import FeaturedIndexPage from "./pages/FeaturedIndexPage.jsx";
import FeaturedRoutePage from "./pages/FeaturedRoutePage.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/featured" element={<FeaturedIndexPage />} />
      <Route path="/featured/:slug" element={<FeaturedRoutePage />} />
      <Route path="*" element={<App />} />
    </Routes>
  </BrowserRouter>,
);
```

- [ ] Create `src/pages/FeaturedIndexPage.jsx` as a placeholder:

```jsx
import React from "react";
export default function FeaturedIndexPage() {
  return <div className="featured-index-placeholder">Featured routes (gallery TBD)</div>;
}
```

- [ ] Create `src/pages/FeaturedRoutePage.jsx` as a placeholder that reads the slug:

```jsx
import React from "react";
import { useParams } from "react-router-dom";
export default function FeaturedRoutePage() {
  const { slug } = useParams();
  return <div className="featured-route-placeholder">Featured route: {slug}</div>;
}
```

- [ ] Create `public/404.html` as a copy of `index.html` so GitHub Pages serves the SPA shell for unknown deep links.
  - Run: `cp index.html public/404.html`
  - Verify the `<title>` and meta tags remain meaningful; this file gets served when GitHub Pages can't find a path.

- [ ] Verify the existing planner at `/` still works.
  - Run: `npm run dev`
  - Open `http://127.0.0.1:5173/` — should look identical to before.
  - Open `http://127.0.0.1:5173/featured` — should show the index placeholder.
  - Open `http://127.0.0.1:5173/featured/foo` — should show "Featured route: foo".

- [ ] Add a Playwright smoke test at `tests/e2e/featured-routes-routing.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("placeholder /featured index renders", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator(".featured-index-placeholder")).toBeVisible();
});

test("placeholder /featured/:slug page renders with slug", async ({ page }) => {
  await page.goto("/featured/test-route");
  await expect(page.locator(".featured-route-placeholder")).toContainText("test-route");
});

test("existing planner at / still loads the map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".map-container")).toBeVisible();
});
```

- [ ] Run the new Playwright test.
  - Run: `npm run test:smoke -- --project=desktop tests/e2e/featured-routes-routing.spec.mjs`
  - Expected: all three tests pass.

- [ ] Commit.

```bash
git add package.json package-lock.json src/main.jsx src/pages public/404.html tests/e2e/featured-routes-routing.spec.mjs
git commit -m "feat(featured-routes): add react-router and placeholder featured routes"
```

### Acceptance Criteria

- `/` renders the existing planner unchanged.
- `/featured` and `/featured/:slug` render their placeholders.
- `public/404.html` exists and matches `index.html`.
- The new Playwright tests pass.
- All existing tests pass.

---

## Phase 2: POI Types Shared Module

### Scope

Move the per-warning constants out of `src/App.jsx` into a shared module, extend with new POI types, and update `getActiveRouteDataPoints` in `src/routing/routeActions.js` to honor a stable `id` when present on a `segments.json` entry. No UI changes outside the existing planner.

### Tasks

- [ ] Create `src/data/poiTypes.js`:

```js
export const POI_LABELS = {
  // existing warnings
  payment: "תשלום",
  gate: "שער",
  mud: "בוץ",
  warning: "אזהרה",
  slope: "שיפוע",
  narrow: "שוליים צרים",
  severe: "סכנה",
  // new POI types
  viewpoint: "תצפית",
  landmark: "אתר היסטורי",
  cafe: "בית קפה",
  restaurant: "מסעדה",
  bike_shop: "חנות אופניים",
  flora: "פרחים",
  nature: "טבע",
  rest_stop: "פינת מנוחה",
};

export const POI_COLORS = {
  // existing warnings
  payment: "#4a5783",
  mud: "#9d744d",
  warning: "#FF9800",
  slope: "#8e5b9a",
  narrow: "#d6568b",
  severe: "#ff675b",
  gate: "#FF5722",
  // new POI types
  viewpoint: "#3aa17e",
  landmark: "#6c5ce7",
  cafe: "#b07a3f",
  restaurant: "#c0392b",
  bike_shop: "#2980b9",
  flora: "#e84393",
  nature: "#27ae60",
  rest_stop: "#16a085",
};

export const POI_EMOJIS = {
  // existing warnings
  payment: "💵",
  gate: "🚧",
  mud: "⚠️",
  warning: "⚠️",
  slope: "⛰️",
  narrow: "⛍",
  severe: "‼️",
  // new POI types
  viewpoint: "🔭",
  landmark: "🏛️",
  cafe: "☕",
  restaurant: "🍽️",
  bike_shop: "🚲",
  flora: "🌼",
  nature: "🌿",
  rest_stop: "🪑",
};

export const POI_WARNING_PRIORITY = [
  "severe",
  "narrow",
  "gate",
  "slope",
  "mud",
  "payment",
  "warning",
];

export const POI_WARNING_TYPES = new Set(POI_WARNING_PRIORITY);

export function isWarningType(type) {
  return POI_WARNING_TYPES.has(type);
}
```

- [ ] In `src/App.jsx`, replace the inline `WARNING_TRANSLATIONS`, `WARNING_COLORS`, `WARNING_EMOJIS`, `WARNING_PRIORITY` constants with imports from `src/data/poiTypes.js`. Rename references in-file from `WARNING_*` to the imported `POI_*` names.

```jsx
import {
  POI_COLORS as WARNING_COLORS,
  POI_EMOJIS as WARNING_EMOJIS,
  POI_LABELS as WARNING_TRANSLATIONS,
  POI_WARNING_PRIORITY as WARNING_PRIORITY,
} from "./data/poiTypes.js";
```

(Aliased to keep the rest of `App.jsx` unchanged for this phase. A later phase can rename in place if desired.)

- [ ] Update `src/routing/routeActions.js` `getActiveRouteDataPoints` to honor a stable `id` on the POI when present:

```js
// inside getActiveRouteDataPoints — replace existing id construction
const stableId = typeof dataPoint.id === "string" && dataPoint.id.length > 0
  ? dataPoint.id
  : `${segmentName}-${index}`;
if (seen.has(stableId)) return;
// ...
seen.add(stableId);
active.push({
  ...dataPoint,
  id: stableId,
  segmentName,
  routeDistanceMeters,
});
```

- [ ] Add a node test at `tests/test-poi-types.mjs` that verifies stable id passthrough:

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  createRouteManager,
  addPoint,
} from "../src/routing/routeActions.js";

const require = createRequire(import.meta.url);
const RouteManager = require("../route-manager.js");

const geoJsonData = JSON.parse(
  await readFile(new URL("./bike_roads_test.geojson", import.meta.url)),
);

// build a test segments file inline with a stable-id POI
const baseSegments = JSON.parse(
  await readFile(new URL("./segments-test.json", import.meta.url)),
);
const segmentName = Object.keys(baseSegments)[0];
baseSegments[segmentName] = {
  ...baseSegments[segmentName],
  data: [{
    type: "cafe",
    id: "cafe-test-1",
    information: "test cafe",
    location: [33.1, 35.58],
  }],
};

const manager = await createRouteManager(RouteManager, geoJsonData, baseSegments);
// Adding points to cross the segment — coordinates pulled from existing test
let snapshot = addPoint(manager, { lat: 33.128, lng: 35.5836 }, baseSegments);
snapshot = addPoint(manager, { lat: 33.1107, lng: 35.5787 }, baseSegments);

// The test segment may or may not be on the route; the important behavior:
// if a data point has an id, the resulting activeDataPoint must carry that id.
for (const dp of snapshot.activeDataPoints) {
  if (dp.segmentName === segmentName) {
    assert.equal(dp.id, "cafe-test-1");
  }
}
console.log("POI types tests passed");
```

- [ ] Wire the new test into the `test` script in `package.json`:

```diff
- "test": "node tests/test-route-manager-snap.js && ... && cd tests && node test-route-manager.js",
+ "test": "node tests/test-route-manager-snap.js && ... && node tests/test-poi-types.mjs && cd tests && node test-route-manager.js",
```

- [ ] Run all tests.
  - Run: `npm test`
  - Expected: all pass, including the new POI types test.

- [ ] Run Playwright smoke to confirm the planner UI still renders warnings correctly (the alias means visual output should be unchanged).
  - Run: `npm run test:smoke -- --project=desktop`
  - Expected: pass.

- [ ] Commit.

```bash
git add src/data/poiTypes.js src/App.jsx src/routing/routeActions.js tests/test-poi-types.mjs package.json
git commit -m "refactor(featured-routes): extract POI type constants and support stable POI ids"
```

### Acceptance Criteria

- `src/data/poiTypes.js` is the single source of truth for POI labels, colors, emojis.
- The existing planner UI (warnings legend, segment popups) is visually identical.
- `getActiveRouteDataPoints` returns the stable `id` from the data entry when present.
- All tests pass.

---

## Phase 3: FeaturedRoute Shell And Context

### Scope

Build the `<FeaturedRoute>` shell that loads map assets, decodes a featured route's encoded geometry, computes `activeDataPoints`, and provides everything on a context for slot components. Render only the header for now — slot components arrive in Phase 4.

### Tasks

- [ ] Create `src/components/featured/FeaturedRouteContext.js`:

```js
import { createContext, useContext } from "react";

export const FeaturedRouteContext = createContext(null);

export function useFeaturedRoute() {
  const ctx = useContext(FeaturedRouteContext);
  if (!ctx) {
    throw new Error("useFeaturedRoute must be used inside <FeaturedRoute>");
  }
  return ctx;
}
```

- [ ] Create `src/components/featured/Header.jsx`:

```jsx
import React from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function FeaturedRouteHeader() {
  const { meta, routeState, status } = useFeaturedRoute();
  const distanceKm = (routeState.distance / 1000).toFixed(1);
  return (
    <header className="featured-route-header">
      {meta.hero && (
        <img className="featured-route-hero" src={meta.hero} alt={meta.name} />
      )}
      <div className="featured-route-header-body">
        <h1>{meta.name}</h1>
        {meta.summary && <p className="featured-route-summary">{meta.summary}</p>}
        {status === "ready" && (
          <div className="featured-route-stats">
            <span>📏 {distanceKm} ק"מ</span>
            <span>⬆️ {Math.round(routeState.elevationGain)} מ'</span>
            <span>⬇️ {Math.round(routeState.elevationLoss)} מ'</span>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] Create `src/components/featured/FeaturedRoute.jsx` — the shell:

```jsx
import React, { useEffect, useMemo, useState } from "react";
import { loadMapAssets } from "../../data/mapAssets.js";
import {
  createRouteManager,
  emptyRouteSnapshot,
  restoreRouteFromParam,
} from "../../routing/routeActions.js";
import { FeaturedRouteContext } from "./FeaturedRouteContext.js";
import FeaturedRouteHeader from "./Header.jsx";

function FeaturedRoute({ meta, children }) {
  const [assets, setAssets] = useState(null);
  const [routeState, setRouteState] = useState(emptyRouteSnapshot());
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [focusedPoiId, setFocusedPoiId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const loaded = await loadMapAssets({ signal: controller.signal });
        if (controller.signal.aborted) return;
        const manager = await createRouteManager(
          window.RouteManager,
          loaded.geoJsonData,
          loaded.segmentsData,
        );
        if (controller.signal.aborted) return;
        const snapshot = restoreRouteFromParam(
          manager,
          meta.route,
          loaded.segmentsData,
        );
        if (!snapshot) {
          throw new Error(`Featured route "${meta.slug}" failed to decode`);
        }
        setAssets({ ...loaded, manager });
        setRouteState(snapshot);
        setStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [meta.route, meta.slug]);

  const contextValue = useMemo(
    () => ({
      meta,
      assets,
      routeState,
      status,
      error,
      focusedPoiId,
      setFocusedPoiId,
    }),
    [meta, assets, routeState, status, error, focusedPoiId],
  );

  return (
    <FeaturedRouteContext.Provider value={contextValue}>
      <article className="featured-route">
        <FeaturedRouteHeader />
        {status === "loading" && <div className="featured-route-loading">טוען מסלול…</div>}
        {status === "error" && (
          <div className="featured-route-error">שגיאה: {error?.message}</div>
        )}
        {status === "ready" && (
          <div className="featured-route-body">{children}</div>
        )}
      </article>
    </FeaturedRouteContext.Provider>
  );
}

// Slot placeholders — filled in Phase 4. These exist so authored modules can
// reference them now without crashing.
FeaturedRoute.Map = function FeaturedRouteMapSlot() { return null; };
FeaturedRoute.POIs = function FeaturedRoutePOIsSlot() { return null; };
FeaturedRoute.Gallery = function FeaturedRouteGallerySlot() { return null; };
FeaturedRoute.Video = function FeaturedRouteVideoSlot() { return null; };
FeaturedRoute.Warnings = function FeaturedRouteWarningsSlot() { return null; };

export default FeaturedRoute;
```

- [ ] Add a first authored route at `src/featured/sovev-beit-hillel.jsx`. The author can replace the `route` token and hero with the real encoded value and image; the structure must compile and render now:

```jsx
import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export const meta = {
  slug: "sovev-beit-hillel",
  name: "סובב בית הלל",
  summary: "מסלול קצר ונעים מסביב לבית הלל",
  route: "u2RR2EzQKyMNaQSfoLh5fhMieHKFiE8qzNLPTbbR5jf2",
  hero: null,
  difficulty: "easy",
  tags: ["family-friendly", "river"],
};

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute meta={meta}>
      <p>תיאור המסלול — מתחלף בתוכן אמיתי בהמשך.</p>
    </FeaturedRoute>
  );
}
```

- [ ] Create `src/featured/index.js`:

```js
const metaModules = import.meta.glob("./*.jsx", {
  eager: true,
  import: "meta",
});
const componentLoaders = import.meta.glob("./*.jsx");

export const featuredRoutes = Object.entries(metaModules)
  .map(([path, meta]) => ({ meta, load: componentLoaders[path] }))
  .filter((entry) => entry.meta && entry.meta.slug);

export function findFeaturedRoute(slug) {
  return featuredRoutes.find((entry) => entry.meta.slug === slug) || null;
}
```

- [ ] Replace the placeholder `src/pages/FeaturedRoutePage.jsx`:

```jsx
import React, { Suspense, lazy, useMemo } from "react";
import { useParams } from "react-router-dom";
import { findFeaturedRoute } from "../featured/index.js";

export default function FeaturedRoutePage() {
  const { slug } = useParams();
  const entry = findFeaturedRoute(slug);

  const LazyRoute = useMemo(() => {
    if (!entry) return null;
    return lazy(() => entry.load());
  }, [entry]);

  if (!entry) {
    return <div className="featured-route-404">לא נמצא מסלול בשם "{slug}".</div>;
  }
  return (
    <Suspense fallback={<div className="featured-route-loading">טוען מסלול…</div>}>
      <LazyRoute />
    </Suspense>
  );
}
```

- [ ] Manually verify in the browser.
  - Run: `npm run dev`
  - Open `http://127.0.0.1:5173/featured/sovev-beit-hillel`.
  - Expected: header band shows the name "סובב בית הלל", summary, and (once map assets load) distance/elevation stats. The body contains the temporary `<p>`.
  - Open `http://127.0.0.1:5173/featured/does-not-exist`.
  - Expected: the 404 message renders.

- [ ] Add a Playwright test at `tests/e2e/featured-route-shell.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("featured route shell renders header for known slug", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("featured route page returns 404-style message for unknown slug", async ({ page }) => {
  await page.goto("/featured/zzz-not-real");
  await expect(page.locator(".featured-route-404")).toBeVisible();
});
```

- [ ] Run all tests.
  - Run: `npm test && npm run test:smoke -- --project=desktop`
  - Expected: pass.

- [ ] Commit.

```bash
git add src/components/featured src/featured src/pages/FeaturedRoutePage.jsx tests/e2e/featured-route-shell.spec.mjs
git commit -m "feat(featured-routes): add FeaturedRoute shell, context, and module discovery"
```

### Acceptance Criteria

- A featured route module at `src/featured/sovev-beit-hillel.jsx` renders at `/featured/sovev-beit-hillel`.
- The shell decodes `meta.route` via the existing `restoreRouteFromParam` and exposes `routeState` on context.
- Unknown slugs show a 404 message.
- Slot components (`<FeaturedRoute.Map>` etc.) exist as no-op placeholders so authored modules compile.

---

## Phase 4: Slot Components

### Scope

Implement the slot components: `POIs`, `Gallery`, `Video`, `Warnings`, and the inline mobile map (`Map`). Desktop sticky map arrives in Phase 5.

### Tasks

- [ ] Create `src/components/featured/POIList.jsx` and `POICard.jsx`.

`POICard.jsx`:

```jsx
import React from "react";
import { POI_EMOJIS, POI_LABELS } from "../../data/poiTypes.js";

export default function POICard({ poi, focused, onSelect }) {
  return (
    <button
      type="button"
      className={`poi-card${focused ? " poi-card--focused" : ""}`}
      onClick={() => onSelect(poi)}
    >
      <div className="poi-card-header">
        <span className="poi-card-emoji" aria-hidden="true">
          {POI_EMOJIS[poi.type] || "📍"}
        </span>
        <div>
          <div className="poi-card-title">{poi.name || POI_LABELS[poi.type] || poi.type}</div>
          <div className="poi-card-type">{POI_LABELS[poi.type] || poi.type}</div>
        </div>
      </div>
      {poi.photo && <img className="poi-card-photo" src={poi.photo} alt={poi.name || poi.type} />}
      {poi.information && <p className="poi-card-info">{poi.information}</p>}
      {(poi.phone || poi.website || poi.hours) && (
        <ul className="poi-card-meta">
          {poi.phone && <li>📞 <a href={`tel:${poi.phone}`}>{poi.phone}</a></li>}
          {poi.website && <li>🌐 <a href={poi.website} target="_blank" rel="noreferrer">אתר</a></li>}
          {poi.hours && <li>🕒 {poi.hours}</li>}
        </ul>
      )}
    </button>
  );
}
```

`POIList.jsx`:

```jsx
import React, { useMemo } from "react";
import { isWarningType } from "../../data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import POICard from "./POICard.jsx";

export default function POIList({ exclude = [], extra = [], mode = "auto" }) {
  const { routeState, focusedPoiId, setFocusedPoiId } = useFeaturedRoute();
  const excludeSet = useMemo(() => new Set(exclude), [exclude]);

  const items = useMemo(() => {
    const auto = mode === "manual"
      ? []
      : routeState.activeDataPoints
          .filter((p) => !excludeSet.has(p.id))
          .filter((p) => !isWarningType(p.type));
    return [...auto, ...extra];
  }, [routeState.activeDataPoints, excludeSet, extra, mode]);

  if (items.length === 0) return null;

  return (
    <section className="poi-list">
      <h2>נקודות עניין בדרך</h2>
      <div className="poi-list-grid">
        {items.map((poi) => (
          <POICard
            key={poi.id || `${poi.type}-${poi.location?.join(",")}`}
            poi={poi}
            focused={focusedPoiId === poi.id}
            onSelect={(p) => setFocusedPoiId(p.id)}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] Create `src/components/featured/Gallery.jsx`:

```jsx
import React from "react";

export default function Gallery({ photos = [] }) {
  if (photos.length === 0) return null;
  return (
    <section className="featured-gallery">
      <h2>תמונות</h2>
      <div className="featured-gallery-grid">
        {photos.map((photo, index) => {
          const src = typeof photo === "string" ? photo : photo.src;
          const caption = typeof photo === "string" ? null : photo.caption;
          return (
            <figure key={src + index} className="featured-gallery-item">
              <img src={src} alt={caption || ""} loading="lazy" />
              {caption && <figcaption>{caption}</figcaption>}
            </figure>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] Create `src/components/featured/VideoEmbed.jsx`:

```jsx
import React, { useEffect, useRef, useState } from "react";

function toEmbed(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      return `https://player.vimeo.com/video${u.pathname}`;
    }
  } catch {}
  return url;
}

export default function VideoEmbed({ src }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  if (!src) return null;

  return (
    <section ref={ref} className="featured-video">
      <h2>סרטון</h2>
      <div className="featured-video-frame">
        {visible && (
          <iframe
            src={toEmbed(src)}
            title="סרטון המסלול"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        )}
      </div>
    </section>
  );
}
```

- [ ] Create `src/components/featured/Warnings.jsx`:

```jsx
import React, { useMemo } from "react";
import { isWarningType, POI_EMOJIS, POI_LABELS } from "../../data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function Warnings({ extra = [], hide = [] }) {
  const { routeState } = useFeaturedRoute();
  const hideSet = useMemo(() => new Set(hide), [hide]);
  const items = useMemo(() => {
    const auto = routeState.activeDataPoints
      .filter((p) => isWarningType(p.type))
      .filter((p) => !hideSet.has(p.id));
    return [...auto, ...extra];
  }, [routeState.activeDataPoints, hideSet, extra]);

  if (items.length === 0) return null;
  return (
    <section className="featured-warnings">
      <h2>אזהרות בדרך</h2>
      <ul>
        {items.map((w, i) => (
          <li key={w.id || i}>
            <span aria-hidden="true">{POI_EMOJIS[w.type] || "⚠️"}</span>{" "}
            <strong>{POI_LABELS[w.type] || w.type}:</strong> {w.information}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] Create `src/components/featured/FeaturedRouteMap.jsx` — the inline mobile map slot. Desktop renders nothing here (sticky map is rendered by the shell in Phase 5).

```jsx
import React, { useState } from "react";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "../../map/mapLayers.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

const MOBILE_QUERY = "(max-width: 767px)";

function useIsMobile() {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setMatch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return match;
}

export default function FeaturedRouteMapSlot() {
  const isMobile = useIsMobile();
  const { assets, routeState, focusedPoiId, setFocusedPoiId } = useFeaturedRoute();
  const [fullscreen, setFullscreen] = useState(false);

  if (!isMobile || !assets) return null;

  const dataMarkerFeatures = dataMarkerFeaturesFromSegments(assets.segmentsData);
  const activeDataPointIds = routeState.activeDataPoints.map((p) => p.id);

  return (
    <>
      <div className={`featured-map-inline${fullscreen ? " featured-map-inline--hidden" : ""}`}>
        <MapView
          geoJsonData={assets.geoJsonData}
          dataMarkerFeatures={dataMarkerFeatures}
          activeDataPointIds={activeDataPointIds}
          routeGeometry={routeState.geometry}
          routePoints={routeState.points}
          onDataMarkerClick={(marker) => setFocusedPoiId(marker.id)}
        />
        <button
          type="button"
          className="featured-map-fullscreen-btn"
          onClick={() => setFullscreen(true)}
        >
          מפה מלאה
        </button>
      </div>
      {fullscreen && (
        <div className="featured-map-fullscreen-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="featured-map-fullscreen-close"
            onClick={() => setFullscreen(false)}
          >
            סגור
          </button>
          <MapView
            geoJsonData={assets.geoJsonData}
            dataMarkerFeatures={dataMarkerFeatures}
            activeDataPointIds={activeDataPointIds}
            routeGeometry={routeState.geometry}
            routePoints={routeState.points}
            onDataMarkerClick={(marker) => setFocusedPoiId(marker.id)}
          />
        </div>
      )}
    </>
  );
}
```

- [ ] Wire the slot components into the shell. Replace the no-op placeholders in `FeaturedRoute.jsx`:

```jsx
import POIList from "./POIList.jsx";
import Gallery from "./Gallery.jsx";
import VideoEmbed from "./VideoEmbed.jsx";
import Warnings from "./Warnings.jsx";
import FeaturedRouteMapSlot from "./FeaturedRouteMap.jsx";

// at the bottom, replace the placeholder assignments:
FeaturedRoute.Map = FeaturedRouteMapSlot;
FeaturedRoute.POIs = POIList;
FeaturedRoute.Gallery = Gallery;
FeaturedRoute.Video = VideoEmbed;
FeaturedRoute.Warnings = Warnings;
```

- [ ] Update `src/featured/sovev-beit-hillel.jsx` to exercise the slots:

```jsx
import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export const meta = {
  slug: "sovev-beit-hillel",
  name: "סובב בית הלל",
  summary: "מסלול קצר ונעים מסביב לבית הלל",
  route: "u2RR2EzQKyMNaQSfoLh5fhMieHKFiE8qzNLPTbbR5jf2",
  hero: null,
  difficulty: "easy",
  tags: ["family-friendly", "river"],
};

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute meta={meta}>
      <p>תיאור המסלול — לדוגמה.</p>
      <FeaturedRoute.Map />
      <FeaturedRoute.Warnings />
      <FeaturedRoute.POIs
        extra={[{
          type: "cafe",
          id: "demo-cafe-1",
          name: "בית קפה לדוגמה",
          information: "להחליף בתוכן אמיתי",
          location: [33.21, 35.60],
        }]}
      />
      <FeaturedRoute.Gallery photos={[]} />
      <FeaturedRoute.Video src={undefined} />
    </FeaturedRoute>
  );
}
```

- [ ] Add Playwright assertions in a new file `tests/e2e/featured-route-slots.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("POI section renders extra POIs on featured route", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".poi-list")).toBeVisible();
  await expect(page.locator(".poi-card-title", { hasText: "בית קפה לדוגמה" })).toBeVisible();
});

test("empty gallery slot does not render a Photos section", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-gallery")).toHaveCount(0);
});
```

- [ ] Run tests.
  - Run: `npm run test:smoke -- --project=desktop tests/e2e/featured-route-slots.spec.mjs`
  - Expected: pass.

- [ ] Commit.

```bash
git add src/components/featured src/featured/sovev-beit-hillel.jsx tests/e2e/featured-route-slots.spec.mjs
git commit -m "feat(featured-routes): add POI, gallery, video, warning, and inline mobile map slots"
```

### Acceptance Criteria

- `<FeaturedRoute.POIs extra={[...]}>` renders inline-supplied POIs as cards.
- `<FeaturedRoute.Gallery photos={[]}>` renders nothing.
- `<FeaturedRoute.Video src={undefined}>` renders nothing.
- `<FeaturedRoute.Warnings>` surfaces warning-type entries from `activeDataPoints`.
- On mobile viewport, `<FeaturedRoute.Map>` renders an inline map with a "מפה מלאה" button that opens a fullscreen overlay; on desktop it renders nothing (until Phase 5).
- All tests pass.

---

## Phase 5: Layout — Desktop Sticky Map + Mobile Article

### Scope

Implement the desktop sticky-map split layout (map on one column, content on the other) and the mobile article-first single-column layout. Add the map–POI focus sync.

### Tasks

- [ ] Add CSS at `src/components/featured/featured.css` (imported from `FeaturedRoute.jsx`):

```css
.featured-route { display: block; }

.featured-route-header { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.featured-route-header img.featured-route-hero {
  width: 100%; max-height: 320px; object-fit: cover; border-radius: 8px;
}
.featured-route-stats { display: flex; gap: 16px; flex-wrap: wrap; }

.featured-route-body { padding: 16px; }

.featured-route-layout-desktop {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) minmax(360px, 480px);
  gap: 24px;
  align-items: start;
}
.featured-route-layout-desktop .featured-route-sticky-map {
  position: sticky;
  top: 16px;
  height: calc(100vh - 32px);
}

.featured-map-inline { position: relative; height: 280px; margin: 16px 0; }
.featured-map-fullscreen-btn {
  position: absolute; top: 8px; inset-inline-end: 8px;
  background: rgba(255,255,255,0.92); border: 1px solid #ccc; border-radius: 6px;
  padding: 4px 8px; cursor: pointer;
}
.featured-map-inline--hidden { display: none; }
.featured-map-fullscreen-overlay {
  position: fixed; inset: 0; background: #fff; z-index: 1000;
  display: flex; flex-direction: column;
}
.featured-map-fullscreen-close {
  position: absolute; top: 12px; inset-inline-end: 12px; z-index: 1;
  background: #fff; border: 1px solid #ccc; border-radius: 6px;
  padding: 6px 10px; cursor: pointer;
}

.poi-list-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.poi-card { text-align: start; padding: 12px; border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; }
.poi-card--focused { border-color: #3aa17e; box-shadow: 0 0 0 2px rgba(58,161,126,0.2); }
.poi-card-photo { width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-top: 8px; }

.featured-gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }

@media (max-width: 767px) {
  .featured-route-layout-desktop { grid-template-columns: 1fr; }
  .featured-route-layout-desktop .featured-route-sticky-map { display: none; }
  .featured-gallery-grid {
    grid-auto-flow: column;
    grid-auto-columns: 80%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  .featured-gallery-item { scroll-snap-align: start; }
}
```

- [ ] Update `FeaturedRoute.jsx` to render the responsive layout. Replace the body section:

```jsx
import "./featured.css";
import MapView from "../../map/MapView.jsx";
import { dataMarkerFeaturesFromSegments } from "../../map/mapLayers.js";

// inside the return, replace the body div:
{status === "ready" && (
  <div className="featured-route-layout-desktop">
    <div className="featured-route-body">{children}</div>
    <div className="featured-route-sticky-map">
      <MapView
        geoJsonData={assets.geoJsonData}
        dataMarkerFeatures={dataMarkerFeaturesFromSegments(assets.segmentsData)}
        activeDataPointIds={routeState.activeDataPoints.map((p) => p.id)}
        routeGeometry={routeState.geometry}
        routePoints={routeState.points}
        onDataMarkerClick={(marker) => setFocusedPoiId(marker.id)}
      />
    </div>
  </div>
)}
```

The CSS hides the sticky map column under 768px, so on mobile only the body column (with the inline `<FeaturedRoute.Map>` slot) shows.

- [ ] Implement focus sync. The cleanest model: `POIList` is the source of truth for *which POI* is selected and *where it is on the map*, because it has access to both auto POIs (from `activeDataPoints`) and inline `extra` POIs. The shell exposes two context setters:

```jsx
// in FeaturedRoute.jsx — add state and expose setters via context
const [focusedCoord, setFocusedCoord] = useState(null);

// extend contextValue:
const contextValue = useMemo(
  () => ({
    meta,
    assets,
    routeState,
    status,
    error,
    focusedPoiId,
    setFocusedPoiId,
    focusedCoord,
    setFocusedCoord,
  }),
  [meta, assets, routeState, status, error, focusedPoiId, focusedCoord],
);
```

- [ ] Add a `focusedMarker` prop to `MapView.jsx`:

```jsx
// extend the destructured props in MapView({...})
focusedMarker, // { coord: { lat, lng } } | null

// add an effect inside MapView, after mapRef is set up
useEffect(() => {
  if (!focusedMarker || !mapRef.current) return;
  mapRef.current.flyTo({
    center: [focusedMarker.coord.lng, focusedMarker.coord.lat],
    zoom: Math.max(mapRef.current.getZoom(), 14),
    speed: 1.2,
  });
}, [focusedMarker]);
```

- [ ] Update `POIList.jsx` to set both `focusedPoiId` and `focusedCoord` on selection, and scroll-into-view on mobile:

```jsx
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function POIList({ exclude = [], extra = [], mode = "auto" }) {
  const { routeState, focusedPoiId, setFocusedPoiId, setFocusedCoord } =
    useFeaturedRoute();
  // ... existing items computation ...

  function handleSelect(poi) {
    setFocusedPoiId(poi.id);
    if (poi.location && Number.isFinite(poi.location[0])) {
      const [lat, lng] = poi.location;
      setFocusedCoord({ lat, lng });
    }
    if (window.matchMedia("(max-width: 767px)").matches) {
      document.querySelector(".featured-map-inline")?.scrollIntoView({
        behavior: "smooth", block: "start",
      });
    }
  }

  // pass handleSelect into <POICard onSelect={() => handleSelect(poi)} />
}
```

- [ ] Pass `focusedMarker` into both `MapView` instances (the desktop sticky map in `FeaturedRoute.jsx` and the inline mobile map in `FeaturedRouteMap.jsx`):

```jsx
// in both places, derive from context:
const { focusedCoord } = useFeaturedRoute();
const focusedMarker = focusedCoord ? { coord: focusedCoord } : null;

<MapView
  /* existing props */
  focusedMarker={focusedMarker}
/>
```

- [ ] Trigger an initial map fit. The featured route should zoom to its full geometry once the route is decoded. Use the existing `routeFitRequest` prop on `MapView`:

```jsx
// in FeaturedRoute.jsx — add state and effect
const [routeFitRequest, setRouteFitRequest] = useState(null);

useEffect(() => {
  if (status !== "ready" || routeState.geometry.length < 2) return;
  setRouteFitRequest({
    id: `featured-${meta.slug}-${Date.now()}`,
    geometry: routeState.geometry,
  });
}, [status, meta.slug, routeState.geometry]);

// pass routeFitRequest={routeFitRequest} into the desktop MapView
// and the inline mobile MapView
```

- [ ] Add a Playwright assertion at `tests/e2e/featured-route-layout.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("sticky map column visible on desktop", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".featured-route-sticky-map")).toBeVisible();
    await expect(page.locator(".featured-map-inline")).toHaveCount(0);
  });
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("inline map visible on mobile, sticky map hidden", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".featured-map-inline")).toBeVisible();
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);
  });

  test("fullscreen map opens and closes", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await page.locator(".featured-map-fullscreen-btn").click();
    await expect(page.locator(".featured-map-fullscreen-overlay")).toBeVisible();
    await page.locator(".featured-map-fullscreen-close").click();
    await expect(page.locator(".featured-map-fullscreen-overlay")).toHaveCount(0);
  });
});
```

- [ ] Run tests.
  - Run: `npm run test:smoke`
  - Expected: pass for both desktop and mobile projects.

- [ ] Commit.

```bash
git add src/components/featured src/map/MapView.jsx tests/e2e/featured-route-layout.spec.mjs
git commit -m "feat(featured-routes): responsive layout with sticky desktop map and mobile inline map"
```

### Acceptance Criteria

- Desktop (≥768px): featured-route body and a sticky map column render side by side; inline mobile map slot is absent.
- Mobile (<768px): single-column article with the inline map slot rendered at its place in the JSX body; sticky map column absent.
- Mobile "מפה מלאה" button opens a fullscreen modal map and the close button restores normal view.
- Clicking a POI card on desktop flies the sticky map to its location; on mobile, the inline map scrolls into view and pans.
- All Playwright tests pass.

---

## Phase 6: Featured Index Page

### Scope

Build the `/featured` gallery page and migrate the existing hardcoded "complete recommended routes" link into a featured-route JSX module. Update the homepage recommendations section to surface featured routes.

### Tasks

- [ ] Create a gallery card component at `src/components/featured/GalleryCard.jsx`:

```jsx
import React from "react";
import { Link } from "react-router-dom";

export default function FeaturedGalleryCard({ meta, distanceKm }) {
  return (
    <Link to={`/featured/${meta.slug}`} className="featured-gallery-card">
      {meta.hero && <img src={meta.hero} alt={meta.name} loading="lazy" />}
      <div className="featured-gallery-card-body">
        <h3>{meta.name}</h3>
        {meta.summary && <p>{meta.summary}</p>}
        {distanceKm != null && <div className="featured-gallery-card-stats">📏 {distanceKm} ק"מ</div>}
      </div>
    </Link>
  );
}
```

- [ ] Replace `src/pages/FeaturedIndexPage.jsx`:

```jsx
import React, { useEffect, useState } from "react";
import { loadMapAssets } from "../data/mapAssets.js";
import { createRouteManager, restoreRouteFromParam } from "../routing/routeActions.js";
import { featuredRoutes } from "../featured/index.js";
import FeaturedGalleryCard from "../components/featured/GalleryCard.jsx";

export default function FeaturedIndexPage() {
  const [distances, setDistances] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const assets = await loadMapAssets();
      const manager = await createRouteManager(
        window.RouteManager,
        assets.geoJsonData,
        assets.segmentsData,
      );
      const next = {};
      for (const entry of featuredRoutes) {
        const snapshot = restoreRouteFromParam(
          manager,
          entry.meta.route,
          assets.segmentsData,
        );
        if (snapshot) next[entry.meta.slug] = (snapshot.distance / 1000).toFixed(1);
      }
      if (!cancelled) setDistances(next);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="featured-index">
      <header>
        <h1>מסלולים מומלצים</h1>
        <p>אוסף מסלולי רכיבה מומלצים בגליל העליון וגולן.</p>
      </header>
      <div className="featured-index-grid">
        {featuredRoutes.map(({ meta }) => (
          <FeaturedGalleryCard
            key={meta.slug}
            meta={meta}
            distanceKm={distances[meta.slug]}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] Add the CSS for gallery and index:

```css
/* in src/components/featured/featured.css */
.featured-index { padding: 24px; }
.featured-index-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.featured-gallery-card {
  display: block; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;
  background: #fff; color: inherit; text-decoration: none;
}
.featured-gallery-card img { width: 100%; height: 160px; object-fit: cover; }
.featured-gallery-card-body { padding: 12px; }
.featured-gallery-card-stats { color: #666; font-size: 0.9em; margin-top: 6px; }
```

- [ ] Migrate the existing hardcoded route. Create `src/featured/shdeh-nehemia-baniyas.jsx`:

```jsx
import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export const meta = {
  slug: "shdeh-nehemia-baniyas",
  name: "שדה נחמיה → בניאס → גן הצפון → שדה נחמיה",
  summary: "מסלול קצר ונוח, מומלץ במיוחד לחובבי רכיבה ראשונית, עם פינות מנוחה רבות.",
  route: "AQByAAcABAAFAFgAYABeAAoAeAAZAHIA",
  hero: null,
  difficulty: "easy",
  tags: ["beginner-friendly"],
};

export default function ShdehNehemiaBaniyas() {
  return (
    <FeaturedRoute meta={meta}>
      <p>{meta.summary}</p>
      <FeaturedRoute.Map />
      <FeaturedRoute.Warnings />
      <FeaturedRoute.POIs />
    </FeaturedRoute>
  );
}
```

- [ ] Update `src/components/ContentSections.jsx`. Replace the "מסלולים שלמים מומלצים" block with a link to `/featured` plus inline featured-route cards:

```jsx
// near the top
import { Link } from "react-router-dom";
import { featuredRoutes } from "../featured/index.js";
import FeaturedGalleryCard from "./featured/GalleryCard.jsx";

// replace the existing <h2>מסלולים שלמים מומלצים</h2> block and its <ul>:
<h2>מסלולים שלמים מומלצים</h2>
<p>
  אוסף מסלולים שלמים מומלצים. ראו את כולם ב
  <Link to="/featured">דף המסלולים המומלצים</Link>.
</p>
<div className="featured-index-grid featured-index-grid--inline">
  {featuredRoutes.slice(0, 4).map(({ meta }) => (
    <FeaturedGalleryCard key={meta.slug} meta={meta} />
  ))}
</div>
```

Leave the "קטעים מומלצים לרכיבה" (recommended segments) block untouched — those are segment-level recommendations and remain part of the planner page.

- [ ] Add Playwright tests at `tests/e2e/featured-index.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("/featured gallery lists known featured routes", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator(".featured-gallery-card", { hasText: "סובב בית הלל" })).toBeVisible();
  await expect(page.locator(".featured-gallery-card", { hasText: "שדה נחמיה" })).toBeVisible();
});

test("clicking a gallery card opens its featured-route page", async ({ page }) => {
  await page.goto("/featured");
  await page.locator(".featured-gallery-card", { hasText: "סובב בית הלל" }).click();
  await expect(page).toHaveURL(/\/featured\/sovev-beit-hillel$/);
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("home page recommendations link to /featured", async ({ page }) => {
  await page.goto("/");
  await page.locator("a", { hasText: "דף המסלולים המומלצים" }).click();
  await expect(page).toHaveURL(/\/featured$/);
});
```

- [ ] Run tests.
  - Run: `npm test && npm run test:smoke`
  - Expected: pass.

- [ ] Commit.

```bash
git add src/pages/FeaturedIndexPage.jsx src/components/featured src/featured/shdeh-nehemia-baniyas.jsx src/components/ContentSections.jsx tests/e2e/featured-index.spec.mjs
git commit -m "feat(featured-routes): index page, gallery cards, and home recommendations migration"
```

### Acceptance Criteria

- `/featured` renders a card per discovered module from `src/featured/`.
- Each card links to `/featured/<slug>`.
- The home page's "מסלולים שלמים מומלצים" section shows featured-route cards and a link to `/featured`.
- The original hardcoded route is now a featured-route module, not an anchor.
- Recommended-segment buttons on the home page still work unchanged.

---

## Phase 7: Polish And Production Readiness

### Scope

Final passes for accessibility, build verification, and documentation.

### Tasks

- [ ] Verify `npm run build` produces a working dist.
  - Run: `npm run build`
  - Verify `dist/404.html` exists (copied from `public/404.html`) and is identical to `dist/index.html` (or at least serves the same SPA bundle).
  - Run: `npm run preview`
  - Visit `http://127.0.0.1:4173/featured/sovev-beit-hillel` and confirm the page renders. Visit `http://127.0.0.1:4173/featured/nonexistent` and confirm the 404 message.

- [ ] Accessibility passes on `FeaturedRoute.jsx` and slot components:
  - `<button>` elements have visible focus styles (verify in CSS).
  - `<img>` elements have `alt` attributes.
  - The fullscreen map overlay uses `role="dialog"` and `aria-modal="true"` and traps focus to the close button.

- [ ] Update `plans/featured-routes/design.md` if any implementation detail diverged from the spec — keep the spec accurate.

- [ ] Update `README.md` if there are new authoring instructions for featured routes. A short section like:

```md
## Adding a featured route

1. Create a JSX module at `src/featured/<slug>.jsx` that exports `meta`
   (slug, name, summary, encoded `route`, hero image) and a default
   React component using `<FeaturedRoute>` and its slot components.
2. Place media under `attached_assets/featured/<slug>/`.
3. POIs along the route come from `segments.json`; add new segment-level
   POIs there with a stable `id` and `location`.
4. The route appears automatically at `/featured/<slug>` and in the
   `/featured` gallery on next dev/build.
```

- [ ] Final test pass.
  - Run: `npm test && npm run test:smoke`
  - Expected: all pass.

- [ ] Commit any documentation updates.

```bash
git add README.md plans/featured-routes/design.md
git commit -m "docs(featured-routes): document authoring and final spec alignment"
```

### Acceptance Criteria

- Production build deploys cleanly to a static host (verified via `npm run preview`).
- Accessibility checks pass for keyboard navigation and screen-reader semantics on the new pages.
- Authoring instructions are documented.
- All tests pass.
