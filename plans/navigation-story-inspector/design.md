# Navigation Story Inspector — Design

Date: 2026-07-24  
Status: approved in discussion, pre-implementation

## Summary

Add a development-only website view that explains the expected navigation
story of the route currently open in the planner. The view pairs an ordered
list of rider-facing instructions with numbered locations on the map. It is a
debug and route-review tool first, but its shared semantic model is designed so
a filtered version can later support a public route summary.

The inspector must not implement a second navigation narrator. It prepares the
same `NavigationRoute` as the mobile app and delegates cue generation, visual
wording, and voice wording to `@cycleways/core`. The web-specific work is
limited to the side-panel renderer, Mapbox annotations, selection behavior,
loading/error states, and a compile-time development gate.

## Problem

The mobile app has a substantial shared navigation brain, but the website has
no direct way to review its output for a route. Reviewing a route currently
requires starting or simulating a ride and observing instructions in time. That
makes it unnecessarily difficult to answer basic route-review questions:

- Which turns, bends, crossings, roundabouts, and arrival cues will be
  generated?
- What exact text will the rider see and hear?
- Where on the route does each cue belong?
- Did a route-data or cue-generation change introduce too many, too few, or
  misleading maneuvers?
- Does the website's route understanding match what the application will use?

The website already shows a route itinerary, but the itinerary answers a
different question: which named roads, paths, and standalone features make up
the route. It does not expose the navigation decisions made along those ways.

## Goals

- Provide a button on the website's Build surface for opening a navigation
  story inspector when a valid route exists.
- Show a numbered, ordered list of navigation steps and matching numbered
  locations on the map.
- Use the mobile application's shared route preparation, cue generation,
  visual presentation, and voice presentation logic.
- Include enough diagnostics to review compound maneuvers, silent cues,
  route-data coverage, and cue-generator behavior.
- Keep the inspector and its renderer out of normal production builds.
- Build a shared, renderer-neutral story model that a future public route
  summary can filter or compose with the existing route itinerary.

## Non-goals for the first version

- Running a live navigation session on the website.
- Simulating arbitrary GPS noise, skipped fixes, off-route behavior, wrong-way
  warnings, approach routing, or rejoin routing.
- Reproducing the native ride camera or active-navigation screen on the web.
- Supporting reverse direction, custom join points, or mid-route starts in the
  first UI.
- Replacing the existing road/path itinerary.
- Publishing the navigation story on public route pages.
- Making debug annotations part of the general `MapSurface` contract.

## Product behavior

### Entry point

When a valid route exists, a development-only action appears in the Build
panel:

`סיפור ניווט (debug)`

Selecting it opens the inspector in the existing side-panel area, preserving
the current map. The inspector has a clear Back/Close action that returns to
the ordinary Build panel without modifying the route.

The first version is desktop-first because the purpose is route review and
testing. On the mobile website, the inspector may render in the existing
bottom-sheet body, but mobile polish is not a release criterion.

### Inspector header

The header shows:

- route name when available;
- total route length;
- total story-row count;
- preparation state: loading, complete, or fallback;
- cue generator version (`maneuverGeneratorVersion`);
- direction/start mode (`forward`, official start in v1);
- guidance naming policy (`named` or `class-only`);
- crossing-guidance preference;
- junction, roundabout, and crossing coverage counts.

The preparation state is not decorative. A story generated without prepared
junction data can intentionally fall back to geometry-only behavior, which may
classify ordinary corners as turns. The inspector must make that limitation
visible rather than silently presenting fallback output as application parity.

### Story list

The default list has one row per physical route cue, ordered by distance from
the route start. Rows include start and arrival for completeness; only
maneuver/action rows receive ordinary numeric map badges when an existing route
endpoint marker already communicates start or end clearly.

Each row contains:

- stable step number;
- maneuver icon/type;
- distance from route start;
- the exact primary, next, and secondary text used by the mobile navigation
  presentation;
- an expandable voice section with expected preview and final utterances;
- a clear indication when a phase is silent (`bend`, unsupported phrase) or
  conditionally suppressed because a preceding compound instruction covers it;
- optional diagnostic details: raw cue type/direction, angle, guidance
  identity, destination way, crossing/roundabout IDs, entry/completion meters,
  compound predecessor/follow-up, and narration-plan reason.

The main row remains rider-readable. Raw cue details live behind an explicit
debug disclosure and are not mixed into the principal instruction text.

### Map annotations

The map displays a numbered badge at the stable action point:

- turn/bend: the cue's route distance;
- roundabout: entry point;
- crossing: entry point;
- cross-feature: feature entry;
- arrival: route end if a separate numbered endpoint is useful.

For cues with duration, such as a crossing or roundabout, selecting the row
also highlights the route range from entry through completion/exit.

Selection is bidirectional:

- selecting a list row selects its map badge, emphasizes its route location,
  and moves the camera only when needed;
- selecting a map badge selects and scrolls the corresponding list row into
  view;
- the selected badge is visually distinct and rendered above unselected
  badges;
- opening or closing the inspector does not replace the user's route or
  permanently alter the normal route fit.

At an overview zoom, dense badges may overlap. Debug completeness takes
priority over cartographic decluttering: all steps remain in the list, selected
steps remain visible, and hidden/colliding map labels must not make a step
unreachable. The initial implementation may allow badge overlap or emphasize
only the selected badge at very dense locations; clustering is avoided because
it obscures exact maneuver identity.

### Maneuver point versus announcement point

The primary number is located at the maneuver, not at an assumed speech
trigger. Runtime cue selection uses distance windows (normally preview within
120 m and final within 35 m; arrival preview begins earlier), but the exact
spoken position depends on the GPS fixes received by the session.

The row shows those scheduling thresholds and expected preview/final wording.
A later debug toggle may display theoretical preview/final trigger points such
as `12a` and `12b`, but the first version must not imply that speech always
occurs at one exact coordinate.

## Shared architecture

```text
website routeState
  -> navigationRouteFromRouteState
  -> attach route-local junctions, roundabouts, and crossings
  -> buildRouteCues
  -> shared per-cue visual presentation
  -> shared clean-run voice planning
  -> RouteNavigationStory
       -> development-only web list
       -> development-only Mapbox annotations
       -> future filtered public route summary
```

### Route preparation parity

The mobile Build screen enables roundabout, crossing, and network-junction
assets and prepares route-local topology before confirming a ride. The web
inspector must do the same:

1. Convert current planner state with `navigationRouteFromRouteState`.
2. Resolve nearby network junctions with the controller's
   `computeRouteJunctions`.
3. Resolve reviewed route crossings with `computeRouteCrossings`.
4. Attach successful results to a local copy of the `NavigationRoute`.
5. Build cues with the same
   `intersectionCrossingGuidanceEnabled` preference as navigation.

Preparation is asynchronous and best-effort. A route edit invalidates the
in-flight result. The UI shows loading while topology is being computed and
must never apply results for an older geometry. If preparation fails, the
inspector may show the core's safe fallback story, but it must label it
`fallback` and expose the missing coverage.

The prepared junctions/crossings remain local to the inspector. Opening the
debug view does not mutate the saved planner route or its share encoding.

### Shared story model

Add a pure core module:

`packages/core/src/navigation/routeNavigationStory.js`

Proposed interface:

```js
buildRouteNavigationStory(navigationRoute, {
  intersectionCrossingGuidanceEnabled = true,
  locale = "he-IL",
  nominalSpeedMps = 5,
} = {}) -> {
  version,
  routeId,
  maneuverGeneratorVersion,
  preparation,
  rows,
  narrationTimeline,
  diagnostics,
}
```

Each row is renderer-neutral:

```js
{
  id,
  ordinal,
  cue,
  cueType,
  distanceMeters,
  completionDistanceMeters,
  location: { lat, lng },
  completionLocation: { lat, lng } | null,
  presentation: {
    preview,
    final,
  },
  voice: {
    preview: { text, status, reason },
    final: { text, status, reason },
  },
  triggerWindows,
  coveredByRowId,
}
```

Stable row IDs derive from cue semantics, rounded route distance, and an
occurrence ordinal. They must not depend on array index alone, but row numbers
may be reassigned when the route changes.

Locations are interpolated from the navigation geometry's
`distanceFromStartMeters` values. The story builder must not independently
recalculate a subtly different distance frame.

### Visual presentation reuse

`navigationPresentation.js` currently contains private per-cue formatting
inside the full session presentation. Extract or export a pure cue-level
presentation function, then make `getNavigationPresentation()` delegate to it.
The inspector calls the same function.

The shared result includes semantic maneuver descriptors and text fields; the
web renderer chooses web icons but does not rebuild Hebrew phrases or parse
complete sentences to recover primary/secondary text.

### Voice presentation reuse

Expose a pure cue-narration formatter from `navigationVoice.js`, backed by the
same phrase logic used by `createNavigationVoicePlanner()`. The stateful voice
planner continues to own deduplication, cooldown, priority, and compound
suppression.

The story builder creates an idealized clean-run narration timeline by walking
cue scheduling boundaries in route order, calling `selectActiveCue`, and
feeding resulting phase transitions into a real `createNavigationVoicePlanner`
at a documented nominal speed. This timeline answers, "What would normally be
spoken on a clean ride with sufficiently frequent fixes?" It is diagnostic,
not a promise about exact field timing.

Rows retain both their phase-specific available phrase and the clean-run
planner result. This makes conditional compound suppression reviewable without
losing the underlying phrase.

Start/acquisition wording is session-dependent. The route's start row may show
the static visual start label, but voice is labeled session-dependent rather
than inventing an acquisition event.

## Fixed route story versus live navigation

The static story can faithfully represent:

- start and arrival;
- turn/bend classification;
- roundabout and crossing actions;
- named-way transitions;
- compound maneuver relationships;
- visual cue text;
- phase-specific voice phrases;
- an idealized clean-run sequence.

It cannot determine without a ride/session:

- route approach or external-navigation handoff;
- off-route and rejoin guidance;
- wrong-way warnings;
- actual GPS sampling positions;
- skipped preview phases;
- cooldown interactions with unexpected runtime alerts;
- a rider-selected reverse direction or custom start until that choice is
  supplied.

The UI explicitly calls the result an expected route story and does not mix
session-dependent alerts into the fixed list.

## Web architecture

### Development-only host

Create the inspector UI under a clearly named web-only directory, for example:

```text
src/components/dev/navigationStory/
  NavigationStoryDebugHost.jsx
  NavigationStoryPanel.jsx
  NavigationStoryMapLayer.jsx
  usePreparedNavigationStory.js
  navigation-story-debug.css
```

The host owns open/closed state, async preparation, selected row, list scrolling,
and the Mapbox debug layer.

`BuildPanel` may receive a generic supplementary/internal-tools React slot so
it does not contain debug copy. The development module supplies the button
through that slot.

The existing `MapView`/`MapSurface` `onMapReady` callback provides the Mapbox
instance. `NavigationStoryMapLayer` adds namespaced sources/layers and owns all
event-handler and layer cleanup. This avoids adding debug-specific props or
capabilities to the general end-user `MapSurface` contract.

### Production exclusion

The initial release is local-development only:

- gate the host with `import.meta.env.DEV`;
- load it through a dynamic import inside the statically removable development
  branch;
- keep its CSS imported from the debug entry;
- do not enable it with query parameters, local storage, or public feature
  flags;
- verify a normal production build contains neither the debug sentinel/button
  copy nor a navigation-story debug chunk.

If remote QA later needs access, introduce a separate internal build flag and
deployment target. Do not convert the local debug gate into a public runtime
switch.

## Future route-summary use

The existing `buildRouteItinerary` remains the source for roads, paths, and
named feature spans. `RouteNavigationStory` remains the source for navigation
decisions. A future public route summary may compose both.

The public projection should be a separate filter/grouping function, not a
promotion of the debug component. It may:

- omit raw diagnostics and silent phases;
- group compound maneuvers;
- omit trivial bends or start;
- show only important crossings/roundabouts;
- combine decisions with the way used after each decision;
- render on route detail pages or in pre-ride review.

Keeping semantic models separate from renderers allows public presentation to
evolve without weakening debug completeness or duplicating navigation logic.

## Accessibility and localization

- The ordered list is the accessible source of truth; canvas/map badges are
  supplementary.
- Rows are buttons or contain explicit selection buttons with visible focus.
- Selection does not rely on hover.
- The active row is announced with `aria-current` or equivalent.
- Loading and preparation failure use status/alert semantics.
- The panel is RTL and consumes already-localized shared strings.
- Debug keys and raw JSON may remain LTR inside explicitly marked diagnostic
  blocks.
- Map badge color/selection has a non-color distinction.

## Error and edge cases

- No route or fewer than two geometry points: action disabled/absent.
- Broken or unattested route: inspector shows why navigation is unavailable;
  it does not generate a confident story.
- Route edit during preparation: cancel/ignore stale work and restart for the
  new route.
- Missing junction data: labeled geometry-only fallback.
- Missing crossing data: labeled crossing coverage unavailable.
- `class-only` guidance: never resurrect proper/editor names.
- Multiple cues at the same or nearly the same distance: deterministic ordering
  and separately selectable rows.
- Compound cues: show relation and clean-run suppression result.
- Bend: visible screen cue, normally silent voice.
- Roundabout/crossing range: entry marker plus completion highlight.
- Circular route seam: stable start/end and no wrapped negative marker
  distance.
- Long/dense routes: virtualizing the list is unnecessary initially, but
  selection and scrolling must remain reliable with at least 50 rows.
- Map style reload/unmount: sources, layers, and click handlers are safely
  re-established or cleaned up.

## Validation

Automated validation covers:

- shared story-model row ordering, stable IDs, interpolation, and completion
  ranges;
- exact delegation to shared visual and voice presentation;
- clean-run preview/final timeline and compound suppression;
- junction-aware turn versus bend behavior;
- roundabout and crossing rows;
- `class-only` naming;
- stale async preparation;
- list/map selection;
- Mapbox layer creation, update, click handling, and cleanup;
- route edits while the inspector is open;
- production-build exclusion.

Manual validation uses at least:

- a short route with few decisions;
- Banias–Gan HaTzafon or another dense route with a reviewed crossing and
  roundabouts;
- a route containing bends;
- a compound-maneuver fixture;
- a class-only/fallback story.

## Resolved decisions

- Main row content is the mobile visual instruction; voice preview/final is
  shown underneath.
- Main badges sit at action/maneuver locations, not theoretical speech trigger
  coordinates.
- V1 uses the official forward route.
- V1 covers fixed main-route cues only.
- The inspector is local-development-only and excluded from normal production
  builds.
- The shared story model is future-facing; the debug renderer is not.

