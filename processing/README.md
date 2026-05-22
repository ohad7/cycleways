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
- `build/base-routing-network.json`
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
- `base-routing-network.<version>.json`
- `exports/map.<version>.kml`
- `bike_roads_v18.geojson`
- `segments.json`
- `base-routing-network.json`
- `exports/map.kml`

Promote refuses skipped-elevation builds and stale builds where
`data/map-source.geojson` was saved after `build/report.json`. It also refuses
full builds with elevation failures and removes older versioned promoted files
after copying the current version.

The build also emits the public base routing network from the elevated
OSM/manual graph and accepted CycleWays base overlay. The runtime routing asset
is validated during build: accepted overlay refs must resolve to current graph
edges, active accepted mappings must stay continuous, accepted base edge
ownership must stay exclusive, and the elevated graph source digest must match
the current 2D base graph. Recalculate Graph + Matches and run
`npm run osm:elevation` before Build when the base graph has changed.

The runtime asset does not publish the full elevation profile. It keeps compact
edge endpoint elevation and net elevation change as directional routing inputs.
The first climb-aware cost adds an uphill-only cost term from that directional
edge net change; sampled local grade diagnostics stay build-side until a
path-aware grade policy exists. Routed public geometry interpolates those edge
endpoint elevations onto clipped base-edge coordinates so the current elevation
chart follows the routed graph, but it is not yet a sampled terrain profile.

Inspect a promoted runtime route and its base-edge cost breakdown with:

```bash
npm run route:inspect -- \
  --point 33.128052,35.583602 \
  --point 33.110767,35.578751
```

The inspector reads `map-manifest.json` by default, snaps each point to the
promoted hidden graph, and prints the chosen edge traversals with route class,
CycleWays ownership, distance-weighted cost, uphill cost, and directional
elevation totals. Pass `--manifest build/map-manifest.json` to inspect a fresh
Build output before Promote.

The promoted public `bike_roads` GeoJSON also uses that reviewed overlay for
display geometry. For an active accepted mapping, Build assembles the CycleWays
feature line from the ordered directed base edges so the visible CycleWays line
matches the hidden routing graph. Unresolved active segments still fall back to
their processed source geometry during the migration. Accepted display lines use
base-edge longitude/latitude and drape processed source elevation onto those
coordinates for current public segment details. The source-derived KML and
source-derived segment elevation metrics are unchanged by this display step.

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

## Base Graph Elevation Sampling Lab

Before the base graph becomes the elevation authority, use the standalone lab
stage to compare sampling density on the current 2D graph:

```bash
npm run osm:elevation-lab
```

By default this reads `build/osm/osm-base-graph.json`, reports graph-wide sample
occurrence counts for `1m`, `5m`, `10m`, and `25m` spacing, and previews the
longest graph edges without changing promoted map assets. Outputs are written
under `build/osm/elevation-sampling/`:

- `sampling-report.json`
- `sampling-preview.geojson`

Fetch elevations only for the selected preview edges after the local elevation
service is running:

```bash
npm run osm:elevation-lab -- \
  --fetch-elevation \
  --edge-set-file data/osm-elevation-study-edges.json \
  --preview-points
```

The preview lookup path deduplicates sampled coordinates, posts them in batches,
and stores a separate persistent cache at
`processing/cache/base_graph_elevation_sampling_cache.json`. Elevation profile
simplification keeps original edge vertices, uses a configurable vertical error
tolerance, and keeps retained profile gaps bounded for comparison:

```bash
npm run osm:elevation-lab -- \
  --fetch-elevation \
  --edge-set-file data/osm-elevation-study-edges.json \
  --sample-spacings 1,5,10,25 \
  --vertical-tolerance 1 \
  --max-retained-gap 50
```

`data/osm-elevation-study-edges.json` records the current representative set
for policy comparisons: valley OSM/manual edges, Golan edges, Hermon edges, and
manual hill cases. Add `--edge-id <base-edge-id>` for one-off cases.

## Elevated Base Graph Artifact

Once the sampling lab has been used to check the current terrain mix, build the
first graph-side elevation artifact:

```bash
npm run osm:elevation
```

This processor reads `build/osm/osm-base-graph.json`, samples every OSM/manual
edge at the current `10m` acquisition spacing, reuses the lab cache, and writes:

- `build/osm/osm-base-graph-elevated.json`
- `build/osm/osm-base-graph-elevation-report.json`

The elevated graph preserves the 2D graph topology and edge coordinates. Each
edge gets an `elevation` object with a compact profile encoded as
`[offsetMeters, elevationMeters]`, the acquisition and retained sample counts,
and gain/loss/net metrics derived from the full sampled profile. The report
records coverage, missing edge examples, profile-point reduction, cache/fetch
counters, metric distributions, and grade policy diagnostics before routing
consumes this artifact. The diagnostics compare aggregate per-edge candidates,
raw adjacent-sample grade spikes, sustained grade over fixed `25m`, `50m`, and
`100m` windows inside one edge, and the same windows stitched across graph
chains where a degree-2 join has one unambiguous continuation.

Start the local elevation service before the normal build. For a partial
inspection artifact from the current cache only:

```bash
npm run osm:elevation -- --cache-only --allow-missing-elevation
```

`--cache-only` reports edges that do not yet have a complete cached profile.
Without `--allow-missing-elevation`, the command exits non-zero when any edge is
missing elevation so the elevated graph cannot silently become a complete input.
