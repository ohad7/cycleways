import assert from "node:assert/strict";
import { routeSnapshotDigest } from "../scripts/lib/navigation-route-snapshot.mjs";

const first = { geometry: [{ lat: 33, lng: 35 }, { lat: 34, lng: 36 }], points: [], selectedSegments: [], segmentSpans: [] };
const reordered = { selectedSegments: [], points: [], segmentSpans: [], geometry: [{ lng: 35, lat: 33 }, { lng: 36, lat: 34 }] };
assert.equal(routeSnapshotDigest(first), routeSnapshotDigest(reordered));
assert.notEqual(routeSnapshotDigest(first), routeSnapshotDigest({ ...first, geometry: [{ lat: 33, lng: 35 }, { lat: 34.1, lng: 36 }] }));

console.log("demo route snapshot tests passed");
