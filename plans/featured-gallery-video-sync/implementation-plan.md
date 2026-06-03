# Featured Route Story Layout Implementation Plan

Date: 2026-06-02

## Tasks

1. Update the Sovev Beit Hillel JSX page.
   - Replace the side carousel with a right-rail route text panel.
   - Move the desktop map into the lower right rail.
   - Add a below-fold POI story list.
   - Wrap the video so a POI preview overlay can sit above it.

2. Add route-story components.
   - Add a `RoutePoiVideoPreview` component that derives the current preview
     from `videoCursor` and gallery-eligible route POIs.
   - Add a `RoutePoiStoryList` component that groups route image slides by POI,
     renders all images, and handles click-to-focus/seek/pause.
   - Keep data derivation based on `galleryImageSlides` and existing
     route-progress fields.

3. Update featured-route CSS.
   - Replace carousel-first rail styles with the new text-panel/map rail.
   - Preserve a desktop video height that does not overflow below the fold.
   - Style the video preview as a compact top-left overlay.
   - Style the below-fold POI list as image-rich story cards.
   - Keep mobile layout functional with a single-column fallback.

4. Update tests.
   - Change the desktop layout E2E expectations from carousel controls to text
     panel, lower rail map, hidden hero carousel, video preview host, and POI
     story list.
   - Keep fullscreen map tests passing.
   - Add focused unit coverage for any new pure data helpers if helpers are
     introduced.

5. Validate.
   - Run `npm run build`.
   - Run focused E2E specs for featured routes.
   - Run the relevant Node tests for POI/map helpers.
   - Browser-check the featured page at a desktop viewport and inspect the first
     viewport structure.

## Acceptance Criteria

- The desktop hero has video on the left and a right rail with route text above
  a compact live map.
- The hero carousel no longer appears.
- The video frame stays within the first viewport at desktop sizes.
- A POI preview overlay container exists on the video and renders when a synced
  video cursor is near a photographed POI.
- Below the hero, photographed POIs render in route order with images plus short
  and long descriptions.
- POI story card clicks focus the map and seek/pause the video.
- Existing featured-route page routing and fullscreen map behavior still pass.
