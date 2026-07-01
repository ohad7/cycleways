# Featured Mobile Elevation Timeline — Design

Date: 2026-07-02

## Status

Design selected, implemented, and validated.

## Problem

On mobile web and in the iOS embedded featured-route page, the video/map stage
has a conventional linear playback scrubber while the richer elevation profile
appears later, after the route introduction and actions. The two controls are
functionally synchronized but do not read as one system.

## Goal

Make elevation a full-width synced route timeline tied to the existing mobile
player controls:

- playback moves the elevation cursor;
- dragging the profile seeks the video and route marker;
- dragging the existing video scrubber seeks the elevation cursor and route
  marker;
- switching video ↔ map leaves the same timeline in place;
- the current distance and slope remain readable on a phone.

## Decisions

- Scope this change to mobile surfaces only: mobile web and the iOS embedded
  featured-route WebView.
- Do not change the desktop featured-route layout. Desktop already keeps the
  video/map and elevation graph close enough spatially, and the existing
  desktop side-rail works.
- Keep the current player controls at the bottom of the video/map stage.
- Do not add a second play/pause button next to the elevation graph.
- Do not replace the existing video scrubber with the elevation graph.
- Place the elevation graph immediately below the media stage, stretched to the
  full content width.
- Treat the video scrubber and elevation graph as two controls over the same
  playback state.
- Add a sticky bottom action bar for Navigate/Edit/GPX on mobile, with
  safe-area padding and enough page padding so content is not hidden behind it.

## Selected direction — Attached synced elevation strip

The media stage keeps the current player controls at the bottom of the video/map
because those controls already work well and users understand them. Immediately
below the media stage, a full-width elevation strip shows the same playback
position on the route.

The strip contains:

- a full-width compact elevation profile large enough to touch accurately;
- a persistent current-position cursor;
- current/total distance and current slope;
- a short hint on first use.

It does **not** add a second play/pause control. Transport remains in the
existing player control bar. Route description, actions, statistics, and the
detailed slope legend follow below. The main Navigate/Edit/GPX actions use a
sticky bottom bar with safe-area padding.

### Advantages

- Visually belongs to both video and map.
- Does not cover footage or map labels.
- Provides a larger, more reliable touch target.
- Keeps the main media composition calm.
- Avoids duplicate playback controls.
- Preserves the current working player interaction model.

### Tradeoff

- Adds roughly 78–92 px beneath the media stage.

## Rejected alternative — Immersive overlay timeline

The compact elevation profile lives in a translucent panel over the bottom of
the video/map stage, replacing the current playback bar.

### Advantages

- Strongest visual connection to playback.
- Keeps the page vertically shorter.

### Tradeoffs

- Covers meaningful video/map content.
- Competes with the POI preview and map controls.
- Requires more responsive collision handling across video and map states.

## Recommendation

Implement the selected direction: current player controls stay on the media
stage; the elevation strip sits directly below as a full-width synced route
timeline; both scrubbers seek the same playback state; and the sticky CTA bar
keeps Navigate/Edit/GPX available while scrolling.

## Interaction contract

- Source of truth: the existing featured-route playback cursor remains the
  single state source.
- Video controls:
  - play/pause controls playback;
  - scrubber seek updates video time, map marker, POI preview, and elevation
    cursor.
- Elevation strip:
  - drag/tap seek updates the same playback cursor;
  - it never owns independent play/pause state;
  - it reflects the current media mode, whether the stage is showing video or
    map.
- Sticky CTA:
  - Navigate is primary;
  - Edit and GPX are secondary;
  - the bar remains visible while scrolling on mobile web and iOS WebView.

## Acceptance criteria

- The new elevation strip appears on mobile web and in the iOS WebView.
- The desktop featured-route page keeps its current video/elevation layout.
- The existing bottom-of-video player controls still render and function on
  mobile.
- The elevation strip spans the available mobile content width directly under
  the media stage.
- The elevation strip contains no play/pause button.
- Scrubbing the existing player moves the elevation cursor.
- Dragging/tapping the elevation strip seeks the video and route/map cursor.
- Switching between video and map does not reset or desynchronize the cursor.
- Navigate/Edit/GPX remain visible in a sticky bottom bar and do not cover the
  final route content.
- Desktop featured-route layout remains unchanged.

## Visual comparison

See `sticky-cta-mockup.html` / `sticky-cta-mockup.jpg` for the latest selected
direction. The earlier comparison remains in `mockup.html` / `comparison.png`.
