# Navigation Story Inspector — Implementation Plan

Date: 2026-07-24  
Status: ready for implementation

## Goal

Implement a local-development-only website inspector that prepares the current
route exactly as native navigation does, projects its shared visual and voice
story into an ordered list, and places matching numbered annotations on the
website map. Keep all narration decisions in `@cycleways/core`, preserve the
existing route itinerary, and prove that the debug renderer is absent from a
normal production build.

## Architecture

The work is split into four boundaries:

1. **Shared cue presentation:** expose pure per-cue visual and voice
   presentation APIs while retaining current mobile behavior.
2. **Shared route story:** build stable, renderer-neutral rows and an idealized
   clean-run narration timeline from a fully prepared `NavigationRoute`.
3. **Web preparation and renderer:** prepare route-local topology on demand,
   render the list, and own a namespaced Mapbox debug layer.
4. **Production gate and validation:** lazy-load only in development and assert
   that production artifacts contain no inspector entry point or sentinel.

No new runtime dependency is required.

## Global constraints

- Do not duplicate rider-facing Hebrew strings in web components or story
  builders.
- `@cycleways/core` remains platform-neutral ESM with no DOM, Mapbox, Node
  filesystem, or React Native imports.
- Opening the inspector must not mutate `routeState`, route history, route
  encoding, or selected planner waypoints.
- Use `computeRouteJunctions` and `computeRouteCrossings` from the existing
  controller; do not create a second topology loader in the component.
- Preserve `navigationPresentation.js` and `navigationVoice.js` behavior for
  the native app through delegation tests.
- Keep debug layer IDs namespaced and clean up every source, layer, image, and
  event handler the inspector adds.
- Do not add debug-specific props to the public `MapSurface` contract when the
  existing `onMapReady` escape hatch is sufficient.
- The normal production build must not expose the inspector through a query
  parameter, local-storage flag, or public feature flag.
- Do not modify generated files under `public-data/` or mobile bundled assets.
- Preserve unrelated existing worktree changes.

## Phase 1 — Pure shared cue presentation

### Task 1: Export a cue-level visual presentation API

**Files**

- Modify: `packages/core/src/navigation/navigationPresentation.js`
- Modify: `tests/test-navigation-presentation.mjs`

**Work**

- Extract the cue-dependent portion of `getNavigationPresentation()` into an
  exported pure helper, provisionally:

  ```js
  getNavigationCuePresentation({
    cue,
    phase,
    distanceToCueMeters,
    progress,
  }) -> {
    primaryText,
    nextText,
    secondaryText,
    text,
    icon,
    maneuver,
    nextManeuver,
    distanceText,
  }
  ```

- Preserve arrival-preview wording and compound primary/next/secondary
  splitting.
- Make `getNavigationPresentation()` call this helper rather than retaining a
  parallel internal formatting path.
- Keep session-only decisions such as card mode, off-route precedence, chip,
  speed, and arrival summary in `getNavigationPresentation()`.

**Tests**

- For turn left/right, bend, crossing, roundabout, compound turn, named
  destination, stay-on-way, arrival preview, and arrival final:
  - direct cue presentation returns expected semantic/text fields;
  - embedding the same cue in a navigation session presentation returns the
    same fields.
- Existing navigation-presentation tests remain unchanged or are migrated
  without weakening assertions.

**Validation**

```bash
node tests/test-navigation-presentation.mjs
```

### Task 2: Export pure cue narration while preserving the voice planner

**Files**

- Modify: `packages/core/src/navigation/navigationVoice.js`
- Modify: `tests/test-navigation-voice.mjs`

**Work**

- Expose a pure formatter backed by the existing private phrase logic,
  provisionally:

  ```js
  getNavigationCueNarration({
    cue,
    phase,
    distanceToCueMeters,
    leg = "main",
    state = {},
    locale = "he-IL",
  }) -> string | null
  ```

- Keep acquisition, off-route, and wrong-way events available only through the
  general voice-event path; the route story must not manufacture them.
- Make `createNavigationVoicePlanner().plan()` use the exported/shared
  formatter for cue events, retaining:
  - utterance IDs;
  - deduplication;
  - compound-coverage suppression;
  - cooldown;
  - priority;
  - interruption behavior;
  - spoken-guidance memory.

**Tests**

- Pure preview/final text equals the planner's accepted utterance text when no
  planner policy suppresses it.
- Bend and unsupported cue types remain silent.
- Arrival preview/final, named way, crossing, roundabout, and compound phrases
  remain byte-for-byte consistent.
- Existing suppression and cooldown tests still exercise the stateful planner.

**Validation**

```bash
node tests/test-navigation-voice.mjs
```

### Task 3: Export scheduling-window metadata

**Files**

- Modify: `packages/core/src/navigation/navigationCues.js`
- Modify: `tests/test-navigation-cues.mjs`

**Work**

- Expose scheduling thresholds through either named constants and a helper or
  one frozen public object. The API must distinguish ordinary preview, arrival
  preview, cross-feature behavior, and final distance.
- Make `selectActiveCue()` use the same exported values/helper so the story
  builder never duplicates `120`, `200`, or `35`.
- Do not change current selection priority or timing.

**Tests**

- Existing boundary assertions remain.
- The exported metadata agrees with `selectActiveCue()` at just outside, at,
  and inside every boundary.

**Validation**

```bash
node tests/test-navigation-cues.mjs
```

## Phase 2 — Shared route navigation story

### Task 4: Add route-distance interpolation

**Files**

- Create: `packages/core/src/navigation/routeNavigationStory.js`
- Create: `tests/test-route-navigation-story.mjs`
- Modify: `package.json`

**Work**

- Implement a private or exported `pointAtNavigationDistance` helper that:
  - consumes navigation geometry carrying `distanceFromStartMeters`;
  - clamps before start/after end;
  - binary-searches the enclosing geometry leg;
  - interpolates latitude, longitude, and elevation when available;
  - handles duplicate/zero-length distance legs deterministically;
  - never recomputes a different cumulative route-distance frame.

**Tests**

- Exact vertex, between vertices, clamped start/end, zero-length leg, elevation
  interpolation, and invalid geometry.

**Validation**

```bash
node tests/test-route-navigation-story.mjs
```

Add the new test to the root `test` chain near the existing navigation cue,
presentation, and voice tests.

### Task 5: Build stable story rows

**Files**

- Modify: `packages/core/src/navigation/routeNavigationStory.js`
- Modify: `tests/test-route-navigation-story.mjs`

**Work**

- Implement `buildRouteNavigationStory(navigationRoute, options)`.
- Call `buildRouteCues()` exactly once with the supplied crossing preference.
- Project every cue into a stable row containing:
  - ID and ordinal;
  - raw cue;
  - route distance and completion/exit distance;
  - maneuver and completion coordinates;
  - preview/final cue-level visual presentation;
  - preview/final available narration;
  - scheduling windows;
  - compound predecessor/follow-up relation.
- Derive stable IDs from semantic cue key + rounded route distance +
  same-key occurrence counter. Do not depend solely on list index.
- Record story metadata:
  - schema/story version;
  - route ID;
  - navigation availability/failure;
  - cue-generator version;
  - guidance mode and naming policy;
  - junction and crossing coverage.
- Return a structured unavailable result for non-navigable or invalid routes
  rather than throwing for expected route states.

**Tests**

- Sorted rows and sequential ordinals.
- Deterministic output for the same route.
- Same-distance cues receive distinct stable IDs.
- Turn, bend, roundabout, crossing, cross-feature, start, and arrival.
- Entry-to-exit completion coordinate for roundabout/crossing.
- Named and `class-only` guidance.
- `intersectionCrossingGuidanceEnabled: false`.
- Broken, empty, and unattested routes.

### Task 6: Build the idealized clean-run narration timeline

**Files**

- Modify: `packages/core/src/navigation/routeNavigationStory.js`
- Modify: `tests/test-route-navigation-story.mjs`

**Work**

- Derive route-progress sample points from exported cue scheduling boundaries.
- Walk samples in monotonic route order and use `selectActiveCue()` to observe
  actual preview/final transitions.
- Feed transitions to a real `createNavigationVoicePlanner()` using timestamps
  derived from `nominalSpeedMps` (default 5 m/s).
- Associate every planned/suppressed result with its story row and phase.
- Preserve both:
  - the available pure phrase for that cue/phase;
  - clean-run outcome (`spoken`, `silent`, `compound-covered`, `cooldown`,
    or other planner reason).
- Do not generate an acquisition/start voice event.
- Document the timeline as idealized: frequent fixes, main route, no runtime
  alerts, constant nominal speed.

**Tests**

- An isolated turn yields preview then final narration.
- Arrival uses its larger preview window.
- Bend remains visually present and voice-silent.
- A compound follow-up is marked covered only after the preceding compound
  utterance is accepted.
- A cue is not marked covered if the preceding phrase was not accepted.
- Dense/same-distance cues are deterministic.
- Changing nominal speed affects cooldown outcomes only where appropriate, not
  row semantics.

### Task 7: Protect mobile parity

**Files**

- Modify: `tests/test-navigation-presentation.mjs`
- Modify: `tests/test-navigation-voice.mjs`
- Modify: `tests/test-route-navigation-story.mjs`

**Work**

- Add cross-module assertions using the same cue object:
  - story visual fields equal cue-level presentation;
  - session presentation delegates to the same cue-level fields;
  - story available narration equals pure voice narration;
  - accepted voice-planner utterance equals the same narration.
- Use synthetic fixtures for exact expectations and at least one prepared real
  navigation route snapshot for integration coverage.
- Avoid golden-copying an entire large story. Assert invariants and a few
  representative cues so intended map-data changes do not cause noisy churn.

**Validation**

```bash
node tests/test-navigation-cues.mjs
node tests/test-navigation-presentation.mjs
node tests/test-navigation-voice.mjs
node tests/test-route-navigation-story.mjs
```

## Phase 3 — Development-only web preparation

### Task 8: Enable topology assets only for the development inspector

**Files**

- Modify: `src/App.jsx`
- Modify or create test near: `tests/test-map-assets.mjs`

**Work**

- Introduce one compile-time constant based on `import.meta.env.DEV`.
- When true, call `useCyclewaysApp` with:
  - `includeRoundabouts: true`;
  - `includeCrossings: true`;
  - `includeNetworkJunctions: true`.
- Preserve the current non-debug production options and asset requests.
- Continue to obtain `computeRouteJunctions` and `computeRouteCrossings` from
  the controller return value.

**Tests**

- Asset option behavior remains deterministic.
- A normal production configuration does not request inspector-only
  roundabout/crossing assets through this path.

### Task 9: Add the prepared-story hook

**Files**

- Create:
  `src/components/dev/navigationStory/usePreparedNavigationStory.js`
- Create: `tests/test-navigation-story-preparation.mjs` or extract its pure
  state/key helpers into a testable `.js` module.

**Work**

- Convert the current route with `navigationRouteFromRouteState`, preserving:
  - share token/format;
  - catalog/built source;
  - route name/slug;
  - map version and segment hash;
  - guidance policy.
- Prepare topology concurrently:

  ```js
  Promise.all([
    computeRouteJunctions(navigationRoute.geometry),
    computeRouteCrossings(navigationRoute),
  ])
  ```

- Attach successful arrays to a local route copy and call
  `buildRouteNavigationStory`.
- Use the default normalized ride-guidance preference for crossing guidance.
- Model states: `idle`, `loading`, `ready`, `fallback`, `unavailable`, `error`.
- Use an explicit route revision key based on all story-affecting inputs:
  geometry reference/version, guidance spans/mode/policy, routing validation,
  direction/start selection, and crossing preference.
- Cancel or ignore stale promises on route edit, close, or unmount.
- Cache a completed story for the same revision during the component lifetime.
- Treat missing junction data as fallback, not ready parity.

**Tests**

- Ready path attaches junctions and crossings before building.
- Fallback when junctions are unavailable.
- Crossing preference reaches the story builder.
- An older slow promise cannot overwrite a newer route's story.
- Closing/unmounting prevents state updates.
- Reopening the unchanged route reuses the cached result.

## Phase 4 — Inspector panel

### Task 10: Add a generic Build-panel tools slot

**Files**

- Modify: `src/components/frontPanel/BuildPanel.jsx`
- Modify: `src/App.jsx`
- Add/modify a focused component or source test if available.

**Work**

- Add a generic optional React slot such as `supplementaryTools`.
- Render it only when a route exists, in a visually secondary tools/debug area.
- Do not put inspector copy, environment checks, or navigation-story logic in
  `BuildPanel`.
- Keep ordinary Build layout unchanged when the slot is null.

**Validation**

- Empty route: no slot.
- Route present and slot null: no layout gap.
- Existing undo/redo/clear, itinerary, elevation, sharing, and direction
  actions remain unchanged.

### Task 11: Build the debug host and launcher

**Files**

- Create:
  `src/components/dev/navigationStory/NavigationStoryDebugHost.jsx`
- Create:
  `src/components/dev/navigationStory/navigation-story-debug.css`
- Modify: `src/App.jsx`

**Work**

- Lazy-load the host inside an `import.meta.env.DEV` branch.
- Render its launcher through the generic Build-panel slot.
- Keep open/closed and selected-row state in the debug host or a small App-level
  bridge, whichever avoids remounting the map.
- When open, replace the Build-panel body with the story panel while keeping
  the normal panel shell and map mounted.
- Reset selection when route revision changes.
- Return to the unchanged Build view on close.
- Add a unique sentinel such as `data-navigation-story-debug` for E2E and
  production-exclusion checks.

**Validation**

- Launcher only appears for a valid route in development.
- Opening does not rebuild/unmount Mapbox.
- Closing restores Build without losing the route.
- Editing/clearing the route closes or refreshes the inspector predictably.

### Task 12: Render the story panel

**Files**

- Create:
  `src/components/dev/navigationStory/NavigationStoryPanel.jsx`
- Modify:
  `src/components/dev/navigationStory/navigation-story-debug.css`

**Work**

- Render header metadata and preparation coverage.
- Render explicit loading, fallback, unavailable, and error states.
- Render an ordered RTL list with:
  - ordinal;
  - maneuver type/icon;
  - distance from start;
  - primary/next/secondary visual text;
  - preview/final voice phrases and outcome;
  - scheduling threshold;
  - expandable diagnostic details.
- Use a web maneuver-icon mapping that consumes the shared semantic maneuver
  descriptor. It may use existing `Icon` where adequate and small local SVGs
  for crossing/roundabout, but does not infer wording.
- Make row selection keyboard-accessible.
- Keep a ref map so map selection can scroll/focus the selected row.
- Format debug raw data safely without rendering untrusted HTML.

**Tests/validation**

- All panel states are readable.
- Silent and compound-covered voice phases are explicit.
- `class-only` story contains no proper/editor names.
- Fifty-row fixture remains usable and scroll selection works.
- RTL layout and keyboard focus are manually checked.

## Phase 5 — Mapbox annotations and selection

### Task 13: Capture the existing map instance for the debug host

**Files**

- Modify: `src/App.jsx`

**Work**

- Pass a stable `onMapReady` callback to `MapView`.
- Store the map instance in a ref and expose it to the debug host without
  putting it into shared core state.
- Ensure the callback does not change `MapSurface` initialization identity;
  rely on the existing stable wrapper in `MapView`.
- Clear the ref when the map is no longer valid if an unmount callback/path is
  needed.

**Validation**

- Opening/closing the inspector does not recreate the map.
- Existing map interactions remain registered once.

### Task 14: Add and own the navigation-story Mapbox layer

**Files**

- Create:
  `src/components/dev/navigationStory/NavigationStoryMapLayer.jsx`
- Create:
  `src/components/dev/navigationStory/navigationStoryMapModel.js`
- Create: `tests/test-navigation-story-map-model.mjs`
- Modify: `package.json`

**Work**

- Convert story rows with coordinates into a GeoJSON feature collection.
- Add namespaced debug sources/layers for:
  - badge circle;
  - badge number;
  - selected halo/emphasis;
  - optional selected completion-range highlight.
- Carry only serializable properties required by styling and selection.
- On source updates, update GeoJSON rather than removing/recreating all layers.
- Register layer click to select the row and stop the click from becoming a
  planner route edit.
- Change cursor over clickable badges.
- On close/unmount, remove handlers before layers and sources.
- Tolerate the map/style not being ready and style reloads.
- Keep selected badge visible and visually distinct; choose explicit collision
  behavior for unselected numbers and document it in code.

**Tests**

- Feature collection preserves row ID, ordinal, cue type, and coordinates.
- Invalid rows are omitted without renumbering remaining rows.
- Selected property changes only for the selected row.
- Completion highlight geometry uses the shared route range slicer and correct
  entry/exit meters.
- Layer/source cleanup order is testable through a fake map.

**Validation**

```bash
node tests/test-navigation-story-map-model.mjs
```

### Task 15: Synchronize list, badge, highlight, and camera

**Files**

- Modify:
  `src/components/dev/navigationStory/NavigationStoryDebugHost.jsx`
- Modify:
  `src/components/dev/navigationStory/NavigationStoryPanel.jsx`
- Modify:
  `src/components/dev/navigationStory/NavigationStoryMapLayer.jsx`

**Work**

- Keep one selected row ID as the source of truth.
- List selection:
  - updates badge/highlight;
  - scrolls only if necessary;
  - eases the map to the maneuver only if it is outside a safe padded viewport;
  - does not zoom out an already detailed view.
- Badge selection:
  - updates the row;
  - scrolls and focuses it without causing a route point/map click.
- Preserve whole-route framing on open; do not automatically jump to row 1.
- Clear the selected completion range on close or route revision.

**Manual validation**

- Select first/middle/last row from list and map.
- Select two nearly co-located cues.
- Crossings/roundabouts highlight entry-to-exit range.
- Close with a selection, reopen, edit route, and clear route.

## Phase 6 — Production exclusion and end-to-end verification

### Task 16: Add production-exclusion verification

**Files**

- Create: `scripts/check-navigation-story-production-exclusion.mjs`
- Modify: `package.json`
- Possibly modify: `vite.config.mjs` only if dead-code elimination needs an
  explicit production alias.

**Work**

- After a normal production build, scan emitted JS/CSS/manifest artifacts and
  fail if they contain:
  - the debug sentinel;
  - launcher copy;
  - the debug component/chunk name;
  - inspector-only CSS selectors.
- Verify there is no callable query/local-storage/global flag that can mount
  the host in the production build.
- Prefer ordinary Vite dead-code elimination. If Rollup still emits the dynamic
  chunk, add a production alias to a no-op entry rather than accepting shipped
  dormant tooling.
- Wire the check as a `postbuild` step or a clearly named production-exclusion
  script run by CI.

**Validation**

```bash
npm run build
node scripts/check-navigation-story-production-exclusion.mjs
```

Expected: build succeeds and no inspector artifact is present.

### Task 17: Add Playwright smoke coverage

**Files**

- Create or modify: `tests/e2e/navigation-story-inspector.spec.*`

**Work**

- In a development-server test:
  1. load or build a deterministic route;
  2. open Build;
  3. verify the launcher;
  4. open the inspector;
  5. wait for preparation;
  6. verify ordered rows and map badges;
  7. select a list row and observe selected map feature;
  8. select a map badge and observe selected/focused row;
  9. close and verify the normal Build panel and route remain.
- Add a route-edit refresh assertion if stable within existing E2E helpers.
- Do not make the test depend on external services beyond existing local
  assets/routing.

**Validation**

```bash
npx playwright test tests/e2e/navigation-story-inspector.spec.*
```

### Task 18: Real-route manual review

Use current generated data without modifying it:

1. **Sovev Beit Hillel** — short story, ordinary turns, list/map basics.
2. **Banias–Gan HaTzafon** — dense story, reviewed crossing, roundabouts,
   compound relationships.
3. **Roman Roads** or another route with bends — visually present but
   voice-silent behavior.
4. **Synthetic compound fixture** — predecessor/follow-up and clean-run
   suppression.
5. **Class-only/fallback fixture** — no proper names and prominent preparation
   warning.

For each:

- compare representative web rows with the native navigation presenter or
  scenario harness;
- verify marker placement at the physical maneuver;
- verify completion highlight where relevant;
- verify counts and preparation coverage;
- inspect browser console for Mapbox layer/source cleanup errors.

## Phase 7 — Documentation and handoff

### Task 19: Document usage and future boundary

**Files**

- Modify: developer-facing README appropriate to the website workflow, or add a
  concise usage section to this plan after implementation.
- Modify this design/plan status when complete.

**Work**

- Document:
  - run `npm run dev`;
  - create/load a route;
  - open Build → `סיפור ניווט (debug)`;
  - meaning of ready versus fallback preparation;
  - nominal clean-run voice assumptions;
  - production exclusion guarantee.
- Record that a remote QA version requires a separate internal build target,
  not a public runtime switch.
- Record that a public route summary must consume/filter the shared story model
  and must not import the debug renderer.

## Final acceptance criteria

- A valid route in local web development exposes the inspector launcher.
- The inspector shows an ordered rider-facing story with visual and voice
  information and matching numbered map locations.
- Junctions, roundabouts, and crossings are prepared through the same
  controller path as mobile before the parity-ready story is built.
- Web components contain no duplicated navigation narration copy.
- Visual fields and available voice phrases match the native shared
  presentation functions for the same cue.
- Compound and silent narration outcomes are visible and understandable.
- List and map selection remain synchronized and accessible.
- Route edits cannot apply stale preparation results.
- Opening/closing the inspector does not mutate the route or recreate the map.
- Existing planner itinerary, playback, elevation, sharing, and editing remain
  intact.
- Core, focused web tests, and Playwright smoke coverage pass.
- A normal production build contains no launcher, debug sentinel, inspector
  chunk, or inspector CSS.
- The shared story model has no DOM/Mapbox dependencies and can later feed a
  filtered public route summary.

