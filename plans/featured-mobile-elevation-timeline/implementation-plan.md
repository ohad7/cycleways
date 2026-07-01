# Featured Mobile Elevation Timeline — Implementation Plan

Date: 2026-07-02

## Status

Design selected, implemented, and validated.

## Implementation tasks

1. Identify the existing featured-route playback state and seek API used by the
   current mobile video controls.
2. Extract or introduce a mobile `FeaturedRouteElevationStrip` component driven
   by that same cursor, duration/progress, route geometry, and seek callback.
3. Reuse the existing elevation-profile data model, cursor interpolation, and
   slope colors. Do not duplicate route-progress math.
4. Preserve the current mobile player controls at the bottom of the video/map
   stage. Do not add a second play/pause button beside the elevation graph.
5. Place the elevation strip immediately below the stage and stretch it to the
   full content width.
6. Wire bidirectional seeking:
   - player scrubber → elevation cursor, route marker, video;
   - elevation drag/tap → player scrubber, route marker, video;
   - map/video mode switch → same cursor state.
7. Keep desktop side-rail elevation unchanged.
8. Add touch seeking, keyboard semantics, and reduced-motion behavior.
9. Add sticky mobile CTA bar for Navigate/Edit/GPX with safe-area padding and
   bottom content padding.
10. Remove or relocate the existing later mobile-only elevation block if it
    becomes a duplicate. Keep detailed statistics/legend below only if they add
    information not already in the strip.

## Validation and test expectations

1. Unit-test any new cursor/seek helper logic with representative route
   fractions, including first/last point boundaries.
2. Add mobile visual/E2E coverage for:
   - elevation strip directly adjacent to the stage;
   - video and map using the same timeline state;
   - player scrubber and elevation drag both seek the same cursor;
   - no duplicate play/pause control in the elevation strip;
   - sticky CTA remains visible and does not cover content.
3. Add or keep a desktop regression proving the desktop featured-route elevation
   rail/layout is unchanged.
4. Run existing featured-route shell/playback E2E tests on mobile and desktop
   projects.
5. Run the web production build.
6. Export the iOS bundle after WebView/shared route changes.
7. Verify mobile Safari and the iOS WebView on a physical device.

## Non-goals

- No redesign of desktop featured-route controls.
- No second transport/play button in the elevation strip.
- No new independent playback state for elevation.
