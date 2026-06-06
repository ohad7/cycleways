# Recommended Routes Public Catalog Implementation Plan

Date: 2026-06-04

## Goal

Replace the current `/featured`-only public gallery with a canonical `/routes`
surface that lists every promoted route catalog entry. Rich story/video pages
remain optional and are no longer the gate for public route discovery.

## Current Baseline

- `public-data/route-catalog.json` contains all recommended route entries.
- `src/featured/index.js` exposes `loadFeaturedMetaList()` and filters entries
  to `entry.featured === true`.
- `/featured` renders only that filtered list.
- `/featured/:slug` only works when `src/featured/index.js` has a JSX module
  loader for the slug.
- `public-data/featured-routes/<slug>.json` snapshots are generated only for
  catalog entries where `featured: true`.
- `public-data/route-catalog.json` already has a catalog-only route:
  `historic-jordan`.

## Implementation Order

### Task 1: Introduce Route Catalog Runtime Helpers

Add route-catalog naming without removing existing featured helpers yet.

Files:

- `packages/core/src/data/catalog.js`
- `src/featured/index.js` or new `src/routes/index.js`

Steps:

1. Add `loadRouteCatalog()` as an alias around the existing catalog fetcher.
2. Add `loadRouteCatalogEntries()` returning all entries.
3. Add `findRouteCatalogEntryBySlug(catalog, slug)` or a direct async helper.
4. Add route-story helper names in app code:
   - `hasRouteStory(slug)`
   - `getRouteStoryModuleLoader(slug)`
   - `getRouteStoryNav(slug)`
5. Keep existing `loadFeaturedMetaList()` and `findFeaturedMeta()` wrappers for
   compatibility during this phase.

Validation:

- `node --test tests/test-catalog-filter.mjs`
- Add or update a small unit test that all entries are returned, including
  `historic-jordan`.

### Task 2: Add Route Presentation Fields

Define the route content contract before building the new public UI.

Files:

- `public-data/route-catalog.json`
- `editor/server.mjs`
- catalog validation/recompute tests
- route catalog fixture tests

Steps:

1. Add optional catalog fields:
   - `description`;
   - `heroImage: { photo, thumbnail, alt }`;
   - `sortOrder`;
   - `story: { enabled, kind }`.
2. Keep hard required publish fields unchanged for the first pass:
   `slug`, `name`, `summary`, and `route`.
3. Make validation accept the new fields and reject malformed image objects.
4. Preserve new fields through `recomputeCatalogMetadata`.
5. Add warning generation for strongly recommended missing fields:
   - missing `description`;
   - missing representative image after fallback resolution;
   - missing `start`;
   - story enabled but no route-story module.
6. Keep warnings non-blocking. Blocking validation remains limited to required
   identity/copy/token fields and decodability.

Validation:

- Existing catalog promote tests still pass.
- A catalog entry with `description`, `heroImage`, and `story` round-trips
  through recompute/promote.
- A malformed `heroImage` entry is rejected.

### Task 3: Representative Image Resolution

Add a shared resolver so public cards and detail pages do not require every route
to have a manually uploaded hero image on day one.

Files:

- `scripts/lib/featuredRouteSnapshotBuilder.mjs` or its route-snapshot successor
- `packages/core/src/data/routeCatalog.js` or equivalent helper
- `packages/core/src/data/dataMarkers.js`
- route snapshot tests

Steps:

1. Add a pure `resolveRouteDisplayImage(entry, snapshot)` helper.
2. Resolution order:
   - route-level `entry.heroImage`;
   - `entry.start.images[0]`;
   - `entry.end.images[0]`;
   - first image-backed active POI in snapshot route order;
   - first image-backed selected-segment POI if available during snapshot build;
   - default placeholder.
3. Store a derived `displayImage` in the route snapshot or public catalog output.
4. Keep runtime fallback logic defensive, but avoid loading full planner assets
   from `/routes`.
5. Add tests for route-level image, start image, POI fallback, and placeholder.

Validation:

- Routes with explicit `heroImage` use it.
- Routes without `heroImage` use start/POI images when available.
- Catalog-only routes still render a stable placeholder if no image exists.

### Task 4: Create `/routes` Index Page

Files:

- `src/main.jsx`
- `src/pages/RoutesIndexPage.jsx`
- `src/components/routes/RouteCatalogCard.jsx`
- `src/components/routes/routes.css`

Steps:

1. Add a lazy route for `/routes`.
2. Implement `RoutesIndexPage` loading all catalog entries.
3. Load `data/places.json` so cards can display nearby place names.
4. Render all catalog entries with a route-catalog card.
5. Each card gets:
   - representative image from `displayImage`/fallback resolution;
   - name, summary, distance, elevation, difficulty, surface mix, nearby places;
   - primary planner link: `/?route=${encodeURIComponent(entry.route)}`;
   - detail link: `/routes/${entry.slug}`;
   - story/video badge only when `hasRouteStory(entry.slug)` is true.
6. Add initial filters using the existing catalog filtering behavior:
   - place;
   - distance bucket;
   - difficulty;
   - style/audience.
7. Use a stable sorted list:
   - `sortOrder` if present;
   - story routes before generic routes only when no order exists;
   - `qualityScore` descending;
   - `distanceKm` ascending.

Validation:

- `/routes` shows `סובב בית הלל`.
- `/routes` shows `בניאס וגן הצפון`.
- `/routes` shows `הירדן ההיסטורי`.
- Planner action URL contains `?route=`.
- Detail action points to `/routes/<slug>`.

Test expectations:

- Add `tests/e2e/routes-index.spec.mjs`.
- Assert all current catalog route names are visible.
- Assert the `historic-jordan` card is present even though `featured: false`.
- Assert every card has an image element or deterministic placeholder.

### Task 5: Migrate `/featured` Index to `/routes`

Files:

- `src/main.jsx`
- `src/pages/FeaturedIndexPage.jsx` or remove after aliasing
- `tests/e2e/featured-index.spec.mjs`
- `tests/e2e/featured-routes-routing.spec.mjs`

Steps:

1. Choose one transitional behavior:
   - render `RoutesIndexPage` for `/featured`; or
   - redirect `/featured` to `/routes`.
2. Update visible links in the top bar or content sections to point to
   `/routes` where relevant.
3. Update tests to use `/routes` as the canonical path.
4. Keep one compatibility test for `/featured` only if an alias is retained.

Validation:

- `http://127.0.0.1:5173/routes` is the canonical route list.
- `http://127.0.0.1:5173/featured` still works or redirects during the
  transition.

### Task 6: Implement Generic `/routes/:slug` Detail Page

Files:

- `src/main.jsx`
- `src/pages/RouteDetailPage.jsx`
- `src/components/routes/GenericRouteDetail.jsx`
- `src/components/routes/routes.css`
- `src/featured/index.js` or `src/routes/index.js`

Steps:

1. Add route for `/routes/:slug`.
2. Load the catalog entry by slug.
3. If a route story module exists, render that story module.
4. If no story module exists, render a generic route detail page.
5. Generic page should at minimum include:
   - route name;
   - summary;
   - long description when present;
   - representative image/header media;
   - distance/elevation/difficulty;
   - nearby places;
   - start/end authored details if present;
   - primary "open in planner" action.
6. If route snapshots are not available for all entries yet, make the generic
   detail page metadata-only in this task and add the map in Task 6.

Validation:

- `/routes/sovev-beit-hillel` renders the existing rich story.
- `/routes/banias-gan-hatsafon` renders the existing rich story.
- `/routes/historic-jordan` renders a generic route detail page.
- Unknown slugs render a clear 404-style message.

### Task 7: Rename Public Copy and Navigation Concepts

Files:

- `src/components/TopBar.jsx`
- `src/components/ContentSections.jsx`
- route index/detail components
- tests touching nav text

Steps:

1. Use `מסלולים מומלצים` or the chosen Hebrew product phrase for `/routes`.
2. Stop using "featured" in user-facing route-list copy.
3. Keep "video" or "story" badges only for routes that actually have those
   richer assets.
4. If the home page still has a recommendations section, link complete routes
   to `/routes` instead of hardcoding only story pages.

Validation:

- Main nav can reach `/routes`.
- No public route-list card implies that a generic catalog route has a video or
  rich story.

### Task 8: Generate Snapshots for All Catalog Routes

Files:

- `scripts/lib/featuredRouteSnapshotBuilder.mjs`
- `scripts/build-featured-route-snapshots.mjs`
- `packages/core/src/data/featuredRouteSnapshots.js`
- `scripts/copy-static-assets.mjs`
- route detail components
- snapshot tests

Steps:

1. Add a new generated data path:
   `public-data/route-snapshots/<slug>.json`.
2. Generate snapshots for every promoted catalog entry with a valid route token.
3. Keep the existing snapshot schema initially.
4. Include derived presentation data needed by generic route pages:
   - route bounds;
   - route stats;
   - active POIs;
   - `displayImage`;
   - selected-segment image fallback when available.
5. Add a loader that tries:
   - `public-data/route-snapshots/<slug>.json`;
   - then legacy `public-data/featured-routes/<slug>.json`.
6. Update rich story pages to use the new route snapshot loader.
7. Update generic detail pages to render a read-only map from the snapshot.
8. Update build/copy scripts so route snapshots are generated before assets are
   copied into the production output.
9. Generate static shells for `/routes/<slug>` for all catalog entries.

Validation:

- Snapshot generation writes a file for `historic-jordan`.
- Rich story pages still do not request planner-only assets.
- Generic route detail pages can render a map without loading the planner route
  manager.

Test expectations:

- Update snapshot unit tests to route-catalog naming.
- Add regression coverage that `/routes/historic-jordan` fetches a route
  snapshot.
- Keep or update the existing "featured page must not request planner assets"
  network test for a `/routes/:slug` story page.

### Task 9: Beef Up Route Catalog Editor

Make route catalog editing feel like a real authoring mode, not a raw JSON-ish
form. Use the Video Sync mode as the interaction model: focused workspace, route
selector, preview, clear status, Save Draft, Recompute, Promote.

Files:

- `editor/index.html`
- `editor/editor.js`
- `editor/styles.css`
- `editor/server.mjs`
- editor route-catalog tests

Steps:

1. Replace the single detail panel with a Route Catalog workspace layout:
   - left searchable route list;
   - main tabbed editor;
   - preview/status panel;
   - sticky action row.
2. Add tabs:
   - Basics: slug, name, summary, long description, notes, sort order;
   - Route: route token/full share URL, extract `route` param automatically,
     decode/recompute status, planner preview link;
   - Images: upload route-level representative image, preview current image,
     choose fallback from start/end/route POIs when available, edit alt text;
   - Start/End: preserve existing endpoint editor with image upload;
   - Classification: computed region, nearby places, difficulty, style, surface
     mix, quality;
   - Story: route-story enabled/kind, story module presence, route video
     presence, link to Video Sync for the selected slug;
   - Publish: validation checklist.
3. Add validation indicators in the route list:
   - blocking errors;
   - missing image warning;
   - missing description warning;
   - story asset warning.
4. Keep editor drafts as the source of in-progress state.
5. Keep promote behavior: save draft, recompute, write promoted catalog, rebuild
   snapshots, clear draft.
6. Reuse `POST /api/poi-image` for route-level representative image uploads.
7. Add preview card rendering that matches the public `/routes` card enough to
   catch missing text/image before promote.

Validation:

- Create a new route entry, paste a full planner share URL, and confirm the route
  token is extracted.
- Upload a representative image and confirm it persists in the draft.
- Recompute shows distance/elevation/difficulty without promoting.
- Promote writes catalog fields and route snapshots.
- Editor list clearly shows `historic-jordan` as a catalog route even without a
  story page.

### Task 10: Catalog Schema Migration

Files:

- `public-data/route-catalog.json`
- `editor/editor.js`
- `editor/server.mjs`
- catalog validation tests

Steps:

1. Add schema support for optional:
   `description`, `heroImage`, `sortOrder`, and
   `story: { enabled: boolean, kind?: string }`.
2. Keep accepting legacy `featured` during migration.
3. In validation/recompute, preserve `story` metadata.
4. Update editor labels:
   - "Featured" becomes "Route story";
   - explanatory text clarifies that all catalog entries are recommended routes.
5. Migrate existing `featured: true` entries to `story.enabled: true`.
6. Add `description` and `heroImage` where known, or rely on fallback warnings.
7. Remove or ignore `featured` once tests and existing data are migrated.

Validation:

- Editor draft save/recompute/promote still works.
- Rich story routes still render.
- Generic routes remain visible and get snapshots.

### Task 11: Clean Up Legacy Featured Naming

This is the final refactor after behavior is stable.

Candidate renames:

- `FeaturedIndexPage.jsx` -> removed or replaced by `RoutesIndexPage.jsx`.
- `FeaturedRoutePage.jsx` -> `RouteDetailPage.jsx`.
- `src/featured/index.js` -> `src/routes/storyRegistry.js`.
- `FeaturedRoute.jsx` -> `RouteStory.jsx`.
- `featuredRouteSnapshots.js` -> `routeSnapshots.js`.
- `featuredRouteSnapshotBuilder.mjs` -> `routeSnapshotBuilder.mjs`.

Validation:

- Full route-story test suite passes.
- No public URL depends on `/featured`.
- Internal compatibility wrappers are deleted only after all imports move.

## Focused Test Commands

Run after early catalog/index tasks:

```sh
node --test tests/test-catalog-filter.mjs tests/test-route-catalog-promote.mjs tests/test-route-catalog-base-decode.mjs
npm run test:smoke -- --project=desktop tests/e2e/routes-index.spec.mjs
```

Run after route detail and snapshot tasks:

```sh
node --test tests/test-featured-route-snapshot-loader.mjs tests/test-featured-route-snapshots.mjs
npm run test:smoke -- --project=desktop tests/e2e/routes-index.spec.mjs tests/e2e/featured-route-snapshot-network.spec.mjs
```

Run before merging:

```sh
npm run build
npm run test:smoke -- --project=desktop tests/e2e/featured-index.spec.mjs tests/e2e/featured-routes-routing.spec.mjs tests/e2e/featured-route-shell.spec.mjs tests/e2e/routes-index.spec.mjs
```

## Manual Browser Checks

With the dev server running:

1. Open `http://127.0.0.1:5173/routes`.
2. Confirm every entry from `public-data/route-catalog.json` is visible.
3. Confirm catalog-only routes do not display video/story badges.
4. Click the planner action for each route and confirm the URL contains
   `?route=`.
5. Open `/routes/sovev-beit-hillel` and confirm the rich story page still
   renders.
6. Open `/routes/historic-jordan` and confirm the generic detail page renders.
7. On mobile viewport width, confirm route cards do not overlap and actions fit.

## Rollback Plan

The safest rollback is URL-level:

1. Keep old `/featured` routes in `src/main.jsx` until `/routes` is stable.
2. Keep legacy `featured` schema support until the editor migration is complete.
3. Keep the legacy snapshot path fallback until all generated data and tests use
   `public-data/route-snapshots`.

If a later task fails, earlier tasks still leave a useful `/routes` index that
lists all catalog entries and links to the planner.
