import assert from "node:assert/strict";
import {
  buildRouteGeometryFeatureCollection,
  buildRoutePointDragPreviewFeatureCollection,
  buildRouteDirectionPulseFeatureCollection,
  buildVideoCursorLayerData,
  buildRecommendedRoutesFeatureCollection,
  getRouteFeatureColor,
  normalizeVideoCursorVariant,
  VIDEO_CURSOR_DEFAULT_VARIANT,
  VIDEO_CURSOR_VARIANTS,
} from "../src/map/mapLayers.js";

assert.equal(
  getRouteFeatureColor({ properties: { roadType: "paved", stroke: "#0288d1" } }),
  "rgb(101, 170, 162)",
);

assert.equal(
  getRouteFeatureColor({ properties: { roadType: "dirt", stroke: "#ae9067" } }),
  "rgb(174, 144, 103)",
);

assert.equal(
  getRouteFeatureColor({ properties: { roadType: "road", stroke: "#8f2424" } }),
  "rgb(138, 147, 158)",
);

{
  const geometry = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 2, lat: 0 },
    { lng: 3, lat: 0 },
    { lng: 4, lat: 0 },
    { lng: 5, lat: 0 },
    { lng: 6, lat: 0 },
  ];
  const data = buildRouteGeometryFeatureCollection(geometry);
  assert.equal(data.features.length, 1, "route geometry renders as one feature");
  assert.equal(data.features[0].properties.affected, false);
}

{
  const geometry = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 2, lat: 0 },
    { lng: 3, lat: 0 },
    { lng: 4, lat: 0 },
    { lng: 5, lat: 0 },
    { lng: 6, lat: 0 },
  ];
  const data = buildRouteGeometryFeatureCollection(geometry, {
    mode: "insert",
    insertIndex: 2,
    points: [
      { lng: 0, lat: 0 },
      { lng: 2, lat: 0 },
      { lng: 4, lat: 0 },
      { lng: 6, lat: 0 },
    ],
  });
  const affected = data.features.filter(
    (feature) => feature.properties.affected,
  );
  assert.equal(affected.length, 1, "insert drag marks one stale route span");
  assert.deepEqual(
    affected[0].geometry.coordinates,
    [
      [2, 0],
      [3, 0],
      [4, 0],
    ],
  );
}

{
  const geometry = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 2, lat: 0 },
    { lng: 3, lat: 0 },
    { lng: 4, lat: 0 },
    { lng: 5, lat: 0 },
    { lng: 6, lat: 0 },
  ];
  const data = buildRouteGeometryFeatureCollection(geometry, {
    mode: "move",
    index: 2,
    points: [
      { lng: 0, lat: 0 },
      { lng: 2, lat: 0 },
      { lng: 4, lat: 0 },
      { lng: 6, lat: 0 },
    ],
  });
  const affected = data.features.filter(
    (feature) => feature.properties.affected,
  );
  assert.equal(affected.length, 1, "point drag marks the neighboring route span");
  assert.deepEqual(
    affected[0].geometry.coordinates,
    [
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ],
  );
}

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const pulse = buildRouteDirectionPulseFeatureCollection(route, 0.75);
  assert.equal(pulse.features.length, 1, "pulse renders a visible route slice");
  assert.equal(
    pulse.features[0].geometry.type,
    "LineString",
    "pulse is route-attached line geometry",
  );
  assert.ok(
    pulse.features[0].geometry.coordinates.length >= 2,
    "pulse has at least two coordinates",
  );
}

{
  const emptyPulse = buildRouteDirectionPulseFeatureCollection(
    [{ lat: 0, lng: 0 }],
    0.5,
  );
  assert.equal(emptyPulse.features.length, 0, "invalid pulse input stays hidden");
}

assert.equal(
  normalizeVideoCursorVariant(1),
  VIDEO_CURSOR_VARIANTS.CHEVRON_HALO,
  "cursor option 1 maps to chevron halo",
);
assert.equal(
  VIDEO_CURSOR_DEFAULT_VARIANT,
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
  "implicit cursor default is progress head pulse",
);
assert.equal(
  normalizeVideoCursorVariant(undefined),
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
  "omitted cursor variant uses progress head pulse",
);
assert.equal(
  normalizeVideoCursorVariant("5"),
  VIDEO_CURSOR_VARIANTS.PULSE_RING,
  "cursor option 5 maps to pulse ring",
);
assert.equal(
  normalizeVideoCursorVariant("6"),
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
  "cursor option 6 maps to progress head pulse",
);
assert.equal(
  normalizeVideoCursorVariant("progress-head"),
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD,
  "named cursor variants are accepted",
);

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0.005, fraction: 0.5 },
    route,
    "chevron-trail",
  );
  assert.equal(data.variant, VIDEO_CURSOR_VARIANTS.CHEVRON_TRAIL);
  assert.equal(data.cursor.features.length, 1, "cursor point is visible");
  assert.equal(data.trail.features.length, 1, "trail variant emits a route line");
  assert.equal(data.progress.features.length, 0, "trail variant does not emit progress");
  assert.equal(
    data.cursor.features[0].properties.showSymbol,
    true,
    "directional variants render a symbol",
  );
  assert.ok(
    Number.isFinite(data.cursor.features[0].properties.bearing),
    "directional variants get a computed bearing",
  );
}

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0.005, fraction: 0.5 },
    route,
    "progress-head",
  );
  assert.equal(data.progress.features.length, 1, "progress variant emits a route line");
  assert.equal(data.trail.features.length, 0, "progress variant has no trail line");
  assert.equal(
    data.cursor.features[0].properties.showCore,
    true,
    "progress variant keeps a compact head marker",
  );
}

{
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0, fraction: 0.1 },
    [],
    "pulse-ring",
  );
  assert.equal(data.trail.features.length, 0, "missing geometry hides route-attached lines");
  assert.equal(
    data.cursor.features[0].properties.showPulse,
    true,
    "pulse variant sets the pulse layer flag",
  );
}

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0.005, fraction: 0.5 },
    route,
    "progress-head-pulse",
  );
  assert.equal(
    data.variant,
    VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
    "combined variant is normalized",
  );
  assert.equal(
    data.progress.features.length,
    1,
    "combined variant emits the progress route line",
  );
  assert.equal(
    data.cursor.features[0].properties.showPulse,
    true,
    "combined variant enables the pulse layer",
  );
  assert.ok(
    data.cursor.features[0].properties.pulseRadius < 23,
    "combined variant uses a smaller static pulse than pulse-ring",
  );
  assert.equal(
    data.cursor.features[0].properties.symbolColor,
    "#ffffff",
    "combined variant keeps the directional progress head",
  );
}

{
  const preview = buildRoutePointDragPreviewFeatureCollection({
    mode: "move",
    index: 1,
    lng: 35.2,
    lat: 33.2,
    points: [
      { lng: 35.0, lat: 33.0 },
      { lng: 35.1, lat: 33.1 },
      { lng: 35.3, lat: 33.3 },
    ],
  });
  assert.equal(
    preview.features.filter((feature) => feature.geometry.type === "LineString")
      .length,
    2,
    "middle-point drag preview has previous and next guide lines",
  );
  assert.equal(
    preview.features.filter((feature) => feature.geometry.type === "Point")
      .length,
    1,
    "drag preview has one cursor halo point",
  );
}

{
  const preview = buildRoutePointDragPreviewFeatureCollection({
    mode: "insert",
    insertIndex: 1,
    lng: 35.2,
    lat: 33.2,
    points: [
      { lng: 35.0, lat: 33.0 },
      { lng: 35.3, lat: 33.3 },
    ],
  });
  assert.equal(
    preview.features.filter((feature) => feature.geometry.type === "LineString")
      .length,
    2,
    "insert drag preview connects surrounding route points",
  );
}

{
  const routes = [
    {
      slug: "bright-one",
      geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }],
      color: "#e8590c",
      tier: "bright",
      hovered: false,
    },
    {
      slug: "ghost-one",
      geometry: [{ lng: 2, lat: 2 }, { lng: 3, lat: 3 }],
      color: "#ae3ec9",
      tier: "ghost",
      hovered: false,
    },
    {
      slug: "hovered-one",
      geometry: [{ lng: 4, lat: 4 }, { lng: 5, lat: 5 }],
      color: "#7048e8",
      tier: "bright",
      hovered: true,
    },
  ];
  const fc = buildRecommendedRoutesFeatureCollection(routes);
  assert.equal(fc.features.length, 3, "one feature per valid route");
  assert.equal(fc.features[0].properties.tier, "bright");
  assert.equal(fc.features[0].properties.hovered, false);
  assert.equal(fc.features[1].properties.tier, "ghost");
  assert.equal(fc.features[2].properties.hovered, true);

  // Missing tier defaults to "bright"; too-short geometry is dropped.
  const fallback = buildRecommendedRoutesFeatureCollection([
    { geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }], color: "#000" },
    { geometry: [{ lng: 0, lat: 0 }], color: "#000", tier: "ghost" },
  ]);
  assert.equal(fallback.features.length, 1, "drops <2-point geometry");
  assert.equal(fallback.features[0].properties.tier, "bright", "tier defaults to bright");
}

console.log("test-map-layers.mjs passed");
