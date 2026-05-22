# Map Editor

This is a local editor for the canonical map source at `data/map-source.geojson`.
It edits the source file directly and then runs the processing pipeline to generate:

- `build/bike_roads.geojson`
- `build/segments.json`
- `build/base-routing-network.json`
- `build/map.kml`
- `build/report.json`
- `build/map-manifest.json`
- content-versioned copies such as `build/bike_roads.<version>.geojson`

The `Promote` action copies a fresh full build into the files used by the
current site:

- `build/map-manifest.json` -> `map-manifest.json`
- `build/bike_roads.<version>.geojson` -> `bike_roads.<version>.geojson`
- `build/segments.<version>.json` -> `segments.<version>.json`
- `build/base-routing-network.<version>.json` -> `base-routing-network.<version>.json`
- `build/map.<version>.kml` -> `exports/map.<version>.kml`
- `build/bike_roads.geojson` -> `bike_roads_v18.geojson`
- `build/segments.json` -> `segments.json`
- `build/base-routing-network.json` -> `base-routing-network.json`
- `build/map.kml` -> `exports/map.kml`

Promote also removes older `bike_roads.<version>.geojson`,
`segments.<version>.json`, and `exports/map.<version>.kml` files so the
repository keeps only the current promoted version.

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
- Draw a new segment by clicking points on the map, then committing with Done.
- Extend a selected segment by clicking near its closest endpoint and drawing outward.
- Edit name, status, road type, todo, and notes.
- Drag selected segment vertices.
- Insert a vertex by enabling insert mode and clicking near the selected line.
- Delete the selected vertex when the segment still has at least two coordinates.
- Split a segment at a selected internal vertex.
- Use the Segments workspace for canonical CycleWays source edits.
- Use the Base Graph workspace to stage manual base edges on top of the read-only
  OSM graph. Manual edges can be created, selected, reshaped by dragging vertices,
  edited with Insert/Delete, split at an internal vertex, and folded into the graph
  with Recalculate Graph + Matches. OSM graph edges can be selected for inspection
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

The build panel defaults to skipping elevation for fast previews. Uncheck that option
when the local elevation service is running and the generated artifacts should include
fresh elevation data. Full builds fail when elevation lookups fail, and Promote
requires a full build with zero elevation failures, so skipped-elevation builds stay
preview-only.

Build also produces the promoted public base-routing asset from the current
elevated OSM/manual graph and accepted CW base overlay. If manual base edges
have changed, run Recalculate Graph + Matches and then run
`npm run osm:elevation` before Build. Build blocks stale elevated source
digests and invalid accepted overlay refs so Promote cannot publish a routing
bundle that no longer matches the base graph.

Build uses accepted overlay edge refs for promoted public CycleWays display
geometry too. Accepted segments in `bike_roads` are drawn from their ordered,
directed base edges so the line riders see matches the hidden routing graph.
Build drapes processed source elevation onto that base-edge display path for the
current public segment details. Unresolved segments keep their processed source
geometry as a migration fallback; Segments mode remains the source geometry
editor.

The public site loads `map-manifest.json` with `cache: "no-store"` and then loads
the versioned files listed in that manifest. If the manifest is missing, the site
falls back to `bike_roads_v18.geojson` and `segments.json`.

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
