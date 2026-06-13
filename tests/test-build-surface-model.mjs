import assert from "node:assert/strict";
import {
  buildActivePoiList,
  buildRouteStatCards,
} from "../packages/core/src/build/buildSurfaceModel.js";

const routeState = {
  distance: 12345,
  elevationGain: 456,
  elevationLoss: 321,
  activeDataPoints: [
    { id: "late", routeFraction: 0.8, information: "late" },
    { id: "early", routeFraction: 0.2, information: "early" },
    { id: "unknown", information: "unknown" },
  ],
};

const stats = buildRouteStatCards(routeState);
assert.deepEqual(
  stats.map((stat) => stat.key),
  ["distance", "elevationGain", "elevationLoss"],
);
assert.equal(stats[1].value, "456 מ׳");

const pois = buildActivePoiList(routeState);
assert.deepEqual(
  pois.map((item) => item.poi.id),
  ["unknown", "early", "late"],
);
assert.equal(pois[1].distanceLabel, "2.5 ק\"מ");

console.log("build surface model tests passed");
