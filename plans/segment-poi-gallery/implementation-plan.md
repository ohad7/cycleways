# Segment POI Gallery Implementation Plan

Date: 2026-06-02

## Goal

Make featured-route galleries render from reusable segment-level POIs with
images, ordered by route progress, and extend the editor so those POIs can be
authored without hand-editing JSON.

## Task 1: Shared POI Presentation Contract

- [ ] Audit `packages/core/src/data/poiTypes.js`, `packages/core/src/data/dataMarkers.js`,
  `editor/editor.js`, and `src/map/mapLayers.product.js` for duplicated marker
  type, color, icon, label, and warning classification tables.
- [ ] Add any missing POI types needed for route galleries, such as `river`,
  `beach`, `tree`, or decide to map those into existing `nature`/`rest_stop`
  types.
- [ ] Add shared helpers for:
  - `poiLabel(type)`;
  - `poiColor(type)`;
  - `poiEmoji(type)`;
  - `poiIcon(type)`;
  - `isWarningType(type)`;
  - `isGalleryEligiblePoi(point)`.
- [ ] Refactor editor and public marker code to consume the shared helpers where
  practical.
- [ ] Add or update unit tests covering labels, colors, warning classification,
  and fallback behavior for unknown types.

## Task 2: Route-Progress Enrichment

- [ ] Add a shared utility that projects a `[lat, lng]` marker location onto the
  route geometry.
- [ ] Return:
  - `routeProgressMeters`;
  - `routeFraction`;
  - `routeDistanceMeters`.
- [ ] Update `getActiveRouteDataPoints` in route actions so active data points
  with locations receive those route-progress fields.
- [ ] Preserve the existing route-distance trigger filtering behavior.
- [ ] Add tests for:
  - marker near route start;
  - marker near route middle;
  - marker near route end;
  - marker too far from route;
  - duplicate stable IDs.

## Task 3: Featured Gallery From Active POIs

- [ ] Remove hardcoded route moments from `src/featured/sovev-beit-hillel.jsx`.
- [ ] Add a featured-route gallery component that reads `routeState.activeDataPoints`.
- [ ] Filter gallery points using the shared gallery eligibility helper.
- [ ] Sort by `routeProgressMeters`.
- [ ] Render carousel cards using:
  - `thumbnail || photo`;
  - `name`;
  - `information`;
  - `description`;
  - type label.
- [ ] On carousel selection, focus the map marker via existing featured-route
  focus context.
- [ ] On map marker click, select the matching carousel item when it is gallery
  eligible.
- [ ] Keep the section hidden or render a compact empty state when no image POIs
  exist.
- [ ] Update featured-route E2E coverage for gallery rendering and map focus.

## Task 4: Editor Data Panel Fields

- [ ] Extend the Data panel in `editor/editor.js` with fields for:
  - `id`;
  - `name`;
  - `information`;
  - `description`;
  - `photo`;
  - `thumbnail`;
  - `gallery`;
  - `website`;
  - `phone`;
  - `hours`.
- [ ] Expand the type dropdown to include the full shared POI type list.
- [ ] Keep default new markers conservative, likely `warning` with empty text,
  unless the user selects a POI type.
- [ ] Show image preview when `thumbnail` or `photo` exists.
- [ ] Make gallery-enabled/image-backed markers visually easy to scan in the
  data list.
- [ ] Preserve current location editing, map click selection, and drag snapping
  behavior.

## Task 5: Validation

- [ ] Extend `validateSourceGeojson` in `editor/server.mjs` for richer POI
  fields.
- [ ] Preserve compatibility with existing warning markers.
- [ ] Require stable `id` for markers with `photo`, `thumbnail`, or
  `gallery: true`.
- [ ] Require valid `[lat, lng]` location for image-backed/gallery POIs.
- [ ] Require `name` or `information` for image-backed/gallery POIs.
- [ ] Validate optional text fields as strings when present.
- [ ] Validate `gallery` as boolean when present.
- [ ] Add tests for valid and invalid rich POI marker records.

## Task 6: Seed Beit Hillel Content

- [ ] Add initial POIs with image paths to the segments traversed by
  Sovev Beit Hillel.
- [ ] Use placeholder image paths only if the actual route photos are not ready.
- [ ] Confirm the generated route gallery orders by route progress.
- [ ] Confirm the same POIs appear on any other route that traverses those
  segments.

## Task 7: Map Marker Presentation

- [ ] Ensure non-warning POIs have useful marker styling on the public map and
  in the editor.
- [ ] Fix or replace fragile custom icon loading if needed.
- [ ] Consider circle plus emoji/text fallback for POIs so missing image sprites
  do not produce invisible markers.
- [ ] Add tests for marker feature properties for warning and non-warning POIs.

## Task 8: Follow-Up Image Upload

- [x] Add an editor upload endpoint only after path-based authoring is working.
  - `POST /api/poi-image` in `editor/server.mjs` accepts a base64 (data URL)
    image plus the marker `id`.
- [x] Store images under `public-data/poi-images/`.
- [x] Generate thumbnails/WebP derivatives when image tooling is available.
  - Added `sharp` as a dev dependency (editor-only, server-side). Uploads are
    auto-rotated, resized (photo max width 1600px, thumbnail 480px), and
    re-encoded to WebP (q80 / q72). A ~7MB phone photo compresses to a few KB,
    keeping committed assets small for the git repo.
- [x] Return canonical `photo` and `thumbnail` paths to the editor.
  - Editor Data panel gained an "Upload image" control that fills the photo and
    thumbnail path fields from the server response (requires a stable `id`).
- [x] Add validation that referenced image files exist before promote.
  - `findMissingSourceImages` runs inside `handlePromote`; any missing local
    `photo`/`thumbnail` reference blocks promote with a clear error. Remote
    (http/data) URLs are skipped.
- Tests: `tests/test-editor-poi-images.mjs` covers id sanitization, resize/WebP
  conversion, and the pre-promote existence check.

## Verification

- [x] Run `npm run build`.
- [x] Run focused unit tests for POI types, route data, and data markers.
- [x] Run featured-route E2E specs.
- [ ] Manually inspect `/featured/sovev-beit-hillel` at desktop width.
- [ ] Manually inspect the editor Data panel with a rich POI marker selected.

