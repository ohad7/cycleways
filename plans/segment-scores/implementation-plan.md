# Segment Scores Implementation Plan

## Phase 1: Data Model And Validation

- Add `quality` validation to `editor/server.mjs`.
- Required quality fields are `overall`, `safety`, `comfort`, and `scenery`.
- Valid values are integers `1` through `5`.
- Treat missing quality as acceptable only during transition, but normalize
  active source segments to
  `{ overall: 3, safety: 3, comfort: 3, scenery: 3 }` in this change.
- Add default quality to every active segment in `data/map-source.geojson`.

Acceptance criteria:

- Saving source data with invalid quality returns a clear editor error.
- Every active source feature has `properties.quality.overall`,
  `properties.quality.safety`, `properties.quality.comfort`, and
  `properties.quality.scenery`.

## Phase 2: Editor Controls

- Add feature flags for editor, public display, and routing use.
- Add an overall quality field to `editor/index.html`.
- Add secondary controls for `safety`, `comfort`, and `scenery`.
- Add star-button rendering and state handling in `editor/editor.js`.
- Load selected segment quality into the form with defaults of `3`.
- Persist quality changes to `feature.properties.quality`.
- New segments start with default quality.
- Split child segments inherit the parent quality.

Acceptance criteria:

- Selecting a segment displays its quality.
- Clicking a star marks the source dirty and updates the selected segment.
- Saving and reloading the editor preserves quality.

## Phase 3: Processing Output

- Confirm `processing/build_map.py` carries `quality` from source properties to
  generated `segments.json`.
- Add processor validation/reporting for missing or invalid active quality if
  the existing report path is the better place for build-time checks.
- Run a build and verify generated `build/segments.json` includes quality.

Acceptance criteria:

- Generated `segments.json` includes `quality` for active segments.
- Generated outputs remain compatible with existing route sharing.

## Phase 4: Public Site Display

- Add a small quality formatter in `script.js`.
- Gate public display behind `segmentQualityPublicDisplay`.
- Show only exceptional badges, not stars for every segment.
- Default to `3` for legacy segment records without quality.

Acceptance criteria:

- With the flag disabled, the public site does not show quality.
- With the flag enabled, exceptional segments can show a badge.
- Missing legacy quality data does not break the UI.

## Phase 5: Tests And Checks

- Add or update lightweight tests for quality defaults and generated metadata if
  the current test suite has a suitable route.
- Run the editor/server validation path.
- Run `node --test` for the route-related tests.
- Run a local build from `data/map-source.geojson`.

Acceptance criteria:

- Validation rejects invalid quality.
- Existing route encoding/decoding still passes.
- Build succeeds and generated metadata includes quality.
