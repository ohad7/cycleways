# Segment POI Gallery Design

Date: 2026-06-02

## Goal

Make featured-route galleries derive from reusable segment-level places of
interest instead of route-specific gallery records.

The Beit Hillel featured page should show a video-first route experience with a
side map and gallery carousel. The gallery items should be the same POIs that
can appear on any route passing those segments, ordered by the rider's progress
along the current route.

## Decision

Store gallery-capable content as segment data markers in
`data/map-source.geojson`, under each segment's `properties.data` array.

This keeps POIs geographic and reusable:

- A cafe, viewpoint, tree, beach, bike shop, or rest stop appears on every route
  that traverses the segment.
- The regular planner can later expose the same richer POIs.
- The existing editor Data panel, marker drag behavior, and build pipeline are
  extended instead of adding a separate route-media CMS.
- Featured routes become a presentation layer over active route POIs.

Route-level data remains appropriate for:

- video sync keyframes;
- route-level hero overrides;
- optional hide/show or manual ordering overrides later, if automatic route
  order is not enough.

## POI Data Contract

Existing warning markers keep working. Non-warning POIs may add richer fields.

```json
{
  "id": "beit-hillel-fields-west",
  "type": "viewpoint",
  "name": "Beit Hillel western fields",
  "information": "Open fields with a wide view toward Hermon.",
  "description": "A quiet, open section of the loop. Good for a short stop, photo, and route orientation.",
  "location": [33.20395, 35.59982],
  "photo": "public-data/poi-images/beit-hillel-fields-west.webp",
  "thumbnail": "public-data/poi-images/beit-hillel-fields-west-thumb.webp",
  "gallery": true,
  "website": "",
  "phone": "",
  "hours": ""
}
```

Field rules:

- `id`: stable string. Required for POIs with images or featured-route gallery
  use. Existing warnings may continue to fall back to synthesized IDs until
  touched.
- `type`: required string. Warning types keep their current behavior. POI types
  include `viewpoint`, `landmark`, `cafe`, `restaurant`, `bike_shop`, `flora`,
  `nature`, `rest_stop`, and any additional route-relevant types added to the
  shared type registry.
- `name`: display title for a POI card.
- `information`: short description, used in compact cards.
- `description`: longer gallery/detail description.
- `location`: `[lat, lng]`, required for gallery-capable POIs.
- `photo`: main image path.
- `thumbnail`: optional smaller image path. If absent, use `photo`.
- `gallery`: optional boolean. Defaults to true when the POI has an image and is
  not a warning. Set to false to keep an image-backed POI out of featured-route
  galleries.
- `website`, `phone`, `hours`: optional business metadata.

## Route Progress Ordering

Featured-route galleries must follow the order of the current route, not source
file order and not segment dictionary order.

When active data points are computed for a route, each marker with a valid
location should be projected onto the route geometry and enriched with:

- `routeProgressMeters`: distance from route start to the closest point on the
  route geometry;
- `routeFraction`: `routeProgressMeters / routeLengthMeters`;
- `routeDistanceMeters`: perpendicular distance from marker to route geometry.

The gallery source is:

```js
routeState.activeDataPoints
  .filter((point) => !isWarningType(point.type))
  .filter((point) => point.gallery !== false)
  .filter((point) => point.photo || point.thumbnail)
  .sort((a, b) => a.routeProgressMeters - b.routeProgressMeters)
```

If two POIs project to the same route distance, preserve the active-data-point
stable order as a tie-breaker.

## Featured Route Page Behavior

For Sovev Beit Hillel and future featured routes:

- The video remains the primary desktop surface.
- The side rail shows a compact route map and the gallery carousel.
- The gallery carousel shows active route POIs with images.
- Carousel item click focuses the corresponding marker on the map.
- Map marker click selects the corresponding carousel item when it is gallery
  eligible.
- Warnings remain separate from the gallery and can still render in the warning
  section.
- If no gallery POIs exist, the gallery section renders an empty state or hides,
  depending on the final page design.

## Editor Design

Extend the existing segment Data panel. Do not add a separate route-media editor
for the first pass.

Add/edit fields:

- stable `id`;
- `type` with full warning and POI type list;
- `name`;
- `information`;
- `description`;
- `location`;
- `photo`;
- `thumbnail`;
- `gallery` checkbox;
- optional `website`, `phone`, `hours`.

Editor behavior:

- `Add` still creates a marker on the selected segment.
- Location edits and marker drags continue snapping to the selected segment.
- The data list shows an image preview when `thumbnail` or `photo` exists.
- A gallery-capable POI should be visually distinguishable in the data list.
- Image upload and WebP conversion can be a follow-up. The first pass can accept
  paths into `public-data/poi-images/`.

## Validation

Source validation should allow existing warning markers while protecting gallery
POIs:

- `marker.type` remains required.
- `marker.location` remains required and valid for any marker that has a
  location; gallery/image POIs require a valid location.
- `id` is required for image-backed or `gallery: true` POIs.
- `name` or `information` is required for image-backed or `gallery: true` POIs.
- `information`, `description`, `photo`, `thumbnail`, `website`, `phone`, and
  `hours` must be strings when present.
- `gallery` must be boolean when present.

Promote/build should continue to block invalid source data.

## Non-Goals

- Building a full image-upload pipeline in the first pass.
- Creating route-specific gallery data as the primary source of truth.
- Reworking the full route page visual polish. This plan only defines the data
  and editor model needed to feed the page.
- Adding ratings, comments, or user-contributed POIs.

