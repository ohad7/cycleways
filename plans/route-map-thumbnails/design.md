# Route Map Thumbnails Design

Date: 2026-06-06

## Goal

Generate static Mapbox-based route map images from the editor and use them as
the default visual for route discovery/catalog cards.

The image should show the actual route line and its geographic context, not a
generic placeholder and not an arbitrary scenic/POI photo. The asset should be
committed under `public-data/` and served like the existing POI images, so public
pages do not need Mapbox rendering just to show a small card thumbnail.

## Current State

The route catalog already has a route snapshot pipeline:

- `scripts/lib/featuredRouteSnapshotBuilder.mjs` decodes promoted catalog route
  tokens into generated `public-data/featured-routes/<slug>.json` snapshots.
- `scripts/copy-static-assets.mjs` regenerates those snapshots during
  `npm run build`.
- `packages/core/src/data/featuredRouteSnapshots.js` loads and adapts snapshots
  for public featured pages.
- `packages/core/src/data/catalog.js` exposes `routeDisplayImage(entry,
  snapshot)`, currently preferring `entry.heroImage`, then start/end images,
  then `snapshot.displayImage` / `snapshot.route.displayImage`, then POI images.
- The route catalog editor already supports uploaded representative images and
  segment-image selection through `heroImage`.
- `editor/server.mjs` already has a Sharp-based WebP pipeline for uploaded POI
  images (`processPoiImage`), writing `photo` and `thumbnail` files under
  `public-data/poi-images`.

The missing piece is a browser/editor-side map capture workflow that writes a
route-map image asset and records it on the route catalog entry.

## Decision

Add a generated `routeMapImage` field to route catalog entries:

```json
{
  "routeMapImage": {
    "photo": "public-data/route-map-images/sovev-beit-hillel-map-8c9a1f2e.webp",
    "thumbnail": "public-data/route-map-images/sovev-beit-hillel-map-8c9a1f2e-thumb.webp",
    "alt": "מפת מסלול סובב בית הלל",
    "source": {
      "type": "mapbox-screenshot",
      "routeTokenHash": "sha256:...",
      "mapVersion": "...",
      "style": "mapbox://styles/mapbox/outdoors-v12",
      "width": 1200,
      "height": 800,
      "generatedAt": "2026-06-06T00:00:00.000Z"
    }
  }
}
```

Public cards should prefer `routeMapImage` for route-list/discovery contexts.
Editorial route pages may keep using route-specific hero media separately.

This keeps the concepts distinct:

- `routeMapImage`: generated factual map thumbnail for scanning route lists.
- `heroImage`: authored editorial/photo image for route storytelling.
- start/end images: practical endpoint photos.

## Generation Model

Generation is an editor action, not a normal production build step.

Reasoning:

- A Mapbox screenshot requires a browser/WebGL renderer and a Mapbox token.
- `npm run build` should remain deterministic and not depend on a networked
  map-style render.
- Generated assets should behave like uploaded POI images: created intentionally
  in the editor, written to `public-data/`, committed, and copied by the build.

The editor should provide:

- Per-entry action: `Generate map image`.
- Per-entry action: `Regenerate map image`.
- Optional toolbar action: `Generate missing map images`.
- Staleness indicator when `routeMapImage.source.routeTokenHash` or
  `routeMapImage.source.mapVersion` no longer matches the current route token
  or promoted map manifest.

## Capture Technique

Use a separate hidden Mapbox GL map for capture.

Do not reuse the main editor map canvas. The current editor map is initialized
without `preserveDrawingBuffer`, and changing that can have performance costs.
Instead, create a temporary capture map with:

- fixed offscreen container, not `display: none`;
- explicit dimensions, e.g. `1200x800`;
- `preserveDrawingBuffer: true`;
- same Mapbox token and stable style, initially
  `mapbox://styles/mapbox/outdoors-v12`;
- no controls;
- route-only overlay: route line, start marker, end marker, optional subtle
  route halo.

The capture flow:

1. Decode route geometry from the existing generated route snapshot or the
   current draft route token.
2. Create or reuse the hidden capture map.
3. Wait for `style.load`.
4. Add a GeoJSON route source/layers.
5. Fit route bounds with fixed padding.
6. Wait for `idle`.
7. Export the canvas as PNG with `canvas.toBlob`.
8. Send the PNG/data URL to the editor server.
9. Server converts it to WebP + thumbnail with Sharp and returns public paths.
10. Editor writes the returned image object to `entry.routeMapImage`.

The capture map should be reused across batch generation to avoid repeatedly
loading Mapbox GL and style resources.

## Server Storage

Add a route-map image processor alongside `processPoiImage`.

Suggested constants:

```js
const ROUTE_MAP_IMAGE_PUBLIC_PATH = "public-data/route-map-images";
const ROUTE_MAP_IMAGE_MAX_WIDTH = 1200;
const ROUTE_MAP_IMAGE_THUMB_WIDTH = 640;
```

Suggested endpoint:

```text
POST /api/route-catalog/map-image
```

Request:

```json
{
  "slug": "sovev-beit-hillel",
  "data": "data:image/png;base64,...",
  "source": {
    "routeTokenHash": "sha256:...",
    "mapVersion": "...",
    "style": "mapbox://styles/mapbox/outdoors-v12",
    "width": 1200,
    "height": 800
  }
}
```

Response:

```json
{
  "ok": true,
  "image": {
    "photo": "public-data/route-map-images/sovev-beit-hillel-map-8c9a1f2e.webp",
    "thumbnail": "public-data/route-map-images/sovev-beit-hillel-map-8c9a1f2e-thumb.webp",
    "alt": "מפת מסלול סובב בית הלל",
    "source": { "...": "..." }
  }
}
```

The filename hash should include the image bytes. This gives natural cache
invalidation when the rendered map changes and avoids overwriting assets that
may still be referenced by older commits.

## Catalog And Snapshot Shape

`routeMapImage` should be accepted by catalog validation using the same image
shape as `heroImage`, plus optional `source`.

The featured-route snapshot builder should copy `entry.routeMapImage` into the
generated snapshot as `route.displayImage` or top-level `displayImage`. That
matches the existing `routeDisplayImage(entry, snapshot)` fallback support and
keeps snapshots self-contained for public featured pages.

However, catalog/list pages should not have to fetch every route snapshot just
to render cards. They should read `entry.routeMapImage` directly from
`public-data/route-catalog.json`.

## Public Image Selection

Add an explicit card-image helper rather than changing all editorial image
behavior implicitly.

Suggested API:

```js
routeCardImage(entry, snapshot = null)
```

Selection order:

1. `entry.routeMapImage`
2. `snapshot.route.displayImage` / `snapshot.displayImage`
3. `entry.heroImage`
4. start image
5. end image
6. first route POI image from snapshot

Existing `routeDisplayImage(entry, snapshot)` can remain editorial/photo-first,
or it can grow an options argument if that is cleaner:

```js
routeDisplayImage(entry, snapshot, { preferMapImage: true })
```

The important behavior is that route finder cards and `/routes` catalog cards
prefer the generated map image, while featured-route story heroes are not
accidentally replaced by map thumbnails.

## Visual Design

The map thumbnail should be readable at card sizes:

- Aspect ratio: `3:2` or `16:10`.
- Use a muted Mapbox base, initially outdoors.
- Route line: high-contrast green/blue with a light halo.
- Start marker: small green dot.
- End marker: small warm/orange dot for one-way routes.
- Circular routes may show a single start marker or start/end dots at nearly
  the same coordinate if useful.
- Fit padding should leave context around the route, not crop the line tightly.
- Hide editor-only layers, labels, controls, selection states, and POI markers
  unless a later design explicitly asks for them.

## Staleness And Validation

A `routeMapImage` is stale if any of these differ:

- current route token hash;
- current promoted `map-manifest.json` version;
- capture style id/version if it changes;
- capture dimensions if the target asset format changes.

Editor readiness should warn on missing or stale route-map images. Promotion can
initially allow warnings so existing content remains editable, but once every
route has an image the warning can become blocking for promoted catalog entries.

Build should not regenerate Mapbox screenshots. It may validate that committed
image paths referenced by the catalog exist, and it should continue copying
`public-data/`.

## Failure Handling

Common failures:

- Missing Mapbox token.
- Mapbox style/network load failure.
- WebGL/canvas capture failure.
- Server write or Sharp conversion failure.
- Route decode/snapshot missing.

The editor should show actionable status per route and never partially mutate
the entry until the server returns a valid image object.

## Non-Goals

- Do not generate screenshots in CI or `npm run build`.
- Do not replace featured-page editorial hero images.
- Do not add dynamic map rendering to route cards.
- Do not make card rendering depend on loading every featured route snapshot.
- Do not use screenshots as the source of route geometry; route geometry remains
  the decoded route token / generated snapshot.
