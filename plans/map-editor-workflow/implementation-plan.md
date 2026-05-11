# Map Editor Workflow Implementation Plan

## Principles

- Keep generated files out of the editing path.
- Preserve current site behavior while introducing the new workflow.
- Make validation explicit before changing the public app.
- Avoid route-link breakage by treating segment IDs as stable compatibility contracts.

## Phase 0: Organize The Existing Processor

Status: implemented in `processing/build_map.py`.

Move the copied processor into the planning target structure without changing behavior yet:

```text
processing/build_map.py
processing/cache/
data/
build/
exports/
```

Initial cleanup tasks:

- Move root `main.py` to `processing/build_map.py`.
- Replace hard-coded `input.kml` and `segments.json` with CLI arguments.
- Replace hard-coded output file names with `--out-dir`.
- Put `elevation_cache.json` under `processing/cache/`.
- Add `--elevation-url`.
- Add `--skip-elevation` for fast testing.
- Fix the function that references global `input_file` instead of its `input_kml` argument.

Acceptance criteria:

- The old KML-based flow can still run from the new path.
- Outputs match the previous processor behavior except for deterministic output paths.

## Phase 1: Add Validation Around Current Data

Status: implemented as `build/report.json` output from `processing/build_map.py`.

Create a validator that runs against the current generated files.

Checks:

- GeoJSON is a valid FeatureCollection.
- Every route feature is a LineString.
- Every active GeoJSON segment has metadata.
- Every active metadata entry has a GeoJSON feature.
- IDs are unique.
- Names are unique.
- Active entries have middle points.
- Deprecated entries have a compatibility reason, `routeAnchors`, or a middle-point fallback.
- Data marker locations are valid `[lat, lng]`.
- Endpoint topology has no unexpected disconnected components.
- Endpoint gaps above configured tolerance are reported.

Acceptance criteria:

- Validator can explain the current known mismatches without failing the whole workflow.
- Validation emits `build/report.json`.

## Phase 2: Create Canonical Source GeoJSON

Status: initial migration implemented via `processing/migrate_to_source_geojson.py`; initial source lives at `data/map-source.geojson`.

Generate a first version of:

```text
data/map-source.geojson
```

Inputs:

- Current `bike_roads_v18.geojson`.
- Current `segments.json`.

Migration behavior:

- Merge segment metadata into GeoJSON feature properties.
- Preserve every existing segment ID.
- Preserve names and road style.
- Preserve data markers.
- Mark stale metadata entries as deprecated or legacy records.
- Keep source coordinates sparse if possible; initially it is acceptable to preserve current coordinates and simplify later.

Acceptance criteria:

- Building from `data/map-source.geojson` can reproduce equivalent site outputs.
- Existing route URLs still decode through generated `segments.json`.

## Phase 3: Rewrite Processor Around Source GeoJSON

Status: first pass implemented. `processing/build_map.py` supports `--input-geojson data/map-source.geojson` and generates GeoJSON, segments JSON, KML, and report artifacts.

Change the processor so `data/map-source.geojson` becomes the primary input.

Processing steps:

1. Load source GeoJSON.
2. Validate schema.
3. Interpolate segment coordinates to configured spacing.
4. Query/cache elevations.
5. Calculate middle points from processed geometry.
6. Calculate elevation metrics.
7. Generate `build/bike_roads.geojson`.
8. Generate `build/segments.json`.
9. Generate `build/map.kml`.
10. Generate content-versioned map files.
11. Generate `build/map-manifest.json`.
12. Generate `build/report.json`.

Acceptance criteria:

- KML output opens in Google Maps or Google Earth.
- Generated GeoJSON works with the current site.
- Generated `segments.json` works with current route sharing.
- Processor can run repeatedly with deterministic outputs.

## Phase 4: Add Editor MVP

Status: implemented in `editor/`. The editor runs locally, edits `data/map-source.geojson`, saves the source file, runs the processor, and shows the generated validation report.

Create a local editor that edits only `data/map-source.geojson`.

Suggested structure:

```text
editor/index.html
editor/editor.js
editor/styles.css
editor/server.mjs
```

MVP operations:

- Open source map.
- Select segment.
- Edit name, road type, status, notes.
- Move vertices.
- Insert vertices.
- Delete vertices.
- Add, edit, drag, and remove data markers.
- Save source file.
- Run build.
- Show validation report.
- Preview generated output layer.

Acceptance criteria:

- A normal segment geometry edit can be saved, built, and viewed in the site.
- The generated KML reflects the same edit.
- Validation failures are visible in the editor.

## Phase 5: Add Split And Route Compatibility Tools

Status: implemented for new splits. The editor can split the selected segment at an internal vertex, deprecate the original parent segment, create two active child segments with stable IDs, preserve the shared split coordinate, and assign data markers to the nearest half. The deprecated parent gets compact `routeAnchors` as `[lng, lat]` coordinates, child records keep `splitFrom`, and route loading rebuilds old parent IDs from anchors or middle-point fallback.

Add controlled segment splitting.

Editor behavior:

- User selects split point.
- Editor creates child segments.
- Original segment becomes deprecated and keeps route-rebuild anchors.
- Child segments get new stable IDs.
- Data markers are assigned to nearest child.
- Build process validates route anchor compatibility.

Processor/site behavior:

- Generated `segments.json` includes enough mapping to expand old IDs.
- Route decoding handles deprecated split parents by replacing them with child IDs.

Acceptance criteria:

- Splitting a segment does not make old shared route URLs silently lose that segment.
- Generated report flags invalid route anchors and split parents without anchors or middle fallback.

## Phase 6: Update The Public Site To Stable Generated Names

Status: interim promote workflow implemented in `editor/server.mjs`. A fresh full
build can be promoted to a cache-safe `map-manifest.json`, content-versioned
map files, and compatibility copies at the current site filenames:
`bike_roads_v18.geojson`, `segments.json`, and `exports/map.kml`.

Replace version-specific file references.

Current:

```text
bike_roads_v18.geojson
segments.json
```

Target:

```text
bike_roads.geojson
segments.json
map-manifest.json
```

Acceptance criteria:

- Site loads generated outputs.
- Site loads content-versioned outputs through `map-manifest.json`.
- Existing tests still pass.
- No manual edit is needed in generated files after running the processor.

## Phase 7: Optional ID-Based Site Migration

Move the runtime join from name-based to ID-based.

Tasks:

- Include `id` in GeoJSON feature properties.
- Load metadata by ID.
- Keep name-keyed fallback during migration.
- Update route encoding/decoding to use IDs directly from features.

Acceptance criteria:

- Segment rename does not break metadata joins or route URLs.
- Name remains display-only.

## Validation Checklist For Every Build

- `build/bike_roads.geojson` loads in the site.
- `build/segments.json` has no duplicate IDs.
- `build/map-manifest.json` points to existing versioned files.
- All active segments have middle points.
- KML export opens in Google Maps or Google Earth.
- Route decoding works for a sample of existing URLs.
- Topology report has no unexpected new disconnected components.
- Elevation lookup failures are zero, or explicitly accepted.
- Generated files are deterministic when source files do not change.

## First Implementation Slice

The first concrete slice should be small:

1. Move/refactor the processor into `processing/build_map.py`.
2. Add CLI arguments and deterministic output paths.
3. Add a minimal validator/report.
4. Keep KML as input for this slice.

Only after that should we migrate the canonical source to GeoJSON. This reduces risk because it preserves the known pipeline while adding observability and repeatability.
