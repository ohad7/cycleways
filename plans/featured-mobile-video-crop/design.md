# Featured Route Mobile Cropped Video Player Design

Date: 2026-06-03

## Goal

Make the Sovev Beit Hillel featured-route page feel native to mobile web by
turning the existing landscape YouTube video into a taller route-player surface,
without requiring a new video upload for the first mockup.

The mobile first viewport should prioritize the ride video, keep the live map in
the same visual field, and still preserve the synchronized POI image preview.

## Core Idea

On phones, crop the existing 16:9 YouTube iframe into a centered 4:5 viewport:

```text
┌───────────────────────────┐
│ POI preview      mini map │
│                           │
│                           │
│      cropped video        │
│      middle slice         │
│                           │
│                           │
│ play  scrubber       time │
└───────────────────────────┘
```

This is a visual crop only. The video source, video keyframes, route sync, and
YouTube ID remain unchanged.

The 4:5 frame gives the video more vertical presence on a phone than the current
16:9 embed. A 9:16 crop is intentionally not the first choice because it would
take too much of the page and is more likely to cut important route context from
the landscape source.

## Crop Mechanics

The visible `.featured-video-frame` becomes a 4:5 container with
`overflow: hidden`.

The YouTube iframe host inside it is expanded to cover that portrait-ish frame:

- source ratio: 16:9
- visible ratio: 4:5
- required iframe width when height is fixed: `(5 / 4) * (16 / 9) = 2.222`
- practical CSS: iframe host width `222.222%`, height `100%`, centered with
  `left: 50%` and `transform: translateX(-50%)`

The user sees the middle vertical slice of the original video.

## Mobile Route Player Layout

For `max-width: 767px`:

- Video frame becomes 4:5.
- The live map moves from below the video into the top-right corner of the
  video shell.
- The POI preview remains top-left, compact enough to avoid covering the ride.
- Custom video controls remain pinned at the bottom of the video frame.
- The route text begins immediately after the player, not after a separate map
  block.

## Mini Map Behavior

The over-video map is a context map, not the full planning map.

- Size target: about `108px` to `124px` square on common phones, with responsive
  clamping.
- It shows route, video cursor, active POI markers, and focus marker.
- It should use tighter route-fit padding than the desktop map.
- It may stay interactive for marker taps, but detailed pan/zoom is not the main
  interaction. If tiny map gestures feel awkward, the implementation can disable
  map gestures for the mini-map in a later pass and treat it as a tap target.
- Existing auto-reset behavior remains useful only if the mini-map allows pan or
  zoom.

## POI Preview Behavior

The POI image preview should continue to sync with the video cursor.

On mobile:

- top-left placement
- compact pill form
- thumbnail + title only in the default state
- collapsed image-only form when the video is near but not directly on the POI

The preview and the mini-map must not overlap on narrow screens. If they do, the
POI preview should shrink first.

## Desktop And Tablet Behavior

Desktop remains unchanged.

Tablet can keep the current 16:9 behavior initially. The 4:5 crop should be
limited to phone widths until it proves itself.

## Future Mobile Video Source

If the crop works as an interaction model but the center slice cuts off too much
content, add route-video metadata for separate desktop and mobile YouTube IDs.

Future data shape could be:

```json
{
  "youtubeId": "desktop-id",
  "mobileYoutubeId": "mobile-id",
  "videoDuration": 123,
  "keyframes": []
}
```

The mobile source should either:

- reuse the same timing and keyframes if it is the same edit rendered in a
  different aspect ratio, or
- provide separate mobile keyframes if the mobile edit changes timing.

This future step belongs in the editor/video-sync workflow, not in the CSS-only
mockup.

## Risks

- The important route content may not be centered in the original landscape
  video.
- YouTube iframe internals can create black bars if the host and iframe are not
  both forced to cover the frame.
- A very small interactive Mapbox map may steal taps from the video while still
  being too small for useful gestures.
- The custom controls need extra care in a taller frame so they remain readable
  and do not collide with iOS browser chrome.

## Non-Goals

- No new video upload in the mockup pass.
- No editor changes in the mockup pass.
- No route-video keyframe changes.
- No desktop redesign.
- No removal of the existing sync model.
