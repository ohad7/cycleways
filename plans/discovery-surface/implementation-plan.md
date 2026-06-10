# Quick-Fix Bundle Implementation Plan (discovery-surface, step 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-10
**Design:** [design.md](design.md) — this plan implements D3 (seamless route selection) plus the small fixes (remove `user-scalable=no`, `/routes` mobile cards-first). The larger D1/D2/D4/D5 items get their own plans later.

**Goal:** Selecting a Discover route loads it in place (no full page reload), pinch zoom is no longer blocked, and `/routes` on mobile shows route cards on the first screen with filters collapsed behind a toggle.

**Architecture:** A new `handleLoadRouteParam` handler in the platform-agnostic `useCyclewaysApp` controller reuses the existing `?route=` restore path (`restoreRouteParam` / `restoreRouteFromParam`) against the live route session, then mirrors the param onto the URL with `history.replaceState`. `src/App.jsx` swaps `window.location.assign` for this handler. The `/routes` change is a `filtersOpen` state + a mobile-only toggle button, CSS-gated at the existing 760px breakpoint. Everything is verified by Playwright e2e specs (the repo's pattern for UI behavior; pure route logic is already covered by `tests/test-react-route-actions.mjs`).

**Tech Stack:** React 19, `@cycleways/core` controller hook, Playwright (`npx playwright test`, config auto-starts the dev server on port 5175 with `--project=desktop` / `--project=mobile`).

**Worktree note:** Execute on a fresh branch off `main` (e.g. `quick-fix-bundle`), per `superpowers:using-git-worktrees`.

**Deferred from D3:** preserving Discover filter state when toggling back from Build is *not* in this bundle — `FrontPanel` unmounts `DiscoverPanel` on switch (pre-existing), so filters reset; fixing it means lifting filter state out of `DiscoverPanel`, which belongs with the larger Discover work (D2/D4).

---

### Task 1: Allow pinch zoom (remove `user-scalable=no`)

**Files:**
- Test: `tests/e2e/viewport-meta.spec.mjs` (create)
- Modify: `index.html` (the viewport meta, ~line 6)

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/viewport-meta.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("viewport meta allows pinch zoom (no user-scalable=no)", async ({ page }) => {
  await page.goto("/");
  const content = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(content).toContain("width=device-width");
  expect(content).not.toContain("user-scalable=no");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/viewport-meta.spec.mjs --project=mobile`
Expected: FAIL — `content` contains `user-scalable=no`.

- [ ] **Step 3: Fix the meta tag**

In `index.html`, change:

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
```

to:

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
```

(Mapbox GL handles its own touch gestures on the map canvas; this only re-enables page-level pinch zoom, per WCAG 1.4.4.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/e2e/viewport-meta.spec.mjs --project=mobile --project=desktop`
Expected: PASS (both projects).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/viewport-meta.spec.mjs
git commit -m "fix(a11y): allow pinch zoom — drop user-scalable=no from viewport meta"
```

---

### Task 2: Failing e2e for seamless Discover route selection

**Files:**
- Test: `tests/e2e/discover-route-select.spec.mjs` (create)

The test needs to know when the routing engine is ready (clicking earlier would
legitimately fall back to a reload). Tasks 3–4 expose this as a
`data-route-status` attribute on the front panel; the test waits on it.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/discover-route-select.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("selecting a Discover route loads it in place without a full reload", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  // Wait for the routing engine (added in Task 4); a click before readiness
  // falls back to a full-page load by design.
  await expect(panel).toHaveAttribute("data-route-status", "ready", {
    timeout: 30_000,
  });
  // A full navigation would lose this flag.
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  const card = panel.locator(".panel-route-card").first();
  await expect(card).toBeVisible();
  await card.click();
  // The encoded route lands on the URL and the panel switches to Build.
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await expect(
    panel.getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
  // Still the same document — no reload happened.
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/discover-route-select.spec.mjs --project=desktop`
Expected: FAIL — `data-route-status` attribute never appears (it doesn't exist yet). This stays red until Task 4.

- [ ] **Step 3: Commit the failing spec**

```bash
git add tests/e2e/discover-route-select.spec.mjs
git commit -m "test(discover): e2e for in-place route selection (red until wired)"
```

---

### Task 3: `handleLoadRouteParam` in the core controller

**Files:**
- Modify: `packages/core/src/app/useCyclewaysApp.js` (imports ~line 27–32, new handler after `handleRouteClear` ~line 639, return block ~line 1013)

- [ ] **Step 1: Import `setUrlParam`**

In the `../platform/location.js` import (~line 27), add `setUrlParam`:

```js
import {
  getQueryParam,
  hasQueryParam,
  removeUrlParam,
  setUrlParam,
  getShardLoaderLocation,
} from "../platform/location.js";
```

(`setUrlParam` exists in both `location.js` and `location.native.js`, so this stays platform-agnostic.)

- [ ] **Step 2: Add the handler**

Insert after `handleRouteClear` (after ~line 639), before `restoreHistorySnapshot`:

```js
  // Loads an encoded route (the ?route= share format) into the live planner
  // session — the in-app path for "open this recommended route" without a
  // full page reload. Pushes the previous route (if any) onto the undo stack,
  // requests a map fit to the loaded geometry, and mirrors the param onto the
  // URL. Returns false when the routing session isn't ready or the param
  // doesn't decode, so callers can fall back to a full-page restore.
  const handleLoadRouteParam = useCallback(
    async (routeParam) => {
      if (!routeParam || !routeManagerRef.current || state.status !== "ready") {
        return false;
      }
      try {
        const shardedSession = shardedRouteSessionRef.current;
        const snapshot = shardedSession
          ? await shardedSession.restoreRouteParam(routeParam)
          : restoreRouteFromParam(
              routeManagerRef.current,
              routeParam,
              state.assets.segmentsData,
              state.assets.cwBaseIndexData,
            );
        if (shardedSession) {
          routeManagerRef.current = shardedSession.manager;
        }
        if (!snapshot) return false;
        const previousSnapshot = routeStateSnapshot(routeStateRef.current);
        if (previousSnapshot.points.length > 0) {
          setRouteHistory((current) => ({
            past: [...current.past, previousSnapshot],
            future: [],
          }));
        }
        routeStateRef.current = routeStateFromSnapshot(
          routeStateRef.current,
          snapshot,
        );
        dispatchRoute({ type: "route/update", snapshot });
        setMapUi((current) => ({
          ...current,
          selectedRoutePointIndex: null,
          routeFitRequest: {
            id: `select-${Date.now()}`,
            geometry: snapshot.geometry,
          },
        }));
        setUrlParam("route", routeParam);
        return true;
      } catch (error) {
        dispatchRoute({ type: "route/error", error });
        return false;
      }
    },
    [state.assets, state.status],
  );
```

- [ ] **Step 3: Export it from the hook**

In the return block (~line 1013), add one line after `handleRouteClear,`:

```js
    handleRouteClear,
    handleLoadRouteParam,
```

- [ ] **Step 4: Sanity-check the node test suite still passes**

Run: `node tests/test-react-route-actions.mjs && node tests/test-route-reducer.mjs`
Expected: both exit 0 (no output is success; the handler reuses already-tested `restoreRouteFromParam`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/app/useCyclewaysApp.js
git commit -m "feat(core): handleLoadRouteParam — load an encoded route into the live session"
```

---

### Task 4: Wire App.jsx + readiness attribute; e2e goes green

**Files:**
- Modify: `src/App.jsx` (destructure ~line 50–93, `handleSelectRecommended` ~line 111, `<FrontPanel>` props ~line 575)
- Modify: `src/components/frontPanel/FrontPanel.jsx`

- [ ] **Step 1: Destructure the new handler in App.jsx**

In the `useCyclewaysApp(...)` destructuring (after `handleRouteClear,` ~line 73), add:

```js
    handleRouteClear,
    handleLoadRouteParam,
```

- [ ] **Step 2: Replace handleSelectRecommended**

Delete the current definition (~lines 111–115):

```js
  const handleSelectRecommended = useCallback((entry) => {
    if (entry?.route) {
      window.location.assign(`/?route=${encodeURIComponent(entry.route)}`);
    }
  }, []);
```

and add this **after** `handlePanelStateChange` (defined ~line 161 — it must come after, or the deps array hits the TDZ):

```js
  // Loads a recommended route into the live planner (no reload) and shows it
  // in the Build panel. Falls back to the full-page ?route= restore when the
  // routing session isn't ready yet or the param fails to decode.
  const handleSelectRecommended = useCallback(
    async (entry) => {
      if (!entry?.route) return;
      const loaded = await handleLoadRouteParam(entry.route);
      if (loaded) {
        handlePanelStateChange("build");
      } else {
        window.location.assign(`/?route=${encodeURIComponent(entry.route)}`);
      }
    },
    [handleLoadRouteParam, handlePanelStateChange],
  );
```

- [ ] **Step 3: Expose route readiness on the front panel**

In `src/components/frontPanel/FrontPanel.jsx`, add a `routeStatus` prop and render it as a data attribute:

```js
export default function FrontPanel({
  panelState,
  onPanelStateChange,
  collapsed,
  onToggleCollapsed,
  discover,
  build,
  routeStatus,
}) {
  return (
    <aside
      className="front-panel"
      data-testid="front-panel"
      data-route-status={routeStatus}
    >
```

In `src/App.jsx`, pass it where `<FrontPanel>` is rendered (~line 575):

```jsx
              <FrontPanel
                panelState={panel.state}
                onPanelStateChange={handlePanelStateChange}
                routeStatus={routeState.status}
```

- [ ] **Step 4: Run the Task 2 spec — now green**

Run: `npx playwright test tests/e2e/discover-route-select.spec.mjs --project=desktop --project=mobile`
Expected: PASS on both projects.

- [ ] **Step 5: Run the neighboring front-panel spec for regressions**

Run: `npx playwright test tests/e2e/front-panel.spec.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/frontPanel/FrontPanel.jsx
git commit -m "feat(discover): load selected route in place — no full page reload"
```

---

### Task 5: `/routes` mobile — cards first, filters behind a toggle

**Files:**
- Test: `tests/e2e/routes-index-mobile-filters.spec.mjs` (create)
- Modify: `src/pages/RoutesIndexPage.jsx` (~lines 77–80 state, ~lines 173–241 header/panel)
- Modify: `src/components/routes/routes.css` (append; existing mobile breakpoint is 760px)

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/routes-index-mobile-filters.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("mobile: route cards show first; filters are behind a toggle", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only behavior");
  await page.goto("/routes/");
  const firstCard = page.locator(".route-card").first();
  await expect(firstCard).toBeVisible();
  // Filters collapsed by default; toggle visible instead.
  await expect(page.locator(".routes-page__search-panel")).toBeHidden();
  const toggle = page.getByRole("button", { name: /סינון/ });
  await expect(toggle).toBeVisible();
  // First card starts within the first viewport (no filter wall above it).
  const box = await firstCard.boundingBox();
  const viewport = page.viewportSize();
  expect(box.y).toBeLessThan(viewport.height);
  // Toggle opens the panel and filtering still works.
  await toggle.click();
  await expect(page.locator(".routes-page__search-panel")).toBeVisible();
  await page.getByRole("button", { name: "קל" }).click();
  await expect(page.locator(".routes-page__filter-actions")).toContainText("מסננים פעילים");
});

test("desktop: filter panel stays inline, no toggle", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop-only behavior");
  await page.goto("/routes/");
  await expect(page.locator(".routes-page__search-panel")).toBeVisible();
  await expect(page.locator(".routes-page__filters-toggle")).toBeHidden();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/routes-index-mobile-filters.spec.mjs --project=mobile --project=desktop`
Expected: mobile test FAILS (panel is visible, no toggle); desktop test FAILS (`.routes-page__filters-toggle` doesn't exist — `toBeHidden()` passes on zero matches, so if it passes, fine; the mobile failure is the gate).

- [ ] **Step 3: Add the toggle state and button**

In `src/pages/RoutesIndexPage.jsx`, add state next to the other `useState` calls (~line 80):

```js
  const [filtersOpen, setFiltersOpen] = useState(false);
```

Insert the toggle button between the summary `</div>` (~line 176) and the `<section className="routes-page__search-panel">`:

```jsx
            <button
              type="button"
              className="routes-page__filters-toggle"
              aria-expanded={filtersOpen}
              aria-controls="routes-search-panel"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <span>סינון וחיפוש</span>
              {activeFilterCount > 0 && (
                <span className="routes-page__filters-toggle-count">
                  {activeFilterCount}
                </span>
              )}
            </button>
```

and update the section's opening tag:

```jsx
            <section
              id="routes-search-panel"
              className={`routes-page__search-panel${filtersOpen ? " routes-page__search-panel--open" : ""}`}
              aria-label="חיפוש וסינון מסלולים"
            >
```

- [ ] **Step 4: Add the CSS**

Append to `src/components/routes/routes.css`:

```css
/* Mobile: the search/filter panel collapses behind a toggle so route cards are
   visible on the first screen; desktop always shows the panel inline. */
.routes-page__filters-toggle {
  display: none;
}

@media (max-width: 760px) {
  .routes-page__filters-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    grid-column: 1 / -1;
    padding: 10px 12px;
    border: 1px solid #dce4df;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.96);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 700;
    color: #2f3e38;
    cursor: pointer;
  }

  .routes-page__filters-toggle-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: #2f6b3c;
    color: #fff;
    font-size: 0.78rem;
  }

  .routes-page__search-panel {
    display: none;
  }

  .routes-page__search-panel--open {
    display: grid;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/routes-index-mobile-filters.spec.mjs tests/e2e/routes-index.spec.mjs --project=mobile --project=desktop`
Expected: PASS, including the pre-existing `routes-index` spec.

- [ ] **Step 6: Commit**

```bash
git add src/pages/RoutesIndexPage.jsx src/components/routes/routes.css tests/e2e/routes-index-mobile-filters.spec.mjs
git commit -m "feat(routes): mobile cards-first — collapse filters behind a toggle"
```

---

### Task 6 (drive-by bug): remove debug `color: red` on all mobile buttons

`styles.css` ~line 11 paints every `button`, `.control-btn`, and `.nav-link`
red on ≤768px viewports. Introduced by a "Checkpoint before assistant change"
commit (`13aef46`, July 2025) — a debug leftover, visible today as the
red panel-tab text on mobile. Flagged for the user; drop this task if the
red was intentional.

**Files:**
- Modify: `styles.css` (~lines 6–14)

- [ ] **Step 1: Remove the declaration**

Change:

```css
@media (max-width: 768px) {

  button,
  .control-btn,
  .nav-link {
    color: red;
    touch-action: manipulation;
  }
```

to:

```css
@media (max-width: 768px) {

  button,
  .control-btn,
  .nav-link {
    touch-action: manipulation;
  }
```

- [ ] **Step 2: Verify no other red leaks**

Run: `grep -n "color: red" styles.css src/**/*.css`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "fix(mobile): remove leftover debug color:red on buttons/nav links"
```

---

### Task 7: Full verification

- [ ] **Step 1: Node test suite**

Run: `npm test`
Expected: exits 0 (Python OSM tests + all `tests/test-*.mjs`).

- [ ] **Step 2: Full e2e suite, both projects**

Run: `npx playwright test`
Expected: all specs pass on `desktop` and `mobile`.

- [ ] **Step 3: Manual smoke (per superpowers:verification-before-completion)**

Start `npm run dev`, then in a browser:
1. On `/`, wait for the map, click a Discover card → route appears, Build tab is selected, URL gains `?route=`, **no splash replay**.
2. Undo → the previous (empty or built) route returns.
3. `/routes` at a narrow width → cards immediately visible, "סינון וחיפוש" toggle opens/closes the filters.

- [ ] **Step 4: Commit any test fallout, then hand off**

Use superpowers:finishing-a-development-branch to merge/PR.
