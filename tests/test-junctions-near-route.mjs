import assert from "node:assert/strict";
import { junctionsNearRoute } from "@cycleways/core/routing/junctionsNearRoute.js";

const route = [
  { lat: 33, lng: 35 },
  { lat: 33, lng: 35.01 },
];
const network = {
  nodes: [
    { id: "j3-near", coord: [35.002, 33.0002] },
    { id: "j2-near", coord: [35.003, 33.0002] },
    { id: "j3-far", coord: [35.004, 33.01] },
    { id: "dup", coord: [35.005, 33.0001] },
    { id: "x1", coord: [35, 33.1] },
    { id: "x2", coord: [35.1, 33.1] },
    { id: "x3", coord: [35.2, 33.1] },
  ],
  edges: [
    { id: "e1", from: "j3-near", to: "x1" },
    { id: "e2", from: "j3-near", to: "x2" },
    { id: "e3", from: "j3-near", to: "j2-near" },
    { id: "e4", from: "j2-near", to: "x1" },
    { id: "e5", from: "j3-far", to: "x1" },
    { id: "e6", from: "j3-far", to: "x2" },
    { id: "e7", from: "j3-far", to: "x3" },
    { id: "e8", from: "dup", to: "x1" },
    { id: "e8", from: "dup", to: "x1" },
    { id: "e9", from: "dup", to: "x2" },
  ],
};

const junctions = junctionsNearRoute(network, route);
assert.equal(junctions.length, 1, "only the near degree-3 node qualifies");
assert.ok(Math.abs(junctions[0].lng - 35.002) < 1e-9);

assert.deepEqual(junctionsNearRoute(null, route), [], "no network -> empty");
assert.deepEqual(junctionsNearRoute(network, []), [], "no route -> empty");

console.log("test-junctions-near-route ok");
