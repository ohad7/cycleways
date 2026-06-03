# Featured Route Story Layout Design

Date: 2026-06-02

## Goal

Make the Sovev Beit Hillel featured-route page feel like a route story instead
of a utility panel. The first desktop viewport should center the ride video,
keep the live map close by, and reserve the photo gallery for richer route
story content below the fold.

This replaces the hero-side carousel from the previous gallery/video sync pass.
The sync plumbing remains useful, but the gallery is no longer the primary
desktop companion to the video.

## Desktop Layout

The desktop first viewport uses a Hebrew-oriented layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Header: route name, summary, stats                           │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────┬───────────────────────────┐
│                                  │ Route text panel          │
│ Video                            │ high-level description    │
│ POI preview overlay, top-left    │ practical notes           │
│                                  │                           │
│                                  ├───────────────────────────┤
│                                  │ Compact live map          │
└──────────────────────────────────┴───────────────────────────┘
```

- The right rail connects visually to the header, forming a Hebrew `ר` shape:
  the header is the top stroke, and the right text panel is the vertical stroke.
- The video remains the dominant object and should end at or before the fold on
  common desktop viewports.
- The map moves to the lower part of the right rail, replacing the old carousel
  position. It is compact, route-fit, and still supports fullscreen.
- The top of the right rail is a route-content panel, replacing the old map
  position. It carries the high-level description and practical riding notes.
- On mobile, the existing single-column behavior remains acceptable for now.
  The current task focuses on desktop.

## Video POI Preview

When the video cursor passes near a photographed POI, the video shows a compact
preview overlay in the top-left corner:

- image thumbnail
- POI type and name
- short information line

The preview is intentionally small and transient. It should give visual context
without asking the user to look away from the video. The overlay follows the
same route-fraction sync data already used by the map cursor.

Selection rule:

- Use gallery-eligible POIs only: non-warning POIs with at least one image.
- Find the nearest image slide by route fraction.
- Show the preview only when the cursor is close enough to the POI, using the
  smaller of route-fraction and route-distance checks so the preview does not
  remain visible for the entire ride.
- When the video is paused, `VideoEmbed` clears the cursor, so the preview hides.

## Below-Fold POI Story List

The rich image gallery moves below the hero as a vertical story list:

- POIs are ordered by progress along the featured route.
- Each POI appears once, even if it has multiple images.
- Each card shows the POI type, name, short information, long description, and
  all available images for that POI.
- Clicking a POI story card focuses the map on that POI and seeks/pauses the
  video at the same route fraction, matching the existing manual-gallery
  behavior.

This keeps reusable POIs as the source of truth. The featured route displays only
the POIs that are both on the route and have images.

## Data Model

Use the segment-level POI data already introduced by:

- `plans/segment-poi-gallery/`
- `plans/poi-editor-refinements/`

For this pass, the page uses existing POI-level fields:

- `type`
- `name`
- `information`
- `description`
- `location`
- `routeProgressMeters`
- `routeFraction`
- `images[]` or legacy `photo` / `thumbnail`

Future editor work can add per-image descriptions, captions, and exact
image-specific locations. The story list should not block on that.

## Interaction

- Video playback drives the map cursor and the transient POI preview.
- Clicking a POI marker or a POI story card focuses the map on that POI, seeks
  the video to its route fraction, and pauses the video.
- If the user resumes playback after manually focusing a POI, the map fits back
  to the full route.

## Non-Goals

- Pixel-perfect visual polish beyond making the new structure coherent.
- Editing the POI/image editor in this pass.
- Removing the old `RoutePoiGallery` component from the codebase if it remains
  useful for tests or future route templates.
- Changing route-video keyframes or route geometry.
