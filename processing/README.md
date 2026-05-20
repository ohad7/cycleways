# Map Processing

`build_map.py` builds generated map artifacts from either:

- the canonical source GeoJSON file, or
- a source KML file plus a segment metadata file.

The GeoJSON path is the forward-looking workflow. The KML path is kept for compatibility while migrating.

## Canonical Source GeoJSON

Build from `data/map-source.geojson`:

```bash
python3 processing/build_map.py \
  --input-geojson data/map-source.geojson \
  --out-dir build
```

Add `--verbose` to print per-segment processing progress and elevation counters.
The editor server uses this flag for builds started from the UI.
Full builds fail when any elevation lookup fails. Use `--skip-elevation` only
for preview builds that should keep source elevations.

Create or refresh the initial source file from current generated artifacts:

```bash
python3 processing/migrate_to_source_geojson.py \
  --geojson bike_roads_v18.geojson \
  --segments segments.json \
  --output data/map-source.geojson
```

## Legacy KML Input

Example smoke build without the local elevation service:

```bash
python3 processing/build_map.py \
  --input-kml versions/63efdfce/lines-export-63efdfce.kml \
  --segments segments.json \
  --out-dir build \
  --skip-elevation
```

Example build with the local Open Elevation service:

```bash
python3 processing/build_map.py \
  --input-kml input.kml \
  --segments segments.json \
  --out-dir build \
  --elevation-url http://localhost/api/v1/lookup
```

Generated outputs:

- `build/intermediate_uniform.kml`
- `build/map.kml`
- `build/bike_roads.geojson`
- `build/segments.json`
- `build/report.json`
- `build/map-manifest.json`
- content-versioned copies such as `build/bike_roads.<version>.geojson`

`build/bike_roads.geojson` is optimized as a site runtime artifact: it is
minified, longitude/latitude are rounded to 6 decimal places, and elevation is
rounded to 0.1m. The canonical source GeoJSON and generated KML stay readable
and full precision.

The editor's promote action copies generated output to:

- `map-manifest.json`
- `bike_roads.<version>.geojson`
- `segments.<version>.json`
- `exports/map.<version>.kml`
- `bike_roads_v18.geojson`
- `segments.json`
- `exports/map.kml`

Promote refuses skipped-elevation builds and stale builds where
`data/map-source.geojson` was saved after `build/report.json`. It also refuses
full builds with elevation failures and removes older versioned promoted files
after copying the current version.

For editor-created splits, deprecated parent records keep compact `routeAnchors`
as `[lng, lat]` coordinates, and active child records keep `splitFrom` metadata.
The validation report checks that route anchors are valid and that split parents
have route anchors or a middle-point fallback.

`processing/cache/elevation_cache.json` is ignored by git and stores elevation lookups between builds.

## OSM Network Exploration

Fetch raw OSM ways for the configured exploration area:

```bash
npm run osm:fetch
```

By default this uses `data/osm-target-area.geojson`, an approximate polygon
covering the Hula Valley, the Golan Heights, Mount Hermon, and the Syrian-border
side of the target area. If that file is missing, the script falls back to the
current CycleWays source bounds plus a small buffer.

The command writes debug artifacts under `build/osm/`:

- `osm-raw-ways.geojson`
- `osm-summary.json`
- `osm-intersections.geojson`
- `osm-intersections-summary.json`
- `osm-base-nodes.geojson`
- `osm-base-edges.geojson`
- `osm-base-graph.json`
- `osm-base-graph-summary.json`
- `cw-osm-match-preview.geojson`
- `cw-osm-match-summary.json`
- `cw-osm-matches.json`
- `overpass-query.ql`
- `overpass-response.json`

The base graph builder also reads `data/manual-base-edges.geojson` when present.
Those editor-drawn edges are appended to the generated graph with
`source: "manual"` so the matcher and later router can treat them like ordinary
base graph edges.

Open the app with `?osm=1` to show the raw OSM overlay:

```text
http://127.0.0.1:5173/?osm=1
```

This exploration layer preserves OSM ways and tags as downloaded. It includes
paths, tracks, local streets, and major car roads so the base graph represents
the available map network. Bicycle suitability should be handled later by
routing weights and CycleWays overlay metadata, not by omitting car roads from
the base graph. The raw layer is not split into routing graph edges and is not
matched to the CycleWays network until later processing steps run.

Refresh only the naive intersection debug layer from an existing
`osm-raw-ways.geojson`:

```bash
npm run osm:intersections
```

Refresh only the first-pass base graph from existing OSM and intersection
artifacts:

```bash
npm run osm:graph
```

Refresh only the exploratory CycleWays-to-OSM graph match preview from existing
graph artifacts:

```bash
npm run osm:match
```

The match preview samples active segments from `data/map-source.geojson`, finds
nearby generated OSM graph edges, and writes non-destructive debug artifacts.
It is intended for visual review before changing the canonical map source.
