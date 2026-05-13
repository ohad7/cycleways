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
