import assert from "node:assert/strict";
import {
  routeDisplayImage,
  routeDifficultyLabel,
  routePassesThroughPlaceIds,
  routeShapeLabel,
  routeShapeType,
  routeStartPlaceIds,
  routeSurfaceLabel,
  routeSurfaceType,
} from "../packages/core/src/data/catalog.js";

const hero = routeDisplayImage({
  name: "Route",
  heroImage: { photo: "hero.webp", thumbnail: "hero-thumb.webp", alt: "Hero alt" },
  start: { name: "Start", images: [{ photo: "start.webp" }] },
});
assert.deepEqual(hero, { photo: "hero.webp", thumbnail: "hero-thumb.webp", alt: "Hero alt" });

const start = routeDisplayImage({
  name: "Route",
  start: { name: "Start", images: [{ photo: "start.webp", thumbnail: "start-thumb.webp" }] },
});
assert.deepEqual(start, { photo: "start.webp", thumbnail: "start-thumb.webp", alt: "Start" });

const snapshotPoi = routeDisplayImage(
  { name: "Route" },
  {
    pois: {
      activeDataPoints: [
        { id: "b", name: "Second", routeProgressMeters: 20, images: [{ photo: "b.webp" }] },
        { id: "a", name: "First", routeProgressMeters: 10, images: [{ photo: "a.webp" }] },
      ],
    },
  },
);
assert.deepEqual(snapshotPoi, { photo: "a.webp", thumbnail: "a.webp", alt: "First" });

assert.equal(routeDisplayImage({ name: "Route" }), null);

assert.equal(routeShapeType({ routeShape: { type: "circular" } }), "circular");
assert.equal(routeShapeType({ routeShape: { type: "one_way" } }), "one_way");
assert.equal(routeShapeType({ routeShape: "one-way" }), "one_way");
assert.equal(routeShapeType({}), null);
assert.equal(routeShapeLabel({ routeShape: { type: "circular" } }), "מעגלי");
assert.equal(routeShapeLabel({ routeShape: { type: "one_way" } }), "חד כיווני");
assert.equal(routeShapeLabel({}), "");

assert.deepEqual(
  routePassesThroughPlaceIds({ passesNear: ["beit-hillel", "dafna"] }),
  ["beit-hillel", "dafna"],
);
assert.deepEqual(
  routeStartPlaceIds({
    routeShape: { type: "circular" },
    passesNear: ["beit-hillel", "dafna"],
  }),
  ["beit-hillel", "dafna"],
);
assert.deepEqual(
  routeStartPlaceIds({
    routeShape: { type: "one_way" },
    passesNear: ["beit-hillel"],
    startPlaceIds: ["dafna"],
  }),
  ["dafna"],
);
assert.deepEqual(routeStartPlaceIds({ routeShape: { type: "one_way" } }), []);

assert.equal(routeDifficultyLabel({ difficulty: "easy" }), "קל");
assert.equal(routeDifficultyLabel({ difficulty: "moderate" }), "בינוני");
assert.equal(routeDifficultyLabel({ difficulty: "hard" }), "קשה");
assert.equal(routeDifficultyLabel("hard"), "קשה");

assert.equal(routeSurfaceType({ surfaceType: "paved" }), "paved");
assert.equal(routeSurfaceType({ surfaceType: "mixed" }), "mixed");
assert.equal(routeSurfaceType({ surfaceType: "dirt" }), "dirt");
assert.equal(routeSurfaceType({ roadMix: { paved: 0.7, road: 0.15, dirt: 0.15 } }), "paved");
assert.equal(routeSurfaceType({ roadMix: { paved: 0.1, road: 0.05, dirt: 0.85 } }), "dirt");
assert.equal(routeSurfaceType({ roadMix: { paved: 0.55, road: 0.1, dirt: 0.35 } }), "mixed");
assert.equal(routeSurfaceLabel({ surfaceType: "paved" }), "סלול");
assert.equal(routeSurfaceLabel({ surfaceType: "mixed" }), "סלול/שטח");
assert.equal(routeSurfaceLabel({ surfaceType: "dirt" }), "שטח");
assert.equal(routeSurfaceLabel({}), "");

console.log("route catalog helper tests passed");
