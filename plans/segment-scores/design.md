# Segment Scores Design

## Goal

Add maintainable per-segment quality data that can be edited in the map editor,
generated into the site data, optionally displayed to users for exceptional
segments, and later used by route planning.

Scores are editorial data, not generated geometry data. They should therefore
live in the canonical source file:

```text
data/map-source.geojson
```

## Initial Decision

Use a small quality object on each segment:

```json
{
  "quality": {
    "overall": 3,
    "safety": 3,
    "comfort": 3,
    "scenery": 3
  }
}
```

Rules:

- Each value is an integer from `1` to `5`.
- Missing quality should be normalized to
  `{ overall: 3, safety: 3, comfort: 3, scenery: 3 }` during the initial
  migration.
- Active segments should always have quality after this change.
- Deprecated, draft, and legacy records may keep quality if useful, but route
  planning should ignore deprecated geometry unless compatibility expansion maps
  it to active child segments.

This gives us enough structure for future routing without creating a large
maintenance burden. `safety` is intentionally coarse and should capture only
clear rider-risk issues. Surface, slope, interruptions, and general ride feel
are folded into `comfort`.

## Meaning

The `overall` score should represent practical riding quality from the rider's
point of view:

- `1` - avoid when possible.
- `2` - usable but unpleasant or risky.
- `3` - normal/default segment.
- `4` - good preferred segment.
- `5` - excellent segment worth preferring.

The hidden dimensions are editorial inputs:

- `safety` - obvious rider-risk issues such as traffic exposure, dangerous
  crossings, poor visibility, or places we would actively avoid.
- `comfort` - surface quality, roughness, steepness, gates, interruptions,
  and general ride smoothness.
- `scenery` - landscape, shade, quietness, and overall visual riding experience.

The public site should not explain or expose dimensions in the first slice.

## Source Data

The editor should write `quality` directly into each feature's `properties`:

```json
{
  "type": "Feature",
  "properties": {
    "id": 62,
    "name": "כביש 9974",
    "status": "active",
    "roadType": "paved",
    "quality": {
      "overall": 3,
      "safety": 3,
      "comfort": 3,
      "scenery": 3
    }
  },
  "geometry": {
    "type": "LineString",
    "coordinates": []
  }
}
```

This follows the same path as existing segment metadata such as `data`, `todo`,
and `notes`.

## Generated Outputs

`processing/build_map.py` already copies non-style, non-generated source
properties into `segments.json`. With validation in place, `quality` should flow
through automatically:

```json
{
  "כביש 9974": {
    "id": 62,
    "status": "active",
    "quality": {
      "overall": 3,
      "safety": 3,
      "comfort": 3,
      "scenery": 3
    },
    "middle": {
      "longitude": 35.603237,
      "latitude": 33.229582,
      "elevation": 140
    }
  }
}
```

The generated route GeoJSON does not need quality initially because the site
already has `segments.json` loaded for metadata. If map styling by quality
becomes useful, we can also include it in GeoJSON feature properties later.

KML does not need quality in the first slice. A later enhancement can include it
in Placemark descriptions if it helps Google Maps inspection.

## Editor Experience

Add compact quality controls in the Segment panel near `Road Type`.

Preferred editor UI:

- Five clickable star buttons for `overall`.
- Collapsible or secondary controls for `safety`, `comfort`, and `scenery`,
  also using five-step inputs.
- A visible numeric fallback label such as `3/5`.
- Keyboard-accessible buttons with clear selected state.
- Default value is `3` for each quality field.

Behavior:

- Selecting a segment with no quality shows defaults and marks nothing dirty
  until the user changes it, or until the migration explicitly normalizes the
  file.
- Changing quality writes `feature.properties.quality`.
- New segments start with default quality.
- Split children inherit the original segment quality.
- Existing data-marker editing remains separate; quality is segment-level data,
  not a data point on the route.

## Feature Flags

Use separate feature flags so data collection can start before public UX or
routing behavior changes:

```js
segmentQualityEditor: true
segmentQualityPublicDisplay: false
segmentQualityRouting: false
```

Editor support can be enabled locally first. Public display and routing should
remain off until the data is trustworthy enough.

Flags can be overridden through `window.CYCLEWAYS_FEATURE_FLAGS` before loading
the app script, or locally with `localStorage` keys such as
`cycleways.flags.segmentQualityPublicDisplay=true`.

## Public Site Display

Do not show stars for every segment. A default `3` can read as a mediocre
rating even when it means "normal/default".

When `segmentQualityPublicDisplay` is enabled, show only exceptional segment
badges:

- `overall >= 5` - show a positive badge or five stars.
- `overall <= 2` - consider showing a caution only if this does not duplicate
  existing warning/data markers.
- `overall == 3` - show nothing.
- `overall == 4` - likely show nothing initially, or reserve it for detailed
  route views later.

Initial display helper:

```text
★★★☆☆
```

The displayed quality should default to `3` if old cached or legacy segment
data does not include quality.

Avoid using quality to change main route-line styling in the first slice. Line
color currently communicates road type and selection state, so mixing quality
into that could make the map harder to read.

## Route Planning Use

When route planning is added, quality should be a preference weight rather than
a hard rule.

The cost model can start with:

```text
edgeCost = distanceMeters * qualityPenalty(effectiveQuality)
```

Example penalties:

```text
5 -> 0.75
4 -> 0.90
3 -> 1.00
2 -> 1.25
1 -> 1.75
```

This lets the planner prefer better roads without creating absurd detours. The
penalty table should become a user preference later, for example "fastest",
"balanced", and "best riding quality".

Once the route planner needs dimensions, it can combine them without changing
the source format:

```text
effectiveQuality = 0.55 * overall + 0.2 * safety + 0.15 * comfort + 0.1 * scenery
```

For comfort-focused routing, the weights can shift toward `comfort`. For
safety-focused routing, the weights can shift toward `safety`.

## Future Options

Possible later additions:

- `qualityReason` - short editor-only explanation for why the segment has that
  quality.
- More dimensions, but only if the current three hidden dimensions prove too
  coarse.
- Confidence level, because some scores will be based on actual riding and
  others on map/aerial inspection.
- Per-direction quality if a road is much better in one direction than the
  other.
- Automatic quality suggestions from road type, slope, traffic warnings, surface,
  or data markers.

Do not add these in the first slice unless there is an immediate editorial need.
The four-value quality object is still easy to backfill and maintain.
