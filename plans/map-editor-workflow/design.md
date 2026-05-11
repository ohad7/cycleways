# Map Editor Workflow Design

## Goal

Create a maintainable workflow for editing the CycleWays map while preserving the existing site behavior and keeping KML available as an output for viewing in Google Maps.

The current live site consumes:

- `bike_roads_v18.geojson` for route geometry.
- `segments.json` for IDs, middle points, warnings, data markers, and route-sharing support.

The older processing flow starts from KML and generates GeoJSON after coordinate interpolation and elevation lookup. That processing phase is valuable and should remain, but KML should no longer be the canonical editing format once the repo has its own editor.

## Decision

Use one canonical source file:

```text
data/map-source.geojson
```

Generate all served and exported files from that source:

```text
data/map-source.geojson
        |
        v
processing/build_map.py
        |
        +-- build/bike_roads.geojson
        +-- build/segments.json
        +-- build/map.kml
        +-- build/map-manifest.json
        +-- build/report.json
```

KML remains part of the workflow, but as a generated output for Google Maps or Google Earth, not as the primary source of truth.

## Why Not Canonical KML

KML is useful for viewing in Google tools, but it is not ideal as the editable source:

- It is XML, which makes small edits and reviews noisy.
- It has weak support for stable segment identity.
- The current site joins GeoJSON and `segments.json` by segment name, which is fragile.
- Editor operations such as splitting, moving vertices, and updating metadata are simpler in GeoJSON.
- GeoJSON can directly represent the map features the browser editor will edit.

## Canonical Source Shape

The source GeoJSON should stay sparse and editor-friendly. Dense 10-meter interpolation and elevations are generated build artifacts, not source data.

Example:

```json
{
  "type": "Feature",
  "properties": {
    "id": 62,
    "name": "כביש 9974",
    "status": "active",
    "roadType": "paved",
    "deprecated": false,
    "routeAnchors": [],
    "data": []
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [35.599948, 33.233032],
      [35.600015, 33.23305]
    ]
  }
}
```

Required properties:

- `id` - stable numeric route-sharing identity.
- `name` - display name in Hebrew.
- `status` - `active`, `deprecated`, or `draft`.
- `roadType` - high-level styling/category value.
- `data` - warnings and markers currently stored under `segments.json`.

Optional properties:

- `description`
- `todo`
- `deprecated`
- `routeAnchors` - compact `[lng, lat]` route-rebuild anchors for deprecated records.
- `splitFrom`
- `sourceId`
- `notes`

## Generated Files

### `build/bike_roads.geojson`

Generated site geometry.

Characteristics:

- Coordinates interpolated to the configured maximum spacing.
- Elevation value attached to each coordinate.
- Style properties generated from `roadType`.
- Segment names preserved for current site compatibility.
- IDs included in properties even if the current site still keys by name.

### `build/segments.json`

Generated metadata for the current site.

Characteristics:

- Keyed by segment name for compatibility with the current app.
- Includes stable `id`.
- Includes generated `middle` point based on final processed geometry.
- Includes copied `data` markers and warnings.
- Includes deprecation/split mapping for route compatibility.

Eventually the site should move to ID-based joins, but that can be a later migration.

### `build/map.kml`

Generated KML output for Google Maps or Google Earth.

Characteristics:

- One Placemark per active segment.
- Placemark name is the segment display name.
- Coordinates come from the processed/elevated output.
- Line styles are generated from `roadType`.
- Description can include metadata such as warnings, notes, and road type.

### `build/report.json`

Generated machine-readable report for validation and editor feedback.

Suggested fields:

- `segmentCount`
- `newSegments`
- `deprecatedSegments`
- `missingMiddlePoints`
- `duplicateIds`
- `duplicateNames`
- `topologyWarnings`
- `endpointGaps`
- `routeCompatibilityWarnings`
- `elevationLookupFailures`

### `build/map-manifest.json`

Generated cache-control manifest for the static site.

Characteristics:

- Points to content-versioned files such as `bike_roads.<version>.geojson`.
- Uses the same version across GeoJSON, segments, and KML for one build.
- The public site fetches this manifest with `cache: "no-store"` and then loads
  the versioned files from it.
- If the manifest is unavailable, the site falls back to the stable legacy names.

## Processing Responsibilities

The processor should:

1. Read `data/map-source.geojson`.
2. Validate source schema and segment identity.
3. Interpolate sparse source coordinates into dense route geometry.
4. Query elevation service for generated coordinates.
5. Cache elevation lookups.
6. Remove redundant dense points where appropriate.
7. Calculate middle points from the final processed geometry.
8. Calculate elevation gain/loss.
9. Generate site GeoJSON.
10. Generate site `segments.json`.
11. Generate KML export.
12. Generate content-versioned files and `map-manifest.json`.
13. Write a validation report.

## Editor Responsibilities

The editor should modify only the canonical source file, not generated outputs.

Core operations:

- Select segment.
- Rename segment.
- Edit road type and metadata.
- Move vertex.
- Insert vertex on a line.
- Delete vertex.
- Add segment.
- Remove or deprecate segment.
- Split segment.
- Reverse segment direction.
- Snap endpoint to nearby endpoint.
- Add/edit/remove data markers.

The editor should offer a build/preview action that runs the processor and shows generated validation output.

## Split Behavior

Splitting is the highest-risk operation because route links encode segment IDs.

When splitting a segment:

1. Keep the original segment record as deprecated or mapped.
2. Create child segments with new stable IDs.
3. Add `splitFrom` to each child.
4. Add `routeAnchors` to the original segment as compact `[lng, lat]` coordinates.
5. Move data markers to the nearest child segment.
6. Generate child middle points during processing.
7. Preserve shared split coordinate as the endpoint of both child geometries.
8. Generate route anchors by distance so each split half has at least one anchor,
   and longer halves get additional anchors.
9. Validate that old route IDs can rebuild from route anchors or a middle fallback.

## Compatibility Strategy

Phase 1 should keep the current site behavior:

- The site can keep fetching `segments.json`.
- The site can keep joining by segment name.
- The generated `segments.json` can preserve the existing shape.
- `bike_roads_v18.geojson` can temporarily be overwritten or replaced by a stable `bike_roads.geojson`.

Later phases can migrate the site to stable ID-based joins.

## Open Questions

- Should draft segments be exported to KML, or only active segments?
- Should deprecated parent segments appear in KML as hidden/reference Placemarks?
- Should the editor be a standalone local app, or integrated into the current static site under `/editor/`?
- Should the processor require the elevation service by default, or allow `--skip-elevation` for fast local edits?
- Should generated files live under `build/` only, or should the processor copy current live artifacts to repo root?
