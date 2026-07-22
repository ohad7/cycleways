import assert from "node:assert/strict";
import {
  revisionKeysEqual,
  updateGeoJsonSource,
} from "../editor/lib/map-source-updater.mjs";

assert.equal(revisionKeysEqual([1, "a", null], [1, "a", null]), true);
assert.equal(revisionKeysEqual([1], [2]), false);
assert.equal(revisionKeysEqual([{}], [{}]), false);

const cache = new Map();
let builds = 0;
let updates = 0;
let source = { setData() { updates += 1; } };
const getSource = () => source;
const buildData = () => {
  builds += 1;
  return { type: "FeatureCollection", features: [] };
};

assert.equal(
  updateGeoJsonSource({ cache, getSource, sourceId: "segments", buildData, revisionKey: [1] }).status,
  "updated",
);
assert.equal(
  updateGeoJsonSource({ cache, getSource, sourceId: "segments", buildData, revisionKey: [1] }).status,
  "skipped-revision",
);
assert.equal(builds, 1, "equal revisions skip collection construction");
assert.equal(updates, 1, "equal revisions skip Mapbox setData");

assert.equal(
  updateGeoJsonSource({ cache, getSource, sourceId: "segments", buildData, revisionKey: [2] }).status,
  "updated",
);
assert.equal(builds, 2);
assert.equal(updates, 2);

source = { setData() { updates += 1; } };
assert.equal(
  updateGeoJsonSource({ cache, getSource, sourceId: "segments", buildData, revisionKey: [2] }).status,
  "updated",
  "a new Mapbox source must be populated after a style change",
);
assert.equal(updates, 3);

console.log("map source updater ok");
