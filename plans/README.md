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
- `route-point-editing/` - design and implementation plan for clearer route point drag/edit feedback, route-line insert-and-drag, and preserving points outside the routing network.
- `elevation-graph-redesign/` - design and implementation plan for the elevation profile redesign (slope-grade coloring, legend, and hover tooltip).
- `map-surface-abstraction/` - design and implementation plan for the web-only map-surface abstraction (platform-agnostic MapSurface contract) ahead of a future React Native app, plus a sequenced mobile-web touch/responsive pass.
- `engine-importable-module/` - design and implementation plan for loading the routing engine (route-manager.js) as an importable module instead of a window global, toward React Native code sharing.
