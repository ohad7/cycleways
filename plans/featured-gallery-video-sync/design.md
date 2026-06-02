# Featured Gallery ↔ Video ↔ Map Sync Design

Date: 2026-06-02

## Goal

Make the featured-route gallery, the route video, and the side map move together,
and tighten the gallery layout so the image and its description are both visible.

Builds on [segment-poi-gallery](../segment-poi-gallery/design.md) and
[poi-editor-refinements](../poi-editor-refinements/design.md).

## Behavior

The shared coordinate is **route fraction** (0–1 along the route geometry).

### Video → gallery (auto-walk)

While the video plays, `VideoEmbed` already emits `videoCursor = { t, lat, lng,
fraction }` ~4×/sec. On each update, the gallery selects the slide whose POI
`routeFraction` is nearest the cursor's `fraction`.

- This updates the displayed image and sets `focusedPoiId` (the gallery's
  current POI).
- It does **not** recenter the map and does **not** seek/pause the video. The
  moving video cursor already shows position on the map ("highlight only").
- Auto-walk only happens while playing, because the cursor ticker only runs
  while playing — so once the video is paused, the gallery stops following.

Nearest match: minimize `|slide.routeFraction − cursor.fraction|`. Slides for the
same POI share a `routeFraction`; the first (image index 0) wins ties, matching
the existing route-progress sort order.

### Gallery → video + map (manual scrub)

When the user clicks an arrow or a slide:

1. Select that slide (update the image).
2. Recenter the map on the POI (`focusedCoord` → existing `flyTo`).
3. Seek the video to the POI: `videoSync.positionToTime(slide.routeFraction)`
   then `playerSeek(t)`.
4. **Pause** the video.

Pausing stops the cursor ticker, so auto-walk halts and manual control wins until
the user presses play again.

### Map marker click (completes the triangle)

Clicking a POI marker on the map is also a manual selection: it selects the
matching gallery slide, recenters (already does), seeks the video to that POI,
and pauses — same as a manual gallery scrub. (`handleDataMarkerClick` in
`FeaturedRoute` gains the seek+pause; it derives the fraction via
`videoSync.snapClickToRoute({lat,lng})`.)

### Loop prevention

- Video-driven selection sets only `focusedPoiId` (no seek, no pause, no
  `focusedCoord`) → cannot re-trigger video control.
- User-driven selection seeks + pauses → ticker stops → no competing auto-walk.

## Data

`galleryImageSlides` (in `packages/core/src/data/poiTypes.js`) must include
`routeFraction` on each slide (it currently emits `routeProgressMeters` only).
The value already exists on each active data point
(`projectPointToRouteGeometry` sets `routeFraction`). Slides whose
`routeFraction` is not finite are skipped by the auto-walk matcher.

## Layout

`RoutePoiGallery` + `featured.css`:

- **Remove** the "לעצור ולראות / גלריית הדרך" heading row (and the old top
  control row).
- **Move `‹ ›`** to buttons overlaying the left/right edges of the image,
  vertically centered (absolute-positioned over the image figure). In RTL,
  `‹` advances toward the start and `›` toward the end consistently with the
  current behavior; arrows are positioned by physical left/right edge.
- **Replace the dots** with a compact `current / total` counter (e.g. `3 / 14`).
- The card body (type · name, short info, long description) stays below the
  image so image + description are both visible in the rail.

```
┌──────────────────────────┐
│ ‹      [ image ]       › │
├──────────────────────────┤
│ חוף · חוף קולומביה        │
│ short info                │
│ longer description        │
└──────────────────────────┘
            3 / 14
```

## Plumbing

- `VideoEmbed`: expose a pause function via a new context ref
  `playerPauseRef.current = () => player.pauseVideo()` (set in `onReady`,
  cleared on teardown), mirroring `playerSeekRef`.
- `FeaturedRoute`: add `playerPauseRef` to the context value; update
  `handleDataMarkerClick` to seek + pause.
- `RoutePoiGallery`: consume `videoCursor`, `videoSyncRef`, `playerSeekRef`,
  `playerPauseRef`; add the auto-walk effect and split selection into
  `selectFromVideo` (id only) vs `selectByUser` (recenter + seek + pause).

## Testing

Unit (Node):
- `galleryImageSlides` includes `routeFraction` (extend `tests/test-poi-types.mjs`).
- A pure nearest-slide matcher `nearestSlideIndexByFraction(slides, fraction)`
  (new small helper, exported from `poiTypes.js` or a gallery util) with tests:
  exact match, between two POIs (nearest wins), before first, after last, empty,
  slides missing `routeFraction` skipped.

Component/E2E:
- Featured E2E: arrows are positioned over the image and a `N / M` counter
  renders (heading gone). Full sync (play→advance, scrub→pause+seek) is verified
  manually in the browser since it depends on the YouTube player.

## Non-Goals

- Changing video keyframes or the route geometry.
- Smooth-scrolling/animated gallery transitions beyond selecting the slide.
- Per-POI in-card multi-image strip (galleries stay flattened, one slide per
  image).
