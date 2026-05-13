# Map Asset Size Design

## Context

The public site currently loads the CycleWays network from generated GeoJSON.
That file is produced by the processing pipeline from the canonical map source,
then promoted as both a stable fallback file and a content-versioned file.

The generated GeoJSON is a runtime artifact, not the source of truth. The source
of truth remains `data/map-source.geojson`, and the KML export remains useful for
Google Maps inspection.

## Current Low-Risk Change

The low-risk optimization is to compact only the generated site GeoJSON:

- write `bike_roads.geojson` without pretty-print indentation;
- round longitude and latitude to 6 decimal places;
- round elevation to 1 decimal place;
- keep all coordinates, segment names, properties, scores, data markers, and route metadata;
- keep `data/map-source.geojson` readable and full precision;
- keep generated KML based on the full processed coordinates.

This reduces transfer and parse size without changing the route shape at the
point-count level. Six decimal places for latitude/longitude is roughly
decimeter-level precision, which is below the practical accuracy of the source
map editing and GPS display use case. Elevation at 0.1m precision is also finer
than the elevation service accuracy expected by the app.

## Why Not Simplify Geometry Now

Removing intermediate points can produce larger wins, but it changes the actual
polyline used by the site. That can affect:

- route rendering;
- point snapping;
- route warnings and data-marker pass-through checks;
- GPX output;
- distance calculations;
- elevation gain/loss calculations;
- future routing quality.

Initial experiments showed that 2D-only simplification can preserve visual shape
while damaging elevation gain/loss heavily. Elevation-aware simplification looks
promising, but it needs explicit validation gates before promotion.

## Future Options

Future geometry simplification should be added only after a validation suite can
compare simplified output against the full processed output. Candidate gates:

- per-segment distance delta threshold;
- per-segment elevation gain/loss delta threshold;
- maximum point-to-line deviation threshold;
- data marker remains on or near its owning segment;
- warning marker triggering behaves the same for representative routes;
- GPX output comparison for representative saved routes;
- route decoding compatibility for existing encoded routes.

If those gates are added, the simplifier should probably be elevation-aware
rather than purely 2D Douglas-Peucker.
