import assert from "node:assert/strict";
import { getRouteFeatureColor } from "../src/map/mapLayers.js";

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

console.log("Map layer style tests passed");
