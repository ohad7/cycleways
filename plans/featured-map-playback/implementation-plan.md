# Featured Map Playback Implementation Plan

Date: 2026-06-06

> For agentic workers: this feature should align map-only route pages with video
> route pages without rewriting the whole featured-route context first. Reuse
> the existing cursor/map/cue preview plumbing, then rename abstractions only if
> the implementation needs it.

## Goal

Add playable synthetic route animation to featured/recommended routes that do
not have a real video. The map-only route stage should show the same route
cursor animation, cue preview, scrubber controls, and click-to-seek behavior as
video-backed featured routes.

## Phase 0: Baseline And Scope Check

### Tasks

- [ ] Confirm the current map-only route behavior on at least:
  - `/routes/historic-jordan`
  - `/routes/kovshey-hagolan`
  - one route with warnings and/or multiple POIs.

- [ ] Confirm the current video-backed behavior on `/routes/sovev-dafna`.
  - Record which DOM/classes are used for controls and cue preview.
  - Confirm `progress-head-pulse` is the default cursor style.

- [ ] Run focused baseline tests:
  - `node tests/test-poi-types.mjs`
  - `node tests/test-route-endpoints.mjs`
  - `npm run test:smoke -- tests/e2e/routes-index.spec.mjs --project=desktop`

### Acceptance Criteria

- Existing behavior and any pre-existing failures are documented before edits.
- The implementation scope stays on featured/recommended route pages, not the
  main planner.

## Phase 1: Pure Synthetic Playback Helpers

### Scope

Add pure helpers for deriving map playback duration and mapping synthetic time
to route position.

### Tasks

- [ ] Add a pure duration helper.
  - Suggested file: `src/components/featured/routePlaybackDuration.js`
  - Export:

    ```js
    computeMapPlaybackDuration({
      distanceMeters,
      elevationGainMeters,
      cueCount,
    })
    ```

  - Formula:

    ```js
    clamp(
      26 + distanceKm * 2 + cueCount * 1.8 + elevationGainM / 300,
      35,
      80
    )
    ```

- [ ] Add a synthetic route sync helper.
  - Suggested file: `src/components/featured/routePlaybackSync.js`
  - Export:

    ```js
    createLinearRoutePlaybackSync({
      durationSeconds,
      routeGeometry,
    })
    ```

  - Contract should match the pieces used from `createVideoSync(...)`:
    - `timeToPosition(timeSeconds)`
    - `positionToTime(routeFraction)`
    - `snapClickToRoute({ lat, lng })`
  - Add a variable-speed variant for map-only playback:
    - cue windows play at `1x`;
    - non-cue windows play at `2x`;
    - total duration is derived by summing the timed windows.

- [ ] Reuse existing geometry utilities.
  - Use `buildCumulativeDistances`, `pointAtFraction`, and
    `nearestPointOnPolyline` from the featured route geometry helpers.
  - Avoid duplicating route projection math.

- [ ] Clamp inputs defensively.
  - Negative/invalid time -> `0`.
  - Time beyond duration -> duration.
  - Invalid fraction -> `0`.
  - Empty/short route geometry should throw a clear error from sync creation.

### Tests

- [ ] Add `tests/test-route-playback-duration.mjs`.
  - Minimum clamp: short/no-cue route returns `35`.
  - Maximum clamp: long/dense route returns `80`.
  - Distance, cue count, and elevation each affect duration.
  - Invalid values are treated as zero.

- [ ] Add `tests/test-route-playback-sync.mjs`.
  - `timeToPosition(0)` returns fraction `0`.
  - `timeToPosition(duration)` returns fraction `1`.
  - Midpoint maps to expected route fraction.
  - `positionToTime(0.5)` returns half duration.
  - `snapClickToRoute(...)` returns a finite fraction near the clicked route.
  - Short geometry throws.

### Acceptance Criteria

- Duration and sync logic are deterministic, pure, and covered by node tests.
- No React component changes are required to verify this phase.

## Phase 2: Shared Route Playback Controls

### Scope

Prepare controls that can be used by the synthetic map playback stage without
copying the entire `VideoEmbed` control block.

### Tasks

- [ ] Extract a small presentational control component from `VideoEmbed`.
  - Suggested file: `src/components/featured/RoutePlaybackControls.jsx`
  - Props:
    - `isPlaying`
    - `isReady`
    - `isScrubbing`
    - `currentTime`
    - `duration`
    - `onTogglePlayback`
    - `onScrubStart`
    - `onScrubChange`
    - `onScrubEnd`
    - labels for play/pause/scrubber.

- [ ] Keep existing CSS class compatibility.
  - Preserve existing classes such as `fv-video-controls`,
    `fv-video-play-toggle`, `fv-video-scrubber`, and `fv-video-time`.
  - Optionally add route-oriented alias classes, but do not fork styling.

- [ ] Update `VideoEmbed.jsx` to use the shared controls.
  - Behavior must remain unchanged for video-backed routes.
  - Keep YouTube-specific state and playback-rate code in `VideoEmbed`.

### Tests

- [ ] Existing video E2E must still pass:
  - `npm run test:smoke -- tests/e2e/routes-index.spec.mjs --project=desktop`

### Acceptance Criteria

- `VideoEmbed` still renders the same controls and passes existing tests.
- The new controls component is presentation-only; it does not own playback
  timing.

## Phase 3: RouteMapPlayback Component

### Scope

Add the synthetic map playback stage for `media="map"` routes.

### Tasks

- [ ] Add `src/components/featured/RouteMapPlayback.jsx`.

- [ ] Build duration and cue list.
  - Use `routeVideoCueSlides(meta, routeState)`.
  - Count route cues excluding start/end endpoints for duration.
  - Use `computeMapPlaybackDuration(...)`.

- [ ] Build and register the synthetic sync adapter.
  - On mount/route change, create `createLinearRoutePlaybackSync(...)`.
  - Set `videoSyncRef.current` to that adapter.
  - Clear it on unmount if it still points to this component's adapter.

- [ ] Register playback refs while mounted.
  - `playerPlayRef.current = play`
  - `playerPauseRef.current = pause`
  - `playerSeekRef.current = seekToTime`
  - Clear refs on unmount if still owned by this component.

- [ ] Own playback state.
  - `currentTime`
  - `isPlaying`
  - `isScrubbing`
  - `wasPlayingBeforeScrub`
  - animation frame ticker id
  - last timestamp for elapsed-time deltas.

- [ ] Emit cursor updates.
  - On play ticks.
  - On scrub.
  - On external seek through `playerSeekRef`.
  - Cursor shape should match video route cursor:

    ```js
    { t, lat, lng, fraction }
    ```

- [ ] Set shared playing state.
  - `setVideoPlaying(true)` when synthetic playback starts.
  - `setVideoPlaying(false)` when paused/stopped/unmounted.

- [ ] Render the map stage.
  - Use `FeaturedRoute.Map` or `MapView` in the same stage container.
  - Pass through `videoCursorVariant`, use bottom-heavy `routeFitPadding` so
    the controls do not hide the route, and preserve existing map options.
  - Render `FeaturedRoute.POIVideoPreview` over the map, using the same cue
    helper as video routes and a wider synthetic-playback vicinity threshold.
  - Render `RoutePlaybackControls` over or under the map using existing visual
    treatment.
  - Keep the map expand button on the physical right of the playable stage so it
    does not cover the physical-left cue preview in RTL layout.
  - Render readonly endpoint markers on public route maps:
    - green compact play marker for start;
    - red compact stop marker for end;
    - split green/red marker for circular routes.

- [ ] End behavior.
  - When current time reaches duration, stop playback and emit the final cursor.
  - If user presses play while already at the end, restart from `0`.

- [ ] Reduced motion.
  - Do not auto-play.
  - Manual scrub and explicit play still work.
  - If a later implementation chooses to disable animation entirely under
    reduced motion, keep the scrubber/seek behavior functional.

### Tests

- [ ] Unit test any timing/ticker helper if extracted.
- [ ] Component-level behavior can be covered by Playwright in Phase 5.

### Acceptance Criteria

- A map-only route can play, pause, scrub, and seek.
- The route cursor uses the same map layer and default visual style as video
  routes.
- Existing video routes are unaffected.

## Phase 4: Template Integration

### Scope

Wire the new component into the existing route-story template.

### Tasks

- [ ] Add a static export on `FeaturedRoute`.
  - Example:

    ```js
    FeaturedRoute.MapPlayback = RouteMapPlayback;
    ```

- [ ] Update `FeaturedVideoRoute.jsx`.
  - For `media="map"`, render `FeaturedRoute.MapPlayback` instead of direct
    `FeaturedRoute.Map`.
  - Preserve `fv-video-shell--map` and layout classes unless visual testing
    shows they need adjustment.

- [ ] Update primary route action for `media="map"`.
  - Change label/icon from "center map" to "play route" once playback refs are
    available.
  - Use `playerPlayRef.current?.()`.
  - Keep route-fit behavior available through map load/resume and existing map
    affordances.

- [ ] Confirm click paths still work.
  - Marker click seeks map playback.
  - Warning card click seeks map playback.
  - POI story click seeks map playback.
  - Route click seeks map playback.

- [ ] Consider naming cleanup only after behavior is green.
  - If the code becomes confusing, add aliases in context:
    - `routeCursor` aliasing `videoCursor`
    - `routePlaying` aliasing `videoPlaying`
    - `seekRoutePlaybackToFraction` aliasing `seekVideoToFraction`
  - Avoid a broad rename in the same pass unless tests make it low risk.

### Acceptance Criteria

- `/routes/<slug>` pages without videos render a playable map stage.
- `/routes/sovev-dafna` still renders the real YouTube player.
- The route page layout does not shift or overlap on desktop/mobile.

## Phase 5: Tests And Visual Verification

### Unit Tests

- [ ] Add new helper tests to `npm test`.
  - `tests/test-route-playback-duration.mjs`
  - `tests/test-route-playback-sync.mjs`

- [ ] Update existing POI/cue tests only if helper behavior changes.
  - `tests/test-poi-types.mjs`

### E2E Tests

- [ ] Extend `tests/e2e/routes-index.spec.mjs` or add a focused spec.

- [ ] Map-only route playback test:
  - Navigate to `/routes/historic-jordan`.
  - Assert map-stage playback controls are visible.
  - Assert primary action says "נגן מסלול" or equivalent.
  - Press play.
  - Assert playback state changes and a route cursor is rendered.
  - Wait briefly and assert progress/time advances.
  - Pause and assert progress stops advancing.

- [ ] Scrub test:
  - Drag or set the scrubber to the middle.
  - Assert `RouteProgressDistance` updates to a non-zero route distance.
  - Assert the cue preview reflects the nearest route cue when near one.

- [ ] Map visual anchors test:
  - Assert readonly endpoint markers render.
  - Assert the expand button does not overlap the cue preview.

- [ ] POI/warning seek test:
  - Click a POI story or warning card.
  - Assert the cursor/focused card updates.
  - Assert playback pauses.

- [ ] Video regression test:
  - `/routes/sovev-dafna` still requests video data.
  - It still shows the YouTube frame and existing controls.
  - It still shows warning cues/list behavior.

- [ ] Featured elevation graph:
  - Assert hover/playback renders the `progress-head-pulse` marker on the
    elevation curve instead of the legacy blue vertical line.

### Visual / Browser Verification

- [ ] Desktop browser sanity check:
  - `/routes/historic-jordan`
  - `/routes/kovshey-hagolan`
  - `/routes/sovev-dafna`

- [ ] Mobile viewport sanity check:
  - No control overlap.
  - Cue preview remains compact.
  - Scrubber text fits.
  - Expanded map still works.

### Commands

- [ ] `node --check src/components/featured/RouteMapPlayback.jsx`
- [ ] `node tests/test-route-playback-duration.mjs`
- [ ] `node tests/test-route-playback-sync.mjs`
- [ ] `npm test`
- [ ] `npm run test:smoke -- tests/e2e/routes-index.spec.mjs --project=desktop`
- [ ] `npm run build`

### Acceptance Criteria

- All relevant unit, E2E, and build checks pass.
- Browser sanity checks show non-video routes playing with cursor/cues.
- Video route behavior remains unchanged.

## Phase 6: Optional Follow-Up Cleanup

These are explicitly not required for the first implementation.

- [ ] Rename shared context concepts from video-specific names to route
  playback names.
  - `videoCursor` -> `routeCursor`
  - `videoPlaying` -> `routePlaying`
  - `VideoEmbed` keeps video-specific internals, but map and POI components
    consume route-oriented names.

- [ ] Rename `RoutePoiVideoPreview` to `RouteCuePreview`.
  - Keep a compatibility export during migration if useful.

- [ ] Add optional per-route catalog override:

  ```json
{
  "mapPlaybackDurationSeconds": 70
}
```

- [ ] Further tune the map-specific cue threshold, or add dwell behavior, if
  real-route testing still shows cue cards are too fleeting.

## Risk Notes

- The current context uses video-specific names. Reusing it is pragmatic, but
  future readers may find the names misleading. Keep comments clear and avoid
  spreading the terminology further than needed.
- Registering `playerPlayRef` / `playerPauseRef` from both `VideoEmbed` and
  `RouteMapPlayback` is safe only because the route template mounts one stage
  type at a time. Cleanup must guard against clearing refs owned by another
  mounted component.
- The synthetic sync adapter must match enough of `createVideoSync(...)` for
  existing click-to-seek paths; missing `snapClickToRoute` will break route
  clicks on map-only playback.
- The route cursor should not constantly re-fit the map while playing. Repeated
  fit calls would make playback feel jumpy and fight user interaction.
