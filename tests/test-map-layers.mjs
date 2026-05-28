import assert from "node:assert/strict";
import {
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

console.log("Map layer style tests passed");
