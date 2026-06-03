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
| `videoCursor` | featured-route video playback cursor position on the route |
| `animator` | the route-direction pulse driver (ticks progress along the route) |

## Inputs — commands (imperative intent as a changing prop)

| Prop | Meaning |
|---|---|
| `routeFitRequest` | a token object; when its identity changes, the surface fits the viewport to the route. The "command-as-prop" pattern is portable (RN does the same with a changing prop). |

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
