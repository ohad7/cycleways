# Build Empty-State Action Starters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty Build panel (0 route points) with compact how-to steps plus starting actions: an in-panel place search + locate-me (sharing state with the map overlay search), and a resume-draft row that suppresses the floating draft banner while visible.

**Architecture:** A pure visibility helper in `@cycleways/core` decides when the floating `DraftRestoreBanner` yields to the panel. A new presentational component `BuildEmptyActions.jsx` receives all state/handlers as props; `App.jsx` composes it and passes it to `BuildPanel` as an `emptyState` element prop (same pattern as the existing `elevation`/`playback` element props). No new state, storage, or network paths — everything reuses the `useCyclewaysApp` controller's existing search/locate/draft plumbing. The on-map `PlannerHints` are untouched.

**Tech Stack:** React 19 (JSX), plain CSS in `front-panel.css`, node-assert unit test (`tests/*.mjs` chain in package.json), Playwright e2e (`tests/e2e/`).

Spec: `plans/build-empty-actions/design.md`.

> **⚠️ Mutually exclusive alternative:** This plan competes with
> `plans/build-empty-guide-vignette/` for the same UI space (the
> `build-panel__empty` paragraph in `BuildPanel.jsx`). Before starting, check
> that `src/components/frontPanel/BuildEmptyGuide.jsx` does NOT exist and
> `BuildPanel.jsx` does not import it. If the other design was already
> implemented, STOP and ask the user.

## Global Constraints

- Hebrew/RTL app. Copy strings must be used **verbatim** as written in the tasks below.
- Do not modify `src/components/PlannerHints.jsx` or `src/components/DraftRestoreBanner.jsx`.
- Do not touch `data/` or `public-data/` (pipeline-owned; see CLAUDE.md).
- Mobile breakpoint used by the planner CSS: `@media (max-width: 860px)`.
- The actions block shows only at `routeState.points.length === 0`. With exactly 1 point the existing plain paragraph (`סמנו נקודות על המפה כדי לבנות מסלול.`) must still render.
- The search input placeholder must match the map overlay's existing placeholder exactly: `ישוב/עיר, לדוגמא: דפנה`.
- The recommended-route-starter strip is **out of scope** (optional extension in the spec).
- Never `git add -A` (build artifacts / generated files may be dirty); stage listed files explicitly.

---

### Task 1: Pure helper — when does the floating draft banner show?

**Files:**
- Create: `packages/core/src/ui/draftBannerVisibility.js`
- Modify: `package.json` (add the test to the `test` script chain)
- Test: `tests/test-draft-banner.mjs`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `shouldShowFloatingDraftBanner({ hasDraft, hasRouteParam, pointCount, panelState, isMobileSheet, sheetSnap })` → `boolean`. Booleans/number/strings; `panelState` is `"discover" | "build"`, `sheetSnap` is `"peek" | "half" | "full"`. Task 3 imports it via `@cycleways/core/ui/draftBannerVisibility.js` (the core package maps `./*` → `./src/*`).

- [ ] **Step 1: Write the failing test**

Create `tests/test-draft-banner.mjs`:

```js
import assert from "node:assert/strict";
import { shouldShowFloatingDraftBanner } from "@cycleways/core/ui/draftBannerVisibility.js";

const base = {
  hasDraft: true,
  hasRouteParam: false,
  pointCount: 0,
  panelState: "discover",
  isMobileSheet: false,
  sheetSnap: "half",
};

// No draft / shared-route URL / already-started route → never.
assert.equal(shouldShowFloatingDraftBanner({ ...base, hasDraft: false }), false);
assert.equal(shouldShowFloatingDraftBanner({ ...base, hasRouteParam: true }), false);
assert.equal(shouldShowFloatingDraftBanner({ ...base, pointCount: 2 }), false);

// Discover state → the floating banner is the offer (panel row not rendered).
assert.equal(shouldShowFloatingDraftBanner(base), true);

// Desktop Build → the panel's empty-state draft row is visible; banner yields.
assert.equal(
  shouldShowFloatingDraftBanner({ ...base, panelState: "build" }),
  false,
);

// Mobile Build at peek → the sheet body (and its draft row) is hidden; banner shows.
assert.equal(
  shouldShowFloatingDraftBanner({
    ...base,
    panelState: "build",
    isMobileSheet: true,
    sheetSnap: "peek",
  }),
  true,
);

// Mobile Build at half/full → the panel row is visible; banner yields.
for (const sheetSnap of ["half", "full"]) {
  assert.equal(
    shouldShowFloatingDraftBanner({
      ...base,
      panelState: "build",
      isMobileSheet: true,
      sheetSnap,
    }),
    false,
  );
}

console.log("test-draft-banner: OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-draft-banner.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (draftBannerVisibility.js does not exist).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/ui/draftBannerVisibility.js`:

```js
// De-duplication rule for the draft-restore offer: the floating map banner
// yields to the Build panel's empty-state draft row whenever that row is
// actually visible (Build state; on mobile only while the sheet is open).
// The first three checks mirror the banner's original render condition.
export function shouldShowFloatingDraftBanner({
  hasDraft,
  hasRouteParam,
  pointCount,
  panelState,
  isMobileSheet,
  sheetSnap,
}) {
  if (!hasDraft || hasRouteParam || pointCount > 0) return false;
  const panelRowVisible =
    panelState === "build" && (!isMobileSheet || sheetSnap !== "peek");
  return !panelRowVisible;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-draft-banner.mjs`
Expected: `test-draft-banner: OK`

- [ ] **Step 5: Add the test to the package.json chain**

In `package.json`, inside the `"test"` script, insert `node tests/test-draft-banner.mjs && ` immediately after `node tests/test-planner-memory.mjs && `.

Run: `node tests/test-planner-memory.mjs && node tests/test-draft-banner.mjs`
Expected: both print OK.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ui/draftBannerVisibility.js tests/test-draft-banner.mjs package.json
git commit -m "feat: pure visibility rule for the floating draft banner"
```

---

### Task 2: BuildEmptyActions component (steps + search + locate) wired through BuildPanel

**Files:**
- Create: `src/components/frontPanel/BuildEmptyActions.jsx`
- Modify: `src/components/frontPanel/BuildPanel.jsx` (new `emptyState` prop; empty-state branch, ~lines 65–73)
- Modify: `src/App.jsx` (import + compose the element into `buildPanel`, ~line 898)
- Modify: `src/components/frontPanel/front-panel.css` (append styles)
- Test: `tests/e2e/build-empty-actions.spec.mjs`

**Interfaces:**
- Consumes (from `useCyclewaysApp`, already destructured in `App.jsx`): `mapUi.searchQuery` (string), `mapUi.searchStatus` (`"idle" | "searching"`), `mapUi.searchError` (string|null), `mapUi.locateStatus` (`"idle" | "locating"`), `handleSearchQueryChange(value: string)`, `handleSearchSubmit(event)` (form onSubmit), `handleLocateMe()`.
- Produces:
  - `BuildEmptyActions` — default export with props `{ searchQuery, searchStatus, searchError, onSearchQueryChange, onSearchSubmit, locateStatus, onLocateMe }`; renders `div[data-testid="build-empty-actions"]`. Task 3 extends it with `{ draft, onRestoreDraft }`.
  - `BuildPanel` — new optional element prop `emptyState`, rendered when `routeState.points.length === 0` (same element-prop pattern as `elevation`/`playback`).

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/build-empty-actions.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen, revealMapOnMobile } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

// Mobile lands on the discover-home screen (no map); revealMapOnMobile taps
// "+ תכנן מסלול" which enters Build directly. Desktop uses the panel tab.
export async function openEmptyBuild(page, isMobile) {
  await page.goto("/");
  await revealMapOnMobile(page, isMobile);
  await ensurePanelOpen(page);
  if (!isMobile) {
    await page
      .getByTestId("front-panel")
      .getByRole("tab", { name: "בניית מסלול" })
      .click();
  }
}

test("empty Build shows the steps and starting actions", async ({ page, isMobile }) => {
  await openEmptyBuild(page, isMobile);
  const actions = page.getByTestId("build-empty-actions");
  await expect(actions).toBeVisible();
  await expect(actions.locator(".build-empty-actions__steps li")).toHaveCount(3);
  await expect(actions.getByLabel("חיפוש מיקום")).toBeVisible();
  await expect(actions.getByRole("button", { name: "המיקום שלי" })).toBeVisible();
  // The old one-line empty paragraph is replaced at 0 points.
  await expect(page.locator(".build-panel__empty")).toHaveCount(0);
});

test("panel search input shares state with the map search overlay", async ({ page, isMobile }) => {
  await openEmptyBuild(page, isMobile);
  const actions = page.getByTestId("build-empty-actions");
  await actions.getByLabel("חיפוש מיקום").fill("דפנה");
  // Both inputs are bound to the same mapUi.searchQuery state.
  await expect(page.locator("#location-search")).toHaveValue("דפנה");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/build-empty-actions.spec.mjs --workers=1`
Expected: FAIL — times out waiting for `getByTestId("build-empty-actions")`.

- [ ] **Step 3: Create the component**

Create `src/components/frontPanel/BuildEmptyActions.jsx`:

```jsx
import React from "react";
import Icon from "../Icon.jsx";

// Persistent Build empty state: brief how-to steps plus starting actions.
// The search input and locate button share the controller's existing map
// search/locate state, so this block and the map overlay stay in sync.
// Rendered only while the route has zero points; the on-map PlannerHints
// keep covering the contextual moments after the first tap.
export default function BuildEmptyActions({
  searchQuery,
  searchStatus,
  searchError,
  onSearchQueryChange,
  onSearchSubmit,
  locateStatus,
  onLocateMe,
}) {
  return (
    <div className="build-empty-actions" data-testid="build-empty-actions">
      <ol className="build-empty-actions__steps">
        <li>לחצו על המפה ליד שביל כדי להתחיל</li>
        <li>הוסיפו נקודה נוספת — המסלול יחושב לאורך השבילים</li>
        <li>גררו את הקו כדי לדייק, ואז הורידו GPX או שתפו</li>
      </ol>
      <div className="build-empty-actions__where">
        <div className="dlabel">איפה מתחילים?</div>
        <form className="build-empty-actions__search" onSubmit={onSearchSubmit}>
          <input
            type="text"
            placeholder="ישוב/עיר, לדוגמא: דפנה"
            aria-label="חיפוש מיקום"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
          <button
            type="submit"
            disabled={searchStatus === "searching"}
            aria-label="חיפוש"
            title="חיפוש מיקום"
          >
            <Icon name="search-outline" />
          </button>
        </form>
        <button
          type="button"
          className="build-empty-actions__locate"
          disabled={locateStatus === "locating"}
          onClick={onLocateMe}
        >
          <Icon name="locate-outline" /> המיקום שלי
        </button>
        {searchError ? (
          <p className="build-empty-actions__error">{searchError}</p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the `emptyState` prop to BuildPanel**

In `src/components/frontPanel/BuildPanel.jsx`, add `emptyState,` to the destructured props (after `error,`). Replace the existing empty-state branch:

```jsx
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}
```

with:

```jsx
      ) : routeState.points.length === 0 && emptyState ? (
        emptyState
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}
```

(The 1-point-no-route state keeps the plain paragraph; the on-map hint "הוסיפו נקודה נוספת" owns that moment.)

- [ ] **Step 5: Compose the element in App.jsx**

In `src/App.jsx`:

1. Add the import next to the existing `BuildPanel` import (~line 36):

```jsx
import BuildEmptyActions from "./components/frontPanel/BuildEmptyActions.jsx";
```

2. In the `buildPanel` element (~line 898, `<BuildPanel …>`), add the prop:

```jsx
      emptyState={
        <BuildEmptyActions
          searchQuery={mapUi.searchQuery}
          searchStatus={mapUi.searchStatus}
          searchError={mapUi.searchError}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchSubmit={handleSearchSubmit}
          locateStatus={mapUi.locateStatus}
          onLocateMe={handleLocateMe}
        />
      }
```

- [ ] **Step 6: Add the styles**

Append to `src/components/frontPanel/front-panel.css`:

```css
/* Build empty-state actions (steps + starting shortcuts) */
.build-empty-actions {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.build-empty-actions__steps {
  margin: 0;
  padding-inline-start: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: #283026;
  line-height: 1.5;
}
.build-empty-actions__where {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.build-empty-actions__search {
  display: flex;
  gap: 6px;
}
.build-empty-actions__search input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid #cdd7c8;
  border-radius: 10px;
  font-size: 13px;
  background: #fff;
  color: #283026;
}
.build-empty-actions__search button[type="submit"] {
  border: 1px solid #cdd7c8;
  border-radius: 10px;
  background: #fff;
  color: #355e3b;
  padding: 0 10px;
  cursor: pointer;
}
.build-empty-actions__locate {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 10px;
  background: #355e3b;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 8px 12px;
  cursor: pointer;
}
.build-empty-actions__locate:disabled {
  opacity: 0.6;
  cursor: default;
}
.build-empty-actions__error {
  margin: 0;
  font-size: 12px;
  color: #a33a2a;
}
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `npx playwright test tests/e2e/build-empty-actions.spec.mjs --workers=1`
Expected: PASS (both tests, desktop and mobile projects).

- [ ] **Step 8: Commit**

```bash
git add src/components/frontPanel/BuildEmptyActions.jsx src/components/frontPanel/BuildPanel.jsx src/App.jsx src/components/frontPanel/front-panel.css tests/e2e/build-empty-actions.spec.mjs
git commit -m "feat: action-oriented empty state in the Build panel (steps + search + locate)"
```

---

### Task 3: Draft-resume row + floating banner suppression

**Files:**
- Modify: `src/components/frontPanel/BuildEmptyActions.jsx` (add draft row)
- Modify: `src/App.jsx` (shared restore callback; banner condition via the Task 1 helper; pass draft props)
- Test: `tests/e2e/build-empty-actions.spec.mjs` (add a test)

**Interfaces:**
- Consumes: `shouldShowFloatingDraftBanner` from Task 1; `BuildEmptyActions` from Task 2; from `useCyclewaysApp` (already destructured in `App.jsx`): `plannerDraft` (`{ param, distanceKm, savedAt } | null`), `handleRestoreDraft()` (async → boolean), `handleDismissDraft()`. Existing `App.jsx` locals: `SHOW_DRAFT_RESTORE_BANNER` (line ~65), `hasQueryParam` (imported from `@cycleways/core/platform/location.js`), `routePointCount`, `panel.state`, `isMobileSheet`, `sheetSnap`, `setSelectedCatalogSlug`, `handlePanelStateChange`.
- Produces: `BuildEmptyActions` accepts two more props: `draft` (same shape as `plannerDraft`) and `onRestoreDraft()`.

- [ ] **Step 1: Add the failing e2e test**

Append to `tests/e2e/build-empty-actions.spec.mjs` (uses `openEmptyBuild` from Task 2; the draft store is plain localStorage under the key defined in `packages/core/src/app/useCyclewaysApp.js`):

```js
const SEEDED_DRAFT = { param: "seeded", distanceKm: 12.4, savedAt: 1718000000000 };

test("draft offer moves into the panel on Build; floating banner yields", async ({ page, isMobile }) => {
  await page.addInitScript((draft) => {
    window.localStorage.setItem("cycleways:planner-draft", JSON.stringify(draft));
  }, SEEDED_DRAFT);
  await page.goto("/");
  if (!isMobile) {
    // Discover state: the floating banner is still the offer.
    await expect(page.locator(".draft-restore-banner")).toBeVisible();
  }
  await revealMapOnMobile(page, isMobile);
  await ensurePanelOpen(page);
  if (!isMobile) {
    await page
      .getByTestId("front-panel")
      .getByRole("tab", { name: "בניית מסלול" })
      .click();
  }
  const draftRow = page.locator(".build-empty-actions__draft");
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText("12.4");
  await expect(page.locator(".draft-restore-banner")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/build-empty-actions.spec.mjs --workers=1`
Expected: the new test FAILS (`.build-empty-actions__draft` not found, and/or the floating banner still present in Build); the two Task 2 tests still PASS.

- [ ] **Step 3: Add the draft row to BuildEmptyActions**

In `src/components/frontPanel/BuildEmptyActions.jsx`, add `draft,` and `onRestoreDraft,` to the props destructuring (after `onLocateMe,`), and insert this block immediately after the closing `</div>` of `.build-empty-actions__where` (still inside `.build-empty-actions`):

```jsx
      {draft ? (
        <div className="build-empty-actions__draft">
          <span>
            להמשיך את המסלול הקודם
            {Number.isFinite(draft.distanceKm) ? ` (${draft.distanceKm} ק"מ)` : ""}?
          </span>
          <button type="button" onClick={onRestoreDraft}>
            שחזור
          </button>
        </div>
      ) : null}
```

- [ ] **Step 4: Share the restore callback and gate the floating banner in App.jsx**

In `src/App.jsx`:

1. Add the helper import next to the other `@cycleways/core` imports:

```jsx
import { shouldShowFloatingDraftBanner } from "@cycleways/core/ui/draftBannerVisibility.js";
```

2. Extract the restore flow currently inlined in the `DraftRestoreBanner` `onRestore` (~line 1105) into a shared callback. Define it inside `App()` after `handlePanelStateChange` is defined (search for `const handlePanelStateChange`) and before the `buildPanel` element:

```jsx
  // Restore the autosaved draft into the planner (shared by the floating
  // banner and the Build empty-state row).
  const handleDraftRestore = useCallback(async () => {
    setSelectedCatalogSlug(null);
    const ok = await handleRestoreDraft();
    if (ok) handlePanelStateChange("build");
  }, [handleRestoreDraft, handlePanelStateChange]);
```

3. Pass the draft props in the `BuildEmptyActions` element created in Task 2 (after `onLocateMe={handleLocateMe}`):

```jsx
          draft={plannerDraft}
          onRestoreDraft={handleDraftRestore}
```

4. Replace the floating banner's render condition (~line 1102):

```jsx
                {SHOW_DRAFT_RESTORE_BANNER && plannerDraft && !hasQueryParam("route") && routePointCount === 0 && (
                  <DraftRestoreBanner
                    draft={plannerDraft}
                    onRestore={async () => {
                      setSelectedCatalogSlug(null);
                      const ok = await handleRestoreDraft();
                      if (ok) handlePanelStateChange("build");
                    }}
                    onDismiss={handleDismissDraft}
                  />
                )}
```

with:

```jsx
                {SHOW_DRAFT_RESTORE_BANNER &&
                  shouldShowFloatingDraftBanner({
                    hasDraft: Boolean(plannerDraft),
                    hasRouteParam: hasQueryParam("route"),
                    pointCount: routePointCount,
                    panelState: panel.state,
                    isMobileSheet,
                    sheetSnap,
                  }) && (
                    <DraftRestoreBanner
                      draft={plannerDraft}
                      onRestore={handleDraftRestore}
                      onDismiss={handleDismissDraft}
                    />
                  )}
```

- [ ] **Step 5: Add the draft-row styles**

Append to `src/components/frontPanel/front-panel.css`:

```css
.build-empty-actions__draft {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #f3efe2;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  color: #283026;
}
.build-empty-actions__draft button {
  border: none;
  border-radius: 8px;
  background: #355e3b;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 6px 12px;
  cursor: pointer;
}
```

- [ ] **Step 6: Run the e2e spec to verify it passes**

Run: `npx playwright test tests/e2e/build-empty-actions.spec.mjs --workers=1`
Expected: PASS (all three tests, desktop and mobile projects).

- [ ] **Step 7: Run the unit test chain sanity check**

Run: `node tests/test-draft-banner.mjs && node tests/test-planner-memory.mjs`
Expected: both print OK.

- [ ] **Step 8: Commit**

```bash
git add src/components/frontPanel/BuildEmptyActions.jsx src/App.jsx src/components/frontPanel/front-panel.css tests/e2e/build-empty-actions.spec.mjs
git commit -m "feat: draft-resume row in the Build empty state; floating banner yields"
```

---

### Task 4: Mobile compact layout + final verification

**Files:**
- Modify: `src/components/frontPanel/front-panel.css` (append mobile media block)

**Interfaces:**
- Consumes: `.build-empty-actions*` classes from Tasks 2–3.
- Produces: nothing further.

- [ ] **Step 1: Append the mobile compact rules**

Append to `src/components/frontPanel/front-panel.css`:

```css
@media (max-width: 860px) {
  .build-empty-actions {
    gap: 10px;
  }
  .build-empty-actions__steps {
    gap: 4px;
    font-size: 12px;
    line-height: 1.4;
  }
  .build-empty-actions__where {
    gap: 6px;
  }
}
```

- [ ] **Step 2: Verify on a mobile viewport**

Run `npm run dev`, open DevTools device emulation at 390×844, reload, tap "+ תכנן מסלול" on the discover home.
Verify: the sheet opens at half height; the three steps, the search row, the locate button, and (with a draft seeded via
`localStorage.setItem("cycleways:planner-draft", JSON.stringify({param:"x",distanceKm:12.4,savedAt:Date.now()}))`
in the console before reload) the draft row are all reachable — steps+search visible without scrolling. RTL layout: steps numbered on the right, search button on the left of the input.

- [ ] **Step 3: Verify search + locate behavior manually (desktop)**

In a desktop window, open Build: type `דפנה` in the panel search and submit — the map flies to the result and no route point is added; the map-overlay input shows the same text. Click "המיקום שלי" — same behavior as the map's locate control (allow/deny both fine; a denial shows the error line under the search input).

- [ ] **Step 4: Run the spec plus the neighboring planner specs (regression)**

Run: `npx playwright test tests/e2e/build-empty-actions.spec.mjs tests/e2e/planner-hints.spec.mjs tests/e2e/front-panel.spec.mjs tests/e2e/mobile-sheet.spec.mjs tests/e2e/planner-retention.spec.mjs --workers=1`
Expected: PASS (all). `planner-retention.spec.mjs` matters here — it exercises the draft flow this plan touched.

- [ ] **Step 5: Commit**

```bash
git add src/components/frontPanel/front-panel.css
git commit -m "feat: compact mobile layout for the Build empty-state actions"
```

---

## Final verification

- [ ] Run the full smoke suite: `npm run test:smoke` — expected PASS (pre-existing failures, if any, must be shown to be present on the base commit too).
- [ ] Run the node unit chain at least through the new test: `node tests/test-draft-banner.mjs` — OK.
- [ ] `git status` — only the files listed in this plan are modified/created.
