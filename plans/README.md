# Plans

This directory contains planning documents for larger project changes before implementation.

Current plans:

- `route-playback-dock/` - design for a usable three-up route-playback view (map + player + full interactive elevation graph at a partial panel height, with bidirectional elevation⇄player⇄route sync, on mobile web and iOS) plus web-parity `progress-head-pulse` animation on iOS and removal of the iOS auto-firing direction animation.

- `rn-mobile-map-style-parity/` - design + implementation plan for aligning the iPhone app map and route-building UI with the more-polished mobile web by sharing presentation specs + a planner view-model + a clock-injected playback engine (network/route colors, build summary, playback controls).

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
- `video-sync-gps-bootstrap/` - design and implementation plan for bootstrapping editor video-sync keyframes from a clip's GPS track (time/5 rescale, route-snap, error-bounded simplification) instead of clicking each keyframe by hand.
- `featured-map-playback/` - design and implementation plan for giving non-video featured/recommended route pages a synthetic playable map stage aligned with video-route controls, cursor animation, and POI/warning cues.
- `route-map-thumbnails/` - design and implementation plan for editor-generated Mapbox route-map screenshots used as static route-card thumbnails.
- `topbar-route-navigation/` - design and implementation plan for canonical route navigation, active topbar state, breadcrumbs, and removal of the stale recommendations section.
- `front-page-route-playback/` - design and implementation plan for bringing shared featured-route playback controls, cursor animation, elevation tracking, and POI cue previews to the front-page planner.
- `front-page-overhaul/` - design and implementation plan for reshaping the desktop front page into a persistent two-column app shell (map + right Discover/Build panel), relocating the route-finder, elevation graph, route tools, and warnings into the panel while keeping geocoder search and play transport on the map.
- `rich-text-descriptions/` - design for a conservative markdown subset (links, bold, paragraphs) in POI and route descriptions, parsed once in `@cycleways/core` into a neutral AST and rendered by thin web/React-Native/editor-preview renderers with a URL allow-list and no raw-HTML path.
- `route-fit-on-play/` - design for fitting the route to the map on a fresh play, with overlay-aware padding (measured from a per-surface selector registry of overlays) so the play controls and other on-map overlays don't hide the route.
- `route-fit-more-triggers/` - design for reusing the overlay-aware fit on more triggers: planner `route=xxx` restore + featured non-video open, the Discover all-routes fit (re-fitting on filter changes), and hover-to-fit with restore-on-leave.
- `discover-route-colors/` - design for making Discover/recommended route lines render above the CW network in distinct per-route colors (shared palette helper) with matching color swatches on the Discover list cards.
- `segment-name-display/` - design for restyling the planner segment hover/click tooltip into a cream POI-preview-style card (forest accent, optional photo, capped data chips), hiding it during active playback, and relocating the road-type legend to the conventional bottom-left corner.
- `discover-scroll-map-sync/` - design for showing all catalog routes in the Discover list (catalog order) and coupling list scroll to the map: in-viewport routes drawn bright, the cards just above/below drawn as faint ghosts, off-screen routes hidden, lazy geometry loading near the viewport, and a settle-debounced fit to the visible set.
- `discovery-surface/` - design for the mobile-first discovery objective: one-shot "locate me" with near-me ranking, a bottom-sheet mobile layout, seamless client-side route selection (no full reload), one unified catalog across Discover//routes//featured, and a clear first-screen story.
- `planning-surface/` - design for the desktop-first planning objective: localStorage draft autosave + "my routes" recents, contextual onboarding replacing the tutorial modal, a send-to-phone QR output, and a minimal touch repair for mobile Build (point removal, drag intent).
- `navigation-handoff/` - design for the navigation objective: navigation/recording are app-only, the `?route=` encoding is the universal hand-off currency, universal/app links open shared routes in the app with automatic web fallback, and app entry points are additive (never dead-end redirects).
- `rn-turn-by-turn-navigation/` - design and implementation plan for native iPhone turn-by-turn navigation for built and featured/recommended routes, using CycleWays route geometry as the route authority.
- `turn-by-turn-rejoin-routing/` - design for Phase B routed rejoin: an on-device, non-mutating `computeConnectorRoute` + a connector phase in the nav session that gives turn-by-turn guidance from the rider to the route (scored start-vs-nearest on approach, nearest-ahead mid-ride), with throttled auto-recompute, generation-id cancellation, handoff back to the main route, and Phase A arrow fallback when routing isn't possible.
- `turn-by-turn-improvements/` - design (and plan) for the post-ride follow-up to native turn-by-turn: an explicit route-acquisition state, a route-distance segment-span index feeding a network-aware context line + better maneuver cues, a single adaptive smoothed rider puck with a smoothed camera, off-route/approach + wrong-way guidance (arrow+distance now, routed rejoin deferred), and two test harnesses (node GPS-track replay with a real-ride fixture + an in-app simulate-ride dev mode via injected location source).
- `discover-route-page-cta/` - design for keeping the Discover card tap as an in-place map preview while promoting the dedicated route page as the next step: a photo-strip CTA in the Build panel and mobile peek strip (cleared once the route is edited), a stronger per-card page chip, and slugs on recents.
- `route-network-visual-emphasis/` - design and implementation plan for feature-flagged, zoom-aware route-network styling variants, preserving typed segment colors while testing cased lines and adaptive base-map color schemes.
- `rn-mobile-native-ui/` - design + implementation (DONE 2026-06-27) for Phase 2.8c: a CycleWays-branded native-feel reskin of the iPhone planner (real draggable bottom sheet, full-bleed map, top-pinned search pill + map controls, Ionicons, branded Discover cards with photo thumbnails) without changing planner behavior.
