# Map Asset Size Implementation Plan

## Implement Now

- Add a site-GeoJSON compaction step to `processing/build_map.py`.
- Apply compaction after elevation and metadata generation, before writing
  `build/bike_roads.geojson`.
- Use compact JSON separators for the generated site GeoJSON.
- Round route coordinates to `[lng, lat, elevation]` precision of
  `[6 decimals, 6 decimals, 1 decimal]`.
- Validate the compacted GeoJSON because that is the artifact the site loads.
- Record the byte reduction in `build/report.json`.
- Print the byte reduction in build output and verbose logs.
- Leave source GeoJSON, reports, manifests, segments JSON, and KML readable.

## Do Not Implement Now

- Do not remove coordinates from generated polylines.
- Do not simplify by distance or visual tolerance.
- Do not change GPX generation behavior.
- Do not change route encoding.
- Do not change editor storage format.

## Future Work

- Add an elevation-aware simplification module behind an explicit build option.
- Add validation gates for distance, elevation gain/loss, marker proximity, route
  warnings, GPX output, and saved-route decoding.
- Run simplification reports in dry-run mode first so the editor can show how
  many points and bytes would be removed before promotion.
- Consider keeping a full-precision debug artifact in build output if simplified
  runtime artifacts become the default.

## Verification

- Compile `processing/build_map.py`.
- Run a source-GeoJSON build with `--skip-elevation` into `/tmp`.
- Confirm `build/bike_roads.geojson` parses as valid JSON.
- Confirm generated coordinates use the configured precision.
- Confirm the build report includes `siteGeojsonOptimization`.
- Run the existing JavaScript test suite because route loading and data-marker
  behavior depend on the generated map artifact shape.
