# Featured Route Mobile Cropped Video Player Implementation Plan

Date: 2026-06-03
Design: `plans/featured-mobile-video-crop/design.md`

## Phase 1 — CSS Mockup With Existing Video

1. Add a mobile-only route-player class path.
   - Keep `src/featured/sovev-beit-hillel.jsx` structurally close to the
     current page.
   - Move the mobile map into `.sbh-video-shell` or render a second mobile-only
     overlay map inside that shell.
   - Keep the desktop side rail and desktop map unchanged.

2. Crop the YouTube video on phones.
   - In `src/components/featured/featured.css`, inside the `max-width: 767px`
     block, set `.sbh-video .featured-video-frame` to `aspect-ratio: 4 / 5`.
   - Make `.featured-video-iframe-host` and its iframe cover the tall frame by
     expanding to `222.222%` width and centering horizontally.
   - Preserve the custom hit shield and controls above the iframe.

3. Convert the mobile map into a mini-map overlay.
   - Position `.sbh-mobile-map.featured-map-inline` absolutely in the top-right
     corner of `.sbh-video-shell`.
   - Use a square clamped size, roughly `clamp(104px, 31vw, 126px)`.
   - Add a border, subtle shadow, and transparent/cream backing so it reads over
     video content.
   - Pass tighter route-fit padding for the mobile overlay map.

4. Rebalance the POI video preview.
   - Keep it top-left.
   - Reduce text and image size enough that it cannot collide with the mini-map.
   - Confirm the collapsed state still works.

5. Remove the old below-video mobile map space.
   - If the same map node is moved into the video shell, no extra cleanup is
     needed.
   - If a second overlay map is added, ensure the old below-video map remains
     hidden on phones and no duplicate map appears to assistive tech.

6. Adjust route text spacing after the player.
   - Remove spacing that assumed a separate 230px map below the video.
   - Keep the short route panel visible soon after the route player.

## Phase 2 — Behavior Check

1. Confirm video interactions.
   - Play/pause toggles from the hit shield and custom button.
   - Scrubber can seek without snapping back.
   - Video cursor still drives map marker and POI preview.

2. Confirm map interactions.
   - Mini-map renders route and current cursor.
   - POI marker click still focuses a POI and seeks/pauses video.
   - User pan/zoom either works acceptably or is intentionally limited in a
     follow-up.

3. Confirm visual collision rules.
   - Top-left POI preview and top-right mini-map do not overlap at 360px,
     390px, and 430px widths.
   - Controls remain readable at the bottom of the 4:5 frame.

## Phase 3 — Optional Crop Controls

If the center crop is close but not perfect, add a per-route CSS variable:

- `--sbh-mobile-video-crop-x: 50%`

Then set the iframe host position with that value rather than a fixed centered
transform. This allows route-specific left/right bias without changing video
source or sync.

Only add this if visual testing shows the center crop misses important content.

## Phase 4 — Future Real Mobile Video Source

If the mockup proves the layout but the crop is not good enough:

1. Extend route-video metadata to support a mobile YouTube ID.
2. Update `VideoEmbed` to choose the mobile ID only on phones.
3. Decide whether the mobile video reuses the desktop timing or needs its own
   keyframes.
4. Update the editor/promote flow so mobile video metadata can be managed
   safely.
5. Add tests for desktop/mobile video selection.

This phase is explicitly deferred until the CSS mockup has been reviewed.

## Validation

- Run `npm run build`.
- Run focused featured-route tests if available:
  - `tests/e2e/featured-route-layout.spec.mjs`
  - `tests/e2e/featured-route-slots.spec.mjs`
- Use the in-app browser or Playwright screenshots at:
  - 360 x 740
  - 390 x 844
  - 430 x 932
  - desktop smoke width around 1440
- On screenshots, verify:
  - 4:5 video crop is nonblank and centered.
  - mini-map is visible top-right and route/cursor render.
  - POI preview remains visible top-left without colliding.
  - controls are usable and do not overlap the mini-map.
  - desktop layout is unchanged.
