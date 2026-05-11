# Map Editor

This is a local editor for the canonical map source at `data/map-source.geojson`.
It edits the source file directly and then runs the processing pipeline to generate:

- `build/bike_roads.geojson`
- `build/segments.json`
- `build/map.kml`
- `build/report.json`
- `build/map-manifest.json`
- content-versioned copies such as `build/bike_roads.<version>.geojson`

The `Promote` action copies a fresh full build into the files used by the
current site:

- `build/map-manifest.json` -> `map-manifest.json`
- `build/bike_roads.<version>.geojson` -> `bike_roads.<version>.geojson`
- `build/segments.<version>.json` -> `segments.<version>.json`
- `build/map.<version>.kml` -> `exports/map.<version>.kml`
- `build/bike_roads.geojson` -> `bike_roads_v18.geojson`
- `build/segments.json` -> `segments.json`
- `build/map.kml` -> `exports/map.kml`

Promote also removes older `bike_roads.<version>.geojson`,
`segments.<version>.json`, and `exports/map.<version>.kml` files so the
repository keeps only the current promoted version.

Start it from the repository root:

```bash
EDITOR_PORT=8899 node editor/server.mjs
```

The server prints timestamped API logs. Build requests also stream processor
progress into the same terminal, including the build command, per-segment
coordinate counts, elevation lookup/cache/skipped/failure counters, the generated
version, and the final validation summary.

Open:

```text
http://127.0.0.1:8899/editor/
```

The editor and site expect a Mapbox token at runtime, but the token is not stored
in git. For local use, set it in the browser console before opening the editor:

```js
localStorage.setItem("cycleways.mapboxToken", "your-mapbox-token")
```

## Current Editing Scope

- Select a segment from the map, or open the Segments drawer when search/list selection is needed.
- Draw a new segment by clicking points on the map, then committing with Done.
- Extend a selected segment by clicking near its closest endpoint and drawing outward.
- Edit name, status, road type, todo, and notes.
- Drag selected segment vertices.
- Insert a vertex by enabling insert mode and clicking near the selected line.
- Delete the selected vertex when the segment still has at least two coordinates.
- Split a segment at a selected internal vertex.
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

The public site loads `map-manifest.json` with `cache: "no-store"` and then loads
the versioned files listed in that manifest. If the manifest is missing, the site
falls back to `bike_roads_v18.geojson` and `segments.json`.

## Data Contract

KML is an export format for Google Maps/Google Earth review. The editable source of
truth is `data/map-source.geojson`; generated artifacts should come from the processor,
not manual edits.
