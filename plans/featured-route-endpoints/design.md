# Featured Route Start/End Points

Date: 2026-06-03

## Goal

Give each featured route an optional **start point** and **end point** — content
(image + name + description) that anchors the very beginning and end of the
route. The start point is the first stop in the below-video story list (so people
know where the route starts) and shows in the on-video preview when the video
begins; the end point shows at the end and is the last story. Cyclic routes set
only a start.

These points are conceptually "outside the CycleWays network," but their
**location is derived from the route geometry** (start = first geometry point /
route-fraction 0, end = last point / fraction 1), so nothing is placed manually.

## Data model

Two optional objects on each `route-catalog.json` entry (route-level, edited via
the editor draft → promote flow):

```jsonc
{
  "slug": "...",
  // ...existing fields...
  "start": { "name": "…", "description": "…", "images": [{ "photo": "…", "thumbnail": "…" }] },
  "end":   { "name": "…", "description": "…", "images": [{ "photo": "…", "thumbnail": "…" }] }
}
```

- `start` present = feature enabled for that route. `end` optional (omit for cyclic).
- `images` reuses the POI image shape so existing rendering/normalization applies.
- **No location field** — derived at render time from route geometry.

## Editor

Extend the **Route Catalog** detail form (`editor/editor.js`, the per-entry panel)
with two sub-sections, "נקודת התחלה" and "נקודת סיום", each with:

- a name input, a description textarea, and an image upload reusing
  `POST /api/poi-image` (returns `{ photo, thumbnail }`), with a small preview and
  a remove button.

`validateCatalogDraft` (`editor/server.mjs`) gains rules: if `start`/`end` is
present, it must have at least one image and a non-empty name; description is
optional. Promote is unchanged (images already live under `public-data/poi-images`,
and the entry fields are copied as-is).

## Featured-page integration

A helper `routeEndpointSlides(meta, geometry)` in
`src/components/featured/routePoiStoryData.js` returns up to two synthetic slides:

```js
{ kind: "start" | "end", routeFraction: 0 | 1, location, name, description, images, poiId }
```

derived from `meta.start` / `meta.end` and the route geometry endpoints. Returns
`[]` when no `start` is set; omits `end` when not set.

- **`RoutePoiVideoPreview`**: builds `[start, ...galleryImageSlides, end]` and
  feeds it to the existing `nearestPreviewForCursor`. At fraction 0 the start is
  "near" and shows; at the end the finish shows; in between, normal POIs. For an
  endpoint slide the preview shows a special label (🚩 התחלה / 🏁 סיום) in place
  of the POI type.
- **`RoutePoiStoryList`**: prepends the start story and appends the end story
  (cyclic → start only). Endpoint cards use a special kicker (נקודת התחלה /
  נקודת סיום) instead of "תחנה N · distance". Clicking an endpoint card seeks the
  video to fraction 0 / 1, reusing the existing click → seek + pause + scroll.

The endpoint slide carries a stable `poiId` (e.g. `route-start` / `route-end`) so
the existing `data-poi-id` scroll target and focus highlight work unchanged.

## Behavior recap

- Video preview maps start → fraction 0, end → fraction 1 (no change to the
  video file or keyframes).
- Story list: start first, on-route POIs by progress, end last. Cyclic shows
  start only.
- Routes without a `start` render exactly as today (feature off).

## Non-goals

- No map markers and no manual location placement (location is derived).
- No change to the video file, keyframes, or `videoSync`.
- VideoEmbed's near-POI playback slowdown stays POI-only (endpoints don't slow it).
- Multiple images per endpoint is supported by the shape but the editor uploads
  a single image for now.

## Units & testing

- `routeEndpointSlides(meta, geometry)` — unit test: fraction 0/1, location from
  geometry endpoints, cyclic (no end) = start only, no start = `[]`.
- Editor `validateCatalogDraft` — test: valid start/end accepted; start/end with
  no image or no name rejected.
- e2e (featured) — start card is first and the end card last; the on-video
  preview shows the start at load. (Requires a catalog entry with start/end
  content, populated via the editor.)
