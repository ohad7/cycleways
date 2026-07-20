# Map Editor

This is a local editor for the canonical map source at `data/map-source.geojson`.
It edits the source file directly and then runs the processing pipeline to generate:

- `build/public-data/bike_roads.geojson`
- `build/public-data/segments.json`
- `build/public-data/base-routing-shards/manifest.json`
- `build/public-data/exports/map.kml`
- `build/public-data/map-manifest.json`
- `build/report.json`

The `Promote` action copies a fresh full build into the files used by the
current site:

- `build/public-data/map-manifest.json` -> `public-data/map-manifest.json`
- `build/public-data/bike_roads.geojson` -> `public-data/bike_roads.geojson`
- `build/public-data/segments.json` -> `public-data/segments.json`
- `build/public-data/base-routing-shards/` -> `public-data/base-routing-shards/`
- `build/public-data/exports/map.kml` -> `public-data/exports/map.kml`

Promote also removes older `bike_roads.<version>.geojson`,
`segments.<version>.json`, `base-routing-network.<version>.json`, legacy
`base-routing-shards.<version>/`, root-level stable runtime files, old
`public-data/base-routing-network.json`, and old `exports/map*.kml` files.
Runtime artifacts now live under `public-data/` with stable names. The map
manifest version and per-shard hashes provide browser cache busting, so Git only
needs to record files whose contents changed.

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

- **Network** is the primary authoring workspace. Switch between **CW network**
  and **Base network** focus without changing the camera. **Show other network
  for context** draws the non-focused network faintly without giving it normal
  map-click ownership.
- In CW focus, select a segment from the map or Segment drawer, edit its source
  geometry and metadata, inspect its rideable base-edge path, and open the one
  Issues queue for exceptions. A compact status reports Updating, Current,
  Needs a decision, or Blocked with a concrete cause.
- Add a segment by clicking base edges in order and pressing **Done**. Done is
  the curator's decision: a continuous policy-safe path and its validated exact
  reverse become current without another Accept or direction-review step.
- Ordinary high-confidence, full-coverage bidirectional matches are applied
  automatically. Directional controls appear only for distinct carriageways,
  ambiguity, access-precedence decisions, unavailable directions, or defects.
- **Inspect mapping** exposes exact edge references and diagnostics. Existing
  current mappings can be edited directly; they do not need to be cleared or
  unaccepted first.
- Freehand drawing remains available where base coverage is missing. Add or
  correct the physical path in Base focus when the base network itself is the
  problem.
- In Base focus, Explore visualizes the complete graph and filtered views such
  as raw `bicycle=no`, normalized blocked directions, conditional traversal,
  manual edges, and reviewed overrides. Search accepts an edge or OSM way ID.
- Switch Base focus to **Edit / review** to create, copy, reshape, split, or
  delete manual edges and to review traversal evidence. Newly drawn manual
  edges default to reviewed bidirectional; copied edges inherit their source
  policy. Saving a base edit automatically rebuilds the graph and refreshes
  affected CW routing evidence.
- Deliberate source edits autosave after completion. There is no routine Save,
  Recalculate, Refresh V2, or per-direction Accept sequence. The editor keeps
  the last valid published path while an invalid revision is shown as Blocked.
- Build release remains explicit and is enabled only after authoring is current.
  Promote remains fail-closed and requires a fresh release build with no issues.
- Add, edit, drag, and remove per-segment data markers, and switch the base map
  between outdoors, satellite, streets, and light views as before.

All active data markers are shown on the map with the same icon set used by the
site. Dragging a marker snaps its saved location back onto that marker's segment.

Drawing mode keeps changes as a temporary draft until Done is pressed. Escape or
Cancel discards the draft, and Backspace/Delete removes the last drafted point.
After Done, the editor saves and refreshes routing evidence automatically.

Splitting deprecates the original segment record and creates two active child
segments. The deprecated parent keeps compact `routeAnchors` as `[lng, lat]`
coordinates so old route URLs can rebuild through points along the current map
after a build. Longer split halves get more anchors automatically.

The build panel always runs a full elevation build, so the local elevation service
must be running before Build. Full builds fail when elevation lookups fail, and
Promote requires a full build with zero elevation failures.

Build also produces the promoted public base-routing asset from the current
elevated OSM/manual graph and accepted CW base overlay. Before running the map
build, the editor refreshes stale base graph artifacts automatically: manual
base-edge edits trigger a graph/match recalculation, and stale elevated graph
artifacts trigger an elevation rebuild. Build still blocks invalid accepted
overlay refs so Promote cannot publish a routing bundle that no longer matches
the base graph.

Build also emits experimental routing shard files under
`build/public-data/base-routing-shards/` for browser-local shard routing comparison.
Promote copies this stable shard directory, but the full promoted base-routing
asset remains the default public baseline. Append
`?routingShards=1` locally to exercise shard-backed waypoint routing. Build
writes compact binary `.cwb` shard files by default; append
`?routingShards=1&routingShardFormat=compact` to force that format explicitly.

Build uses accepted overlay edge refs for promoted public CycleWays display
geometry too. Accepted segments in `bike_roads` are drawn from their ordered,
directed base edges so the line riders see matches the hidden routing graph.
Build drapes processed source elevation onto that base-edge display path for the
current public segment details. Unresolved segments keep their processed source
geometry as a migration fallback; CW network focus remains the source geometry
editor.

The public site loads `public-data/map-manifest.json` with `cache: "no-store"`
and then loads the files listed in that manifest relative to `public-data/`.
Shard routing also adds the manifest version to the stable shard-manifest
request and each shard's content hash to the shard request. If the manifest is
missing, the site falls back to `public-data/bike_roads.geojson` and
`public-data/segments.json`.

## Data Contract

KML is an export format for Google Maps/Google Earth review. The editable source of
truth is `data/map-source.geojson`; generated artifacts should come from the processor,
not manual edits.

Directional CW mapping authority is stored in
`data/cw-base-overlay.v2.staged.json`. It records each logical segment's A→B and
B→A rideable base-edge paths, evidence, and provenance; it is not a replacement
for canonical segment geometry. `data/cw-base-overlay.json` is maintained as a
V1 compatibility projection for existing build and audit consumers, not as a
curator approval stage.

Manual base edges drawn in the editor are stored in
`data/manual-base-edges.geojson`. They are part of the base graph input, not the
CycleWays source geometry.

When an OSM base edge is copied to a manual edge, accepted overlay references
are migrated to the manual replacement. When a manual edge is split, whole-edge
references are expanded to the ordered children; mappings with partial or
unknown-direction references are marked `needs_edit` rather than migrated
ambiguously. The editor persists the manual-edge and overlay updates together.
