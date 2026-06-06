# Topbar Route Navigation Implementation Plan

Date: 2026-06-06

## Goal

Make the public navigation model clear and singular:

- one route catalog at `/routes/`;
- route details under `/routes/:slug`;
- featured routes shown at the top of the same catalog;
- breadcrumbs that explain hierarchy;
- no stale `/#reccomendations` topbar link or front-page section.

## Task 1: Normalize Topbar Links

Files:

- `src/components/TopBar.jsx`
- topbar-related CSS in `styles.css`
- `tests/e2e/featured-index.spec.mjs`
- any topbar route tests that assert labels or hrefs

Steps:

1. Replace the default nav model with:
   - `מפה` -> `/`
   - `מסלולים` -> `/routes/`
   - `על המפה` -> `/#trails`
   - `צרו קשר` or `דיווח ועדכונים` -> `/#contact`
   - `מצא מסלול` action when available
   - `מדריך`
2. Remove the `המלצות` link and all references to `#reccomendations`.
3. Add active-state calculation from `useLocation()`:
   - route paths `/routes*` and `/featured*` activate `מסלולים`;
   - `/` activates `מפה`;
   - optional hash-active styling for `#trails` and `#contact`.
4. Make mobile menu close after route-link clicks, not only anchor/action
   clicks.
5. Keep existing `navLinks` override support for route detail in-page anchors,
   but update those overrides to include a canonical route-catalog link.

Validation:

- Topbar shows no `המלצות` link.
- On `/`, `מפה` is active.
- On `/routes/`, `מסלולים` is active.
- On `/routes/:slug`, `מסלולים` is active.
- Mobile nav closes after tapping a route link.

## Task 2: Remove Stale Recommendations Section

Files:

- `src/components/ContentSections.jsx`
- tests that reference `#reccomendations`

Steps:

1. Delete the full `section id="reccomendations"` block.
2. Remove `RecommendationButton` if it is no longer used.
3. Remove `focusSegment` logic if it only supported the deleted section.
4. Keep `#trails` and `#contact` sections unchanged.
5. Update tests that navigate through `/#reccomendations` or expect the old
   recommendation buttons.

Validation:

- Front page renders without the recommendations section.
- `rg "reccomendations|המלצות"` returns no public navigation/content matches
  except historical docs if any.
- `/#contact` and `/#trails` still scroll correctly.

## Task 3: Make `/routes/` Canonical In Visible Links

Files:

- `src/components/TopBar.jsx`
- `src/components/routes/RouteCatalogCard.jsx`
- `src/components/RouteCard.jsx`
- `src/featured/index.js`
- `src/featured/genericRouteStory.js`
- `tests/e2e/featured-index.spec.mjs`
- `tests/e2e/routes-index.spec.mjs`

Steps:

1. Change topbar `מסלולים` href from `/featured/` to `/routes/`.
2. Ensure route catalog detail links point to `/routes/:slug`.
3. In route-finder cards, keep details links on `/routes/:slug`.
4. Update per-route nav override links from `כל המסלולים -> /featured/` to
   `כל המסלולים -> /routes/`.
5. Keep planner/open-map links unchanged.

Validation:

- Clicking `מסלולים` from `/` opens `/routes/`.
- Clicking `מסלולים` from `/#contact` opens `/routes/` without blank transition.
- Route card details open `/routes/:slug`.
- No visible link points to `/featured/` unless it is an intentional
  compatibility test.

## Task 4: Breadcrumb Component

Files:

- new `src/components/Breadcrumbs.jsx`
- `src/components/PageShell.jsx`
- CSS in `styles.css` or a page-shell stylesheet
- page tests

Steps:

1. Add a small `Breadcrumbs` component accepting `items`.
2. Each item supports:
   - `label`;
   - optional `to` for React Router links;
   - optional `href` for hash anchors if needed;
   - current item without a link.
3. Render breadcrumbs below `TopBar` inside `PageShell` when `breadcrumbs` are
   passed.
4. Use semantic markup:
   - `nav aria-label="פירורי לחם"`
   - ordered list.
5. Style as compact, low-emphasis text with clear separators.
6. Make it responsive; do not let long route names overflow on mobile.

Validation:

- Breadcrumb links are keyboard-focusable.
- Current crumb is not a link.
- Long route names wrap or truncate cleanly on mobile.

## Task 5: Add Breadcrumbs To Public Pages

Files:

- `src/pages/RoutesIndexPage.jsx`
- `src/pages/RouteDetailPage.jsx`
- `src/pages/FeaturedRoutePage.jsx`
- route-story pages if they bypass `PageShell`

Steps:

1. On `/routes/`, pass:
   - `מפה` -> `/`
   - `מסלולים` current
2. On `/routes/:slug`, pass:
   - `מפה` -> `/`
   - `מסלולים` -> `/routes/`
   - route name current
3. On `/featured/`, if still rendered as an alias, pass the same breadcrumbs as
   `/routes/`.
4. On `/featured/:slug`, if still rendered as an alias, pass the same
   breadcrumbs as `/routes/:slug`.
5. Loading states may show only `מפה > מסלולים` until the route name is loaded.
6. Missing route states should show:
   - `מפה` -> `/`
   - `מסלולים` -> `/routes/`
   - `לא נמצא` current

Validation:

- `/routes/` displays `מפה > מסלולים`.
- `/routes/sovev-beit-hillel` displays
  `מפה > מסלולים > סובב בית הלל`.
- `/featured/sovev-beit-hillel`, if retained, displays the same canonical
  hierarchy.

## Task 6: `/featured` Compatibility Behavior

Files:

- `src/main.jsx`
- optional new redirect helper component
- route tests

Steps:

1. Choose compatibility behavior for the first implementation:
   - preferred: redirect `/featured/` to `/routes/` and `/featured/:slug` to
     `/routes/:slug`;
   - fallback: render the same components but with canonical links and
     breadcrumbs.
2. If redirecting, use React Router navigation with `replace` so browser back
   behavior is clean.
3. Preserve tests that prove old URLs still resolve.
4. Update all visible links to the canonical `/routes` hierarchy.

Validation:

- `/featured/` does not dead-end.
- `/featured/:slug` does not dead-end.
- Browser back from a redirected old URL behaves predictably.

## Task 7: Catalog Ordering Confirmation

Files:

- `src/pages/RoutesIndexPage.jsx`
- route catalog tests if needed

Steps:

1. Confirm `sortRoutes()` puts featured routes first when `sortOrder` does not
   override the order.
2. Keep `מומלץ במיוחד` badges on cards.
3. Do not add tabs for featured versus all routes.

Validation:

- Featured routes appear before ordinary routes.
- Non-featured routes still appear in the same catalog.
- Filters apply across all routes.

## Task 8: Tests And Manual Verification

Automated checks:

- `npm run build`
- `npx playwright test tests/e2e/featured-index.spec.mjs --workers=1`
- `npx playwright test tests/e2e/routes-index.spec.mjs --workers=1`
- any existing topbar/front-page E2E tests touched by the nav changes
- `git diff --check`

Manual browser checks:

1. Desktop `/`:
   - no `המלצות`;
   - `מסלולים` opens `/routes/`;
   - `על המפה` scrolls to `#trails`;
   - contact link scrolls to `#contact`.
2. Desktop `/routes/`:
   - breadcrumb shows `מפה > מסלולים`;
   - `מסלולים` is active;
   - featured routes are at the top.
3. Desktop `/routes/:slug`:
   - breadcrumb shows route hierarchy;
   - catalog crumb returns to `/routes/`.
4. Mobile:
   - menu opens and closes predictably;
   - breadcrumbs fit without horizontal overflow.
