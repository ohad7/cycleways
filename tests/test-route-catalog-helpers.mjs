import assert from "node:assert/strict";
import { routeDisplayImage } from "../packages/core/src/data/catalog.js";

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

console.log("route catalog helper tests passed");
