# Map Source Data

`map-source.geojson` is the canonical editable source for the map workflow.

The processor generates site and export artifacts from this file:

```bash
python3 processing/build_map.py \
  --input-geojson data/map-source.geojson \
  --out-dir build
```

Generated artifacts include:

- `build/public-data/bike_roads.geojson`
- `build/public-data/segments.json`
- `build/public-data/exports/map.kml`
- `build/public-data/map-manifest.json`
- `build/report.json`

KML is an output for Google Maps/Google Earth viewing, not the canonical editing source.
