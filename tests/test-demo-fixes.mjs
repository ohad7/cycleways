import assert from "node:assert/strict";
import { normalizeRideFixes } from "../scripts/demo-studio/normalizeFixes.mjs";

const rows = [
  { timeSeconds: 0, measureMode: 3, latitude: 33, longitude: 35, speed: 0 },
  { timeSeconds: 1, measureMode: 3, latitude: 33.00001, longitude: 35.00001, speed: 2 },
  { timeSeconds: 2, measureMode: 0, latitude: 0, longitude: 0 },
  { timeSeconds: 3, measureMode: 3, latitude: 40, longitude: 50, speed: 2 },
  { timeSeconds: 5, measureMode: 3, latitude: 33.00003, longitude: 35.00003, speed: 0 },
];
const result = normalizeRideFixes(rows, { trimInSeconds: 0, trimOutSeconds: 7, gpsOffsetSeconds: 1.3, maxTeleportKmh: 100 });
assert.deepEqual(result.fixes.map((fix) => fix.timestamp), [1300, 2300, 6300]);
assert.equal(result.cleanup.dropped.noLock, 1);
assert.equal(result.cleanup.dropped.teleport, 1);
assert.equal(result.fixes[2].heading, result.fixes[1].heading, "stationary heading remains stable");
assert.ok(result.warnings.some((warning) => warning.code === "gps-gap"));

console.log("demo fix normalization tests passed");
