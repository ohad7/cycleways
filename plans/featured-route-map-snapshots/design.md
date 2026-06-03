# Featured Route Map Snapshots Design

Date: 2026-06-03

## Goal

Make featured-route maps modular and lean, especially read-only maps such as
`/featured/sovev-beit-hillel`, without making route content fragile or manually
duplicated.

The public featured-route page should not load planner-only assets when it only
needs to show an already-authored route. In particular, a read-only featured map
should avoid loading:

- the full CycleWays display network (`bike_roads.geojson`);
- the full segment metadata file (`segments.json`);
- the CW base index (`cw-base-index.json`);
- the OSM/manual base-routing shard manifest or shard files.

The route token, segment metadata, and promoted map assets remain the source of
truth. Public featured-route snapshots are generated artifacts.

## Current Problem

`src/components/featured/FeaturedRoute.jsx` currently uses the same runtime path
as the route planner:

1. Load `loadMapAssets()`.
2. Load the full CW display GeoJSON and full segment metadata.
3. If base-routing shards exist in the manifest, create a sharded route session.
4. Decode or recalculate the featured route through `RouteManager`.
5. Render `MapView` with the CW network, route geometry, route points, data
   markers, and planner interaction affordances.

That is correct for authoring and route planning, but wasteful for public
read-only route pages. `sovev-beit-hillel` is a compact CW route, yet it still
enters the planner-capable loading path. Hybrid/base routes make the problem
stronger: exact decoding can require OSM/manual base graph shards and the CW base
index, even though public display only needs the final route line.

The map component also mixes capabilities. `MapSurface` is currently a
planner-capable surface by default: network rendering, network hit testing,
route-point editing, route-line drag, data markers, route geometry, video cursor,
and route fitting all live behind one component contract. Read-only maps should
opt into only the capabilities they need.

## Decision

Generate one read-only snapshot per featured route during promotion/build, then
make the public featured page render from that snapshot.

Use this convention:

```text
public-data/featured-routes/<slug>.json
```

These files are generated. They are not edited by hand. The source of truth
remains:

- the route token in `public-data/route-catalog.json`;
- promoted map assets referenced by `public-data/map-manifest.json`;
- POI and segment metadata in `segments.json`;
- the base-routing shards and CW base index when the route token uses base or
  hybrid route formats.

The editor and build/promote flow should regenerate snapshots whenever featured
route inputs change. Tests should fail when a snapshot is stale.

## Why Snapshots

Snapshots solve two separate issues.

First, they avoid unnecessary public runtime work. The public page only needs a
route line, markers for active route POIs, route summary values, bounds, and
video-sync click support. It does not need the full routable graph or the full
visible network.

Second, they preserve exact rendered routes for non-CW and hybrid routes. Some
featured routes can include OSM/manual base-graph edges that are not CycleWays
segments. Reconstructing those exactly in the browser requires base-routing
assets. Generating the final public read model ahead of time keeps the public
page fast while preserving exact route geometry.

Pure CW compact routes also benefit. They may not require OSM/base graph data,
but without a snapshot they still need enough CW network and segment metadata to
reconstruct and display the route.

## Snapshot Shape

The snapshot should be intentionally small and page-oriented.

Suggested schema:

```json
{
  "schemaVersion": 1,
  "slug": "sovev-beit-hillel",
  "generatedAt": "2026-06-03T00:00:00.000Z",
  "source": {
    "routeTokenHash": "sha256:...",
    "routeFormat": "compact_route",
    "mapVersion": "614bca21406d",
    "assetHashes": {
      "bikeRoads": "...",
      "segments": "...",
      "cwBaseIndex": "...",
      "baseRoutingShards": "..."
    }
  },
  "route": {
    "geometry": [
      { "lng": 35.609301, "lat": 33.217457, "elevation": 90.2 }
    ],
    "bounds": {
      "west": 35.6,
      "south": 33.19,
      "east": 35.61,
      "north": 33.22
    },
    "distance": 6500,
    "elevationGain": 12,
    "elevationLoss": 12,
    "selectedSegments": ["..."],
    "points": []
  },
  "pois": {
    "activeDataPoints": [],
    "dataMarkerFeatures": [],
    "activeDataPointIds": []
  }
}
```

Notes:

- `points` should not be required for public read-only map display. It can be
  present for diagnostics, but the read-only map should not render draggable
  route points.
- `dataMarkerFeatures` contains **only markers for POIs on this route**, not
  every marker from `segments.json`. See "Marker Visibility Decision" below.
- `routeTokenHash`, `mapVersion`, and `assetHashes` let tests detect stale
  snapshots after route, segment, or OSM/base graph changes.
- The snapshot may include route start/end display data later, but that should
  stay page-oriented and derived from catalog/route geometry.

### Active data point contract

`pois.activeDataPoints` must round-trip the **full** data-point objects, not just
ids. The featured page components read these fields off each active point:

- `id` — marker correlation, focus, video-sync lookup
  (`FeaturedRoute.handleDataMarkerClick`, `RouteProgressDistance`).
- `type` — POI vs warning classification (`POIList`, `Warnings`,
  `RoutePoiStoryList`).
- `name`, `description` — story/list text (`RoutePoiStoryList`).
- `location` — `[lat, lng]` for stories and gallery slides.
- `routeFraction` — video-sync seek position and progress ordering.
- `images` (and `photo`/`thumbnail`/`gallery`) — galleries and slides
  (`RoutePoiGallery`, `RoutePoiVideoPreview`, `VideoEmbed`, `POIList`).

If any of these are dropped, featured pages silently lose POI stories,
galleries, warnings, or marker-click seek. Snapshot validation must assert the
active-data-point field set survives generation.

### Snapshot shape vs runtime `routeState`

The runtime consumes a flat snapshot shape produced by `emptyRouteSnapshot()`:
`{ points, selectedSegments, geometry, distance, elevationGain, elevationLoss,
activeDataPoints, routeFailure }`. The public snapshot file groups fields under
`route` / `pois` for readability. The loader therefore needs a small **adapter**
(`snapshotToRouteState`) that maps the file shape back to the flat `routeState`,
filling `points: []` and `routeFailure: null` defaults so downstream invariants
(e.g. `requestRouteFit` guarding on `geometry.length >= 2`) are unaffected.

## Marker Visibility Decision

Today the featured map renders **all** POI markers from `segments.json` via
`dataMarkerFeaturesFromSegments(assets.segmentsData)`, passing the route's active
ids as `activeDataPointIds`. The `active` flag only drives opacity
(`mapStyles.js`: on-route markers ~0.9, off-route ~0.45) — it is **not** a
visibility filter — so off-route POIs currently appear dimmed on featured pages.

Decision: **featured maps show only POIs on the route.** Off-route markers are
dropped. This keeps the snapshot lean and fully severs the `segments.json`
dependency; carrying every segment marker would re-import most of that file and
undercut the entire goal. This is a deliberate, accepted UX change for featured
pages (the planner at `/` is unchanged).

Consequence: `pois.dataMarkerFeatures` is derived from the route's
`activeDataPoints`, not from the full segment set. The builder needs a pure
helper that converts active data points into the same GeoJSON feature shape
`syncDataMarkerLayers` expects (reuse the projection logic already in
`@cycleways/core/data/dataMarkers.js`, restricted to active points).

## Runtime Loading

Public featured pages should prefer the snapshot path:

1. Load the catalog entry for the slug.
2. Fetch `public-data/featured-routes/<slug>.json`.
3. Validate that the snapshot slug and source metadata match the catalog and map
   manifest version.
4. Build the existing featured-route context from snapshot data.
5. Render a read-only map.

Production should not silently fall back to the heavy planner path, because that
would hide stale snapshots and reintroduce the large requests this work is
intended to remove. A development-only fallback is acceptable for local authoring
convenience, but tests must exercise the snapshot path.

## Map Modularity

Add an explicit map capability model rather than relying on which props happen
to be present.

The simplest public API is a `mode` prop:

```jsx
<MapView
  mode="readonly-route"
  routeGeometry={snapshot.route.geometry}
  dataMarkerFeatures={snapshot.pois.dataMarkerFeatures}
  activeDataPointIds={snapshot.pois.activeDataPointIds}
  routeFitRequest={routeFitRequest}
  videoCursor={videoCursor}
  onRouteClick={handleRouteClick}
  onDataMarkerClick={handleDataMarkerClick}
/>
```

`mode="planner"` remains the default for the main app.

`readonly-route` should enable:

- map initialization;
- base map style;
- route geometry layer;
- route fit;
- focused marker camera movement;
- data marker layer and click callback;
- video cursor layer;
- route click callback for video sync.

`readonly-route` should disable:

- CW route network source/layers;
- network hover/click snapping;
- hover preview marker;
- route-point layers unless explicitly requested;
- route-point dragging;
- route-line insert/drag;
- route-point removal/select interactions;
- viewport prefetch behavior.

This keeps the map surface modular while preserving the planner behavior at `/`.

## Generation Ownership

Snapshot generation should be a reusable Node module or script, not editor-only
inline logic.

**The Node decode already exists — extract it, don't rewrite it.**
`editor/server.mjs` already decodes featured routes server-side from disk:

- `getBaseRoutingDecodeAssets()` reads `base-routing-shards/manifest.json`,
  decodes each shard by format (`msgpack` / `compact` / JSON) and merges them
  via `mergeBaseRoutingShards`, and loads `cw-base-index.json`.
- `loadFeaturedAssetsFromDisk()` loads `bike_roads.geojson` + `segments.json`.
- `loadRoutePolylineForSlug(slug)` resolves the route token from the catalog
  (draft → promoted → `.meta.js` fallback), builds a `RouteManager` with the
  base-routing network, decodes via `restoreRouteFromParam`, and returns the
  full `routeState` snapshot.

The builder should **lift this logic up into a shared module** that both
`scripts/build-featured-route-snapshots.mjs` and `editor/server.mjs` import, so
the proven filesystem decode path is reused rather than duplicated. This also
removes the risk that was assumed in early drafts: Node-side hybrid/base decode
is already running in production editor flows.

Recommended shape:

```text
scripts/build-featured-route-snapshots.mjs   # CLI + --check
<shared builder module>                       # extracted decode + projection
editor/server.mjs imports the shared builder during route-catalog promote
```

The builder should:

1. Read `public-data/route-catalog.json`.
2. Select entries with `featured: true`.
3. Read `public-data/map-manifest.json` and promoted assets.
4. Decode each route token with full local capabilities:
   - compact CW routes via `RouteManager`;
   - base/hybrid routes using merged base-routing shards and `cw-base-index`.
5. Convert the route snapshot into the small public schema.
6. Write `public-data/featured-routes/<slug>.json` atomically.
7. Optionally delete orphaned snapshot files for removed featured routes.

The editor route-catalog promote endpoint should call this builder after writing
the promoted catalog. The map/data build workflow should also run it after
promoting new map assets. If a map or segment change does not regenerate
snapshots, validation should fail.

## Staleness Validation

Add validation that checks every featured route has a matching snapshot.

At minimum:

- snapshot file exists for every `featured: true` catalog entry;
- `snapshot.slug === catalog.slug`;
- `snapshot.source.routeTokenHash` matches the current route token;
- `snapshot.source.mapVersion` matches `map-manifest.json`;
- `snapshot.source.assetHashes` match manifest hashes for the assets used to
  decode the route;
- route geometry has at least two coordinates;
- bounds are valid;
- active marker ids match active data points.

A stronger `--check` mode may regenerate snapshots in memory and compare core
route fields. That is more expensive because hybrid/base routes need shards, but
it is useful for CI or release validation.

## Compatibility

Existing route tokens remain valid. This design does not change sharing,
planning, GPX export, editor route decoding, or the route catalog authoring
model.

The heavy planner path stays available where it belongs:

- `/` route planner;
- editor route authoring;
- route-catalog recompute/promote;
- snapshot generation.

The public featured route page becomes a read-only consumer of generated route
state.

## Resolved Implementation Choices

- **Snapshot location:** slug-based convention
  (`public-data/featured-routes/<slug>.json`) only. No per-entry catalog field —
  the catalog is loaded for listing pages and should not carry derived paths.
- **Off-route POI markers:** dropped on featured maps. See "Marker Visibility
  Decision".
- **Missing snapshot:** development may fall back to the live decode path for
  authoring convenience; **production shows an error** and never silently loads
  the heavy planner assets.
- **Route `points`:** not stored by default and never rendered read-only. May be
  included later strictly for diagnostics.
- **Orphan cleanup:** the builder deletes snapshots for routes no longer marked
  `featured`, and `--check` reports any orphan as a failure.
