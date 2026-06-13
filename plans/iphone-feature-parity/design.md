# iPhone Feature Parity Design

Date: 2026-06-13

## Purpose

Bring the installed iPhone app to product parity with the current mobile web
planner. The goal is not to make the native app a separate simplified product.
It should have the same two primary surfaces:

- Discover: browse, filter, preview, open, and consume recommended routes.
- Build: plan/edit a custom route, inspect elevation and POIs, play the route,
  and export/share it.

The iPhone app should keep its native Mapbox renderer and React Native UI. Web
DOM components should not be imported into the app, but the data shaping,
selection semantics, route playback math, catalog filtering, and POI/elevation
view models should move into shared code wherever practical.

## Current Baseline

### Mobile Web

The mobile web app now uses a full-screen map with a snap bottom sheet:

- `BottomSheet` supports peek, half, and full states.
- `DiscoverPanel` has recents, place filters, difficulty/surface/distance
  filters, near-me sort, scroll viewport tracking, and route cards.
- `DiscoverPeekPreview` shows tappable recommended route chips in the collapsed
  sheet.
- Discover cards draw recommended route overlays on the map. Visible routes are
  bright; nearby routes can be ghosted; colors are stable through
  `discoverRouteColor`.
- Selecting a route loads it client-side through `handleLoadRouteParam`, pushes
  a route URL entry, records recents including `slug`, and switches to Build.
- Build tracks the selected catalog route until the user edits it, then clears
  that identity.
- `BuildPanel` has route stats, GPX/share/send-to-phone actions, route-page CTA,
  elevation graph, route playback controls, POI list, POI cue preview, and
  overlay-aware map fit.

### iPhone App

The native app has more than a scaffold, but the surface is still sparse:

- Uses shared `useCyclewaysApp` for routing, search, route state, recents, and
  data markers.
- Renders the CycleWays network, route geometry, route points, warnings/POIs,
  current location, elevation scrub marker, and direction pulse with RNMapbox.
- Supports search, tap-to-add, waypoint drag, undo/redo, route clear, locate,
  route summary, GPX, native share, warning chips, and data-marker add-to-route.
- Loads bundled catalog, places, featured-route snapshots, route images, POI
  images, map data, and routing shards.
- Has a first-pass native Discover sheet with recents, featured routes,
  filters, route cards, image thumbnails, route detail modal, and open-in-map.
- Has a no-Metro Release build path through `mobile:ios:offline`.

## Parity Gap

### Discovery Surface

| Capability | Mobile Web | iPhone App | Gap |
| --- | --- | --- | --- |
| Sheet model | Peek/half/full snap sheet with dedicated peek content | Fixed bottom sheet plus collapse toggle | Missing native snap sheet and peek UX |
| Mode switch | Peek tabs: Discover/Build | Small top rail button toggles Find/Build | Partial, not discoverable enough |
| Catalog data | Shared catalog and places | Shared catalog and places | Done |
| Recents | Strip with slug-preserving reload | Horizontal chips with slug-preserving reload | Partial, less prominent |
| Place filters | Autocomplete add/remove chips | Horizontal first 8/10 place chips | Partial, does not scale |
| Difficulty/surface/distance filters | Shared filter semantics | Shared filter semantics | Done |
| Near-me sorting | Uses location fix and shared near-me helpers | Not wired into Discover | Missing |
| Featured/recommended | Recommended route cards and peek route chips | Featured section plus all-route cards | Partial, no peek chips |
| Route card CTA | Card opens route; visible route-page link | Open-in-map and native details buttons | Partial, native detail exists but not tied to playback |
| Map overlays | Discover routes drawn on map, viewport synced | No recommended route overlays | Missing |
| Scroll-to-map sync | List viewport drives bright/ghost/prefetch | None | Missing |
| Route selection | Loads route, switches Build, records slug | Loads route, switches Build, records slug | Done |

### Build Surface

| Capability | Mobile Web | iPhone App | Gap |
| --- | --- | --- | --- |
| Build shell | Bottom-sheet Build panel with peek row | Fixed compact sheet | Missing snap/full panel structure |
| Selected route identity | Shows route name and route-page CTA until edit | Shows route name and Details chip until edit | Partial, no playback/story handoff |
| Stats | Distance, climb, descent cards | Text summary plus route summary modal | Partial |
| Elevation | Interactive `PanelElevationGraph`, bands, cursor, playback sync | Native `ElevationProfileChart` with scrub marker | Partial |
| Route playback | Synthetic playback controls on map and panel | No route playback controls | Missing |
| POI cue preview | Playback cue preview on map | No playback POI preview | Missing |
| POI list | Build panel lists active POIs with distances | No Build POI list; only map-tap marker card | Missing |
| Warning/data marker focus | Warning chips and POI cards focus map | Warning chips and data marker card | Partial |
| Add POI to route | From marker cards | From marker cards | Done |
| Waypoint editing | Add, drag, remove, route-line insertion | Add and drag; no visible remove or route-line insert | Partial |
| Share/export | GPX, share, send-to-phone | GPX and native share; no send-to-phone | Partial |
| Overlay-aware fit | Measures sheet/search/play controls | Basic route fit | Partial |

### Route Detail and Playback

| Capability | Mobile Web | iPhone App | Gap |
| --- | --- | --- | --- |
| Route detail page | `/routes/:slug`, editorial route content | Native modal with image, summary, stats, POIs | Partial |
| Route playback in detail | Web route pages and planner playback controls | No native route playback surface | Missing |
| POI story richness | Web story pages for rich routes | Structured POI text only | Expected gap; native should use structured data |
| Offline detail assets | Web loads public assets | Native bundles snapshots/images | Done for current catalog |

## Reuse Strategy

Do not try to reuse web JSX in React Native. Reuse the model, not the view.

Move these reusable pieces toward `@cycleways/core`:

- Discovery model:
  - filter state normalization;
  - place option derivation;
  - route sorting, featured/promoted grouping, near-me ranking;
  - card view-model creation, including image, stats, places, and color index;
  - recommended route overlay view-model from loaded snapshots.
- Build model:
  - route stats view model;
  - active POI list ordered by route progress, with distance labels;
  - selected catalog route identity rules;
  - route-edit actions that clear selected catalog identity.
- Playback model:
  - move the synthetic route playback controller/math out of web-only
    `src/components/routePlayback`;
  - expose a platform-neutral controller API for play/pause/scrub/cursor;
  - keep web and native renderers separate for controls and charts.
- Sheet model:
  - keep snap math shared where possible;
  - native uses `Animated`/gesture handling rather than DOM `BottomSheet`.

The native code should then become a composition of native renderers:

- `NativeBottomSheet`
- `NativeDiscoverSurface`
- `NativeBuildSurface`
- `NativeRouteCard`
- `NativeRoutePlaybackControls`
- `NativePoiList`
- `NativeRouteDetail`

## Target Native UX

### First Screen

The app opens to the map with a native bottom sheet in `peek` state. The peek
area has two tabs:

- חפש מסלול
- בניית מסלול

When Discover is active, peek shows recommended route chips, matching mobile
web. Tapping the sheet opens it to half/full. Tapping a route chip loads the
route and switches to Build.

### Discover

Discover should feel like a route browser, not a hidden tool:

- recents at the top;
- near-me toggle when location is available;
- place filter search for start and through-place;
- difficulty, surface, distance filters;
- route cards with thumbnails, stable color swatches, stats, nearby places,
  open-in-map, and details;
- recommended route overlays on the native map while browsing;
- selected visible/nearby route overlays should use the same color model as web.

### Build

Build should be useful after either a catalog route selection or manual route
creation:

- route name or "new route" header;
- route stats;
- GPX/share actions;
- selected-route Details CTA while unedited;
- interactive elevation graph;
- route playback controls;
- POI list with distances along route;
- warning/data marker affordances;
- visible waypoint remove action and eventually route-line insertion.

### Route Detail

Native route detail should stay structured:

- hero/route-map image;
- summary and rich text description;
- stats from route snapshot;
- POIs from active data points;
- open in planner;
- later: play route in detail using the same native playback controller.

## Decisions

- Native route story rendering uses structured catalog/snapshot data, not web
  route-page JSX.
- Discovery and Build parity should be implemented through shared core
  view-models before expanding native UI further.
- The first high-value native work is a real snap bottom sheet plus route
  playback/POI list, because those make loaded routes useful outdoors.
- Mapbox offline tile packs remain out of scope. Bundled CycleWays data and JS
  independence are already the offline target for this phase.

## Risks

- `MapScreen.jsx` is already too large. Continuing to add UI there will slow
  iteration and make parity harder to reason about.
- Native route playback can diverge if it reimplements the web playback math
  instead of sharing the controller.
- Discovery overlay loading can cause jank if every snapshot loads at once.
  Match web's lazy/prefetch approach.
- App size will grow if full POI images are used in list surfaces. Use
  thumbnails in Discover and reserve full images for detail.
