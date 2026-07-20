# Map Editor

This is a local editor for the canonical map source at `data/map-source.geojson`.
It edits the source file directly and then runs the processing pipeline to generate:

- `build/public-data/bike_roads.geojson`
- `build/public-data/segments.json`
- `build/public-data/base-routing-shards/manifest.json`
- `build/public-data/exports/map.kml`
- `build/public-data/map-manifest.json`
- `build/report.json`

The `Promote` action copies a fresh full build into the files used by the
current site:

- `build/public-data/map-manifest.json` -> `public-data/map-manifest.json`
- `build/public-data/bike_roads.geojson` -> `public-data/bike_roads.geojson`
- `build/public-data/segments.json` -> `public-data/segments.json`
- `build/public-data/base-routing-shards/` -> `public-data/base-routing-shards/`
- `build/public-data/exports/map.kml` -> `public-data/exports/map.kml`

Promote also removes older `bike_roads.<version>.geojson`,
`segments.<version>.json`, `base-routing-network.<version>.json`, legacy
`base-routing-shards.<version>/`, root-level stable runtime files, old
`public-data/base-routing-network.json`, and old `exports/map*.kml` files.
Runtime artifacts now live under `public-data/` with stable names. The map
manifest version and per-shard hashes provide browser cache busting, so Git only
needs to record files whose contents changed.

Start it from the repository root:

```bash
EDITOR_PORT=8899 node editor/server.mjs
```

For development, you can use the dev launcher:

```bash
EDITOR_PORT=8899 node editor/dev-server.mjs
```

Automatic restarts and browser reloads are disabled by default. To opt into
automatic backend restarts when `editor/server.mjs` changes, start with
`EDITOR_SERVER_RESTART=1`. To opt into browser auto-reload while editing client
files, start with `EDITOR_CLIENT_RELOAD=1`.

The server prints timestamped API logs. Build requests also stream processor
progress into the same terminal, including the build command, per-segment
coordinate counts, elevation lookup/cache/skipped/failure counters, the generated
version, and the final validation summary.

Open:

```text
http://127.0.0.1:8899/editor/
```

The editor and site expect a Mapbox token at runtime, but the token is not stored
in git. For local use, copy the example file once:

```bash
cp mapbox-token.example.js mapbox-token.js
```

Then edit `mapbox-token.js` and replace the placeholder with your restricted
Mapbox public token. The local file is ignored by git. GitHub Pages creates the
same file during deployment from the `MAPBOX_TOKEN` Actions secret.

If `mapbox-token.js` is missing locally, the editor server still serves an empty
stub so the script request does not 404. The map will still need a token from the
local file, `MAPBOX_TOKEN`/`CYCLEWAYS_MAPBOX_TOKEN` in the server environment, or
`localStorage["cycleways.mapboxToken"]`.

## Current Editing Scope

- Select a segment from the map, or open the Segments drawer when search/list selection is needed.
- Add a new segment by clicking base graph edges in order, then pressing Done. The new segment's source `LineString` is stitched from the picked edges, and its CW base overlay mapping is auto-accepted when the chosen edges are continuous and unowned. If validation fails, the segment is still created with a `needs_edit` mapping (`failureClass` and message surfaced in the Segment side panel), and the user fixes it with the Add/remove edges control on the segment.
- The compose toolbar exposes an escape-hatch "Draw freehand" button that reverts to the legacy point-drawing flow, for areas with no base coverage. When possible, add the missing path as a manual base edge in Base Graph mode (then run Recalculate Graph + Matches) before resuming Add Segment.
- Extend a selected legacy (point-drawn) segment by clicking near its closest endpoint and drawing outward. Edge-picked segments do not expose Extend — they expose **Add/remove edges** and **Split at edge boundary** in the segment side panel instead.
- Edit name, status, road type, todo, and notes.
- Drag selected segment vertices on legacy point-drawn segments. Edge-picked segments hide vertex tools so the source geometry never drifts from the overlay mapping.
- Insert a vertex on legacy segments by enabling insert mode and clicking near the selected line.
- Delete the selected vertex on legacy segments when the segment still has at least two coordinates.
- Split a legacy segment at a selected internal vertex. Edge-picked segments split at an edge boundary (Split at edge boundary in the side panel).
- Use the Segments workspace for canonical CycleWays source edits.
- Use the Base Network workspace in its default **Explore** mode to visualize
  and inspect the full base graph without changing data. Map views include raw
  `bicycle=no`, normalized two-way prohibitions, conditional traversal,
  manual edges, and reviewed overrides. Results are grouped by source OSM way,
  show their CycleWays relationships, and can be searched by edge or OSM way ID.
- Switch Base Network to **Edit / review** to stage manual base edges on top of
  the read-only OSM graph or save a reviewed traversal override. Manual edges
  can be created, selected, reshaped by dragging vertices, edited with
  Insert/Delete, split at an internal vertex, and folded into the graph with
  Recalculate Graph + Matches. OSM graph edges can be selected for inspection
  and copied into editable manual edges.
- Use the CW Overlay workspace to inspect the selected segment's OSM graph match,
  accept auto matches, or click base graph edges to choose the saved mapping in
  `data/cw-base-overlay.json`.
- Bulk-accept full, high-confidence auto matches while preserving existing
  manual/edit overlay mappings.
- Use the Base Overlay review queue to see accepted/unresolved counts and jump
  directly to segments that are missing from, or only partially matched to, the
  base network.
- Add, edit, drag, and remove per-segment data markers.
- Switch the base map between outdoors, satellite, streets, and light views.
- Save the canonical source file.
- Run the processor and export a Google Maps compatible KML.
- Promote a fresh full build into the current site files.

All active data markers are shown on the map with the same icon set used by the
site. Dragging a marker snaps its saved location back onto that marker's segment.

Drawing mode keeps changes as a temporary draft until Done is pressed. Escape or
Cancel discards the draft, and Backspace/Delete removes the last drafted point.

Splitting deprecates the original segment record and creates two active child
segments. The deprecated parent keeps compact `routeAnchors` as `[lng, lat]`
coordinates so old route URLs can rebuild through points along the current map
after a build. Longer split halves get more anchors automatically.

The build panel always runs a full elevation build, so the local elevation service
must be running before Build. Full builds fail when elevation lookups fail, and
Promote requires a full build with zero elevation failures.

Build also produces the promoted public base-routing asset from the current
elevated OSM/manual graph and accepted CW base overlay. Before running the map
build, the editor refreshes stale base graph artifacts automatically: manual
base-edge edits trigger a graph/match recalculation, and stale elevated graph
artifacts trigger an elevation rebuild. Build still blocks invalid accepted
overlay refs so Promote cannot publish a routing bundle that no longer matches
the base graph.

Build also emits experimental routing shard files under
`build/public-data/base-routing-shards/` for browser-local shard routing comparison.
Promote copies this stable shard directory, but the full promoted base-routing
asset remains the default public baseline. Append
`?routingShards=1` locally to exercise shard-backed waypoint routing. Build
writes compact binary `.cwb` shard files by default; append
`?routingShards=1&routingShardFormat=compact` to force that format explicitly.

Build uses accepted overlay edge refs for promoted public CycleWays display
geometry too. Accepted segments in `bike_roads` are drawn from their ordered,
directed base edges so the line riders see matches the hidden routing graph.
Build drapes processed source elevation onto that base-edge display path for the
current public segment details. Unresolved segments keep their processed source
geometry as a migration fallback; Segments mode remains the source geometry
editor.

The public site loads `public-data/map-manifest.json` with `cache: "no-store"`
and then loads the files listed in that manifest relative to `public-data/`.
Shard routing also adds the manifest version to the stable shard-manifest
request and each shard's content hash to the shard request. If the manifest is
missing, the site falls back to `public-data/bike_roads.geojson` and
`public-data/segments.json`.

## Data Contract

KML is an export format for Google Maps/Google Earth review. The editable source of
truth is `data/map-source.geojson`; generated artifacts should come from the processor,
not manual edits.

The CW base overlay authoring data is stored separately in
`data/cw-base-overlay.json`. That file records how current CycleWays segments map
onto generated base graph edges and is not a replacement for the canonical segment
geometry.

Manual base edges drawn in the editor are stored in
`data/manual-base-edges.geojson`. They are part of the base graph input, not the
CycleWays source geometry.

When an OSM base edge is copied to a manual edge, accepted overlay references
are migrated to the manual replacement. When a manual edge is split, whole-edge
references are expanded to the ordered children; mappings with partial or
unknown-direction references are marked `needs_edit` rather than migrated
ambiguously. The editor persists the manual-edge and overlay updates together.
