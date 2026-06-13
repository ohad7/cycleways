# Discover → Route Page CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Discover card tap as an in-place map preview, and promote the dedicated route page (`/routes/<slug>`) as the prominent next step — a CTA in the Build panel and the mobile peek strip that disappears once the user edits the route.

**Architecture:** `App.jsx` tracks the slug of the catalog route currently loaded in the planner (`selectedCatalogSlug`), set by `handleSelectRecommended` and cleared by every route-edit wrapper. The full catalog entry is *derived* from the slug against `catalogEntries` (so recents — which store only the slug — light up the CTA too, and photos are never stale). `BuildPanel` and the bottom-sheet peek render the CTA from the derived entry.

**Tech Stack:** React (vite app in `src/`), Playwright e2e (`tests/e2e/`, mapbox mock), plain CSS in `src/components/frontPanel/front-panel.css`.

**Design doc:** `plans/discover-route-page-cta/design.md`

---

## Context for a fresh engineer

- The front page (`src/App.jsx`) hosts a map plus a Discover/Build panel; on mobile the panel lives in a bottom sheet (`BottomSheet`, snaps: `peek`/`half`/`full`).
- Tapping a Discover card calls `handleSelectRecommended(entry)` (`src/App.jsx:278`), which loads the route into the live planner (`?route=` pushed to history) and drops the sheet to peek. The catalog `entry` has `slug`, `name`, `route` (encoded param), `distanceKm`, `heroImage`, etc.
- Each card already carries a subtle `/routes/<slug>` link: `.panel-route-card__story-link` in `src/components/frontPanel/PanelRouteCard.jsx`.
- Route edits all flow through "playback-aware" wrappers in `src/App.jsx:594-626` (undo, redo, clear, map click, point drag/remove, line drag, add-data-marker). A map click *always* adds a route point (`packages/core/src/app/useCyclewaysApp.js:482`), so clearing the CTA on map click is correct.
- Recents storage (`packages/core/src/data/plannerMemory.js`) spreads whatever entry fields it's given (`upsertRecent`) and `parseRecents` keeps unknown fields — so persisting `slug` needs **no core change**, only passing it from `App.jsx`.
- E2E: `npx playwright test <spec> --workers=1` (config `playwright.config.mjs`, projects `desktop` + `mobile`/Pixel 5, dev server auto-starts on port 5175). The mapbox mock (`tests/e2e/mapbox-mock.mjs`) exposes `window.__mockMapboxCurrentMap` with `_emit("click", event)` to simulate a map click. `ensurePanelOpen(page)` (from `tests/e2e/sheet-helpers.mjs`) opens the mobile sheet; it's a no-op on desktop.

---

### Task 1: Failing e2e spec for the CTA flow

**Files:**
- Create: `tests/e2e/discover-route-page-cta.spec.mjs`

- [ ] **Step 1: Write the failing spec**

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

// Loads the first Discover card's route into the planner and returns the
// card's /routes/<slug> href and title for comparison with the Build CTA.
async function selectFirstDiscoverRoute(page) {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  // Wait for the routing engine; a click before readiness falls back to a
  // full-page load by design.
  await expect(panel).toHaveAttribute("data-route-status", "ready", {
    timeout: 30_000,
  });
  const card = panel.locator(".panel-route-card-wrap").first();
  await expect(card).toBeVisible();
  const storyHref = await card
    .locator(".panel-route-card__story-link")
    .getAttribute("href");
  const title = (
    await card.locator(".panel-route-card__title").innerText()
  ).trim();
  await card.locator(".panel-route-card").click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  return { storyHref, title };
}

test("selecting a Discover card shows the route-page CTA in Build", async ({ page }) => {
  const { storyHref, title } = await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  const cta = page.locator(".build-panel__story-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", storyHref);
  await expect(page.locator(".build-panel__title")).toContainText(title);
});

test("mobile: build peek shows the route name and a route-page link", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  const { storyHref, title } = await selectFirstDiscoverRoute(page);
  const sheet = page.locator(".front-sheet");
  // Route selection snaps the sheet back to peek.
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(
    sheet.locator(".front-sheet__build-peek span").first(),
  ).toContainText(title);
  const link = sheet.locator(".front-sheet__build-peek-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", storyHref);
});

test("editing the route (map click) hides the CTA", async ({ page }) => {
  await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel__story-cta")).toBeVisible();
  // A map click always adds a route point — the loaded route diverges from
  // the catalog route, so the CTA must disappear.
  await page.evaluate(() => {
    window.__mockMapboxCurrentMap._emit("click", {
      lngLat: { lng: 35.6, lat: 33.05 },
      point: { x: 300, y: 200 },
    });
  });
  await expect(page.locator(".build-panel__story-cta")).toHaveCount(0);
  await expect(page.locator(".build-panel__title")).toHaveText("מסלול חדש");
});

test("clearing the route hides the CTA", async ({ page }) => {
  await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  const panel = page.getByTestId("front-panel");
  await expect(page.locator(".build-panel__story-cta")).toBeVisible();
  await panel.getByRole("button", { name: "נקה" }).click();
  await expect(page.locator(".build-panel__story-cta")).toHaveCount(0);
});

test("the Build CTA navigates to the route page", async ({ page }) => {
  const { storyHref } = await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  await page.locator(".build-panel__story-cta").click();
  await expect(page).toHaveURL(new RegExp(`${storyHref}$`));
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx playwright test tests/e2e/discover-route-page-cta.spec.mjs --workers=1`
Expected: FAIL — every test times out waiting for `.build-panel__story-cta` (or the peek link) because the CTA doesn't exist yet. The shared `selectFirstDiscoverRoute` part must PASS (card click, URL gets `?route=`); if that part fails, fix the spec before moving on.

- [ ] **Step 3: Commit the spec**

```bash
git add tests/e2e/discover-route-page-cta.spec.mjs
git commit -m "test(e2e): failing spec for discover route-page CTA"
```

---

### Task 2: `selectedCatalogSlug` state and wiring in App.jsx

**Files:**
- Modify: `src/App.jsx` (state ~line 148, `handleSelectRecommended` ~line 278, popstate effect ~line 249, edit wrappers ~lines 594-626, `onSelectRecent` ~line 894, BuildPanel props ~line 904)

- [ ] **Step 1: Add the slug state and derived entry**

In `src/App.jsx`, right after the `catalogEntries` memo (line 153), add:

```jsx
  // The catalog route currently loaded in the planner, tracked by slug. Set
  // when a Discover card / recent is selected; cleared on any route edit so
  // the route-page CTA only shows while the map matches the catalog route.
  const [selectedCatalogSlug, setSelectedCatalogSlug] = useState(null);
  const selectedCatalogEntry = useMemo(
    () =>
      catalogEntries.find((entry) => entry.slug === selectedCatalogSlug) ||
      null,
    [catalogEntries, selectedCatalogSlug],
  );
```

- [ ] **Step 2: Set the slug on route selection and persist it to recents**

In `handleSelectRecommended` (line 278), change the `loaded` branch from:

```jsx
      if (loaded) {
        handlePanelStateChange("build");
        setSheetSnap("peek");
        handleAddRecentRoute({
          param: entry.route,
          name: entry.name || "מסלול",
          distanceKm: Number(entry.distanceKm) || undefined,
        });
      } else {
```

to:

```jsx
      if (loaded) {
        handlePanelStateChange("build");
        setSheetSnap("peek");
        setSelectedCatalogSlug(entry.slug || null);
        handleAddRecentRoute({
          param: entry.route,
          name: entry.name || "מסלול",
          distanceKm: Number(entry.distanceKm) || undefined,
          slug: entry.slug || undefined,
        });
      } else {
```

(`setSelectedCatalogSlug` is a stable setState — no dependency-array change.)

- [ ] **Step 3: Clear the slug on back/forward restore**

In the popstate effect (line 249), the restored param may be any historical route — not necessarily the catalog entry — so clear the slug in both branches:

```jsx
    const onPopState = async () => {
      const param = getQueryParam("route");
      setSelectedCatalogSlug(null);
      if (param) {
        await handleLoadRouteParam(param);
      } else {
        handleRouteClear();
        handlePanelStateChange("discover");
        setSheetSnap("half");
      }
    };
```

- [ ] **Step 4: Clear the slug in every route-edit wrapper**

Replace the wrappers at `src/App.jsx:594-626` with (one added line per wrapper, no dependency changes):

```jsx
  const handlePlaybackAwareUndo = useCallback(() => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleUndo();
  }, [handleUndo, pausePlannerPlayback]);
  const handlePlaybackAwareRedo = useCallback(() => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRedo();
  }, [handleRedo, pausePlannerPlayback]);
  const handlePlaybackAwareRouteClear = useCallback(() => {
    plannerPlayback.reset();
    setHoveredBand(null);
    setSelectedCatalogSlug(null);
    handleRouteClear();
  }, [handleRouteClear, plannerPlayback.reset]);
  const handlePlaybackAwareMapClick = useCallback((event) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleMapClick(event);
  }, [handleMapClick, pausePlannerPlayback]);
  const handlePlaybackAwareRoutePointDragStart = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRoutePointDragStart(...args);
  }, [handleRoutePointDragStart, pausePlannerPlayback]);
  const handlePlaybackAwareRoutePointRemove = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRoutePointRemove(...args);
  }, [handleRoutePointRemove, pausePlannerPlayback]);
  const handlePlaybackAwareRouteLineDragStart = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRouteLineDragStart(...args);
  }, [handleRouteLineDragStart, pausePlannerPlayback]);
  const handlePlaybackAwareAddDataMarkerToRoute = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleAddDataMarkerToRoute(...args);
  }, [handleAddDataMarkerToRoute, pausePlannerPlayback]);
```

- [ ] **Step 5: Pass the slug when selecting a recent**

In the `onSelectRecent` prop (line ~894), add `slug`:

```jsx
                      onSelectRecent={(entry) =>
                        handleSelectRecommended({
                          route: entry.param,
                          name: entry.name,
                          distanceKm: entry.distanceKm,
                          slug: entry.slug,
                        })
                      }
```

- [ ] **Step 6: Pass the derived entry to BuildPanel**

In the `<BuildPanel ...>` element (line ~904), add the prop:

```jsx
                    <BuildPanel
                      routeState={routeState}
                      catalogEntry={selectedCatalogEntry}
```

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat(discover): track selected catalog route slug in App state"
```

---

### Task 3: Route-page CTA in BuildPanel

**Files:**
- Modify: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/components/frontPanel/front-panel.css` (after `.build-panel__title`, line ~472)

- [ ] **Step 1: Render the head title and CTA from `catalogEntry`**

In `src/components/frontPanel/BuildPanel.jsx`, add imports at the top:

```jsx
import { routeDisplayImage } from "@cycleways/core/data/catalog.js";
import { routeImageSrc } from "../routes/routeImageSrc.js";
```

Add `catalogEntry` to the props (after `routeState`):

```jsx
export default function BuildPanel({
  routeState,
  catalogEntry,
```

Replace the head block:

```jsx
      <div className="build-panel__head">
        <div>
          <div className="eyebrow">המסלול שלי · טיוטה</div>
          <div className="build-panel__title">מסלול חדש</div>
        </div>
```

with:

```jsx
      <div className="build-panel__head">
        <div>
          <div className="eyebrow">
            {catalogEntry ? "מסלול מומלץ" : "המסלול שלי · טיוטה"}
          </div>
          <div className="build-panel__title">
            {catalogEntry?.name || "מסלול חדש"}
          </div>
        </div>
```

Then, directly after the closing `</div>` of `.build-panel__head`, add the CTA strip:

```jsx
      {catalogEntry && <RoutePageCta entry={catalogEntry} />}
```

And add the component at the bottom of the file (next to `Stat`):

```jsx
// Photo-strip CTA to the route's dedicated page, shown while the planner
// holds an unedited catalog route (the moment of highest intent).
function RoutePageCta({ entry }) {
  const photo = routeDisplayImage(entry);
  return (
    <a className="build-panel__story-cta" href={`/routes/${entry.slug}`}>
      {photo ? (
        <img
          src={routeImageSrc(photo.thumbnail || photo.photo)}
          alt=""
          loading="lazy"
        />
      ) : null}
      <span>לעמוד המסלול המלא ←</span>
    </a>
  );
}
```

- [ ] **Step 2: Style the CTA**

In `src/components/frontPanel/front-panel.css`, after the `.build-panel__title` rule (line ~472), add:

```css
.build-panel__story-cta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 8px;
  border: 1px solid #dce4df;
  border-radius: 12px;
  background: #f3f7f1;
  color: #2f6b3c;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  transition: box-shadow 0.15s ease;
}
.build-panel__story-cta:hover,
.build-panel__story-cta:focus-visible {
  box-shadow: 0 4px 14px rgba(40, 48, 38, 0.12);
}
.build-panel__story-cta img {
  flex: 0 0 64px;
  width: 64px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
}
```

- [ ] **Step 3: Run the spec — desktop CTA tests should pass**

Run: `npx playwright test tests/e2e/discover-route-page-cta.spec.mjs --workers=1`
Expected: the four CTA tests ("shows the route-page CTA", "editing ... hides", "clearing ... hides", "navigates") PASS on both projects; only "mobile: build peek ..." still FAILS (peek link not built yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/frontPanel/BuildPanel.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(discover): route-page CTA in the Build panel"
```

---

### Task 4: Route-page link in the mobile peek strip

**Files:**
- Modify: `src/App.jsx` (peek content, build branch ~line 855)
- Modify: `src/components/frontPanel/front-panel.css` (inside the same mobile media block as `.front-sheet__build-peek`, line ~251)

- [ ] **Step 1: Show the route name and page link in the build peek**

In `src/App.jsx`, replace the build branch of `peekContent`:

```jsx
                    ) : (
                      <button
                        type="button"
                        className="front-sheet__build-peek"
                        onClick={handlePeekBuild}
                      >
                        <span>מסלול חדש</span>
                        <span>
                          {routePointCount > 0
                            ? `${routePointCount} נקודות · ${formatLegacyDistance(routeState.distance)}`
                            : "0 נקודות"}
                        </span>
                      </button>
                    )}
```

with:

```jsx
                    ) : (
                      <div className="front-sheet__build-peek-row">
                        <button
                          type="button"
                          className="front-sheet__build-peek"
                          onClick={handlePeekBuild}
                        >
                          <span>{selectedCatalogEntry?.name || "מסלול חדש"}</span>
                          <span>
                            {routePointCount > 0
                              ? `${routePointCount} נקודות · ${formatLegacyDistance(routeState.distance)}`
                              : "0 נקודות"}
                          </span>
                        </button>
                        {selectedCatalogEntry && (
                          <a
                            className="front-sheet__build-peek-link"
                            href={`/routes/${selectedCatalogEntry.slug}`}
                            aria-label="לעמוד המסלול"
                          >
                            לעמוד המסלול ←
                          </a>
                        )}
                      </div>
                    )}
```

- [ ] **Step 2: Style the row and link**

In `src/components/frontPanel/front-panel.css`, inside the same `@media` block that holds `.front-sheet__build-peek` (after line ~275, before the block's closing `}`), add:

```css
  .front-sheet__build-peek-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }
  .front-sheet__build-peek-row .front-sheet__build-peek {
    flex: 1 1 auto;
    min-width: 0;
  }
  .front-sheet__build-peek-link {
    display: flex;
    align-items: center;
    padding: 0 12px;
    border: 1px solid #dce4df;
    border-radius: 12px;
    background: #f3f7f1;
    color: #2f6b3c;
    font-size: 0.8rem;
    font-weight: 800;
    text-decoration: none;
    white-space: nowrap;
  }
```

- [ ] **Step 3: Run the full spec — everything should pass**

Run: `npx playwright test tests/e2e/discover-route-page-cta.spec.mjs --workers=1`
Expected: all 5 tests PASS (the mobile peek test runs only on the `mobile` project).

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(discover): route-page link in the mobile build peek"
```

---

### Task 5: Strengthen the per-card route-page link into a chip

**Files:**
- Modify: `src/components/frontPanel/front-panel.css:766-779`

CSS-only restyle — markup, class name, and `stopPropagation` behavior in `PanelRouteCard.jsx` stay as they are, so existing specs keep matching.

- [ ] **Step 1: Restyle the link as a chip**

Replace the `.panel-route-card__story-link` rules (lines 766-779):

```css
.panel-route-card__story-link {
  position: absolute;
  bottom: 8px;
  left: 10px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #2f6b3c;
  text-decoration: none;
}

.panel-route-card__story-link:hover,
.panel-route-card__story-link:focus-visible {
  text-decoration: underline;
}
```

with:

```css
.panel-route-card__story-link {
  position: absolute;
  bottom: 6px;
  left: 8px;
  padding: 3px 9px;
  border: 1px solid #cfe0d2;
  border-radius: 999px;
  background: #f3f7f1;
  font-size: 0.78rem;
  font-weight: 700;
  color: #2f6b3c;
  text-decoration: none;
}

.panel-route-card__story-link:hover,
.panel-route-card__story-link:focus-visible {
  background: #e6efe6;
  border-color: #2f6b3c;
}
```

- [ ] **Step 2: Eyeball it**

Run: `npm run dev` and open `http://127.0.0.1:5173/` — the Discover cards should show a small pill-shaped "לעמוד המסלול ←" chip at the card's bottom-left, not overlapping the meta line (the card already reserves `padding-bottom: 26px` for it). Check one card at mobile width (devtools, ≤860px) too.

- [ ] **Step 3: Commit**

```bash
git add src/components/frontPanel/front-panel.css
git commit -m "style(discover): route-page link as a visible chip on panel cards"
```

---

### Task 6: Regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the neighboring e2e suites**

Run:

```bash
npx playwright test tests/e2e/discover-route-select.spec.mjs tests/e2e/front-panel.spec.mjs tests/e2e/mobile-sheet.spec.mjs tests/e2e/planner-retention.spec.mjs tests/e2e/discover-route-page-cta.spec.mjs --workers=1
```

Expected: all PASS. The likely regressions are in `mobile-sheet.spec.mjs` / `planner-retention.spec.mjs` if they assert the peek button's exact "מסלול חדש" text or the old single-button peek structure — if one fails, read the assertion and update it to match the new `front-sheet__build-peek-row` wrapper (the button itself, its class, and its default text are unchanged when no catalog route is loaded).

- [ ] **Step 2: Run the unit-test suite**

Run: `npm test`
Expected: PASS (no core/unit code changed; this guards against accidental import breakage).

- [ ] **Step 3: Commit any test repairs**

```bash
git add tests/e2e
git commit -m "test(e2e): align panel specs with build-peek row wrapper"
```

(Skip if nothing needed repair.)
