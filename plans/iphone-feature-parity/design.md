# iPhone Feature Parity Design

Date: 2026-06-11

## Purpose

Bring the iPhone application back into product parity with the current mobile
web experience without forking the product into two separate apps. The native
app should keep its React Native Mapbox renderer and shared `useCyclewaysApp`
controller, but it should expose the same route discovery, recommended route
content, route selection, and route consumption flows that now exist on mobile
web.

The second goal is to make installed iPhone builds usable away from the
development machine. Today the Debug iOS build expects a Metro/Expo server for
JavaScript; the app needs an explicit local-device build path that embeds the JS
bundle and bundled data assets.

## Current Surfaces

### Mobile Web

The root web app uses `useCyclewaysApp` as the shared planner/controller, then
adds a richer web shell around it:

- a `FrontPanel` with Discover and Build states;
- catalog loading from `public-data/route-catalog.json`;
- places loading from `data/places.json`;
- route filtering by start, through-place, difficulty, surface, and distance;
- near-me ordering when a location fix exists;
- recent route restoration;
- scroll-synced route discovery cards and map overlays;
- client-side recommended route selection through `handleLoadRouteParam`;
- route playback controls, POI cue preview, and elevation interaction;
- canonical `/routes` and `/routes/:slug` pages for all recommended routes;
- optional route story/video pages for richer route content.

### iPhone App

The iPhone app is no longer just a proof of concept. It already has a native map
planner backed by the shared controller:

- native Mapbox rendering for the CycleWays network, planned route, route
  points, warning/data markers, route direction pulse, and elevation scrub;
- search, tap-to-add route points, waypoint drag, undo, redo, reset;
- current-location follow/locate;
- warning legend and data-marker detail card;
- elevation profile chart in the native bottom sheet;
- route summary/share/GPX entry point;
- deep-link route restore through the native location adapter;
- offline bundled planner data: map manifest, network GeoJSON, segments,
  cw-base index, routing-shard manifest, and `.cwb` shards.

The native gaps are therefore concentrated in content and discovery:

- no native Discover state or catalog list;
- no featured/recommended route cards;
- no route-card filters or near-me ranking against the catalog;
- no scroll/list-to-map recommended route overlays;
- no route detail/story consumption screens;
- no bundled route catalog, places file, featured-route snapshots, or route-map
  images in the native asset sync;
- Debug builds still load JavaScript from Metro/Expo instead of embedding it.

## Product Direction

Use one product model with platform-specific renderers:

- `@cycleways/core` owns pure data loading, catalog helpers, route selection
  semantics, distance/label helpers, and view-model shaping.
- Web DOM components and React Native components remain separate renderers.
- The iPhone app should not import web JSX or CSS.
- The iPhone app should mirror the mobile web information architecture:
  Discover for route choice, Build for custom route planning, and Detail/Story
  for consuming an existing route.

The iPhone app may exceed mobile web only where the capability is genuinely
native: continuous GPS, heading camera, future navigation/recording, local
offline data, share sheets, and on-device storage.

## Target iPhone Information Architecture

### Main Map Screen

Keep the current full-screen native map as the home surface. Add a segmented
bottom sheet or tab state equivalent to the web `FrontPanel`:

- Discover: catalog list, filters, nearby sorting, recent routes, route cards.
- Build: current native planner sheet, stats, elevation, POIs, summary/share.

Selecting a route in Discover should use the existing shared
`handleLoadRouteParam` flow, switch to Build, fit the route on the map, and add
the route to recents. It should not remount the app or require a network
request.

### Native Discover

The first native parity milestone should reproduce the functional Discover
surface, not the full web visual implementation:

- load all catalog entries;
- show featured routes as a promoted section, while still listing every route;
- support the same filter axes as mobile web;
- show route cards with route-map thumbnails, distance, elevation, difficulty,
  surface, route shape, and nearby places;
- expose "open route" into the planner;
- optionally expose "details" for native route detail screens once those exist;
- draw visible recommended routes on the native map with the shared
  `discoverRouteColor` palette.

### Native Route Detail and Featured Content

Implement generic route detail before custom story parity:

- route header media from `routeMapImage` or `heroImage`;
- route summary/description;
- stats and warnings from the generated route snapshot;
- route map playback/preview using the native map renderer;
- POI/story list from snapshot active data points;
- primary "open in planner" action.

Custom web route-story JSX modules should stay web-only. Native should consume
structured route snapshot/catalog data. If richer editorial text is needed on
native, add it to the catalog/snapshot schema rather than trying to render web
story components.

## Offline Data Direction

Extend the existing mobile asset sync from planner data to content data:

- `public-data/route-catalog.json`;
- `data/places.json`;
- `public-data/featured-routes/*.json`;
- route-map images referenced by catalog/snapshots;
- POI images referenced by route cards, detail pages, and active route POIs.

Metro needs static literal `require(...)` entries, so the current generated
`bundledAssets.native.js` approach should be generalized rather than replaced.
Add an image asset map alongside `JSON_ASSETS` and `BINARY_ASSETS`, and expose a
small native image resolver that converts a logical `public-data/...webp` path
into an `Image` source.

The minimum offline target is route discovery and route loading without the
project dev server. Offline Mapbox base tiles are separate and should remain out
of scope for this parity pass.

## Expo/Metro Independence

The native iOS project already has the correct split:

- Debug `AppDelegate.swift` resolves JavaScript from Metro.
- Non-Debug builds resolve `main.jsbundle` from the app bundle.
- The Xcode "Bundle React Native code and images" phase skips bundling only for
  Debug configurations.

Therefore the path is not to remove Expo. The path is to create an explicit
"field/dev-offline" build profile that embeds JS and assets, installs on a
phone, and does not require Metro. Options:

1. Use a Release build for physical-device testing.
2. Add a custom non-Debug Xcode configuration/scheme such as `OfflineDebug`
   that keeps development signing but does not define `DEBUG` and does not set
   `SKIP_BUNDLING=1`.
3. Add scripts that run mobile asset sync, export/embed JS, build/install the
   scheme, and verify the app launches with the Mac offline.

This keeps normal `expo start` / `expo run:ios` fast for local iteration while
making an explicit standalone build available for outdoor testing.

## Non-Goals

- Full offline Mapbox tile packs.
- Replacing Expo with a bare React Native bootstrap.
- Accounts or server sync.
- Native rendering of existing web-only JSX story modules.
- Navigation/ride recording, except as future native-only follow-up work.

## Risks

- App size can grow quickly if every POI image and full-resolution route image is
  bundled. Prefer thumbnails in Discover and lazy/detail-only full images.
- `loadCatalog()` currently fetches through web asset APIs and uses
  `import.meta.env`; this needs a platform-safe loader before native can consume
  it directly.
- Metro static asset maps can become large and noisy. Generate them
  deterministically and keep generated edits isolated.
- Route detail parity should not block initial discovery. Users get most value
  as soon as route cards can open routes in the planner.

