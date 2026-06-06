# Route Map Thumbnails Implementation Plan

Date: 2026-06-06

## Goal

Add editor-generated Mapbox screenshot thumbnails for route catalog entries and
make route discovery/catalog cards prefer those thumbnails.

## Phase 0: Baseline And Decisions

### Tasks

- [ ] Confirm current public card image behavior.
  - Front-page route finder uses `src/components/RouteCard.jsx`.
  - `/routes` catalog uses `src/components/routes/RouteCatalogCard.jsx`.
  - Both should ultimately prefer generated map images.

- [ ] Confirm snapshot generation is healthy before adding map-image behavior.
  - Run: `npm run featured:snapshots:check`
  - Run: `node tests/test-featured-route-snapshots.mjs`
  - Run: `node tests/test-featured-route-snapshot-loader.mjs`

- [ ] Decide the exact persisted field name.
  - Recommended: `routeMapImage`.
  - Avoid overloading `heroImage`; it has editorial/photo meaning today.

- [ ] Decide first target routes.
  - Recommended: generate images for all entries in `public-data/route-catalog.json`.
  - If time is constrained, start with routes shown in the front-page finder and
    `/routes`.

### Acceptance Criteria

- The implementation starts from passing snapshot/catalog tests.
- The chosen schema name and image selection order are documented in the PR.

## Phase 1: Catalog Image Schema And Helpers

### Tasks

- [ ] Extend catalog validation in `editor/server.mjs`.
  - Accept `entry.routeMapImage`.
  - Reuse `validateCatalogImage`.
  - Allow optional `source` metadata on catalog images, or add a dedicated
    `validateRouteMapImage`.

- [ ] Extend missing-image checks.
  - Existing missing-image collection focuses on source POI images.
  - Add validation for route-catalog image references:
    `heroImage`, `routeMapImage`, `start.images[]`, `end.images[]`.
  - Missing referenced files should block promote.

- [ ] Add or update shared card-image helper in
  `packages/core/src/data/catalog.js`.
  - Suggested: `routeCardImage(entry, snapshot = null)`.
  - Selection order:
    1. `entry.routeMapImage`
    2. snapshot display image
    3. `entry.heroImage`
    4. start image
    5. end image
    6. first route POI image from snapshot

- [ ] Keep editorial image behavior stable.
  - Do not accidentally replace featured-page hero photos with map screenshots
    unless the caller opts into card-image behavior.

- [ ] Add unit tests.
  - `tests/test-route-catalog-helpers.mjs` should assert map-image preference
    for `routeCardImage`.
  - Existing `routeDisplayImage` assertions should continue to pass.

### Acceptance Criteria

- Catalog entries can store `routeMapImage`.
- Route-card image selection is explicit and tested.
- Existing hero/start/end fallback behavior is not regressed.

## Phase 2: Server-Side Route Map Image Processing

### Tasks

- [ ] Add route-map image constants in `editor/server.mjs`.
  - `routeMapImagesDir = resolve(publicDataDir, "route-map-images")`
  - `ROUTE_MAP_IMAGE_PUBLIC_PATH = "public-data/route-map-images"`
  - `ROUTE_MAP_IMAGE_MAX_WIDTH = 1200`
  - `ROUTE_MAP_IMAGE_THUMB_WIDTH = 640`

- [ ] Add `processRouteMapImage`.
  - Input: `{ slug, buffer, source, alt }`.
  - Validate slug with a route-safe slug sanitizer.
  - Hash the raw image bytes.
  - Use Sharp to rotate/resize/re-encode to WebP.
  - Write `<slug>-map-<hash>.webp` and `<slug>-map-<hash>-thumb.webp`.
  - Return `{ photo, thumbnail, alt, source }`.

- [ ] Add POST endpoint:
  - `POST /api/route-catalog/map-image`
  - Validate JSON body: `slug`, `data`, optional `source`, optional `alt`.
  - Decode data URL to a buffer.
  - Call `processRouteMapImage`.
  - Return `{ ok: true, image }`.

- [ ] Serve route-map image assets in the editor.
  - Extend the local image serving guard to include `routeMapImagesDir`.
  - This mirrors `public-data/poi-images`.

- [ ] Add server tests.
  - Similar to `tests/test-editor-poi-images.mjs`.
  - Assert WebP and thumb files are created under a temp output dir.
  - Assert unsafe slugs are rejected or sanitized safely.

### Acceptance Criteria

- The editor server can accept a PNG screenshot and return committed public
  WebP paths.
- The endpoint does not mutate the catalog entry by itself; it only stores the
  asset and returns image metadata.

## Phase 3: Editor Capture UI

### Tasks

- [ ] Add route-map image controls to the route catalog detail panel.
  - In `rcRenderDetail`, add `rcRouteMapImageSection(entry)` near
    `rcHeroImageSection(entry)`.
  - Show current preview if `entry.routeMapImage` exists.
  - Show status: missing, current, stale, or generation failed.
  - Add buttons:
    - `Generate map image`
    - `Regenerate`
    - `Remove`

- [ ] Add optional toolbar action.
  - `Generate missing map images`
  - Runs sequentially over entries without `routeMapImage`.
  - Stops or continues on failure with per-entry status, not a silent batch.

- [ ] Add hidden capture host to `editor/index.html`.
  - Example:
    `<div id="rc-map-capture-host" aria-hidden="true"></div>`
  - CSS: fixed/offscreen with explicit dimensions; not `display: none`.

- [ ] Implement capture map lifecycle in `editor/editor.js`.
  - `rcEnsureCaptureMap()`
  - `rcDestroyCaptureMap()` if needed
  - Use `new mapboxgl.Map({ preserveDrawingBuffer: true, interactive: false })`.
  - Reuse same style/token as current editor Mapbox setup.

- [ ] Render the route overlay.
  - Use geometry from the existing route snapshot when available.
  - For draft route changes, use the current draft route token and existing
    `/api/route-catalog/recompute` / snapshot decode path as needed.
  - Add a route source and layers:
    - halo line
    - route line
    - start/end points
  - Fit bounds with fixed padding.
  - Wait for `idle` before reading the canvas.

- [ ] Capture and upload.
  - `canvas.toBlob("image/png")`
  - Convert to data URL or send binary if the server endpoint is extended for
    multipart later.
  - POST to `/api/route-catalog/map-image`.
  - On success, assign `entry.routeMapImage = body.image`, then re-render detail.
  - Do not change the entry before upload succeeds.

- [ ] Compute source metadata in the editor.
  - `routeTokenHash` should match the server/snapshot hash format. Prefer a
    small shared helper if available; otherwise add a server-side source fill so
    the hash is computed consistently.
  - Include current `mapVersion` from promoted manifest or snapshot source.
  - Include style, width, height, and generated timestamp.

### Acceptance Criteria

- A user can open Route Catalog, select a route, click `Generate map image`,
  and see a real map thumbnail preview on the entry.
- Saving draft and promoting preserves the generated `routeMapImage`.
- The generated image file renders through the editor and public Vite dev app.

## Phase 4: Snapshot Builder Integration

### Tasks

- [ ] Copy `entry.routeMapImage` into generated route snapshots.
  - Add to `buildSnapshotFromRouteState` inputs or `buildSnapshotForSlug` after
    reading the catalog entry.
  - Store as either:
    - top-level `displayImage`, or
    - `route.displayImage`.
  - Prefer the shape already supported by `routeDisplayImage`.

- [ ] Include source metadata checks.
  - `validateFeaturedRouteSnapshots` should warn/fail when snapshot display
    image metadata is stale relative to the catalog entry.
  - Snapshot source checks should remain deterministic and should not attempt to
    regenerate screenshots.

- [ ] Add tests.
  - `tests/test-featured-route-snapshots.mjs` should assert generated snapshots
    preserve `routeMapImage` as display image.
  - Loader tests should accept snapshots with display images.

### Acceptance Criteria

- Generated featured-route snapshots contain the route-map image when the
  catalog entry has one.
- Snapshot generation/check remains browser-free.

## Phase 5: Public Card Rendering

### Tasks

- [ ] Update front-page route finder card.
  - `src/components/RouteCard.jsx` should call `routeCardImage(entry)`.

- [ ] Update `/routes` catalog card.
  - `src/components/routes/RouteCatalogCard.jsx` should call
    `routeCardImage(entry)`.

- [ ] Keep route detail/story pages photo-first unless explicitly changed.

- [ ] Update CSS if needed.
  - Map thumbnails may have different contrast/composition than photos.
  - Use `object-fit: cover` for cards.
  - Keep existing placeholders for entries without images.

- [ ] Add or update E2E coverage.
  - Front-page route finder opens and first card image is a real image.
  - `/routes` card image path points to `public-data/route-map-images/` when a
    catalog entry has `routeMapImage`.

### Acceptance Criteria

- Route finder and `/routes` cards prefer generated map thumbnails.
- No public card needs to fetch a Mapbox map just to render a thumbnail.

## Phase 6: Staleness UX And Promotion Policy

### Tasks

- [ ] Add editor staleness detection.
  - Current route token hash differs from image source route token hash.
  - Current promoted map manifest version differs from image source map version.
  - Capture style/dimensions differ from current constants.

- [ ] Surface staleness in `rcReadinessPanel`.
  - Missing `routeMapImage`: warning.
  - Stale `routeMapImage`: warning initially.
  - Missing referenced file: blocking error.

- [ ] Decide when to make missing/stale map images blocking.
  - Recommended rollout:
    - First PR: warning only.
    - After all current catalog routes have generated images: block stale images
      on promote.

- [ ] Add batch regeneration ergonomics.
  - Batch action should skip current images unless `force` is selected.
  - Report a concise success/failure summary.

### Acceptance Criteria

- Editors can see which routes need map image work.
- Promote cannot reference missing image files.
- Stale thumbnails are visible before public deploy.

## Phase 7: Manual Asset Generation Pass

### Tasks

- [ ] Start editor server.
  - `EDITOR_PORT=8899 node editor/server.mjs`

- [ ] Ensure Mapbox token is available.
  - `mapbox-token.js`, meta token, or `localStorage["cycleways.mapboxToken"]`.

- [ ] Generate route-map images for current catalog entries.
  - Use batch action or per-route action.

- [ ] Save draft and promote.

- [ ] Run validation.
  - `npm run featured:snapshots:check`
  - `node tests/test-route-catalog-helpers.mjs`
  - `node tests/test-featured-route-snapshots.mjs`
  - `npx playwright test tests/e2e/welcome-wizard.spec.mjs --workers=1`
  - `npm run build`

### Acceptance Criteria

- `public-data/route-map-images/` contains generated WebP assets for current
  route catalog entries.
- Public route finder and `/routes` cards show static map thumbnails.

## Open Questions

- Should card thumbnails always prefer map images, or should routes with strong
  editorial hero photos opt out?
- Should route-map thumbnails include POI markers, or only route line +
  start/end markers?
- Should the first implementation store `routeMapImage` only in the catalog, or
  also copy it into snapshots immediately?
- Should stale `routeMapImage` block promote from day one, or only after the
  first full generation pass?
