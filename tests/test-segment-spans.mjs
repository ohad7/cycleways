import assert from "node:assert/strict";
import { buildSegmentSpans } from "@cycleways/core/route-manager.js";

// buildSegmentSpans is a pure exported helper over an ordered traversal list.
{
  const segmentNamesById = new Map([[10, "Yarkon Path"], [11, "Ayalon Bridge"]]);
  const traversals = [
    { fromDistance: 0, toDistance: 200, distanceMeters: 200, edge: { cwSegmentIds: [10], routeClass: "cycleway" } },
    { fromDistance: 0, toDistance: 150, distanceMeters: 150, edge: { cwSegmentIds: [10], routeClass: "cycleway" } },
    { fromDistance: 0, toDistance: 100, distanceMeters: 100, edge: { cwSegmentIds: [], routeClass: "residential" } },
    { fromDistance: 0, toDistance: 300, distanceMeters: 300, edge: { cwSegmentIds: [11], routeClass: "cycleway" } },
  ];
  const spans = buildSegmentSpans(traversals, segmentNamesById);
  assert.equal(spans.length, 3, "same-name traversals merge");
  assert.deepEqual(
    spans.map((s) => [s.startMeters, s.endMeters, s.name, s.onNetwork, s.routeClass]),
    [
      [0, 350, "Yarkon Path", true, "cycleway"],
      [350, 450, null, false, "residential"],
      [450, 750, "Ayalon Bridge", true, "cycleway"],
    ],
  );
}
{
  const spans = buildSegmentSpans([
    { fromDistance: 0, toDistance: 25, distanceMeters: 25, junctionMemberships: [{ junctionId: "j1" }], edge: { routeClass: "manual" } },
  ], new Map());
  assert.deepEqual(spans[0], {
    startMeters: 0,
    endMeters: 25,
    name: null,
    cwSegmentId: null,
    onNetwork: true,
    networkRole: "junction",
    routeClass: "manual",
  });
}
console.log("test-segment-spans OK");
