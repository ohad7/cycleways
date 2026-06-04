# Plans

This directory contains planning documents for larger project changes before implementation.

Current plans:

- `map-editor-workflow/` - design and implementation plan for the map editor and source-data processing workflow.
- `editor-name-release/` - design and implementation plan for freeing names held by deprecated map records.
- `segment-scores/` - design and implementation plan for per-segment quality scores.
- `waypoint-routing/` - design and implementation plan for point-based route creation and the Phase 2 routing direction.
- `osm-base-network-navigation/` - design and implementation record for the OSM/manual base graph and CycleWays overlay preparation phase for internal routing.
- `browser-local-sharded-routing/` - design and implementation plan for the browser-local static routing shard experiment intended to scale the hidden base graph beyond the current full-asset prototype.
- `route-sharing-v4/` - design and implementation plan for compact shard-aware route sharing over arbitrary base-graph routes.
- `map-asset-size/` - design and implementation plan for low-risk generated GeoJSON size reduction.
- `react-migration/` - design and implementation plan for incrementally moving the public app to React.
- `featured-routes/` - design and implementation plan for curated featured-route landing pages with maps, POIs, photos, and video.
- `video-sync-overlay/` - design and implementation plan for the editor's dedicated side-by-side video-sync overlay: precise transport controls, keyboard shortcuts, a shared-interpolator ghost marker, and a larger video.
- `route-point-editing/` - design and implementation plan for clearer route point drag/edit feedback, route-line insert-and-drag, and preserving points outside the routing network.
- `elevation-graph-redesign/` - design and implementation plan for the elevation profile redesign (slope-grade coloring, legend, and hover tooltip).
- `map-surface-abstraction/` - design and implementation plan for the web-only map-surface abstraction (platform-agnostic MapSurface contract) ahead of a future React Native app, plus a sequenced mobile-web touch/responsive pass.
- `engine-importable-module/` - design and implementation plan for loading the routing engine (route-manager.js) as an importable module instead of a window global, toward React Native code sharing.
- `app-platform-services/` - design and implementation plan for routing App.jsx browser location/storage access through a swappable platform-services layer, toward React Native code sharing.
- `app-controller-hook/` - design and implementation plan for extracting App.jsx orchestration into a platform-agnostic useCyclewaysApp hook (thin web view), toward React Native code sharing.
- `monorepo-core-package/` - design and implementation plan for the npm-workspaces monorepo + @cycleways/core shared package (web stays at root), the foundation of the React Native transition.
- `rn-mobile-scaffold/` - design for Phase 2.1 of the RN slice: Expo app (apps/mobile) + Metro resolving @cycleways/core.
- `rn-map-surface/` - design + plan for Phase 2.2 of the RN slice: native @rnmapbox/maps MapScreen rendering the cycleway network with shared core appearance logic.
- `rn-asset-transport/` - design + plan for Phase 2.3a: injectable asset transport in @cycleways/core (web impl; RN/offline loader follows).
- `rn-offline-assets/` - design + plan for Phase 2.3b: bundled mobile `public-data`, static Metro require maps, and native platform adapters.
- `rn-controller-ui/` - design + plan for Phase 2.4: Expo iPhone UI rendered from the shared `useCyclewaysApp` controller with native route taps.
- `rn-mobile-planning-controls/` - design + plan for Phase 2.5: native waypoint selection/removal, undo/redo, and route-fit controls.
- `rn-mobile-search/` - design + plan for Phase 2.6: native location search, result marker, camera jump, and add-result-to-route.
- `rn-mobile-location/` - design + plan for Phase 2.7: native current-location puck and locate/follow camera control.
- `rn-mobile-web-parity/` - design + plan for Phase 2.8: realign the iPhone route-planning UI with the mobile web planner before adding navigation-mode complexity.
- `rn-mobile-elevation-profile/` - design + plan for Phase 2.9: native elevation profile chart (shared core builder + grade utils, react-native-svg rendering, touch-scrub tooltip, synced map marker, expandable bottom sheet).
- `rn-mobile-route-restore/` - design + plan for Phase 2.10: native route restore / `?route=` deep-link parity via a location.native URL cache + Linking.
- `rn-mobile-waypoint-drag/` - design + plan for Phase 2.11: native draggable route waypoints (RNMapbox PointAnnotation wired to the shared drag handlers).
- `mobile-map-gesture-intent/` - design for tightening the iPhone map gesture intent model (add / move / pan / zoom) to stop touches near a point being misread as point-moves.
- `cw-edge-snap-preference/` - design for biasing route-point snapping toward CycleWays-matched edges (shared core) so points near a CW path don't snap to a parallel road.
- `data-marker-detail-card/` - design for a bottom-sheet detail card when tapping a landmark/hazard marker (shared core action + add-to-route), on the iPhone app and mobile web.
- `segment-poi-gallery/` - design and implementation plan for deriving featured-route galleries from reusable segment-level POIs with images, ordered by route progress.
- `poi-editor-refinements/` - design and implementation plan for multiple images per POI, a managed (read-only) editor image list, a decluttered segment panel with pinned ID/Name and collapsed quality, and emoji map markers per POI type.
- `featured-gallery-video-sync/` - design and implementation plan for the Sovev Beit Hillel route-story layout: dominant video, right-side route text + compact map, transient POI video preview, and below-fold POI story list.
- `featured-mobile-layout/` - design and implementation plan for the featured route page's mobile-web editorial polish (and how the screen is shared with the future native iPhone app); also removes the fullscreen map button.
- `featured-mobile-video-crop/` - design and implementation plan for a mobile route-player mockup that crops the existing landscape YouTube video into a 4:5 frame with a mini live map overlay.
- `featured-route-endpoints/` - design for optional per-route start/end points (image + name + description, location derived from route geometry) shown in the on-video preview (fraction 0/1) and as the first/last story cards.
- `featured-route-map-snapshots/` - design and implementation plan for generated featured-route read-only map snapshots and a lean public map mode that avoids planner-only assets.
- `loading-splash/` - design for an instant inline loading splash (branded logo + real-milestone progress bar) in index.html to remove the slow-network "dead gap" before React mounts.
- `banias-gan-hatsafon-page/` - design and implementation plan for the Banias/Gan HaTzafon featured page, generalizing the sovev video-first scaffold into a reusable `FeaturedVideoRoute` template (and renaming the `sbh-` CSS prefix to `fv-`).
- `featured-desktop-overlay-layout/` - design and implementation plan for an opt-in (`?layout=overlay`) desktop featured-page layout that moves the map to a PiP on the video (like mobile) and fills the rail with the route description, a stats block, and an interactive synced elevation graph.
- `featured-video-slow-start/` - design for a 3-step slow-start playback ramp (0.5 → 0.75 → 1.0 over the first ~500 m) on featured-page videos, composed with the existing POI-vicinity slowdown via a single pure rate function.
- `recommended-routes/` - design and implementation plan for making `/routes` the canonical public catalog of all recommended routes, with optional route-story pages replacing the overloaded featured concept.
