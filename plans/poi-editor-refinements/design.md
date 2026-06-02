# POI Editor Refinements Design

Date: 2026-06-02

## Goal

Refine the segment POI authoring and presentation that shipped in
[segment-poi-gallery](../segment-poi-gallery/design.md):

- support multiple images per POI;
- make image paths read-only/managed (no hand-typed paths);
- declutter the editor segment panel;
- give every POI type a meaningful map marker instead of a blank dot.

This is an evolution of the existing feature, not a rewrite. Existing warning
markers, the route-progress gallery ordering, and the upload→resize→WebP
pipeline all stay.

## 1. Data Contract: multiple images

A data marker gains an `images` array:

```json
{
  "id": "beit-hillel-cafe",
  "type": "cafe",
  "name": "עצירה במושב",
  "information": "...",
  "images": [
    { "photo": "public-data/poi-images/beit-hillel-cafe-1a2b3c4d.webp",
      "thumbnail": "public-data/poi-images/beit-hillel-cafe-1a2b3c4d-thumb.webp" },
    { "photo": "public-data/poi-images/beit-hillel-cafe-5e6f7a8b.webp",
      "thumbnail": "public-data/poi-images/beit-hillel-cafe-5e6f7a8b-thumb.webp" }
  ],
  "gallery": true
}
```

- `images[0]` is the **primary** image (used for the map marker thumbnail and as
  the POI's representative image).
- Each entry is `{ photo, thumbnail }` (strings). `thumbnail` falls back to
  `photo` when absent.

### Backward compatibility

A shared helper `normalizePoiImages(marker)` returns a normalized
`images` array:

- if `marker.images` is a non-empty array, use it (filtering invalid entries);
- else if legacy `marker.photo`/`marker.thumbnail` exist, synthesize
  `[{ photo, thumbnail }]`;
- else `[]`.

This keeps legacy single-image data, older tests, and any un-migrated source
working. The 4 seeded Beit Hillel POIs in `data/map-source.geojson` are migrated
to the `images[]` shape.

`gallery` (boolean) is unchanged. A POI is gallery-eligible when it is not a
warning, `gallery !== false`, and `normalizePoiImages` returns ≥1 image.

## 2. Editor: managed image list (replaces editable path fields)

The "Photo path" / "Thumbnail path" text inputs are **removed**. In their place:

- A **thumbnail strip** of the POI's images. Each thumbnail has:
  - **Make primary** — moves that image to `images[0]`;
  - **Remove** — drops it from the array. The orphaned WebP file is left on disk
    (KB-scale); orphan cleanup is out of scope for this pass.
- The **Upload** control accepts **multiple files** and appends each uploaded
  image (resized + WebP, both derivatives) as a new `{ photo, thumbnail }`.
- Upload still requires a stable `id` first (used in filenames).

Paths are never hand-edited; they are produced by the server and displayed
read-only via the thumbnails.

### Unique filenames

To allow many images per id without collisions, the server names derivatives
`<sanitized-id>-<hash>.webp` and `<sanitized-id>-<hash>-thumb.webp`, where
`<hash>` is the first 8 hex chars of the uploaded bytes' sha256. Re-uploading
identical bytes is idempotent; different images get distinct names.

## 3. Editor: segment panel layout

- A **sticky header** pinned to the top of `.details-scroll`, always visible
  while scrolling, showing the segment **ID (read-only)** and **Name
  (editable)**.
- The **Quality** block (four sliders — the main vertical space consumer) moves
  into a **collapsed `<details>` section** ("Quality") below the fold. Authors
  expand it only when scoring a segment.
- Field order is tightened so the Data (POI) list sits near the top of the
  scroll region, reducing how far authors scroll to edit POIs.

No behavior of the quality data itself changes — it is only relocated and
collapsed.

## 4. Map markers: emoji on colored circle

Non-warning POI types render `poiEmoji(type)` as a centered text glyph on the
type-colored circle, in both the editor map and the product/featured map:

- `viewpoint` 👁, `cafe` ☕, `restaurant` 🍽️, `bike_shop` 🚲, `tree` 🌳,
  `river` 💧, `beach` 🏖️, `nature` 🌿, `rest_stop` 🪑, etc. (from `POI_EMOJIS`).
- Warning types **keep their existing SVG icons** (`caution`, `barrier`, …).

Implementation: the symbol layer sets `text-field` to the marker's emoji for
types without an applicable SVG icon, and keeps `icon-image` for warning types.
Warning markers do not double-render (their `text-field` resolves to empty).

## 5. Featured gallery: flattened images

The route gallery carousel shows **every image as its own slide** (not one card
per POI). Typical POIs have 1–2 images, so this stays compact.

- Ordering: by the POI's `routeProgressMeters`, then by image index within the
  POI. Ties broken by stable POI id (existing behavior).
- A slide carries its POI's `id`; selecting a slide focuses that POI's map
  marker (unchanged focus context).
- Clicking a map marker selects that POI's **first** slide.

This is the simpler starting point; a per-POI in-card strip may be revisited
later.

## 6. Validation + promote

`validateSourceGeojson` (editor/server.mjs):

- accepts `images`: when present, must be an array; each entry an object with
  string `photo` (required) and optional string `thumbnail`;
- gallery/image-backed POIs (legacy `photo`/`thumbnail` or non-empty `images`)
  still require a stable `id` and a `name` or `information`;
- existing warning-marker rules and the `gallery` boolean rule are unchanged.

`findMissingSourceImages` walks both `images[]` entries and legacy
`photo`/`thumbnail`, so the blocking pre-promote check covers every referenced
local file. Remote/data URLs are skipped.

## 7. Testing

Unit (Node):

- `normalizePoiImages`: images[] passthrough, legacy synthesis, empty.
- multi-image `validateSourceGeojson`: valid images[], invalid entry shapes,
  missing primary on a gallery POI.
- `findMissingSourceImages`: missing/ present across `images[]` and legacy.
- `processPoiImage`: hash-based unique filenames; idempotent identical bytes.
- gallery eligibility + flattened ordering helper (route progress, then image
  index).

Integration / E2E:

- featured gallery renders one slide per image, ordered correctly, with map
  focus on selection.
- editor panel: sticky ID/Name header visible, Quality collapsed by default.

Plus `npm run build` and the full `npm test` suite.

## Non-Goals

- Orphaned image-file cleanup on remove.
- Per-POI in-card image strip (deferred; flattened carousel for now).
- Reworking warning-marker visuals (they keep SVG icons).
- Any change to route-progress projection or video sync.
