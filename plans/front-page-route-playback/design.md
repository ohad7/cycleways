# Front Page Route Playback Design

Date: 2026-06-06

## Goal

Bring the featured-route "play route" experience to the front-page planner when
the user creates or restores a route from scratch.

The front page should let a user press play and watch the planned route animate
on the map with the same cursor, controls, POI preview behavior, and elevation
tracking used by non-video featured route pages such as `/routes/historic-jordan`.

## Current State

Featured route pages already have the desired behavior for map-only routes:

- `RouteMapPlayback` owns a synthetic route clock.
- `routePlaybackSync` maps playback time to route fraction and map position.
- `RoutePlaybackControls` renders the play/pause button, scrubber, time, and
  distance readout.
- `RoutePoiVideoPreview` shows the nearest start/end/POI/warning cue.
- `MapSurface` already supports `videoCursor` and `videoCursorVariant`.
- `progress-head-pulse` is already the best cursor style and is exposed through
  `VIDEO_CURSOR_DEFAULT_VARIANT`.

The front page already has:

- route geometry and route distance in `routeState`;
- route active POIs/warnings in `routeState.activeDataPoints`;
- map cursor support through `MapView`/`MapSurface`;
- an elevation profile that can render an externally driven cursor fraction;
- a bottom-left route-description/elevation panel.

The missing piece is a shared playback controller that is not tied to
`FeaturedRouteContext`.

## Design Decision

Create shared route-playback primitives and make both featured-route playback
and front-page planner playback use them.

Do not copy the featured route playback logic into `App.jsx`. The route clock,
scrubbing behavior, POI cue selection, and cursor emission should have one
implementation.

The first implementation may keep the existing map prop name `videoCursor`
because that is already the map-layer contract. Internally, new shared code
should use route-oriented names such as `routeCursor`, `routePlaying`, and
`routePlayback`.

## Shared Playback Model

The shared playback hook should accept route data and return playback state:

```js
useRoutePlayback({
  routeGeometry,
  routeDistanceMeters,
  elevationGainMeters,
  cueSlides,
  onCursorChange,
  onPlayingChange,
})
```

It should return:

- `currentTime`;
- `duration`;
- `isPlaying`;
- `isScrubbing`;
- `cursor` with `{ t, fraction, lat, lng }`;
- `play()`;
- `pause()`;
- `seekToTime(time)`;
- scrubber event handlers or small callbacks for controls.

The hook should reuse the existing synthetic sync helpers from featured map
playback:

- `computeMapPlaybackDuration`;
- `createVariableSpeedRoutePlaybackSync`;
- cue-aware speed behavior where non-cue sections move faster and cue windows
remain readable.

## Cursor Animation

Planner playback should use the same map cursor layer as featured playback:

```jsx
<MapView
  videoCursor={routePlayback.cursor}
  videoCursorVariant="progress-head-pulse"
/>
```

`progress-head-pulse` should be the default for planner playback. Avoid adding
another cursor style or a duplicated pulse implementation.

When playback stops because the route changed, the cursor should clear. When
the user scrubs or clicks a POI preview, the cursor should remain at the selected
route position.

## Elevation Graph

Featured route elevation already follows the playback cursor through
`cursorFraction`.

The planner elevation graph currently receives `animator`, and in that mode the
external cursor fraction is ignored. Planner playback should explicitly override
the elevation marker while playback is active or while the user is scrubbing.

Expected behavior:

- when not playing/scrubbing, existing hover/route-direction behavior remains;
- while playing, the green progress path advances along the elevation profile;
- the same orange pulse marker appears on the elevation graph;
- while scrubbing, the graph updates immediately;
- when the route changes or is cleared, the playback marker clears.

This is not a redesign of the elevation graph, only a wiring change so planner
playback uses the same visual tracking as featured routes.

## POI And Warning Cues

POI preview should use the same logic as featured route playback:

- `routeVideoCueSlides` or a renamed shared equivalent builds cue slides;
- `nearestPreviewForCursor` chooses the active/nearest cue;
- cue preview expands near the cue and shrinks between cues;
- image-backed POIs show images;
- text-only warnings show an icon fallback;
- clicking a cue pauses playback and focuses the relevant POI/warning.

For scratch planner routes there may be no catalog `meta` with authored start
and end content. In that case:

- route start/end cues may be omitted or shown as simple text-only endpoint
  cues if useful;
- active route POIs and warnings should still appear because they already exist
  in `routeState.activeDataPoints`.

The front page should not introduce a separate cue selection algorithm.

## Desktop Visual Design

The front-page map already has several surfaces:

- top search box and tool buttons;
- legend and warnings;
- data-marker detail card on mobile;
- bottom-left route-description/elevation panel.

Playback controls should live with the route state, not as a new unrelated
floating element.

### Placement

On desktop, add a playback strip inside the existing route-description panel,
above the elevation graph and below the route summary line.

Suggested hierarchy inside `route-description-panel`:

```text
Route summary / warnings
Playback controls
Elevation graph
```

Reasoning:

- the panel already appears only when there is a route;
- it already owns elevation, distance, and route feedback;
- it avoids adding another control layer at the map bottom;
- controls remain close to the graph they animate.

If the current `420px` panel feels tight, widen it only modestly, for example
to `min(560px, calc(100% - 50px))`, and keep the panel anchored bottom-left.
Do not let the panel cover the top search or right-side route control buttons.

### Controls

Use the same visual language as featured route controls:

- play/pause button on the physical left of the strip;
- scrubber taking most of the width;
- time and distance readout;
- disabled state when there is no valid route geometry.

Use compact sizing on the planner. The featured controls are large because they
sit on a media stage; the planner controls are part of an operational tool.

### POI Preview

On desktop, show the POI preview as a small card over the map, above the
playback/elevation panel and near the physical left side, so it does not cover
the route buttons on the right.

Recommended placement:

```text
bottom: route-description-panel height + 36px
left: 25px
width: 300-360px
```

If the route-description panel is hidden or collapsed in a later design, the
preview should still anchor near the bottom-left map area, above the playback
strip.

The preview should not obscure the cursor or map controls more than necessary.
When not near a cue, use the compact/mini state already used by featured route
playback.

## Mobile Visual Design

Mobile already has less space and more bottom-sheet surfaces, so playback must
be more compact.

### Placement

Use a bottom dock inside the map container, above the route-description panel or
integrated into its top edge.

Preferred mobile layout:

```text
Map
Floating compact POI cue, only when relevant
Playback dock
Route description / elevation panel
```

The dock should:

- span `left: 12px; right: 12px`;
- sit above the route-description panel when that panel is visible;
- collapse to a single row with play/pause, scrubber, and current distance;
- avoid fixed large heights that reduce map usability.

### Mobile Controls

Mobile control priorities:

1. play/pause;
2. scrubber;
3. distance from start;
4. time, only if space allows.

On very narrow screens, hide the elapsed/total time text before hiding distance.
Touch targets should stay at least `36px` high.

### Mobile POI Preview

POI preview should be a compact pill/card above the playback dock:

- image thumbnail or icon on one side;
- type/name text;
- no long description unless expanded/near;
- tap pauses playback and focuses the POI/warning.

It should not overlap the mobile menu, search input, or warning/data marker
bottom card. If a data-marker detail card is open, the POI preview should hide
or move above it to avoid two competing bottom surfaces.

## Route Changes And Editing

Planner routes are mutable. Playback must respond predictably:

- adding/removing/dragging route points stops playback;
- route recalculation clears the playback cursor until geometry is ready;
- undo/redo stops playback and rebuilds duration/cues from the new route;
- clearing the route hides controls and POI preview;
- opening a shared `?route=` route builds playback once the restored geometry is
  ready.

During point dragging, playback should not keep moving. The route is in an edit
state, so playback should pause immediately.

## Accessibility

Controls should expose:

- a button label that changes between `נגן מסלול` and `השהה מסלול`;
- a range input label such as `מעבר בזמן המסלול`;
- disabled state when no route can be played;
- keyboard support for play/pause and scrubber.

POI preview should be a button with an accessible label such as
`עבור אל <name>`.

Respect reduced motion:

- do not autoplay;
- explicit play still works;
- scrubbing always works;
- if we later reduce animation under `prefers-reduced-motion`, preserve cursor
  position updates without pulsing.

## Non-Goals

- Do not add turn-by-turn navigation.
- Do not add real-time GPS follow mode.
- Do not redesign the front-page route planner layout beyond fitting playback
  controls.
- Do not duplicate POI cue logic.
- Do not rename all `videoCursor` map-layer APIs in this implementation unless
  required by the extraction.

## Open Questions

- Should simple start/end cues appear for scratch routes without route catalog
  start/end metadata, or should the first version show only POIs/warnings?
- Should the planner POI preview scroll to a front-page POI list if no visible
  story list exists, or only focus the map marker/card?
- Should playback be stopped by every route edit, or only by geometry-changing
  edits? The conservative first version should stop on every edit.
