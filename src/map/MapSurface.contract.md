# MapSurface contract

`MapSurface` is the platform-agnostic, end-user map component. Everything it
exposes is expressed in **geographic / domain terms** (lng/lat, segment names,
indices) — never pixels or DOM events. The pixel math and Mapbox-GL plumbing
live *inside* the web implementation (`MapSurface.jsx` + `mapInteractions.js` +
`mapLayers.product.js`). `App.jsx` drives the map only through these props and
callbacks; it never touches Mapbox directly.

A future React Native app is expected to provide its own `MapSurface`
implementation honoring **this same contract**, backed by `@rnmapbox/maps`. Only
the input mechanism differs; the data in / geographic callbacks out stay
identical.

> Source of truth for intent: `plans/map-surface-abstraction/design.md`.

## Inputs — mode (which capabilities to install)

| Prop | Type | Meaning |
|---|---|---|
| `mode` | `"planner"` \| `"readonly-route"` | which capability set the surface installs. Defaults to `"planner"`. |

`mode` is translated into an explicit set of capability booleans by the pure,
unit-tested helper `capabilitiesForMode(mode)` in `mapCapabilities.js`. Every
gated behavior below is keyed on a named capability rather than on `mode`
directly, so the mapping lives in one auditable place.

- **`planner`** (default): planner capabilities are enabled and public-only
  endpoint markers are disabled. This is the zero-diff path — behavior at `/`
  is unchanged.
- **`readonly-route`** (public featured pages): ENABLES map init, base style,
  route geometry layer, readonly endpoint markers, route fit, focused-marker
  camera, data-marker layer + click callback, video cursor layer, and the route
  click (video-sync) callback.
  DISABLES the CW network source/layers, network hover/click snapping, the
  hover-preview marker, route-point layers, route-point dragging, route-line
  insert/drag, route-point removal/select, and viewport prefetch
  (`onUserViewportChange` / `onViewportIdle`).

Capabilities are still additionally gated on prop presence where that already
existed (e.g. network layers require `geoJsonData`; route click requires
`onRouteClick`). `mode` narrows what is installed; it does not force a behavior
on when its driving prop is absent.

## Inputs — data (what to render)

| Prop | Type | Meaning |
|---|---|---|
| `geoJsonData` | FeatureCollection | the cycleway network to render + make interactive |
| `routeGeometry` | `[{lng,lat,elevation?}]` | the computed route line |
| `routePoints` | waypoint[] | user-placed waypoints |
| `routePointDragPreview` | preview \| null | transient drag ghost while dragging a point/line |
| `dataMarkerFeatures` | feature[] | POIs / data markers |
| `activeDataPointIds` | id[] | which data markers are currently "active" |

## Inputs — view state (how it looks right now)

| Prop | Meaning |
|---|---|
| `focusedSegment` | segment name to render in the focused style |
| `hoveredSegment` | segment name to render in the hover style |
| `focusedMarker` | a marker to fly to / emphasize |
| `selectedRoutePointIndex` | index of the selected waypoint |
| `elevationHover` | elevation-profile cursor payload that drives the on-map pulse |
| `searchHighlight` | a searched location to highlight |
| `networkPresentationVariant` | route-network visual experiment; accepts `current`, `typed-bold`, `typed-cased`, `build-focus`, or `single-blue`; defaults to `current` |
| `networkColorScheme` | route-network color-scheme override; accepts `auto` or a named scheme; defaults to `auto` |
| `networkBaseMapProfile` | base-map profile for adaptive network colors; defaults to `mapbox-outdoors` |
| `routeBuilding` | whether the planner is actively building/editing; used by `build-focus` network presentation |
| `routeGeometryPresentation` | built-route visual style; accepts `current`, `cased`, `bright-blue`, `orange`, `dark`, or `magenta`; defaults to `current` |
| `videoCursor` | featured-route video playback cursor position on the route |
| `videoCursorVariant` | featured-route cursor style; accepts options `1`-`6` or named variants; defaults to `progress-head-pulse` |
| `videoPlaying` | whether featured-route video playback is active; used for cursor animation |
| `animator` | the route-direction pulse driver (ticks progress along the route) |

Web accepts shareable query-param overrides for the presentation props:

- `networkStyle=current|typed-bold|typed-cased|build-focus|single-blue`
- `routeStyle=current|cased|bright-blue|orange|dark|magenta`
- `networkScheme=auto|current-muted|outdoors-balanced|topo-high-contrast|gray-map-saturated|aerial-bright`
- `baseMapProfile=mapbox-outdoors|topo|gray|aerial`

The longer internal names (`routeNetworkPresentation`,
`routeGeometryPresentation`, `routeNetworkColorScheme`,
`routeNetworkBaseMapProfile`) are also accepted. Query params take precedence
over `window.CYCLEWAYS_FEATURE_FLAGS`.

## Inputs — commands (imperative intent as a changing prop)

| Prop | Meaning |
|---|---|
| `routeFitRequest` | a token object; when its identity changes, the surface fits the viewport to the route. The "command-as-prop" pattern is portable (RN does the same with a changing prop). |
| `orientRequest` | a counter token; when it increments, the surface orients to the nearby network by keeping the current center and stepping the zoom out one level (see `buildOrientCamera.js`). Used when entering Build from Discover with an empty planner. `0` is the idle value. |

## Outputs — callbacks (all in geographic terms)

| Callback | Payload |
|---|---|
| `onMapClick` | `{ lng, lat }` (snapped to the network when near it) |
| `onSegmentFocus` | `segmentName` |
| `onRoutePointSelect` | `index` |
| `onRoutePointRemove` | `index` |
| `onRoutePointDragStart` / `onRoutePointDrag` / `onRoutePointDragEnd` | drag payloads in lng/lat |
| `onRouteLineDragStart` / `onRouteLineDrag` / `onRouteLineDragEnd` | drag payloads in lng/lat |
| `onDataMarkerClick` | marker id |
| `onViewportIdle` | viewport bounds, after the map settles |
| `onRouteClick` | optional click on the computed route line |

## Fenced as desktop/web-only (optional — NOT part of the portable core)

- **Hover** — `onSegmentHover` plus the ghost "hover-preview" point that trails
  the cursor along the network. There is no hover on touch; on React Native
  these simply do not fire. Treat as optional.
- **`onMapReady(map)`** — hands out the raw Mapbox-GL `Map` instance as a
  **web-only escape hatch** for diagnostics and tests. It is **not** part of the
  portable surface; an RN `MapSurface` will not expose a GL map.

## Interaction mechanics — documented for RN, implemented per-platform

Each platform consumes raw pointer/gesture input and **emits a geographic
result**; the contract boundary is drawn at that emit point.

| Concern | Web (this implementation) | React Native (later) |
|---|---|---|
| snapping / hit-test | `map.project` + `distanceToLineSegmentPixels` (in `mapInteractions.js`) | `@rnmapbox/maps` `queryRenderedFeaturesAtPoint` + the same `distanceToLineSegmentPixels` math |
| point/line drag | mouse/touch events reading `event.lngLat` | RN gesture handler reading `getCoordinateFromView()` |
| output | `{ lng, lat }` / `segmentName` | identical |

The pure geometry (`distanceToLineSegmentPixels`, `getClosestPointOnLineSegment`,
`buildNetworkSegments`, click-stamp helpers) already lives in
`mapInteractions.js` / `utils/distance.js` and is shared across platforms.
