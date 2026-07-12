# Website Growth Roadmap — Implementation Plan

**Date:** 2026-07-09  
**Status:** Proposed; execute in independently shippable phases  
**Design:** `plans/website-growth-roadmap/design.md`

## Goal

Improve the pre-app public website in five ordered areas: decision-ready route
content, search/social acquisition, route freshness, saved comparison, and a
printable ride brief. Preserve the current website’s discovery, planning,
sharing, and GPX behavior throughout.

## Delivery rules

- Treat each phase as a separate implementation topic/branch once scheduled.
- Add pure logic tests to the existing Node test chain.
- Add focused Playwright coverage for public behavior.
- Run `npm test`, `npm run build`, and the relevant desktop/mobile Playwright
  specs before completing each phase.
- Do not modify app navigation or add app-promotion UI in this roadmap.
- Preserve old catalog entries and shared route URLs while schemas evolve.

## Phase 0 — Privacy consistency and baseline

### Tasks

1. Remove or disable the production Google Analytics loader so runtime behavior
   matches the current privacy page.
2. Verify that no other website analytics or tracking script loads in production
   mode.
3. Add a focused automated check covering the absence of the Google Analytics
   script and production measurement ID.
4. Capture the current promoted-catalog completeness report:
   - route count;
   - missing descriptions;
   - missing representative images;
   - missing start details;
   - missing duration, season, route type, and audience.
5. Record baseline build size and the generated public route paths so later
   prerendering does not silently regress either.

### Validation

- Production HTML does not request `googletagmanager.com`.
- Privacy page and runtime behavior make the same analytics claim.
- `npm test` and `npm run build` pass.

## Phase 1 — Decision-ready catalog

### 1.1 Schema and normalization

1. Extend catalog normalization/validation with `durationMinutes`, `season`,
   `routeType`, `audience`, and `startAccess`.
2. Define controlled values and backward-compatible defaults.
3. Decide whether `audience` replaces `style` immediately or is derived from it
   during a migration window; do not expose two equivalent public filters.
4. Add tests for valid values, invalid values, absent legacy fields, and catalog
   round trips.

### 1.2 Editor workflow

1. Add inputs for the new fields to the route-catalog editor.
2. Add a route-readiness summary that separates blocking errors from content
   warnings.
3. Warn on missing description, image, start details, duration, season, route
   type, or audience.
4. Verify draft save, recompute, preview, and promote preserve the fields.

### 1.3 Public presentation

1. Add the new values to generic and story route detail pages.
2. Add compact duration, route-type, and audience information to catalog and
   Discover cards.
3. Add filters only for fields with enough promoted data coverage.
4. Confirm mobile cards do not become dominated by metadata chips.

### 1.4 Content migration

1. Complete the metadata for all currently promoted routes.
2. Resolve missing descriptions and start details.
3. Verify images, route snapshots, and map thumbnails are current.
4. Promote the catalog and rerun all snapshot/readiness checks.

### Validation

- Catalog normalization and filter tests pass.
- Editor draft/promote tests pass.
- `/routes` and representative detail pages pass desktop and mobile E2E checks.
- Every promoted route meets the completeness target in the design.

## Phase 2 — Prerendering and social metadata

### 2.1 Build contract

1. Choose a build-time prerender approach compatible with static GitHub Pages
   hosting and the current Vite/React Router application.
2. Generate HTML for `/routes` and each promoted `/routes/:slug`.
3. Keep the normal SPA bundle and hydration behavior.
4. Fail the build when a promoted slug cannot produce a route page.

### 2.2 Metadata

1. Add route-specific title, meta description, canonical URL, Open Graph fields,
   and social-card fields.
2. Use the existing route-map-image/public-image fallback for preview images.
3. Add structured data after selecting and documenting the exact schema shape.
4. Ensure legacy featured paths point at the canonical `/routes/:slug` URL.

### 2.3 Indexing

1. Generate or validate `sitemap.xml` from the promoted catalog.
2. Verify `robots.txt`, `404.html`, and static route shells remain correct.
3. Add internal links between the catalog and route detail pages.
4. Defer region landing pages until at least one region meets the three-route
   threshold; then implement them as a separate slice.

### Validation

- A test reads built HTML without executing JavaScript and finds route-specific
  visible content and metadata.
- Every promoted slug has one canonical URL and one sitemap entry.
- Missing preview images fall back deterministically.
- `npm run build` and route-page Playwright suites pass.

## Phase 3 — Freshness, status, and reporting

### 3.1 Status model

1. Add status normalization for `open`, `caution`, and `closed`.
2. Validate `verifiedAt`, require messages for caution/closed, and validate
   `validUntil`.
3. Add pure helpers that derive current, expired, and needs-review states using
   an injected clock.
4. Add fixtures for open, active caution, active closure, expired notice, and
   missing legacy status.

### 3.2 Editor

1. Add status level, message, verification date, and expiry controls.
2. Add readiness warnings for expired or long-unverified routes.
3. Preserve status through save, recompute, preview, and promote.

### 3.3 Public UI

1. Render current cautions/closures on cards and detail pages.
2. Render a modest last-checked line for open routes.
3. Require acknowledgement before downloading GPX for a currently closed route;
   do not remove the GPX escape hatch.
4. Add a contextual report action that includes route slug and page URL in the
   existing feedback path.

### Validation

- Status helper tests cover clock and expiry boundaries.
- Card/detail status presentation matches for the same catalog fixture.
- Playwright covers report context and closed-route GPX acknowledgement.
- No route is presented as currently closed solely because an old notice
  expired.

## Phase 4 — Saved routes and comparison

### 4.1 Local saved-route model

1. Add a versioned local-storage model containing only saved slugs and minimal
   ordering metadata.
2. Keep saved routes separate from recents and drafts.
3. Resolve all display data from the live catalog.
4. Handle retired/missing slugs without breaking the collection.

### 4.2 Save UI

1. Add save/unsave controls to catalog cards and route pages.
2. Add a saved-routes catalog view with an empty state and clear recovery path.
3. Ensure controls are keyboard accessible and announce state changes.

### 4.3 Comparison

1. Add selection for two or three routes.
2. Build a shared comparison model for distance, elevation, duration,
   difficulty, road/surface mix, route type, audience, season, and start area.
3. Render a stacked mobile comparison and a compact desktop comparison.
4. Draw compared route geometries together using existing Discover colors.
5. Add shareable slug-list URLs only if URL behavior stays simple and robust.

### Validation

- Unit tests cover persistence versioning, deduplication, ordering, and missing
  slugs.
- E2E covers save, reload, unsave, compare, and mobile layout.
- Saved routes never duplicate full route tokens or snapshots in local storage.

## Phase 5 — Printable ride brief

### 5.1 Route brief page

1. Add a canonical print/brief route or print mode for every catalog slug.
2. Reuse catalog metadata, route snapshot, map image, elevation builder, POI
   ordering, warnings, and status presentation.
3. Add the canonical route QR code.
4. Keep the on-screen GPX action and a useful printed reference to the live
   route.

### 5.2 Print design

1. Add an A4-focused RTL print stylesheet.
2. Hide navigation chrome, Mapbox, video, playback, and interactive controls.
3. Prevent headings, POI cards, and warning blocks from being split awkwardly.
4. Provide sensible fallbacks when optional images or elevation are absent.

### Validation

- Playwright verifies required brief content for routes with and without video.
- Generate representative print/PDF outputs for easy, hard, circular, one-way,
  warning-heavy, and sparse-content routes.
- Visually inspect A4 output for clipping, RTL order, page breaks, and readable
  QR code size.
- The brief does not describe itself as navigation or generate turn cues.

## Final acceptance checklist

- [ ] Production analytics behavior matches the published privacy statement.
- [ ] Every promoted route meets the decision-ready metadata target.
- [ ] Every promoted route has prerendered HTML, canonical metadata, and a
      route-specific social image.
- [ ] Every promoted route has a visible verification date and consistent
      current status.
- [ ] Riders can explicitly save and compare routes without an account.
- [ ] Every promoted route has a usable printable ride brief.
- [ ] Desktop and mobile route discovery remain functional.
- [ ] Existing route URLs, route tokens, GPX, and sharing remain compatible.
- [ ] No app-promotion or browser-navigation dependency was introduced.

