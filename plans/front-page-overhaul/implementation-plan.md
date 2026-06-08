# Front Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the desktop front page into a persistent two-column app shell — Mapbox map on the left, a right-side Discover/Build panel that owns route context — while keeping the geocoder search and play transport on the map.

**Architecture:** A new `FrontPanel` tree (toggle + collapse + Discover/Build bodies) renders alongside `MapView` inside a new two-column shell in `App.jsx`. A pure `panelState` helper drives the Discover↔Build machine (auto-switch to Build on the first route point). Discover relocates the existing `WelcomeDiscover` finder and adds a "curated-by-default, results-on-search" route list. Build relocates today's on-map route tools, stats, warnings, and POIs, and adds a banded interactive elevation graph synced to the existing playback `progress`. **Straight rollout: no feature flag.** The two-column layout is the default and only desktop layout; the relocated on-map controls are deleted (single source of truth in the panel). Narrow viewports stack the panel under the map via responsive CSS — no parallel legacy code path.

**Tech Stack:** React 18 + Vite, Mapbox GL JS, `@cycleways/core` shared package, `@turf/along`. Logic tested with `node:assert/strict` `.mjs` runners; UI tested with Playwright (`test:smoke`).

**Design spec:** `plans/front-page-overhaul/design.md`. Visual tokens/styles source of truth: `plans/front-page-overhaul/design_handoff_front_page/styles.css`.

**Conventions:**
- Logic tests live in `tests/test-*.mjs`, run with `node tests/test-<name>.mjs`, and must be appended to the `"test"` script in `package.json`.
- Playwright specs live in `tests/e2e/*.spec.mjs`, run with `npx playwright test <file> --workers=1`, and use `installMapboxMock(page)` from `tests/e2e/mapbox-mock.mjs`.
- Commit after every green step.

---

## File Structure

**New files:**

- `src/components/frontPanel/panelState.js` — pure Discover/Build state resolver.
- `src/components/frontPanel/discoverRouteList.js` — pure curated-vs-results selector + `hasActiveDiscoverFilters`.
- `src/components/frontPanel/routeSlice.js` — pure geometry slice for elevation-band map highlight.
- `src/components/frontPanel/useCatalogData.js` — loads catalog + places (for the Discover list).
- `src/components/frontPanel/FrontPanel.jsx` — panel container (collapse + toggle + body switch).
- `src/components/frontPanel/PanelStateToggle.jsx` — segmented Discover/Build toggle.
- `src/components/frontPanel/DiscoverPanel.jsx` — hint + finder + curated/results list.
- `src/components/frontPanel/BuildPanel.jsx` — route header/tools, stat strip, elevation, actions, warnings, POIs.
- `src/components/frontPanel/PanelElevationGraph.jsx` — banded interactive elevation graph.
- `src/components/frontPanel/front-panel.css` — shell + panel styles (ported tokens).
- `tests/test-panel-state.mjs`, `tests/test-discover-route-list.mjs`, `tests/test-route-slice.mjs` — logic tests.
- `tests/e2e/front-panel.spec.mjs` — panel behavior e2e.

**Modified files:**

- `src/App.jsx` — two-column shell, render `FrontPanel`, panel state, delete relocated on-map tools/warnings, keep geocoder + transport, auto-switch effect, segment-band map highlight.
- `package.json` — register the three new logic tests.

---

## Phase 0 — Empty two-column shell (default, no flag)

### Task 0.2: Two-column shell skeleton in App

The shell wraps the existing `.map-container` and an empty `<aside>` in a flex row-reverse region. This is the layout for everyone — no flag. On narrow viewports the shell stacks (map then panel) via the media query in the CSS.

**Files:**
- Modify: `src/App.jsx` (the `<div className="container">` region, around `App.jsx:235`)
- Create: `src/components/frontPanel/front-panel.css`
- Create: `src/components/frontPanel/FrontPanel.jsx`

- [ ] **Step 1: Create a minimal FrontPanel placeholder**

`src/components/frontPanel/FrontPanel.jsx`:

```jsx
import React from "react";
import "./front-panel.css";

export default function FrontPanel() {
  return (
    <aside className="front-panel" data-testid="front-panel">
      <div className="front-panel__body" />
    </aside>
  );
}
```

- [ ] **Step 2: Add the shell CSS**

`src/components/frontPanel/front-panel.css`:

```css
.front-shell {
  display: flex;
  flex-direction: row-reverse; /* RTL: map left, panel right */
  gap: 10px;
  padding: 10px;
  align-items: stretch;
  min-height: 0;
}
.front-shell .map-container {
  flex: 1 1 auto;
  min-width: 0;
}
.front-panel {
  flex: 0 0 408px;
  background: #fff;
  border: 1px solid #e7dfca;
  border-radius: 14px;
  box-shadow: 0 4px 14px rgba(40, 48, 38, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.front-panel__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px;
}
.front-shell--collapsed .front-panel {
  display: none;
}
/* Narrow viewports: stack map then panel (no parallel legacy layout). */
@media (max-width: 860px) {
  .front-shell {
    flex-direction: column;
    padding: 0;
    gap: 0;
  }
  .front-panel {
    flex: 1 1 auto;
    border-radius: 0;
  }
}
```

- [ ] **Step 3: Wrap the map region in the shell when the flag is on**

In `src/App.jsx`, import the panel near the other lazy imports (top of file):

```jsx
import FrontPanel from "./components/frontPanel/FrontPanel.jsx";
```

Replace the opening of the container region:

```jsx
        <div className="container">
          <div className="front-shell">
            <div
              className={[
                "map-container",
                plannerRouteReady ? "map-container--route-ready" : "",
                plannerPoiPreviewVisible ? "map-container--has-planner-poi" : "",
                plannerPlayback.isPlaying ? "map-container--planner-playing" : "",
              ].filter(Boolean).join(" ")}
            >
```

Then, immediately **after** the closing `</div>` of `.map-container` (the one currently at `App.jsx:422`) and **before** the closing `</div>` of `.container`, render the panel:

```jsx
            {state.status === "ready" && <FrontPanel />}
          </div>
        </div>
```

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open the app.
Expected: the map shrinks to the left, an empty white panel sits on the right. At narrow widths (<860px) the panel stacks below the map.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/frontPanel/
git commit -m "feat(front-panel): two-column shell skeleton behind frontPanelShell flag"
```

---

## Phase 1 — Panel state machine, toggle, collapse

### Task 1.1: Pure panel-state resolver (TDD)

Rules from the spec: default `discover`; placing the first route point auto-switches to `build`; clearing the route keeps `build`; an explicit user toggle always wins until the next auto-switch trigger.

**Files:**
- Create: `src/components/frontPanel/panelState.js`
- Test: `tests/test-panel-state.mjs`

- [ ] **Step 1: Write the failing test**

`tests/test-panel-state.mjs`:

```javascript
import assert from "node:assert/strict";
import { resolvePanelState, INITIAL_PANEL_STATE } from "../src/components/frontPanel/panelState.js";

// Default is discover.
assert.equal(INITIAL_PANEL_STATE.state, "discover");

// First point added (0 -> 1) auto-switches discover -> build.
let s = resolvePanelState(INITIAL_PANEL_STATE, { type: "route-points-changed", pointCount: 1 });
assert.equal(s.state, "build");

// Going from 1 -> 2 points does not re-trigger anything (stays build).
s = resolvePanelState(s, { type: "route-points-changed", pointCount: 2 });
assert.equal(s.state, "build");

// Clearing the route (back to 0) keeps build.
s = resolvePanelState(s, { type: "route-points-changed", pointCount: 0 });
assert.equal(s.state, "build");

// Adding the first point again after a clear auto-switches again (e.g. user had toggled to discover).
let d = resolvePanelState({ state: "discover", lastPointCount: 0 }, { type: "toggle", to: "discover" });
d = resolvePanelState(d, { type: "route-points-changed", pointCount: 1 });
assert.equal(d.state, "build");

// Explicit toggle wins.
let t = resolvePanelState({ state: "build", lastPointCount: 3 }, { type: "toggle", to: "discover" });
assert.equal(t.state, "discover");
t = resolvePanelState(t, { type: "toggle", to: "build" });
assert.equal(t.state, "build");

// A route-points-changed that is not a 0->1 transition never overrides a toggle.
let u = resolvePanelState({ state: "discover", lastPointCount: 2 }, { type: "route-points-changed", pointCount: 3 });
assert.equal(u.state, "discover");

console.log("panel-state ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-panel-state.mjs`
Expected: FAIL with `Cannot find module .../panelState.js`.

- [ ] **Step 3: Implement the resolver**

`src/components/frontPanel/panelState.js`:

```javascript
export const INITIAL_PANEL_STATE = { state: "discover", lastPointCount: 0 };

// Pure reducer for the Discover/Build panel.
// Events:
//   { type: "toggle", to: "discover" | "build" }      explicit user switch
//   { type: "route-points-changed", pointCount }       route geometry changed
export function resolvePanelState(prev, event) {
  if (event.type === "toggle") {
    return { ...prev, state: event.to };
  }
  if (event.type === "route-points-changed") {
    const wasEmpty = prev.lastPointCount === 0;
    const nowHasPoint = event.pointCount > 0;
    // Auto-switch to build only on the empty -> first-point transition.
    const state = wasEmpty && nowHasPoint ? "build" : prev.state;
    return { state, lastPointCount: event.pointCount };
  }
  return prev;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node tests/test-panel-state.mjs`
Expected: prints `panel-state ok`, exit 0.

- [ ] **Step 5: Register the test in package.json**

In `package.json`, append to the `"test"` script (before `&& cd tests && node test-route-manager.js`):

```
 && node tests/test-panel-state.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/components/frontPanel/panelState.js tests/test-panel-state.mjs package.json
git commit -m "feat(front-panel): pure panel-state resolver with auto-switch rule"
```

### Task 1.2: Segmented toggle component

**Files:**
- Create: `src/components/frontPanel/PanelStateToggle.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: Create the toggle**

`src/components/frontPanel/PanelStateToggle.jsx`:

```jsx
import React from "react";
import Icon from "../Icon.jsx";

export default function PanelStateToggle({ state, onChange }) {
  return (
    <div className="front-panel__statebar" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={state === "discover"}
        className={state === "discover" ? "on" : ""}
        onClick={() => onChange("discover")}
      >
        <Icon name="search-outline" /> גילוי מסלול
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={state === "build"}
        className={state === "build" ? "on" : ""}
        onClick={() => onChange("build")}
      >
        <Icon name="git-branch-outline" /> בניית מסלול
      </button>
    </div>
  );
}
```

(If `git-branch-outline` is not present in `src/components/Icon.jsx`, use an icon that is — confirm against the file's icon map before committing.)

- [ ] **Step 2: Add statebar styles**

Append to `src/components/frontPanel/front-panel.css`:

```css
.front-panel__statebar {
  display: flex;
  gap: 6px;
  padding: 10px;
  background: #faf6ec;
  border-bottom: 1px solid #efe8d7;
}
.front-panel__statebar button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  font-weight: 700;
  cursor: pointer;
}
.front-panel__statebar button.on {
  background: #fff;
  border-color: #e7dfca;
  box-shadow: 0 1px 3px rgba(40, 48, 38, 0.05);
}
```

- [ ] **Step 3: Manually verify in isolation later** (rendered in Task 1.3). For now:

Run: `npm run dev` is not required for this step; the component renders in the next task.

- [ ] **Step 4: Commit**

```bash
git add src/components/frontPanel/PanelStateToggle.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): segmented discover/build toggle"
```

### Task 1.3: Wire toggle + collapse into FrontPanel and App

**Files:**
- Modify: `src/components/frontPanel/FrontPanel.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: FrontPanel accepts state + collapse props and renders the toggle**

`src/components/frontPanel/FrontPanel.jsx`:

```jsx
import React from "react";
import PanelStateToggle from "./PanelStateToggle.jsx";
import Icon from "../Icon.jsx";
import "./front-panel.css";

export default function FrontPanel({
  panelState,
  onPanelStateChange,
  collapsed,
  onToggleCollapsed,
  discover,
  build,
}) {
  return (
    <aside className="front-panel" data-testid="front-panel">
      <div className="front-panel__head">
        <PanelStateToggle state={panelState} onChange={onPanelStateChange} />
        <button
          type="button"
          className="front-panel__collapse"
          aria-label={collapsed ? "הצג פאנל" : "הסתר פאנל"}
          onClick={onToggleCollapsed}
        >
          <Icon name={collapsed ? "chevron-back-outline" : "chevron-forward-outline"} />
        </button>
      </div>
      <div className="front-panel__body">
        {panelState === "discover" ? discover : build}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: A separate re-open affordance for the collapsed state**

When the panel is collapsed it is `display:none`, so the collapse button inside it is unreachable. Add a small floating re-open button. Append to `src/components/frontPanel/front-panel.css`:

```css
.front-panel__head {
  display: flex;
  align-items: stretch;
}
.front-panel__head .front-panel__statebar { flex: 1; border-bottom: 1px solid #efe8d7; }
.front-panel__collapse {
  border: none;
  background: #faf6ec;
  border-bottom: 1px solid #efe8d7;
  padding: 0 12px;
  cursor: pointer;
}
.front-shell__reopen {
  position: absolute;
  top: 78px;
  inset-inline-end: 18px;
  z-index: 5;
  border: 1px solid #e7dfca;
  background: #fff;
  border-radius: 10px;
  padding: 8px 10px;
  box-shadow: 0 4px 14px rgba(40, 48, 38, 0.1);
  cursor: pointer;
}
```

- [ ] **Step 3: Manage panel state in App**

In `src/App.jsx`, add imports:

```jsx
import { INITIAL_PANEL_STATE, resolvePanelState } from "./components/frontPanel/panelState.js";
```

Inside `App()` (after the `useCyclewaysApp(...)` destructure), add:

```jsx
  const [panel, setPanel] = useState(INITIAL_PANEL_STATE);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const routePointCount = routeState.points.length;

  React.useEffect(() => {
    setPanel((prev) =>
      resolvePanelState(prev, { type: "route-points-changed", pointCount: routePointCount }),
    );
  }, [routePointCount]);

  const handlePanelStateChange = useCallback((to) => {
    setPanel((prev) => resolvePanelState(prev, { type: "toggle", to }));
  }, []);
```

- [ ] **Step 4: Render FrontPanel with real props + the reopen button**

Replace the `{state.status === "ready" && <FrontPanel />}` block from Task 0.2 with:

```jsx
            {state.status === "ready" && (
              <FrontPanel
                panelState={panel.state}
                onPanelStateChange={handlePanelStateChange}
                collapsed={panelCollapsed}
                onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
                discover={<div className="front-panel__placeholder">Discover</div>}
                build={<div className="front-panel__placeholder">Build</div>}
              />
            )}
            {state.status === "ready" && panelCollapsed && (
              <button
                type="button"
                className="front-shell__reopen"
                aria-label="הצג פאנל"
                onClick={() => setPanelCollapsed(false)}
              >
                <Icon name="chevron-back-outline" />
              </button>
            )}
```

Also add the collapsed modifier to the shell wrapper className (from Task 0.2):

```jsx
            <div className={["front-shell", panelCollapsed ? "front-shell--collapsed" : ""].filter(Boolean).join(" ")}>
```

- [ ] **Step 5: Manually verify**

Run: `npm run dev`.
Expected: toggle switches the body text between "Discover" and "Build"; placing a point on the map flips it to Build; the collapse button hides the panel and a re-open button appears that restores it.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/frontPanel/
git commit -m "feat(front-panel): wire panel state machine, toggle, and collapse drawer"
```

---

## Phase 2 — Discover panel

### Task 2.1: Pure curated-vs-results selector (TDD)

**Files:**
- Create: `src/components/frontPanel/discoverRouteList.js`
- Test: `tests/test-discover-route-list.mjs`

- [ ] **Step 1: Write the failing test**

`tests/test-discover-route-list.mjs`:

```javascript
import assert from "node:assert/strict";
import {
  hasActiveDiscoverFilters,
  selectDiscoverRoutes,
} from "../src/components/frontPanel/discoverRouteList.js";

const entries = [
  { slug: "a", difficulty: "easy", featured: true },
  { slug: "b", difficulty: "moderate", featured: false },
  { slug: "c", difficulty: "easy", featured: true },
];

// Empty filter object → no active filters.
assert.equal(hasActiveDiscoverFilters({}), false);
assert.equal(
  hasActiveDiscoverFilters({ difficulty: new Set(), startLocation: new Set() }),
  false,
);
assert.equal(hasActiveDiscoverFilters({ difficulty: new Set(["easy"]) }), true);

// No active filters → recommended mode = featured entries only.
const rec = selectDiscoverRoutes(entries, {});
assert.equal(rec.mode, "recommended");
assert.deepEqual(rec.routes.map((r) => r.slug), ["a", "c"]);

// Active filter → results mode = catalogFilter output.
const res = selectDiscoverRoutes(entries, { difficulty: new Set(["moderate"]) });
assert.equal(res.mode, "results");
assert.deepEqual(res.routes.map((r) => r.slug), ["b"]);

console.log("discover-route-list ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-discover-route-list.mjs`
Expected: FAIL with `Cannot find module .../discoverRouteList.js`.

- [ ] **Step 3: Implement the selector**

`src/components/frontPanel/discoverRouteList.js`:

```javascript
import { catalogFilter } from "../catalogFilter.js";

// True if any filter axis has a selected value.
export function hasActiveDiscoverFilters(filters) {
  if (!filters) return false;
  return Object.values(filters).some(
    (value) => value instanceof Set && value.size > 0,
  );
}

// No active filters → curated "recommended" = featured entries.
// Any active filter → "results" = the full catalog finder.
export function selectDiscoverRoutes(entries, filters) {
  const list = Array.isArray(entries) ? entries : [];
  if (!hasActiveDiscoverFilters(filters)) {
    return { mode: "recommended", routes: list.filter((e) => e && e.featured) };
  }
  return { mode: "results", routes: catalogFilter(list, filters) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node tests/test-discover-route-list.mjs`
Expected: prints `discover-route-list ok`.

- [ ] **Step 5: Register the test in package.json**

Append to the `"test"` script: ` && node tests/test-discover-route-list.mjs`

- [ ] **Step 6: Commit**

```bash
git add src/components/frontPanel/discoverRouteList.js tests/test-discover-route-list.mjs package.json
git commit -m "feat(front-panel): curated-vs-results discover route selector"
```

### Task 2.2: Catalog data loader hook

Mirrors the load logic currently inside `WelcomeWizard.jsx:16-37`, lifted so the panel can use it without the modal.

**Files:**
- Create: `src/components/frontPanel/useCatalogData.js`

- [ ] **Step 1: Implement the hook**

`src/components/frontPanel/useCatalogData.js`:

```javascript
import { useEffect, useState } from "react";
import { loadCatalog } from "@cycleways/core/data/catalog.js";

export function useCatalogData() {
  const [catalog, setCatalog] = useState(null);
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCatalog();
      if (cancelled) return;
      setCatalog(c);
      try {
        const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
        const pRes = await fetch(`${base}data/places.json`);
        if (pRes.ok && !cancelled) setPlaces((await pRes.json())?.places || []);
      } catch (err) {
        console.warn("places load failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalog, places };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/frontPanel/useCatalogData.js
git commit -m "feat(front-panel): catalog+places loader hook for the discover panel"
```

### Task 2.3: DiscoverPanel — hint + finder + curated/results list

Reuses the finder controls from `WelcomeDiscover.jsx`. Because that component currently bundles its own results section, we render its **controls** and supply our own list below it. The cleanest reuse without a rewrite is to extract the controls; if that is too invasive, render `WelcomeDiscover` as-is and skip our own list. This plan extracts the filter state up so the curated/results rule applies.

**Files:**
- Modify: `src/components/WelcomeDiscover.jsx` — export the filter constants/helpers it already defines (`FILTER_GROUPS`, `emptyFilters`, `catalogFilter` usage) so they can be shared. Add named exports without changing default behavior.
- Create: `src/components/frontPanel/DiscoverPanel.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: Export the finder building blocks from WelcomeDiscover**

In `src/components/WelcomeDiscover.jsx`, add `export` to the existing declarations (do not change their bodies):

```javascript
export const FILTER_GROUPS = [ /* existing array */ ];
export function emptyFilters() { /* existing body */ }
export function FilterChip({ active, onClick, children }) { /* existing body */ }
export function PlaceAutocompleteFilter(/* existing */) { /* existing body */ }
```

(Only add the `export` keyword to whichever of these are currently module-private. Confirm each name against the file before editing.)

- [ ] **Step 2: Build DiscoverPanel**

`src/components/frontPanel/DiscoverPanel.jsx`:

```jsx
import React, { useMemo, useState } from "react";
import RouteCard from "../RouteCard.jsx";
import {
  FILTER_GROUPS,
  FilterChip,
  PlaceAutocompleteFilter,
  emptyFilters,
} from "../WelcomeDiscover.jsx";
import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
} from "@cycleways/core/data/catalog.js";
import { selectDiscoverRoutes } from "./discoverRouteList.js";

export default function DiscoverPanel({ catalog, places, onSelectRoute, onBuild }) {
  const entries = useMemo(
    () => (Array.isArray(catalog?.entries) ? catalog.entries : []),
    [catalog],
  );
  const [filters, setFilters] = useState(emptyFilters);

  const placeById = useMemo(() => {
    const map = new Map();
    for (const p of places) map.set(p.id, p);
    return map;
  }, [places]);

  const startOptions = useMemo(
    () => placeOptions(entries, placeById, routeStartPlaceIds),
    [entries, placeById],
  );
  const throughOptions = useMemo(
    () => placeOptions(entries, placeById, routePassesThroughPlaceIds),
    [entries, placeById],
  );

  const toggleAxis = (axis, value) =>
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      next.has(value) ? next.delete(value) : next.add(value);
      // single-select per pill group
      return { ...prev, [axis]: next.size > 1 ? new Set([value]) : next };
    });
  const addFilterValue = (axis, value) =>
    setFilters((prev) => ({ ...prev, [axis]: new Set(prev[axis]).add(value) }));
  const removeFilterValue = (axis, value) =>
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      next.delete(value);
      return { ...prev, [axis]: next };
    });

  const { mode, routes } = useMemo(
    () => selectDiscoverRoutes(entries, filters),
    [entries, filters],
  );

  return (
    <div className="discover-panel">
      <div className="discover-panel__intro">
        <div className="eyebrow">מצא מסלול</div>
        <h2>מצאו את הרכיבה הבאה</h2>
        <button type="button" className="discover-panel__hint" onClick={onBuild}>
          ↳ או סמנו נקודות על המפה ובנו מסלול משלכם
        </button>
      </div>

      <div className="discover-panel__places">
        <PlaceAutocompleteFilter
          label="התחלה"
          placeholder="בחרו ישוב התחלה"
          options={startOptions}
          selected={filters.startLocation}
          onSelect={(v) => addFilterValue("startLocation", v)}
          onRemove={(v) => removeFilterValue("startLocation", v)}
        />
        <PlaceAutocompleteFilter
          label="עובר דרך"
          placeholder="בחרו מקום לאורך המסלול"
          options={throughOptions}
          selected={filters.throughLocation}
          onSelect={(v) => addFilterValue("throughLocation", v)}
          onRemove={(v) => removeFilterValue("throughLocation", v)}
        />
      </div>

      <div className="discover-panel__filters">
        {FILTER_GROUPS.map((group) => (
          <div className="wd-filter-group" key={group.axis} role="group" aria-label={group.label}>
            <span className="wd-filter-group__label">{group.label}</span>
            <div className="wd__chips">
              {group.options.map((opt) => (
                <FilterChip
                  key={opt.value}
                  active={filters[group.axis].has(opt.value)}
                  onClick={() => toggleAxis(group.axis, opt.value)}
                >
                  {opt.label}
                </FilterChip>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="discover-panel__list">
        <div className="dlabel">
          {mode === "recommended" ? "מומלצים" : `${routes.length} מסלולים`}
        </div>
        {routes.map((entry) => (
          <RouteCard
            key={entry.slug}
            entry={entry}
            places={places}
            onSelect={onSelectRoute}
          />
        ))}
      </div>
    </div>
  );
}

function placeOptions(entries, placeById, placeIdsForEntry) {
  const counts = new Map();
  for (const entry of entries) {
    for (const id of placeIdsForEntry(entry)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return Array.from(counts.keys())
    .map((id) => ({ value: id, label: placeById.get(id)?.name || id, count: counts.get(id) || 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}
```

- [ ] **Step 3: Add discover styles**

Append concrete styles to `src/components/frontPanel/front-panel.css` (eyebrow, hint, label, chips spacing). Port the matching rules from `plans/front-page-overhaul/design_handoff_front_page/styles.css` (`.eyebrow`, `.dlabel`, pill/chip styles) so the look matches the prototype.

- [ ] **Step 4: Wire DiscoverPanel into App**

In `src/App.jsx`, add:

```jsx
import DiscoverPanel from "./components/frontPanel/DiscoverPanel.jsx";
import { useCatalogData } from "./components/frontPanel/useCatalogData.js";
```

In `App()`:

```jsx
  const { catalog, places } = useCatalogData();
  const handleSelectRecommended = useCallback((entry) => {
    if (entry?.route) {
      window.location.assign(`/?route=${encodeURIComponent(entry.route)}`);
    }
  }, []);
```

Replace the `discover={...}` placeholder prop on `<FrontPanel>` with:

```jsx
                discover={
                  <DiscoverPanel
                    catalog={catalog}
                    places={places}
                    onSelectRoute={handleSelectRecommended}
                    onBuild={() => handlePanelStateChange("build")}
                  />
                }
```

(`onSelectRoute` should not change panel state — per the spec, rec-card clicks don't switch.)

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, flag on.
Expected: Discover shows the eyebrow/heading, the hint button, place + pill filters, and a "מומלצים" list of featured routes. Selecting a pill switches the heading to "N מסלולים" and shows filtered results. Clicking the hint switches to Build.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/WelcomeDiscover.jsx src/components/frontPanel/
git commit -m "feat(front-panel): discover panel with curated/results finder"
```

---

## Phase 3 — Build panel (stats, header/tools, actions, warnings, POIs)

### Task 3.1: BuildPanel scaffold with route header + edit tools + stat strip

Reuses existing handlers/data already in `App.jsx`: `handlePlaybackAwareUndo/Redo/RouteClear`, `canUndo`, `canRedo`, `routeState.distance/elevationGain/elevationLoss`, and `formatLegacyDistance` (already imported in App).

**Files:**
- Create: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: Build the scaffold**

`src/components/frontPanel/BuildPanel.jsx`:

```jsx
import React from "react";
import Icon from "../Icon.jsx";
import { formatLegacyDistance } from "../ElevationProfile.jsx";

export default function BuildPanel({
  routeState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
}) {
  const hasRoute = routeState.geometry.length >= 2;
  return (
    <div className="build-panel">
      <div className="build-panel__head">
        <div>
          <div className="eyebrow">המסלול שלי · טיוטה</div>
          <div className="build-panel__title">מסלול חדש</div>
        </div>
        <div className="build-panel__tools">
          <button type="button" disabled={!canUndo} onClick={onUndo} title="בטל" aria-label="בטל">
            <Icon name="arrow-undo-outline" />
          </button>
          <button type="button" disabled={!canRedo} onClick={onRedo} title="בצע שוב" aria-label="בצע שוב">
            <Icon name="arrow-redo-outline" />
          </button>
          <button type="button" disabled={routeState.points.length === 0} onClick={onClear} title="נקה" aria-label="נקה">
            <Icon name="trash-outline" />
          </button>
        </div>
      </div>

      {hasRoute ? (
        <div className="build-panel__stats">
          <Stat k="אורך" v={formatLegacyDistance(routeState.distance)} />
          <Stat k="טיפוס" v={`${Math.round(routeState.elevationGain || 0)} מ׳`} />
          <Stat k="ירידה" v={`${Math.round(routeState.elevationLoss || 0)} מ׳`} />
        </div>
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div className="build-stat">
      <div className="build-stat__k">{k}</div>
      <div className="build-stat__v">{v}</div>
    </div>
  );
}
```

- [ ] **Step 2: Add build styles** — append `.build-panel*`, `.build-stat*`, `.eyebrow` (if not already added in Phase 2) rules to `front-panel.css`, porting from the prototype's `styles.css` stat-strip + route-head rules.

- [ ] **Step 3: Wire into App** — in `src/App.jsx` import `BuildPanel` and replace the `build={...}` placeholder:

```jsx
                build={
                  <BuildPanel
                    routeState={routeState}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={handlePlaybackAwareUndo}
                    onRedo={handlePlaybackAwareRedo}
                    onClear={handlePlaybackAwareRouteClear}
                  />
                }
```

- [ ] **Step 4: Manually verify** — flag on, draw a route: Build shows the header, the three edit tools (functional), and the length/climb/descent stats. Undo/redo/clear work from the panel.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/frontPanel/BuildPanel.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): build panel header, edit tools, and stat strip"
```

### Task 3.2: Route actions in BuildPanel

Reuses `canDownload` and `handleOpenDownload` (already in App) for summary/GPX/share, which opens the existing `DownloadModal`.

**Files:**
- Modify: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add an actions row** to `BuildPanel` (new props `canDownload`, `onOpenDownload`), rendered under the stats when `hasRoute`:

```jsx
      {hasRoute && (
        <div className="build-panel__actions">
          <button type="button" className="btn-primary" disabled={!canDownload} onClick={onOpenDownload}>
            סיכום ושמירה
          </button>
        </div>
      )}
```

Add `canDownload` and `onOpenDownload` to the destructured props.

- [ ] **Step 2: Pass the props** in `src/App.jsx` (`canDownload={canDownload}` and `onOpenDownload={handleOpenDownload}` on `<BuildPanel>`).

- [ ] **Step 3: Add `.build-panel__actions` / `.btn-primary` styles** to `front-panel.css`, ported from the prototype's button rules.

- [ ] **Step 4: Manually verify** — the summary/GPX/share action in the panel opens the existing download modal for a drawn route.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/frontPanel/BuildPanel.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): route actions (summary/GPX/share) in build panel"
```

### Task 3.3: Route warnings in BuildPanel (relocated "מידע חשוב")

Reuses `getRouteWarningPresentation(activeDataPoints)` — the same data source the on-map legend uses (`App.jsx:471-545`).

**Files:**
- Modify: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Render warnings** — add a `warnings` section to `BuildPanel` driven by a new prop `warningPresentation`:

```jsx
import { getRouteWarningPresentation } from "@cycleways/core/ui/routePlannerPresentation.js";
```

```jsx
      {hasRoute && warningGroups.length > 0 && (
        <div className="build-panel__warnings">
          <div className="dlabel">מידע חשוב</div>
          {warningGroups.map((g) => (
            <button
              key={g.segmentName}
              type="button"
              className="build-warning"
              style={{ backgroundColor: g.backgroundColor }}
              onClick={() => onWarningFocus?.(g.warnings?.[0])}
            >
              <span>{g.label}</span>
              <span aria-hidden="true">{g.icons.join(" ")}</span>
            </button>
          ))}
        </div>
      )}
```

Compute `const warningGroups = warningPresentation?.groups || [];` near the top, and add `warningPresentation` + `onWarningFocus` to the props.

- [ ] **Step 2: Pass props in App** — compute once with the existing `useMemo` import and pass to `<BuildPanel>`:

```jsx
  const routeWarningPresentation = useMemo(
    () => getRouteWarningPresentation(routeState.activeDataPoints),
    [routeState.activeDataPoints],
  );
```

`warningPresentation={routeWarningPresentation}` and `onWarningFocus={handleDataPointFocus}`.

- [ ] **Step 3: Add `.build-panel__warnings` / `.build-warning` styles** to `front-panel.css`.

- [ ] **Step 4: Manually verify** — draw a route through a warned segment: warnings appear in the panel; clicking one flies the map to the warning.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/frontPanel/BuildPanel.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): relocate route warnings into the build panel"
```

### Task 3.4: POI cards in BuildPanel

Reuses the planner cue slides already computed in `App.jsx` (`plannerCueSlides`) and the focus handler `handlePlannerCueClick`.

**Files:**
- Modify: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Render a POI list** in `BuildPanel` from a `pois` prop (array of `{ id, name, type, distanceMeters }`), numbered, with distance-along formatted via `formatLegacyDistance`:

```jsx
      {hasRoute && pois.length > 0 && (
        <div className="build-panel__pois">
          <div className="dlabel">נקודות עניין בדרך <span className="tag">{pois.length} נקודות זוהו</span></div>
          {pois.map((p, i) => (
            <button key={p.id || i} type="button" className="poi-card" onClick={() => onPoiClick?.(p)}>
              <span className="poi-card__idx">{i + 1}</span>
              <span className="poi-card__body">
                <span className="poi-card__title">{p.name}</span>
                <span className="poi-card__dist">{formatLegacyDistance(p.distanceMeters)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
```

Add `pois` and `onPoiClick` to props (`const pois = ...` defaulting to `[]`).

- [ ] **Step 2: Map cue slides to POI props in App** — derive from `plannerCueSlides`:

```jsx
  const buildPois = useMemo(
    () => plannerCueSlides
      .filter((s) => s.kind !== "start" && s.kind !== "end")
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        distanceMeters: (s.fraction ?? 0) * routeState.distance,
      })),
    [plannerCueSlides, routeState.distance],
  );
```

Pass `pois={buildPois}` and `onPoiClick={(p) => handlePlannerCueClick({ slide: p, poiId: p.id })}`.

(Confirm the cue-slide field names against `routePoiStoryData.js` / `routeVideoCueSlides` output before committing; adjust `s.fraction`/`s.kind`/`s.id`/`s.name` to the real keys.)

- [ ] **Step 3: Add `.build-panel__pois` / `.poi-card*` / `.tag` styles** to `front-panel.css`, ported from the prototype.

- [ ] **Step 4: Manually verify** — a route with nearby landmarks shows numbered POI cards with distance-along; clicking one focuses that POI on the map.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/frontPanel/BuildPanel.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): POI cards in the build panel from planner cue slides"
```

---

## Phase 4 — Banded interactive elevation graph in the panel

### Task 4.1: Pure route-slice helper for band→map highlight (TDD)

Given the route geometry and a `[startKm, endKm]` range, return the coordinate slice for highlighting on the map.

**Files:**
- Create: `src/components/frontPanel/routeSlice.js`
- Test: `tests/test-route-slice.mjs`

- [ ] **Step 1: Write the failing test**

`tests/test-route-slice.mjs`:

```javascript
import assert from "node:assert/strict";
import { routeSliceForRange } from "../src/components/frontPanel/routeSlice.js";

// Generic points + parallel cumulative-meters array (format-agnostic).
const pts = [
  { lat: 33, lng: 35.0 },
  { lat: 33, lng: 35.1 },
  { lat: 33, lng: 35.2 },
  { lat: 33, lng: 35.3 },
];
const cumMeters = [0, 1000, 2000, 3000];

// Range entirely inside → boundary points included.
const slice = routeSliceForRange(pts, cumMeters, 500, 2500);
assert.equal(slice.length, 2);
assert.deepEqual(slice[0], pts[1]); // first point at/after 500m is index 1 (1000m)
assert.deepEqual(slice[1], pts[2]); // last point at/before 2500m is index 2 (2000m)

// Invalid / empty range → empty slice.
assert.deepEqual(routeSliceForRange(pts, cumMeters, 2000, 1000), []);
assert.deepEqual(routeSliceForRange([], [], 0, 1000), []);

console.log("route-slice ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-route-slice.mjs`
Expected: FAIL with `Cannot find module .../routeSlice.js`.

- [ ] **Step 3: Implement**

`src/components/frontPanel/routeSlice.js`:

```javascript
// Return the points whose cumulative distance (meters) falls within
// [startM, endM]. Inclusive of the boundary points. Format-agnostic: `points`
// is whatever the route geometry holds; only `cumMeters` indices are compared.
export function routeSliceForRange(points, cumMeters, startM, endM) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (!Array.isArray(cumMeters) || cumMeters.length !== points.length) return [];
  if (!(endM > startM)) return [];
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    if (cumMeters[i] >= startM && cumMeters[i] <= endM) out.push(points[i]);
  }
  return out.length >= 2 ? out : [];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node tests/test-route-slice.mjs`
Expected: prints `route-slice ok`.

- [ ] **Step 5: Register in package.json** — append ` && node tests/test-route-slice.mjs`.

- [ ] **Step 6: Commit**

```bash
git add src/components/frontPanel/routeSlice.js tests/test-route-slice.mjs package.json
git commit -m "feat(front-panel): pure route-slice helper for elevation band highlight"
```

### Task 4.2: PanelElevationGraph — graph + difficulty bands + readout, synced to progress

Wraps the existing `ElevationProfile` (cursor + hover + grade-colored area already implemented) and renders a band strip from `buildElevationProfile(geometry).segments` beneath it.

**Files:**
- Create: `src/components/frontPanel/PanelElevationGraph.jsx`
- Modify: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: Build the component**

`src/components/frontPanel/PanelElevationGraph.jsx`:

```jsx
import React, { useMemo } from "react";
import ElevationProfile from "../ElevationProfile.jsx";
import { buildElevationProfile } from "@cycleways/core/ui/elevationProfile.js";

export default function PanelElevationGraph({
  geometry,
  distance,
  cursorFraction,
  cursorPlaying,
  externalCursorActive,
  onElevationHover,
  onElevationSelect,
  onBandHover,
  onBandSelect,
}) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const bands = profile?.segments?.filter(Boolean) || [];

  return (
    <div className="panel-elev">
      <ElevationProfile
        geometry={geometry}
        distance={distance}
        cursorFraction={cursorFraction}
        cursorPlaying={cursorPlaying}
        externalCursorActive={externalCursorActive}
        onElevationHover={onElevationHover}
        onElevationSelect={onElevationSelect}
      />
      <div className="panel-elev__bands">
        {bands.map((band, i) => (
          <button
            key={i}
            type="button"
            className="panel-elev__band"
            style={{
              insetInlineStart: `${band.startPercent ?? band.distancePercent}%`,
              width: `${(band.endPercent ?? band.distancePercent) - (band.startPercent ?? band.distancePercent)}%`,
              background: band.color,
            }}
            title={band.label || band.gradeClass}
            onMouseEnter={() => onBandHover?.(band)}
            onMouseLeave={() => onBandHover?.(null)}
            onClick={() => onBandSelect?.(band)}
          />
        ))}
      </div>
    </div>
  );
}
```

(Confirm the band geometry fields — `startPercent`/`endPercent`/`distancePercent`/`color`/`gradeClass`/`label` — against the real `buildElevationProfile` return shape in `packages/core/src/ui/elevationProfile.js`; adjust the style math to whatever range fields exist. The point is: render one proportional band per cluster.)

- [ ] **Step 2: Render it in BuildPanel** — add an `elevation` render-prop/slot to `BuildPanel` (a new `elevation` prop) placed between the stat strip and the actions:

```jsx
      {hasRoute && elevation}
```

Add `elevation` to the destructured props.

- [ ] **Step 3: Wire in App** — pass the graph as the `elevation` prop on `<BuildPanel>`, reusing the existing planner playback + elevation handlers already in `App.jsx`:

```jsx
                  elevation={
                    <PanelElevationGraph
                      geometry={routeState.geometry}
                      distance={routeState.distance}
                      cursorFraction={plannerPlayback.cursor?.fraction ?? null}
                      cursorPlaying={plannerPlayback.isPlaying}
                      externalCursorActive={Boolean(
                        plannerPlayback.hasCursor || plannerPlayback.isPlaying || plannerPlayback.isScrubbing,
                      )}
                      onElevationHover={handlePlannerElevationHover}
                      onElevationSelect={handlePlannerElevationSelect}
                      onBandHover={setHoveredBand}
                      onBandSelect={(band) => {
                        const mid = ((band.startPercent ?? 0) + (band.endPercent ?? 0)) / 200;
                        plannerPlayback.seekToFraction(mid);
                      }}
                    />
                  }
```

Add `const [hoveredBand, setHoveredBand] = useState(null);` in `App()`. Import `PanelElevationGraph`.

- [ ] **Step 4: Style the bands** — append `.panel-elev`, `.panel-elev__bands` (position relative, height ~10px), `.panel-elev__band` (absolute, full-height) to `front-panel.css`.

- [ ] **Step 5: Manually verify** — the panel shows the elevation curve with a colored band strip below it. Hovering the chart moves the map rider marker (shared `progress`); hitting play at the bottom of the map animates the same cursor in the panel chart.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/frontPanel/ src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): banded interactive elevation graph synced to playback"
```

### Task 4.3: Highlight the hovered band's route slice on the map

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/map/MapView.jsx` (and the layer module it uses) — follow the existing route-line layer pattern.

- [ ] **Step 1: Derive the highlight geometry in App** from `hoveredBand`, using `routeSliceForRange`. Compute per-vertex cumulative meters with the repo's own `getDistance` ({lat,lng} → meters) — **no turf** (the project has no `@turf/*` dependency):

```jsx
import { getDistance } from "@cycleways/core/utils/distance.js";

function cumulativeMeters(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum[i] = cum[i - 1] + getDistance(points[i - 1], points[i]);
  }
  return cum;
}
```

```jsx
  const bandHighlight = useMemo(() => {
    if (!hoveredBand || routeState.geometry.length < 2) return null;
    const cum = cumulativeMeters(routeState.geometry);
    const total = routeState.distance; // meters
    const startM = ((hoveredBand.startPercent ?? 0) / 100) * total;
    const endM = ((hoveredBand.endPercent ?? 0) / 100) * total;
    return routeSliceForRange(routeState.geometry, cum, startM, endM);
  }, [hoveredBand, routeState.geometry, routeState.distance]);
```

Pass the computed slice (an array of `{lat,lng}` route points) as a new `segmentHighlight` prop to `MapView`. (Confirm `routeState.distance` is in meters and that geometry items are `{lat,lng}`; both are how `buildElevationProfile`/`getDistance` already consume them.)

- [ ] **Step 2: Render a highlight line layer** in `MapView` — add a GeoJSON source + a `line` layer (brighter/thicker than the route line) fed by the `segmentHighlight` coordinates, mirroring how the existing route-line layer is declared in `src/map/mapLayers.js`. When `segmentHighlight` is null/empty, set empty features.

- [ ] **Step 3: Manually verify** — hovering a difficulty band in the panel brightens that stretch of the route on the map; leaving clears it.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/map/
git commit -m "feat(front-panel): highlight hovered elevation band on the map route"
```

---

## Phase 5 — Delete the on-map furniture that moved to the panel

The map keeps the geocoder search box and the bottom transport; the relocated controls and the warnings toggle are deleted (the panel is now their single home).

### Task 5.1: Delete the relocated on-map controls

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Delete the floating control-buttons block** — remove the `.top-controls` block (`#undo-btn`/`#redo-btn`/`#reset-btn`/`#download-gpx`, `App.jsx:271-317`) entirely. Keep the `.search-container` form (the geocoder). If `.top-controls` was the only sibling making `.search-container` a flex row, leave `.search-container` as-is — it renders the geocoder alone.

- [ ] **Step 2: Remove the on-map warnings** — change `MapLegend` so it renders only the road-types legend; delete the warning toggle, `individual-warnings-container`, and the `warningsOpen` state / `getRouteWarningPresentation` usage inside `MapLegend` (`App.jsx:471-545`). Remove the now-unused `activeDataPoints`/`onWarningFocus` props from the `MapLegend` call site if they are no longer read. (`hasBrokenRoute` "מסלול שבור" stays if you want it on the map; otherwise move it to the panel — keep it on the map for this task.)

- [ ] **Step 3: Prune now-dead imports/handlers** in `App.jsx` — if `handlePlaybackAwareUndo/Redo/RouteClear`, `handleOpenDownload`, etc. are still used by the panel (they are, via `BuildPanel` props), keep them. Remove any import or variable that is no longer referenced after deleting the blocks (let the linter/build guide you). No duplicated handlers should remain.

- [ ] **Step 4: Manually verify** — the map shows only the geocoder (top), the transport (bottom), and the road-types legend; undo/redo/clear/summary and the warnings toggle are gone from the map and live only in the panel.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(front-panel): delete relocated controls and warnings from the map"
```

---

## Phase 6 — e2e, mobile fallback, and rollout

### Task 6.1: Playwright e2e for the panel

**Files:**
- Create: `tests/e2e/front-panel.spec.mjs`

- [ ] **Step 1: Write the spec**

`tests/e2e/front-panel.spec.mjs`:

```javascript
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("front panel shows discover by default and toggles to build", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  // Discover by default.
  await expect(panel.getByRole("tab", { name: "גילוי מסלול" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("מצאו את הרכיבה הבאה")).toBeVisible();
  // Toggle to build.
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await expect(panel.getByRole("tab", { name: "בניית מסלול" })).toHaveAttribute("aria-selected", "true");
});

test("collapse hides the panel and the reopen button restores it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "הסתר פאנל" }).click();
  await expect(page.getByTestId("front-panel")).toBeHidden();
  await page.getByRole("button", { name: "הצג פאנל" }).first().click();
  await expect(page.getByTestId("front-panel")).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/front-panel.spec.mjs --workers=1`
Expected: PASS. (If the geocoder/transport selectors differ, adjust to the real labels; do not weaken the panel assertions.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/front-panel.spec.mjs
git commit -m "test(front-panel): e2e for discover/build toggle and collapse"
```

### Task 6.2: Verify the responsive mobile stacking

The `@media (max-width: 860px)` rule (Task 0.2) stacks the map then the full-width panel. Because the controls now live only in the panel, the phone keeps a usable planner with no separate code path.

- [ ] **Step 1: Manually verify** at 375px width: the map is on top, the panel (with toggle, Discover/Build, and all route controls) is below it and scrollable. The geocoder + transport remain on the map. No on-map undo/redo/clear/warnings (they're in the panel).

- [ ] **Step 2:** If the stacked panel needs a max-height so the map stays visible, add to `front-panel.css`:

```css
@media (max-width: 860px) {
  .front-shell .map-container { min-height: 52vh; }
  .front-panel { max-height: 48vh; }
}
```

- [ ] **Step 3: Commit** (only if CSS changed)

```bash
git add src/components/frontPanel/front-panel.css
git commit -m "feat(front-panel): responsive stacked panel on narrow viewports"
```

### Task 6.3: Full test sweep + update legacy specs

- [ ] **Step 1: Run the logic suite**

Run: `npm test`
Expected: PASS (includes the three new `.mjs` tests).

- [ ] **Step 2: Run the smoke suite**

Run: `npm run test:smoke`
Expected: PASS (existing specs + the new front-panel spec).

- [ ] **Step 3: Update any front-page spec that asserted the old layout** — `react-migration-smoke.spec.mjs` and `welcome-wizard.spec.mjs` may assert the old on-map controls or the discover modal. Update them to the new two-column layout (panel toggle, in-panel finder). Do not weaken assertions — re-point them at the new DOM.

Run: `npm run test:smoke`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/
git commit -m "test(front-panel): update front-page specs to the two-column layout"
```

---

## Self-review notes

- **Spec coverage:** shell + collapse (0.2, 1.3, 6.2), state toggle + auto-switch (1.1–1.3), geocoder stays (5.1), transport stays at bottom (untouched; verified 4.2/5.1), Discover hint + finder + curated/results (2.1–2.3), Build header/tools/stats/actions/warnings/POIs (3.1–3.4), banded elevation synced to progress (4.1–4.3), warnings relocated + on-map warnings deleted (3.3, 5.1), responsive mobile stacking (6.2), straight rollout with no flag (6.3). All design sections map to a task.
- **Confirm-before-commit flags inside tasks** (icon names in 1.2/3.x, cue-slide field names in 3.4, band geometry fields in 4.2/4.3, layer wiring in 4.3): these depend on exact in-repo shapes the executor must read before finalizing; each task says which file to confirm against. They are not optional placeholders — the surrounding code is concrete; only the field names must be matched.
- **Type consistency:** `resolvePanelState`/`INITIAL_PANEL_STATE`, `selectDiscoverRoutes`/`hasActiveDiscoverFilters`, `routeSliceForRange` names are used identically across their tests and consumers.
