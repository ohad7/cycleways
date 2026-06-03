import assert from "node:assert/strict";
import {
  buildRouteGeometryFeatureCollection,
  buildRoutePointDragPreviewFeatureCollection,
  buildRouteDirectionPulseFeatureCollection,
  getRouteFeatureColor,
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

console.log("Map layer style tests passed");
