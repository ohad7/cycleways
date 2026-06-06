# Featured Map Playback Design

Date: 2026-06-06

## Goal

Make featured/recommended route pages without a real video feel like the video
routes:

- the primary stage should be playable;
- the route should animate with the same cursor style
  (`progress-head-pulse` by default);
- the same POI / warning cue preview should appear at the right moment;
- the same scrubber, play/pause, elapsed time, and distance readout should work;
- POI, warning, marker, and route clicks should seek the route playback.

The feature should align the video and non-video route experiences without
requiring authored video keyframes for every route.

## Current State

`FeaturedVideoRoute` already has two stage modes:

- `media="video"` renders `FeaturedRoute.Video`, `FeaturedRoute.POIVideoPreview`,
  and a compact synced map.
- `media="map"` renders only `FeaturedRoute.Map` in the primary stage.

The underlying shared context is still named around video:

- `videoCursor`
- `videoPlaying`
- `videoSyncRef`
- `playerSeekRef`
- `playerPlayRef`
- `playerPauseRef`
- `seekVideoToFraction`

For video routes, `VideoEmbed` owns a YouTube clock and a `createVideoSync(...)`
adapter. That adapter maps:

```text
video time -> route fraction -> route lat/lng
route fraction -> video time
map click -> nearest route fraction
```

Map-only featured routes do not currently install a playback source. Their
primary action only re-fits the route map.

## Decision: Route Playback, Not Video Playback

Treat both page types as **route playback**:

- Video route: playback source is the YouTube player plus authored sync
  keyframes.
- Map-only route: playback source is a synthetic timer plus a linear route
  fraction.

Both sources should expose the same small adapter contract:

```js
{
  durationSeconds,
  timeToPosition(timeSeconds),   // { lat, lng, fraction }
  positionToTime(routeFraction), // seconds
  snapClickToRoute({ lat, lng }) // { lat, lng, fraction, distanceM } | null
}
```

`VideoEmbed` already provides this indirectly through `createVideoSync(...)`.
The new map playback path should provide a compatible synthetic adapter, for
example `createLinearRoutePlaybackSync(...)`.

This lets existing POI/marker click behavior keep working with minimal churn:

- `seekVideoToFraction(...)` can keep using `videoSyncRef` and `playerSeekRef`
  during the first implementation.
- `handleRouteClick(...)` can keep snapping through the sync adapter.
- `FeaturedRouteMap` can keep reading `videoCursor` and `videoPlaying`.

The names are wrong, but the behavior is close. A later cleanup can rename these
to route-oriented names (`routeCursor`, `routePlaying`, `routePlaybackRef`) after
the shared behavior is stable.

## Synthetic Map Playback

For routes without a video, playback is a deterministic timer:

```text
time 0                  -> fraction 0
time durationSeconds    -> fraction 1
```

At each animation tick:

1. compute `fraction = currentTime / durationSeconds`;
2. compute route position using existing route geometry helpers
   (`pointAtFraction`, cumulative distances);
3. update the shared cursor:

```js
setVideoCursor({ t: currentTime, fraction, lat, lng })
```

The map receives that cursor through the existing `videoCursor` prop, so the
same route cursor layer and `progress-head-pulse` animation render for video and
map-only routes.

The same cursor fraction should also drive the featured elevation graph. The
elevation graph should not use a separate blue vertical playhead on featured
pages; it should render a green progress trace along the elevation curve with an
orange `progress-head-pulse` marker at the current route fraction.

### Cursor Style

Map playback should use the same default cursor variant as video routes:

```js
VIDEO_CURSOR_DEFAULT_VARIANT === "progress-head-pulse"
```

The implementation should not introduce a separate default for map-only routes.

## Duration Formula

Map-only playback should be much shorter than a real ride video. It should be
long enough for POIs to appear and for the route shape to be understandable, but
not long enough to feel like waiting.

Formula:

```js
durationSeconds = clamp(
  26 + distanceKm * 2 + cueCount * 1.8 + elevationGainM / 300,
  35,
  80
)
```

Where:

- `distanceKm` comes from `routeState.distance / 1000`;
- `cueCount` counts route video cues excluding start/end endpoints;
- `elevationGainM` comes from `routeState.elevationGain`;
- clamp minimum is 35 seconds;
- clamp maximum is 80 seconds.

This produces:

- short/simple routes: around 35-45 seconds;
- medium scenic routes: around 45-70 seconds;
- long/dense routes: capped around 80 seconds.

The formula should be implemented as a pure helper and covered by tests. It can
be tuned after trying real routes.

## Cue Preview

Map playback should use the same cue data as video playback:

- start/end endpoint slides;
- gallery-eligible image POIs;
- all warnings, including text-only warnings.

The current helper `routeVideoCueSlides(meta, routeState)` is the right source.
The overlay component may keep its current name (`RoutePoiVideoPreview`) during
the first implementation, but its effective role becomes "route cue preview."

Display behavior:

- The nearest cue is always available as a compact/mini preview.
- When the cursor is within the cue vicinity threshold, the preview expands.
  Synthetic map playback uses a wider threshold than real video playback so
  POIs and warnings stay readable while the route summary runs quickly.
- Image-backed cues show the image.
- Text-only warnings show the warning icon fallback.
- Clicking the cue pauses playback, focuses the POI/warning, and scrolls to the
  corresponding story or warning card.

## Controls

Map playback should render controls that visually match the existing video
controls:

- play/pause button;
- scrubber;
- current time / duration;
- distance from start (`RouteProgressDistance`);
- click or drag scrubber to seek.

The controls should reuse the existing class vocabulary where practical
(`fv-video-controls`, `fv-video-scrubber`, etc.) to avoid a parallel design.
If semantic naming is desired, add shared aliases such as
`fv-route-playback-controls` while preserving existing video styling.

The primary route action for `media="map"` should change from "center map" to
"play route" once the synthetic playback component registers `playerPlayRef`.
Route-fit should still happen automatically on load/resume and remain available
through map behavior, but it should not be the primary action anymore.

## Playback Behavior

Map-only playback should use variable progress by default:

Do **not** apply the YouTube-specific slowdown/speedup behavior to synthetic map
playback in the first version:

- no slow-start ramp;
- no POI-vicinity slowdown;
- no `playbackBehavior: legacy | none` setting.

Instead, divide the synthetic route into cue windows and non-cue windows:

- cue windows are where the route cue preview is expanded;
- cue windows play at normal route-summary speed;
- non-cue windows play at `2x` speed, because no POI/warning is being shown;
- the displayed duration is the sum of the timed windows, so speeding up boring
  sections shortens the total playback duration.

Map-only playback uses a map-specific cue vicinity threshold rather than
slowing down near POIs. This keeps cue cards readable while letting the cursor
move faster between them.

## Map Endpoint Markers

Readonly featured maps should render authored route endpoints even though the
planner route-point editing layer remains disabled:

- non-circular routes show a compact green start/play marker and a small red
  stop marker;
- circular routes, where the start and end are effectively the same location,
  show one split green/red dot;
- endpoint markers are visual anchors only and should not re-enable route point
  editing on public route pages.

## Component Shape

Add a dedicated map playback stage component rather than folding this into
`VideoEmbed`:

```text
src/components/featured/RouteMapPlayback.jsx
```

Responsibilities:

- build the synthetic sync adapter from route geometry and duration;
- register `videoSyncRef`, `playerSeekRef`, `playerPlayRef`, and
  `playerPauseRef` while mounted;
- own current time, playing state, scrubbing state, and animation ticker;
- emit cursor updates to the existing featured-route context;
- render:
  - `FeaturedRoute.Map` / `MapView` as the primary stage;
  - `FeaturedRoute.POIVideoPreview` overlay;
  - shared playback controls.

Then `FeaturedVideoRoute` can switch:

```jsx
{isMapStage ? (
  <FeaturedRoute.MapPlayback videoCursorVariant={videoCursorVariant} />
) : (
  <>
    <FeaturedRoute.Video />
    <FeaturedRoute.POIVideoPreview />
    <FeaturedRoute.Map className="fv-mobile-map" />
  </>
)}
```

This keeps the first implementation scoped. It also avoids forcing the YouTube
embed and map playback component into one large component.

## Interaction Rules

### Play / Pause

- Play starts or resumes the synthetic clock.
- Pause stops the animation frame ticker.
- At route end, playback stops and leaves the cursor at fraction `1`.
- Pressing play at the end restarts from `0`.

### Scrub

- Scrubbing pauses the ticker while dragging.
- The cursor updates immediately while scrubbing.
- On pointer release, resume only if playback was active before scrub.

### POI / Warning / Marker Click

- Pause playback.
- Focus the selected POI/warning.
- Seek to that route fraction.
- Update the map cursor immediately.
- Scroll to the stage on mobile, matching existing video behavior.

### Route Click

- Snap the click to the route.
- Seek to the snapped route fraction.
- Pause playback.
- Update cursor immediately.

## Accessibility And Reduced Motion

- Respect `prefers-reduced-motion`.
- If reduced motion is enabled, still allow manual scrubbing and POI seeking,
  but do not auto-play route animation unless the user explicitly presses play.
- Play/pause controls need route-specific labels, not video-specific labels:
  "נגן מסלול" / "השהה מסלול".
- The scrubber label should be "מעבר בזמן המסלול" for map playback.

## Data Model

No new persisted route data is required for the first version.

The duration is derived from existing snapshot/catalog state:

- route distance;
- elevation gain;
- cue count from `routeVideoCueSlides(...)`.

Future optional catalog setting:

```json
{
  "mapPlaybackDurationSeconds": 70
}
```

Do not add this until there is a real route that needs manual override.

## Edge Cases

- Missing route geometry: do not render playback controls.
- Route distance `0` or invalid: fall back to 35 seconds and fraction-only
  interpolation if possible.
- No POIs or warnings: route still plays; cue preview shows only start/end if
  configured.
- Browser tab backgrounded: use elapsed wall-clock deltas, clamp time to
  duration, and avoid jumping past end without emitting the final cursor.
- User pans/zooms map during playback: keep existing auto-reset behavior, but
  do not fight the user every frame. Fit route on initial load and on resume
  from focused POI, not continuously.

## Non-Goals

- No editor UI for configuring map playback duration in the first pass.
- No route-specific speed curves.
- No dwell/slowdown at POIs in the first pass.
- No 3D camera fly-through.
- No change to video keyframes or GPS bootstrap.
- No broad rename from `videoCursor` to `routeCursor` in the first pass unless
  it becomes necessary for clarity during implementation.
