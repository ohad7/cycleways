import assert from "node:assert/strict";
import { classifyRoute } from "../editor/server.mjs";

const places = [
  { id: "beit-hillel", name: "בית הלל", lat: 33.2177, lng: 35.6097 },
  { id: "kfar-szold",  name: "כפר סאלד", lat: 33.1971, lng: 35.6552 },
];
const zones = [
  { id: "hula-valley", name: "עמק החולה",
    polygon: [[35.55, 33.15], [35.65, 33.15], [35.65, 33.22], [35.55, 33.22], [35.55, 33.15]] },
];

// Easy, flat loop near a known place -> family
const easyFlatLoop = {
  geometry: [
    { lat: 33.2170, lng: 35.6090, elevation: 100 },
    { lat: 33.2180, lng: 35.6100, elevation: 102 },
    { lat: 33.2185, lng: 35.6110, elevation: 105 },
    { lat: 33.2175, lng: 35.6098, elevation: 100 },
  ],
  roadTypeFractions: { paved: 0.8, dirt: 0.2, road: 0.0 },
  qualityScore: 4.2,
};

const meta = classifyRoute(easyFlatLoop, { places, zones });
assert.equal(meta.regionId, "hula-valley");
assert.ok(meta.passesNear.includes("beit-hillel"));
assert.equal(meta.difficulty, "easy");
assert.ok(meta.distanceKm > 0 && meta.distanceKm < 1);
assert.ok(meta.elevationGainM > 0 && meta.elevationGainM < 20);
assert.deepEqual(meta.routeShape, { type: "circular", endpointDistanceM: 93 });
assert.equal(meta.surfaceType, "paved");
// family wins by priority over scenic: easy + roadMix.road < 0.1 + qualityScore >= 3
assert.equal(meta.style, "family");

// Anything 20km or longer is at least moderate effort.
const longFlat = {
  geometry: [
    { lat: 33.20, lng: 35.60, elevation: 100 },
    { lat: 33.20, lng: 35.83, elevation: 105 },
  ],
  roadTypeFractions: { paved: 0.9, dirt: 0.1, road: 0.0 },
  qualityScore: 3.5,
};
const longFlatMeta = classifyRoute(longFlat, { places, zones });
assert.equal(longFlatMeta.difficulty, "moderate");
assert.equal(longFlatMeta.surfaceType, "paved");

// Hard climby route -> hard, sporty
const hardClimb = {
  geometry: [
    { lat: 33.20, lng: 35.65, elevation: 100 },
    { lat: 33.25, lng: 35.70, elevation: 800 },
    { lat: 33.30, lng: 35.75, elevation: 1200 },
  ],
  roadTypeFractions: { paved: 0.6, dirt: 0.4, road: 0.0 },
  qualityScore: 3.0,
};
const hardMeta = classifyRoute(hardClimb, { places, zones });
assert.equal(hardMeta.difficulty, "hard");
assert.equal(hardMeta.style, "sporty");
assert.equal(hardMeta.routeShape.type, "one_way");
assert.ok(hardMeta.routeShape.endpointDistanceM > 1000);
assert.equal(hardMeta.surfaceType, "mixed");

// Dirt-heavy, moderate -> adventurous
const dirty = {
  geometry: [
    { lat: 33.20, lng: 35.60, elevation: 100 },
    { lat: 33.22, lng: 35.62, elevation: 250 },
  ],
  roadTypeFractions: { paved: 0.2, dirt: 0.7, road: 0.1 },
  qualityScore: 3.2,
};
const dirtyMeta = classifyRoute(dirty, { places, zones });
assert.equal(dirtyMeta.difficulty, "moderate");
assert.equal(dirtyMeta.style, "adventurous");
assert.equal(dirtyMeta.surfaceType, "mixed");

const dirtSurface = classifyRoute({
  geometry: [
    { lat: 33.20, lng: 35.60, elevation: 100 },
    { lat: 33.21, lng: 35.61, elevation: 110 },
  ],
  roadTypeFractions: { paved: 0.1, dirt: 0.85, road: 0.05 },
  qualityScore: 3.2,
}, { places, zones });
assert.equal(dirtSurface.surfaceType, "dirt");

console.log("classifyRoute tests passed");
